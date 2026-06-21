import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { publicClient } from "@/lib/casinoClient";
import { CONTRACTS, TOKENS, TREASURY_ABI, isDeployed, type SupportedToken } from "@/config/contracts";

interface TreasuryBalances {
  MON: bigint;
  USDC: bigint;
  CHOG: bigint;
}

/// Shows the live on-chain treasury balance per token, refreshed periodically.
/// Renders nothing useful (a "not deployed" notice) until CONTRACTS.treasury is set —
/// there is no real deployment yet, so this is safe to mount before the contracts go live.
export default function TreasuryHealth() {
  const [balances, setBalances] = useState<TreasuryBalances | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isDeployed(CONTRACTS.treasury)) return;

    let cancelled = false;

    async function poll() {
      try {
        const [mon, usdc, chog] = await Promise.all(
          (Object.keys(TOKENS) as SupportedToken[]).map((symbol) =>
            publicClient.readContract({
              address: CONTRACTS.treasury,
              abi: TREASURY_ABI,
              functionName: "getBalance",
              args: [TOKENS[symbol].address],
            }),
          ),
        );
        if (!cancelled) {
          setBalances({ MON: mon as bigint, USDC: usdc as bigint, CHOG: chog as bigint });
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to read treasury balance");
      }
    }

    poll();
    const interval = setInterval(poll, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!isDeployed(CONTRACTS.treasury)) {
    return (
      <div className="text-xs text-purple-300/40 tracking-wide" data-testid="treasury-health-not-deployed">
        Treasury not deployed yet
      </div>
    );
  }

  if (error) {
    return <div className="text-xs text-red-400/70" data-testid="treasury-health-error">Treasury unreachable: {error}</div>;
  }

  return (
    <div className="flex items-center gap-4 text-xs text-purple-300/60 tracking-wide" data-testid="treasury-health">
      {(Object.keys(TOKENS) as SupportedToken[]).map((symbol) => (
        <span key={symbol}>
          {symbol}{" "}
          <span className="text-yellow-300/80 font-semibold">
            {balances ? formatUnits(balances[symbol], TOKENS[symbol].decimals) : "…"}
          </span>
        </span>
      ))}
    </div>
  );
}
