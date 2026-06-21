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

/**
 * BetKind enum matching the Roulette.sol contract:
 * 0 = Red, 1 = Black, 2 = Green, 3 = Odd, 4 = Even, 5 = Low(1-18), 6 = High(19-36), 7 = StraightNumber
 */
export type BetKind = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

const ROULETTE_ABI = [
  {
    type: "function",
    name: "placeBet",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "kind", type: "uint8" },
      { name: "number", type: "uint8" },
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

export interface RouletteOutcome {
  won: boolean;
  payoutAmount: bigint;
}

async function requestCommitment(): Promise<{ commitment: `0x${string}`; clientSeed: `0x${string}` }> {
  const res = await fetch(`${OPERATOR_BASE_URL}/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ game: "roulette" }),
  });
  if (!res.ok) {
    throw new Error(`Operator service unreachable or rejected the request (${res.status}). Is it running?`);
  }
  return res.json();
}

export function useRouletteOnChain() {
  const { address, connected } = useWallet();
  const { getWalletClient } = useCasinoWalletClient();
  const [status, setStatus] = useState<OnChainBetStatus>("idle");

  const placeBet = useCallback(
    async (
      token: SupportedToken,
      amountHuman: string,
      kind: BetKind,
      straightNumber: number = 0,
    ): Promise<RouletteOutcome> => {
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
        address: CONTRACTS.roulette,
        abi: ROULETTE_ABI,
        functionName: "placeBet",
        args: [tokenInfo.address, amount, kind, straightNumber, ZERO_BYTES32, clientSeed, commitment],
        value: token === "MON" ? amount : 0n,
      });

      setStatus("awaiting_result");
      await publicClient.waitForTransactionReceipt({ hash });

      const outcome = await new Promise<RouletteOutcome>((resolve, reject) => {
        const timeout = setTimeout(() => {
          unwatch();
          reject(new Error("Timed out waiting for the bet to resolve — the operator service may be down."));
        }, 90_000);

        const unwatch = publicClient.watchContractEvent({
          address: CONTRACTS.roulette,
          abi: ROULETTE_ABI,
          eventName: "BetResolved",
          args: { player: address as `0x${string}` },
          onLogs: (logs) => {
            const log = logs[0];
            if (!log) return;
            clearTimeout(timeout);
            unwatch();
            resolve({
              won: Boolean(log.args.won),
              payoutAmount: log.args.payoutAmount ?? 0n,
            });
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
