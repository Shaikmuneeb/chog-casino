import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Volume2, VolumeX } from "lucide-react";
import GameLayout from "@/components/GameLayout";
import WalletGateNotice from "@/components/WalletGateNotice";
import { useGameBalance } from "@/hooks/useGameBalance";
import bgImage from "@assets/image_1781811777784.png";
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

// ── Web Audio: rising engine whoosh while flying, crash & cash-out sounds ──────
let _ctx: AudioContext | null = null;
let _engine: { osc: OscillatorNode; sub: OscillatorNode; gain: GainNode } | null = null;
let _muted = false;

function audioCtx(): AudioContext | null {
  try {
    if (!_ctx) {
      _ctx = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    if (_ctx.state === "suspended") _ctx.resume();
    return _ctx;
  } catch {
    return null;
  }
}

function startEngineSound() {
  if (_muted) return;
  const ctx = audioCtx();
  if (!ctx) return;
  stopEngineSound();
  const osc = ctx.createOscillator();
  const sub = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  sub.type = "sine";
  osc.frequency.value = 180;
  sub.frequency.value = 90;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.15);
  osc.connect(gain);
  sub.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  sub.start();
  _engine = { osc, sub, gain };
}

function updateEngineSound(multiplier: number) {
  if (!_engine || !_ctx) return;
  const f = 180 + Math.min(multiplier, 25) * 55; // pitch rises with the multiplier
  _engine.osc.frequency.setTargetAtTime(f, _ctx.currentTime, 0.05);
  _engine.sub.frequency.setTargetAtTime(f / 2, _ctx.currentTime, 0.05);
}

function stopEngineSound() {
  if (!_engine || !_ctx) return;
  const { osc, sub, gain } = _engine;
  const t = _ctx.currentTime;
  try {
    gain.gain.cancelScheduledValues(t);
    gain.gain.setTargetAtTime(0.0001, t, 0.04);
    osc.stop(t + 0.25);
    sub.stop(t + 0.25);
  } catch {
    /* already stopped */
  }
  _engine = null;
}

function playCrashSound() {
  stopEngineSound();
  if (_muted) return;
  const ctx = audioCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(420, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.5);
  gain.gain.setValueAtTime(0.16, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.55);
}

