import { ConnectButton } from "@rainbow-me/rainbowkit";
import { motion } from "framer-motion";
import { Gem } from "lucide-react";
import { useState, useEffect } from "react";

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <motion.nav
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        scrolled
          ? "glass border-b border-purple-500/20 shadow-lg"
          : "bg-transparent"
      }`}
      data-testid="navbar"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          <motion.div
            className="flex items-center gap-3 cursor-pointer select-none"
            whileHover={{ scale: 1.02 }}
            data-testid="logo"
          >
            <div className="relative">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-purple-800 flex items-center justify-center neon-purple">
                <Gem className="w-5 h-5 text-yellow-300" />
              </div>
              <div className="absolute -inset-1 rounded-xl bg-purple-500/20 blur-sm -z-10" />
            </div>
            <div>
              <span
                className="font-cinzel font-black text-xl tracking-widest gradient-purple-gold"
                data-testid="logo-text"
              >
                CHOG CASINO
              </span>
              <div className="text-xs text-yellow-400/60 tracking-[0.3em] font-light -mt-0.5">
                PREMIUM GAMING
              </div>
            </div>
          </motion.div>

          <div className="hidden md:flex items-center gap-8">
            {["Games", "Leaderboard", "Rewards", "About"].map((item) => (
              <motion.a
                key={item}
                href="#"
                className="text-sm font-medium text-purple-200/70 hover:text-yellow-300 tracking-wider transition-colors duration-200"
                whileHover={{ y: -1 }}
                data-testid={`nav-link-${item.toLowerCase()}`}
              >
                {item}
              </motion.a>
            ))}
          </div>

          <div data-testid="connect-wallet-button">
            <ConnectButton
              label="Connect Wallet"
              chainStatus="icon"
              showBalance={false}
            />
          </div>
        </div>
      </div>
    </motion.nav>
  );
}
