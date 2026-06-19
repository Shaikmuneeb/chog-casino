import { motion } from "framer-motion";
import { useState } from "react";
import { useLocation } from "wouter";

interface Game {
  id: string;
  name: string;
  description: string;
  emoji: string;
  multiplier: string;
  tag: string;
  tagColor: string;
  gradient: string;
  borderColor: string;
  glowColor: string;
  comingSoon?: boolean;
}

const games: Game[] = [
  {
    id: "coin-flip",
    name: "Coin Flip",
    description: "Double or nothing. Call it right and double your bet. The purest test of fate.",
    emoji: "🪙",
    multiplier: "2x",
    tag: "HOT",
    tagColor: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
    gradient: "from-yellow-900/30 via-purple-900/20 to-transparent",
    borderColor: "border-yellow-500/30 hover:border-yellow-400/60",
    glowColor: "hover:shadow-[0_0_30px_rgba(234,179,8,0.3)]",
  },
  {
    id: "mines",
    name: "Mines",
    description: "Navigate the minefield. The deeper you go, the bigger the reward—or explosion.",
    emoji: "💣",
    multiplier: "Up to 100x",
    tag: "POPULAR",
    tagColor: "bg-purple-500/20 text-purple-300 border-purple-500/40",
    gradient: "from-purple-900/40 via-purple-900/20 to-transparent",
    borderColor: "border-purple-500/30 hover:border-purple-400/60",
    glowColor: "hover:shadow-[0_0_30px_rgba(168,85,247,0.3)]",
  },
  {
    id: "roulette",
    name: "Roulette",
    description: "The wheel of fortune spins. Pick your number, color, or range and let fate decide.",
    emoji: "🎡",
    multiplier: "35x",
    tag: "CLASSIC",
    tagColor: "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40",
    gradient: "from-fuchsia-900/30 via-purple-900/20 to-transparent",
    borderColor: "border-fuchsia-500/30 hover:border-fuchsia-400/60",
    glowColor: "hover:shadow-[0_0_30px_rgba(217,70,239,0.3)]",
  },
  {
    id: "blackjack",
    name: "Blackjack",
    description: "Beat the dealer to 21. Skill meets strategy in this timeless casino staple.",
    emoji: "🃏",
    multiplier: "2.5x",
    tag: "SKILL",
    tagColor: "bg-green-500/20 text-green-300 border-green-500/40",
    gradient: "from-green-900/20 via-purple-900/20 to-transparent",
    borderColor: "border-green-500/30 hover:border-green-400/60",
    glowColor: "hover:shadow-[0_0_30px_rgba(74,222,128,0.25)]",
  },
];

function GameCard({ game, index }: { game: Game; index: number }) {
  const [hovered, setHovered] = useState(false);
  const [, setLocation] = useLocation();

  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      className={`relative group cursor-pointer rounded-2xl glass ${game.borderColor} border transition-all duration-300 ${game.glowColor} overflow-hidden`}
      data-testid={`game-card-${game.id}`}
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${game.gradient} opacity-60`} />

      <div className="relative p-6 sm:p-8">
        <div className="flex items-start justify-between mb-4">
          <h3
            className="font-cinzel font-bold text-2xl text-white tracking-wide"
            data-testid={`game-name-${game.id}`}
          >
            {game.name}
          </h3>
          <span
            className={`text-[10px] font-bold tracking-[0.2em] px-2.5 py-1 rounded-full border ${game.tagColor}`}
            data-testid={`game-tag-${game.id}`}
          >
            {game.tag}
          </span>
        </div>

        <p
          className="text-sm text-purple-200/60 leading-relaxed mb-6"
          data-testid={`game-description-${game.id}`}
        >
          {game.description}
        </p>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-purple-300/50 tracking-widest uppercase mb-1">
              Max Win
            </div>
            <div
              className="font-cinzel font-bold text-xl text-neon-gold"
              data-testid={`game-multiplier-${game.id}`}
            >
              {game.multiplier}
            </div>
          </div>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setLocation(`/games/${game.id}`)}
            className="px-6 py-3 rounded-xl font-cinzel font-bold text-xs tracking-[0.15em] uppercase bg-gradient-to-r from-purple-600 to-purple-800 text-white border border-purple-400/30 hover:border-purple-400/60 transition-all duration-200 neon-purple"
            data-testid={`button-play-${game.id}`}
          >
            Play Now
          </motion.button>
        </div>
      </div>

      <motion.div
        className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-purple-500 to-yellow-400"
        initial={{ scaleX: 0, originX: 0 }}
        animate={{ scaleX: hovered ? 1 : 0 }}
        transition={{ duration: 0.3 }}
      />
    </motion.div>
  );
}

export default function GameCards() {
  return (
    <section className="py-16 px-4" data-testid="games-section">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
          data-testid="games-header"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass border border-purple-500/30 mb-4">
            <span className="text-xs text-purple-300 tracking-widest uppercase font-medium">
              Featured Games
            </span>
          </div>
          <h2 className="font-cinzel font-black text-4xl sm:text-5xl text-white tracking-wider mb-4">
            Choose Your{" "}
            <span className="gradient-purple-gold">Game</span>
          </h2>
          <p className="text-purple-200/60 max-w-xl mx-auto leading-relaxed">
            Four legendary games, infinite possibilities. Connect your wallet and start winning.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6" data-testid="games-grid">
          {games.map((game, i) => (
            <GameCard key={game.id} game={game} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
