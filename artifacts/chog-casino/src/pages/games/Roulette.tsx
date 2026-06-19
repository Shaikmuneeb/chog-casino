import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import GameLayout from "@/components/GameLayout";
import BetControls from "@/components/BetControls";
import bgImage from "@assets/image_1781811963908.png";

type BetType = "red" | "black" | "green" | "odd" | "even" | "1-18" | "19-36" | number;

const RED_NUMBERS = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
const NUMBERS = Array.from({ length: 37 }, (_, i) => i);
const STARTING_BALANCE = 10_000;

function getColor(n: number): "red" | "black" | "green" {
  if (n === 0) return "green";
  return RED_NUMBERS.includes(n) ? "red" : "black";
}

function getMultiplier(betType: BetType): number {
  if (typeof betType === "number") return 36;
  if (betType === "green") return 35;
  return 2;
}

function checkWin(result: number, betType: BetType): boolean {
  if (typeof betType === "number") return result === betType;
  if (betType === "red")   return getColor(result) === "red";
  if (betType === "black") return getColor(result) === "black";
  if (betType === "green") return result === 0;
  if (betType === "odd")   return result !== 0 && result % 2 === 1;
  if (betType === "even")  return result !== 0 && result % 2 === 0;
  if (betType === "1-18")  return result >= 1 && result <= 18;
  if (betType === "19-36") return result >= 19 && result <= 36;
  return false;
}

const outerBets: { label: string; type: BetType; cls: string }[] = [
  { label: "Red",   type: "red",   cls: "bg-red-700/40 border-red-500/50 text-red-300 hover:bg-red-700/60" },
  { label: "Black", type: "black", cls: "bg-gray-800/60 border-gray-600/50 text-gray-300 hover:bg-gray-700/60" },
  { label: "Green 0", type: "green", cls: "bg-green-800/40 border-green-500/50 text-green-300 hover:bg-green-700/60" },
  { label: "Odd",   type: "odd",   cls: "glass border-purple-500/40 text-purple-300 hover:border-purple-400/60" },
  { label: "Even",  type: "even",  cls: "glass border-purple-500/40 text-purple-300 hover:border-purple-400/60" },
  { label: "1–18",  type: "1-18",  cls: "glass border-purple-500/40 text-purple-300 hover:border-purple-400/60" },
  { label: "19–36", type: "19-36", cls: "glass border-purple-500/40 text-purple-300 hover:border-purple-400/60" },
];

function betLabel(b: BetType): string {
  if (typeof b === "number") return `#${b}`;
  return outerBets.find(o => o.type === b)?.label ?? String(b);
}

