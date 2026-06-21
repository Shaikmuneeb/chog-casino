import type { Address, Hex } from "viem";
import { publicClient, walletClient } from "./chain.js";
import { BLACKJACK_ABI } from "./abi.js";
import { SeedStore } from "./store.js";
import { replayRound, type ReplayedRound } from "./blackjackReplay.js";

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
    const hash = await walletClient.writeContract({
      address,
      abi: BLACKJACK_ABI,
      functionName: "revealAndResolve",
      args: [roundId, record.serverSeed],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    store.markResolved(commitment);
    console.log(`[watcher:blackjack] resolved round ${roundId} (tx ${hash})`);
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
