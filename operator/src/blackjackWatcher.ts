import { keccak256, parseEventLogs, toHex, type Abi, type Address, type Hex, type TransactionReceipt } from "viem";
import { publicClient, walletClient, vaultWalletClient } from "./chain.js";
import { BLACKJACK_ABI, CUSTODIAL_VAULT_ABI, ERC20_ABI } from "./abi.js";
import { SeedStore, type SeedRecord } from "./store.js";
import { config, NATIVE_TOKEN } from "./config.js";
import { replayRound, type ReplayedRound } from "./blackjackReplay.js";
import { writeWithGasBuffer, writeWithFlatResolveGas, assertTxSucceeded, sendValueWithQueue, classifyAndMaybeRestart } from "./txSafety.js";

type RoundTuple = readonly [
  string, // player
  string, // token
  bigint, // betHand0
  bigint, // betHand1
  number, // totalHands
  number, // cardCount0
  number, // cardCount1
  boolean, // hand0Closed
  boolean, // hand1Closed
  boolean, // isSplit
  boolean, // resolved
  boolean, // exists
  Hex, // clientSeed
  Hex, // serverSeedCommitment
];

function startRoundOpenedSubscription(address: Address, store: SeedStore): () => void {
  const label = "watcher:blackjack:RoundOpened";
  let unwatch = publicClient.watchContractEvent({
    address,
    abi: BLACKJACK_ABI,
    eventName: "RoundOpened",
    onLogs: async (logs) => {
      for (const log of logs) {
        const { roundId, serverSeedCommitment } = log.args;
        if (roundId === undefined || !serverSeedCommitment) continue;
        const record = store.findByCommitment(serverSeedCommitment);
        if (!record) continue; // not ours
        store.markMatched(record.commitment, roundId.toString());
        console.log(`[watcher:blackjack] round ${roundId} opened, matched commitment ${serverSeedCommitment}`);
      }
    },
    onError: (err) =>
      classifyAndMaybeRestart(
        label,
        err,
        () => {
          unwatch = startRoundOpenedSubscription(address, store);
        },
        () => unwatch(),
      ),
  });
  return unwatch;
}

function startActionTakenSubscription(address: Address, store: SeedStore): () => void {
  const label = "watcher:blackjack:ActionTaken";
  let unwatch = publicClient.watchContractEvent({
    address,
    abi: BLACKJACK_ABI,
    eventName: "ActionTaken",
    onLogs: async (logs) => {
      for (const log of logs) {
        const { roundId } = log.args;
        if (roundId === undefined) continue;
        await maybeResolve(address, roundId, store);
      }
    },
    onError: (err) =>
      classifyAndMaybeRestart(
        label,
        err,
        () => {
          unwatch = startActionTakenSubscription(address, store);
        },
        () => unwatch(),
      ),
  });
  return unwatch;
}

export function watchBlackjack(address: Address, store: SeedStore) {
  console.log(`[watcher:blackjack] watching ${address}`);

  startRoundOpenedSubscription(address, store);
  startActionTakenSubscription(address, store);

  for (const record of store.pendingReveals()) {
    if (record.game !== "blackjack") continue;
    maybeResolve(address, BigInt(record.betRef!), store).catch((err) =>
      console.error(`[watcher:blackjack] failed to resume pending reveal for round ${record.betRef}`, err),
    );
  }
  for (const record of store.pendingVaultCredits()) {
    if (record.game !== "blackjack") continue;
    resumeVaultCredit(address, record, store).catch((err) =>
      console.error(`[watcher:blackjack] failed to resume vault credit for ${record.commitment}`, err),
    );
  }
}

/** Decodes win/loss/payout from a revealAndResolve receipt's own RoundResolved event — same
 *  rationale as watcher.ts's decodeOutcome: must run (and get stored via markResolved) the
 *  instant resolution confirms, not after the slower forward+credit bookkeeping also finishes. */
async function decodeOutcome(address: Address, receipt: TransactionReceipt): Promise<{ won: boolean; payoutAmount: string; token: Address } | undefined> {
  const [resolvedLog] = parseEventLogs({ abi: BLACKJACK_ABI, eventName: "RoundResolved", logs: receipt.logs });
  if (!resolvedLog) return undefined;
  const { roundId, totalPayout } = resolvedLog.args;
  const round = await getRound(address, roundId!);
  const token = round[1] as Address;
  return { won: !!totalPayout && totalPayout > 0n, payoutAmount: (totalPayout ?? 0n).toString(), token };
}

/** Resumes a vault credit that never completed before a restart. record.vaultOutcome is normally
 *  already set (markResolved sets it the instant the outcome is decoded — see maybeResolve below);
 *  only re-decode from the receipt as a fallback for records resolved before that field existed. */
async function resumeVaultCredit(address: Address, record: SeedRecord, store: SeedStore) {
  if (!record.vaultOwner) return;
  let outcome = record.vaultOutcome;
  if (!outcome) {
    if (!record.resolveTxHash) {
      console.error(`[watcher:blackjack] commitment ${record.commitment} has no resolveTxHash — cannot resume vault credit, manual check required`);
      return;
    }
    const receipt = await publicClient.getTransactionReceipt({ hash: record.resolveTxHash });
    outcome = await decodeOutcome(address, receipt);
    if (!outcome) {
      console.error(`[watcher:blackjack] could not find RoundResolved log to resume vault credit for ${record.commitment}`);
      return;
    }
  }
  await creditVaultIfWon(record.vaultOwner, record.commitment, outcome, store);
}

