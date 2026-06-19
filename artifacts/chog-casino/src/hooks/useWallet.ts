import { usePrivy } from "@privy-io/react-auth";

/**
 * Single wallet interface for the whole app, backed by Privy.
 * - `ready`: Privy finished loading
 * - `connected`: user is logged in (and has a wallet via Privy)
 * - `address`: their wallet address (or null)
 * - `login` / `logout`: open the Privy login modal / sign out
 */
export function useWallet() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const address = user?.wallet?.address ?? null;
  return {
    ready,
    connected: authenticated,
    address,
    login,
    logout,
  };
}
