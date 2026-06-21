import type { Address, Hex } from "viem";
import { publicClient, walletClient } from "./chain.js";
import { SINGLE_SHOT_GAME_ABI } from "./abi.js";
import { SeedStore } from "./store.js";
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
    await publicClient.waitForTransactionReceipt({ hash });
    store.markResolved(commitment);
    console.log(`[watcher:${game}] resolved bet ${betId} (tx ${hash})`);
  } catch (err) {
    console.error(`[watcher:${game}] failed to reveal bet ${betId}`, err);
  }
}

export function watchAllSingleShotGames(store: SeedStore) {
  for (const [game, address] of Object.entries(config.games) as [GameName, Address][]) {
    watchSingleShotGame(game, address, store);
  }
}
