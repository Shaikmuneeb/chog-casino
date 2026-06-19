import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import GameLayout from "@/components/GameLayout";
import BetControls from "@/components/BetControls";
import WalletGateNotice from "@/components/WalletGateNotice";
import { useGameBalance } from "@/hooks/useGameBalance";
import bgImage from "@assets/image_1781811958820.png";
import diamondImg from "@assets/chog_mines_diamond_1781814946879.png";
import bombImg from "@assets/chog_mines_2_1781814964561.png";

// ── Audio helpers ─────────────────────────────────────────────────────────────
function tryPlayUrl(url: string) {
  try {
    const audio = new Audio(url);
    audio.volume = 0.5;
    audio.play().catch(() => undefined);
  } catch {
    // silently ignore
  }
}

function webAudioDing() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const freqs = [880, 1108, 1318];
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.07 + 0.3);
      osc.start(ctx.currentTime + i * 0.07);
      osc.stop(ctx.currentTime + i * 0.07 + 0.35);
    });
  } catch { undefined; }
}

function webAudioBoom() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const bufferSize = ctx.sampleRate * 0.8;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2.5);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(1.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 200;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start();
  } catch { undefined; }
}

function playSafe() {
  tryPlayUrl("https://freesound.org/data/previews/66/66930_931655-lq.mp3");
  webAudioDing();
}

function playBomb() {
  tryPlayUrl("https://freesound.org/data/previews/276/276951_5123854-lq.mp3");
  webAudioBoom();
}
// ─────────────────────────────────────────────────────────────────────────────

const GRID_SIZE = 25;

type CellState = "hidden" | "safe" | "mine";

function generateGrid(mineCount: number): CellState[] {
  const grid: CellState[] = Array(GRID_SIZE).fill("hidden");
  const positions = new Set<number>();
  while (positions.size < mineCount) {
    positions.add(Math.floor(Math.random() * GRID_SIZE));
  }
  positions.forEach((i) => (grid[i] = "mine"));
  return grid;
}

function calcMultiplier(safe: number, mines: number): number {
  if (safe === 0) return 1;
  const safeTiles = GRID_SIZE - mines;
  let mult = 1;
  for (let i = 0; i < safe; i++) {
    mult *= (GRID_SIZE - mines - i) / (GRID_SIZE - i);
  }
  return parseFloat((1 / mult).toFixed(2));
}

const MINE_OPTIONS = Array.from({ length: 25 }, (_, i) => i + 1);

