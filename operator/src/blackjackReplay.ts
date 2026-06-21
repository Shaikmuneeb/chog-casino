import type { Hex } from "viem";
import { cardAt } from "./cards.js";
import { ActionType } from "./abi.js";

export interface ReplayedRound {
  hand0: number[];
  hand1: number[];
  dealerUp: number;
  dealerHole: number;
}

/**
 * Mirrors Blackjack.sol's `revealAndResolve` replay loop exactly (same fixed deal order:
 * player, dealer-up, player, dealer-hole, then the recorded action log in order). Used to
 * show the player their real cards live during play, before the seed is ever revealed
 * on-chain — this contract function never touches the chain, it's pure local computation.
 */
export function replayRound(
  serverSeed: Hex,
  clientSeed: Hex,
  roundId: bigint,
  actions: { action: number; handIndex: number }[],
): ReplayedRound {
  let cardIdx = 0;
  const next = () => cardAt(serverSeed, clientSeed, roundId, cardIdx++);

  const hand0: number[] = [next()];
  const dealerUp = next();
  hand0.push(next());
  const dealerHole = next();
  const hand1: number[] = [];

  for (const a of actions) {
    if (a.action === ActionType.Split) {
      hand1.push(hand0[1]);
      hand0[1] = next();
      hand1.push(next());
    } else if (a.action === ActionType.Hit || a.action === ActionType.Double) {
      const card = next();
      if (a.handIndex === 0) hand0.push(card);
      else hand1.push(card);
    }
    // Stand consumes no cards.
  }

  return { hand0, hand1, dealerUp, dealerHole };
}
