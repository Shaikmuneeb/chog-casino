import { motion } from "framer-motion";
import { Coins, Gamepad2 } from "lucide-react";
import { useGameMode, type GameMode } from "@/context/GameModeContext";

const OPTIONS: { value: GameMode; label: string; icon: typeof Coins }[] = [
  { value: "real", label: "Real", icon: Coins },
  { value: "fun", label: "Fun", icon: Gamepad2 },
];

export default function GameModeToggle() {
  const { mode, setMode } = useGameMode();

  return (
    <div
      className="relative inline-flex items-center gap-1 p-1 rounded-full bg-[#0a0618]/80 border border-purple-500/25 backdrop-blur-sm"
      data-testid="game-mode-toggle"
      role="tablist"
      aria-label="Game mode"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setMode(value)}
            className="relative z-10 flex items-center gap-1.5 px-3.5 sm:px-4 py-1.5 rounded-full text-xs font-bold tracking-widest uppercase transition-colors duration-200 outline-none"
            data-testid={`game-mode-${value}`}
          >
            {active && (
              <motion.span
                layoutId="game-mode-active-pill"
                transition={{ type: "spring", stiffness: 500, damping: 34 }}
                className="absolute inset-0 -z-10 rounded-full bg-gradient-to-r from-purple-600 to-violet-600 shadow-[0_0_18px_rgba(147,51,234,0.55)]"
              />
            )}
            <Icon className={`w-3.5 h-3.5 ${active ? "text-white" : "text-purple-300/40"}`} />
            <span className={active ? "text-white" : "text-purple-300/40"}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
