import { motion } from "framer-motion";
import { Gem, Twitter, Github, MessageCircle } from "lucide-react";

const links = {
  Games: ["Coin Flip", "Mines", "Roulette", "Blackjack"],
  Company: ["About Us", "Blog", "Careers", "Press"],
  Support: ["FAQ", "Contact", "Bug Bounty", "Terms"],
};

export default function Footer() {
  return (
    <footer className="pt-16 pb-8 px-4 mt-8 border-t border-purple-900/30" data-testid="footer">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-12">
          <div className="col-span-1">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 to-purple-800 flex items-center justify-center neon-purple">
                <Gem className="w-4 h-4 text-yellow-300" />
              </div>
              <span className="font-cinzel font-black text-lg tracking-widest gradient-purple-gold">
                CHOG CASINO
              </span>
            </div>
            <p className="text-sm text-purple-300/50 leading-relaxed mb-6">
              The most premium crypto casino experience. Built on-chain, for the bold.
            </p>
            <div className="flex items-center gap-3">
              {[Twitter, Github, MessageCircle].map((Icon, i) => (
                <motion.a
                  key={i}
                  href="#"
                  whileHover={{ scale: 1.1, y: -2 }}
                  className="w-9 h-9 rounded-lg glass border border-purple-700/30 flex items-center justify-center text-purple-400 hover:text-yellow-300 hover:border-yellow-400/30 transition-colors duration-200"
                  data-testid={`footer-social-${i}`}
                >
                  <Icon className="w-4 h-4" />
                </motion.a>
              ))}
            </div>
          </div>

          {Object.entries(links).map(([section, items]) => (
            <div key={section}>
              <h4 className="font-cinzel font-bold text-sm tracking-[0.2em] text-purple-300/80 uppercase mb-4">
                {section}
              </h4>
              <ul className="space-y-3">
                {items.map((item) => (
                  <li key={item}>
                    <a
                      href="#"
                      className="text-sm text-purple-300/50 hover:text-yellow-300 transition-colors duration-200"
                      data-testid={`footer-link-${item.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      {item}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t border-purple-900/30 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-purple-400/40 tracking-wider">
            © 2025 Chog Casino. All rights reserved.
          </p>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-purple-400/40 tracking-wider">All systems operational</span>
          </div>
          <p className="text-xs text-purple-400/30 tracking-wider">
            Play responsibly. 18+
          </p>
        </div>
      </div>
    </footer>
  );
}
