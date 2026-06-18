import { ConnectButton } from "@rainbow-me/rainbowkit";
import { motion } from "framer-motion";
import { useState, useEffect } from "react";
import bgImage from "@assets/chog_casino_homepage_1781811634669.png";

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
          : "bg-gradient-to-b from-black/40 to-transparent"
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
            <div className="relative w-11 h-11 rounded-full overflow-hidden border-2 border-purple-400/50 neon-purple shrink-0">
              <img
                src={bgImage}
                alt="Chog Mascot"
                className="w-full h-full object-cover"
                style={{ objectPosition: "50% 52%" }}
                data-testid="logo-mascot-image"
              />
            </div>
          </motion.div>

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
