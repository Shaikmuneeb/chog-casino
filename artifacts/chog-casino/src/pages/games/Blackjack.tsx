import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import GameLayout from "@/components/GameLayout";
import BetControls from "@/components/BetControls";
import WalletGateNotice from "@/components/WalletGateNotice";
import { useGameBalance } from "@/hooks/useGameBalance";
import bgImage from "@assets/image_1781811969584.png";

type Card = { value: string; suit: string; numeric: number };
type GameState = "betting" | "playing" | "done";
type HandResult = "win" | "push" | "lose" | "bust";

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
  const ink = red ? "text-red-600" : "text-gray-900";
  return (
    <motion.div
      className="w-12 h-[4.25rem] sm:w-14 sm:h-20 shrink-0 select-none"
      style={{ perspective: 700 }}
      // Deal in from the top, like off a dealer's deck, with a springy overshoot
      initial={{ opacity: 0, y: -80, x: 26, rotate: 14, scale: 0.7 }}
      animate={{ opacity: 1, y: 0, x: 0, rotate: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 17, delay }}
      whileHover={{ y: -8, scale: 1.07, rotate: -1, transition: { type: "spring", stiffness: 400, damping: 18 } }}
    >
      <motion.div
        className="relative w-full h-full"
        style={{ transformStyle: "preserve-3d" }}
        // Every card flips face-up as it's dealt; the dealer's hole card stays down until reveal
        initial={{ rotateY: 180 }}
        animate={{ rotateY: hidden ? 180 : 0 }}
        transition={{ type: "spring", stiffness: 230, damping: 20, delay: delay + 0.12 }}
      >
        {/* Front (face) */}
        <div
          className="absolute inset-0 rounded-lg border border-black/10 bg-gradient-to-br from-white via-white to-gray-200 shadow-xl overflow-hidden"
          style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
        >
          <div className="absolute top-1 left-1.5 flex flex-col items-center leading-none">
            <span className={`text-[11px] font-black ${ink}`}>{card.value}</span>
            <span className={`text-[9px] ${ink}`}>{card.suit}</span>
          </div>
          <span className={`absolute inset-0 flex items-center justify-center text-2xl ${red ? "text-red-500/90" : "text-gray-800/90"}`}>
            {card.suit}
          </span>
          <div className="absolute bottom-1 right-1.5 flex flex-col items-center leading-none rotate-180">
            <span className={`text-[11px] font-black ${ink}`}>{card.value}</span>
            <span className={`text-[9px] ${ink}`}>{card.suit}</span>
          </div>
          {/* glossy sheen */}
          <div className="absolute -inset-y-2 -left-4 w-5 rotate-12 bg-white/40 blur-[3px] pointer-events-none" />
        </div>

        {/* Back (face-down) */}
        <div
          className="absolute inset-0 rounded-lg border border-purple-400/40 bg-gradient-to-br from-purple-700 via-purple-900 to-[#1a0b2e] shadow-xl flex items-center justify-center overflow-hidden"
          style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
        >
          <div className="absolute inset-1 rounded-md border border-purple-400/25" />
          <div className="w-7 h-7 rounded-full border-2 border-yellow-400/50 flex items-center justify-center">
            <div className="w-3 h-3 rotate-45 bg-gradient-to-br from-yellow-300/70 to-yellow-500/40" />
          </div>
        </div>
      </motion.div>
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
  const { balance, updateBalance, gated, gateReason, showBalance, currencyLabel } = useGameBalance();
  const [deck, setDeck] = useState<Card[]>([]);
  const [hands, setHands] = useState<Card[][]>([]); // 1 hand normally, 2 after a split
  const [bets, setBets] = useState<number[]>([]);
  const [active, setActive] = useState(0); // which hand is being played
  const [dealerCards, setDealerCards] = useState<Card[]>([]);
  const [gameState, setGameState] = useState<GameState>("betting");
  const [results, setResults] = useState<HandResult[]>([]); // per-hand outcome
  const [netResult, setNetResult] = useState(0); // net win/loss for the banner

  const betAmount = betInput;
  const totalStaked = bets.reduce((a, b) => a + b, 0);
  const canDeal = gameState === "betting" && !gated && betAmount > 0 && betAmount <= balance;
  const dealerVal = handValue(dealerCards);
  const showDealerFull = gameState === "done";
  const isSplit = hands.length > 1;
  const activeHand = hands[active] ?? [];

  const canDouble =
    gameState === "playing" && activeHand.length === 2 && balance >= (bets[active] ?? Infinity);
  const canSplit =
    gameState === "playing" &&
    !isSplit &&
    activeHand.length === 2 &&
    activeHand[0].value === activeHand[1].value &&
    balance >= (bets[0] ?? Infinity);

  // Dealer draws to 17, scores every hand, pays out, ends the round.
  const resolveRound = (finalHands: Card[][], finalBets: number[], remainingDeck: Card[]) => {
    let dealer = [...dealerCards];
    let dk = [...remainingDeck];
    const anyAlive = finalHands.some((h) => handValue(h) <= 21);
    if (anyAlive) {
      while (handValue(dealer) < 17) {
        dealer = [...dealer, dk[0]];
        dk = dk.slice(1);
      }
    }
    const dv = handValue(dealer);
    let payout = 0;
    const res: HandResult[] = finalHands.map((h, i) => {
      const pv = handValue(h);
      if (pv > 21) return "bust";
      if (dv > 21 || pv > dv) { payout += finalBets[i] * 2; return "win"; }
      if (pv === dv) { payout += finalBets[i]; return "push"; }
      return "lose";
    });
    setHands(finalHands);
    setBets(finalBets);
    setDealerCards(dealer);
    setDeck(dk);
    setResults(res);
    setNetResult(payout - finalBets.reduce((a, b) => a + b, 0));
    setGameState("done");
    if (payout > 0) updateBalance((b) => b + payout);
  };

  const deal = () => {
    if (!canDeal) return;
    const d = makeDeck();
    updateBalance((b) => b - betAmount);
    setHands([[d[0], d[2]]]);
    setBets([betAmount]);
    setActive(0);
    setDealerCards([d[1], d[3]]);
    setDeck(d.slice(4));
    setResults([]);
    setNetResult(0);
    setGameState("playing");
  };

  const hit = () => {
    if (gameState !== "playing") return;
    const card = deck[0];
    const dk = deck.slice(1);
    const newHands = hands.map((h, i) => (i === active ? [...h, card] : h));
    if (handValue(newHands[active]) > 21) {
      // busted this hand → next hand, or resolve if it was the last
      if (active + 1 < newHands.length) {
        setHands(newHands); setDeck(dk); setActive(active + 1);
      } else {
        resolveRound(newHands, bets, dk);
      }
    } else {
      setHands(newHands); setDeck(dk);
    }
  };

  const stand = () => {
    if (gameState !== "playing") return;
    if (active + 1 < hands.length) {
      setActive(active + 1);
    } else {
      resolveRound(hands, bets, deck);
    }
  };

  const double = () => {
    if (!canDouble) return;
    updateBalance((b) => b - bets[active]);
    const card = deck[0];
    const dk = deck.slice(1);
    const newHands = hands.map((h, i) => (i === active ? [...h, card] : h));
    const newBets = bets.map((b, i) => (i === active ? b * 2 : b));
    // Double = one card then stand this hand
    if (active + 1 < newHands.length) {
      setHands(newHands); setBets(newBets); setDeck(dk); setActive(active + 1);
    } else {
      resolveRound(newHands, newBets, dk);
    }
  };

  const split = () => {
    if (!canSplit) return;
    updateBalance((b) => b - bets[0]);
    const [c0, c1] = hands[0];
    const newHands = [[c0, deck[0]], [c1, deck[1]]];
    setHands(newHands);
    setBets([bets[0], bets[0]]);
    setDeck(deck.slice(2));
    setActive(0);
  };

  const newRound = () => {
    setGameState("betting");
    setHands([]); setBets([]); setDealerCards([]); setResults([]); setActive(0); setNetResult(0);
  };

  const resultLabel = (r: HandResult) =>
    r === "win" ? "WIN" : r === "push" ? "PUSH" : r === "bust" ? "BUST" : "LOSE";
  const resultCls = (r: HandResult) =>
    r === "win"
      ? "text-green-300 border-green-400/40 bg-green-500/10"
      : r === "push"
      ? "text-yellow-300 border-yellow-400/40 bg-yellow-500/10"
      : "text-red-300 border-red-400/40 bg-red-500/10";

  const bannerConfig =
    gameState === "done"
      ? netResult > 0
        ? { label: `YOU WIN  +${netResult.toLocaleString()} ${currencyLabel}`, cls: "text-green-300 border-green-400/40 bg-green-500/10" }
        : netResult < 0
        ? { label: `DEALER WINS  ${netResult.toLocaleString()} ${currencyLabel}`, cls: "text-red-300 border-red-400/40 bg-red-500/10" }
        : { label: "PUSH — Bet Returned", cls: "text-yellow-300 border-yellow-400/40 bg-yellow-500/10" }
      : null;

  return (
    <GameLayout title="BLACKJACK" subtitle="Beat the Dealer to 21" bgImage={bgImage} accentColor="text-white">
      <div className="glass rounded-2xl border border-purple-500/20 overflow-hidden flex flex-col">

        {/* ── Top bar: balance + active bet ── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-purple-500/15">
          <div>
            <div className="text-[10px] text-purple-300/40 tracking-widest uppercase mb-0.5">Balance</div>
            <div className="font-cinzel font-bold text-lg text-yellow-300">
              {showBalance ? <>{balance.toLocaleString()} <span className="text-xs text-yellow-400/60">{currencyLabel}</span></> : <span className="text-purple-300/40">—</span>}
            </div>
          </div>
          <AnimatePresence>
            {totalStaked > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="text-right"
              >
                <div className="text-[10px] text-purple-300/40 tracking-widest uppercase mb-0.5">
                  {isSplit ? "Total Bet" : "Current Bet"}
                </div>
                <div className="font-cinzel font-bold text-lg text-white">
                  {totalStaked.toLocaleString()} <span className="text-xs text-purple-300/60">{currencyLabel}</span>
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

          {/* Player hand(s) */}
          {hands.length === 0 ? (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] text-purple-300/40 tracking-widest uppercase">Your Hand</span>
              </div>
              <div className="flex gap-2 flex-wrap min-h-[4.5rem]" data-testid="player-hand">
                <div className="flex gap-2">
                  {[0, 1].map((i) => (
                    <div key={i} className="w-12 h-[4.25rem] sm:w-14 sm:h-20 rounded-lg border-2 border-dashed border-purple-700/30" />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className={isSplit ? "grid grid-cols-2 gap-3" : ""}>
              {hands.map((hand, hi) => {
                const val = handValue(hand);
                const isActive = gameState === "playing" && hi === active;
                return (
                  <div
                    key={hi}
                    className={`rounded-xl transition-all ${
                      isSplit ? "p-2 border " + (isActive ? "border-yellow-400/60 bg-yellow-400/5" : "border-purple-500/15") : ""
                    }`}
                    data-testid={hi === 0 ? "player-hand" : `player-hand-${hi}`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] text-purple-300/40 tracking-widest uppercase">
                        {isSplit ? `Hand ${hi + 1}` : "Your Hand"}
                      </span>
                      <ScoreChip value={val} bust={val > 21} />
                      {gameState === "done" && results[hi] && (
                        <span className={`text-[9px] font-cinzel font-black tracking-wider px-1.5 py-0.5 rounded border ${resultCls(results[hi])}`}>
                          {resultLabel(results[hi])}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2 flex-wrap min-h-[4.5rem]">
                      {hand.map((card, i) => (
                        <CardDisplay key={i} card={card} delay={i * 0.07} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Result banner */}
          <AnimatePresence>
            {gameState === "done" && bannerConfig && (
              <motion.div
                initial={{ opacity: 0, scale: 0.88, y: 4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 350, damping: 24 }}
                className={`text-center py-2.5 rounded-xl font-cinzel font-black text-sm tracking-[0.18em] uppercase border ${bannerConfig.cls}`}
                data-testid="blackjack-result"
              >
                {bannerConfig.label}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Bottom control panel ── */}
        <div className="border-t border-purple-500/15 bg-black/20 px-5 py-4">
          <AnimatePresence mode="wait">

            {/* BETTING state — real-mode gate (connect/deposit) or bet selector + Deal */}
            {gameState === "betting" && gated && (
              <motion.div
                key="betting-gate"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
              >
                <WalletGateNotice reason={gateReason} />
              </motion.div>
            )}
            {gameState === "betting" && !gated && (
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

            {/* PLAYING state — Hit / Stand / Double / Split */}
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
                <motion.button
                  whileHover={canSplit ? { scale: 1.03, y: -1 } : {}}
                  whileTap={canSplit ? { scale: 0.97 } : {}}
                  onClick={split}
                  disabled={!canSplit}
                  className="py-4 rounded-xl font-cinzel font-black text-sm tracking-[0.2em] uppercase glass border border-cyan-400/40 text-cyan-300 hover:border-cyan-400/70 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  data-testid="button-split"
                >
                  Split
                </motion.button>
                <motion.button
                  whileHover={canDouble ? { scale: 1.03, y: -1 } : {}}
                  whileTap={canDouble ? { scale: 0.97 } : {}}
                  onClick={double}
                  disabled={!canDouble}
                  className="py-4 rounded-xl font-cinzel font-black text-sm tracking-[0.2em] uppercase glass border border-green-400/40 text-green-300 hover:border-green-400/70 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  data-testid="button-double"
                >
                  Double ×2
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
