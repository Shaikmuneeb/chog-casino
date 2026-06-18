import { motion } from "framer-motion";
import { TrendingUp, Users, Trophy, Zap } from "lucide-react";

const stats = [
  { icon: TrendingUp, label: "Total Volume", value: "$48.2M", color: "text-purple-400" },
  { icon: Users, label: "Active Players", value: "12,847", color: "text-yellow-400" },
  { icon: Trophy, label: "Jackpot Won", value: "$2.1M", color: "text-purple-300" },
  { icon: Zap, label: "Games Played", value: "1.4M+", color: "text-yellow-300" },
];

export default function StatsBar() {
  return (
    <section className="py-8 px-4" data-testid="stats-bar">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="glass rounded-2xl border border-purple-500/20 p-6"
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {stats.map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.1 }}
                className="flex items-center gap-4"
                data-testid={`stat-${stat.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <div className="w-12 h-12 rounded-xl bg-purple-900/50 flex items-center justify-center border border-purple-700/30 shrink-0">
                  <stat.icon className={`w-5 h-5 ${stat.color}`} />
                </div>
                <div>
                  <div className={`text-xl font-bold font-cinzel ${stat.color}`}>
                    {stat.value}
                  </div>
                  <div className="text-xs text-purple-300/60 tracking-wider mt-0.5">
                    {stat.label}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
