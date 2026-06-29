import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { formatUnits } from "viem";
import { Loader2 } from "lucide-react";
import GameLayout from "@/components/GameLayout";
import BetControls from "@/components/BetControls";
import TokenSelector from "@/components/TokenSelector";
import WalletGateNotice from "@/components/WalletGateNotice";
import { useGameBalance } from "@/hooks/useGameBalance";
import { useGameMode } from "@/context/GameModeContext";
import { useWallet } from "@/hooks/useWallet";
import { usePlinkoOnChain } from "@/hooks/usePlinkoOnChain";
import { publicClient } from "@/lib/casinoClient";
import { CUSTODIAL_VAULT_ABI, TOKENS, isDeployed, CONTRACTS, type SupportedToken } from "@/config/contracts";
import bgImage from "@assets/plinko/plinko-cover.png";

// ── Audio ────────────────────────────────────────────────────────────────────
let _plinkoCtx: AudioContext | null = null;
let _plinkoMuted = false;

function plinkoCtx(): AudioContext | null {
  try {
    if (!_plinkoCtx) {
      _plinkoCtx = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    if (_plinkoCtx.state === "suspended") _plinkoCtx.resume();
    return _plinkoCtx;
  } catch {
    return null;
  }
}

function playBounce() {
  if (_plinkoMuted) return;
  const ctx = plinkoCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(1200 + Math.random() * 600, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.05);
  gain.gain.setValueAtTime(0.12, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.07);
}

function playLand(won: boolean) {
  if (_plinkoMuted) return;
  const ctx = plinkoCtx();
  if (!ctx) return;
  const notes = won ? [523, 659, 784] : [330, 262];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = won ? "sine" : "triangle";
    osc.frequency.value = freq;
    const start = ctx.currentTime + i * 0.1;
    gain.gain.setValueAtTime(0.12, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.35);
  });
}
// ─────────────────────────────────────────────────────────────────────────────

type Risk = "low" | "medium" | "high";

const RISK_LABELS: Record<Risk, { label: string; cls: string }> = {
  low:    { label: "Low",    cls: "bg-green-600/30 border-green-400/40 text-green-200" },
  medium: { label: "Medium", cls: "bg-yellow-600/30 border-yellow-400/40 text-yellow-200" },
  high:   { label: "High",   cls: "bg-red-600/30 border-red-400/40 text-red-200" },
};

