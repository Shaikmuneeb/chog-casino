import { defineChain } from "viem";

/**
 * !! VERIFY BEFORE USE !!
 * The existing src/chains.ts already defines Monad with chain id 143.
 * The contract spec for this deploy says chain id 41454. These conflict —
 * confirm the real Monad mainnet chain id before deploying or wiring up the frontend.
 */
export const monadMainnet = defineChain({
  id: 41454,
  name: "Monad",
  nativeCurrency: { decimals: 18, name: "Monad", symbol: "MON" },
  rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } },
});

// Hardcoded token registry — do not change without redeploying the Treasury.
export const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000" as const;
export const USDC_ADDRESS = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" as const;
export const CHOG_ADDRESS = "0x350035555E10d9AfAF1566AaebfCeD5BA6C27777" as const;

export type SupportedToken = "MON" | "USDC" | "CHOG";

export const TOKENS: Record<SupportedToken, { address: `0x${string}`; symbol: string; decimals: number }> = {
  MON: { address: NATIVE_TOKEN, symbol: "MON", decimals: 18 },
  USDC: { address: USDC_ADDRESS, symbol: "USDC", decimals: 6 },
  CHOG: { address: CHOG_ADDRESS, symbol: "CHOG", decimals: 18 },
};

/**
 * Fill these in after running `forge script script/Deploy.s.sol:Deploy --broadcast`
 * (see contracts/script/Deploy.s.sol). All zero addresses until a real deployment exists —
 * every component below treats the zero address as "not deployed yet" and disables betting.
 */
export const CONTRACTS = {
  treasury: "0x0000000000000000000000000000000000000000" as `0x${string}`,
  coinFlip: "0x0000000000000000000000000000000000000000" as `0x${string}`,
  dice: "0x0000000000000000000000000000000000000000" as `0x${string}`,
  roulette: "0x0000000000000000000000000000000000000000" as `0x${string}`,
  mines: "0x0000000000000000000000000000000000000000" as `0x${string}`,
  crash: "0x0000000000000000000000000000000000000000" as `0x${string}`,
};

export function isDeployed(address: `0x${string}`): boolean {
  return address !== "0x0000000000000000000000000000000000000000";
}

/**
 * Pyth Entropy on Monad mainnet. NOT FILLED IN — I don't have a verified Pyth Entropy
 * deployment address for Monad mainnet and won't guess one. Find the real address/provider
 * from https://docs.pyth.network/entropy before enabling Pyth mode; until then every game
 * contract defaults to commit-reveal mode (see BaseGame.sol), which requires a trusted
 * off-chain operator service (not included in this repo) to reveal server seeds.
 */
export const PYTH_ENTROPY_ADDRESS = "0x0000000000000000000000000000000000000000" as `0x${string}`;
export const PYTH_ENTROPY_PROVIDER = "0x0000000000000000000000000000000000000000" as `0x${string}`;

export const ENTROPY_ABI = [
  { type: "function", name: "getFee", stateMutability: "view", inputs: [{ name: "provider", type: "address" }], outputs: [{ type: "uint128" }] },
] as const;

// Minimal ABIs — only the functions/events the frontend actually calls.
export const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

export const TREASURY_ABI = [
  { type: "function", name: "getBalance", stateMutability: "view", inputs: [{ name: "token", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxBet", stateMutability: "view", inputs: [{ name: "token", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

// CoinFlip/Dice/Roulette/Mines/Crash all share this placeBet shape in commit-reveal mode
// (the default rngMode until Pyth Entropy is configured on-chain by the admin).
export const GAME_PLACE_BET_ABI_COMMIT_REVEAL = [
  {
    type: "function",
    name: "placeBet",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      // NOTE: per-game extra params (e.g. CoinFlip's `wantsHeads`, Dice's `target`/`isUnder`)
      // come between `amount` and the three trailing RNG params below — see each game's
      // contracts/src/<Game>.sol for the exact signature.
      { name: "userRandomNumber", type: "bytes32" },
      { name: "clientSeed", type: "bytes32" },
      { name: "serverSeedCommitment", type: "bytes32" },
    ],
    outputs: [{ name: "betRef", type: "uint256" }],
  },
] as const;
