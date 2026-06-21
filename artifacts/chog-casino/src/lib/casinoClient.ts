import { createPublicClient, createWalletClient, custom, http, type Address } from "viem";
import { useWallets } from "@privy-io/react-auth";
import { monadMainnet } from "@/config/contracts";

/**
 * Read-only client for balances/treasury views — works even if no wallet is connected.
 */
export const publicClient = createPublicClient({
  chain: monadMainnet,
  transport: http(),
});

/**
 * This app authenticates wallets via Privy (see src/hooks/useWallet.ts), not wagmi —
 * there's no WagmiProvider configured. To send transactions we bridge Privy's connected
 * wallet into a viem wallet client instead of assuming wagmi hooks are wired up.
 */
export function useCasinoWalletClient() {
  const { wallets } = useWallets();
  const wallet = wallets[0];

  async function getWalletClient(address: Address) {
    if (!wallet) throw new Error("No wallet connected");
    const provider = await wallet.getEthereumProvider();
    return createWalletClient({
      account: address,
      chain: monadMainnet,
      transport: custom(provider),
    });
  }

  return { wallet, getWalletClient };
}