export default function Mines() {
  const [bet, setBet] = useState(100);
  const [mineCount, setMineCount] = useState(5);
  const [grid, setGrid] = useState<CellState[]>(Array(GRID_SIZE).fill("hidden"));
  const [revealed, setRevealed] = useState<boolean[]>(Array(GRID_SIZE).fill(false));
  const [gameState, setGameState] = useState<"idle" | "playing" | "dead" | "cashed">("idle");
  const [multiplier, setMultiplier] = useState(1);
  const [safeRevealed, setSafeRevealed] = useState(0);

  const { balance, updateBalance, resetBalance, needsWallet, currencyLabel } = useGameBalance();
  const canStart = !needsWallet && bet > 0 && bet <= balance;

  const start = () => {
    if (!canStart) return;
    const newGrid = generateGrid(mineCount);
    updateBalance(b => b - bet); // stake is deducted upfront; cashing out pays it back × multiplier
    setGrid(newGrid);
    setRevealed(Array(GRID_SIZE).fill(false));
    setGameState("playing");
    setMultiplier(1);
    setSafeRevealed(0);
  };

  const reveal = useCallback(
    (index: number) => {
      if (gameState !== "playing" || revealed[index]) return;
      const newRevealed = [...revealed];
      newRevealed[index] = true;
      setRevealed(newRevealed);

      if (grid[index] === "mine") {
        playBomb();
        setGameState("dead");
        setRevealed(Array(GRID_SIZE).fill(true));
      } else {
        playSafe();
        const safe = safeRevealed + 1;
        setSafeRevealed(safe);
        setMultiplier(calcMultiplier(safe, mineCount));
      }
    },
    [gameState, grid, revealed, safeRevealed, mineCount]
  );

  const cashOut = () => {
    if (gameState !== "playing" || safeRevealed === 0) return;
    updateBalance(b => b + Math.round(bet * multiplier));
    setGameState("cashed");
    setRevealed(Array(GRID_SIZE).fill(true));
  };

  const isActive = gameState === "playing";
  const isOver = gameState === "dead" || gameState === "cashed";

  return (
    <GameLayout
      title="MINES"
      subtitle="Navigate to Win"
      bgImage={bgImage}
      accentColor="text-neon-purple"
    >
      <div className="glass rounded-2xl border border-purple-500/20 overflow-hidden">

        {/* Stats bar — only when in game */}
        <AnimatePresence>
          {gameState !== "idle" && (
            <motion.div
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center justify-between px-6 py-3 border-b border-purple-500/15"
            >
              <div className="text-center">
                <div className="text-[10px] text-purple-300/40 tracking-widest uppercase mb-0.5">Multiplier</div>
                <div className="font-cinzel font-bold text-xl text-yellow-300">{multiplier}×</div>
              </div>
              <div className="text-center">
                <div className="text-[10px] text-purple-300/40 tracking-widest uppercase mb-0.5">Safe Found</div>
                <div className="font-cinzel font-bold text-xl text-green-400">{safeRevealed}</div>
              </div>
              <div className="text-center">
                <div className="text-[10px] text-purple-300/40 tracking-widest uppercase mb-0.5">Mines</div>
                <div className="font-cinzel font-bold text-xl text-red-400">{mineCount}</div>
              </div>
              <AnimatePresence mode="wait">
                {gameState === "dead" && (
                  <motion.div
                    key="dead"
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="font-cinzel font-black text-base text-red-400 tracking-widest"
                  >
                    BOOM!
                  </motion.div>
                )}
                {gameState === "cashed" && (
                  <motion.div
                    key="cashed"
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="font-cinzel font-black text-base text-green-400 tracking-widest"
                  >
                    CASHED OUT
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Grid */}
        <div className="p-4 sm:p-5">
          <div className="grid grid-cols-5 gap-1.5" data-testid="mines-grid">
            {Array(GRID_SIZE).fill(null).map((_, i) => {
              const isRevealed = revealed[i];
              const isMine = grid[i] === "mine";
              const isClickable = isActive && !isRevealed;

              return (
                <motion.button
                  key={i}
                  whileHover={isClickable ? { scale: 1.07, y: -1 } : {}}
                  whileTap={isClickable ? { scale: 0.93 } : {}}
                  onClick={() => reveal(i)}
                  disabled={!isClickable}
                  initial={false}
                  animate={
                    isRevealed
                      ? { scale: [0.85, 1.05, 1], opacity: 1 }
                      : { scale: 1, opacity: gameState === "idle" ? 0.5 : 1 }
                  }
                  transition={{ duration: 0.25 }}
                  className={`aspect-square rounded-lg flex items-center justify-center border transition-colors duration-150 ${
                    !isRevealed
                      ? gameState === "idle"
                        ? "glass border-purple-700/20 cursor-default"
                        : "glass border-purple-500/40 hover:border-purple-400/70 cursor-pointer"
                      : isMine
                      ? "bg-red-950/70 border-red-500/50"
                      : "bg-purple-950/60 border-green-500/30"
                  }`}
                  data-testid={`mines-cell-${i}`}
                >
                  {isRevealed && (
                    <img
                      src={isMine ? bombImg : diamondImg}
                      alt={isMine ? "bomb" : "diamond"}
                      className="w-[78%] h-[78%] object-contain"
                    />
                  )}
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Controls at the bottom */}
        <div className="px-4 sm:px-5 pb-5 space-y-3 border-t border-purple-500/10 pt-4">

          {/* Balance row */}
          <div className="flex items-center justify-between px-1">
            <div className="text-[10px] text-purple-300/40 tracking-widest uppercase">Balance</div>
            <div className="font-cinzel font-bold text-lg text-yellow-300">
              {balance.toLocaleString()} <span className="text-xs text-yellow-400/60">{currencyLabel}</span>
            </div>
          </div>

          {/* Real mode requires a wallet */}
          {needsWallet && (gameState === "idle" || isOver) && <WalletGateNotice />}

          {/* Bet + Mines row — only when idle or after game */}
          <AnimatePresence>
            {(gameState === "idle" || isOver) && !needsWallet && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                className="space-y-3"
              >
                <div className="space-y-1.5">
                  <label className="text-[10px] text-purple-300/50 tracking-widest uppercase font-medium block">
                    Bet ({currencyLabel})
                  </label>
                  <BetControls value={bet} onChange={setBet} max={balance} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] text-purple-300/50 tracking-widest uppercase font-medium block">
                    Mines
                  </label>
                  <select
                    value={mineCount}
                    onChange={(e) => setMineCount(Number(e.target.value))}
                    className="w-full px-3 py-2.5 rounded-xl glass border border-purple-500/30 text-white bg-transparent text-sm focus:outline-none focus:border-purple-400/60 transition-colors appearance-none cursor-pointer"
                    data-testid="select-mine-count"
                  >
                    {MINE_OPTIONS.map((n) => (
                      <option key={n} value={n} className="bg-[#150828]">
                        {n} {n === 1 ? "mine" : "mines"}
                      </option>
                    ))}
                  </select>
                </div>
              </motion.div>
            )}
          </AnimatePresence>


          {/* Action buttons */}
          {(gameState === "idle" || isOver) && needsWallet ? null : gameState === "idle" || isOver ? (
            <>
              <motion.button
                whileHover={canStart ? { scale: 1.02, y: -1 } : {}}
                whileTap={canStart ? { scale: 0.98 } : {}}
                onClick={start}
                disabled={!canStart}
                className="w-full py-4 rounded-xl font-cinzel font-black text-sm tracking-[0.2em] uppercase bg-gradient-to-r from-purple-600 to-purple-800 text-white neon-purple border border-purple-400/40 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                data-testid="button-start-mines"
              >
                {balance <= 0 ? `Out of ${currencyLabel}` : gameState === "idle" ? "Place Bet & Start" : "Play Again"}
              </motion.button>
              {balance <= 0 && (
                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  onClick={resetBalance}
                  className="w-full py-3 rounded-xl font-cinzel font-bold text-sm tracking-widest uppercase glass border border-purple-500/40 text-purple-300"
                  data-testid="button-reset-balance"
                >
                  Reset Balance
                </motion.button>
              )}
            </>
          ) : (
            <motion.button
              whileHover={{ scale: 1.02, y: -1 }}
              whileTap={{ scale: 0.98 }}
              onClick={cashOut}
              disabled={safeRevealed === 0}
              className="w-full py-4 rounded-xl font-cinzel font-black text-sm tracking-[0.15em] uppercase bg-gradient-to-r from-green-600 to-green-800 text-white border border-green-400/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              data-testid="button-cashout"
            >
              Cash Out {multiplier}×
            </motion.button>
          )}
        </div>
      </div>
    </GameLayout>
  );
}
