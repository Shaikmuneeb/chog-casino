import { useState } from "react";
import { parseUnits } from "viem";
import { useWallet } from "@/hooks/useWallet";
import { publicClient, useCasinoWalletClient } from "@/lib/casinoClient";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import {
  CONTRACTS,
  ENTROPY_ABI,
  ERC20_ABI,
  OPERATOR_BASE_URL,
  PYTH_ENTROPY_ADDRESS,
  PYTH_ENTROPY_PROVIDER,
  TOKENS,
  isDeployed,
  type SupportedToken,
} from "@/config/contracts";

type TxState = "idle" | "approving" | "committing" | "pending" | "awaiting_result" | "win" | "loss" | "error";

const COIN_FLIP_PLACE_BET_ABI = [
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
    type: "function",
    name: "rngMode",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }], // 0 = PythEntropy, 1 = CommitReveal
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

interface BetFlowProps {
  token: SupportedToken;
  betAmount: string; // human-readable, e.g. "100"
  wantsHeads: boolean;
  onResolved?: (won: boolean) => void;
}

/** Asks the operator service (see ../../../operator) for a fresh server-seed commitment.
 *  Must be called before every commit-reveal placeBet — the contract has no way to verify a
 *  bet's outcome without this, and placeBet itself doesn't validate the commitment is real. */
