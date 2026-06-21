import { useCallback, useState } from "react";
import { parseUnits } from "viem";
import { useWallet } from "@/hooks/useWallet";
import { publicClient, useCasinoWalletClient } from "@/lib/casinoClient";
import {
  CONTRACTS,
  ERC20_ABI,
  OPERATOR_BASE_URL,
  TOKENS,
  type SupportedToken,
} from "@/config/contracts";

export type OnChainBetStatus = "idle" | "approving" | "committing" | "pending" | "awaiting_result";

const COIN_FLIP_ABI = [
  {
    type: "function",
    name: "placeBet",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "wantsHeads", type: "bool" },
      { name: "userRandomNumber", type: "bytes32" },
      { name: "clientSeed", type: "bytes32" },
      { name: "serverSeedCommitment", type: "bytes32" },
    ],
    outputs: [{ name: "betRef", type: "uint256" }],
  },
  {
    type: "event",
    name: "BetResolved",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "payoutAmount", type: "uint256", indexed: false },
      { name: "won", type: "bool", indexed: false },
    ],
  },
] as const;

const ZERO_BYTES32 = `0x${"0".repeat(64)}` as const;

export interface CoinFlipOutcome {
  won: boolean;
  landedHeads: boolean;
  payoutAmount: bigint;
}

async function requestCommitment(): Promise<{ commitment: `0x${string}`; clientSeed: `0x${string}` }> {
  const res = await fetch(`${OPERATOR_BASE_URL}/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ game: "coinFlip" }),
  });
  if (!res.ok) {
    throw new Error(`Operator service unreachable or rejected the request (${res.status}). Is it running?`);
  }
  return res.json();
}

/**
 * Real on-chain CoinFlip bet, used by CoinFlip.tsx's real-mode flow. Returns the actual
 * landed side + payout, derived from the contract's own BetResolved event — never invented
 * client-side. See BetFlow.tsx for the same flow as a self-contained reference component.
 */
export function useCoinFlipOnChain() {
  const { address, connected } = useWallet();
  const { getWalletClient } = useCasinoWalletClient();
  const [status, setStatus] = useState<OnChainBetStatus>("idle");

  const placeBet = useCallback(
    async (token: SupportedToken, amountHuman: string, wantsHeads: boolean): Promise<CoinFlipOutcome> => {
      if (!connected || !address) throw new Error("Wallet not connected");

      const tokenInfo = TOKENS[token];
      const amount = parseUnits(amountHuman, tokenInfo.decimals);
      const walletClient = await getWalletClient(address as `0x${string}`);

      if (token !== "MON") {
        setStatus("approving");
        const allowance = (await publicClient.readContract({
          address: tokenInfo.address,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address as `0x${string}`, CONTRACTS.treasury],
        })) as bigint;

        if (allowance < amount) {
          const approveHash = await walletClient.writeContract({
            address: tokenInfo.address,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [CONTRACTS.treasury, 2n ** 256n - 1n],
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
      }

      setStatus("committing");
      const { commitment, clientSeed } = await requestCommitment();

      setStatus("pending");
      const hash = await walletClient.writeContract({
        address: CONTRACTS.coinFlip,
        abi: COIN_FLIP_ABI,
        functionName: "placeBet",
        args: [tokenInfo.address, amount, wantsHeads, ZERO_BYTES32, clientSeed, commitment],
        value: token === "MON" ? amount : 0n,
      });

      setStatus("awaiting_result");
      await publicClient.waitForTransactionReceipt({ hash });

      const outcome = await new Promise<CoinFlipOutcome>((resolve, reject) => {
        const timeout = setTimeout(() => {
          unwatch();
          reject(new Error("Timed out waiting for the bet to resolve — the operator service may be down."));
        }, 90_000);

        const unwatch = publicClient.watchContractEvent({
          address: CONTRACTS.coinFlip,
          abi: COIN_FLIP_ABI,
          eventName: "BetResolved",
          args: { player: address as `0x${string}` },
          onLogs: (logs) => {
            const log = logs[0];
            if (!log) return;
            clearTimeout(timeout);
            unwatch();
            const won = Boolean(log.args.won);
            resolve({ won, landedHeads: won ? wantsHeads : !wantsHeads, payoutAmount: log.args.payoutAmount ?? 0n });
          },
          onError: (err) => {
            clearTimeout(timeout);
            unwatch();
            reject(err);
          },
        });
      });

      setStatus("idle");
      return outcome;
    },
    [address, connected, getWalletClient],
  );

  return { status, setStatus, placeBet };
}
