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

// viem's default pollingInterval (4000ms) for watchContractEvent / waitForTransactionReceipt
// means a placed bet can sit unnoticed for up to 4s before the watcher even starts resolving it,
// and EVERY waitForTransactionReceipt call in this codebase (placeBet, debit, revealAndResolve —
// 2-3 per single bet, all sequential since each depends on the last) pays that same polling
// delay on top of however long the tx actually took to mine. Confirmed directly: Monad mines a
// block roughly every 400ms (timestamps 5 blocks apart differed by exactly 2s), so a 1000ms+
// polling interval was adding up to 600-1000ms of pure waiting-to-notice-it's-already-done
// overhead PER confirmation, on a chain whose real confirmation time is a few hundred ms. 250ms
// keeps polling cheap (still a 4-6x margin over actual block time) while cutting that wasted
// margin to roughly a quarter of what it was — across 2-3 sequential confirmations per bet, this
// is the single biggest win available for "feels slow to reveal" without changing the contracts.
export const publicClient = createPublicClient({ chain: monad, transport: http(config.rpcUrl), pollingInterval: 250 });

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
