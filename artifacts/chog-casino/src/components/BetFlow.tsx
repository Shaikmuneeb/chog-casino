import { useState } from "react";
import { parseUnits } from "viem";
import { useWallet } from "@/hooks/useWallet";
import { publicClient, useCasinoWalletClient } from "@/lib/casinoClient";
import {
  CONTRACTS,
  ENTROPY_ABI,
  ERC20_ABI,
  PYTH_ENTROPY_ADDRESS,
  PYTH_ENTROPY_PROVIDER,
  TOKENS,
  isDeployed,
  type SupportedToken,
} from "@/config/contracts";

type TxState = "idle" | "approving" | "pending" | "awaiting_result" | "win" | "loss" | "error";

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
] as const;

interface BetFlowProps {
  token: SupportedToken;
  betAmount: string; // human-readable, e.g. "100"
  wantsHeads: boolean;
  onResolved?: (won: boolean) => void;
}

/**
 * Reference implementation of the bet flow for CoinFlip. Roulette/Dice/Mines/Crash follow
 * the identical approve -> placeBet -> await-resolution shape with their own extra params
 * inserted before the three trailing RNG args (see each game's placeBet in contracts/src/).
 *
 * IMPORTANT — commit-reveal mode is NOT fully wired up here. BaseGame.sol defaults every
 * game to commit-reveal RNG until an admin calls setRngMode(PythEntropy), and commit-reveal
 * requires a trusted off-chain operator service (holding OPERATOR_ROLE) to generate the
 * server seed, commit its hash, and reveal it after the bet — that service does not exist
 * in this repo. This component only completes the flow once the game contract is switched
 * to Pyth Entropy mode and PYTH_ENTROPY_ADDRESS/PYTH_ENTROPY_PROVIDER are filled in.
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

      if (rngMode === 1) {
        throw new Error(
          "This game is still in commit-reveal RNG mode, which needs a trusted off-chain " +
            "operator service to reveal bets — that service isn't built yet. Switch the " +
            "contract to Pyth Entropy mode (admin-only) before betting from the UI.",
        );
      }
      if (!entropyConfigured) {
        throw new Error("Pyth Entropy address/provider not configured in src/config/contracts.ts.");
      }

      // ── Pyth Entropy bet ──
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
      const hash = await walletClient.writeContract({
        address: CONTRACTS.coinFlip,
        abi: COIN_FLIP_PLACE_BET_ABI,
        functionName: "placeBet",
        args: [tokenInfo.address, amount, wantsHeads, userRandomHex, `0x${"0".repeat(64)}`, `0x${"0".repeat(64)}`],
        value: nativePortion + fee,
      });

      setState("awaiting_result");
      await publicClient.waitForTransactionReceipt({ hash });

      // The entropy callback resolves the bet in a separate transaction shortly after.
      // A production UI should watch the BetResolved event on the game contract here;
      // left as a follow-up since it needs an event-watching subscription, not just a receipt.
      onResolved?.(false);
      setState("idle");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Bet failed");
      setState("error");
    }
  }

  if (!deployed) {
    return <div className="text-xs text-purple-300/40" data-testid="bet-flow-not-deployed">Contracts not deployed yet</div>;
  }

  return (
    <div data-testid="bet-flow">
      <button
        type="button"
        disabled={!connected || state === "approving" || state === "pending" || state === "awaiting_result"}
        onClick={placeBet}
        className="w-full py-4 rounded-xl font-cinzel font-black text-sm tracking-[0.22em] uppercase bg-gradient-to-r from-purple-600 to-purple-800 text-white disabled:opacity-40"
        data-testid="bet-flow-submit"
      >
        {state === "idle" && "Bet"}
        {state === "approving" && `Approving ${token}…`}
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
