import "dotenv/config";
import type { Address, Hex } from "viem";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name} — copy .env.example to .env and fill it in`);
  return value;
}

export const config = {
  rpcUrl: required("RPC_URL"),
  operatorPrivateKey: required("OPERATOR_PRIVATE_KEY") as Hex,
  port: Number(process.env.PORT ?? 8787),
  seedStorePath: process.env.SEED_STORE_PATH ?? "./data/seeds.json",

  treasury: required("TREASURY_ADDRESS") as Address,
  games: {
    coinFlip: required("COINFLIP_ADDRESS") as Address,
    dice: required("DICE_ADDRESS") as Address,
    roulette: required("ROULETTE_ADDRESS") as Address,
    mines: required("MINES_ADDRESS") as Address,
    crash: required("CRASH_ADDRESS") as Address,
  },
  blackjack: required("BLACKJACK_ADDRESS") as Address,

  // ── Custodial deposit-address vault — deliberately separate secrets from the
  // commit-reveal operator key above. See operator/README.md for the security rationale.
  custodialVault: process.env.CUSTODIAL_VAULT_ADDRESS as Address | undefined,
  vaultOperatorPrivateKey: process.env.VAULT_OPERATOR_PRIVATE_KEY as Hex | undefined,
  depositMnemonic: process.env.DEPOSIT_MNEMONIC,
  depositStorePath: process.env.DEPOSIT_STORE_PATH ?? "./data/deposit-addresses.json",
  depositPollIntervalMs: Number(process.env.DEPOSIT_POLL_INTERVAL_MS ?? 20_000),
  depositGasReserveWei: BigInt(process.env.DEPOSIT_GAS_RESERVE_WEI ?? "2000000000000000"), // 0.002 MON
};

export type GameName = keyof typeof config.games;

// Same hardcoded token registry as the frontend's src/config/contracts.ts and the deployed
// TreasuryContract/CustodialVault — do not change without redeploying everything.
export const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000" as Address;
export const CHOG_ADDRESS = "0x350035555E10d9AfAF1566AaebfCeD5BA6C27777" as Address;
export const USDC_ADDRESS = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" as Address;

export const DEPOSIT_TOKENS: { address: Address; decimals: number }[] = [
  { address: NATIVE_TOKEN, decimals: 18 },
  { address: CHOG_ADDRESS, decimals: 18 },
  { address: USDC_ADDRESS, decimals: 6 },
];