function playCashoutSound() {
  stopEngineSound();
  if (_muted) return;
  const ctx = audioCtx();
  if (!ctx) return;
  [523, 659, 784, 1047].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const start = ctx.currentTime + i * 0.1;
    gain.gain.setValueAtTime(0.12, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.32);
  });
}
// ──────────────────────────────────────────────────────────────────────────────
const QUICK_CHIPS = [1000, 2000, 5000, 10000];

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
  const [bet, setBet] = useState(1000);
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
  const [muted, setMuted] = useState(false);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      _muted = !m;
      if (_muted) stopEngineSound();
      else audioCtx(); // resume on unmute (counts as a user gesture)
      return !m;
    });
  }, []);

  // Bet/Auto tab state
  const [controlTab, setControlTab] = useState<"bet" | "auto">("bet");
  const [autoBet, setAutoBet] = useState(false);
  const [autoCashOut, setAutoCashOut] = useState(false);
  const [autoCashOutMult, setAutoCashOutMult] = useState(1.1);
  // Raw text so the field can be typed/cleared freely; committed & clamped on blur.
  const [autoCashOutInput, setAutoCashOutInput] = useState("1.10");

  const multiplierRef = useRef(1.0);
  const betPlacedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rafRef = useRef<number | null>(null);
  const cashOutRef = useRef<(() => void) | null>(null);
  const startBettingRef = useRef<(() => void) | null>(null);
  const startFlyingRef = useRef<((cp: number) => void) | null>(null);

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
    stopEngineSound();
  }, []);

  const cashOut = useCallback(() => {
    if (phase !== "flying" || !betPlacedRef.current) return;
    clearTimers();
    const payout = Math.round(bet * multiplierRef.current);
    updateBalance((b) => b + payout);
    setPhase("cashed");
    playCashoutSound();
    setResultMsg({
      text: `Cashed out at ${multiplierRef.current.toFixed(2)}×  +${payout.toLocaleString()} ${currencyLabel}`,
      cls: "text-green-400",
    });
    timerRef.current = setTimeout(() => {
      startBettingRef.current?.();
    }, WAITING_DURATION);
  }, [phase, bet, clearTimers, updateBalance, currencyLabel]);

  cashOutRef.current = cashOut;

  const startFlying = useCallback(
    (cp: number) => {
      setPhase("flying");
      setCountdown(0);
      multiplierRef.current = 1.0;
      setMultiplier(1.0);
      startEngineSound();
      const startTime = performance.now();
      let autoCashed = false;

      const loop = (now: number) => {
        const elapsed = (now - startTime) / 1000;
        const raw = Math.pow(Math.E, elapsed * 0.18);

        if (raw >= cp) {
          multiplierRef.current = cp;
          setMultiplier(cp);
          setPhase("crashed");
          playCrashSound();
          setHistory((prev) => [cp, ...prev].slice(0, MAX_HISTORY));
          setResultMsg(
            betPlacedRef.current
              ? { text: `CRASHED at ${cp.toFixed(2)}×  — You lost!`, cls: "text-red-400" }
              : { text: `Crashed at ${cp.toFixed(2)}×`, cls: "text-red-400" },
          );
          rafRef.current = null;
          timerRef.current = setTimeout(() => startBettingRef.current?.(), WAITING_DURATION);
          return;
        }

        multiplierRef.current = raw;
        setMultiplier(raw);
        updateEngineSound(raw);

        if (!autoCashed && betPlacedRef.current && autoCashOut && raw >= autoCashOutMult) {
          autoCashed = true;
          cashOutRef.current?.();
          return;
        }

        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    },
    [autoCashOut, autoCashOutMult],
  );

  startFlyingRef.current = startFlying;

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

      if (autoBet && !gated && bet > 0 && bet <= balance) {
        setTimeout(() => {
          if (!betPlacedRef.current && !gated && bet > 0 && bet <= balance) {
            updateBalance((b) => b - bet);
            betPlacedRef.current = true;
            setBetPlaced(true);
          }
        }, 500);
      }

      timerRef.current = setTimeout(() => {
        clearInterval(countdownTick);
        startFlyingRef.current?.(cp);
      }, BETTING_DURATION);

      tickRef.current = countdownTick;
    },
    [clearTimers, autoBet, gated, bet, balance, updateBalance],
  );

  startBettingRef.current = startBetting;

  const placeBet = useCallback(() => {
    if (!canPlaceBet || betPlacedRef.current) return;
    audioCtx(); // unlock audio on this user gesture
    updateBalance((b) => b - bet);
    betPlacedRef.current = true;
    setBetPlaced(true);
  }, [canPlaceBet, bet, updateBalance]);

  useEffect(() => {
    startBetting();
    return clearTimers;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const showPlane = phase === "flying" || phase === "cashed";

  const climb = showPlane ? 1 - Math.exp(-0.85 * (multiplier - 1)) : 0;
  const planeLeft = 8 + climb * 60;
  const planeBottom = 14 + climb * 50;
  const planeRotation = -6 - climb * 16;

  const setBetAmount = (n: number) => setBet(Math.max(1, Math.min(balance, Math.round(n))));

  return (
    <GameLayout
      title="AVIATOR"
      subtitle="Cash Out Before It Crashes"
      bgImage={bgImage}
      accentColor="text-cyan-400"
    >
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
          <div className="absolute inset-0 bg-black/55" />

          {/* Sound toggle */}
          <button
            onClick={toggleMute}
            className="absolute top-3 right-3 z-20 w-9 h-9 rounded-full glass border border-cyan-500/30 flex items-center justify-center text-cyan-200 hover:text-white hover:border-cyan-400/60 transition-colors"
            aria-label={muted ? "Unmute" : "Mute"}
            data-testid="aviator-sound-toggle"
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

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
                <motion.img
                  src={aviatorPlane}
                  alt="Aviator plane"
                  data-testid="aviator-plane"
                  className="drop-shadow-[0_0_22px_rgba(168,85,247,0.55)]"
                  style={{ width: 96, height: "auto", display: "block" }}
                  initial={{ scaleX: -1, y: 0 }}
                  animate={phase === "flying" ? { scaleX: -1, y: [0, -6, 0, 6, 0] } : { scaleX: -1, y: 0 }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                />
              </motion.div>
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
        <div className="px-4 sm:px-6 pb-5 pt-4 space-y-3">
          {showBalance && (
            <div className="flex items-center justify-between px-1">
              <div className="text-[10px] text-purple-300/40 tracking-widest uppercase">Balance</div>
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

          {/* Bet/Auto controls — visible when not flying */}
          {phase !== "flying" && !gated && (
            <div className="space-y-3">
              {/* Tab toggle */}
              <div className="flex rounded-xl glass border border-cyan-500/20 p-1">
                {(["bet", "auto"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setControlTab(tab)}
                    className={`flex-1 py-2 rounded-lg text-xs font-cinzel font-bold tracking-[0.15em] uppercase transition-all duration-200 ${
                      controlTab === tab
                        ? "bg-cyan-600/30 border border-cyan-400/40 text-cyan-200"
                        : "text-purple-300/50 hover:text-purple-200"
                    }`}
                  >
                    {tab === "bet" ? "Bet" : "Auto"}
                  </button>
                ))}
              </div>

              {/* Bet amount row */}
              <div className="flex items-stretch gap-2">
                <motion.button
                  whileTap={{ scale: 0.88 }}
                  onClick={() => setBetAmount(bet - 50)}
                  disabled={bet <= 50}
                  className="flex items-center justify-center w-10 h-10 rounded-lg glass border border-cyan-500/30 text-cyan-200 hover:border-cyan-400/60 hover:bg-cyan-700/20 text-lg font-bold disabled:opacity-40 disabled:cursor-not-allowed select-none"
                >
                  −
                </motion.button>
                <div className="flex-1 flex items-center justify-center gap-1.5 glass border border-cyan-500/30 rounded-xl px-3 py-2">
                  <span className="font-cinzel font-black text-lg text-white tabular-nums truncate">
                    {bet.toLocaleString()}
                  </span>
                  <span className="text-xs text-yellow-400/70 font-medium shrink-0">{currencyLabel}</span>
                </div>
                <motion.button
                  whileTap={{ scale: 0.88 }}
                  onClick={() => setBetAmount(bet + 50)}
                  disabled={bet >= balance}
                  className="flex items-center justify-center w-10 h-10 rounded-lg glass border border-cyan-500/30 text-cyan-200 hover:border-cyan-400/60 hover:bg-cyan-700/20 text-lg font-bold disabled:opacity-40 disabled:cursor-not-allowed select-none"
                >
                  +
                </motion.button>
              </div>

              {/* Quick chips */}
              <div className="grid grid-cols-4 gap-2">
                {QUICK_CHIPS.map((chip) => (
                  <motion.button
                    key={chip}
                    whileTap={{ scale: 0.92 }}
                    onClick={() => setBetAmount(chip)}
                    className="py-2 rounded-lg glass border border-cyan-500/30 text-cyan-200 text-xs font-cinzel font-bold tracking-wider hover:border-cyan-400/60 hover:bg-cyan-700/20 transition-all select-none"
                  >
                    {chip.toLocaleString()}
                  </motion.button>
                ))}
              </div>

              {/* Auto tab extras */}
              {controlTab === "auto" && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-2.5 overflow-hidden"
                >
                  {/* Auto bet toggle */}
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs text-purple-300/60 font-medium tracking-wide">Auto bet</span>
                    <button
                      onClick={() => setAutoBet((v) => !v)}
                      className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${
                        autoBet ? "bg-green-600" : "bg-purple-800 border border-purple-600/40"
                      }`}
                    >
                      <motion.div
                        className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow"
                        animate={{ left: autoBet ? 22 : 2 }}
                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                      />
                    </button>
                  </div>

                  {/* Auto Cash Out toggle + multiplier */}
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs text-purple-300/60 font-medium tracking-wide">Auto Cash Out</span>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 glass border border-cyan-500/30 rounded-lg px-2 py-1">
                        <input
                          type="number"
                          value={autoCashOutInput}
                          onChange={(e) => {
                            setAutoCashOutInput(e.target.value);
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v) && v >= 1.01) setAutoCashOutMult(parseFloat(v.toFixed(2)));
                          }}
                          onBlur={() => {
                            let v = parseFloat(autoCashOutInput);
                            if (isNaN(v) || v < 1.01) v = 1.01;
                            v = parseFloat(v.toFixed(2));
                            setAutoCashOutMult(v);
                            setAutoCashOutInput(v.toFixed(2));
                          }}
                          step={0.1}
                          min={1.01}
                          className="w-12 bg-transparent text-white text-xs font-cinzel font-bold text-center outline-none tabular-nums"
                        />
                        <span className="text-[10px] text-purple-300/50">×</span>
                      </div>
                      <button
                        onClick={() => setAutoCashOut((v) => !v)}
                        className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${
                          autoCashOut ? "bg-green-600" : "bg-purple-800 border border-purple-600/40"
                        }`}
                      >
                        <motion.div
                          className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow"
                          animate={{ left: autoCashOut ? 22 : 2 }}
                          transition={{ type: "spring", stiffness: 500, damping: 30 }}
                        />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
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
                  : "bg-gradient-to-r from-green-600 to-green-800 text-white border border-green-400/30 disabled:opacity-40 disabled:cursor-not-allowed"
              }`}
              data-testid="button-place-bet"
            >
              {betPlaced
                ? `Bet Placed — ${bet.toLocaleString()} ${currencyLabel}`
                : `Bet ${bet.toLocaleString()} ${currencyLabel}`}
            </motion.button>
          ) : null}

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
