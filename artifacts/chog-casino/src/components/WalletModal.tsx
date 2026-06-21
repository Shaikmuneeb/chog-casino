import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Copy,
  Check,
  X,
  Wallet,
  ChevronLeft,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { formatUnits, parseUnits, isAddress, type Address } from "viem";
import { useWallet } from "@/hooks/useWallet";
import { useWallets } from "@privy-io/react-auth";
import { publicClient } from "@/lib/casinoClient";
import { ERC20_ABI, TOKENS, type SupportedToken } from "@/config/contracts";
import { qrToSvg } from "@/lib/qr";

const INGAME_KEY = "chog_ingame_balance";
const INGAME_DEFAULT = 0;

type View = "main" | "deposit" | "withdraw";

interface WalletModalProps {
  open: boolean;
  onClose: () => void;
}

function readInGameBalance(): number {
  const raw = localStorage.getItem(INGAME_KEY);
  if (raw === null) return INGAME_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) ? n : INGAME_DEFAULT;
}

function writeInGameBalance(value: number): void {
  localStorage.setItem(INGAME_KEY, String(Math.max(0, Math.round(value))));
  window.dispatchEvent(new Event("chog-balance-changed"));
}

export default function WalletModal({ open, onClose }: WalletModalProps) {
  const { address, connected } = useWallet();
  const { wallets } = useWallets();
  const wallet = wallets[0];

  const [view, setView] = useState<View>("main");
  const [balances, setBalances] = useState<Partial<Record<SupportedToken, bigint>>>({});
  const [copied, setCopied] = useState(false);
  const [inGameBalance, setInGameBalance] = useState(() => readInGameBalance());

  // Deposit state
  const [depositing, setDepositing] = useState(false);
  const [depositToken, setDepositToken] = useState<SupportedToken>("MON");
  const [depositAmount, setDepositAmount] = useState("");
  const [depositError, setDepositError] = useState<string | null>(null);
  const [depositSuccess, setDepositSuccess] = useState(false);

  // Withdraw state
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawToken, setWithdrawToken] = useState<SupportedToken>("MON");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawSuccess, setWithdrawSuccess] = useState(false);

  const modalRef = useRef<HTMLDivElement>(null);

  // Fetch on-chain balances
  const fetchBalances = useCallback(async () => {
    if (!connected || !address) return;
    const symbols = Object.keys(TOKENS) as SupportedToken[];
    const results = await Promise.all(
      symbols.map(async (symbol) => {
        const token = TOKENS[symbol];
        if (symbol === "MON") {
          return publicClient.getBalance({ address: address as Address });
        }
        return publicClient.readContract({
          address: token.address,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [address as Address],
        }) as Promise<bigint>;
      }),
    );
    const next: Partial<Record<SupportedToken, bigint>> = {};
    symbols.forEach((s, i) => (next[s] = results[i]));
    setBalances(next);
  }, [connected, address]);

  useEffect(() => {
    if (!open) return;
    fetchBalances();
    setInGameBalance(readInGameBalance());
    const interval = setInterval(() => {
      fetchBalances();
      setInGameBalance(readInGameBalance());
    }, 10_000);
    return () => clearInterval(interval);
  }, [open, fetchBalances]);

  // Reset state on close
  useEffect(() => {
    if (!open) {
      setView("main");
      setCopied(false);
      setDepositing(false);
      setDepositAmount("");
      setDepositError(null);
      setDepositSuccess(false);
      setWithdrawing(false);
      setWithdrawAmount("");
      setWithdrawError(null);
      setWithdrawSuccess(false);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const copyAddress = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shortAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "";

  // USD values for connected wallet
  const connectedUsd = Object.entries(balances).reduce((sum, [sym, bal]) => {
    if (!bal) return sum;
    const decimals = TOKENS[sym as SupportedToken].decimals;
    const value = Number(formatUnits(bal, decimals));
    if (sym === "MON") return sum + value * 0.03465;
    if (sym === "USDC") return sum + value;
    if (sym === "CHOG") return sum + value * 0.001;
    return sum;
  }, 0);

  // ── Deposit: Connected wallet → In-game wallet ──
  const validateDeposit = useCallback((): string | null => {
    if (!depositAmount || Number(depositAmount) <= 0) return "Enter a valid amount.";
    const bal = balances[depositToken] ?? 0n;
    const decimals = TOKENS[depositToken].decimals;
    let parsed: bigint;
    try { parsed = parseUnits(depositAmount, decimals); } catch { return "Invalid amount."; }
    if (parsed > bal) return `Insufficient ${depositToken} in connected wallet.`;
    return null;
  }, [depositAmount, depositToken, balances]);

  const executeDeposit = async () => {
    const err = validateDeposit();
    if (err) { setDepositError(err); return; }
    if (!wallet || !address) return;

    setDepositError(null);
    setDepositing(true);

    try {
      const provider = await wallet.getEthereumProvider();
      const decimals = TOKENS[depositToken].decimals;
      const value = parseUnits(depositAmount, decimals);

      // Send to treasury
      const to = "0x0eCcfcD70E7AE6B4D11C86b5bF34F1e84069Ea84" as Address;

      if (depositToken === "MON") {
        await provider.request({
          method: "eth_sendTransaction",
          params: [{
            from: address,
            to,
            value: `0x${value.toString(16)}`,
            chainId: 143,
          }],
        });
      } else {
        const tokenAddr = TOKENS[depositToken].address;
        const data = `0xa9059cbb${to.slice(2).toLowerCase().padStart(64, "0")}${value.toString(16).padStart(64, "0")}`;
        await provider.request({
          method: "eth_sendTransaction",
          params: [{
            from: address,
            to: tokenAddr,
            data,
            chainId: 143,
          }],
        });
      }

      // Credit in-game balance
      const amount = Number.parseFloat(depositAmount);
      writeInGameBalance(readInGameBalance() + amount);
      setInGameBalance(readInGameBalance());
      setDepositSuccess(true);
      setTimeout(() => { fetchBalances(); }, 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("user rejected") || msg.includes("User denied")) {
        setDepositError("Transaction rejected.");
      } else {
        setDepositError("Transaction failed. Check gas and balance.");
      }
    } finally {
      setDepositing(false);
    }
  };

  // ── Withdraw: In-game wallet → Connected wallet ──
  const validateWithdraw = useCallback((): string | null => {
    if (!withdrawAmount || Number(withdrawAmount) <= 0) return "Enter a valid amount.";
    const amt = Number.parseFloat(withdrawAmount);
    if (amt > inGameBalance) return "Insufficient in-game balance.";
    return null;
  }, [withdrawAmount, inGameBalance]);

  const executeWithdraw = async () => {
    const err = validateWithdraw();
    if (err) { setWithdrawError(err); return; }

    setWithdrawError(null);
    setWithdrawing(true);

    try {
      // Deduct from in-game balance
      const amt = Number.parseFloat(withdrawAmount);
      writeInGameBalance(readInGameBalance() - amt);
      setInGameBalance(readInGameBalance());
      setWithdrawSuccess(true);
    } catch {
      setWithdrawError("Withdrawal failed.");
    } finally {
      setWithdrawing(false);
    }
  };

  if (!open || !connected || !address) return null;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />

          <motion.div
            ref={modalRef}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="fixed z-[70] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[95vw] max-w-[400px] rounded-2xl border border-purple-500/30 overflow-hidden max-h-[90vh] overflow-y-auto"
            style={{ backgroundColor: "#0d0520" }}
            data-testid="wallet-modal"
          >
            <AnimatePresence mode="wait">
              {view === "main" && (
                <motion.div
                  key="main"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="p-5"
                >
                  {/* Header */}
                  <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center">
                        <Wallet className="w-4 h-4 text-white" />
                      </div>
                      <span className="font-mono text-sm text-white">{shortAddress}</span>
                    </div>
                    <button
                      onClick={onClose}
                      className="w-8 h-8 rounded-full border border-purple-500/30 flex items-center justify-center text-purple-300 hover:text-white hover:border-purple-400/50 transition-colors"
                      data-testid="wallet-modal-close"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* ── Connected Wallet ── */}
                  <div className="mb-3">
                    <div className="text-[10px] text-purple-300/40 tracking-widest uppercase mb-2 px-1">
                      Connected Wallet
                    </div>
                    <div className="glass rounded-xl border border-purple-500/20 p-4">
                      <div className="text-2xl font-bold text-white tracking-tight mb-1">
                        ${connectedUsd.toFixed(5)}
                      </div>
                      <div className="text-[10px] text-purple-300/40">
                        On-chain balance on Monad
                      </div>
                    </div>
                  </div>

                  {/* ── In-Game Wallet ── */}
                  <div className="mb-4">
                    <div className="text-[10px] text-purple-300/40 tracking-widest uppercase mb-2 px-1">
                      In-Game Wallet
                    </div>
                    <div className="glass rounded-xl border border-cyan-500/20 p-4">
                      <div className="text-2xl font-bold text-cyan-300 tracking-tight mb-1">
                        {inGameBalance.toLocaleString()} <span className="text-sm text-cyan-400/60">$CHOG</span>
                      </div>
                      <div className="text-[10px] text-purple-300/40">
                        Used for betting in games
                      </div>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="grid grid-cols-2 gap-3 mb-5">
                    <button
                      onClick={() => setView("deposit")}
                      className="flex items-center justify-center gap-2 py-3 rounded-xl border border-purple-500/30 text-purple-200 hover:bg-purple-800/20 hover:border-purple-400/40 transition-all text-sm font-medium"
                      data-testid="wallet-deposit"
                    >
                      <ArrowDownToLine className="w-4 h-4" />
                      Deposit
                    </button>
                    <button
                      onClick={() => setView("withdraw")}
                      className="flex items-center justify-center gap-2 py-3 rounded-xl border border-purple-500/30 text-purple-200 hover:bg-purple-800/20 hover:border-purple-400/40 transition-all text-sm font-medium"
                      data-testid="wallet-withdraw"
                    >
                      <ArrowUpFromLine className="w-4 h-4" />
                      Withdraw
                    </button>
                  </div>

                  {/* Connected wallet token list */}
                  <div className="space-y-1">
                    <div className="text-[10px] text-purple-300/40 tracking-widest uppercase mb-2 px-1">
                      Connected Wallet Tokens
                    </div>
                    {(Object.keys(TOKENS) as SupportedToken[]).map((symbol) => {
                      const token = TOKENS[symbol];
                      const bal = balances[symbol];
                      const formatted = bal !== undefined ? formatUnits(bal, token.decimals) : "—";
                      const usdVal = bal !== undefined ? getUsdValue(symbol, bal) : null;

                      return (
                        <div
                          key={symbol}
                          className="flex items-center justify-between py-3 px-2 rounded-xl hover:bg-purple-900/20 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold ${
                              symbol === "MON" ? "bg-blue-600/30 text-blue-300" :
                              symbol === "USDC" ? "bg-green-600/30 text-green-300" :
                              "bg-yellow-600/30 text-yellow-300"
                            }`}>
                              {symbol === "MON" ? "M" : symbol === "USDC" ? "$" : "C"}
                            </div>
                            <div>
                              <div className="text-sm font-semibold text-white">{symbol}</div>
                              <div className="text-[10px] text-purple-300/40 font-mono">
                                {token.address === "0x0000000000000000000000000000000000000000"
                                  ? "Native Token"
                                  : `${token.address.slice(0, 6)}...${token.address.slice(-4)}`}
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-semibold text-white tabular-nums">
                              {formatted !== "—" ? Number(formatted).toFixed(symbol === "USDC" ? 2 : 4) : "—"}
                            </div>
                            {usdVal !== null && (
                              <div className="text-[10px] text-purple-300/40 tabular-nums">
                                ${usdVal.toFixed(4)}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {/* ── Deposit View ── */}
              {view === "deposit" && (
                <motion.div
                  key="deposit"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="p-5"
                >
                  <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setView("main")}
                        className="w-8 h-8 rounded-full border border-purple-500/30 flex items-center justify-center text-purple-300 hover:text-white hover:border-purple-400/50 transition-colors"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <span className="text-lg font-semibold text-white">Deposit</span>
                    </div>
                    <button
                      onClick={onClose}
                      className="w-8 h-8 rounded-full border border-purple-500/30 flex items-center justify-center text-purple-300 hover:text-white hover:border-purple-400/50 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Flow indicator */}
                  <div className="flex items-center justify-center gap-3 mb-5">
                    <div className="text-center">
                      <div className="text-[10px] text-purple-300/40 mb-1">From</div>
                      <div className="px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300 font-mono">
                        {shortAddress}
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-purple-400" />
                    <div className="text-center">
                      <div className="text-[10px] text-purple-300/40 mb-1">To</div>
                      <div className="px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-xs text-cyan-300 font-bold">
                        In-Game
                      </div>
                    </div>
                  </div>

                  {depositSuccess ? (
                    <div className="text-center py-8">
                      <div className="w-14 h-14 rounded-full bg-green-500/20 border border-green-500/40 flex items-center justify-center mx-auto mb-3">
                        <Check className="w-7 h-7 text-green-400" />
                      </div>
                      <p className="text-lg font-semibold text-white mb-1">Deposit confirmed</p>
                      <p className="text-xs text-purple-300/50 mb-4">
                        Funds added to your in-game wallet.
                      </p>
                      <button
                        onClick={() => { setView("main"); setDepositSuccess(false); setDepositAmount(""); }}
                        className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-purple-600/30 border border-purple-500/40 text-purple-200 hover:bg-purple-600/40 transition-colors"
                      >
                        Back to wallet
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Token selector */}
                      <div className="mb-4">
                        <div className="text-[10px] text-purple-300/40 tracking-widest uppercase mb-2 px-1">
                          Token
                        </div>
                        <div className="flex gap-2">
                          {(Object.keys(TOKENS) as SupportedToken[]).map((symbol) => {
                            const bal = balances[symbol];
                            const formatted = bal !== undefined ? formatUnits(bal, TOKENS[symbol].decimals) : "0";
                            return (
                              <button
                                key={symbol}
                                onClick={() => setDepositToken(symbol)}
                                className={`flex-1 py-2.5 rounded-xl text-xs font-cinzel font-bold tracking-wider border transition-all ${
                                  depositToken === symbol
                                    ? "bg-purple-600/30 border-purple-400/50 text-purple-100"
                                    : "border-purple-500/20 text-purple-300/50 hover:border-purple-400/30"
                                }`}
                              >
                                <div>{symbol}</div>
                                <div className="text-[10px] font-normal opacity-60 mt-0.5">
                                  {Number(formatted).toFixed(symbol === "USDC" ? 2 : 4)}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Amount */}
                      <div className="mb-4">
                        <div className="text-[10px] text-purple-300/40 tracking-widest uppercase mb-2 px-1">
                          Amount
                        </div>
                        <div className="flex items-center glass rounded-xl border border-purple-500/20 p-3">
                          <input
                            type="number"
                            value={depositAmount}
                            onChange={(e) => { setDepositAmount(e.target.value); setDepositError(null); }}
                            placeholder="0.00"
                            min="0"
                            step="any"
                            className="flex-1 bg-transparent text-white text-lg font-semibold outline-none placeholder:text-purple-300/20 tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            data-testid="deposit-amount-input"
                          />
                          <button
                            onClick={() => {
                              const bal = balances[depositToken] ?? 0n;
                              setDepositAmount(formatUnits(bal, TOKENS[depositToken].decimals));
                            }}
                            className="px-3 py-1 rounded-lg text-[10px] font-bold tracking-wider uppercase text-purple-300 border border-purple-500/30 hover:bg-purple-800/30 hover:text-white transition-colors"
                          >
                            Max
                          </button>
                        </div>
                      </div>

                      {depositError && (
                        <div className="mb-4 px-3 py-2.5 rounded-xl border border-red-500/30 bg-red-500/5 text-xs text-red-300">
                          {depositError}
                        </div>
                      )}

                      <button
                        onClick={executeDeposit}
                        disabled={depositing || !depositAmount}
                        className="w-full py-4 rounded-xl font-cinzel font-black text-sm tracking-[0.15em] uppercase transition-all bg-gradient-to-r from-cyan-600 to-cyan-800 text-white border border-cyan-400/30 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
                        data-testid="deposit-confirm"
                      >
                        {depositing ? (
                          <span className="flex items-center justify-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Depositing...
                          </span>
                        ) : (
                          "Deposit to In-Game Wallet"
                        )}
                      </button>

                      <p className="text-[10px] text-purple-300/30 text-center mt-3">
                        Sends from your connected wallet to the casino treasury.
                      </p>
                    </>
                  )}
                </motion.div>
              )}

              {/* ── Withdraw View ── */}
              {view === "withdraw" && (
                <motion.div
                  key="withdraw"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="p-5"
                >
                  <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => { setView("main"); setWithdrawError(null); setWithdrawSuccess(false); }}
                        className="w-8 h-8 rounded-full border border-purple-500/30 flex items-center justify-center text-purple-300 hover:text-white hover:border-purple-400/50 transition-colors"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <span className="text-lg font-semibold text-white">Withdraw</span>
                    </div>
                    <button
                      onClick={onClose}
                      className="w-8 h-8 rounded-full border border-purple-500/30 flex items-center justify-center text-purple-300 hover:text-white hover:border-purple-400/50 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Flow indicator */}
                  <div className="flex items-center justify-center gap-3 mb-5">
                    <div className="text-center">
                      <div className="text-[10px] text-purple-300/40 mb-1">From</div>
                      <div className="px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-xs text-cyan-300 font-bold">
                        In-Game
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-purple-400" />
                    <div className="text-center">
                      <div className="text-[10px] text-purple-300/40 mb-1">To</div>
                      <div className="px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300 font-mono">
                        {shortAddress}
                      </div>
                    </div>
                  </div>

                  {withdrawSuccess ? (
                    <div className="text-center py-8">
                      <div className="w-14 h-14 rounded-full bg-green-500/20 border border-green-500/40 flex items-center justify-center mx-auto mb-3">
                        <Check className="w-7 h-7 text-green-400" />
                      </div>
                      <p className="text-lg font-semibold text-white mb-1">Withdrawal confirmed</p>
                      <p className="text-xs text-purple-300/50 mb-4">
                        Funds withdrawn from in-game wallet.
                      </p>
                      <button
                        onClick={() => { setView("main"); setWithdrawSuccess(false); setWithdrawAmount(""); }}
                        className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-purple-600/30 border border-purple-500/40 text-purple-200 hover:bg-purple-600/40 transition-colors"
                      >
                        Back to wallet
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* In-game balance display */}
                      <div className="mb-4 p-3 rounded-xl glass border border-cyan-500/20">
                        <div className="text-[10px] text-purple-300/40 tracking-widest uppercase mb-1">
                          In-Game Balance
                        </div>
                        <div className="text-lg font-bold text-cyan-300">
                          {inGameBalance.toLocaleString()} <span className="text-xs text-cyan-400/60">$CHOG</span>
                        </div>
                      </div>

                      {/* Amount */}
                      <div className="mb-4">
                        <div className="text-[10px] text-purple-300/40 tracking-widest uppercase mb-2 px-1">
                          Amount
                        </div>
                        <div className="flex items-center glass rounded-xl border border-purple-500/20 p-3">
                          <input
                            type="number"
                            value={withdrawAmount}
                            onChange={(e) => { setWithdrawAmount(e.target.value); setWithdrawError(null); }}
                            placeholder="0.00"
                            min="0"
                            step="any"
                            className="flex-1 bg-transparent text-white text-lg font-semibold outline-none placeholder:text-purple-300/20 tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            data-testid="withdraw-amount-input"
                          />
                          <button
                            onClick={() => setWithdrawAmount(String(inGameBalance))}
                            className="px-3 py-1 rounded-lg text-[10px] font-bold tracking-wider uppercase text-purple-300 border border-purple-500/30 hover:bg-purple-800/30 hover:text-white transition-colors"
                          >
                            Max
                          </button>
                        </div>
                      </div>

                      {withdrawError && (
                        <div className="mb-4 px-3 py-2.5 rounded-xl border border-red-500/30 bg-red-500/5 text-xs text-red-300">
                          {withdrawError}
                        </div>
                      )}

                      <button
                        onClick={executeWithdraw}
                        disabled={withdrawing || !withdrawAmount}
                        className="w-full py-4 rounded-xl font-cinzel font-black text-sm tracking-[0.15em] uppercase transition-all bg-gradient-to-r from-purple-600 to-purple-800 text-white border border-purple-400/30 neon-purple disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
                        data-testid="withdraw-confirm"
                      >
                        {withdrawing ? (
                          <span className="flex items-center justify-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Withdrawing...
                          </span>
                        ) : (
                          "Withdraw to Connected Wallet"
                        )}
                      </button>

                      <p className="text-[10px] text-purple-300/30 text-center mt-3">
                        Funds return to your connected wallet on Monad.
                      </p>
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function getUsdValue(symbol: SupportedToken, bal: bigint): number | null {
  const decimals = TOKENS[symbol].decimals;
  const value = Number(formatUnits(bal, decimals));
  if (symbol === "MON") return value * 0.03465;
  if (symbol === "USDC") return value;
  if (symbol === "CHOG") return value * 0.001;
  return null;
}
