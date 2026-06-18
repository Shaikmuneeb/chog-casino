import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import GameLayout from "@/components/GameLayout";
import bgImage from "@assets/image_1781811963908.png";

type BetType = "red" | "black" | "green" | "odd" | "even" | "1-18" | "19-36";

const RED_NUMBERS = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
const NUMBERS = Array.from({ length: 37 }, (_, i) => i);

function getColor(n: number) {
  if (n === 0) return "green";
  return RED_NUMBERS.includes(n) ? "red" : "black";
}

function getPayout(betType: BetType): number {
  if (betType === "green") return 35;
  if (["red", "black", "odd", "even", "1-18", "19-36"].includes(betType)) return 2;
  return 1;
}

function checkWin(result: number, betType: BetType): boolean {
  if (betType === "red") return getColor(result) === "red";
  if (betType === "black") return getColor(result) === "black";
  if (betType === "green") return result === 0;
  if (betType === "odd") return result !== 0 && result % 2 === 1;
  if (betType === "even") return result !== 0 && result % 2 === 0;
  if (betType === "1-18") return result >= 1 && result <= 18;
  if (betType === "19-36") return result >= 19 && result <= 36;
  return false;
}

const betOptions: { label: string; type: BetType; style: string }[] = [
  { label: "Red", type: "red", style: "bg-red-700/40 border-red-500/50 text-red-300 hover:bg-red-700/60" },
  { label: "Black", type: "black", style: "bg-gray-800/60 border-gray-600/50 text-gray-300 hover:bg-gray-700/60" },
  { label: "Green 0", type: "green", style: "bg-green-800/40 border-green-500/50 text-green-300 hover:bg-green-700/60" },
  { label: "Odd", type: "odd", style: "glass border-purple-500/40 text-purple-300 hover:border-purple-400/60" },
  { label: "Even", type: "even", style: "glass border-purple-500/40 text-purple-300 hover:border-purple-400/60" },
  { label: "1–18", type: "1-18", style: "glass border-purple-500/40 text-purple-300 hover:border-purple-400/60" },
  { label: "19–36", type: "19-36", style: "glass border-purple-500/40 text-purple-300 hover:border-purple-400/60" },
];

export default function Roulette() {
  const [bet, setBet] = useState("0.1");
  const [betType, setBetType] = useState<BetType>("red");
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<number | null>(null);
  const [won, setWon] = useState<boolean | null>(null);
  const [rotation, setRotation] = useState(0);

  const spin = () => {
    if (spinning) return;
    setSpinning(true);
    setResult(null);
    setWon(null);
    const outcome = NUMBERS[Math.floor(Math.random() * NUMBERS.length)];
    const extraSpins = 1440 + Math.floor(Math.random() * 360);
    setRotation((r) => r + extraSpins);
    setTimeout(() => {
      setResult(outcome);
      setWon(checkWin(outcome, betType));
      setSpinning(false);
    }, 2200);
  };

  const resultColor = result !== null ? getColor(result) : null;

  return (
    <GameLayout
      title="ROULETTE"
      subtitle="Spin the Wheel of Fate"
      bgImage={bgImage}
      accentColor="gradient-purple-gold"
    >
      <div className="glass rounded-2xl border border-purple-500/20 p-6 sm:p-8 space-y-6">
        <div className="flex justify-center">
          <div className="relative">
            <motion.div
              animate={{ rotate: rotation }}
              transition={{ duration: 2.2, ease: [0.25, 0.1, 0.25, 1] }}
              className="w-32 h-32 rounded-full border-4 border-yellow-400/60 neon-gold flex items-center justify-center text-4xl"
              style={{
                background: "conic-gradient(from 0deg, #7c3aed, #b45309, #7c3aed, #b45309, #7c3aed, #b45309, #7c3aed, #16a34a, #7c3aed)",
              }}
              data-testid="roulette-wheel"
            >
              🎡
            </motion.div>
            {spinning && (
              <div className="absolute inset-0 rounded-full bg-yellow-400/10 blur-xl animate-pulse" />
            )}
          </div>
        </div>

        <AnimatePresence>
          {result !== null && !spinning && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className={`text-center py-3 px-6 rounded-xl font-cinzel font-bold text-lg tracking-widest border ${
                won
                  ? "bg-green-500/20 border-green-400/40 text-green-300"
                  : "bg-red-500/20 border-red-400/40 text-red-300"
              }`}
              data-testid="roulette-result"
            >
              {won ? "🎉 WIN!" : "💀 LOSE"} — 
              <span className={`ml-2 ${resultColor === "red" ? "text-red-400" : resultColor === "black" ? "text-gray-400" : "text-green-400"}`}>
                {result} {resultColor?.toUpperCase()}
              </span>
              {won && <span className="ml-2 text-yellow-300">+{getPayout(betType)}x</span>}
            </motion.div>
          )}
        </AnimatePresence>

        <div>
          <div className="text-xs text-purple-300/60 tracking-widest uppercase font-medium mb-3">Choose Bet</div>
          <div className="grid grid-cols-4 gap-2">
            {betOptions.map((opt) => (
              <motion.button
                key={opt.type}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => setBetType(opt.type)}
                className={`py-2.5 rounded-xl text-xs font-bold tracking-widest uppercase border transition-all duration-150 ${opt.style} ${
                  betType === opt.type ? "ring-2 ring-yellow-400/50 scale-105" : ""
                }`}
                data-testid={`button-bet-${opt.type}`}
              >
                {opt.label}
              </motion.button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-purple-300/60 tracking-widest uppercase font-medium">
            Bet Amount ($CHOG)
          </label>
          <input
            type="number"
            value={bet}
            onChange={(e) => setBet(e.target.value)}
            className="w-full px-4 py-3 rounded-xl glass border border-purple-500/30 text-white font-mono text-lg focus:outline-none focus:border-yellow-400/50"
            data-testid="input-roulette-bet"
          />
        </div>

        <motion.button
          whileHover={{ scale: 1.03, y: -2 }}
          whileTap={{ scale: 0.97 }}
          onClick={spin}
          disabled={spinning}
          className="w-full py-5 rounded-xl font-cinzel font-bold text-base tracking-[0.2em] uppercase bg-gradient-to-r from-purple-600 to-purple-800 text-white neon-purple border border-purple-400/40 disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="button-spin"
        >
          {spinning ? "Spinning..." : "Spin the Wheel"}
        </motion.button>
      </div>
    </GameLayout>
  );
}
