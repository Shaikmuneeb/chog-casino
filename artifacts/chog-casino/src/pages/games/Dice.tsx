import { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Volume2, VolumeX } from "lucide-react";
import GameLayout from "@/components/GameLayout";
import WalletGateNotice from "@/components/WalletGateNotice";
import { useGameBalance } from "@/hooks/useGameBalance";
import bgImage from "@assets/dice/dice-cover.png";
import diceBg from "@assets/dice/dice-bg.png";

/**
 * Provably-fair-style dice roll.
 * A cryptographically-random number in [0, 100) (2 decimals) is generated.
 * Roll-under: you win if the roll is below your target.
 * Roll-over:  you win if the roll is above your target.
 * Win chance and payout are derived from the target with a 1% house edge.
 */
function rollDice(): number {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return Math.floor((arr[0] / 0xffffffff) * 10000) / 100; // 0.00 – 100.00
}

const HOUSE_MULTIPLIER = 99; // 1% house edge
const QUICK_CHIPS = [1000, 2000, 5000, 10000];
const MAX_HISTORY = 15;

// ── Web Audio: roll rattle + win/lose chime (same pattern as the other games) ──
let _ctx: AudioContext | null = null;
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

function playRollTick() {
  if (_muted) return;
  const ctx = audioCtx();
  if (!ctx) return;
  const duration = 0.04;
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1800;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.18, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  noise.start();
}

function playResult(won: boolean) {
  if (_muted) return;
  const ctx = audioCtx();
  if (!ctx) return;
  const notes = won ? [523, 659, 784, 1047] : [330, 247];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = won ? "sine" : "sawtooth";
    osc.frequency.value = freq;
    const start = ctx.currentTime + i * 0.1;
    gain.gain.setValueAtTime(0.14, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.32);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.35);
  });
}
// ──────────────────────────────────────────────────────────────────────────────

type Direction = "under" | "over";

