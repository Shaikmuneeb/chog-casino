import { keccak256, toHex, pad, type Hex } from "viem";
import { cardAt } from "./cards.js";

/**
 * Cross-checks cardAt() against a hand-built packed encoding (NOT using viem's encodePacked
 * helper, to catch any bug in how that helper is used) — confirms it produces the exact same
 * 97-byte layout Solidity's abi.encodePacked(bytes32,bytes32,uint256,uint8) would: 32 + 32 +
 * 32 + 1 bytes, concatenated with no padding between fields. Run with `npm run verify-math`.
 */
function manualCardAt(serverSeed: Hex, clientSeed: Hex, roundId: bigint, cardIndex: number): number {
  const roundIdHex = pad(toHex(roundId), { size: 32 }).slice(2);
  const cardIndexHex = cardIndex.toString(16).padStart(2, "0");
  const packed = (serverSeed.slice(2) + clientSeed.slice(2) + roundIdHex + cardIndexHex) as string;
  return Number(BigInt(keccak256(`0x${packed}` as Hex)) % 13n);
}

const serverSeed = keccak256(toHex("server-a"));
const clientSeed = keccak256(toHex("client-a"));
const roundId = 0n;

let allMatch = true;
for (let i = 0; i < 10; i++) {
  const viaHelper = cardAt(serverSeed, clientSeed, roundId, i);
  const manual = manualCardAt(serverSeed, clientSeed, roundId, i);
  const match = viaHelper === manual;
  allMatch &&= match;
  console.log(`cardIndex=${i}: encodePacked=${viaHelper} manual=${manual} ${match ? "OK" : "MISMATCH"}`);
}

if (!allMatch) {
  console.error("\nFAILED — cardAt() does not match the manual packed encoding. Do not run the operator.");
  process.exit(1);
}
console.log("\nAll 10 card indices match — cardAt() is encoding identically to Solidity's abi.encodePacked.");
