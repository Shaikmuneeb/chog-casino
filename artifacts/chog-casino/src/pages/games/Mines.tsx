import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import GameLayout from "@/components/GameLayout";
import bgImage from "@assets/image_1781811958820.png";
import diamondImg from "@assets/chog_mines_diamond_1781814946879.png";
import bombImg from "@assets/chog_mines_2_1781814964561.png";

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
  const [bet, setBet] = useState("100");
  const [mineCount, setMineCount] = useState(5);
  const [grid, setGrid] = useState<CellState[]>(Array(GRID_SIZE).fill("hidden"));
  const [revealed, setRevealed] = useState<boolean[]>(Array(GRID_SIZE).fill(false));
  const [gameState, setGameState] = useState<"idle" | "playing" | "dead" | "cashed">("idle");
  const [multiplier, setMultiplier] = useState(1);
  const [safeRevealed, setSafeRevealed] = useState(0);

  const start = () => {
    const newGrid = generateGrid(mineCount);
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
        setGameState("dead");
        setRevealed(Array(GRID_SIZE).fill(true));
      } else {
        const safe = safeRevealed + 1;
        setSafeRevealed(safe);
        setMultiplier(calcMultiplier(safe, mineCount));
      }
    },
    [gameState, grid, revealed, safeRevealed, mineCount]
  );

  const cashOut = () => {
    if (gameState !== "playing" || safeRevealed === 0) return;
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

          {/* Bet + Mines row — only when idle or after game */}
          <AnimatePresence>
            {(gameState === "idle" || isOver) && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                className="grid grid-cols-2 gap-3"
              >
                <div className="space-y-1.5">
                  <label className="text-[10px] text-purple-300/50 tracking-widest uppercase font-medium">
                    Bet ($CHOG)
                  </label>
                  <input
                    type="number"
                    value={bet}
                    onChange={(e) => setBet(e.target.value)}
                    min="1"
                    className="w-full px-3 py-2.5 rounded-xl glass border border-purple-500/30 text-white font-mono text-sm focus:outline-none focus:border-purple-400/60 transition-colors"
                    data-testid="input-mines-bet"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] text-purple-300/50 tracking-widest uppercase font-medium">
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

          {/* Quick bet presets when idle */}
          {(gameState === "idle" || isOver) && (
            <div className="flex gap-2">
              {["100", "500", "1000", "5000"].map((v) => (
                <button
                  key={v}
                  onClick={() => setBet(v)}
                  className="flex-1 py-1.5 rounded-lg text-xs glass border border-purple-700/30 text-purple-300 hover:border-purple-400/40 hover:text-purple-100 transition-colors"
                >
                  {v}
                </button>
              ))}
            </div>
          )}

          {/* Action buttons */}
          {gameState === "idle" || isOver ? (
            <motion.button
              whileHover={{ scale: 1.02, y: -1 }}
              whileTap={{ scale: 0.98 }}
              onClick={start}
              className="w-full py-4 rounded-xl font-cinzel font-black text-sm tracking-[0.2em] uppercase bg-gradient-to-r from-purple-600 to-purple-800 text-white neon-purple border border-purple-400/40 transition-all"
              data-testid="button-start-mines"
            >
              {gameState === "idle" ? "Place Bet & Start" : "Play Again"}
            </motion.button>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <motion.button
                whileHover={{ scale: 1.02, y: -1 }}
                whileTap={{ scale: 0.98 }}
                onClick={cashOut}
                disabled={safeRevealed === 0}
                className="py-4 rounded-xl font-cinzel font-black text-sm tracking-[0.15em] uppercase bg-gradient-to-r from-green-600 to-green-800 text-white border border-green-400/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                data-testid="button-cashout"
              >
                Cash Out {multiplier}×
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02, y: -1 }}
                whileTap={{ scale: 0.98 }}
                onClick={start}
                className="py-4 rounded-xl font-cinzel font-bold text-sm tracking-[0.15em] uppercase glass border border-purple-500/40 text-purple-200 hover:border-purple-400/60 transition-all"
                data-testid="button-restart"
              >
                Restart
              </motion.button>
            </div>
          )}
        </div>
      </div>
    </GameLayout>
  );
}
