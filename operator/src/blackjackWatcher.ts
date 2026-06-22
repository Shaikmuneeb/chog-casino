import { keccak256, parseEventLogs, toHex, type Abi, type Address, type Hex, type TransactionReceipt } from "viem";
import { publicClient, walletClient, vaultWalletClient } from "./chain.js";
import { BLACKJACK_ABI, CUSTODIAL_VAULT_ABI } from "./abi.js";
import { SeedStore, type SeedRecord } from "./store.js";
import { config } from "./config.js";
import { replayRound, type ReplayedRound } from "./blackjackReplay.js";
import { writeWithGasBuffer, assertTxSucceeded } from "./txSafety.js";

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

export function watchBlackjack(address: Address, store: SeedStore) {
  console.log(`[watcher:blackjack] watching ${address}`);

  publicClient.watchContractEvent({
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
    onError: (err) => console.error("[watcher:blackjack] RoundOpened subscription error", err),
  });

  publicClient.watchContractEvent({
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
    onError: (err) => console.error("[watcher:blackjack] ActionTaken subscription error", err),
  });

  for (const record of store.pendingReveals()) {
    if (record.game !== "blackjack") continue;
    void maybeResolve(address, BigInt(record.betRef!), store);
  }
  for (const record of store.pendingVaultCredits()) {
    if (record.game !== "blackjack") continue;
    void resumeVaultCredit(address, record, store);
  }
}

/** Resumes a vault credit that never completed before a restart, by re-fetching the exact
 *  revealAndResolve receipt (recorded as resolveTxHash) instead of scanning chain history. */
async function resumeVaultCredit(address: Address, record: SeedRecord, store: SeedStore) {
  if (!record.resolveTxHash) {
    console.error(`[watcher:blackjack] commitment ${record.commitment} has no resolveTxHash — cannot resume vault credit, manual check required`);
    return;
  }
  const receipt = await publicClient.getTransactionReceipt({ hash: record.resolveTxHash });
  await creditVaultIfWon(address, receipt, record, store);
}

/**
 * For vault-funded rounds only (record.vaultOwner is set): the operator's own wallet was the
 * player on every placeBet/hit/stand/double/split call, so the contract paid US, not the real
 * player. RoundResolved only carries totalPayout (no token), so the token is read from the
 * round struct itself. On a loss (totalPayout 0), nothing happens — every stake was already
 * debited as it was placed (see vaultBet.ts's blackjack functions).
 */
async function creditVaultIfWon(address: Address, receipt: TransactionReceipt, record: SeedRecord, store: SeedStore) {
  if (!vaultWalletClient || !config.custodialVault) {
    console.error(`[watcher:blackjack] vault-funded round resolved but vault operator isn't configured — cannot credit`);
    return;
  }

  const [resolvedLog] = parseEventLogs({ abi: BLACKJACK_ABI, eventName: "RoundResolved", logs: receipt.logs });
  if (!resolvedLog) {
    console.error(`[watcher:blackjack] could not find RoundResolved log to credit vault for ${record.commitment}`);
    return;
  }
  const { roundId, totalPayout } = resolvedLog.args;
  const round = await getRound(address, roundId!);
  const token = round[1] as Address;
  const outcome = { won: !!totalPayout && totalPayout > 0n, payoutAmount: (totalPayout ?? 0n).toString(), token };

  if (!totalPayout || totalPayout === 0n) {
    store.markVaultCredited(record.commitment, outcome);
    return;
  }

  const betRef = keccak256(toHex(`${record.commitment}-payout`));
  const hash = await writeWithGasBuffer(vaultWalletClient, {
    address: config.custodialVault,
    abi: CUSTODIAL_VAULT_ABI as Abi,
    functionName: "credit",
    args: [record.vaultOwner!, token, totalPayout, betRef],
  });
  const creditReceipt = await publicClient.waitForTransactionReceipt({ hash });
  assertTxSucceeded(creditReceipt, `[watcher:blackjack] credit payout for ${record.vaultOwner}`);
  store.markVaultCredited(record.commitment, outcome);
  console.log(`[watcher:blackjack] credited vault-funded win: ${record.vaultOwner} +${totalPayout} of ${token}`);
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
    const hash = await writeWithGasBuffer(walletClient, {
      address,
      abi: BLACKJACK_ABI as Abi,
      functionName: "revealAndResolve",
      args: [roundId, record.serverSeed],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assertTxSucceeded(receipt, `[watcher:blackjack] revealAndResolve for round ${roundId}`);
    store.markResolved(commitment, hash);
    console.log(`[watcher:blackjack] resolved round ${roundId} (tx ${hash})`);

    if (record.vaultOwner) {
      await creditVaultIfWon(address, receipt, record, store);
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
