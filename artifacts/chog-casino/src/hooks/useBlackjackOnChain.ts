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

const BLACKJACK_ABI = [
  {
    type: "function",
    name: "placeBet",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "clientSeed", type: "bytes32" },
      { name: "serverSeedCommitment", type: "bytes32" },
    ],
    outputs: [{ name: "roundId", type: "uint256" }],
  },
  {
    type: "function",
    name: "hit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "roundId", type: "uint256" },
      { name: "handIndex", type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "stand",
    stateMutability: "nonpayable",
    inputs: [
      { name: "roundId", type: "uint256" },
      { name: "handIndex", type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "double",
    stateMutability: "payable",
    inputs: [
      { name: "roundId", type: "uint256" },
      { name: "handIndex", type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "split",
    stateMutability: "payable",
    inputs: [{ name: "roundId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "event",
    name: "RoundOpened",
    inputs: [
      { name: "roundId", type: "uint256", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "betAmount", type: "uint256", indexed: false },
      { name: "serverSeedCommitment", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RoundResolved",
    inputs: [
      { name: "roundId", type: "uint256", indexed: true },
      { name: "totalPayout", type: "uint256", indexed: false },
    ],
  },
] as const;

export interface LiveCards {
  hand0: number[];
  hand1: number[];
  dealerUp: number;
  dealerHole: number;
  dealerHoleRevealed: boolean;
}

async function requestCommitment(): Promise<{ commitment: `0x${string}`; clientSeed: `0x${string}` }> {
  const res = await fetch(`${OPERATOR_BASE_URL}/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ game: "blackjack" }),
  });
  if (!res.ok) {
    throw new Error(`Operator service unreachable or rejected the request (${res.status}). Is it running?`);
  }
  return res.json();
}

export function useBlackjackOnChain() {
  const { address, connected } = useWallet();
  const { getWalletClient } = useCasinoWalletClient();
  const [status, setStatus] = useState<OnChainBetStatus>("idle");

  const fetchLiveCards = useCallback(async (roundId: bigint): Promise<LiveCards> => {
    const res = await fetch(`${OPERATOR_BASE_URL}/blackjack/${roundId}/cards`);
    if (!res.ok) throw new Error(`Could not fetch live cards (${res.status})`);
    return res.json();
  }, []);

  const placeBet = useCallback(
    async (token: SupportedToken, amountHuman: string): Promise<{ roundId: bigint; cards: LiveCards }> => {
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
        address: CONTRACTS.blackjack,
        abi: BLACKJACK_ABI,
        functionName: "placeBet",
        args: [tokenInfo.address, amount, clientSeed, commitment],
        value: token === "MON" ? amount : 0n,
      });

      setStatus("awaiting_result");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // RoundOpened is emitted in the same tx — decode it directly from the receipt instead
      // of a separate event watch, since we already know exactly which transaction to look at.
      const logs = await publicClient.getContractEvents({
        address: CONTRACTS.blackjack,
        abi: BLACKJACK_ABI,
        eventName: "RoundOpened",
        fromBlock: receipt.blockNumber,
        toBlock: receipt.blockNumber,
      });
      const match = logs.find((l) => l.transactionHash === hash);
      if (!match) throw new Error("Could not find RoundOpened event for this bet");
      const roundId = match.args.roundId as bigint;

      const cards = await fetchLiveCards(roundId);
      setStatus("idle");
      return { roundId, cards };
    },
    [address, connected, getWalletClient, fetchLiveCards],
  );

  const hit = useCallback(
    async (roundId: bigint, handIndex: number): Promise<LiveCards> => {
      if (!address) throw new Error("Wallet not connected");
      const walletClient = await getWalletClient(address as `0x${string}`);
      const hash = await walletClient.writeContract({
        address: CONTRACTS.blackjack,
        abi: BLACKJACK_ABI,
        functionName: "hit",
        args: [roundId, handIndex],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      return fetchLiveCards(roundId);
    },
    [address, getWalletClient, fetchLiveCards],
  );

  const stand = useCallback(
    async (roundId: bigint, handIndex: number): Promise<LiveCards> => {
      if (!address) throw new Error("Wallet not connected");
      const walletClient = await getWalletClient(address as `0x${string}`);
      const hash = await walletClient.writeContract({
        address: CONTRACTS.blackjack,
        abi: BLACKJACK_ABI,
        functionName: "stand",
        args: [roundId, handIndex],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      return fetchLiveCards(roundId);
    },
    [address, getWalletClient, fetchLiveCards],
  );

  const double = useCallback(
    async (roundId: bigint, handIndex: number, token: SupportedToken, amountHuman: string): Promise<LiveCards> => {
      if (!address) throw new Error("Wallet not connected");
      const tokenInfo = TOKENS[token];
      const amount = parseUnits(amountHuman, tokenInfo.decimals);
      const walletClient = await getWalletClient(address as `0x${string}`);
      const hash = await walletClient.writeContract({
        address: CONTRACTS.blackjack,
        abi: BLACKJACK_ABI,
        functionName: "double",
        args: [roundId, handIndex],
        value: token === "MON" ? amount : 0n,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      return fetchLiveCards(roundId);
    },
    [address, getWalletClient, fetchLiveCards],
  );

  const split = useCallback(
    async (roundId: bigint, token: SupportedToken, amountHuman: string): Promise<LiveCards> => {
      if (!address) throw new Error("Wallet not connected");
      const tokenInfo = TOKENS[token];
      const amount = parseUnits(amountHuman, tokenInfo.decimals);
      const walletClient = await getWalletClient(address as `0x${string}`);
      const hash = await walletClient.writeContract({
        address: CONTRACTS.blackjack,
        abi: BLACKJACK_ABI,
        functionName: "split",
        args: [roundId],
        value: token === "MON" ? amount : 0n,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      return fetchLiveCards(roundId);
    },
    [address, getWalletClient, fetchLiveCards],
  );

  /** Waits for the operator to reveal and settle the round after the last hand closes. */
  const waitForResolution = useCallback((roundId: bigint): Promise<bigint> => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        unwatch();
        reject(new Error("Timed out waiting for the round to settle — the operator service may be down."));
      }, 90_000);

      const unwatch = publicClient.watchContractEvent({
        address: CONTRACTS.blackjack,
        abi: BLACKJACK_ABI,
        eventName: "RoundResolved",
        args: { roundId },
        onLogs: (logs) => {
          const log = logs[0];
          if (!log) return;
          clearTimeout(timeout);
          unwatch();
          resolve(log.args.totalPayout ?? 0n);
        },
        onError: (err) => {
          clearTimeout(timeout);
          unwatch();
          reject(err);
        },
      });
    });
  }, []);

  return { status, fetchLiveCards, placeBet, hit, stand, double, split, waitForResolution };
}
