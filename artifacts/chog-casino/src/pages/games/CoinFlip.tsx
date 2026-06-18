import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import GameLayout from "@/components/GameLayout";
import bgImage from "@assets/image_1781811951344.png";
import headsImg from "@assets/chog_heads_side_1781813831765.png";
import tailsImg from "@assets/chog_tails_side_1781813835529.png";

type Side = "heads" | "tails";
type Phase = "idle" | "spinning" | "result";

const STARTING_BALANCE = 10_000;
const FLIP_DURATION = 2.2;

// ── Web Audio helpers ─────────────────────────────────────────────────────────
function getAudioCtx() {
  if (typeof window === "undefined") return null;
  return new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
}

function playSpin() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  for (let i = 0; i < 8; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(300 + i * 80, ctx.currentTime + i * 0.22);
    gain.gain.setValueAtTime(0.12, ctx.currentTime + i * 0.22);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.22 + 0.18);
    osc.start(ctx.currentTime + i * 0.22);
    osc.stop(ctx.currentTime + i * 0.22 + 0.2);
  }
}

function playWin() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const notes = [523, 659, 784, 1047];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.18, ctx.currentTime + i * 0.13);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.13 + 0.4);
    osc.start(ctx.currentTime + i * 0.13);
    osc.stop(ctx.currentTime + i * 0.13 + 0.45);
  });
}

function playLose() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const notes = [330, 277, 220];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.12, ctx.currentTime + i * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.35);
    osc.start(ctx.currentTime + i * 0.18);
    osc.stop(ctx.currentTime + i * 0.18 + 0.4);
  });
}
// ─────────────────────────────────────────────────────────────────────────────

