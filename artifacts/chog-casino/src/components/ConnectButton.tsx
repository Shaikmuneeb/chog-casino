import { motion } from "framer-motion";
import { Wallet, LogOut } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";

/** Privy-powered connect/login button. Replaces the old RainbowKit ConnectButton. */
export default function ConnectButton() {
  const { ready, connected, address, login, logout } = useWallet();

  if (!ready) {
    return (
      <button
        disabled
        className="px-5 py-2.5 rounded-xl glass border border-purple-500/30 text-purple-300/60 text-sm font-medium tracking-wide cursor-wait"
        data-testid="button-connect-loading"
      >
        Loading…
      </button>
    );
  }

  if (connected) {
    const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Connected";
    return (
      <motion.button
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.97 }}
        onClick={logout}
        className="group flex items-center gap-2 px-5 py-2.5 rounded-xl glass border border-purple-400/40 text-purple-100 hover:border-red-400/50 text-sm font-semibold tracking-wide transition-colors"
        data-testid="button-wallet"
        title="Click to disconnect"
      >
        <Wallet className="w-4 h-4 text-yellow-300 group-hover:hidden" />
        <LogOut className="w-4 h-4 text-red-300 hidden group-hover:block" />
        <span className="font-mono">{short}</span>
      </motion.button>
    );
  }

  return (
    <motion.button
      whileHover={{ scale: 1.05, y: -1 }}
      whileTap={{ scale: 0.97 }}
      onClick={login}
      className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-cinzel font-bold text-xs sm:text-sm tracking-[0.12em] uppercase bg-gradient-to-r from-purple-600 to-purple-800 text-white neon-purple border border-purple-400/40 transition-all"
      data-testid="button-connect"
    >
      <Wallet className="w-4 h-4" />
      Connect Wallet
    </motion.button>
  );
}
