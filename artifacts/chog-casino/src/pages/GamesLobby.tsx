import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import homeBg from "@assets/chog_casino_homepage_1781811634669.png";

const games = [
  { id: "coin-flip",  name: "Coin Flip",  emoji: "🪙", hint: "Double or Nothing" },
  { id: "mines",      name: "Mines",      emoji: "💣", hint: "Navigate to Win" },
  { id: "roulette",   name: "Roulette",   emoji: "🎡", hint: "Spin the Wheel" },
  { id: "blackjack",  name: "Blackjack",  emoji: "🃏", hint: "Beat the Dealer" },
];

export default function GamesLobby() {
  const [, setLocation] = useLocation();

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Background */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat z-0"
        style={{
          backgroundImage: `url(${homeBg})`,
          filter: "brightness(0.55) contrast(1.1)",
        }}
      />
      <div className="absolute inset-0 bg-black/40 z-10" />

      {/* Navbar */}
      <nav className="relative z-50 border-b border-white/10 py-5">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 flex items-center justify-between">
          <motion.button
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4 }}
            onClick={() => setLocation("/")}
            className="font-cinzel font-black text-xl sm:text-2xl tracking-widest text-white hover:text-yellow-300 transition-colors"
            data-testid="button-home"
          >
            CHOG CASINO
          </motion.button>
          <motion.div
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4 }}
          >
            <ConnectButton label="Connect Wallet" chainStatus="icon" showBalance={false} />
          </motion.div>
        </div>
      </nav>

      {/* Game grid */}
      <div className="relative z-20 flex flex-col items-center justify-center min-h-[calc(100vh-81px)] px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-10"
        >
          <h2 className="font-cinzel font-black text-5xl md:text-6xl tracking-widest text-white mb-3">
            CHOOSE YOUR GAME
          </h2>
          <p className="text-purple-200/70 tracking-widest text-sm uppercase">
            Play with $CHOG · Provably Fair
          </p>
        </motion.div>

        <div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 max-w-5xl w-full"
          data-testid="lobby-grid"
        >
          {games.map((game, i) => (
            <motion.button
              key={game.id}
              initial={{ opacity: 0, y: 32 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: i * 0.08 }}
              whileHover={{ scale: 1.05, y: -4 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setLocation(`/games/${game.id}`)}
              className="glass border border-white/10 hover:border-purple-400/50 hover:shadow-[0_0_32px_rgba(168,85,247,0.3)] rounded-3xl p-8 text-center group transition-all duration-300 cursor-pointer"
              data-testid={`lobby-card-${game.id}`}
            >
              <motion.div
                className="text-6xl mb-5 select-none"
                whileHover={{ scale: 1.15, rotate: [-4, 4, -2, 0] }}
                transition={{ duration: 0.4 }}
              >
                {game.emoji}
              </motion.div>
              <h3 className="font-cinzel font-black text-xl text-white tracking-wider mb-1">
                {game.name}
              </h3>
              <p className="text-purple-300/60 text-xs tracking-widest uppercase mb-4">
                {game.hint}
              </p>
              <span className="inline-block text-purple-300 group-hover:text-yellow-300 text-sm font-medium tracking-wider transition-colors duration-200">
                Play Now →
              </span>
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );
}
