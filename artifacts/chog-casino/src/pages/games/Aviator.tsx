import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import GameLayout from "@/components/GameLayout";
import BetControls from "@/components/BetControls";
import WalletGateNotice from "@/components/WalletGateNotice";
import { useGameBalance } from "@/hooks/useGameBalance";
import bgImage from "@assets/image_1781811777784.png";
import aviatorBanner from "@assets/aviator/aviator-banner.png";
import aviatorBg from "@assets/aviator/aviator-bg.png";
import aviatorPlane from "@assets/aviator/aviator-plane.png";

/**
 * Provably-Fair Crash Algorithm
 * =============================
 * 1. Generate a random 32-byte hex string as the server seed.
 * 2. Hash the server seed with SHA-256 (the "commitment").
 * 3. At reveal time, convert the first 8 hex characters of the raw hash
 *    to a 32-bit unsigned integer `d`.
 * 4. If d % 33 === 0 the round instantly crashes at 1.00×
 *    (gives a ~3.03 % house edge — standard for crash games).
 * 5. Otherwise:  crashPoint = floor((2^32 / (d + 1)) * 100) / 100
 * 6. Cap the result between 1.00× and 100×.
 *
 * Because the seed is committed (hashed) before the round starts the
 * outcome cannot be changed mid-flight.  A client seed can be mixed in
 * for extra verifiability once a real server is wired up.
 */

