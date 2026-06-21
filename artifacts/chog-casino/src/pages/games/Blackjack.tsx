import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { formatUnits } from "viem";
import GameLayout from "@/components/GameLayout";
import BetControls from "@/components/BetControls";
import WalletGateNotice from "@/components/WalletGateNotice";
import TokenSelector from "@/components/TokenSelector";
import { useGameBalance } from "@/hooks/useGameBalance";
import { useGameMode } from "@/context/GameModeContext";
import { useWallet } from "@/hooks/useWallet";
import { useBlackjackOnChain, type LiveCards } from "@/hooks/useBlackjackOnChain";
import { publicClient } from "@/lib/casinoClient";
import { CUSTODIAL_VAULT_ABI, TOKENS, isDeployed, CONTRACTS, type SupportedToken } from "@/config/contracts";
import bgImage from "@assets/image_1781811969584.png";

type Card = { value: string; suit: string; numeric: number };
type GameState = "betting" | "playing" | "done";
type HandResult = "win" | "push" | "lose" | "bust";

// ── Web Audio: short card-snap sound played as each card slides in ─────────
let _bjCtx: AudioContext | null = null;

function bjAudioCtx(): AudioContext | null {
  try {
    if (!_bjCtx) {
      _bjCtx = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    if (_bjCtx.state === "suspended") _bjCtx.resume();
    return _bjCtx;
  } catch {
    return null;
  }
}

function playCardSound() {
  const ctx = bjAudioCtx();
  if (!ctx) return;
  const duration = 0.05;
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 1400;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.22, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  noise.start();
}
// ─────────────────────────────────────────────────────────────────────────

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

// Converts the operator's rank-only (0-12) card encoding into a displayable Card. Suit is
// purely cosmetic here — rank 0-12 already fully determines blackjack value, and the
// contract/operator never track suits at all (they don't affect scoring or payout).
function rankToCard(rank: number, idx: number): Card {
  const value = VALUES[rank] ?? "2";
  const numeric = value === "A" ? 11 : ["J", "Q", "K"].includes(value) ? 10 : parseInt(value);
  return { value, suit: SUITS[idx % SUITS.length], numeric };
}

function CardDisplay({ card, hidden, delay = 0 }: { card: Card; hidden?: boolean; delay?: number }) {
  const red = card.suit === "♥" || card.suit === "♦";
  const ink = red ? "text-red-600" : "text-gray-900";

  useEffect(() => {
    const t = setTimeout(() => playCardSound(), delay * 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const { mode } = useGameMode();
  const isReal = mode === "real";
  const { address, connected } = useWallet();

  const [betInput, setBetInput] = useState(100);
  const { balance, updateBalance, showBalance, currencyLabel } = useGameBalance();
  const [deck, setDeck] = useState<Card[]>([]);
  const [hands, setHands] = useState<Card[][]>([]); // 1 hand normally, 2 after a split
  const [bets, setBets] = useState<number[]>([]);
  const [active, setActive] = useState(0); // which hand is being played
  const [dealerCards, setDealerCards] = useState<Card[]>([]);
  const [gameState, setGameState] = useState<GameState>("betting");
  const [results, setResults] = useState<HandResult[]>([]); // per-hand outcome
  const [netResult, setNetResult] = useState(0); // net win/loss for the banner

  // ── Real-mode on-chain state ──
  const [realToken, setRealToken] = useState<SupportedToken>("MON");
  const [realBetAmount, setRealBetAmount] = useState(1);
  const [realBalanceRaw, setRealBalanceRaw] = useState(0n);
  const [chainError, setChainError] = useState<string | null>(null);
  const [roundId, setRoundId] = useState<bigint | null>(null);
  const [handClosed, setHandClosed] = useState<[boolean, boolean]>([false, false]);
  const [dealerHoleRevealed, setDealerHoleRevealed] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [awaitingSettlement, setAwaitingSettlement] = useState(false);
  const {
    placeBetFromVault,
    hitFromVault,
    standFromVault,
    doubleFromVault,
    splitFromVault,
    waitForResolutionFromVault,
  } = useBlackjackOnChain();
  const deployed = isDeployed(CONTRACTS.blackjack) && isDeployed(CONTRACTS.treasury) && isDeployed(CONTRACTS.custodialVault);

  useEffect(() => {
    if (!isReal || !connected || !address) return;
    let cancelled = false;
    async function load() {
      const info = TOKENS[realToken];
      const raw = (await publicClient.readContract({
        address: CONTRACTS.custodialVault,
        abi: CUSTODIAL_VAULT_ABI,
        functionName: "balanceOf",
        args: [address as `0x${string}`, info.address],
      })) as bigint;
      if (!cancelled) setRealBalanceRaw(raw);
    }
    load();
    const id = setInterval(load, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isReal, connected, address, realToken]);

  const realBalanceHuman = Math.floor(Number(formatUnits(realBalanceRaw, TOKENS[realToken].decimals)));

  // Switching Real/Fun mid-round must not leak the other mode's state onto screen.
  useEffect(() => {
    setGameState("betting");
    setHands([]);
    setBets([]);
    setDealerCards([]);
    setResults([]);
    setActive(0);
    setNetResult(0);
    setRoundId(null);
    setChainError(null);
    setHandClosed([false, false]);
    setDealerHoleRevealed(false);
    setAwaitingSettlement(false);
  }, [isReal]);

  const applyLiveCards = useCallback((cards: LiveCards) => {
    const hand0Cards = cards.hand0.map((r, i) => rankToCard(r, i));
    const hand1Cards = cards.hand1.map((r, i) => rankToCard(r, i + 10));
    setHands(cards.hand1.length > 0 ? [hand0Cards, hand1Cards] : [hand0Cards]);
    setDealerCards([
      rankToCard(cards.dealerUp, 20),
      rankToCard(cards.dealerHoleRevealed ? cards.dealerHole : 0, 21),
    ]);
    setDealerHoleRevealed(cards.dealerHoleRevealed);
  }, []);

  const computeResultsFromCards = (cards: LiveCards): HandResult[] => {
    const dealerTotal = handValue([rankToCard(cards.dealerUp, 0), rankToCard(cards.dealerHole, 1)]);
    const handsRanks = cards.hand1.length > 0 ? [cards.hand0, cards.hand1] : [cards.hand0];
    return handsRanks.map((h) => {
      const pv = handValue(h.map((r, i) => rankToCard(r, i)));
      if (pv > 21) return "bust";
      if (dealerTotal > 21 || pv > dealerTotal) return "win";
      if (pv === dealerTotal) return "push";
      return "lose";
    });
  };

  const advanceOrFinish = async (justClosedIndex: number, cards: LiveCards, betsHuman: number[]) => {
    const totalHands = cards.hand1.length > 0 ? 2 : 1;
    const closedAfter = [...handClosed] as [boolean, boolean];
    closedAfter[justClosedIndex] = true;
    const nextIndex = justClosedIndex + 1;
    if (nextIndex < totalHands && !closedAfter[nextIndex]) {
      setHandClosed(closedAfter);
      setActive(nextIndex);
      return;
    }
    setHandClosed(closedAfter);
    if (!roundId) return;
    setResults(computeResultsFromCards(cards));
    setAwaitingSettlement(true);
    try {
      const payout = await waitForResolutionFromVault(roundId);
      const payoutHuman = Number(formatUnits(payout, TOKENS[realToken].decimals));
      const staked = betsHuman.reduce((a, b) => a + b, 0);
      setNetResult(Math.round((payoutHuman - staked) * 10000) / 10000);
      setGameState("done");
    } catch (err) {
      setChainError(err instanceof Error ? err.message : "Settlement failed");
    } finally {
      setAwaitingSettlement(false);
    }
  };

  const canDealReal =
    gameState === "betting" &&
    connected &&
    deployed &&
    !actionPending &&
    realBetAmount > 0 &&
    realBetAmount <= realBalanceHuman;

  const dealReal = async () => {
    if (!canDealReal) return;
    bjAudioCtx();
    setChainError(null);
    setActionPending(true);
    try {
      const { roundId: rid, cards } = await placeBetFromVault(realToken, String(realBetAmount));
      setRoundId(rid);
      applyLiveCards(cards);
      setBets([realBetAmount]);
      setHandClosed([false, false]);
      setActive(0);
      setResults([]);
      setNetResult(0);
      setGameState("playing");
    } catch (err) {
      setChainError(err instanceof Error ? err.message : "Bet failed");
    } finally {
      setActionPending(false);
    }
  };

  const hitReal = async (handIndex: number) => {
    if (!roundId || actionPending) return;
    bjAudioCtx();
    setActionPending(true);
    try {
      let updated = await hitFromVault(roundId, handIndex);
      applyLiveCards(updated);
      const handRanks = handIndex === 0 ? updated.hand0 : updated.hand1;
      const val = handValue(handRanks.map((r, i) => rankToCard(r, i)));
      if (val > 21) {
        // Busted — the contract has no way to know this on its own; we must close the hand
        // explicitly so the round can ever become eligible for settlement.
        updated = await standFromVault(roundId, handIndex);
        applyLiveCards(updated);
        await advanceOrFinish(handIndex, updated, bets);
      }
    } catch (err) {
      setChainError(err instanceof Error ? err.message : "Hit failed");
    } finally {
      setActionPending(false);
    }
  };

  const standReal = async (handIndex: number) => {
    if (!roundId || actionPending) return;
    setActionPending(true);
    try {
      const updated = await standFromVault(roundId, handIndex);
      applyLiveCards(updated);
      await advanceOrFinish(handIndex, updated, bets);
    } catch (err) {
      setChainError(err instanceof Error ? err.message : "Stand failed");
    } finally {
      setActionPending(false);
    }
  };

  const doubleReal = async (handIndex: number) => {
    if (!roundId || actionPending) return;
    bjAudioCtx();
    setActionPending(true);
    try {
      const updated = await doubleFromVault(roundId, handIndex);
      applyLiveCards(updated);
      const newBets = bets.map((b, i) => (i === handIndex ? b * 2 : b));
      setBets(newBets);
      await advanceOrFinish(handIndex, updated, newBets);
    } catch (err) {
      setChainError(err instanceof Error ? err.message : "Double failed");
    } finally {
      setActionPending(false);
    }
  };

  const splitReal = async () => {
    if (!roundId || actionPending) return;
    bjAudioCtx();
    setActionPending(true);
    try {
      const updated = await splitFromVault(roundId);
      applyLiveCards(updated);
      setBets([bets[0], bets[0]]);
      setActive(0);
    } catch (err) {
      setChainError(err instanceof Error ? err.message : "Split failed");
    } finally {
      setActionPending(false);
    }
  };

  const newRoundReal = () => {
    setGameState("betting");
    setHands([]);
    setDealerCards([]);
    setResults([]);
    setActive(0);
    setNetResult(0);
    setRoundId(null);
    setHandClosed([false, false]);
    setDealerHoleRevealed(false);
    setChainError(null);
  };

  const betAmount = betInput;
  const totalStaked = bets.reduce((a, b) => a + b, 0);
  const canDeal = gameState === "betting" && !isReal && betAmount > 0 && betAmount <= balance;
  const dealerVal = handValue(dealerCards);
  const showDealerFull = isReal ? dealerHoleRevealed : gameState === "done";
  const isSplit = hands.length > 1;
  const activeHand = hands[active] ?? [];
  const unitLabel = isReal ? realToken : currencyLabel;

  const canDouble = isReal
    ? gameState === "playing" &&
      !actionPending &&
      !handClosed[active] &&
      activeHand.length === 2 &&
      realBalanceHuman >= (bets[active] ?? Infinity)
    : gameState === "playing" && activeHand.length === 2 && balance >= (bets[active] ?? Infinity);
  const canSplit = isReal
    ? gameState === "playing" &&
      !actionPending &&
      !isSplit &&
      activeHand.length === 2 &&
      activeHand[0]?.value === activeHand[1]?.value &&
      realBalanceHuman >= (bets[0] ?? Infinity)
    : gameState === "playing" &&
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

  const dealFun = () => {
    if (!canDeal) return;
    bjAudioCtx(); // unlock audio on this user gesture
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

  const hitFun = () => {
    if (gameState !== "playing") return;
    bjAudioCtx();
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

  const standFun = () => {
    if (gameState !== "playing") return;
    if (active + 1 < hands.length) {
      setActive(active + 1);
    } else {
      resolveRound(hands, bets, deck);
    }
  };

  const doubleFun = () => {
    if (!canDouble) return;
    bjAudioCtx();
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

  const splitFun = () => {
    if (!canSplit) return;
    bjAudioCtx();
    updateBalance((b) => b - bets[0]);
    const [c0, c1] = hands[0];
    const newHands = [[c0, deck[0]], [c1, deck[1]]];
    setHands(newHands);
    setBets([bets[0], bets[0]]);
    setDeck(deck.slice(2));
    setActive(0);
  };

  const deal = isReal ? dealReal : dealFun;
  const hit = () => (isReal ? hitReal(active) : hitFun());
  const stand = () => (isReal ? standReal(active) : standFun());
  const double = () => (isReal ? doubleReal(active) : doubleFun());
  const split = isReal ? splitReal : splitFun;

  const newRoundFun = () => {
    setGameState("betting");
    setHands([]); setBets([]); setDealerCards([]); setResults([]); setActive(0); setNetResult(0);
  };
  const newRound = isReal ? newRoundReal : newRoundFun;

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
        ? { label: `YOU WIN  +${netResult.toLocaleString()} ${unitLabel}`, cls: "text-green-300 border-green-400/40 bg-green-500/10" }
        : netResult < 0
        ? { label: `DEALER WINS  ${netResult.toLocaleString()} ${unitLabel}`, cls: "text-red-300 border-red-400/40 bg-red-500/10" }
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
              {isReal ? (
                connected ? (
                  <>{realBalanceHuman.toLocaleString()} <span className="text-xs text-yellow-400/60">{realToken}</span></>
                ) : (
                  <span className="text-purple-300/40">—</span>
                )
              ) : showBalance ? (
                <>{balance.toLocaleString()} <span className="text-xs text-yellow-400/60">{currencyLabel}</span></>
              ) : (
                <span className="text-purple-300/40">—</span>
              )}
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
                  {totalStaked.toLocaleString()} <span className="text-xs text-purple-300/60">{unitLabel}</span>
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
          {chainError && (
            <div className="mb-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              {chainError}
            </div>
          )}
          <AnimatePresence mode="wait">

            {/* BETTING state — real-mode gate (connect wallet) or bet selector + Deal */}
            {gameState === "betting" && isReal && !connected && (
              <motion.div
                key="betting-gate"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
              >
                <WalletGateNotice reason="wallet" />
              </motion.div>
            )}
            {gameState === "betting" && (!isReal || connected) && (
              <motion.div
                key="betting-controls"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="flex flex-col gap-3"
              >
                {isReal && (
                  <TokenSelector value={realToken} onChange={setRealToken} />
                )}
                <div className="flex items-end gap-3">
                  {/* Bet controls */}
                  <div className="flex-1">
                    {isReal ? (
                      <BetControls value={realBetAmount} onChange={setRealBetAmount} max={realBalanceHuman} unitLabel={realToken} />
                    ) : (
                      <BetControls value={betInput} onChange={setBetInput} max={balance} />
                    )}
                  </div>

                  {/* Deal button */}
                  <motion.button
                    whileHover={(isReal ? canDealReal : canDeal) ? { scale: 1.04, y: -1 } : {}}
                    whileTap={(isReal ? canDealReal : canDeal) ? { scale: 0.96 } : {}}
                    onClick={deal}
                    disabled={isReal ? !canDealReal : !canDeal}
                    className="shrink-0 px-7 py-[2.65rem] rounded-xl font-cinzel font-black text-sm tracking-[0.2em] uppercase bg-gradient-to-b from-purple-500 to-purple-800 text-white neon-purple border border-purple-400/40 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    data-testid="button-deal"
                  >
                    {isReal && actionPending ? "..." : "DEAL"}
                  </motion.button>
                </div>
              </motion.div>
            )}

            {/* PLAYING state — Hit / Stand / Double / Split, or awaiting on-chain settlement */}
            {gameState === "playing" && awaitingSettlement && (
              <motion.div
                key="settling"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="text-center py-4 text-sm text-purple-300/70 font-cinzel tracking-widest uppercase"
              >
                Settling round on-chain…
              </motion.div>
            )}
            {gameState === "playing" && !awaitingSettlement && (
              <motion.div
                key="play-controls"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="grid grid-cols-2 gap-3"
              >
                <motion.button
                  whileHover={!actionPending ? { scale: 1.03, y: -1 } : {}}
                  whileTap={!actionPending ? { scale: 0.97 } : {}}
                  onClick={hit}
                  disabled={isReal && actionPending}
                  className="py-4 rounded-xl font-cinzel font-black text-sm tracking-[0.2em] uppercase bg-gradient-to-r from-purple-600 to-purple-800 text-white neon-purple border border-purple-400/40 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  data-testid="button-hit"
                >
                  Hit
                </motion.button>
                <motion.button
                  whileHover={!actionPending ? { scale: 1.03, y: -1 } : {}}
                  whileTap={!actionPending ? { scale: 0.97 } : {}}
                  onClick={stand}
                  disabled={isReal && actionPending}
                  className="py-4 rounded-xl font-cinzel font-black text-sm tracking-[0.2em] uppercase glass border border-yellow-400/40 text-yellow-300 hover:border-yellow-400/70 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
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
