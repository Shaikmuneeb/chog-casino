import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import GameLayout from "@/components/GameLayout";
import BetControls from "@/components/BetControls";
import WalletGateNotice from "@/components/WalletGateNotice";
import { useGameBalance } from "@/hooks/useGameBalance";
import bgImage from "@assets/image_1781811951344.png";
import headsImg from "@assets/chog_heads_side_1781813831765.png";
import tailsImg from "@assets/image_1781850363283.png";

type Side = "heads" | "tails";
type Phase = "idle" | "spinning" | "result";

const SPIN_DURATION = 2.0; // seconds

// ── Web Audio ─────────────────────────────────────────────────────────────────
function getCtx() {
  return new (window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
}
function playSpin() {
  try {
    const ctx = getCtx();
    for (let i = 0; i < 8; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(300 + i * 80, ctx.currentTime + i * 0.22);
      gain.gain.setValueAtTime(0.1, ctx.currentTime + i * 0.22);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.22 + 0.18);
      osc.start(ctx.currentTime + i * 0.22);
      osc.stop(ctx.currentTime + i * 0.22 + 0.2);
    }
  } catch { undefined; }
}
function playWin() {
  try {
    const ctx = getCtx();
    [523, 659, 784, 1047].forEach((f, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "sine"; osc.frequency.value = f;
      gain.gain.setValueAtTime(0.16, ctx.currentTime + i * 0.13);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.13 + 0.4);
      osc.start(ctx.currentTime + i * 0.13);
      osc.stop(ctx.currentTime + i * 0.13 + 0.45);
    });
  } catch { undefined; }
}
function playLose() {
  try {
    const ctx = getCtx();
    [330, 277, 220].forEach((f, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "sawtooth"; osc.frequency.value = f;
      gain.gain.setValueAtTime(0.1, ctx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.35);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.4);
    });
  } catch { undefined; }
}
// ─────────────────────────────────────────────────────────────────────────────

// Build scaleX keyframes that simulate many rapid flips (1→0→1 cycles)
// Last keyframe always ends on 1 so the final image shows flat.
const FLIPS = 10;
const spinKeyframes = Array.from({ length: FLIPS * 2 + 1 }, (_, i) =>
  i % 2 === 0 ? 1 : 0.04
);

