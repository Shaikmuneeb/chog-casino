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

  games: {
    coinFlip: required("COINFLIP_ADDRESS") as Address,
    dice: required("DICE_ADDRESS") as Address,
    roulette: required("ROULETTE_ADDRESS") as Address,
    mines: required("MINES_ADDRESS") as Address,
    crash: required("CRASH_ADDRESS") as Address,
  },
  blackjack: required("BLACKJACK_ADDRESS") as Address,
};

export type GameName = keyof typeof config.games;
