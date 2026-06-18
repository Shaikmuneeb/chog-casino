import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { ConnectButton } from "@rainbow-me/rainbowkit";

interface GameLayoutProps {
  title: string;
  subtitle: string;
  bgImage: string;
  accentColor?: string;
  children: React.ReactNode;
}

export default function GameLayout({
  title,
  subtitle,
  bgImage,
  accentColor = "text-neon-gold",
  children,
}: GameLayoutProps) {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen relative overflow-hidden" style={{ backgroundColor: "hsl(270,40%,4%)" }}>
      <div className="absolute inset-0">
        <img
          src={bgImage}
          alt={title}
          className="w-full h-full object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/60 to-[hsl(270,40%,4%)]" />
        <div className="absolute inset-0 bg-gradient-to-t from-[hsl(270,40%,4%)] via-transparent to-transparent" />
      </div>

      <div className="relative z-10 min-h-screen flex flex-col">
        <header className="flex items-center justify-between px-4 sm:px-8 py-6">
          <motion.button
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4 }}
            whileHover={{ scale: 1.05, x: -2 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setLocation("/")}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl glass border border-purple-500/30 text-purple-200 hover:text-yellow-300 hover:border-yellow-400/40 transition-colors duration-200 text-sm font-medium tracking-wide"
            data-testid="button-back-to-lobby"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Lobby
          </motion.button>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4 }}
            data-testid="game-connect-wallet"
          >
            <ConnectButton label="Connect Wallet" chainStatus="icon" showBalance={true} />
          </motion.div>
        </header>

        <div className="flex-1 flex flex-col items-center justify-start pt-6 px-4 sm:px-8 pb-12">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-center mb-10"
          >
            <h1
              className={`font-cinzel font-black text-5xl sm:text-7xl tracking-widest mb-3 leading-none ${accentColor}`}
              data-testid="game-title"
            >
              {title}
            </h1>
            <p className="text-purple-300/60 text-sm tracking-[0.3em] uppercase font-medium">
              {subtitle}
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.25 }}
            className="w-full max-w-3xl"
          >
            {children}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
