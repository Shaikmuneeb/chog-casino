import { motion } from "framer-motion";
import { useLocation } from "wouter";
import bgImage from "@assets/chog_casino_homepage_1781811634669.png";

export default function HeroSection() {
  const [, setLocation] = useLocation();

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
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          data-testid="hero-cta"
        >
          <motion.button
            whileHover={{ scale: 1.08, y: -3 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setLocation("/games")}
            className="px-16 py-5 rounded-2xl font-cinzel font-black text-base tracking-[0.3em] uppercase bg-gradient-to-r from-purple-600 to-purple-800 text-white neon-purple transition-all duration-200 border border-purple-400/40"
            data-testid="button-play-now"
          >
            PLAY NOW
          </motion.button>
        </motion.div>
      </div>
    </section>
  );
}