export default function Roulette() {
  const [bet, setBet] = useState(100);
  const [betType, setBetType] = useState<BetType>("red");
  const [balance, setBalance] = useState(STARTING_BALANCE);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<number | null>(null);
  const [winAmount, setWinAmount] = useState<number | null>(null);
  const [rotation, setRotation] = useState(0);
  const [showNumbers, setShowNumbers] = useState(false);

  const canSpin = !spinning && bet > 0 && bet <= balance;

  const spin = () => {
    if (!canSpin) return;
    setSpinning(true);
    setResult(null);
    setWinAmount(null);
    setBalance(b => b - bet);

    const outcome = NUMBERS[Math.floor(Math.random() * NUMBERS.length)];
    setRotation(r => r + 1440 + Math.floor(Math.random() * 360));

    setTimeout(() => {
      const won = checkWin(outcome, betType);
      const payout = won ? bet * getMultiplier(betType) : 0;
      setResult(outcome);
      setWinAmount(won ? payout : -bet);
      if (won) setBalance(b => b + payout);
      setSpinning(false);
    }, 2300);
  };

  const resultColor = result !== null ? getColor(result) : null;
  const isWin = winAmount !== null && winAmount > 0;

  return (
    <GameLayout title="ROULETTE" subtitle="Spin the Wheel of Fate" bgImage={bgImage} accentColor="gradient-purple-gold">
      <div className="glass rounded-2xl border border-purple-500/20 overflow-hidden flex flex-col">

        {/* Balance bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-purple-500/15">
          <div>
            <div className="text-[10px] text-purple-300/40 tracking-widest uppercase mb-0.5">Balance</div>
            <div className="font-cinzel font-bold text-lg text-yellow-300">
              {balance.toLocaleString()} <span className="text-xs text-yellow-400/60">$CHOG</span>
            </div>
          </div>
          <AnimatePresence>
            {winAmount !== null && !spinning && (
              <motion.div
                key={String(winAmount)}
                initial={{ opacity: 0, x: 12, scale: 0.85 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 20 }}
                className={`font-cinzel font-bold text-base tracking-wider ${isWin ? "text-green-400" : "text-red-400"}`}
              >
                {isWin ? "+" : ""}{winAmount.toLocaleString()} $CHOG
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="p-5 sm:p-6 space-y-5">
          {/* Wheel */}
          <div className="flex justify-center">
            <div className="relative">
              <motion.div
                animate={{ rotate: rotation }}
                transition={{ duration: 2.3, ease: [0.25, 0.1, 0.25, 1] }}
                className="w-32 h-32 rounded-full border-4 border-yellow-400/60 neon-gold flex items-center justify-center text-4xl"
                style={{ background: "conic-gradient(from 0deg, #7c3aed, #b45309, #7c3aed, #b45309, #7c3aed, #b45309, #7c3aed, #16a34a, #7c3aed)" }}
                data-testid="roulette-wheel"
              >
                🎡
              </motion.div>
              {spinning && <div className="absolute inset-0 rounded-full bg-yellow-400/10 blur-xl animate-pulse" />}
            </div>
          </div>

          {/* Result banner */}
          <AnimatePresence>
            {result !== null && !spinning && (
              <motion.div
                initial={{ opacity: 0, scale: 0.88, y: 4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 340, damping: 22 }}
                className={`text-center py-2.5 px-4 rounded-xl font-cinzel font-black text-sm tracking-[0.16em] uppercase border ${
                  isWin
                    ? "bg-green-500/10 border-green-400/40 text-green-300"
                    : "bg-red-500/10 border-red-400/40 text-red-300"
                }`}
                data-testid="roulette-result"
              >
                {isWin ? "WIN" : "LOSE"} —{" "}
                <span className={
                  resultColor === "red" ? "text-red-400" :
                  resultColor === "black" ? "text-gray-300" : "text-green-400"
                }>
                  {result} {resultColor?.toUpperCase()}
                </span>
                {isWin && (
                  <span className="ml-2 text-yellow-300">{getMultiplier(betType)}×</span>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Outer bet selector */}
          <div>
            <div className="text-[10px] text-purple-300/50 tracking-widest uppercase mb-2">Bet Type</div>
            <div className="grid grid-cols-4 gap-1.5">
              {outerBets.map(opt => (
                <motion.button
                  key={String(opt.type)}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => { setBetType(opt.type); setShowNumbers(false); }}
                  disabled={spinning}
                  className={`py-2 rounded-xl text-[11px] font-bold tracking-widest uppercase border transition-all duration-150 ${opt.cls} ${
                    betType === opt.type && typeof betType !== "number" ? "ring-2 ring-yellow-400/50 scale-105" : ""
                  } disabled:opacity-40`}
                  data-testid={`button-bet-${String(opt.type)}`}
                >
                  {opt.label}
                </motion.button>
              ))}
              {/* Number bet toggle */}
              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => setShowNumbers(v => !v)}
                disabled={spinning}
                className={`py-2 rounded-xl text-[11px] font-bold tracking-widest uppercase border transition-all col-span-4 ${
                  typeof betType === "number"
                    ? "bg-yellow-500/20 border-yellow-400/50 text-yellow-300 ring-2 ring-yellow-400/50"
                    : "glass border-purple-500/30 text-purple-300 hover:border-purple-400/50"
                } disabled:opacity-40`}
              >
                {typeof betType === "number" ? `Number ${betType} (36×)` : "Pick a Number (36×)"}
              </motion.button>
            </div>
          </div>

          {/* Number grid */}
          <AnimatePresence>
            {showNumbers && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.22 }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-10 gap-1 pt-1" data-testid="number-grid">
                  {NUMBERS.map(n => {
                    const col = getColor(n);
                    return (
                      <motion.button
                        key={n}
                        whileTap={{ scale: 0.88 }}
                        onClick={() => { setBetType(n); setShowNumbers(false); }}
                        disabled={spinning}
                        className={`aspect-square rounded-md text-[11px] font-bold border transition-all ${
                          betType === n
                            ? "ring-2 ring-yellow-400/70 scale-110"
                            : ""
                        } ${
                          col === "red"   ? "bg-red-800/50 border-red-600/40 text-red-200 hover:bg-red-700/60" :
                          col === "black" ? "bg-gray-800/60 border-gray-600/40 text-gray-300 hover:bg-gray-700/60" :
                                            "bg-green-800/50 border-green-600/40 text-green-200 hover:bg-green-700/60"
                        } disabled:opacity-40`}
                        data-testid={`number-${n}`}
                      >
                        {n}
                      </motion.button>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Bet amount */}
          <BetControls value={bet} onChange={setBet} max={balance} disabled={spinning} />

          {/* Spin */}
          <motion.button
            whileHover={canSpin ? { scale: 1.03, y: -2 } : {}}
            whileTap={canSpin ? { scale: 0.97 } : {}}
            onClick={spin}
            disabled={!canSpin}
            className="w-full py-4 rounded-xl font-cinzel font-black text-sm tracking-[0.22em] uppercase bg-gradient-to-r from-purple-600 to-purple-800 text-white neon-purple border border-purple-400/40 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            data-testid="button-spin"
          >
            {spinning ? "Spinning…" : `Spin — ${betLabel(betType)}`}
          </motion.button>

          {/* Reset */}
          {balance <= 0 && !spinning && (
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              onClick={() => { setBalance(STARTING_BALANCE); setResult(null); setWinAmount(null); }}
              className="w-full py-3 rounded-xl font-cinzel font-bold text-sm tracking-widest uppercase glass border border-purple-500/40 text-purple-300"
            >
              Reset Balance (10,000 $CHOG)
            </motion.button>
          )}
        </div>
      </div>
    </GameLayout>
  );
}