export default function CoinFlip() {
  const [bet, setBet] = useState(100);
  const [choice, setChoice] = useState<Side>("heads");
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<Side | null>(null);
  const [won, setWon] = useState<boolean | null>(null);
  const { balance, updateBalance, resetBalance, gated, gateReason, showBalance, currencyLabel } = useGameBalance();
  // which image to show — alternates heads/tails on every flip so both faces are seen mid-spin
  const [displaySide, setDisplaySide] = useState<Side>("heads");
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const betAmount = bet;
  const canFlip = phase !== "spinning" && !gated && betAmount > 0 && betAmount <= balance;

  useEffect(() => {
    return () => timersRef.current.forEach(clearTimeout);
  }, []);

  const flip = useCallback(() => {
    if (!canFlip) return;

    const outcome: Side = Math.random() < 0.5 ? "heads" : "tails";
    const didWin = outcome === choice;

    setPhase("spinning");
    setResult(null);
    setWon(null);
    setDisplaySide("heads");
    playSpin();

    // The coin is edge-on (invisible) at every odd keyframe — swap the face shown at each
    // of those moments so the spin visibly alternates heads/tails, landing on the real outcome.
    const unitMs = (SPIN_DURATION * 1000) / (FLIPS * 2);
    for (let i = 1; i <= FLIPS; i++) {
      const t = (2 * i - 1) * unitMs;
      const isLast = i === FLIPS;
      timersRef.current.push(
        setTimeout(() => {
          setDisplaySide(isLast ? outcome : (prev) => (prev === "heads" ? "tails" : "heads"));
        }, t),
      );
    }

    // Reveal result
    timersRef.current.push(
      setTimeout(() => {
        setResult(outcome);
        setWon(didWin);
        updateBalance((b) => didWin ? b + betAmount : b - betAmount);
        setPhase("result");
        didWin ? playWin() : playLose();
      }, SPIN_DURATION * 1000),
    );
  }, [canFlip, choice, betAmount, updateBalance]);

  const coinImg = displaySide === "heads" ? headsImg : tailsImg;

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
          {showBalance ? (
            <div>
              <div className="text-xs text-purple-300/50 tracking-widest uppercase mb-0.5">Balance</div>
              <motion.div
                key={balance}
                initial={{ scale: 1.15 }}
                animate={{ scale: 1 }}
                className="font-cinzel font-bold text-xl text-yellow-300"
              >
                {balance.toLocaleString()} <span className="text-sm text-yellow-400/60">{currencyLabel}</span>
              </motion.div>
            </div>
          ) : <div />}
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

        {/* Coin */}
        <div className="flex flex-col items-center gap-3 py-2">
          <div className="relative" style={{ width: 200, height: 200 }}>
            {/* Glow behind coin */}
            <div
              className="absolute inset-0 rounded-full pointer-events-none"
              style={{
                background: phase === "spinning"
                  ? "radial-gradient(circle, rgba(212,175,55,0.3) 0%, transparent 70%)"
                  : won === true
                  ? "radial-gradient(circle, rgba(74,222,128,0.25) 0%, transparent 70%)"
                  : won === false
                  ? "radial-gradient(circle, rgba(248,113,113,0.2) 0%, transparent 70%)"
                  : "radial-gradient(circle, rgba(212,175,55,0.15) 0%, transparent 70%)",
                transition: "background 0.4s",
              }}
            />

            {/* The coin image — spins via scaleX */}
            <motion.img
              src={coinImg}
              alt={displaySide}
              animate={
                phase === "spinning"
                  ? {
                      scaleX: spinKeyframes,
                      filter: [
                        "brightness(1) drop-shadow(0 0 16px rgba(212,175,55,0.6))",
                        "brightness(1.4) drop-shadow(0 0 30px rgba(212,175,55,1))",
                        "brightness(1) drop-shadow(0 0 16px rgba(212,175,55,0.6))",
                      ],
                    }
                  : {
                      scaleX: 1,
                      filter:
                        won === true
                          ? "brightness(1.1) drop-shadow(0 0 24px rgba(74,222,128,0.7))"
                          : won === false
                          ? "brightness(0.9) drop-shadow(0 0 24px rgba(248,113,113,0.6))"
                          : "brightness(1) drop-shadow(0 0 18px rgba(212,175,55,0.5))",
                    }
              }
              transition={
                phase === "spinning"
                  ? {
                      scaleX: { duration: SPIN_DURATION, ease: "linear" },
                      filter: { duration: SPIN_DURATION, repeat: 0 },
                    }
                  : { duration: 0.35, ease: "easeOut" }
              }
              className="w-full h-full object-contain rounded-full"
              style={{ display: "block" }}
            />
          </div>

          {/* Result label — appears below coin after landing */}
          <div style={{ minHeight: 52 }} className="flex flex-col items-center justify-center">
            <AnimatePresence mode="wait">
              {phase === "result" && result && (
                <motion.div
                  key={result}
                  initial={{ opacity: 0, y: 10, scale: 0.85 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ type: "spring", stiffness: 380, damping: 22 }}
                  className="text-center"
                  data-testid="flip-result"
                >
                  <div
                    className={`font-cinzel font-black text-3xl tracking-[0.35em] uppercase ${
                      result === "heads" ? "text-yellow-300" : "text-purple-300"
                    }`}
                    style={{
                      textShadow:
                        result === "heads"
                          ? "0 0 24px rgba(212,175,55,0.9), 0 0 48px rgba(212,175,55,0.4)"
                          : "0 0 24px rgba(160,80,255,0.9), 0 0 48px rgba(160,80,255,0.4)",
                    }}
                  >
                    {result === "heads" ? "HEADS" : "TAILS"}
                  </div>
                </motion.div>
              )}
              {phase === "spinning" && (
                <motion.div
                  key="spinning"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0.4, 0.9, 0.4] }}
                  transition={{ duration: 0.7, repeat: Infinity }}
                  className="font-cinzel text-sm tracking-[0.3em] text-yellow-400/70 uppercase"
                >
                  Flipping…
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Heads / Tails selector */}
        <div className="grid grid-cols-2 gap-3">
          {(["heads", "tails"] as Side[]).map((side) => (
            <motion.button
              key={side}
              whileHover={phase !== "spinning" ? { scale: 1.04, y: -1 } : {}}
              whileTap={phase !== "spinning" ? { scale: 0.96 } : {}}
              onClick={() => phase !== "spinning" && setChoice(side)}
              disabled={phase === "spinning"}
              className={`flex items-center justify-center gap-3 py-3 px-4 rounded-xl font-cinzel font-bold text-sm tracking-[0.12em] uppercase border transition-all duration-200 ${
                choice === side
                  ? "bg-yellow-500/20 border-yellow-400/60 text-yellow-300 neon-gold"
                  : "glass border-purple-500/30 text-purple-300 hover:border-yellow-400/30"
              } disabled:opacity-50`}
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

        {/* Bet controls */}
        <BetControls value={bet} onChange={setBet} max={balance} disabled={phase === "spinning"} />

        {/* Real mode: connect wallet / deposit gate */}
        {gated && <WalletGateNotice reason={gateReason} />}

        {/* Primary action */}
        {!gated && (
          <motion.button
            whileHover={canFlip ? { scale: 1.03, y: -2 } : {}}
            whileTap={canFlip ? { scale: 0.97 } : {}}
            onClick={flip}
            disabled={!canFlip}
            className="w-full py-5 rounded-xl font-cinzel font-black text-base tracking-[0.25em] uppercase bg-gradient-to-r from-yellow-500 to-yellow-700 text-black neon-gold border border-yellow-400/40 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            data-testid="button-flip-coin"
          >
            {phase === "spinning" ? "Flipping…" : balance <= 0 ? `Out of ${currencyLabel}` : "Bet"}
          </motion.button>
        )}

        {balance <= 0 && phase !== "spinning" && !gated && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            onClick={() => { resetBalance(); setResult(null); setWon(null); }}
            className="w-full py-3 rounded-xl font-cinzel font-bold text-sm tracking-widest uppercase glass border border-purple-500/40 text-purple-300"
            data-testid="button-reset-balance"
          >
            Reset Balance
          </motion.button>
        )}
      </div>
    </GameLayout>
  );
}
