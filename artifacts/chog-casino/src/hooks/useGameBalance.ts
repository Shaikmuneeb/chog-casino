import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { useGameMode } from "@/context/GameModeContext";

const FUN_KEY = "chog_fun_balance";
const REAL_KEY = "chog_real_balance";
const FUN_DEFAULT = 10_000;
// Real mode starts empty — players must deposit before they have a balance.
// (On-chain deposits aren't wired up yet, so this stays 0 until that exists.)
const REAL_DEFAULT = 0;

export type GateReason = "wallet" | "deposit" | null;

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

// One-time cleanup: earlier builds seeded a fake 1,000 "real" balance. Clear it once
// so real mode correctly starts empty (deposit-gated). Safe — it was never real money.
if (typeof localStorage !== "undefined" && !localStorage.getItem("chog_real_reset_v1")) {
  localStorage.removeItem(REAL_KEY);
  localStorage.setItem("chog_real_reset_v1", "1");
}

/**
 * Single source of truth for a player's balance, shared across every game and
 * persisted in localStorage. Returns the balance for the currently-selected mode
 * (fun = demo credits, real = wallet-gated placeholder balance).
 */
export function useGameBalance() {
  const { mode } = useGameMode();
  const { connected: isConnected } = useWallet();
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

  // Real mode is gated: first connect a wallet, then deposit before you can play.
  const needsWallet = mode === "real" && !isConnected;
  const needsDeposit = mode === "real" && isConnected && balance <= 0;
  const gated = needsWallet || needsDeposit;
  const gateReason: GateReason = needsWallet ? "wallet" : needsDeposit ? "deposit" : null;

  // Hide the balance in real mode until there's an actual (deposited) balance.
  const showBalance = mode === "fun" || balance > 0;

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
    defaultBalance: def,
    currencyLabel: mode === "real" ? "$CHOG" : "FUN",
  };
}