async function requestCommitment(game: string): Promise<{ commitment: `0x${string}`; clientSeed: `0x${string}` }> {
  const res = await fetchWithTimeout(`${OPERATOR_BASE_URL}/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ game }),
  });
  if (!res.ok) {
    throw new Error(`Operator service unreachable or rejected the request (${res.status}). Is it running?`);
  }
  return res.json();
}

/**
 * Reference implementation of the bet flow for CoinFlip. Roulette/Dice/Mines/Crash follow
 * the identical approve -> commit -> placeBet -> await-resolution shape with their own extra
 * params inserted before the three trailing RNG args (see each game's placeBet in
 * contracts/src/).
 *
 * Supports both RNG modes the contract can be in:
 * - CommitReveal (the default, and the only mode in use since Pyth Entropy was never
 *   configured): asks the operator service for a real {commitment, clientSeed} via
 *   POST /commit before calling placeBet, then waits for that same operator to reveal and
 *   settle the bet — watched here via the BetResolved event.
 * - PythEntropy: only reachable if an admin explicitly switches the contract to it later;
 *   kept working in case that ever happens, but not the active path today.
 */
export default function BetFlow({ token, betAmount, wantsHeads, onResolved }: BetFlowProps) {
  const { address, connected } = useWallet();
  const { getWalletClient } = useCasinoWalletClient();
  const [state, setState] = useState<TxState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const tokenInfo = TOKENS[token];
  const deployed = isDeployed(CONTRACTS.coinFlip) && isDeployed(CONTRACTS.treasury);
  const entropyConfigured = isDeployed(PYTH_ENTROPY_ADDRESS) && isDeployed(PYTH_ENTROPY_PROVIDER);

  async function placeBet() {
    if (!connected || !address) return;
    setErrorMsg(null);

    try {
      const amount = parseUnits(betAmount, tokenInfo.decimals);
      const walletClient = await getWalletClient(address as `0x${string}`);

      // ── ERC-20 approval (skipped for native MON) ──
      if (token !== "MON") {
        setState("approving");
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

      // ── Read on-chain RNG mode ──
      const rngMode = await publicClient.readContract({
        address: CONTRACTS.coinFlip,
        abi: COIN_FLIP_PLACE_BET_ABI,
        functionName: "rngMode",
      });

      let hash: `0x${string}`;

      if (rngMode === 1) {
        // ── Commit-reveal bet ──
        setState("committing");
        const { commitment, clientSeed } = await requestCommitment("coinFlip");

        setState("pending");
        if (token === "MON") {
          hash = await walletClient.writeContract({
            address: CONTRACTS.coinFlip,
            abi: COIN_FLIP_PLACE_BET_ABI,
            functionName: "placeBet",
            args: [tokenInfo.address, amount, wantsHeads, ZERO_BYTES32, clientSeed, commitment],
            value: amount,
          });
        } else {
          hash = await walletClient.writeContract({
            address: CONTRACTS.coinFlip,
            abi: COIN_FLIP_PLACE_BET_ABI,
            functionName: "placeBet",
            args: [tokenInfo.address, amount, wantsHeads, ZERO_BYTES32, clientSeed, commitment],
          });
        }
      } else {
        // ── Pyth Entropy bet ──
        if (!entropyConfigured) {
          throw new Error("Pyth Entropy address/provider not configured in src/config/contracts.ts.");
        }
        setState("pending");
        const fee = (await publicClient.readContract({
          address: PYTH_ENTROPY_ADDRESS,
          abi: ENTROPY_ABI,
          functionName: "getFee",
          args: [PYTH_ENTROPY_PROVIDER],
        })) as bigint;

        const userRandomNumber = crypto.getRandomValues(new Uint8Array(32));
        const userRandomHex = `0x${Array.from(userRandomNumber, (b) => b.toString(16).padStart(2, "0")).join("")}` as `0x${string}`;
        const nativePortion = token === "MON" ? amount : 0n;

        hash = await walletClient.writeContract({
          address: CONTRACTS.coinFlip,
          abi: COIN_FLIP_PLACE_BET_ABI,
          functionName: "placeBet",
          args: [tokenInfo.address, amount, wantsHeads, userRandomHex, ZERO_BYTES32, ZERO_BYTES32],
          value: nativePortion + fee,
        });
      }

      setState("awaiting_result");
      await publicClient.waitForTransactionReceipt({ hash });

      // The bet resolves in a SEPARATE later transaction (the operator's revealAndResolve,
      // or the Pyth callback) — watch for it rather than assuming this receipt means anything
      // about the outcome.
      await awaitResolution(address as `0x${string}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Bet failed");
      setState("error");
    }
  }

  function awaitResolution(player: `0x${string}`): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        unwatch();
        reject(new Error("Timed out waiting for the bet to resolve — the operator service may be down."));
      }, 90_000);

      const unwatch = publicClient.watchContractEvent({
        address: CONTRACTS.coinFlip,
        abi: COIN_FLIP_PLACE_BET_ABI,
        eventName: "BetResolved",
        args: { player },
        onLogs: (logs) => {
          const log = logs[0];
          if (!log) return;
          clearTimeout(timeout);
          unwatch();
          const won = Boolean(log.args.won);
          setState(won ? "win" : "loss");
          onResolved?.(won);
          resolve();
        },
        onError: (err) => {
          clearTimeout(timeout);
          unwatch();
          reject(err);
        },
      });
    });
  }

  if (!deployed) {
    return <div className="text-xs text-purple-300/40" data-testid="bet-flow-not-deployed">Contracts not deployed yet</div>;
  }

  return (
    <div data-testid="bet-flow">
      <button
        type="button"
        disabled={!connected || state === "approving" || state === "committing" || state === "pending" || state === "awaiting_result"}
        onClick={placeBet}
        className="w-full py-4 rounded-xl font-cinzel font-black text-sm tracking-[0.22em] uppercase bg-gradient-to-r from-purple-600 to-purple-800 text-white disabled:opacity-40"
        data-testid="bet-flow-submit"
      >
        {state === "idle" && "Bet"}
        {state === "approving" && `Approving ${token}…`}
        {state === "committing" && "Preparing Bet…"}
        {state === "pending" && "Placing Bet…"}
        {state === "awaiting_result" && "Awaiting Result…"}
        {state === "win" && "You Won!"}
        {state === "loss" && "You Lost"}
        {state === "error" && "Try Again"}
      </button>
      {errorMsg && <p className="text-xs text-red-400/80 mt-2" data-testid="bet-flow-error">{errorMsg}</p>}
    </div>
  );
}