export default function Dice() {
  const [bet, setBet] = useState(1000);
  const { balance, updateBalance, resetBalance, gated, gateReason, showBalance, currencyLabel } =
    useGameBalance();

  const [target, setTarget] = useState(50);
  const [direction, setDirection] = useState<Direction>("under");
  const [rolling, setRolling] = useState(false);
  const [displayRoll, setDisplayRoll] = useState(50);
  const [lastRoll, setLastRoll] = useState<number | null>(null);
  const [lastWin, setLastWin] = useState<boolean | null>(null);
  const [history, setHistory] = useState<{ roll: number; win: boolean }[]>([]);
  const [resultMsg, setResultMsg] = useState<{ text: string; cls: string; id: number } | null>(null);
  const [muted, setMuted] = useState(false);
  const rollIdRef = useRef(0);

  // Bet/Auto controls — mirrors Aviator exactly
  const [controlTab, setControlTab] = useState<"bet" | "auto">("bet");
  const [autoBet, setAutoBet] = useState(false);
  const [autoRolls, setAutoRolls] = useState(10);
  const [autoRollsInput, setAutoRollsInput] = useState("10");
  const [autoRunning, setAutoRunning] = useState(false);

  const autoRunningRef = useRef(false);
  const rollTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Win chance and payout multiplier derived from the target + direction.
  const winChance = direction === "under" ? target : 100 - target;
  const multiplier = winChance > 0 ? HOUSE_MULTIPLIER / winChance : 0;
  const payout = Math.floor(bet * multiplier);

  const canRoll = !rolling && !gated && bet > 0 && bet <= balance && winChance > 0;

  const clearRollTimers = () => {
    rollTimersRef.current.forEach(clearTimeout);
    rollTimersRef.current = [];
  };

  useEffect(() => {
    return () => {
      autoRunningRef.current = false;
      clearRollTimers();
    };
  }, []);

  const toggleMute = () => {
    setMuted((m) => {
      _muted = !m;
      return !m;
    });
  };

  const setBetAmount = (n: number) => setBet(Math.max(1, Math.min(balance, Math.round(n))));

  // Runs one roll; resolves with whether it won so the auto loop can chain.
  const doRoll = useCallback(
    (onDone?: (won: boolean) => void) => {
      audioCtx(); // unlock audio on the user gesture
      setRolling(true);
      updateBalance((b) => b - bet);

      const result = rollDice();
      const won = direction === "under" ? result < target : result > target;

      // Flicker the number for ~0.9s, then settle on the real roll.
      let ticks = 0;
      const flickerEvery = 60;
      const totalMs = 900;
      const interval = setInterval(() => {
        setDisplayRoll(rollDice());
        if (ticks % 2 === 0) playRollTick();
        ticks++;
      }, flickerEvery);
      rollTimersRef.current.push(interval as unknown as ReturnType<typeof setTimeout>);

      const settle = setTimeout(() => {
        clearInterval(interval);
        setDisplayRoll(result);
        setLastRoll(result);
        setLastWin(won);
        setHistory((prev) => [{ roll: result, win: won }, ...prev].slice(0, MAX_HISTORY));
        const id = ++rollIdRef.current;
        if (won) {
          updateBalance((b) => b + payout);
          setResultMsg({
            text: `Rolled ${result.toFixed(2)} — WIN +${payout.toLocaleString()} ${currencyLabel}`,
            cls: "text-green-400",
            id,
          });
        } else {
          setResultMsg({
            text: `Rolled ${result.toFixed(2)} — Lost ${bet.toLocaleString()} ${currencyLabel}`,
            cls: "text-red-400",
            id,
          });
        }
        playResult(won);
        setRolling(false);
        onDone?.(won);
      }, totalMs);
      rollTimersRef.current.push(settle);
    },
    [bet, direction, target, payout, updateBalance, currencyLabel],
  );

  const startAuto = useCallback(() => {
    if (autoRunningRef.current) return;
    let remaining = autoRolls;
    autoRunningRef.current = true;
    setAutoRunning(true);

    const runOne = () => {
      if (!autoRunningRef.current || remaining <= 0) {
        autoRunningRef.current = false;
        setAutoRunning(false);
        return;
      }
      // Stop early if the balance can't cover the next bet.
      const current = balance;
      if (bet > current) {
        autoRunningRef.current = false;
        setAutoRunning(false);
        return;
      }
      remaining--;
      doRoll(() => {
        const t = setTimeout(runOne, 600);
        rollTimersRef.current.push(t);
      });
    };
    runOne();
  }, [autoRolls, bet, balance, doRoll]);

  const stopAuto = () => {
    autoRunningRef.current = false;
    setAutoRunning(false);
  };

  const handlePrimary = () => {
    if (controlTab === "auto" && autoBet) {
      if (autoRunning) stopAuto();
      else startAuto();
    } else {
      if (canRoll) doRoll();
    }
  };

  // Slider track split — colored to show the winning zone.
  const winLeft = direction === "under" ? 0 : target;
  const winWidth = direction === "under" ? target : 100 - target;

  // Drag the handle anywhere along the track to set the target (replaces the range input).
  const trackRef = useRef<HTMLDivElement>(null);

  const setTargetFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setTarget(Math.max(2, Math.min(98, Math.round(pct))));
  };

  const handleTrackPointerDown = (e: React.PointerEvent) => {
    if (rolling || autoRunning) return;
    setTargetFromClientX(e.clientX);
    const move = (ev: PointerEvent) => setTargetFromClientX(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <GameLayout title="DICE" subtitle="Roll to Win" bgImage={bgImage} accentColor="text-cyan-400">
      <div className="glass rounded-2xl border border-cyan-500/20 overflow-hidden">
        {/* History strip */}
        <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-cyan-500/15 overflow-x-auto">
          <span className="text-[10px] text-purple-300/40 tracking-widest uppercase shrink-0 mr-1">
            History
          </span>
          {history.length === 0 && <span className="text-[10px] text-purple-300/30">No rolls yet</span>}
          {history.map((h, i) => (
            <motion.span
              key={`${h.roll}-${i}`}
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              className={`px-2 py-0.5 rounded-full text-[11px] font-cinzel font-bold border shrink-0 ${
                h.win
                  ? "bg-green-500/20 border-green-500/40 text-green-300"
                  : "bg-red-500/20 border-red-500/40 text-red-300"
              }`}
            >
              {h.roll.toFixed(2)}
            </motion.span>
          ))}
        </div>

        {/* Roll display with background image */}
        <div
          className="relative px-4 sm:px-6 py-8 overflow-hidden"
          style={{
            backgroundImage: `url(${diceBg})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            minHeight: 280,
          }}
        >
          <div className="absolute inset-0 bg-black/60" />

          {/* Sound toggle */}
          <button
            onClick={toggleMute}
            className="absolute top-3 right-3 z-20 w-9 h-9 rounded-full glass border border-cyan-500/30 flex items-center justify-center text-cyan-200 hover:text-white hover:border-cyan-400/60 transition-colors"
            aria-label={muted ? "Unmute" : "Mute"}
            data-testid="dice-sound-toggle"
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          <div className="relative z-10">
            {/* Big roll number */}
            <div className="text-center mb-6">
              <motion.div
                key={rolling ? "rolling" : `roll-${lastRoll}`}
                initial={{ opacity: 0, y: 10, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                className={`font-cinzel font-black text-6xl sm:text-7xl tracking-wider tabular-nums ${
                  rolling
                    ? "text-cyan-300"
                    : lastWin === true
                    ? "text-green-400"
                    : lastWin === false
                    ? "text-red-400"
                    : "text-white"
                }`}
                style={{
                  textShadow:
                    lastWin === true && !rolling
                      ? "0 0 30px rgba(74,222,128,0.6)"
                      : lastWin === false && !rolling
                      ? "0 0 24px rgba(248,113,113,0.5)"
                      : "0 0 24px rgba(34,211,238,0.5)",
                }}
                data-testid="dice-roll-value"
              >
                {displayRoll.toFixed(2)}
              </motion.div>
              <p className="text-purple-300/60 text-xs tracking-widest uppercase mt-2">
                Roll {direction === "under" ? "under" : "over"} {target} to win
              </p>
            </div>

            {/* Target slider — drag the handle to set your target; the ball lands on each roll */}
            <div className="max-w-lg mx-auto px-2 pt-10 pb-2">
              {/* Scale labels */}
              <div className="flex justify-between text-[11px] font-bold text-purple-200/70 tabular-nums mb-2 px-0.5">
                {[0, 25, 50, 75, 100].map((n) => (
                  <span key={n}>{n}</span>
                ))}
              </div>

              <div
                ref={trackRef}
                onPointerDown={handleTrackPointerDown}
                className={`relative h-3 rounded-full bg-purple-950/70 border border-purple-700/40 ${
                  rolling || autoRunning ? "" : "cursor-pointer"
                }`}
                data-testid="dice-track"
              >
                {/* Losing (red) / winning (green) zones */}
                <div className="absolute inset-0 rounded-full overflow-hidden">
                  <div className="absolute inset-0 bg-red-500/60" />
                  <div
                    className="absolute top-0 bottom-0 bg-green-500/70"
                    style={{ left: `${winLeft}%`, width: `${winWidth}%` }}
                  />
                </div>

                {/* Result ball — travels to where the dice landed on each bet */}
                {(rolling || lastRoll !== null) && (
                  <motion.div
                    className="absolute z-30 pointer-events-none"
                    style={{ top: "50%" }}
                    animate={{ left: `${displayRoll}%` }}
                    transition={
                      rolling
                        ? { duration: 0.06, ease: "linear" }
                        : { type: "spring", stiffness: 260, damping: 18 }
                    }
                  >
                    <div className="relative -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
                      <span
                        className={`absolute -top-7 font-cinzel font-bold text-xs tabular-nums whitespace-nowrap ${
                          rolling ? "text-cyan-300" : lastWin ? "text-green-300" : "text-red-300"
                        }`}
                      >
                        {displayRoll.toFixed(2)}
                      </span>
                      <div
                        className={`w-4 h-4 rounded-full border-2 border-white shadow-[0_0_12px_rgba(255,255,255,0.6)] ${
                          rolling ? "bg-cyan-400" : lastWin ? "bg-green-400" : "bg-red-400"
                        }`}
                      />
                    </div>
                  </motion.div>
                )}

                {/* Draggable target handle */}
                <div
                  className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-20 w-6 h-8 rounded-md bg-gradient-to-b from-cyan-300 to-cyan-500 border border-cyan-100 shadow-lg flex items-center justify-center ${
                    rolling || autoRunning ? "opacity-60" : "cursor-grab active:cursor-grabbing"
                  }`}
                  style={{ left: `${target}%` }}
                  data-testid="dice-target-handle"
                >
                  <div className="flex gap-[2px]">
                    <span className="w-[2px] h-3.5 rounded-full bg-cyan-900/70" />
                    <span className="w-[2px] h-3.5 rounded-full bg-cyan-900/70" />
                    <span className="w-[2px] h-3.5 rounded-full bg-cyan-900/70" />
                  </div>
                </div>
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-2 max-w-lg mx-auto mt-4">
              <div className="glass border border-cyan-500/20 rounded-xl px-2 py-2 text-center">
                <div className="text-[9px] text-purple-300/40 tracking-widest uppercase mb-0.5">Target</div>
                <div className="font-cinzel font-bold text-sm text-white tabular-nums">{target}</div>
              </div>
              <div className="glass border border-cyan-500/20 rounded-xl px-2 py-2 text-center">
                <div className="text-[9px] text-purple-300/40 tracking-widest uppercase mb-0.5">Win Chance</div>
                <div className="font-cinzel font-bold text-sm text-cyan-300 tabular-nums">
                  {winChance.toFixed(0)}%
                </div>
              </div>
              <div className="glass border border-cyan-500/20 rounded-xl px-2 py-2 text-center">
                <div className="text-[9px] text-purple-300/40 tracking-widest uppercase mb-0.5">Payout</div>
                <div className="font-cinzel font-bold text-sm text-yellow-300 tabular-nums">
                  {multiplier.toFixed(2)}×
                </div>
              </div>
            </div>

            {/* Result message */}
            <div className="text-center mt-4" style={{ minHeight: 24 }}>
              {resultMsg && (
                <motion.div
                  key={resultMsg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  className={`font-cinzel font-bold text-sm tracking-wider ${resultMsg.cls}`}
                  data-testid="dice-result"
                >
                  {resultMsg.text}
                </motion.div>
              )}
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
                {balance.toLocaleString()} <span className="text-xs text-yellow-400/60">{currencyLabel}</span>
              </motion.div>
            </div>
          )}

          {gated && <WalletGateNotice reason={gateReason} />}

          {!gated && (
            <div className="space-y-3">
              {/* Roll-under / Roll-over toggle */}
              <div className="flex rounded-xl glass border border-cyan-500/20 p-1">
                {(["under", "over"] as Direction[]).map((d) => (
                  <button
                    key={d}
                    onClick={() => !rolling && !autoRunning && setDirection(d)}
                    disabled={rolling || autoRunning}
                    className={`flex-1 py-2 rounded-lg text-xs font-cinzel font-bold tracking-[0.15em] uppercase transition-all duration-200 disabled:opacity-50 ${
                      direction === d
                        ? "bg-cyan-600/30 border border-cyan-400/40 text-cyan-200"
                        : "text-purple-300/50 hover:text-purple-200"
                    }`}
                    data-testid={`dice-dir-${d}`}
                  >
                    {d === "under" ? "Roll Under" : "Roll Over"}
                  </button>
                ))}
              </div>

              {/* Bet/Auto tab toggle — same as Aviator */}
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

              {/* Bet amount row — same as Aviator */}
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

              {/* Quick chips — same as Aviator */}
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

              {/* Auto tab extras — same pattern as Aviator */}
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

                  {/* Number of rolls */}
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs text-purple-300/60 font-medium tracking-wide">
                      Number of rolls
                    </span>
                    <div className="flex items-center gap-1 glass border border-cyan-500/30 rounded-lg px-2 py-1">
                      <input
                        type="number"
                        value={autoRollsInput}
                        onChange={(e) => {
                          setAutoRollsInput(e.target.value);
                          const v = parseInt(e.target.value, 10);
                          if (!isNaN(v) && v >= 1) setAutoRolls(v);
                        }}
                        onBlur={() => {
                          let v = parseInt(autoRollsInput, 10);
                          if (isNaN(v) || v < 1) v = 1;
                          if (v > 999) v = 999;
                          setAutoRolls(v);
                          setAutoRollsInput(String(v));
                        }}
                        min={1}
                        max={999}
                        disabled={autoRunning}
                        className="w-12 bg-transparent text-white text-xs font-cinzel font-bold text-center outline-none tabular-nums"
                      />
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
          )}

          {/* Primary action button */}
          {!gated && (
            <motion.button
              whileHover={canRoll || autoRunning ? { scale: 1.03, y: -2 } : {}}
              whileTap={canRoll || autoRunning ? { scale: 0.97 } : {}}
              onClick={handlePrimary}
              disabled={!autoRunning && !canRoll}
              className={`w-full py-5 rounded-xl font-cinzel font-black text-base tracking-[0.2em] uppercase transition-all ${
                autoRunning
                  ? "bg-gradient-to-r from-red-600 to-red-800 text-white border border-red-400/30"
                  : "bg-gradient-to-r from-green-600 to-green-800 text-white border border-green-400/30 disabled:opacity-40 disabled:cursor-not-allowed"
              }`}
              data-testid="button-roll-dice"
            >
              {autoRunning
                ? "Stop Auto"
                : rolling
                ? "Rolling…"
                : controlTab === "auto" && autoBet
                ? `Start Auto (${autoRolls})`
                : `Bet ${bet.toLocaleString()} ${currencyLabel}`}
            </motion.button>
          )}

          {balance <= 0 && !rolling && !autoRunning && !gated && (
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
