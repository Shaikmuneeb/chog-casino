import { motion } from "framer-motion";
import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import ParticlesBg from "@/components/ParticlesBg";
import GameModeToggle from "@/components/GameModeToggle";
import coinFlipBg from "@assets/image_1781811951344.png";
import minesBg from "@assets/image_1781811958820.png";
import rouletteBg from "@assets/image_1781811963908.png";
import blackjackBg from "@assets/image_1781811969584.png";

interface Game {
  id: string;
  name: string;
  emoji: string;
  multiplier: string;
  tag: string;
  tagColor: string;
  borderColor: string;
  glowColor: string;
  bgImage: string;
}

const games: Game[] = [
  {
    id: "coin-flip",
    name: "Coin Flip",
    emoji: "🪙",
    multiplier: "2x",
    tag: "HOT",
    tagColor: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
    borderColor: "border-yellow-500/30 hover:border-yellow-400/60",
    glowColor: "hover:shadow-[0_0_40px_rgba(234,179,8,0.35)]",
    bgImage: coinFlipBg,
  },
  {
    id: "mines",
    name: "Mines",
    emoji: "💣",
    multiplier: "Up to 100x",
    tag: "POPULAR",
    tagColor: "bg-purple-500/20 text-purple-300 border-purple-500/40",
    borderColor: "border-purple-500/30 hover:border-purple-400/60",
    glowColor: "hover:shadow-[0_0_40px_rgba(168,85,247,0.35)]",
    bgImage: minesBg,
  },
  {
    id: "roulette",
    name: "Roulette",
    emoji: "🎡",
    multiplier: "35x",
    tag: "CLASSIC",
    tagColor: "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40",
    borderColor: "border-fuchsia-500/30 hover:border-fuchsia-400/60",
    glowColor: "hover:shadow-[0_0_40px_rgba(217,70,239,0.35)]",
    bgImage: rouletteBg,
  },
  {
    id: "blackjack",
    name: "Blackjack",
    emoji: "🃏",
    multiplier: "2.5x",
    tag: "SKILL",
    tagColor: "bg-green-500/20 text-green-300 border-green-500/40",
    borderColor: "border-green-500/30 hover:border-green-400/60",
    glowColor: "hover:shadow-[0_0_40px_rgba(74,222,128,0.30)]",
    bgImage: blackjackBg,
  },
];

function GameCard({ game, index }: { game: Game; index: number }) {
  const [hovered, setHovered] = useState(false);
  const [, setLocation] = useLocation();

  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      onClick={() => setLocation(`/games/${game.id}`)}
      className={`relative group cursor-pointer rounded-2xl overflow-hidden border ${game.borderColor} transition-all duration-300 ${game.glowColor}`}
      data-testid={`lobby-card-${game.id}`}
    >
      <div className="absolute inset-0">
        <img
          src={game.bgImage}
          alt={game.name}
          className="w-full h-full object-cover object-center transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/20" />
      </div>

      <div className="relative p-6 h-72 flex flex-col justify-between">
        <div className="flex items-start justify-end">
          <span
            className={`text-[10px] font-bold tracking-[0.2em] px-2.5 py-1 rounded-full border backdrop-blur-sm ${game.tagColor}`}
          >
            {game.tag}
          </span>
        </div>

        <div>
          <h3 className="font-cinzel font-black text-3xl text-white tracking-wider mb-1 drop-shadow-lg">
            {game.name}
          </h3>
          <div className="flex items-center justify-end mt-3">
            <motion.div
              animate={{ x: hovered ? 4 : 0 }}
              className="px-5 py-2.5 rounded-xl font-cinzel font-bold text-xs tracking-[0.15em] uppercase bg-gradient-to-r from-purple-600 to-purple-800 text-white border border-purple-400/30 neon-purple"
            >
              Play Now
            </motion.div>
          </div>
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

export default function GamesLobby() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen relative overflow-hidden" style={{ backgroundColor: "hsl(270,40%,4%)" }}>
      <ParticlesBg />
      <div className="relative z-10 min-h-screen flex flex-col">
        <header className="flex items-center justify-between px-4 sm:px-8 py-6">
          <motion.button
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4 }}
            whileHover={{ scale: 1.05, x: -2 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setLocation("/")}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl glass border border-purple-500/30 text-purple-200 hover:text-yellow-300 hover:border-yellow-400/40 transition-colors duration-200 text-sm font-medium tracking-wide"
            data-testid="button-back-home"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Lobby
          </motion.button>

          <div className="hidden sm:block">
            <GameModeToggle />
          </div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4 }}
          >
            <ConnectButton label="Connect Wallet" chainStatus="icon" showBalance={true} />
          </motion.div>
        </header>

        <div className="flex-1 px-4 sm:px-8 pb-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center mb-10"
          >
            <h1 className="font-cinzel font-black text-4xl sm:text-6xl tracking-widest text-white mb-2">
              Choose Your <span className="gradient-purple-gold">Game</span>
            </h1>
            <p className="text-purple-300/50 tracking-widest text-sm uppercase">
              Four legendary games · Powered by $CHOG
            </p>
          </motion.div>

          <div className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6" data-testid="lobby-grid">
            {games.map((game, i) => (
              <GameCard key={game.id} game={game} index={i} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
