import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useWallet } from "@/hooks/useWallet";
import { publicClient } from "@/lib/casinoClient";
import { ERC20_ABI, TOKENS, type SupportedToken } from "@/config/contracts";

interface TokenSelectorProps {
  value: SupportedToken;
  onChange: (token: SupportedToken) => void;
}

/// [MON] [USDC] [CHOG] toggle with each button showing the connected wallet's live balance.
export default function TokenSelector({ value, onChange }: TokenSelectorProps) {
  const { address, connected } = useWallet();
  const [balances, setBalances] = useState<Partial<Record<SupportedToken, bigint>>>({});

  useEffect(() => {
    if (!connected || !address) return;
    let cancelled = false;

    async function loadBalances() {
      const symbols = Object.keys(TOKENS) as SupportedToken[];
      const results = await Promise.all(
        symbols.map(async (symbol) => {
          const token = TOKENS[symbol];
          if (symbol === "MON") {
            return publicClient.getBalance({ address: address as `0x${string}` });
          }
          return publicClient.readContract({
            address: token.address,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [address as `0x${string}`],
          }) as Promise<bigint>;
        }),
      );
      if (!cancelled) {
        const next: Partial<Record<SupportedToken, bigint>> = {};
        symbols.forEach((symbol, i) => (next[symbol] = results[i]));
        setBalances(next);
      }
    }

    loadBalances();
    const interval = setInterval(loadBalances, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [connected, address]);

  return (
    <div className="flex gap-2" data-testid="token-selector">
      {(Object.keys(TOKENS) as SupportedToken[]).map((symbol) => {
        const token = TOKENS[symbol];
        const bal = balances[symbol];
        return (
          <button
            key={symbol}
            type="button"
            onClick={() => onChange(symbol)}
            data-testid={`token-option-${symbol.toLowerCase()}`}
            className={`px-3 py-2 rounded-lg text-xs font-cinzel font-bold tracking-wide border transition-colors ${
              value === symbol
                ? "bg-yellow-500/20 border-yellow-400/50 text-yellow-300"
                : "glass border-purple-500/30 text-purple-300 hover:border-purple-400/50"
            }`}
          >
            <div>{symbol}</div>
            <div className="text-[10px] opacity-70 font-normal">
              {connected ? (bal !== undefined ? formatUnits(bal, token.decimals) : "…") : "—"}
            </div>
          </button>
        );
      })}
    </div>
  );
}
