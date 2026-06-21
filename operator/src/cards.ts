import { encodePacked, keccak256, type Hex } from "viem";

/**
 * Mirrors Blackjack.sol's `_cardAt` exactly:
 *   keccak256(abi.encodePacked(serverSeed, clientSeed, roundId, cardIndex)) % 13
 * Must stay byte-for-byte identical to the Solidity version — this is what lets the operator
 * tell a player their real card the instant they hit, while the contract only verifies the
 * same value later once the seed is revealed on-chain.
 */
export function cardAt(serverSeed: Hex, clientSeed: Hex, roundId: bigint, cardIndex: number): number {
  const packed = encodePacked(
    ["bytes32", "bytes32", "uint256", "uint8"],
    [serverSeed, clientSeed, roundId, cardIndex],
  );
  return Number(BigInt(keccak256(packed)) % 13n);
}

export const RANK_NAMES = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

export function cardValue(rank: number): number {
  if (rank <= 8) return rank + 2;
  if (rank <= 11) return 10;
  return 11; // Ace, soft — adjusted in handValue
}

export function handValue(ranks: number[]): number {
  let total = 0;
  let aces = 0;
  for (const rank of ranks) {
    total += cardValue(rank);
    if (rank === 12) aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

/**
 * Mirrors the single-shot games' RNG: keccak256(abi.encodePacked(serverSeed, clientSeed, betId)).
 * Used by CoinFlip/Dice/Roulette/Mines/Crash — each game then derives its own outcome from
 * this one random value (see each contract's `_resolveBet`).
 */
export function randomNumberForBet(serverSeed: Hex, clientSeed: Hex, betId: bigint): Hex {
  return keccak256(encodePacked(["bytes32", "bytes32", "uint256"], [serverSeed, clientSeed, betId]));
}
