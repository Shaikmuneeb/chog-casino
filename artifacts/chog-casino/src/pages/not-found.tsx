import { motion } from "framer-motion";
import { Gem } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-casino flex items-center justify-center px-4">
      <div className="text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
        >
          <div className="text-8xl mb-6">🎰</div>
          <h1 className="font-cinzel font-black text-6xl gradient-purple-gold mb-4">404</h1>
          <p className="text-purple-300/60 text-lg mb-8">This page folded. Try another hand.</p>
          <motion.a
            href="/"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.98 }}
            className="inline-flex items-center gap-2 px-8 py-4 rounded-xl font-cinzel font-bold text-sm tracking-widest uppercase bg-gradient-to-r from-purple-600 to-purple-800 text-white neon-purple border border-purple-400/40"
          >
            <Gem className="w-4 h-4" />
            Back to Casino
          </motion.a>
        </motion.div>
      </div>
    </div>
  );
}
