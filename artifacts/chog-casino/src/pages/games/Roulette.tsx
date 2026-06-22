import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { formatUnits } from "viem";
import GameLayout from "@/components/GameLayout";
import BetControls from "@/components/BetControls";
import TokenSelector from "@/components/TokenSelector";
import WalletGateNotice from "@/components/WalletGateNotice";
import { useGameBalance } from "@/hooks/useGameBalance";
import { useGameMode } from "@/context/GameModeContext";
import { useWallet } from "@/hooks/useWallet";
import { useRouletteOnChain, type BetKind } from "@/hooks/useRouletteOnChain";
import { publicClient } from "@/lib/casinoClient";
import { CUSTODIAL_VAULT_ABI, TOKENS, isDeployed, CONTRACTS, type SupportedToken } from "@/config/contracts";
import bgImage from "@assets/image_1781811963908.png";

// ── Web Audio: spinning whoosh, slowing ball ticks, and a win/lose chime ───────
let _rouletteCtx: AudioContext | null = null;

function rouletteCtx(): AudioContext | null {
  try {
    if (!_rouletteCtx) {
      _rouletteCtx = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    if (_rouletteCtx.state === "suspended") _rouletteCtx.resume();
    return _rouletteCtx;
  } catch {
    return null;
  }
}

function playSpinWhoosh(durationSec: number) {
  const ctx = rouletteCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(440, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + durationSec);
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.045, ctx.currentTime + 0.3);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationSec);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + durationSec + 0.05);
}

function playTick() {
  const ctx = rouletteCtx();
  if (!ctx) return;
  const duration = 0.03;
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 2200;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.28, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  noise.start();
}

function playResultChime(won: boolean) {
  const ctx = rouletteCtx();
  if (!ctx) return;
  const notes = won ? [523, 659, 784, 1047] : [330, 247];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = won ? "sine" : "sawtooth";
    osc.frequency.value = freq;
    const start = ctx.currentTime + i * 0.12;
    gain.gain.setValueAtTime(0.14, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.4);
  });
}
// ─────────────────────────────────────────────────────────────────────────────

type BetType = "red" | "black" | "green" | "odd" | "even" | "1-18" | "19-36" | number;

const RED_NUMBERS = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
const NUMBERS = Array.from({ length: 37 }, (_, i) => i);

// Physical positions of numbers around a European roulette wheel (clockwise from top).
const WHEEL_ORDER = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const SLOT_ANGLE = 360 / WHEEL_ORDER.length;

function polar(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const rad = (angleDeg * Math.PI) / 180;
  return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)];
}

function segmentPath(cx: number, cy: number, innerR: number, outerR: number, startAngle: number, endAngle: number) {
  const [x1, y1] = polar(cx, cy, outerR, startAngle);
  const [x2, y2] = polar(cx, cy, outerR, endAngle);
  const [x3, y3] = polar(cx, cy, innerR, endAngle);
  const [x4, y4] = polar(cx, cy, innerR, startAngle);
  return `M ${x1} ${y1} A ${outerR} ${outerR} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 0 0 ${x4} ${y4} Z`;
}

function getColor(n: number): "red" | "black" | "green" {
  if (n === 0) return "green";
  return RED_NUMBERS.includes(n) ? "red" : "black";
}