export default function CoinFlip() {
  const [bet, setBet] = useState("100");
  const [choice, setChoice] = useState<Side>("heads");
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<Side | null>(null);
  const [won, setWon] = useState<boolean | null>(null);
  const [balance, setBalance] = useState(STARTING_BALANCE);
  const [coinRotation, setCoinRotation] = useState(0);
  const [showReaction, setShowReaction] = useState(false);

  const betAmount = parseInt(bet) || 0;
  const canFlip = phase === "idle" && betAmount > 0 && betAmount <= balance;

  const flip = useCallback(() => {
    if (!canFlip) return;

    setPhase("spinning");
    setResult(null);
    setWon(null);
    setShowReaction(false);
    playSpin();

    const outcome: Side = Math.random() < 0.5 ? "heads" : "tails";

    // 5 full spins + land on correct face
    const spins = 1800;
    const landOffset = outcome === "heads" ? 0 : 180;
    const current = coinRotation % 360;
    const delta = ((landOffset - current) + 360) % 360 || 360;
    setCoinRotation(coinRotation + spins + delta);

    setTimeout(() => {
      const didWin = outcome === choice;
      setResult(outcome);
      setWon(didWin);
      setBalance((b) => didWin ? b + betAmount : b - betAmount);
      setPhase("result");
      setShowReaction(true);
      didWin ? playWin() : playLose();
    }, FLIP_DURATION * 1000);
  }, [canFlip, coinRotation, choice, betAmount]);

  const reset = () => {
    setPhase("idle");
    setResult(null);
    setWon(null);
    setShowReaction(false);
  };

  return (
    <GameLayout
      title="COIN FLIP"
      subtitle="Double or Nothing"
      bgImage={bgImage}
      accentColor="text-neon-gold"
    >
      <div className="glass rounded-2xl border border-yellow-500/20 p-6 sm:p-8 space-y-5">

        {/* Balance row */}
        <div className="flex items-center justify-between px-1">
          <div>
            <div className="text-xs text-purple-300/50 tracking-widest uppercase mb-0.5">Balance</div>
            <motion.div
              key={balance}
              initial={{ scale: 1.15 }}
              animate={{ scale: 1 }}
              className="font-cinzel font-bold text-xl text-yellow-300"
            >
              {balance.toLocaleString()} <span className="text-sm text-yellow-400/60">$CHOG</span>
            </motion.div>
          </div>
          <AnimatePresence mode="wait">
            {won !== null && phase === "result" && (
              <motion.div
                key={String(won) + betAmount}
                initial={{ opacity: 0, x: 16, scale: 0.8 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 20 }}
                className={`font-cinzel font-bold text-base tracking-wider ${won ? "text-green-400" : "text-red-400"}`}
              >
                {won ? "+" : "-"}{betAmount.toLocaleString()} $CHOG
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Coin + Reaction */}
        <div className="flex justify-center py-2 relative" style={{ minHeight: 220 }}>
          {/* 3D coin */}
          <div style={{ perspective: "700px" }}>
            <motion.div
              animate={{
                rotateY: coinRotation,
                scale: phase === "spinning" ? [1, 1.08, 1.05, 1.08, 1] : 1,
              }}
              transition={{
                rotateY: {
                  duration: FLIP_DURATION,
                  ease: [0.22, 1, 0.36, 1],
                },
                scale: {
                  duration: FLIP_DURATION,
                  times: [0, 0.2, 0.5, 0.8, 1],
                  ease: "easeInOut",
                },
              }}
              style={{
                transformStyle: "preserve-3d",
                width: 200,
                height: 200,
                position: "relative",
                filter: phase === "spinning"
                  ? "drop-shadow(0 0 32px rgba(212,175,55,0.9))"
                  : won === true
                  ? "drop-shadow(0 0 28px rgba(74,222,128,0.8))"
                  : won === false
                  ? "drop-shadow(0 0 28px rgba(248,113,113,0.7))"
                  : "drop-shadow(0 0 20px rgba(212,175,55,0.5))",
              }}
            >
              {/* Heads — front */}
              <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}>
                <img src={headsImg} alt="Heads" className="w-full h-full rounded-full object-cover" />
              </div>
              {/* Tails — back */}
              <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
                <img src={tailsImg} alt="Tails" className="w-full h-full rounded-full object-cover" />
              </div>
            </motion.div>

            {/* Spin glow ring */}
            <AnimatePresence>
              {phase === "spinning" && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: [0.4, 0.8, 0.4], scale: [1, 1.15, 1] }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.8, repeat: Infinity }}
                  className="absolute inset-0 rounded-full pointer-events-none"
                  style={{ boxShadow: "0 0 60px 20px rgba(212,175,55,0.35)", borderRadius: "50%" }}
                />
              )}
            </AnimatePresence>
          </div>

        </div>

        {/* Result pill */}
        <AnimatePresence mode="wait">
          {phase === "result" && result && (
            <motion.div
              key={result + String(won)}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, delay: 0.15 }}
              className={`text-center py-2.5 rounded-xl font-cinzel font-bold text-sm tracking-[0.2em] uppercase border ${
                won
                  ? "bg-green-500/15 border-green-400/30 text-green-300"
                  : "bg-red-500/15 border-red-400/30 text-red-300"
              }`}
              data-testid="flip-result"
            >
              Landed on {result.toUpperCase()} · {won ? `+${betAmount.toLocaleString()}` : `-${betAmount.toLocaleString()}`} $CHOG
            </motion.div>
          )}
        </AnimatePresence>

        {/* Side selector */}
        <div className="grid grid-cols-2 gap-3">
          {(["heads", "tails"] as Side[]).map((side) => (
            <motion.button
              key={side}
              whileHover={phase === "idle" ? { scale: 1.04, y: -1 } : {}}
              whileTap={phase === "idle" ? { scale: 0.96 } : {}}
              onClick={() => phase === "idle" && setChoice(side)}
              disabled={phase !== "idle"}
              className={`flex items-center justify-center gap-3 py-3 px-4 rounded-xl font-cinzel font-bold text-sm tracking-[0.12em] uppercase border transition-all duration-200 ${
                choice === side
                  ? "bg-yellow-500/20 border-yellow-400/60 text-yellow-300 neon-gold"
                  : "glass border-purple-500/30 text-purple-300 hover:border-yellow-400/30"
              } disabled:opacity-50`}
              data-testid={`button-choose-${side}`}
            >
              <img src={side === "heads" ? headsImg : tailsImg} alt={side} className="w-8 h-8 rounded-full object-cover" />
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
            disabled={phase !== "idle"}
            className="w-full px-4 py-3 rounded-xl glass border border-purple-500/30 text-white font-mono text-lg focus:outline-none focus:border-yellow-400/50 transition-colors disabled:opacity-50"
            data-testid="input-bet-amount"
          />
          <div className="flex gap-2">
            {["500", "1000", "2000", "5000"].map((v) => (
              <button
                key={v}
                onClick={() => setBet(v)}
                disabled={phase !== "idle"}
                className="flex-1 py-1.5 rounded-lg text-xs glass border border-purple-700/30 text-purple-300 hover:border-yellow-400/30 hover:text-yellow-300 transition-colors disabled:opacity-40"
                data-testid={`button-bet-preset-${v}`}
              >
                {v}
              </button>
            ))}
            <button
              onClick={() => setBet(String(balance))}
              disabled={phase !== "idle"}
              className="flex-1 py-1.5 rounded-lg text-xs glass border border-yellow-600/40 text-yellow-400 hover:border-yellow-400/60 transition-colors disabled:opacity-40"
              data-testid="button-bet-max"
            >
              MAX
            </button>
          </div>
        </div>

        {/* Primary action button */}
        {phase !== "result" ? (
          <motion.button
            whileHover={canFlip ? { scale: 1.03, y: -2 } : {}}
            whileTap={canFlip ? { scale: 0.97 } : {}}
            onClick={flip}
            disabled={!canFlip}
            className="w-full py-5 rounded-xl font-cinzel font-black text-base tracking-[0.25em] uppercase bg-gradient-to-r from-yellow-500 to-yellow-700 text-black neon-gold border border-yellow-400/40 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            data-testid="button-flip-coin"
          >
            {phase === "spinning"
              ? "Flipping..."
              : balance <= 0
              ? "Out of $CHOG"
              : "Flip Coin"}
          </motion.button>
        ) : (
          <motion.button
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ scale: 1.03, y: -2 }}
            whileTap={{ scale: 0.97 }}
            onClick={reset}
            className="w-full py-5 rounded-xl font-cinzel font-black text-base tracking-[0.25em] uppercase bg-gradient-to-r from-purple-600 to-purple-800 text-white neon-purple border border-purple-400/40 transition-all"
            data-testid="button-flip-again"
          >
            Flip Again
          </motion.button>
        )}

        {balance <= 0 && phase === "idle" && (
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
