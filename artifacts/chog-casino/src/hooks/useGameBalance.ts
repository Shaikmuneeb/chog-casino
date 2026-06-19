import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useGameMode } from "@/context/GameModeContext";

const FUN_KEY = "chog_fun_balance";
const REAL_KEY = "chog_real_balance";
const FUN_DEFAULT = 10_000;
// Placeholder starting balance for "real" mode. There is no $CHOG token contract or
// on-chain settlement wired into this project yet, so this stands in until one exists.
const REAL_DEFAULT = 1_000;

const BALANCE_CHANGED_EVENT = "chog-balance-changed";

function readBalance(key: string, fallback: number): number {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function writeBalance(key: string, value: number): void {
  localStorage.setItem(key, String(value));
  window.dispatchEvent(new Event(BALANCE_CHANGED_EVENT));
}

/**
 * Single source of truth for a player's balance, shared across every game and
 * persisted in localStorage. Returns the balance for the currently-selected mode
 * (fun = demo credits, real = wallet-gated placeholder balance).
 */
export function useGameBalance() {
  const { mode } = useGameMode();
  const { isConnected } = useAccount();
  const [funBalance, setFunBalance] = useState(() => readBalance(FUN_KEY, FUN_DEFAULT));
  const [realBalance, setRealBalance] = useState(() => readBalance(REAL_KEY, REAL_DEFAULT));

  useEffect(() => {
    const sync = () => {
      setFunBalance(readBalance(FUN_KEY, FUN_DEFAULT));
      setRealBalance(readBalance(REAL_KEY, REAL_DEFAULT));
    };
    window.addEventListener(BALANCE_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener(BALANCE_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  const key = mode === "real" ? REAL_KEY : FUN_KEY;
  const def = mode === "real" ? REAL_DEFAULT : FUN_DEFAULT;
  const balance = mode === "real" ? realBalance : funBalance;

  // Reads current from storage to avoid stale-closure issues when games chain updates.
  const updateBalance = useCallback(
    (updater: number | ((prev: number) => number)) => {
      const current = readBalance(key, def);
      const next = typeof updater === "function" ? updater(current) : updater;
      writeBalance(key, Math.max(0, Math.round(next)));
    },
    [key, def],
  );

  const resetBalance = useCallback(() => writeBalance(key, def), [key, def]);

  // In real mode you must connect a wallet before betting.
  const needsWallet = mode === "real" && !isConnected;

  return {
    mode,
    balance,
    updateBalance,
    resetBalance,
    needsWallet,
    defaultBalance: def,
    currencyLabel: mode === "real" ? "$CHOG" : "FUN",
  };
}
