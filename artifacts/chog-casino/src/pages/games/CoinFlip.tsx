import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import GameLayout from "@/components/GameLayout";
import bgImage from "@assets/image_1781811951344.png";

type Side = "heads" | "tails";
type Result = Side | null;

export default function CoinFlip() {
  const [bet, setBet] = useState("0.1");
  const [choice, setChoice] = useState<Side>("heads");
  const [flipping, setFlipping] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [won, setWon] = useState<boolean | null>(null);

  const flip = () => {
    if (flipping) return;
    setFlipping(true);
    setResult(null);
    setWon(null);
    setTimeout(() => {
      const outcome: Side = Math.random() < 0.5 ? "heads" : "tails";
      setResult(outcome);
      setWon(outcome === choice);
      setFlipping(false);
    }, 1800);
  };

  return (
    <GameLayout
      title="COIN FLIP"
      subtitle="Double or Nothing"
      bgImage={bgImage}
      accentColor="text-neon-gold"
    >
      <div className="glass rounded-2xl border border-yellow-500/20 p-6 sm:p-8 space-y-6">
        <div className="flex justify-center">
          <div className="relative w-36 h-36">
            <motion.div
              animate={flipping ? { rotateY: [0, 720, 1440] } : { rotateY: 0 }}
              transition={{ duration: 1.8, ease: "easeInOut" }}
              className="w-full h-full"
            >
              <div className="w-36 h-36 rounded-full bg-gradient-to-br from-yellow-400 via-yellow-500 to-yellow-700 flex items-center justify-center text-5xl shadow-2xl neon-gold border-4 border-yellow-300/40">
                {result === "tails" ? "🌸" : "🪙"}
              </div>
            </motion.div>
            {flipping && (
              <div className="absolute inset-0 rounded-full bg-yellow-400/10 blur-xl animate-pulse" />
            )}
          </div>
        </div>

        <AnimatePresence>
          {won !== null && !flipping && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className={`text-center py-3 px-6 rounded-xl font-cinzel font-bold text-lg tracking-widest ${
                won
                  ? "bg-green-500/20 border border-green-400/40 text-green-300"
                  : "bg-red-500/20 border border-red-400/40 text-red-300"
              }`}
              data-testid="flip-result"
            >
              {won ? "🎉 YOU WIN!" : "💀 YOU LOSE"} — {result?.toUpperCase()}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-2 gap-4">
          {(["heads", "tails"] as Side[]).map((side) => (
            <motion.button
              key={side}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setChoice(side)}
              className={`py-4 rounded-xl font-cinzel font-bold text-sm tracking-[0.15em] uppercase border transition-all duration-200 ${
                choice === side
                  ? "bg-yellow-500/20 border-yellow-400/60 text-yellow-300 neon-gold"
                  : "glass border-purple-500/30 text-purple-300 hover:border-yellow-400/30"
              }`}
              data-testid={`button-choose-${side}`}
            >
              {side === "heads" ? "🪙 Heads" : "🌸 Tails"}
            </motion.button>
          ))}
        </div>

        <div className="space-y-2">
          <label className="text-xs text-purple-300/60 tracking-widest uppercase font-medium">
            Bet Amount (ETH)
          </label>
          <input
            type="number"
            value={bet}
            onChange={(e) => setBet(e.target.value)}
            step="0.01"
            min="0.01"
            className="w-full px-4 py-3 rounded-xl glass border border-purple-500/30 text-white font-mono text-lg focus:outline-none focus:border-yellow-400/50 transition-colors"
            data-testid="input-bet-amount"
          />
          <div className="flex gap-2">
            {["0.05", "0.1", "0.5", "1"].map((v) => (
              <button
                key={v}
                onClick={() => setBet(v)}
                className="flex-1 py-1.5 rounded-lg text-xs glass border border-purple-700/30 text-purple-300 hover:border-yellow-400/30 hover:text-yellow-300 transition-colors"
                data-testid={`button-bet-preset-${v}`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <motion.button
          whileHover={{ scale: 1.03, y: -2 }}
          whileTap={{ scale: 0.97 }}
          onClick={flip}
          disabled={flipping}
          className="w-full py-5 rounded-xl font-cinzel font-bold text-base tracking-[0.2em] uppercase bg-gradient-to-r from-yellow-500 to-yellow-700 text-black neon-gold border border-yellow-400/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          data-testid="button-flip-coin"
        >
          {flipping ? "Flipping..." : "Flip Coin"}
        </motion.button>
      </div>
    </GameLayout>
  );
}
