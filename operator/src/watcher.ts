import { keccak256, parseEventLogs, toHex, type Abi, type Address, type Hex, type TransactionReceipt } from "viem";
import { publicClient, walletClient, vaultWalletClient } from "./chain.js";
import { SINGLE_SHOT_GAME_ABI, CUSTODIAL_VAULT_ABI, ERC20_ABI } from "./abi.js";
import { SeedStore, type SeedRecord } from "./store.js";
import { config, NATIVE_TOKEN, type GameName } from "./config.js";
import { writeWithGasBuffer, writeWithFlatResolveGas, assertTxSucceeded, sendValueWithQueue, classifyAndMaybeRestart } from "./txSafety.js";

/**
 * Watches one single-shot game contract (CoinFlip/Dice/Roulette/Mines/Crash) for BetPlaced
 * events, matches them to a commitment we generated earlier via POST /commit, and immediately
 * calls revealAndResolve — there's no player decision after placeBet for these games, so the
 * round can be settled the instant it's on-chain.
 */
function startEventSubscription(game: GameName, address: Address, store: SeedStore) {
  const label = `watcher:${game}`;
  let unwatch = publicClient.watchContractEvent({
    address,
    abi: SINGLE_SHOT_GAME_ABI,
    eventName: "BetPlaced",
    onLogs: async (logs) => {
      for (const log of logs) {
        const betRef = log.args.betRef;
        if (betRef === undefined) continue;
        await handleBetPlaced(game, address, betRef, store);
      }
    },
    onError: (err) =>
      classifyAndMaybeRestart(
        label,
        err,
        () => {
          unwatch = startEventSubscription(game, address, store);
        },
        () => unwatch(),
      ),
  });
  return unwatch;
}

export function watchSingleShotGame(game: GameName, address: Address, store: SeedStore) {
  console.log(`[watcher:${game}] watching ${address}`);
  startEventSubscription(game, address, store);

  // On startup, resolve any unmatched commitment whose bet may have landed while we were down.
  // Each of these is fire-and-forget by design (the watcher must keep booting the other games
  // regardless), so a rejection here MUST be caught locally — left unhandled, it crashes the
  // entire Node process and takes down every other game's watcher with it (confirmed: a single
  // stuck vault-credit record, e.g. one whose forward payout can't land because the betting
  // wallet is temporarily short of funds, repeatedly killed the whole operator on every restart).
  for (const record of store.unmatched()) {
    if (record.game !== game) continue;
    reconcileUnmatched(game, address, store, record.commitment).catch((err) =>
      console.error(`[watcher:${game}] failed to reconcile unmatched commitment ${record.commitment}`, err),
    );
  }
  for (const record of store.pendingReveals()) {
    if (record.game !== game) continue;
    reveal(game, address, BigInt(record.betRef!), store, record.commitment).catch((err) =>
      console.error(`[watcher:${game}] failed to resume pending reveal for ${record.commitment}`, err),
    );
  }
  for (const record of store.pendingVaultCredits()) {
    if (record.game !== game) continue;
    resumeVaultCredit(game, record, store).catch((err) =>
      console.error(`[watcher:${game}] failed to resume vault credit for ${record.commitment}`, err),
    );
  }
}

/** Resumes a vault credit that never completed before a restart. record.vaultOutcome is normally
 *  already set (markResolved sets it the instant the outcome is decoded — see reveal() below);
 *  only re-decode from the receipt as a fallback for records resolved before that field existed. */
async function resumeVaultCredit(game: GameName, record: SeedRecord, store: SeedStore) {
  if (!record.vaultOwner) return;
  let outcome = record.vaultOutcome;
  if (!outcome) {
    if (!record.resolveTxHash) {
      console.error(`[watcher:${game}] commitment ${record.commitment} has no resolveTxHash — cannot resume vault credit, manual check required`);
      return;
    }
    const receipt = await publicClient.getTransactionReceipt({ hash: record.resolveTxHash });
    outcome = decodeOutcome(receipt);
    if (!outcome) {
      console.error(`[watcher:${game}] could not find BetResolved log to resume vault credit for ${record.commitment}`);
      return;
    }
  }
  await creditVaultIfWon(game, record.vaultOwner, record.commitment, outcome, store);
}

async function handleBetPlaced(game: GameName, address: Address, betId: bigint, store: SeedStore) {
  const onChainCommitment = (await publicClient.readContract({
    address,
    abi: SINGLE_SHOT_GAME_ABI,
    functionName: "serverSeedCommitment",
    args: [betId],
  })) as Hex;

  const record = store.findByCommitment(onChainCommitment);
  if (!record) {
    // Not one of ours (e.g. a different operator instance, or Pyth Entropy mode) — ignore.
    return;
  }

  store.markMatched(record.commitment, betId.toString());
  await reveal(game, address, betId, store, record.commitment);
}

async function reconcileUnmatched(game: GameName, address: Address, store: SeedStore, commitment: Hex) {
  // Best-effort: if the bet already landed while we were offline, watchContractEvent's
  // onLogs won't replay it. A production version should also scan recent blocks here;
  // left as a known gap — see the operator README in this folder.
  console.log(`[watcher:${game}] commitment ${commitment} still unmatched after restart`);
}

// Guards against resolving the same bet twice concurrently — placeSingleShotVaultBet calls
// reveal() directly the instant it confirms a bet on-chain (see export below), and the
// watchContractEvent subscription below may *also* independently notice the same BetPlaced
// event and call it again. Both paths are correct on their own; this just stops them racing.
const inFlightReveals = new Set<string>();

