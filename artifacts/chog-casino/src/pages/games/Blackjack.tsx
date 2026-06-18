import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import GameLayout from "@/components/GameLayout";
import bgImage from "@assets/image_1781811969584.png";

type Card = { value: string; suit: string; numeric: number };
type GameState = "idle" | "playing" | "dealer" | "done";

const SUITS = ["♠", "♥", "♦", "♣"];
const VALUES = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];

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
      initial={{ scale: 0, rotateY: 90 }}
      animate={{ scale: 1, rotateY: 0 }}
      className={`w-14 h-20 rounded-lg border flex flex-col items-center justify-between p-1.5 text-sm font-bold select-none ${
        hidden
          ? "bg-purple-900/80 border-purple-500/40"
          : "bg-white/95 border-white/20"
      }`}
    >
      {hidden ? (
        <span className="text-2xl">🂠</span>
      ) : (
        <>
          <span className={`self-start text-xs ${isRed ? "text-red-600" : "text-gray-900"}`}>
            {card.value}
          </span>
          <span className={`text-xl ${isRed ? "text-red-600" : "text-gray-900"}`}>
            {card.suit}
          </span>
          <span className={`self-end text-xs rotate-180 ${isRed ? "text-red-600" : "text-gray-900"}`}>
            {card.value}
          </span>
        </>
      )}
    </motion.div>
  );
}

export default function Blackjack() {
  const [bet, setBet] = useState("0.1");
  const [deck, setDeck] = useState<Card[]>([]);
  const [playerCards, setPlayerCards] = useState<Card[]>([]);
  const [dealerCards, setDealerCards] = useState<Card[]>([]);
  const [gameState, setGameState] = useState<GameState>("idle");
  const [outcome, setOutcome] = useState<string>("");

  const deal = useCallback(() => {
    const d = makeDeck();
    const player = [d[0], d[2]];
    const dealer = [d[1], d[3]];
    setDeck(d.slice(4));
    setPlayerCards(player);
    setDealerCards(dealer);
    setGameState("playing");
    setOutcome("");
  }, []);

  const hit = useCallback(() => {
    if (gameState !== "playing") return;
    const newCard = deck[0];
    const newDeck = deck.slice(1);
    const newHand = [...playerCards, newCard];
    setDeck(newDeck);
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
    while (handValue(d) < 17) {
      d = [...d, dk[0]];
      dk = dk.slice(1);
    }
    setDealerCards(d);
    setDeck(dk);
    const pv = handValue(playerCards);
    const dv = handValue(d);
    setGameState("done");
    if (dv > 21 || pv > dv) setOutcome("win");
    else if (pv === dv) setOutcome("push");
    else setOutcome("lose");
  }, [gameState, dealerCards, deck, playerCards]);

  const playerVal = handValue(playerCards);
  const dealerVal = handValue(dealerCards);

  return (
    <GameLayout
      title="BLACKJACK"
      subtitle="Beat the Dealer to 21"
      bgImage={bgImage}
      accentColor="text-white"
    >
      <div className="glass rounded-2xl border border-purple-500/20 p-6 sm:p-8 space-y-5">
        <div className="space-y-4">
          <div>
            <div className="text-xs text-purple-300/50 tracking-widest uppercase mb-2 flex items-center justify-between">
              <span>Dealer {gameState === "done" || gameState === "dealer" ? `— ${dealerVal}` : ""}</span>
            </div>
            <div className="flex gap-2 flex-wrap min-h-[5rem]" data-testid="dealer-hand">
              {dealerCards.map((card, i) => (
                <CardDisplay
                  key={i}
                  card={card}
                  hidden={gameState === "playing" && i === 1}
                />
              ))}
            </div>
          </div>

          <div className="border-t border-purple-500/20" />

          <div>
            <div className="text-xs text-purple-300/50 tracking-widest uppercase mb-2 flex items-center justify-between">
              <span>Your Hand</span>
              {playerCards.length > 0 && (
                <span className={`font-cinzel font-bold text-sm ${playerVal > 21 ? "text-red-400" : playerVal === 21 ? "text-yellow-400" : "text-white"}`}>
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
        </div>

        <AnimatePresence>
          {gameState === "done" && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className={`text-center py-3 px-6 rounded-xl font-cinzel font-bold text-lg tracking-widest border ${
                outcome === "win"
                  ? "bg-green-500/20 border-green-400/40 text-green-300"
                  : outcome === "push"
                  ? "bg-yellow-500/20 border-yellow-400/40 text-yellow-300"
                  : "bg-red-500/20 border-red-400/40 text-red-300"
              }`}
              data-testid="blackjack-result"
            >
              {outcome === "win" ? "🎉 YOU WIN!" : outcome === "push" ? "🤝 PUSH" : outcome === "bust" ? "💀 BUST!" : "💀 DEALER WINS"}
            </motion.div>
          )}
        </AnimatePresence>

        {gameState === "idle" && (
          <div className="space-y-2">
            <label className="text-xs text-purple-300/60 tracking-widest uppercase">Bet (ETH)</label>
            <input
              type="number"
              value={bet}
              onChange={(e) => setBet(e.target.value)}
              className="w-full px-4 py-3 rounded-xl glass border border-purple-500/30 text-white font-mono text-lg focus:outline-none focus:border-yellow-400/50"
              data-testid="input-blackjack-bet"
            />
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          {(gameState === "idle" || gameState === "done") && (
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={deal}
              className="col-span-3 py-4 rounded-xl font-cinzel font-bold text-sm tracking-[0.2em] uppercase bg-gradient-to-r from-purple-600 to-purple-800 text-white neon-purple border border-purple-400/40"
              data-testid="button-deal"
            >
              {gameState === "idle" ? "Deal Cards" : "Play Again"}
            </motion.button>
          )}
          {gameState === "playing" && (
            <>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={hit}
                className="col-span-2 py-4 rounded-xl font-cinzel font-bold text-sm tracking-[0.2em] uppercase bg-gradient-to-r from-purple-600 to-purple-800 text-white neon-purple border border-purple-400/40"
                data-testid="button-hit"
              >
                Hit
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={stand}
                className="py-4 rounded-xl font-cinzel font-bold text-sm tracking-[0.2em] uppercase glass border border-yellow-400/40 text-yellow-300"
                data-testid="button-stand"
              >
                Stand
              </motion.button>
            </>
          )}
        </div>
      </div>
    </GameLayout>
  );
}
