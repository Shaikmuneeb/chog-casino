import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import GameLayout from "@/components/GameLayout";
import bgImage from "@assets/image_1781811969584.png";

type Card = { value: string; suit: string; numeric: number };
type GameState = "betting" | "playing" | "dealer" | "done";

const SUITS = ["♠", "♥", "♦", "♣"];
const VALUES = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
const STARTING_BALANCE = 10_000;
const QUICK_BETS = [50, 100, 250, 500];

function makeCard(value: string, suit: string): Card {
  const v = ["J","Q","K"].includes(value) ? 10 : value === "A" ? 11 : parseInt(value);
  return { value, suit, numeric: v };
}

function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const value of VALUES) deck.push(makeCard(value, suit));
  return deck.sort(() => Math.random() - 0.5);
}

function handValue(cards: Card[]): number {
  let total = cards.reduce((s, c) => s + c.numeric, 0);
  let aces = cards.filter((c) => c.value === "A").length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function CardDisplay({ card, hidden }: { card: Card; hidden?: boolean }) {
  const isRed = card.suit === "♥" || card.suit === "♦";
  return (
    <motion.div
      initial={{ scale: 0, rotateY: 90, y: -20 }}
      animate={{ scale: 1, rotateY: 0, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
      className={`w-14 h-20 rounded-lg border flex flex-col items-center justify-between p-1.5 text-sm font-bold select-none shadow-lg ${
        hidden
          ? "bg-purple-900/80 border-purple-500/40"
          : "bg-white/95 border-white/20"
      }`}
    >
      {hidden ? (
        <span className="text-2xl self-center mt-3">🂠</span>
      ) : (
        <>
          <span className={`self-start text-xs leading-none ${isRed ? "text-red-600" : "text-gray-900"}`}>
            {card.value}
          </span>
          <span className={`text-xl ${isRed ? "text-red-600" : "text-gray-900"}`}>
            {card.suit}
          </span>
          <span className={`self-end text-xs rotate-180 leading-none ${isRed ? "text-red-600" : "text-gray-900"}`}>
            {card.value}
          </span>
        </>
      )}
    </motion.div>
  );
}

export default function Blackjack() {
  const [betInput, setBetInput] = useState("100");
  const [activeBet, setActiveBet] = useState(0);
  const [balance, setBalance] = useState(STARTING_BALANCE);
  const [deck, setDeck] = useState<Card[]>([]);
  const [playerCards, setPlayerCards] = useState<Card[]>([]);
  const [dealerCards, setDealerCards] = useState<Card[]>([]);
  const [gameState, setGameState] = useState<GameState>("betting");
  const [outcome, setOutcome] = useState<string>("");

  const betAmount = parseInt(betInput) || 0;
  const canDeal = betAmount > 0 && betAmount <= balance;

  const deal = useCallback(() => {
    if (!canDeal) return;
    const d = makeDeck();
    setActiveBet(betAmount);
    setBalance((b) => b - betAmount);
    setDeck(d.slice(4));
    setPlayerCards([d[0], d[2]]);
    setDealerCards([d[1], d[3]]);
    setGameState("playing");
    setOutcome("");
  }, [canDeal, betAmount]);

  const hit = useCallback(() => {
    if (gameState !== "playing") return;
    const newHand = [...playerCards, deck[0]];
    setDeck((d) => d.slice(1));
    setPlayerCards(newHand);
    if (handValue(newHand) > 21) {
      setGameState("done");
      setOutcome("bust");
    }
  }, [gameState, deck, playerCards]);

  const stand = useCallback(() => {
    if (gameState !== "playing") return;
    setGameState("dealer");
    let d = [...dealerCards];
    let dk = [...deck];
    while (handValue(d) < 17) { d = [...d, dk[0]]; dk = dk.slice(1); }
    setDealerCards(d);
    setDeck(dk);
    const pv = handValue(playerCards);
    const dv = handValue(d);
    let result = "";
    if (dv > 21 || pv > dv) result = "win";
    else if (pv === dv) result = "push";
    else result = "lose";
    setGameState("done");
    setOutcome(result);
    setBalance((b) => {
      if (result === "win") return b + activeBet * 2;
      if (result === "push") return b + activeBet;
      return b;
    });
  }, [gameState, dealerCards, deck, playerCards, activeBet]);

  const playAgain = () => {
    setGameState("betting");
    setPlayerCards([]);
    setDealerCards([]);
    setOutcome("");
    setActiveBet(0);
  };

  const playerVal = handValue(playerCards);
  const dealerVal = handValue(dealerCards);
  const revealDealer = gameState === "done" || gameState === "dealer";

  return (
    <GameLayout
      title="BLACKJACK"
      subtitle="Beat the Dealer to 21"
      bgImage={bgImage}
      accentColor="text-white"
    >
      <div className="glass rounded-2xl border border-purple-500/20 overflow-hidden">

        {/* ── Betting screen ── */}
        <AnimatePresence mode="wait">
          {gameState === "betting" && (
            <motion.div
              key="betting"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="p-6 sm:p-8 space-y-5"
            >
              {/* Balance */}
              <div className="flex items-center justify-between px-1">
                <div>
                  <div className="text-xs text-purple-300/50 tracking-widest uppercase mb-0.5">Balance</div>
                  <div className="font-cinzel font-bold text-xl text-yellow-300">
                    {balance.toLocaleString()} <span className="text-sm text-yellow-400/60">$CHOG</span>
                  </div>
                </div>
              </div>

              {/* Bet input */}
              <div className="space-y-2">
                <label className="text-xs text-purple-300/60 tracking-widest uppercase font-medium">
                  Bet Amount ($CHOG)
                </label>
                <input
                  type="number"
                  value={betInput}
                  onChange={(e) => setBetInput(e.target.value)}
                  step="1"
                  min="1"
                  max={balance}
                  className="w-full px-4 py-3 rounded-xl glass border border-purple-500/30 text-white font-mono text-lg focus:outline-none focus:border-yellow-400/50 transition-colors"
                  data-testid="input-blackjack-bet"
                />
                {/* Quick bet buttons */}
                <div className="flex gap-2">
                  {QUICK_BETS.map((v) => (
                    <button
                      key={v}
                      onClick={() => setBetInput(String(v))}
                      className={`flex-1 py-1.5 rounded-lg text-xs border transition-colors font-medium ${
                        betAmount === v
                          ? "bg-yellow-500/20 border-yellow-400/50 text-yellow-300"
                          : "glass border-purple-700/30 text-purple-300 hover:border-purple-400/40 hover:text-purple-100"
                      }`}
                      data-testid={`button-bet-preset-${v}`}
                    >
                      {v}
                    </button>
                  ))}
                  <button
                    onClick={() => setBetInput(String(balance))}
                    className="flex-1 py-1.5 rounded-lg text-xs glass border border-yellow-600/40 text-yellow-400 hover:border-yellow-400/60 transition-colors"
                    data-testid="button-bet-max"
                  >
                    MAX
                  </button>
                </div>
              </div>

              {/* Current bet display */}
              {betAmount > 0 && (
                <div className="flex items-center justify-center gap-2 py-2">
                  <div className="text-xs text-purple-300/50 tracking-widest uppercase">Current Bet</div>
                  <div className="font-cinzel font-bold text-base text-yellow-300">
                    {betAmount.toLocaleString()} $CHOG
                  </div>
                </div>
              )}

              {/* Deal button */}
              <motion.button
                whileHover={canDeal ? { scale: 1.03, y: -2 } : {}}
                whileTap={canDeal ? { scale: 0.97 } : {}}
                onClick={deal}
                disabled={!canDeal}
                className="w-full py-5 rounded-xl font-cinzel font-black text-base tracking-[0.25em] uppercase bg-gradient-to-r from-purple-600 to-purple-800 text-white neon-purple border border-purple-400/40 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                data-testid="button-deal"
              >
                {balance <= 0 ? "Out of $CHOG" : "Deal Cards"}
              </motion.button>

              {balance <= 0 && (
                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  onClick={() => setBalance(STARTING_BALANCE)}
                  className="w-full py-3 rounded-xl font-cinzel font-bold text-sm tracking-widest uppercase glass border border-purple-500/40 text-purple-300"
                >
                  Reset Balance (10,000 $CHOG)
                </motion.button>
              )}
            </motion.div>
          )}

          {/* ── Game screen ── */}
          {gameState !== "betting" && (
            <motion.div
              key="game"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="p-6 sm:p-8 space-y-5"
            >
              {/* Active bet + balance bar */}
              <div className="flex items-center justify-between px-1">
                <div>
                  <div className="text-xs text-purple-300/50 tracking-widest uppercase mb-0.5">Balance</div>
                  <div className="font-cinzel font-bold text-lg text-yellow-300">
                    {balance.toLocaleString()} <span className="text-sm text-yellow-400/60">$CHOG</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-purple-300/50 tracking-widest uppercase mb-0.5">Bet</div>
                  <div className="font-cinzel font-bold text-lg text-white">
                    {activeBet.toLocaleString()} <span className="text-sm text-purple-300/60">$CHOG</span>
                  </div>
                </div>
              </div>

              {/* Dealer hand */}
              <div>
                <div className="text-xs text-purple-300/50 tracking-widest uppercase mb-2 flex items-center justify-between">
                  <span>Dealer</span>
                  {revealDealer && (
                    <span className={`font-cinzel font-bold text-sm ${dealerVal > 21 ? "text-red-400" : "text-white"}`}>
                      {dealerVal}
                    </span>
                  )}
                </div>
                <div className="flex gap-2 flex-wrap min-h-[5rem]" data-testid="dealer-hand">
                  {dealerCards.map((card, i) => (
                    <CardDisplay key={i} card={card} hidden={gameState === "playing" && i === 1} />
                  ))}
                </div>
              </div>

              <div className="border-t border-purple-500/20" />

              {/* Player hand */}
              <div>
                <div className="text-xs text-purple-300/50 tracking-widest uppercase mb-2 flex items-center justify-between">
                  <span>Your Hand</span>
                  {playerCards.length > 0 && (
                    <span className={`font-cinzel font-bold text-sm ${
                      playerVal > 21 ? "text-red-400" : playerVal === 21 ? "text-yellow-400" : "text-white"
                    }`}>
                      {playerVal}
                    </span>
                  )}
                </div>
                <div className="flex gap-2 flex-wrap min-h-[5rem]" data-testid="player-hand">
                  {playerCards.map((card, i) => (
                    <CardDisplay key={i} card={card} />
                  ))}
                </div>
              </div>

              {/* Result banner */}
              <AnimatePresence>
                {gameState === "done" && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.85, y: 6 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    className={`text-center py-3 px-6 rounded-xl font-cinzel font-bold text-lg tracking-widest border ${
                      outcome === "win"
                        ? "bg-green-500/20 border-green-400/40 text-green-300"
                        : outcome === "push"
                        ? "bg-yellow-500/20 border-yellow-400/40 text-yellow-300"
                        : "bg-red-500/20 border-red-400/40 text-red-300"
                    }`}
                    data-testid="blackjack-result"
                  >
                    {outcome === "win"
                      ? `YOU WIN · +${activeBet.toLocaleString()} $CHOG`
                      : outcome === "push"
                      ? "PUSH · Bet Returned"
                      : outcome === "bust"
                      ? `BUST · -${activeBet.toLocaleString()} $CHOG`
                      : `DEALER WINS · -${activeBet.toLocaleString()} $CHOG`}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Action buttons */}
              <div className="grid grid-cols-3 gap-3">
                {gameState === "done" ? (
                  <motion.button
                    whileHover={{ scale: 1.03, y: -1 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={playAgain}
                    className="col-span-3 py-4 rounded-xl font-cinzel font-black text-sm tracking-[0.2em] uppercase bg-gradient-to-r from-purple-600 to-purple-800 text-white neon-purple border border-purple-400/40 transition-all"
                    data-testid="button-play-again"
                  >
                    Place New Bet
                  </motion.button>
                ) : (
                  <>
                    <motion.button
                      whileHover={{ scale: 1.03, y: -1 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={hit}
                      disabled={gameState !== "playing"}
                      className="col-span-2 py-4 rounded-xl font-cinzel font-black text-sm tracking-[0.2em] uppercase bg-gradient-to-r from-purple-600 to-purple-800 text-white neon-purple border border-purple-400/40 disabled:opacity-40 transition-all"
                      data-testid="button-hit"
                    >
                      Hit
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.03, y: -1 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={stand}
                      disabled={gameState !== "playing"}
                      className="py-4 rounded-xl font-cinzel font-black text-sm tracking-[0.2em] uppercase glass border border-yellow-400/40 text-yellow-300 disabled:opacity-40 transition-all"
                      data-testid="button-stand"
                    >
                      Stand
                    </motion.button>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </GameLayout>
  );
}
