import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount, mnemonicToAccount } from "viem/accounts";
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

// ── Custodial deposit addresses ──
// Derived from a SEPARATE mnemonic (config.depositMnemonic), never the commit-reveal
// OPERATOR_PRIVATE_KEY above. Standard BIP-44 path m/44'/60'/0'/0/{index} — same derivation
// every major wallet uses, so the deposit mnemonic could in principle be imported into a
// hardware wallet for cold storage of the derivation seed itself.
export function deriveDepositAccount(index: number) {
  if (!config.depositMnemonic) {
    throw new Error("DEPOSIT_MNEMONIC is not set — required for custodial deposit addresses");
  }
  return mnemonicToAccount(config.depositMnemonic, { addressIndex: index });
}

export function depositAddressClient(index: number) {
  const account = deriveDepositAccount(index);
  return createWalletClient({ account, chain: monad, transport: http(config.rpcUrl) });
}

// The vault-operator key is intentionally distinct from operatorAccount above — a compromise
// of the commit-reveal key (which only ever calls revealAndResolve) must not also grant
// CustodialVault.credit() privileges, and vice versa.
export const vaultOperatorAccount = config.vaultOperatorPrivateKey
  ? privateKeyToAccount(config.vaultOperatorPrivateKey)
  : undefined;

export const vaultWalletClient = vaultOperatorAccount
  ? createWalletClient({ account: vaultOperatorAccount, chain: monad, transport: http(config.rpcUrl) })
  : undefined;
