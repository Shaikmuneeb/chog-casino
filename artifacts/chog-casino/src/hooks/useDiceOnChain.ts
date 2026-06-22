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

export type OnChainBetStatus = "idle" | "approving" | "committing" | "pending" | "awaiting_result";

const DICE_ABI = [
  {
    type: "function",
    name: "placeBet",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "target", type: "uint8" },
      { name: "isUnder", type: "bool" },
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

export interface DiceOutcome {
  won: boolean;
  payoutAmount: bigint;
  /** The actual roll (0-99), only set by placeBetFromVault — see RouletteOutcome's
   *  landedNumber for why the wallet-direct placeBet path above doesn't have this. */
  roll?: number;
}

async function requestCommitment(): Promise<{ commitment: `0x${string}`; clientSeed: `0x${string}` }> {
  const res = await fetch(`${OPERATOR_BASE_URL}/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ game: "dice" }),
  });
  if (!res.ok) {
    throw new Error(`Operator service unreachable or rejected the request (${res.status}). Is it running?`);
  }
  return res.json();
}

export function useDiceOnChain() {
  const { address, connected } = useWallet();
  const { getWalletClient } = useCasinoWalletClient();
  const [status, setStatus] = useState<OnChainBetStatus>("idle");

  const placeBet = useCallback(
    async (token: SupportedToken, amountHuman: string, target: number, isUnder: boolean): Promise<DiceOutcome> => {
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
        address: CONTRACTS.dice,
        abi: DICE_ABI,
        functionName: "placeBet",
        args: [tokenInfo.address, amount, target, isUnder, ZERO_BYTES32, clientSeed, commitment],
        value: token === "MON" ? amount : 0n,
      });

      setStatus("awaiting_result");
      await publicClient.waitForTransactionReceipt({ hash });

      const outcome = await new Promise<DiceOutcome>((resolve, reject) => {
        const timeout = setTimeout(() => {
          unwatch();
          reject(new Error("Timed out waiting for the bet to resolve — the operator service may be down."));
        }, 90_000);

        const unwatch = publicClient.watchContractEvent({
          address: CONTRACTS.dice,
          abi: DICE_ABI,
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

  /** Instant, signature-free bet funded by the player's CustodialVault balance — no wallet
   *  popup anywhere in this path. See operator/src/vaultBet.ts for the on-chain mechanics. */
  const placeBetFromVault = useCallback(
    async (token: SupportedToken, amountHuman: string, target: number, isUnder: boolean): Promise<DiceOutcome> => {
      if (!connected || !address) throw new Error("Wallet not connected");
      const tokenInfo = TOKENS[token];
      const amount = parseUnits(amountHuman, tokenInfo.decimals);

      setStatus("pending");
      try {
        const { betRef } = await postVaultBet("dice", {
          owner: address,
          token: tokenInfo.address,
          amountWei: amount.toString(),
          target,
          isUnder,
        });

        setStatus("awaiting_result");
        const result = await pollVaultBetResult("dice", betRef);
        setStatus("idle");

        return { won: Boolean(result.won), payoutAmount: BigInt(result.payoutAmount ?? "0"), roll: result.diceRoll };
      } catch (err) {
        setStatus("idle");
        throw err;
      }
    },
    [address, connected],
  );

  return { status, setStatus, placeBet, placeBetFromVault };
}