// Payout tables per risk × rows — house edge ~1%
const MULTIPLIERS: Record<Risk, Record<number, number[]>> = {
  low: {
    8:  [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
    9:  [5.6, 2, 1.6, 1, 0.7, 1, 1.6, 2, 5.6],
    10: [8.9, 3, 1.4, 1.1, 0.5, 0.5, 1.1, 1.4, 3, 8.9],
    11: [8.4, 3, 1.9, 1.3, 0.7, 0.7, 0.7, 1.3, 1.9, 3, 8.4],
    12: [10, 3, 1.6, 1.4, 1.1, 0.5, 0.5, 1.1, 1.4, 1.6, 3, 10],
    13: [8.1, 4, 2, 1.4, 1.3, 0.7, 0.7, 0.7, 1.3, 1.4, 2, 4, 8.1],
    14: [7.1, 4, 2.1, 1.9, 1.3, 1.1, 0.5, 0.5, 1.1, 1.3, 1.9, 2.1, 4, 7.1],
    15: [15, 8, 3, 2, 1.5, 1.1, 0.7, 0.7, 0.7, 1.1, 1.5, 2, 3, 8, 15],
    16: [16, 9, 2, 1.4, 1.4, 1.1, 1, 0.5, 0.5, 1, 1.1, 1.4, 1.4, 2, 9, 16],
  },
  medium: {
    8:  [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
    9:  [18, 4, 1.7, 0.9, 0.5, 0.5, 0.9, 1.7, 4, 18],
    10: [22, 5, 2, 1.4, 0.6, 0.4, 0.6, 1.4, 2, 5, 22],
    11: [24, 6, 3, 1.8, 0.7, 0.5, 0.5, 0.7, 1.8, 3, 6, 24],
    12: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
    13: [43, 13, 6, 3, 1.3, 0.7, 0.4, 0.4, 0.7, 1.3, 3, 6, 13, 43],
    14: [58, 15, 7, 4, 2, 1, 0.5, 0.2, 0.5, 1, 2, 4, 7, 15, 58],
    15: [88, 18, 11, 5, 3, 1.3, 0.7, 0.4, 0.4, 0.7, 1.3, 3, 5, 11, 18, 88],
    16: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
  },
  high: {
    8:  [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
    9:  [43, 7, 2, 0.6, 0.2, 0.2, 0.6, 2, 7, 43],
    10: [76, 10, 3, 0.9, 0.3, 0.2, 0.3, 0.9, 3, 10, 76],
    11: [120, 14, 5.2, 1.4, 0.4, 0.2, 0.2, 0.4, 1.4, 5.2, 14, 120],
    12: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
    13: [260, 37, 11, 4, 1, 0.2, 0.2, 0.2, 0.2, 1, 4, 11, 37, 260],
    14: [420, 56, 18, 5, 1.9, 0.3, 0.2, 0.2, 0.2, 0.3, 1.9, 5, 18, 56, 420],
    15: [620, 83, 27, 8, 3, 0.5, 0.2, 0.2, 0.2, 0.2, 0.5, 3, 8, 27, 83, 620],
    16: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000],
  },
};

const ROW_OPTIONS = [8, 9, 10, 11, 12, 13, 14, 15, 16];

// SVG geometry
const BOARD_W = 360;
const BOARD_H = 420;
const PIN_R = 4;
const ROW_GAP = BOARD_H / 18;
const TOP_Y = 30;
const LEFT_MARGIN = 30;
const RIGHT_MARGIN = 30;
const PIN_AREA_W = BOARD_W - LEFT_MARGIN - RIGHT_MARGIN;

function pinX(row: number, col: number, totalRows: number): number {
  const pinsInRow = row + 1;
  const spacing = PIN_AREA_W / (totalRows);
  const rowOffset = (totalRows - pinsInRow) * spacing / 2;
  return LEFT_MARGIN + rowOffset + col * spacing + spacing / 2;
}

function pinY(row: number): number {
  return TOP_Y + row * ROW_GAP;
}

/** Simulate ball path — returns array of {row, col, x, y} positions */
function simulatePath(rows: number): { row: number; col: number; x: number; y: number }[] {
  const path: { row: number; col: number; x: number; y: number }[] = [];
  let col = 0; // starts at left of row 0

  for (let row = 0; row < rows; row++) {
    const goRight = Math.random() < 0.5;
    if (goRight) col += 1;
    path.push({ row, col, x: pinX(row, col, rows), y: pinY(row) });
  }

  // Final slot = col (0..rows)
  return path;
}

function getSlotColor(slotIndex: number, totalSlots: number): string {
  const edge = totalSlots <= 4 ? 2 : Math.max(2, Math.floor(totalSlots * 0.15));
  if (slotIndex < edge || slotIndex >= totalSlots - edge) return "#facc15";
  if (slotIndex < edge * 2 || slotIndex >= totalSlots - edge * 2) return "#a855f7";
  return "#6366f1";
}

export default function Plinko() {
  const { mode } = useGameMode();
  const isReal = mode === "real";
  const { address, connected } = useWallet();

  const [bet, setBet] = useState(100);
  const [risk, setRisk] = useState<Risk>("low");
  const [rows, setRows] = useState(12);
  const [dropping, setDropping] = useState(false);
  const [result, setResult] = useState<{ slot: number; multiplier: number; won: boolean } | null>(null);
  const [winAmount, setWinAmount] = useState<number | null>(null);
  const [ballPath, setBallPath] = useState<{ row: number; col: number; x: number; y: number }[]>([]);
  const [ballIdx, setBallIdx] = useState(-1);
  const [muted, setMuted] = useState(false);
  const [history, setHistory] = useState<{ slot: number; multiplier: number; won: boolean }[]>([]);

  const { balance, updateBalance, resetBalance, gated, showBalance, currencyLabel } = useGameBalance();

  const animRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Real-mode on-chain state
  const [realToken, setRealToken] = useState<"MON" | "USDC" | "CHOG">("MON");
  const [realBetAmount, setRealBetAmount] = useState(1);
  const [realBalanceRaw, setRealBalanceRaw] = useState(0n);
  const [txError, setTxError] = useState<string | null>(null);
  useEffect(() => {
    return () => animRef.current.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    setDropping(false);
    setResult(null);
    setWinAmount(null);
    setBallPath([]);
    setBallIdx(-1);
    setTxError(null);
  }, [isReal]);

  const multipliers = MULTIPLIERS[risk][rows];
  const totalSlots = multipliers.length;

  // Fetch vault balance for real mode
  useEffect(() => {
    if (!isReal || !connected || !address) return;
    const tokenInfo = TOKENS[realToken];
    const fetchBalance = async () => {
      try {
        const bal = await publicClient.readContract({
          address: CONTRACTS.custodialVault,
          abi: CUSTODIAL_VAULT_ABI,
          functionName: "balanceOf",
          args: [address as `0x${string}`, tokenInfo.address],
        });
        setRealBalanceRaw(bal as bigint);
      } catch { /* ignore */ }
    };
    fetchBalance();
    const id = setInterval(fetchBalance, 15_000);
    return () => clearInterval(id);
  }, [isReal, connected, address, realToken]);

  const { placeBetFromVault } = usePlinkoOnChain();

  const canDrop = isReal
    ? !dropping && connected && realBetAmount > 0 && isDeployed(CONTRACTS.plinko)
    : !dropping && !gated && bet > 0 && bet <= balance;

  const doDrop = useCallback(async () => {
    if (!canDrop) return;
    plinkoCtx();
    setDropping(true);
    setResult(null);
    setWinAmount(null);
    setBallIdx(-1);
    setTxError(null);

    // Generate local path for animation
    const path = simulatePath(rows);
    setBallPath(path);

    const STEP_MS = 60;
    let cancelled = false;

    if (isReal) {
      // Animate ball locally while awaiting on-chain resolution
      path.forEach((_, i) => {
        const t = setTimeout(() => {
          if (cancelled) return;
          setBallIdx(i);
          playBounce();
        }, i * STEP_MS);
        animRef.current.push(t);
      });

      try {
        const outcome = await placeBetFromVault(realToken, String(realBetAmount), rows);
        const finalSlot = outcome.slot;
        const mult = MULTIPLIERS[risk][rows][finalSlot];
        const won = outcome.won;
        setResult({ slot: finalSlot, multiplier: mult, won });
        setWinAmount(won ? Number(Number(formatUnits(outcome.payoutAmount, TOKENS[realToken].decimals)) - realBetAmount) : -realBetAmount);
        setHistory((prev) => [{ slot: finalSlot, multiplier: mult, won }, ...prev].slice(0, 20));
        playLand(won);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setTxError(msg.includes("rejected") ? "Transaction rejected" : msg.includes("operator") ? "Operator offline — try again" : msg);
      } finally {
        cancelled = true;
        animRef.current.forEach(clearTimeout);
        animRef.current = [];
        setDropping(false);
        setBallIdx(-1);
        setBallPath([]);
      }
    } else {
      // Fun mode — simulate locally
      const finalSlot = path[path.length - 1].col;
      const multiplier = multipliers[finalSlot];

      path.forEach((_, i) => {
        const t = setTimeout(() => {
          setBallIdx(i);
          playBounce();
        }, i * STEP_MS);
        animRef.current.push(t);
      });

      const totalMs = path.length * STEP_MS + 200;
      const t = setTimeout(() => {
        const won = multiplier >= 1;
        const payout = bet * multiplier;
        setResult({ slot: finalSlot, multiplier, won });
        setWinAmount(won ? payout - bet : -bet);
        setHistory((prev) => [{ slot: finalSlot, multiplier, won }, ...prev].slice(0, 20));
        if (won) updateBalance((b) => b + Math.round(payout));
        playLand(won);
        setDropping(false);
        setBallIdx(-1);
        setBallPath([]);
      }, totalMs);
      animRef.current.push(t);
    }
  }, [canDrop, rows, multipliers, bet, isReal, realBetAmount, realToken, risk, updateBalance, placeBetFromVault]);

  const toggleMute = () => {
    setMuted((m) => { _plinkoMuted = !m; return !m; });
  };

  return (
    <GameLayout title="PLINKO" subtitle="Drop & Win" bgImage={bgImage} accentColor="text-yellow-400">
      <div className="glass rounded-2xl border border-yellow-500/20 overflow-hidden">

        {/* Balance bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-yellow-500/15">
          {isReal ? (
            connected ? (
              <div>
                <div className="text-[10px] text-purple-300/40 tracking-widest uppercase mb-0.5">Vault Balance</div>
                <div className="font-cinzel font-bold text-lg text-yellow-300">
                  {Number(formatUnits(realBalanceRaw, TOKENS[realToken].decimals)).toLocaleString(undefined, { maximumFractionDigits: 4 })} <span className="text-xs text-yellow-400/60">{realToken}</span>
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
          <div className="flex items-center gap-3">
            <AnimatePresence>
              {winAmount !== null && !dropping && (
                <motion.div
                  key={String(winAmount)}
                  initial={{ opacity: 0, x: 12, scale: 0.85 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className={`font-cinzel font-bold text-sm tracking-wider ${winAmount > 0 ? "text-green-400" : "text-red-400"}`}
                >
                  {winAmount > 0 ? "+" : ""}{winAmount.toLocaleString()} {currencyLabel}
                </motion.div>
              )}
            </AnimatePresence>
            <button onClick={toggleMute} className="text-purple-300/50 hover:text-white text-xs">{muted ? "🔇" : "🔊"}</button>
          </div>
        </div>

        <div className="p-4 sm:p-5 space-y-4">

          {/* Board */}
          <div className="flex justify-center">
            <div className="relative" style={{ width: BOARD_W, height: BOARD_H }}>
              <svg viewBox={`0 0 ${BOARD_W} ${BOARD_H}`} className="w-full h-full">
                {/* Background */}
                <rect x={0} y={0} width={BOARD_W} height={BOARD_H} rx={16} fill="#0a0618" stroke="#b45309" strokeWidth={2} opacity={0.9} />

                {/* Pins */}
                {Array.from({ length: rows }, (_, row) =>
                  Array.from({ length: row + 1 }, (_, col) => {
                    const x = pinX(row, col, rows);
                    const y = pinY(row);
                    const isBallHere = dropping && ballIdx >= 0 && ballIdx < ballPath.length && ballPath[ballIdx].row === row && ballPath[ballIdx].col === col;
                    return (
                      <circle
                        key={`${row}-${col}`}
                        cx={x}
                        cy={y}
                        r={isBallHere ? PIN_R + 2 : PIN_R}
                        fill={isBallHere ? "#facc15" : "#a855f7"}
                        opacity={isBallHere ? 1 : 0.7}
                      />
                    );
                  })
                )}

                {/* Slot labels at bottom */}
                {multipliers.map((mult, i) => {
                  const x = pinX(rows, i, rows);
                  const y = pinY(rows) + ROW_GAP * 0.8;
                  const color = getSlotColor(i, totalSlots);
                  return (
                    <g key={`slot-${i}`}>
                      <rect
                        x={x - 16}
                        y={y - 10}
                        width={32}
                        height={20}
                        rx={4}
                        fill={color}
                        opacity={0.25}
                      />
                      <text
                        x={x}
                        y={y + 1}
                        fill={color}
                        fontSize={9}
                        fontWeight={700}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        {mult}×
                      </text>
                    </g>
                  );
                })}

                {/* Ball */}
                {dropping && ballIdx >= 0 && ballIdx < ballPath.length && (
                  <circle
                    cx={ballPath[ballIdx].x}
                    cy={ballPath[ballIdx].y}
                    r={6}
                    fill="#facc15"
                    stroke="#fff"
                    strokeWidth={2}
                  >
                    <animate attributeName="r" values="5;7;5" dur="0.15s" repeatCount="indefinite" />
                  </circle>
                )}
              </svg>

              {/* Drop zone indicator */}
              {!dropping && (
                <div className="absolute top-1 left-1/2 -translate-x-1/2 w-8 h-2 rounded-full bg-yellow-400/40 blur-sm" />
              )}
            </div>
          </div>

          {/* Result banner */}
          <AnimatePresence>
            {result && !dropping && (
              <motion.div
                initial={{ opacity: 0, scale: 0.88, y: 4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className={`text-center py-2 px-4 rounded-xl font-cinzel font-black text-sm tracking-wider uppercase border ${
                  result.won
                    ? "bg-green-500/10 border-green-400/40 text-green-300"
                    : "bg-red-500/10 border-red-400/40 text-red-300"
                }`}
              >
                {result.won ? "WIN" : "LOSE"} — {result.multiplier}×
              </motion.div>
            )}
          </AnimatePresence>

          {/* History strip */}
          {history.length > 0 && (
            <div className="flex items-center gap-1 overflow-x-auto pb-1">
              {history.slice(0, 12).map((h, i) => (
                <span
                  key={`${i}-${h.slot}`}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                    h.won ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"
                  }`}
                >
                  {h.multiplier}×
                </span>
              ))}
            </div>
          )}

          {/* Risk selector */}
          <div>
            <div className="text-[10px] text-purple-300/50 tracking-widest uppercase mb-1.5">Risk</div>
            <div className="flex gap-2">
              {(Object.keys(RISK_LABELS) as Risk[]).map((r) => (
                <button
                  key={r}
                  onClick={() => !dropping && setRisk(r)}
                  disabled={dropping}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold tracking-widest uppercase border transition-all ${
                    RISK_LABELS[r].cls
                  } ${risk === r ? "ring-2 ring-yellow-400/50 scale-105" : ""} disabled:opacity-40`}
                >
                  {RISK_LABELS[r].label}
                </button>
              ))}
            </div>
          </div>

          {/* Rows selector */}
          <div>
            <div className="text-[10px] text-purple-300/50 tracking-widest uppercase mb-1.5">Rows: {rows}</div>
            <div className="flex gap-1 flex-wrap">
              {ROW_OPTIONS.map((r) => (
                <button
                  key={r}
                  onClick={() => !dropping && setRows(r)}
                  disabled={dropping}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                    rows === r
                      ? "bg-yellow-500/20 border-yellow-400/50 text-yellow-300 ring-1 ring-yellow-400/40"
                      : "glass border-purple-500/30 text-purple-300 hover:border-purple-400/50"
                  } disabled:opacity-40`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Bet amount */}
          {isReal ? (
            connected && (
              <>
                <TokenSelector value={realToken} onChange={setRealToken} />
                <BetControls value={realBetAmount} onChange={setRealBetAmount} max={99999} disabled={dropping} step={1} unitLabel={realToken} />
              </>
            )
          ) : (
            <BetControls value={bet} onChange={setBet} max={balance} disabled={dropping} />
          )}

          {/* Wallet gate */}
          {isReal && !connected && <WalletGateNotice reason="wallet" />}

          {/* Drop button */}
          {(!isReal || connected) && (
            <motion.button
              whileHover={canDrop ? { scale: 1.02, y: -1 } : {}}
              whileTap={canDrop ? { scale: 0.98 } : {}}
              onClick={doDrop}
              disabled={!canDrop}
              className={`w-full py-4 rounded-xl font-cinzel font-black text-sm tracking-[0.2em] uppercase transition-all ${
                dropping
                  ? "bg-purple-800/50 text-purple-300/50 border border-purple-500/30"
                  : "bg-gradient-to-r from-yellow-500 to-amber-600 text-black border border-yellow-400/40 neon-purple disabled:opacity-40 disabled:cursor-not-allowed"
              }`}
            >
              {dropping ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Dropping…
                </span>
              ) : isReal ? `Drop — ${realBetAmount} ${realToken}` : `Drop — ${bet} ${currencyLabel}`}
            </motion.button>
          )}

          {isReal && txError && (
            <p className="text-xs text-red-400/80">{txError}</p>
          )}

          {!isReal && balance <= 0 && !dropping && !gated && (
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              onClick={() => { resetBalance(); setResult(null); setWinAmount(null); setHistory([]); }}
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
