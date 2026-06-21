import { useCallback, useEffect, useState, useRef } from "react";
import { formatUnits } from "viem";
import { useWallet } from "@/hooks/useWallet";
import { useGameMode } from "@/context/GameModeContext";
import { publicClient } from "@/lib/casinoClient";
import { ERC20_ABI, TOKENS, type SupportedToken } from "@/config/contracts";

const FUN_KEY = "chog_fun_balance";
const FUN_DEFAULT = 10_000;

export type GateReason = "wallet" | "deposit" | null;

const BALANCE_CHANGED_EVENT = "chog-balance-changed";

function readFunBalance(): number {
  const raw = localStorage.getItem(FUN_KEY);
  if (raw === null) return FUN_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) ? n : FUN_DEFAULT;
}

function writeFunBalance(value: number): void {
  localStorage.setItem(FUN_KEY, String(value));
  window.dispatchEvent(new Event(BALANCE_CHANGED_EVENT));
}

/**
 * Fetches the user's on-chain balance across MON, USDC, and CHOG.
 * Returns the total balance denominated in MON (native) for internal accounting.
 * 1 USDC = ~28.86 MON, 1 CHOG = ~0.028 MON (approximate peg for display).
 */
async function fetchOnChainBalance(address: string): Promise<number> {
  const addr = address as `0x${string}`;
  const [monBal, usdcBal, chogBal] = await Promise.all([
    publicClient.getBalance({ address: addr }),
    publicClient.readContract({
      address: TOKENS.USDC.address,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [addr],
    }) as Promise<bigint>,
    publicClient.readContract({
      address: TOKENS.CHOG.address,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [addr],
    }) as Promise<bigint>,
  ]);

  const mon = Number(formatUnits(monBal, 18));
  const usdc = Number(formatUnits(usdcBal, 6));
  const chog = Number(formatUnits(chogBal, 18));

  // Internal balance in MON-equivalent units:
  // MON is 1:1, USDC treated as 1:1 (pegged), CHOG treated as 1:1 (pegged).
  // Games bet in whole-number units that map to on-chain amounts.
  return mon + usdc + chog;
}

/**
 * Returns the per-token breakdown for display purposes.
 */
export async function fetchTokenBalances(address: string) {
  const addr = address as `0x${string}`;
  const [monBal, usdcBal, chogBal] = await Promise.all([
    publicClient.getBalance({ address: addr }),
    publicClient.readContract({
      address: TOKENS.USDC.address,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [addr],
    }) as Promise<bigint>,
    publicClient.readContract({
      address: TOKENS.CHOG.address,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [addr],
    }) as Promise<bigint>,
  ]);

  return { mon: monBal, usdc: usdcBal, chog: chogBal };
}

/**
 * Single source of truth for a player's balance, shared across every game.
 *
 * Fun mode: demo credits stored in localStorage (10,000 starting).
 * Real mode: on-chain balance (MON + USDC + CHOG) fetched from the connected
 * wallet. Within a session, localStorage tracks the running total so games
 * can deduct/add bets instantly. On page reload, the on-chain balance is
 * re-fetched and used as the authoritative starting point.
 */
export function useGameBalance() {
  const { mode } = useGameMode();
  const { connected: isConnected, address } = useWallet();
  const [funBalance, setFunBalance] = useState(() => readFunBalance());
  // Real balance: starts at 0, populated by on-chain fetch
  const [realBalance, setRealBalance] = useState(0);
  const [realLoaded, setRealLoaded] = useState(false);
  const fetchIdRef = useRef(0);

  // Listen for fun-balance localStorage changes (cross-tab sync)
  useEffect(() => {
    const sync = () => setFunBalance(readFunBalance());
    window.addEventListener(BALANCE_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener(BALANCE_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  // Fetch on-chain balance when wallet is connected in real mode
  useEffect(() => {
    if (mode !== "real" || !isConnected || !address) {
      setRealLoaded(false);
      return;
    }

    const id = ++fetchIdRef.current;
    let cancelled = false;

    async function load() {
      try {
        const bal = await fetchOnChainBalance(address!);
        if (!cancelled && id === fetchIdRef.current) {
          setRealBalance(bal);
          setRealLoaded(true);
        }
      } catch {
        // On error, keep whatever we had — don't crash the game
        if (!cancelled && id === fetchIdRef.current) {
          setRealLoaded(true);
        }
      }
    }

    load();
    const interval = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [mode, isConnected, address]);

  const balance = mode === "real" ? realBalance : funBalance;

  // Fun mode: update localStorage immediately.
  // Real mode: update local state for instant UI feedback; the on-chain
  // balance will be re-fetched on the next interval/page load.
  const updateBalance = useCallback(
    (updater: number | ((prev: number) => number)) => {
      if (mode === "fun") {
        const current = readFunBalance();
        const next = typeof updater === "function" ? updater(current) : updater;
        writeFunBalance(Math.max(0, Math.round(next)));
      } else {
        // Real mode: optimistic local update
        setRealBalance((prev) => {
          const next = typeof updater === "function" ? updater(prev) : updater;
          return Math.max(0, Math.round(next));
        });
      }
    },
    [mode],
  );

  const resetBalance = useCallback(() => {
    if (mode === "fun") {
      writeFunBalance(FUN_DEFAULT);
    } else {
      // Re-fetch from chain
      if (address) {
        fetchOnChainBalance(address).then(setRealBalance).catch(() => {});
      }
    }
  }, [mode, address]);

  // Gate logic
  const needsWallet = mode === "real" && !isConnected;
  const needsDeposit = mode === "real" && isConnected && realLoaded && balance <= 0;
  const gated = needsWallet || needsDeposit;
  const gateReason: GateReason = needsWallet ? "wallet" : needsDeposit ? "deposit" : null;

  const showBalance = mode === "fun" || (mode === "real" && realLoaded) || balance > 0;

  return {
    mode,
    balance,
    updateBalance,
    resetBalance,
    needsWallet,
    needsDeposit,
    gated,
    gateReason,
    showBalance,
    defaultBalance: mode === "real" ? 0 : FUN_DEFAULT,
    currencyLabel: mode === "real" ? "$CHOG" : "CHOG",
  };
}
