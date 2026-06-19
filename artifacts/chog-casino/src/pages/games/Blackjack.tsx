import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import GameLayout from "@/components/GameLayout";
import BetControls from "@/components/BetControls";
import WalletGateNotice from "@/components/WalletGateNotice";
import { useGameBalance } from "@/hooks/useGameBalance";
import bgImage from "@assets/image_1781811969584.png";

type Card = { value: string; suit: string; numeric: number };
type GameState = "betting" | "playing" | "done";

const SUITS = ["♠", "♥", "♦", "♣"];
const VALUES = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];

function makeCard(v: string, s: string): Card {
  const n = ["J","Q","K"].includes(v) ? 10 : v === "A" ? 11 : parseInt(v);
  return { value: v, suit: s, numeric: n };
}
function makeDeck(): Card[] {
  const d: Card[] = [];
  for (const s of SUITS) for (const v of VALUES) d.push(makeCard(v, s));
  return d.sort(() => Math.random() - 0.5);
}
function handValue(cards: Card[]): number {
  let t = cards.reduce((a, c) => a + c.numeric, 0);
  let aces = cards.filter(c => c.value === "A").length;
  while (t > 21 && aces-- > 0) t -= 10;
  return t;
}

function CardDisplay({ card, hidden, delay = 0 }: { card: Card; hidden?: boolean; delay?: number }) {
  const red = card.suit === "♥" || card.suit === "♦";
  return (
    <motion.div
      initial={{ opacity: 0, y: -24, rotateY: 90 }}
      animate={{ opacity: 1, y: 0, rotateY: 0 }}
      transition={{ type: "spring", stiffness: 280, damping: 22, delay }}
      className={`w-12 h-[4.25rem] sm:w-14 sm:h-20 rounded-lg border flex flex-col items-center justify-between p-1.5 font-bold select-none shadow-xl shrink-0 ${
        hidden
          ? "bg-gradient-to-br from-purple-900 to-purple-800 border-purple-500/40"
          : "bg-gradient-to-b from-white to-gray-50 border-white/30"
      }`}
    >
      {hidden ? (
        <div className="flex items-center justify-center w-full h-full">
          <div className="w-6 h-6 rounded-sm bg-purple-600/40 border border-purple-400/30" />
        </div>
      ) : (
        <>
          <span className={`self-start text-[11px] leading-none font-black ${red ? "text-red-600" : "text-gray-900"}`}>{card.value}</span>
          <span className={`text-lg leading-none ${red ? "text-red-500" : "text-gray-800"}`}>{card.suit}</span>
          <span className={`self-end text-[11px] leading-none font-black rotate-180 ${red ? "text-red-600" : "text-gray-900"}`}>{card.value}</span>
        </>
      )}
    </motion.div>
  );
}

function ScoreChip({ value, bust }: { value: number; bust?: boolean }) {
  return (
    <motion.span
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={`inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-cinzel font-black tracking-wide border ${
        bust
          ? "bg-red-900/50 border-red-500/50 text-red-300"
          : value === 21
          ? "bg-yellow-500/20 border-yellow-400/60 text-yellow-300"
          : "bg-purple-900/60 border-purple-500/40 text-purple-200"
      }`}
    >
      {value}
    </motion.span>
  );
}

