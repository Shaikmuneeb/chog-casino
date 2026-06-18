import { motion } from "framer-motion";
import { Sparkles, ChevronDown } from "lucide-react";
import bgImage from "@assets/chog_casino_homepage_1781811634669.png";

export default function HeroSection() {
  return (
    <section
      className="relative min-h-screen flex items-center justify-center pt-20"
      data-testid="hero-section"
    >
      <div className="absolute inset-0 overflow-hidden">
        <img
          src={bgImage}
          alt="Chog Casino"
          className="w-full h-full object-cover object-center"
          data-testid="hero-bg-image"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/50 to-[hsl(270,40%,4%)]" />
        <div className="absolute inset-0 bg-gradient-to-t from-[hsl(270,40%,4%)] via-transparent to-transparent" />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass border border-yellow-400/30 mb-8"
          data-testid="hero-badge"
        >
          <Sparkles className="w-4 h-4 text-yellow-400" />
          <span className="text-xs font-medium text-yellow-300 tracking-widest uppercase">
            Premium Crypto Casino
          </span>
          <Sparkles className="w-4 h-4 text-yellow-400" />
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="font-cinzel font-black text-5xl sm:text-7xl lg:text-8xl tracking-widest mb-10 leading-none"
          data-testid="hero-title"
        >
          <span className="gradient-purple-gold">CHOG</span>
          <br />
          <span className="text-white drop-shadow-2xl">CASINO</span>
        </motion.h1>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16"
          data-testid="hero-cta"
        >
          <motion.button
            whileHover={{ scale: 1.05, y: -2 }}
            whileTap={{ scale: 0.98 }}
            className="px-10 py-4 rounded-xl font-cinzel font-bold text-sm tracking-[0.2em] uppercase bg-gradient-to-r from-purple-600 to-purple-800 text-white neon-purple transition-all duration-200 border border-purple-400/40"
            data-testid="button-play-now"
          >
            Play Now
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.05, y: -2 }}
            whileTap={{ scale: 0.98 }}
            className="px-10 py-4 rounded-xl font-cinzel font-bold text-sm tracking-[0.2em] uppercase glass border border-yellow-400/40 text-yellow-300 hover:border-yellow-400/70 transition-all duration-200"
            data-testid="button-learn-more"
          >
            Learn More
          </motion.button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 1.2 }}
          className="flex items-center justify-center"
          data-testid="scroll-indicator"
        >
          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            className="text-purple-400/50"
          >
            <ChevronDown className="w-6 h-6" />
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
