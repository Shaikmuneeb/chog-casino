import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import GameLayout from "@/components/GameLayout";
import bgImage from "@assets/image_1781811958820.png";

const GRID_SIZE = 25;
const DEFAULT_MINES = 5;

type CellState = "hidden" | "revealed" | "mine";

function generateGrid(mineCount: number): CellState[] {
  const grid: CellState[] = Array(GRID_SIZE).fill("hidden");
  const minePositions = new Set<number>();
  while (minePositions.size < mineCount) {
    minePositions.add(Math.floor(Math.random() * GRID_SIZE));
  }
  minePositions.forEach((i) => (grid[i] = "mine"));
  return grid;
}

export default function Mines() {
  const [bet, setBet] = useState("0.1");
  const [mineCount, setMineCount] = useState(DEFAULT_MINES);
  const [grid, setGrid] = useState<CellState[]>([]);
  const [revealed, setRevealed] = useState<boolean[]>(Array(GRID_SIZE).fill(false));
  const [gameState, setGameState] = useState<"idle" | "playing" | "dead" | "cashed">("idle");
  const [multiplier, setMultiplier] = useState(1);
  const [safeRevealed, setSafeRevealed] = useState(0);

  const start = () => {
    setGrid(generateGrid(mineCount));
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
        const newMult = parseFloat((1 + safe * (mineCount / (GRID_SIZE - mineCount)) * 0.5).toFixed(2));
        setMultiplier(newMult);
      }
    },
    [gameState, grid, revealed, safeRevealed, mineCount]
  );

  const cashOut = () => {
    if (gameState !== "playing") return;
    setGameState("cashed");
    setRevealed(Array(GRID_SIZE).fill(true));
  };

  return (
    <GameLayout
      title="MINES"
      subtitle="Navigate to Win"
      bgImage={bgImage}
      accentColor="text-neon-purple"
    >
      <div className="glass rounded-2xl border border-purple-500/20 p-6 sm:p-8 space-y-5">
        {gameState === "idle" && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs text-purple-300/60 tracking-widest uppercase">Bet ($CHOG)</label>
              <input
                type="number"
                value={bet}
                onChange={(e) => setBet(e.target.value)}
                className="w-full px-4 py-3 rounded-xl glass border border-purple-500/30 text-white font-mono focus:outline-none focus:border-purple-400/60"
                data-testid="input-mines-bet"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-purple-300/60 tracking-widest uppercase">Mines</label>
              <select
                value={mineCount}
                onChange={(e) => setMineCount(Number(e.target.value))}
                className="w-full px-4 py-3 rounded-xl glass border border-purple-500/30 text-white bg-transparent focus:outline-none focus:border-purple-400/60"
                data-testid="select-mine-count"
              >
                {[3, 5, 10, 15, 20].map((n) => (
                  <option key={n} value={n} className="bg-[#1a0a2e]">{n} mines</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {gameState !== "idle" && (
          <div className="flex items-center justify-between px-2">
            <div>
              <div className="text-xs text-purple-300/50 tracking-widest uppercase mb-0.5">Multiplier</div>
              <div className="font-cinzel font-bold text-2xl text-neon-gold">{multiplier}x</div>
            </div>
            <div>
              <div className="text-xs text-purple-300/50 tracking-widest uppercase mb-0.5">Safe</div>
              <div className="font-cinzel font-bold text-2xl text-green-400">{safeRevealed}</div>
            </div>
            <AnimatePresence>
              {gameState === "dead" && (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="font-cinzel font-bold text-xl text-red-400">
                  💥 BOOM!
                </motion.div>
              )}
              {gameState === "cashed" && (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="font-cinzel font-bold text-xl text-green-400">
                  🎉 CASHED OUT!
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        <div className="grid grid-cols-5 gap-2" data-testid="mines-grid">
          {Array(GRID_SIZE).fill(null).map((_, i) => {
            const isRevealed = revealed[index = i];
            const isMine = grid[i] === "mine";
            return (
              <motion.button
                key={i}
                whileHover={gameState === "playing" && !isRevealed ? { scale: 1.08 } : {}}
                whileTap={gameState === "playing" && !isRevealed ? { scale: 0.93 } : {}}
                onClick={() => reveal(i)}
                disabled={gameState !== "playing" || isRevealed}
                className={`aspect-square rounded-xl text-xl font-bold flex items-center justify-center transition-all duration-200 border ${
                  !isRevealed
                    ? "glass border-purple-500/30 hover:border-purple-400/60 cursor-pointer"
                    : isMine
                    ? "bg-red-900/60 border-red-500/60"
                    : "bg-green-900/40 border-green-500/40"
                }`}
                data-testid={`mines-cell-${i}`}
              >
                {isRevealed ? (isMine ? "💣" : "💎") : ""}
              </motion.button>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-3">
          {gameState === "idle" || gameState === "dead" || gameState === "cashed" ? (
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={start}
              className="col-span-2 py-4 rounded-xl font-cinzel font-bold text-sm tracking-[0.2em] uppercase bg-gradient-to-r from-purple-600 to-purple-800 text-white neon-purple border border-purple-400/40"
              data-testid="button-start-mines"
            >
              {gameState === "idle" ? "Start Game" : "Play Again"}
            </motion.button>
          ) : (
            <>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={cashOut}
                disabled={safeRevealed === 0}
                className="py-4 rounded-xl font-cinzel font-bold text-sm tracking-[0.15em] uppercase bg-gradient-to-r from-green-600 to-green-800 text-white border border-green-400/30 disabled:opacity-40"
                data-testid="button-cashout"
              >
                Cash Out {multiplier}x
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={start}
                className="py-4 rounded-xl font-cinzel font-bold text-sm tracking-[0.15em] uppercase glass border border-purple-500/40 text-purple-300"
                data-testid="button-restart"
              >
                Restart
              </motion.button>
            </>
          )}
        </div>
      </div>
    </GameLayout>
  );
}

let index = 0;
