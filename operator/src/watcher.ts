import { keccak256, parseEventLogs, toHex, type Address, type Hex, type TransactionReceipt } from "viem";
import { publicClient, walletClient, vaultWalletClient } from "./chain.js";
import { SINGLE_SHOT_GAME_ABI, CUSTODIAL_VAULT_ABI } from "./abi.js";
import { SeedStore, type SeedRecord } from "./store.js";
import { config, type GameName } from "./config.js";

/**
 * Watches one single-shot game contract (CoinFlip/Dice/Roulette/Mines/Crash) for BetPlaced
 * events, matches them to a commitment we generated earlier via POST /commit, and immediately
 * calls revealAndResolve — there's no player decision after placeBet for these games, so the
 * round can be settled the instant it's on-chain.
 */
export function watchSingleShotGame(game: GameName, address: Address, store: SeedStore) {
  console.log(`[watcher:${game}] watching ${address}`);

  publicClient.watchContractEvent({
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
    onError: (err) => console.error(`[watcher:${game}] event subscription error`, err),
  });

  // On startup, resolve any unmatched commitment whose bet may have landed while we were down.
  for (const record of store.unmatched()) {
    if (record.game !== game) continue;
    void reconcileUnmatched(game, address, store, record.commitment);
  }
  for (const record of store.pendingReveals()) {
    if (record.game !== game) continue;
    void reveal(game, address, BigInt(record.betRef!), store, record.commitment);
  }
  for (const record of store.pendingVaultCredits()) {
    if (record.game !== game) continue;
    void resumeVaultCredit(game, record, store);
  }
}

/** Resumes a vault credit that never completed before a restart, by re-fetching the exact
 *  revealAndResolve receipt (recorded as resolveTxHash) instead of scanning chain history. */
async function resumeVaultCredit(game: GameName, record: SeedRecord, store: SeedStore) {
  if (!record.resolveTxHash) {
    console.error(`[watcher:${game}] commitment ${record.commitment} has no resolveTxHash — cannot resume vault credit, manual check required`);
    return;
  }
  const receipt = await publicClient.getTransactionReceipt({ hash: record.resolveTxHash });
  await creditVaultIfWon(game, receipt, record, store);
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

async function reveal(game: GameName, address: Address, betId: bigint, store: SeedStore, commitment: Hex) {
  const record = store.findByCommitment(commitment);
  if (!record || record.resolved) return;

  try {
    const hash = await walletClient.writeContract({
      address,
      abi: SINGLE_SHOT_GAME_ABI,
      functionName: "revealAndResolve",
      args: [betId, record.serverSeed],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    store.markResolved(commitment, hash);
    console.log(`[watcher:${game}] resolved bet ${betId} (tx ${hash})`);

    if (record.vaultOwner) {
      await creditVaultIfWon(game, receipt, record, store);
    }
  } catch (err) {
    console.error(`[watcher:${game}] failed to reveal bet ${betId}`, err);
  }
}

/**
 * For instant vault-funded bets only (record.vaultOwner is set): the operator's own wallet was
 * msg.sender on placeBet, so the contract just paid US, not the real player. Read the actual
 * outcome from the BetResolved event this same tx emitted, and if it won, credit the payout
 * back to the real player's CustodialVault balance. On a loss, nothing happens — their stake
 * was already debited at bet-placement time (see server.ts's /vault-bet routes).
 */
async function creditVaultIfWon(game: GameName, receipt: TransactionReceipt, record: SeedRecord, store: SeedStore) {
  if (!vaultWalletClient || !config.custodialVault) {
    console.error(`[watcher:${game}] vault-funded bet resolved but vault operator isn't configured — cannot credit`);
    return;
  }

  const [resolvedLog] = parseEventLogs({ abi: SINGLE_SHOT_GAME_ABI, eventName: "BetResolved", logs: receipt.logs });
  if (!resolvedLog) {
    console.error(`[watcher:${game}] could not find BetResolved log to credit vault for ${record.commitment}`);
    return;
  }

  const { token, payoutAmount, won } = resolvedLog.args;
  const outcome = { won: !!won, payoutAmount: (payoutAmount ?? 0n).toString(), token: token! };

  if (!won || !payoutAmount || payoutAmount === 0n) {
    store.markVaultCredited(record.commitment, outcome);
    return;
  }

  const betRef = keccak256(toHex(`${record.commitment}-payout`));
  const hash = await vaultWalletClient.writeContract({
    address: config.custodialVault,
    abi: CUSTODIAL_VAULT_ABI,
    functionName: "credit",
    args: [record.vaultOwner!, token, payoutAmount, betRef],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  store.markVaultCredited(record.commitment, outcome);
  console.log(`[watcher:${game}] credited vault-funded win: ${record.vaultOwner} +${payoutAmount} of ${token}`);
}

export function watchAllSingleShotGames(store: SeedStore) {
  for (const [game, address] of Object.entries(config.games) as [GameName, Address][]) {
    watchSingleShotGame(game, address, store);
  }
}