export async function reveal(game: GameName, address: Address, betId: bigint, store: SeedStore, commitment: Hex) {
  const record = store.findByCommitment(commitment);
  if (!record || record.resolved) return;
  if (inFlightReveals.has(commitment)) return;
  inFlightReveals.add(commitment);

  try {
    const hash = await writeWithFlatResolveGas(walletClient, {
      address,
      abi: SINGLE_SHOT_GAME_ABI as Abi,
      functionName: "revealAndResolve",
      args: [betId, record.serverSeed],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assertTxSucceeded(receipt, `[watcher:${game}] revealAndResolve for bet ${betId}`);

    // Decode win/loss/payout from this SAME receipt, right now — this is everything the player
    // needs to see a result, and it's already fully decided on-chain at this exact point.
    const outcome = record.vaultOwner ? decodeOutcome(receipt) : undefined;
    store.markResolved(commitment, hash, outcome);
    console.log(`[watcher:${game}] resolved bet ${betId} (tx ${hash})`);

    if (record.vaultOwner && outcome) {
      await creditVaultIfWon(game, record.vaultOwner, commitment, outcome, store);
    }
  } catch (err) {
    console.error(`[watcher:${game}] failed to reveal bet ${betId}`, err);
  } finally {
    inFlightReveals.delete(commitment);
  }
}

/** Decodes win/loss/payout from a revealAndResolve receipt's own BetResolved event. This is
 *  everything the player needs to see a result — kept separate from creditVaultIfWon so it can
 *  run (and get stored via markResolved) the INSTANT resolution confirms, not after the slower
 *  forward+credit bookkeeping below also finishes. */
function decodeOutcome(receipt: TransactionReceipt): { won: boolean; payoutAmount: string; token: Address } | undefined {
  const [resolvedLog] = parseEventLogs({ abi: SINGLE_SHOT_GAME_ABI, eventName: "BetResolved", logs: receipt.logs });
  if (!resolvedLog) return undefined;
  const { token, payoutAmount, won } = resolvedLog.args;
  return { won: !!won, payoutAmount: (payoutAmount ?? 0n).toString(), token: token! };
}

/**
 * For instant vault-funded bets only: the operator's own wallet was msg.sender on placeBet, so
 * the contract just paid US, not the real player, on a win. Forward that payout into
 * CustodialVault and credit the player's ledger balance to match. On a loss, nothing to move —
 * their stake was already debited at bet-placement time (see server.ts's /vault-bet routes).
 *
 * Deliberately NOT on the path the frontend waits on: by the time this runs, markResolved has
 * already recorded the outcome (see reveal() above) and GET /vault-bet/:game/:betRef/result is
 * already answering with the real win/loss/payout. This function is pure backend reconciliation
 * — making sure the vault's ledger and its actual on-chain balance agree — and was previously
 * (wrongly) gating the player-visible result behind two extra sequential transactions.
 */
async function creditVaultIfWon(
  game: GameName,
  vaultOwner: Address,
  commitment: Hex,
  outcome: { won: boolean; payoutAmount: string; token: Address },
  store: SeedStore,
) {
  if (!vaultWalletClient || !config.custodialVault) {
    console.error(`[watcher:${game}] vault-funded bet resolved but vault operator isn't configured — cannot credit`);
    return;
  }

  const { token, won } = outcome;
  const payoutAmount = BigInt(outcome.payoutAmount);

  if (!won || payoutAmount === 0n) {
    store.markVaultCredited(commitment);
    return;
  }

  // The game contract just paid this win's payout straight to the betting wallet (it was
  // msg.sender), not to CustodialVault. credit() below only updates the player's *ledger*
  // balance — it moves no funds on its own (nonpayable). Without this forwarding step, every
  // win would record a liability the vault never actually holds the MON to cover, silently
  // making the vault insolvent over time (confirmed directly: totalLiabilities had drifted to
  // ~103 MON against an actual balance of ~8.7 MON before this fix). So: physically move the
  // payout from the betting wallet into CustodialVault first, and only record the credit once
  // that's actually landed on-chain.
  const isNative = token === NATIVE_TOKEN;
  const forwardHash = isNative
    ? await sendValueWithQueue(walletClient, config.custodialVault, payoutAmount)
    : await writeWithGasBuffer(walletClient, {
        address: token,
        abi: ERC20_ABI as Abi,
        functionName: "transfer",
        args: [config.custodialVault, payoutAmount],
      });
  const forwardReceipt = await publicClient.waitForTransactionReceipt({ hash: forwardHash });
  assertTxSucceeded(forwardReceipt, `[watcher:${game}] forward payout to vault for ${vaultOwner}`);

  const betRef = keccak256(toHex(`${commitment}-payout`));
  const hash = await writeWithGasBuffer(vaultWalletClient, {
    address: config.custodialVault,
    abi: CUSTODIAL_VAULT_ABI as Abi,
    functionName: "credit",
    args: [vaultOwner, token, payoutAmount, betRef],
  });
  const creditReceipt = await publicClient.waitForTransactionReceipt({ hash });
  assertTxSucceeded(creditReceipt, `[watcher:${game}] credit payout for ${vaultOwner}`);
  store.markVaultCredited(commitment);
  console.log(`[watcher:${game}] credited vault-funded win: ${vaultOwner} +${payoutAmount} of ${token}`);
}

export function watchAllSingleShotGames(store: SeedStore) {
  for (const [game, address] of Object.entries(config.games) as [GameName, Address][]) {
    watchSingleShotGame(game, address, store);
  }
}