/**
 * For vault-funded rounds only: the operator's own wallet was the player on every
 * placeBet/hit/stand/double/split call, so the contract paid US, not the real player, on a win.
 * On a loss, nothing to move — every stake was already debited as it was placed (see
 * vaultBet.ts's blackjack functions).
 *
 * Deliberately NOT on the path the frontend waits on — see watcher.ts's creditVaultIfWon for the
 * full rationale: by the time this runs, the outcome is already recorded and the player can
 * already see their result; this is pure backend ledger reconciliation.
 */
async function creditVaultIfWon(
  vaultOwner: Address,
  commitment: Hex,
  outcome: { won: boolean; payoutAmount: string; token: Address },
  store: SeedStore,
) {
  if (!vaultWalletClient || !config.custodialVault) {
    console.error(`[watcher:blackjack] vault-funded round resolved but vault operator isn't configured — cannot credit`);
    return;
  }

  const { token, won } = outcome;
  const totalPayout = BigInt(outcome.payoutAmount);

  if (!won || totalPayout === 0n) {
    store.markVaultCredited(commitment);
    return;
  }

  // Same gap as the single-shot games (see watcher.ts's creditVaultIfWon for the full
  // explanation): the contract paid this round's payout straight to the betting wallet, and
  // credit() alone only updates the ledger — it never moves funds. Forward the real payout into
  // CustodialVault first so the credit is actually backed.
  const isNative = token === NATIVE_TOKEN;
  const forwardHash = isNative
    ? await sendValueWithQueue(walletClient, config.custodialVault, totalPayout)
    : await writeWithGasBuffer(walletClient, {
        address: token,
        abi: ERC20_ABI as Abi,
        functionName: "transfer",
        args: [config.custodialVault, totalPayout],
      });
  const forwardReceipt = await publicClient.waitForTransactionReceipt({ hash: forwardHash });
  assertTxSucceeded(forwardReceipt, `[watcher:blackjack] forward payout to vault for ${vaultOwner}`);

  const betRef = keccak256(toHex(`${commitment}-payout`));
  const hash = await writeWithGasBuffer(vaultWalletClient, {
    address: config.custodialVault,
    abi: CUSTODIAL_VAULT_ABI as Abi,
    functionName: "credit",
    args: [vaultOwner, token, totalPayout, betRef],
  });
  const creditReceipt = await publicClient.waitForTransactionReceipt({ hash });
  assertTxSucceeded(creditReceipt, `[watcher:blackjack] credit payout for ${vaultOwner}`);
  store.markVaultCredited(commitment);
  console.log(`[watcher:blackjack] credited vault-funded win: ${vaultOwner} +${totalPayout} of ${token}`);
}

async function getRound(address: Address, roundId: bigint): Promise<RoundTuple> {
  return (await publicClient.readContract({
    address,
    abi: BLACKJACK_ABI,
    functionName: "rounds",
    args: [roundId],
  })) as unknown as RoundTuple;
}

async function getActions(address: Address, roundId: bigint) {
  return (await publicClient.readContract({
    address,
    abi: BLACKJACK_ABI,
    functionName: "getActions",
    args: [roundId],
  })) as readonly { action: number; handIndex: number }[];
}

async function maybeResolve(address: Address, roundId: bigint, store: SeedStore) {
  const round = await getRound(address, roundId);
  const [, , , , totalHands, , , hand0Closed, hand1Closed, , resolved] = round;
  if (resolved) return;

  const ready = hand0Closed && (totalHands === 1 || hand1Closed);
  if (!ready) return;

  const commitment = round[13];
  const record = store.findByCommitment(commitment);
  if (!record || record.resolved) return;

  try {
    const hash = await writeWithFlatResolveGas(walletClient, {
      address,
      abi: BLACKJACK_ABI as Abi,
      functionName: "revealAndResolve",
      args: [roundId, record.serverSeed],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assertTxSucceeded(receipt, `[watcher:blackjack] revealAndResolve for round ${roundId}`);

    const outcome = record.vaultOwner ? await decodeOutcome(address, receipt) : undefined;
    store.markResolved(commitment, hash, outcome);
    console.log(`[watcher:blackjack] resolved round ${roundId} (tx ${hash})`);

    if (record.vaultOwner && outcome) {
      await creditVaultIfWon(record.vaultOwner, commitment, outcome, store);
    }
  } catch (err) {
    console.error(`[watcher:blackjack] failed to reveal round ${roundId}`, err);
  }
}

/**
 * Computes the player's real cards for a round in progress — called by the GET
 * /blackjack/:roundId/cards endpoint the frontend polls during play. The dealer's hole card
 * is omitted unless the round is closed, matching standard Blackjack UX (it's only revealed
 * once the player is done acting).
 */
export async function getLiveCards(
  address: Address,
  roundId: bigint,
  store: SeedStore,
): Promise<(ReplayedRound & { dealerHoleRevealed: boolean }) | null> {
  const round = await getRound(address, roundId);
  const [, , , , totalHands, , , hand0Closed, hand1Closed, , , exists, clientSeed, commitment] = round;
  if (!exists) return null;

  const record = store.findByCommitment(commitment);
  if (!record) return null;

  const actions = await getActions(address, roundId);
  const replayed = replayRound(record.serverSeed, clientSeed, roundId, [...actions]);

  const dealerHoleRevealed = hand0Closed && (totalHands === 1 || hand1Closed);
  return {
    ...replayed,
    dealerHole: dealerHoleRevealed ? replayed.dealerHole : -1,
    dealerHoleRevealed,
  };
}
