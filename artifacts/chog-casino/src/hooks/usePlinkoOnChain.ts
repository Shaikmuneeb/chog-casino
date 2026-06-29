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
import { postVaultBet, pollVaultBetResult } from "@/lib/vaultBet";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";

export type OnChainBetStatus = "idle" | "approving" | "committing" | "pending" | "awaiting_result";

const PLINKO_ABI = [
  {
    type: "function",
    name: "placeBet",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "rows", type: "uint8" },
      { name: "userRandomNumber", type: "bytes32" },
      { name: "clientSeed", type: "bytes32" },
      { name: "serverSeedCommitment", type: "bytes32" },
    ],
    outputs: [{ name: "betRef", type: "uint256" }],
  },
  {
    type: "function",
    name: "payoutMultiplierBps",
    stateMutability: "pure",
    inputs: [
      { name: "rows", type: "uint8" },
      { name: "slot", type: "uint8" },
    ],
    outputs: [{ name: "", type: "uint256" }],
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

export interface PlinkoOutcome {
  won: boolean;
  payoutAmount: bigint;
  slot: number;
}

async function requestCommitment(): Promise<{ commitment: `0x${string}`; clientSeed: `0x${string}` }> {
  const res = await fetchWithTimeout(`${OPERATOR_BASE_URL}/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ game: "plinko" }),
  });
  if (!res.ok) {
    throw new Error(`Operator service unreachable or rejected the request (${res.status}). Is it running?`);
  }
  return res.json();
}

export function usePlinkoOnChain() {
  const { address, connected } = useWallet();
  const { getWalletClient } = useCasinoWalletClient();
  const [status, setStatus] = useState<OnChainBetStatus>("idle");

  const placeBet = useCallback(
    async (token: SupportedToken, amountHuman: string, rows: number): Promise<PlinkoOutcome> => {
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
        address: CONTRACTS.plinko,
        abi: PLINKO_ABI,
        functionName: "placeBet",
        args: [tokenInfo.address, amount, rows, ZERO_BYTES32, clientSeed, commitment],
        value: token === "MON" ? amount : 0n,
      });

      setStatus("awaiting_result");
      await publicClient.waitForTransactionReceipt({ hash });

      // Compute slot from the commitment + betId using the same formula the contract uses
      const outcome = await new Promise<PlinkoOutcome>((resolve, reject) => {
        const timeout = setTimeout(() => {
          unwatch();
          reject(new Error("Timed out waiting for the bet to resolve — the operator service may be down."));
        }, 90_000);

        const unwatch = publicClient.watchContractEvent({
          address: CONTRACTS.plinko,
          abi: PLINKO_ABI,
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
              slot: 0, // Slot not emitted in event; vault path computes it
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

  const placeBetFromVault = useCallback(
    async (token: SupportedToken, amountHuman: string, rows: number): Promise<PlinkoOutcome> => {
      if (!connected || !address) throw new Error("Wallet not connected");
      const tokenInfo = TOKENS[token];
      const amount = parseUnits(amountHuman, tokenInfo.decimals);

      setStatus("pending");
      try {
        const { betRef } = await postVaultBet("plinko", {
          owner: address,
          token: tokenInfo.address,
          amountWei: amount.toString(),
          rows,
        });

        setStatus("awaiting_result");
        const result = await pollVaultBetResult("plinko", betRef);
        setStatus("idle");

        return {
          won: Boolean(result.won),
          payoutAmount: BigInt(result.payoutAmount ?? "0"),
          slot: (result as unknown as Record<string, unknown>).plinkoSlot as number ?? 0,
        };
      } catch (err) {
        setStatus("idle");
        throw err;
      }
    },
    [address, connected],
  );

  return { status, setStatus, placeBet, placeBetFromVault };
}
