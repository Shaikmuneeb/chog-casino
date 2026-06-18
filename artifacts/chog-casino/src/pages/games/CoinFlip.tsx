import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import GameLayout from "@/components/GameLayout";
import bgImage from "@assets/image_1781811951344.png";
import headsImg from "@assets/chog_heads_side_1781813831765.png";
import tailsImg from "@assets/chog_tails_side_1781813835529.png";

type Side = "heads" | "tails";

const STARTING_BALANCE = 10_000;
const FLIP_DURATION = 1.6;

export default function CoinFlip() {
  const [bet, setBet] = useState("100");
  const [choice, setChoice] = useState<Side>("heads");
  const [flipping, setFlipping] = useState(false);
  const [result, setResult] = useState<Side | null>(null);
  const [won, setWon] = useState<boolean | null>(null);
  const [balance, setBalance] = useState(STARTING_BALANCE);
  const [coinRotation, setCoinRotation] = useState(0);
  const outcomeRef = useRef<Side>("heads");

  const flip = () => {
    const betAmount = parseInt(bet) || 0;
    if (flipping || betAmount <= 0 || betAmount > balance) return;

    setFlipping(true);
    setResult(null);
    setWon(null);

    const outcome: Side = Math.random() < 0.5 ? "heads" : "tails";
    outcomeRef.current = outcome;

    // Spin 4 full rotations (1440°) + land on correct face
    // heads = even multiples of 360 (0, 360, 720…) → rotateY ends at 0 mod 360
    // tails = odd multiples of 180 (180, 540, 900…) → rotateY ends at 180 mod 360
    const spins = 1440;
    const landOffset = outcome === "heads" ? 0 : 180;
    const current = coinRotation % 360;
    const needed = landOffset;
    const delta = ((needed - current) + 360) % 360 || 360;
    const finalRotation = coinRotation + spins + delta;

    setCoinRotation(finalRotation);

    setTimeout(() => {
      setResult(outcome);
      setWon(outcome === choice);
      setBalance((b) => outcome === choice ? b + betAmount : b - betAmount);
      setFlipping(false);
    }, FLIP_DURATION * 1000);
  };

  const betAmount = parseInt(bet) || 0;
  const canFlip = !flipping && betAmount > 0 && betAmount <= balance;

  // Which face is showing right now based on rotation
  const normalizedRot = coinRotation % 360;
  const showingFace: Side = (normalizedRot >= 90 && normalizedRot < 270) ? "tails" : "heads";

  return (
    <GameLayout
      title="COIN FLIP"
      subtitle="Double or Nothing"
      bgImage={bgImage}
      accentColor="text-neon-gold"
    >
      <div className="glass rounded-2xl border border-yellow-500/20 p-6 sm:p-8 space-y-6">

        {/* Balance */}
        <div className="flex items-center justify-between px-1">
          <div>
            <div className="text-xs text-purple-300/50 tracking-widest uppercase mb-0.5">Balance</div>
            <div className="font-cinzel font-bold text-xl text-yellow-300">
              {balance.toLocaleString()} <span className="text-sm text-yellow-400/70">$CHOG</span>
            </div>
          </div>
          {won !== null && !flipping && (
            <motion.div
              key={String(won)}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className={`font-cinzel font-bold text-sm tracking-widest ${won ? "text-green-400" : "text-red-400"}`}
            >
              {won ? `+${betAmount.toLocaleString()}` : `-${betAmount.toLocaleString()}`} $CHOG
            </motion.div>
          )}
        </div>

        {/* 3D Coin */}
        <div className="flex justify-center py-4">
          <div className="relative" style={{ perspective: "600px" }}>
            <motion.div
              animate={{ rotateY: coinRotation }}
              transition={{ duration: FLIP_DURATION, ease: [0.25, 0.1, 0.25, 1] }}
              style={{ transformStyle: "preserve-3d", width: 180, height: 180, position: "relative" }}
            >
              {/* Heads face — front */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  backfaceVisibility: "hidden",
                  WebkitBackfaceVisibility: "hidden",
                }}
              >
                <img
                  src={headsImg}
                  alt="Heads"
                  className="w-full h-full rounded-full object-cover"
                  style={{ filter: "drop-shadow(0 0 24px rgba(212,175,55,0.7))" }}
                />
              </div>

              {/* Tails face — back */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  backfaceVisibility: "hidden",
                  WebkitBackfaceVisibility: "hidden",
                  transform: "rotateY(180deg)",
                }}
              >
                <img
                  src={tailsImg}
                  alt="Tails"
                  className="w-full h-full rounded-full object-cover"
                  style={{ filter: "drop-shadow(0 0 24px rgba(160,80,255,0.7))" }}
                />
              </div>
            </motion.div>

            {/* Glow pulse while flipping */}
            {flipping && (
              <div className="absolute inset-0 rounded-full bg-yellow-400/15 blur-2xl animate-pulse pointer-events-none" />
            )}
          </div>
        </div>

        {/* Result banner */}
        <AnimatePresence mode="wait">
          {won !== null && !flipping && (
            <motion.div
              key={String(won)}
              initial={{ opacity: 0, scale: 0.85, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.3 }}
              className={`text-center py-3 px-6 rounded-xl font-cinzel font-bold text-lg tracking-widest border ${
                won
                  ? "bg-green-500/20 border-green-400/40 text-green-300"
                  : "bg-red-500/20 border-red-400/40 text-red-300"
              }`}
              data-testid="flip-result"
            >
              {won ? "🎉 YOU WIN!" : "💀 YOU LOSE"} — {result?.toUpperCase()}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Heads / Tails selector — now with coin images */}
        <div className="grid grid-cols-2 gap-4">
          {(["heads", "tails"] as Side[]).map((side) => (
            <motion.button
              key={side}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => !flipping && setChoice(side)}
              disabled={flipping}
              className={`flex items-center justify-center gap-3 py-3 px-4 rounded-xl font-cinzel font-bold text-sm tracking-[0.15em] uppercase border transition-all duration-200 ${
                choice === side
                  ? "bg-yellow-500/20 border-yellow-400/60 text-yellow-300 neon-gold"
                  : "glass border-purple-500/30 text-purple-300 hover:border-yellow-400/30"
              }`}
              data-testid={`button-choose-${side}`}
            >
              <img
                src={side === "heads" ? headsImg : tailsImg}
                alt={side}
                className="w-8 h-8 rounded-full object-cover"
              />
              {side === "heads" ? "Heads" : "Tails"}
            </motion.button>
          ))}
        </div>

        {/* Bet input */}
        <div className="space-y-2">
          <label className="text-xs text-purple-300/60 tracking-widest uppercase font-medium">
            Bet Amount ($CHOG)
          </label>
          <input
            type="number"
            value={bet}
            onChange={(e) => setBet(e.target.value)}
            step="1"
            min="1"
            max={balance}
            className="w-full px-4 py-3 rounded-xl glass border border-purple-500/30 text-white font-mono text-lg focus:outline-none focus:border-yellow-400/50 transition-colors"
            data-testid="input-bet-amount"
          />
          <div className="flex gap-2">
            {["500", "1000", "2000", "5000"].map((v) => (
              <button
                key={v}
                onClick={() => setBet(v)}
                disabled={flipping}
                className="flex-1 py-1.5 rounded-lg text-xs glass border border-purple-700/30 text-purple-300 hover:border-yellow-400/30 hover:text-yellow-300 transition-colors disabled:opacity-40"
                data-testid={`button-bet-preset-${v}`}
              >
                {v}
              </button>
            ))}
            <button
              onClick={() => setBet(String(balance))}
              disabled={flipping}
              className="flex-1 py-1.5 rounded-lg text-xs glass border border-yellow-600/40 text-yellow-400 hover:border-yellow-400/60 transition-colors disabled:opacity-40"
              data-testid="button-bet-max"
            >
              MAX
            </button>
          </div>
        </div>

        {/* Flip button */}
        <motion.button
          whileHover={canFlip ? { scale: 1.03, y: -2 } : {}}
          whileTap={canFlip ? { scale: 0.97 } : {}}
          onClick={flip}
          disabled={!canFlip}
          className="w-full py-5 rounded-xl font-cinzel font-black text-base tracking-[0.25em] uppercase bg-gradient-to-r from-yellow-500 to-yellow-700 text-black neon-gold border border-yellow-400/40 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          data-testid="button-flip-coin"
        >
          {flipping ? "Flipping..." : balance <= 0 ? "Out of $CHOG" : "Flip Coin"}
        </motion.button>

        {/* Reset balance */}
        {balance <= 0 && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            onClick={() => { setBalance(STARTING_BALANCE); setResult(null); setWon(null); }}
            className="w-full py-3 rounded-xl font-cinzel font-bold text-sm tracking-widest uppercase glass border border-purple-500/40 text-purple-300"
            data-testid="button-reset-balance"
          >
            Reset Balance (10,000 $CHOG)
          </motion.button>
        )}
      </div>
    </GameLayout>
  );
}