function generateSeed(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function computeCrashPoint(seed: string): Promise<number> {
  const hash = await sha256hex(seed);
  const d = parseInt(hash.substring(0, 8), 16);
  if (d % 33 === 0) return 1.0;
  const raw = (0xffffffff / (d + 1)) * 100;
  const crashPoint = Math.floor(raw) / 100;
  return Math.max(1.0, Math.min(crashPoint, 100));
}

const BETTING_DURATION = 5000;
const WAITING_DURATION = 3000;
const MAX_HISTORY = 15;

function getMultiplierColor(m: number): string {
  if (m >= 3) return "text-green-400";
  if (m >= 2) return "text-yellow-300";
  if (m >= 1.5) return "text-orange-400";
  return "text-red-400";
}

function getMultiplierBg(m: number): string {
  if (m >= 3) return "bg-green-500/20 border-green-500/40 text-green-300";
  if (m >= 2) return "bg-yellow-500/20 border-yellow-500/40 text-yellow-300";
  if (m >= 1.5) return "bg-orange-500/20 border-orange-500/40 text-orange-300";
  return "bg-red-500/20 border-red-500/40 text-red-300";
}

type Phase = "waiting" | "betting" | "flying" | "crashed" | "cashed";

export default function Aviator() {
  const [bet, setBet] = useState(100);
  const {
    balance,
    updateBalance,
    resetBalance,
    gated,
    gateReason,
    showBalance,
    currencyLabel,
  } = useGameBalance();

  const [phase, setPhase] = useState<Phase>("waiting");
  const [countdown, setCountdown] = useState(0);
  const [multiplier, setMultiplier] = useState(1.0);
  const [crashPoint, setCrashPoint] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [resultMsg, setResultMsg] = useState<{ text: string; cls: string } | null>(null);
  const [betPlaced, setBetPlaced] = useState(false);

  const multiplierRef = useRef(1.0);
  const betPlacedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rafRef = useRef<number | null>(null);

  const canPlaceBet =
    (phase === "waiting" || phase === "betting") && !gated && bet > 0 && bet <= balance;

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const startBetting = useCallback(
    async () => {
      clearTimers();
      const seed = generateSeed();
      const cp = await computeCrashPoint(seed);
      setCrashPoint(cp);
      setMultiplier(1.0);
      multiplierRef.current = 1.0;
      betPlacedRef.current = false;
      setBetPlaced(false);
      setResultMsg(null);
      setPhase("betting");
      setCountdown(Math.ceil(BETTING_DURATION / 1000));

      let remaining = BETTING_DURATION;
      const tickMs = 100;
      const countdownTick = setInterval(() => {
        remaining -= tickMs;
        setCountdown(Math.max(0, Math.ceil(remaining / 1000)));
      }, tickMs);

      timerRef.current = setTimeout(() => {
        clearInterval(countdownTick);
        startFlying(cp);
      }, BETTING_DURATION);

      tickRef.current = countdownTick;
    },
    [clearTimers],
  );

  const startFlying = useCallback(
    (cp: number) => {
      setPhase("flying");
      setCountdown(0);
      multiplierRef.current = 1.0;
      setMultiplier(1.0);
      const startTime = performance.now();

      // 60fps loop — buttery-smooth multiplier + plane, like a real crash game.
      const loop = (now: number) => {
        const elapsed = (now - startTime) / 1000;
        const raw = Math.pow(Math.E, elapsed * 0.18);

        if (raw >= cp) {
          multiplierRef.current = cp;
          setMultiplier(cp);
          setPhase("crashed");
          setHistory((prev) => [cp, ...prev].slice(0, MAX_HISTORY));
          setResultMsg(
            betPlacedRef.current
              ? { text: `CRASHED at ${cp.toFixed(2)}×  — You lost!`, cls: "text-red-400" }
              : { text: `Crashed at ${cp.toFixed(2)}×`, cls: "text-red-400" },
          );
          rafRef.current = null;
          timerRef.current = setTimeout(() => startBetting(), WAITING_DURATION);
          return;
        }

        multiplierRef.current = raw;
        setMultiplier(raw);
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    },
    [startBetting],
  );

  useEffect(() => {
    startBetting();
    return clearTimers;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const placeBet = useCallback(() => {
    if (!canPlaceBet || betPlaced) return;
    updateBalance((b) => b - bet);
    betPlacedRef.current = true;
    setBetPlaced(true);
  }, [canPlaceBet, betPlaced, bet, updateBalance]);

  const cashOut = useCallback(() => {
    if (phase !== "flying" || !betPlaced) return;
    clearTimers();
    const payout = Math.round(bet * multiplierRef.current);
    updateBalance((b) => b + payout);
    setPhase("cashed");
    setResultMsg({
      text: `Cashed out at ${multiplierRef.current.toFixed(2)}×  +${payout.toLocaleString()} ${currencyLabel}`,
      cls: "text-green-400",
    });
    timerRef.current = setTimeout(() => {
      startBetting();
    }, WAITING_DURATION);
  }, [phase, betPlaced, bet, clearTimers, updateBalance, currencyLabel, startBetting]);

  const showPlane = phase === "flying" || phase === "cashed";

  // Climb is driven purely by the LIVE multiplier (not the hidden crash point), so the
  // plane always takes off, arcs up quickly, then hovers near the top — like real Aviator.
  // 1x → 0, 2x → 0.57, 3x → 0.81, 5x → 0.97, then asymptotes toward the hover zone.
  const climb = showPlane ? 1 - Math.exp(-0.85 * (multiplier - 1)) : 0;
  const planeLeft = 8 + climb * 60; // 8% → 68%
  const planeBottom = 14 + climb * 50; // 14% → 64%
  const planeRotation = -6 - climb * 16; // nose-up: -6° → -22°

  return (
    <GameLayout
      title="AVIATOR"
      subtitle="Cash Out Before It Crashes"
      bgImage={bgImage}
      accentColor="text-cyan-400"
    >
      {/* Banner header */}
      <div className="relative w-full max-w-2xl mx-auto mb-4">
        <img
          src={aviatorBanner}
          alt="Chog Aviator"
          className="w-full h-auto rounded-xl object-contain max-h-48"
          data-testid="aviator-banner"
        />
      </div>

      <div className="glass rounded-2xl border border-cyan-500/20 overflow-hidden">
        {/* History strip */}
        <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-cyan-500/15 overflow-x-auto">
          <span className="text-[10px] text-purple-300/40 tracking-widest uppercase shrink-0 mr-1">
            History
          </span>
          {history.length === 0 && (
            <span className="text-[10px] text-purple-300/30">No rounds yet</span>
          )}
          {history.map((m, i) => (
            <motion.span
              key={`${m}-${i}`}
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              className={`px-2 py-0.5 rounded-full text-[11px] font-cinzel font-bold border shrink-0 ${getMultiplierBg(m)}`}
            >
              {m.toFixed(2)}×
            </motion.span>
          ))}
        </div>

        {/* Flight area with background image */}
        <div
          className="relative px-4 sm:px-6 py-6 overflow-hidden"
          style={{
            backgroundImage: `url(${aviatorBg})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            minHeight: 320,
          }}
        >
          {/* Dark overlay for readability */}
          <div className="absolute inset-0 bg-black/55" />

          <div className="relative z-10">
            {/* Multiplier display */}
            <div className="text-center mb-4">
              <AnimatePresence mode="wait">
                <motion.div
                  key={phase === "flying" ? "flying" : `${phase}-${countdown}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  {phase === "flying" || phase === "cashed" || phase === "crashed" ? (
                    <span
                      className={`font-cinzel font-black text-6xl sm:text-7xl tracking-wider ${getMultiplierColor(multiplier)}`}
                      style={{
                        textShadow:
                          phase === "flying"
                            ? `0 0 30px ${multiplier >= 2 ? "rgba(74,222,128,0.6)" : "rgba(212,175,55,0.6)"}`
                            : "none",
                      }}
                    >
                      {multiplier.toFixed(2)}×
                    </span>
                  ) : (
                    <span className="font-cinzel font-black text-6xl sm:text-7xl tracking-wider text-purple-400">
                      {countdown > 0 ? countdown : "—"}
                    </span>
                  )}
                </motion.div>
              </AnimatePresence>

              {phase === "waiting" && (
                <p className="text-purple-300/50 text-sm tracking-widest uppercase mt-2">
                  Next round starting...
                </p>
              )}
              {phase === "betting" && !betPlaced && (
                <p className="text-cyan-300/70 text-sm tracking-widest uppercase mt-2 animate-pulse">
                  Place your bet!
                </p>
              )}
              {phase === "flying" && (
                <p className="text-yellow-300/70 text-sm tracking-widest uppercase mt-2">
                  Cash out anytime!
                </p>
              )}
            </div>

            {/* Flight area with plane */}
            <div
              className="relative w-full max-w-lg mx-auto"
              style={{ height: 260 }}
              data-testid="aviator-flight-area"
            >
              {/* Single clean plane: climbs with the multiplier, hovers and bobs, flies off on crash */}
              <motion.div
                className="absolute z-10"
                initial={{ left: "8%", bottom: "14%", opacity: 0, scale: 0.5, rotate: -6, x: "-50%", y: "50%" }}
                animate={
                  phase === "crashed"
                    ? { left: "118%", bottom: "98%", opacity: 0, scale: 0.25, rotate: -55, x: "-50%", y: "50%" }
                    : showPlane
                    ? { left: `${planeLeft}%`, bottom: `${planeBottom}%`, opacity: 1, scale: 1, rotate: planeRotation, x: "-50%", y: "50%" }
                    : { left: "8%", bottom: "14%", opacity: 0, scale: 0.5, rotate: -6, x: "-50%", y: "50%" }
                }
                transition={
                  phase === "crashed"
                    ? { duration: 0.55, ease: "easeIn" }
                    : {
                        left: { duration: 0.15, ease: "linear" },
                        bottom: { duration: 0.15, ease: "linear" },
                        rotate: { duration: 0.2, ease: "linear" },
                        opacity: { duration: 0.3 },
                        scale: { duration: 0.3 },
                      }
                }
              >
                {/* Gentle hover bob on top of the climb */}
                <motion.img
                  src={aviatorPlane}
                  alt="Aviator plane"
                  data-testid="aviator-plane"
                  className="drop-shadow-[0_0_22px_rgba(168,85,247,0.55)]"
                  style={{ width: 96, height: "auto", display: "block" }}
                  animate={phase === "flying" ? { y: [0, -6, 0, 6, 0] } : { y: 0 }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                />
              </motion.div>

              {/* Crash explosion effect */}
              <AnimatePresence>
                {phase === "crashed" && (
                  <motion.div
                    key="crash"
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: [0, 1.5, 1] }}
                    exit={{ opacity: 0, scale: 2 }}
                    transition={{ duration: 0.4 }}
                    className="absolute z-20"
                    style={{
                      left: `${planeLeft}%`,
                      bottom: `${planeBottom}%`,
                      transform: "translate(-50%, 50%)",
                    }}
                  >
                    <div className="relative">
                      <div className="absolute inset-0 rounded-full bg-red-500/40 blur-xl w-16 h-16 -translate-x-1/2 -translate-y-1/2" />
                      <span className="text-4xl relative z-10">💥</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Cash out success effect */}
              <AnimatePresence>
                {phase === "cashed" && (
                  <motion.div
                    key="cashout"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 15 }}
                    className="absolute z-20"
                    style={{
                      left: `${planeLeft}%`,
                      bottom: `${planeBottom}%`,
                      transform: "translate(-50%, 50%)",
                    }}
                  >
                    <div className="relative">
                      <div className="absolute inset-0 rounded-full bg-green-500/30 blur-xl w-14 h-14 -translate-x-1/2 -translate-y-1/2" />
                      <span className="text-3xl relative z-10">✅</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Result message */}
            <div className="text-center mt-4" style={{ minHeight: 36 }}>
              <AnimatePresence mode="wait">
                {resultMsg && (
                  <motion.div
                    key={resultMsg.text}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ type: "spring", stiffness: 400, damping: 20 }}
                    className={`font-cinzel font-bold text-sm tracking-wider ${resultMsg.cls}`}
                    data-testid="aviator-result"
                  >
                    {resultMsg.text}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="px-4 sm:px-6 pb-5 space-y-3 border-t border-cyan-500/10 pt-4">
          {showBalance && (
            <div className="flex items-center justify-between px-1">
              <div className="text-[10px] text-purple-300/40 tracking-widest uppercase">
                Balance
              </div>
              <motion.div
                key={balance}
                initial={{ scale: 1.1 }}
                animate={{ scale: 1 }}
                className="font-cinzel font-bold text-lg text-yellow-300"
              >
                {balance.toLocaleString()}{" "}
                <span className="text-xs text-yellow-400/60">{currencyLabel}</span>
              </motion.div>
            </div>
          )}

          {gated && <WalletGateNotice reason={gateReason} />}

          {/* Bet controls — visible when not flying */}
          {phase !== "flying" && !gated && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-[10px] text-purple-300/50 tracking-widest uppercase font-medium block">
                  Bet ({currencyLabel})
                </label>
                <BetControls
                  value={bet}
                  onChange={setBet}
                  max={balance}
                  disabled={false}
                />
              </div>
            </div>
          )}

          {/* Action buttons */}
          {gated ? null : phase === "flying" && betPlaced ? (
            <motion.button
              whileHover={{ scale: 1.03, y: -2 }}
              whileTap={{ scale: 0.97 }}
              onClick={cashOut}
              className="w-full py-5 rounded-xl font-cinzel font-black text-base tracking-[0.2em] uppercase bg-gradient-to-r from-green-600 to-green-800 text-white border border-green-400/30 neon-green transition-all"
              data-testid="button-cashout"
            >
              Cash Out — {(bet * multiplier).toFixed(0)} {currencyLabel}
            </motion.button>
          ) : phase === "waiting" || phase === "betting" ? (
            <motion.button
              whileHover={canPlaceBet && !betPlaced ? { scale: 1.03, y: -2 } : {}}
              whileTap={canPlaceBet && !betPlaced ? { scale: 0.97 } : {}}
              onClick={placeBet}
              disabled={!canPlaceBet || betPlaced}
              className={`w-full py-5 rounded-xl font-cinzel font-black text-base tracking-[0.2em] uppercase transition-all ${
                betPlaced
                  ? "bg-gradient-to-r from-purple-900 to-purple-800 text-purple-300 border border-purple-500/30"
                  : "bg-gradient-to-r from-cyan-600 to-cyan-800 text-white neon-purple border border-cyan-400/40 disabled:opacity-40 disabled:cursor-not-allowed"
              }`}
              data-testid="button-place-bet"
            >
              {betPlaced
                ? `Bet Placed — ${bet.toLocaleString()} ${currencyLabel}`
                : `Place Bet — ${bet.toLocaleString()} ${currencyLabel}`}
            </motion.button>
          ) : (
            <motion.button
              whileHover={canPlaceBet ? { scale: 1.03, y: -2 } : {}}
              whileTap={canPlaceBet ? { scale: 0.97 } : {}}
              onClick={startBetting}
              className="w-full py-5 rounded-xl font-cinzel font-black text-base tracking-[0.2em] uppercase bg-gradient-to-r from-purple-600 to-purple-800 text-white neon-purple border border-purple-400/40 transition-all"
              data-testid="button-new-round"
            >
              Play Again
            </motion.button>
          )}

          {balance <= 0 && phase !== "flying" && !gated && (
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              onClick={() => {
                resetBalance();
                setResultMsg(null);
              }}
              className="w-full py-3 rounded-xl font-cinzel font-bold text-sm tracking-widest uppercase glass border border-purple-500/40 text-purple-300"
              data-testid="button-reset-balance"
            >
              Reset Balance
            </motion.button>
          )}
        </div>
      </div>
    </GameLayout>
  );
}
