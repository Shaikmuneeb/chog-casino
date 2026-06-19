import { motion } from "framer-motion";
import { useState, useEffect } from "react";
import ConnectButton from "@/components/ConnectButton";
import ProfileDropdown from "@/components/ProfileDropdown";
import GameModeToggle from "@/components/GameModeToggle";

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
          <ProfileDropdown />

          <div className="hidden sm:block">
            <GameModeToggle />
          </div>

          <div data-testid="connect-wallet-button">
            <ConnectButton />
          </div>
        </div>
      </div>
    </motion.nav>
  );
}