export default function Blackjack() {
  const [betInput, setBetInput] = useState(100);
  const [activeBet, setActiveBet] = useState(0);
  const { balance, updateBalance, needsWallet, currencyLabel } = useGameBalance();
  const [deck, setDeck] = useState<Card[]>([]);
  const [playerCards, setPlayerCards] = useState<Card[]>([]);
  const [dealerCards, setDealerCards] = useState<Card[]>([]);
  const [gameState, setGameState] = useState<GameState>("betting");
  const [outcome, setOutcome] = useState<"win"|"push"|"lose"|"bust"|"">("");

  const betAmount = betInput;
  const canDeal = gameState === "betting" && !needsWallet && betAmount > 0 && betAmount <= balance;
  const playerVal = handValue(playerCards);
  const dealerVal = handValue(dealerCards);
  const showDealerFull = gameState === "done";

  const deal = useCallback(() => {
    if (!canDeal) return;
    const d = makeDeck();
    setActiveBet(betAmount);
    updateBalance(b => b - betAmount);
    setDeck(d.slice(4));
    setPlayerCards([d[0], d[2]]);
    setDealerCards([d[1], d[3]]);
    setGameState("playing");
    setOutcome("");
  }, [canDeal, betAmount, updateBalance]);

  const hit = useCallback(() => {
    if (gameState !== "playing") return;
    const newHand = [...playerCards, deck[0]];
    setDeck(d => d.slice(1));
    setPlayerCards(newHand);
    if (handValue(newHand) > 21) {
      setGameState("done");
      setOutcome("bust");
    }
  }, [gameState, deck, playerCards]);

  const stand = useCallback(() => {
    if (gameState !== "playing") return;
    let d = [...dealerCards], dk = [...deck];
    while (handValue(d) < 17) { d = [...d, dk[0]]; dk = dk.slice(1); }
    setDealerCards(d);
    setDeck(dk);
    const pv = handValue(playerCards), dv = handValue(d);
    const res: "win"|"push"|"lose" = dv > 21 || pv > dv ? "win" : pv === dv ? "push" : "lose";
    setGameState("done");
    setOutcome(res);
    updateBalance(b => res === "win" ? b + activeBet * 2 : res === "push" ? b + activeBet : b);
  }, [gameState, dealerCards, deck, playerCards, activeBet, updateBalance]);

  const newRound = () => {
    setGameState("betting");
    setPlayerCards([]); setDealerCards([]);
    setOutcome(""); setActiveBet(0);
  };

  const outcomeMap: Record<string, { label: string; cls: string }> = {
    win:  { label: `YOU WIN  +${activeBet.toLocaleString()} $CHOG`, cls: "text-green-300 border-green-400/40 bg-green-500/10" },
    push: { label: "PUSH — Bet Returned",                           cls: "text-yellow-300 border-yellow-400/40 bg-yellow-500/10" },
    lose: { label: `DEALER WINS  -${activeBet.toLocaleString()} $CHOG`, cls: "text-red-300 border-red-400/40 bg-red-500/10" },
    bust: { label: `BUST  -${activeBet.toLocaleString()} $CHOG`,    cls: "text-red-300 border-red-400/40 bg-red-500/10" },
  };
  const outcomeConfig = outcome ? outcomeMap[outcome] ?? null : null;

  return (
    <GameLayout title="BLACKJACK" subtitle="Beat the Dealer to 21" bgImage={bgImage} accentColor="text-white">
      <div className="glass rounded-2xl border border-purple-500/20 overflow-hidden flex flex-col">

        {/* ── Top bar: balance + active bet ── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-purple-500/15">
          <div>
            <div className="text-[10px] text-purple-300/40 tracking-widest uppercase mb-0.5">Balance</div>
            <div className="font-cinzel font-bold text-lg text-yellow-300">
              {balance.toLocaleString()} <span className="text-xs text-yellow-400/60">{currencyLabel}</span>
            </div>
          </div>
          <AnimatePresence>
            {activeBet > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="text-right"
              >
                <div className="text-[10px] text-purple-300/40 tracking-widest uppercase mb-0.5">Current Bet</div>
                <div className="font-cinzel font-bold text-lg text-white">
                  {activeBet.toLocaleString()} <span className="text-xs text-purple-300/60">$CHOG</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Cards area ── */}
        <div className="px-5 py-4 space-y-4 flex-1">

          {/* Dealer */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] text-purple-300/40 tracking-widest uppercase">Dealer</span>
              {dealerCards.length > 0 && showDealerFull && (
                <ScoreChip value={dealerVal} bust={dealerVal > 21} />
              )}
            </div>
            <div className="flex gap-2 flex-wrap min-h-[4.5rem]" data-testid="dealer-hand">
              {dealerCards.map((card, i) => (
                <CardDisplay key={i} card={card} hidden={!showDealerFull && i === 1} delay={i * 0.07} />
              ))}
              {dealerCards.length === 0 && (
                <div className="flex gap-2">
                  {[0,1].map(i => (
                    <div key={i} className="w-12 h-[4.25rem] sm:w-14 sm:h-20 rounded-lg border-2 border-dashed border-purple-700/30" />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-purple-500/15" />

          {/* Player */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] text-purple-300/40 tracking-widest uppercase">Your Hand</span>
              {playerCards.length > 0 && (
                <ScoreChip value={playerVal} bust={playerVal > 21} />
              )}
            </div>
            <div className="flex gap-2 flex-wrap min-h-[4.5rem]" data-testid="player-hand">
              {playerCards.map((card, i) => (
                <CardDisplay key={i} card={card} delay={i * 0.07} />
              ))}
              {playerCards.length === 0 && (
                <div className="flex gap-2">
                  {[0,1].map(i => (
                    <div key={i} className="w-12 h-[4.25rem] sm:w-14 sm:h-20 rounded-lg border-2 border-dashed border-purple-700/30" />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Result banner */}
          <AnimatePresence>
            {gameState === "done" && outcomeConfig && (
              <motion.div
                initial={{ opacity: 0, scale: 0.88, y: 4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 350, damping: 24 }}
                className={`text-center py-2.5 rounded-xl font-cinzel font-black text-sm tracking-[0.18em] uppercase border ${outcomeConfig.cls}`}
                data-testid="blackjack-result"
              >
                {outcomeConfig.label}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Bottom control panel ── */}
        <div className="border-t border-purple-500/15 bg-black/20 px-5 py-4">
          <AnimatePresence mode="wait">

            {/* BETTING state — wallet gate (real mode) or bet selector + Deal */}
            {gameState === "betting" && needsWallet && (
              <motion.div
                key="betting-wallet-gate"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
              >
                <WalletGateNotice />
              </motion.div>
            )}
            {gameState === "betting" && !needsWallet && (
              <motion.div
                key="betting-controls"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="flex items-end gap-3"
              >
                {/* Bet controls */}
                <div className="flex-1">
                  <BetControls value={betInput} onChange={setBetInput} max={balance} />
                </div>

                {/* Deal button */}
                <motion.button
                  whileHover={canDeal ? { scale: 1.04, y: -1 } : {}}
                  whileTap={canDeal ? { scale: 0.96 } : {}}
                  onClick={deal}
                  disabled={!canDeal}
                  className="shrink-0 px-7 py-[2.65rem] rounded-xl font-cinzel font-black text-sm tracking-[0.2em] uppercase bg-gradient-to-b from-purple-500 to-purple-800 text-white neon-purple border border-purple-400/40 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  data-testid="button-deal"
                >
                  DEAL
                </motion.button>
              </motion.div>
            )}

            {/* PLAYING state — Hit / Stand */}
            {gameState === "playing" && (
              <motion.div
                key="play-controls"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="grid grid-cols-2 gap-3"
              >
                <motion.button
                  whileHover={{ scale: 1.03, y: -1 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={hit}
                  className="py-4 rounded-xl font-cinzel font-black text-sm tracking-[0.2em] uppercase bg-gradient-to-r from-purple-600 to-purple-800 text-white neon-purple border border-purple-400/40 transition-all"
                  data-testid="button-hit"
                >
                  Hit
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.03, y: -1 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={stand}
                  className="py-4 rounded-xl font-cinzel font-black text-sm tracking-[0.2em] uppercase glass border border-yellow-400/40 text-yellow-300 hover:border-yellow-400/70 transition-all"
                  data-testid="button-stand"
                >
                  Stand
                </motion.button>
              </motion.div>
            )}

            {/* DONE state — New round */}
            {gameState === "done" && (
              <motion.div
                key="done-controls"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <motion.button
                  whileHover={{ scale: 1.03, y: -1 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={newRound}
                  className="w-full py-4 rounded-xl font-cinzel font-black text-sm tracking-[0.2em] uppercase bg-gradient-to-r from-purple-600 to-purple-800 text-white neon-purple border border-purple-400/40 transition-all"
                  data-testid="button-new-round"
                >
                  Place New Bet
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </GameLayout>
  );
}
