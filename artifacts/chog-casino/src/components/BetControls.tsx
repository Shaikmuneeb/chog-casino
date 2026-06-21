import { motion } from "framer-motion";

interface BetControlsProps {
  value: number;
  onChange: (v: number) => void;
  max: number;
  disabled?: boolean;
  step?: number;
  unitLabel?: string;
}


export default function BetControls({ value, onChange, max, disabled = false, step = 50, unitLabel = "$CHOG" }: BetControlsProps) {
  const set = (n: number) => onChange(Math.max(1, Math.min(max, Math.round(n))));

  const btn = "flex items-center justify-center rounded-lg font-cinzel font-black text-xs tracking-wider transition-all duration-150 border disabled:opacity-40 disabled:cursor-not-allowed select-none";

  return (
    <div className="space-y-2">
      {/* Main row: − display + */}
      <div className="flex items-stretch gap-2">
        {/* − */}
        <motion.button
          whileTap={!disabled ? { scale: 0.88 } : {}}
          onClick={() => set(value - step)}
          disabled={disabled || value <= 1}
          className={`${btn} w-10 h-10 glass border-purple-500/30 text-purple-200 hover:border-purple-400/60 hover:bg-purple-700/20 text-lg`}
        >
          −
        </motion.button>

        {/* Bet display */}
        <div className="flex-1 flex items-center justify-center gap-1.5 glass border border-purple-500/30 rounded-xl px-3 py-2 min-w-0">
          <span className="font-cinzel font-black text-lg text-white tabular-nums truncate">
            {value.toLocaleString()}
          </span>
          <span className="text-xs text-yellow-400/70 font-medium shrink-0">{unitLabel}</span>
        </div>

        {/* + */}
        <motion.button
          whileTap={!disabled ? { scale: 0.88 } : {}}
          onClick={() => set(value + step)}
          disabled={disabled || value >= max}
          className={`${btn} w-10 h-10 glass border-purple-500/30 text-purple-200 hover:border-purple-400/60 hover:bg-purple-700/20 text-lg`}
        >
          +
        </motion.button>

        {/* Divider */}
        <div className="w-px bg-purple-500/20 self-stretch" />

        {/* ½ */}
        <motion.button
          whileTap={!disabled ? { scale: 0.88 } : {}}
          onClick={() => set(value / 2)}
          disabled={disabled}
          className={`${btn} px-3 h-10 glass border-purple-500/30 text-purple-200 hover:border-purple-400/60 hover:bg-purple-700/20`}
        >
          ½
        </motion.button>

        {/* 2× */}
        <motion.button
          whileTap={!disabled ? { scale: 0.88 } : {}}
          onClick={() => set(value * 2)}
          disabled={disabled}
          className={`${btn} px-3 h-10 glass border-yellow-500/30 text-yellow-300 hover:border-yellow-400/60 hover:bg-yellow-500/10`}
        >
          2×
        </motion.button>
      </div>

    </div>
  );
}
