import { motion } from "framer-motion";
import { Wallet } from "lucide-react";
import { ConnectButton } from "@rainbow-me/rainbowkit";

/** Shown inside a game when the player is in Real mode but hasn't connected a wallet. */
export default function WalletGateNotice() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-4 py-4 text-center"
      data-testid="wallet-gate-notice"
    >
      <div className="flex items-center gap-2 text-yellow-300">
        <Wallet className="w-4 h-4" />
        <span className="text-sm font-semibold tracking-wide">Real mode needs a wallet</span>
      </div>
      <p className="text-xs text-purple-200/60 max-w-xs">
        Connect your wallet to play with real $CHOG, or switch to{" "}
        <span className="text-purple-200 font-medium">Fun</span> mode to play with free credits.
      </p>
      <ConnectButton label="Connect Wallet" chainStatus="icon" showBalance={false} />
    </motion.div>
  );
}
