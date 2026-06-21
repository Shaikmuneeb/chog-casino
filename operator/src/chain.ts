import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";
import { config } from "./config.js";

// Same chain definition as the frontend's src/chains.ts — Monad mainnet, chain id 143.
export const monad = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { decimals: 18, name: "Monad", symbol: "MON" },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});

export const publicClient = createPublicClient({ chain: monad, transport: http(config.rpcUrl) });

export const operatorAccount = privateKeyToAccount(config.operatorPrivateKey);

export const walletClient = createWalletClient({
  account: operatorAccount,
  chain: monad,
  transport: http(config.rpcUrl),
});