function getMultiplier(betType: BetType): number {
  // Single-number bets (incl. green/0) are 1/37 odds — 36x total payout for a 2.7% house edge.
  if (typeof betType === "number") return 36;
  if (betType === "green") return 36;
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
  const { mode } = useGameMode();
  const isReal = mode === "real";
  const { address, connected } = useWallet();

  const [bet, setBet] = useState(100);
  const [betType, setBetType] = useState<BetType>("red");
  const { balance, updateBalance, resetBalance, gated, gateReason, showBalance, currencyLabel } = useGameBalance();
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<number | null>(null);
  const [winAmount, setWinAmount] = useState<number | null>(null);
  const [rotation, setRotation] = useState(0);
  const [spinTransition, setSpinTransition] = useState<{ duration: number; ease: "linear" | [number, number, number, number] }>(
    { duration: 2.3, ease: [0.25, 0.1, 0.25, 1] },
  );
  const [showNumbers, setShowNumbers] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Real-mode on-chain state
  const [realToken, setRealToken] = useState<SupportedToken>("MON");
  const [realBetAmount, setRealBetAmount] = useState(1);
  const [realBalanceRaw, setRealBalanceRaw] = useState(0n);
  const [chainError, setChainError] = useState<string | null>(null);
  const [realPayout, setRealPayout] = useState<bigint | null>(null);
  const { status: chainStatus, placeBetFromVault } = useRouletteOnChain();
  const deployed = isDeployed(CONTRACTS.roulette) && isDeployed(CONTRACTS.treasury) && isDeployed(CONTRACTS.custodialVault);

  useEffect(() => {
    if (!isReal || !connected || !address) return;
    let cancelled = false;
    async function load() {
      const info = TOKENS[realToken];
      const raw = (await publicClient.readContract({
        address: CONTRACTS.custodialVault,
        abi: CUSTODIAL_VAULT_ABI,
        functionName: "balanceOf",
        args: [address as `0x${string}`, info.address],
      })) as bigint;
      if (!cancelled) setRealBalanceRaw(raw);
    }
    load();
    const id = setInterval(load, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isReal, connected, address, realToken]);

  const realBalanceHuman = Math.floor(Number(formatUnits(realBalanceRaw, TOKENS[realToken].decimals)));

  // Reset state on mode switch
  useEffect(() => {
    setSpinning(false);
    setResult(null);
    setWinAmount(null);
    setChainError(null);
    setRealPayout(null);
  }, [isReal]);

  const canSpin = isReal
    ? !spinning && connected && realBetAmount > 0 && realBetAmount <= realBalanceHuman
    : !spinning && !gated && bet > 0 && bet <= balance;

  useEffect(() => {
    return () => timersRef.current.forEach(clearTimeout);
  }, []);

  const spin = async () => {
    if (!canSpin) return;
    setSpinning(true);
    setResult(null);
    setWinAmount(null);

    if (isReal) {
      // Real mode: place on-chain bet
      setChainError(null);
      setRealPayout(null);

      // Map betType to Roulette.sol's actual BetKind enum: StraightNumber=0, Red=1, Black=2,
      // Odd=3, Even=4, Low=5, High=6 — "green" (the 0 pocket) is just a StraightNumber bet on
      // 0, not its own enum value (matches every other single-number bet's 36x payout).
      const betKindMap: Record<string, BetKind> = {
        red: 1, black: 2, odd: 3, even: 4, "1-18": 5, "19-36": 6,
      };
      const isStraight = typeof betType === "number" || betType === "green";
      const kind: BetKind = isStraight ? 0 : betKindMap[betType] ?? 0;
      const straightNumber = typeof betType === "number" ? betType : 0;

      // The wheel must never sit motionless while waiting on the operator — that read as
      // "stuck". So it spins continuously at a steady pace from the moment of the click, for
      // as long as the real result takes; once that arrives, we retarget mid-flight to the
      // exact correct pocket with a short decelerating finish. Framer Motion interpolates from
      // wherever the wheel currently is when the target changes, so this retarget is seamless.
      const WAIT_SPIN_MS = 6000;
      const LANDING_MS = 2300;
      playSpinWhoosh(WAIT_SPIN_MS / 1000);
      setSpinTransition({ duration: WAIT_SPIN_MS / 1000, ease: "linear" });
      setRotation(prev => prev + (WAIT_SPIN_MS / 1000) * 360);

      try {
        const outcome = await placeBetFromVault(realToken, String(realBetAmount), kind, straightNumber);
        // The wheel must visually land on the REAL on-chain pocket — landing on a random
        // number could show e.g. a black number lighting up "WIN" for a Red bet, which is
        // exactly the kind of contradiction that erodes trust in a real-money game.
        const landed = outcome.landedNumber ?? 0;
        const slotIndex = WHEEL_ORDER.indexOf(landed);

        const totalTicks = 18;
        for (let i = 0; i < totalTicks; i++) {
          const t = LANDING_MS * Math.pow(i / totalTicks, 2.4);
          timersRef.current.push(setTimeout(playTick, t));
        }

        setSpinTransition({ duration: LANDING_MS / 1000, ease: [0.25, 0.1, 0.25, 1] });
        setRotation(prev => {
          const prevMod = ((prev % 360) + 360) % 360;
          // Segment i sits at angle i*SLOT_ANGLE clockwise from the top (see polar() below).
          // Rotating the wheel clockwise by R moves that segment to angle i*SLOT_ANGLE + R —
          // to land it under the fixed pointer (angle 0) we need R = -i*SLOT_ANGLE, not
          // +i*SLOT_ANGLE (that was the bug: it always landed on the mirror-opposite segment).
          const targetMod = (360 - slotIndex * SLOT_ANGLE) % 360;
          let delta = targetMod - prevMod;
          if (delta <= 0) delta += 360;
          const fullSpins = 2 + Math.floor(Math.random() * 2);
          return prev + fullSpins * 360 + delta;
        });

        timersRef.current.push(setTimeout(() => {
          const won = outcome.won;
          const payout = won ? Number(formatUnits(outcome.payoutAmount, TOKENS[realToken].decimals)) : 0;
          setResult(landed);
          setWinAmount(won ? payout : -realBetAmount);
          setRealPayout(outcome.payoutAmount);
          setSpinning(false);
          playResultChime(won);
        }, LANDING_MS));
      } catch (err) {
        setSpinTransition({ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] });
        timersRef.current.push(setTimeout(() => {
          setChainError(err instanceof Error ? err.message : "Bet failed");
          setSpinning(false);
        }, 400));
      }
    } else {
      // Fun mode: client-side, outcome known instantly — single decelerating spin, no waiting phase.
      updateBalance(b => b - bet);
      setSpinTransition({ duration: 2.3, ease: [0.25, 0.1, 0.25, 1] });

      const SPIN_MS = 2300;
      playSpinWhoosh(SPIN_MS / 1000);
      const totalTicks = 28;
      for (let i = 0; i < totalTicks; i++) {
        const t = SPIN_MS * Math.pow(i / totalTicks, 2.4);
        timersRef.current.push(setTimeout(playTick, t));
      }

      const outcome = NUMBERS[Math.floor(Math.random() * NUMBERS.length)];
      const slotIndex = WHEEL_ORDER.indexOf(outcome);
      setRotation(prev => {
        const prevMod = ((prev % 360) + 360) % 360;
        const targetMod = (360 - slotIndex * SLOT_ANGLE) % 360;
        let delta = targetMod - prevMod;
        if (delta <= 0) delta += 360;
        const fullSpins = 5 + Math.floor(Math.random() * 2);
        return prev + fullSpins * 360 + delta;
      });

      timersRef.current.push(setTimeout(() => {
        const won = checkWin(outcome, betType);
        const payout = won ? bet * getMultiplier(betType) : 0;
        setResult(outcome);
        setWinAmount(won ? payout : -bet);
        if (won) updateBalance(b => b + payout);
        setSpinning(false);
        playResultChime(won);
      }, SPIN_MS));
    }
  };

  const resultColor = result !== null ? getColor(result) : null;
  const isWin = winAmount !== null && winAmount > 0;

  if (isReal && !deployed) {
    return (
      <GameLayout title="ROULETTE" subtitle="Spin the Wheel of Fate" bgImage={bgImage} accentColor="gradient-purple-gold">
        <div className="glass rounded-2xl border border-purple-500/20 p-6 text-center text-sm text-purple-300/60" data-testid="roulette-not-deployed">
          Contracts not deployed yet
        </div>
      </GameLayout>
    );
  }

  return (
    <GameLayout title="ROULETTE" subtitle="Spin the Wheel of Fate" bgImage={bgImage} accentColor="gradient-purple-gold">
      <div className="glass rounded-2xl border border-purple-500/20 overflow-hidden flex flex-col">

        {/* Balance bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-purple-500/15">
          {isReal ? (
            connected ? (
              <div>
                <div className="text-[10px] text-purple-300/40 tracking-widest uppercase mb-0.5">In-Game Balance</div>
                <div className="font-cinzel font-bold text-lg text-yellow-300">
                  {realBalanceHuman.toLocaleString()} <span className="text-xs text-yellow-400/60">{realToken}</span>
                </div>
              </div>
            ) : <div />
          ) : showBalance ? (
            <div>
              <div className="text-[10px] text-purple-300/40 tracking-widest uppercase mb-0.5">Balance</div>
              <div className="font-cinzel font-bold text-lg text-yellow-300">
                {balance.toLocaleString()} <span className="text-xs text-yellow-400/60">{currencyLabel}</span>
              </div>
            </div>
          ) : <div />}
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
            <div className="relative w-[260px] h-[260px] sm:w-[320px] sm:h-[320px]">
              {/* Fixed pointer */}
              <div
                className="absolute left-1/2 -top-1 -translate-x-1/2 z-10 w-0 h-0
                  border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent
                  border-t-[14px] border-t-yellow-400 drop-shadow-[0_0_4px_rgba(250,204,21,0.8)]"
                data-testid="roulette-pointer"
              />
              <motion.svg
                viewBox="0 0 380 380"
                animate={{ rotate: rotation }}
                transition={spinTransition}
                className="w-full h-full drop-shadow-2xl"
                data-testid="roulette-wheel"
              >
                <circle cx={190} cy={190} r={188} fill="#0a0618" stroke="#1f1635" strokeWidth={2} />
                {WHEEL_ORDER.map((n, i) => {
                  const start = i * SLOT_ANGLE - SLOT_ANGLE / 2;
                  const end = i * SLOT_ANGLE + SLOT_ANGLE / 2;
                  const color = getColor(n);
                  const fill = color === "red" ? "#b91c1c" : color === "black" ? "#18181b" : "#15803d";
                  const [tx, ty] = polar(190, 190, 158, i * SLOT_ANGLE);
                  return (
                    <g key={n}>
                      <path d={segmentPath(190, 190, 120, 178, start, end)} fill={fill} stroke="#0a0618" strokeWidth={1.5} />
                      <text
                        x={tx}
                        y={ty}
                        fill="#f5f5f5"
                        fontSize={13}
                        fontWeight={700}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        transform={`rotate(${i * SLOT_ANGLE}, ${tx}, ${ty})`}
                      >
                        {n}
                      </text>
                    </g>
                  );
                })}
                {/* Inner hub */}
                <circle cx={190} cy={190} r={118} fill="#0a0618" stroke="#b45309" strokeWidth={3} />
                <circle cx={190} cy={190} r={64} fill="#120a24" stroke="#facc15" strokeWidth={2} />
                {/* Gold cross with ball tips */}
                {[45, 135, 225, 315].map(angle => {
                  const [ex, ey] = polar(190, 190, 46, angle);
                  return (
                    <g key={angle}>
                      <line x1={190} y1={190} x2={ex} y2={ey} stroke="#facc15" strokeWidth={4} strokeLinecap="round" />
                      <circle cx={ex} cy={ey} r={7} fill="#facc15" />
                    </g>
                  );
                })}
                <circle cx={190} cy={190} r={9} fill="#facc15" />
              </motion.svg>
              {spinning && <div className="absolute inset-0 rounded-full bg-yellow-400/10 blur-xl animate-pulse pointer-events-none" />}
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
          {isReal ? (
            connected && (
              <>
                <TokenSelector value={realToken} onChange={setRealToken} />
                <BetControls
                  value={realBetAmount}
                  onChange={setRealBetAmount}
                  max={Math.max(1, realBalanceHuman)}
                  disabled={spinning}
                  step={1}
                  unitLabel={realToken}
                />
              </>
            )
          ) : (
            <BetControls value={bet} onChange={setBet} max={balance} disabled={spinning} />
          )}

          {/* Real mode: connect wallet gate */}
          {isReal && !connected && <WalletGateNotice reason="wallet" />}

          {/* Spin */}
          {(!isReal || connected) && (
            <motion.button
              whileHover={canSpin ? { scale: 1.03, y: -2 } : {}}
              whileTap={canSpin ? { scale: 0.97 } : {}}
              onClick={spin}
              disabled={!canSpin}
              className="w-full py-4 rounded-xl font-cinzel font-black text-sm tracking-[0.22em] uppercase bg-gradient-to-r from-purple-600 to-purple-800 text-white neon-purple border border-purple-400/40 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              data-testid="button-spin"
            >
              {spinning
                ? isReal
                  ? chainStatus === "approving"
                    ? "Approving…"
                    : chainStatus === "committing"
                    ? "Preparing Bet…"
                    : chainStatus === "pending"
                    ? "Placing Bet…"
                    : "Spinning…"
                  : "Spinning…"
                : `Spin — ${betLabel(betType)}`}
            </motion.button>
          )}

          {isReal && chainError && (
            <p className="text-xs text-red-400/80" data-testid="roulette-chain-error">{chainError}</p>
          )}

          {/* Reset */}
          {!isReal && balance <= 0 && !spinning && !gated && (
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              onClick={() => { resetBalance(); setResult(null); setWinAmount(null); }}
              className="w-full py-3 rounded-xl font-cinzel font-bold text-sm tracking-widest uppercase glass border border-purple-500/40 text-purple-300"
            >
              Reset Balance
            </motion.button>
          )}
        </div>
      </div>
    </GameLayout>
  );
}
