import { randomBytes } from "node:crypto";
import { encodePacked, keccak256, toHex, type Abi, type Address, type Hex } from "viem";
import { publicClient, walletClient, vaultWalletClient } from "./chain.js";
import { CUSTODIAL_VAULT_ABI, ERC20_ABI } from "./abi.js";
import { config, NATIVE_TOKEN, CHOG_ADDRESS, USDC_ADDRESS } from "./config.js";
import { writeWithGasBuffer, sendValueWithQueue, withRevertRetry, assertTxSucceeded } from "./txSafety.js";

/**
 * Operator-driven Aviator/Crash with true manual cash-out, WITHOUT redeploying Crash.sol.
 *
 * Why this can't reuse Crash.sol's own settlement: BaseGame derives the on-chain random number as
 * keccak256(serverSeed, clientSeed, betId) — it depends on betId, which only exists AFTER a bet is
 * placed, and Crash.sol needs the auto-cashout target committed AT placement. There's no way to
 * settle a multiplier the player only chooses mid-flight against that contract. So Aviator is
 * settled directly against the CustodialVault instead: the operator is the house (exactly as it
 * already is for every vault-funded bet), and provable fairness is preserved by committing
 * hash(serverSeed) before the round and revealing serverSeed after — the player can recompute the
 * crash point themselves and confirm the operator didn't move it based on when they cashed out.
 *
 * The crash point uses the SAME crashPointBps formula as contracts/src/Crash.sol (a 1-in-33
 * instant bust for the house edge, else 2^32/(d+1), capped at 100x), just with a betId-free random
 * number, so the maths a player verifies matches the on-chain game they already trust.
 */

export class CrashRoundError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const SUPPORTED_TOKENS = new Set([NATIVE_TOKEN, CHOG_ADDRESS, USDC_ADDRESS]);

// Must stay byte-for-byte identical to Aviator.tsx's animation curve (raw = e^(elapsed*0.18)) so
// the server's authoritative crash timing matches what the player sees climbing on screen.
const GROWTH_RATE = 0.18;
const MAX_CASHOUT_BPS = 1_000_000n; // 100x, same cap as Crash.sol

/** Replicates Crash.sol's crashPointBps exactly (see contracts/src/Crash.sol:18). */
function crashPointBps(randomNumber: Hex): bigint {
  const d = BigInt(randomNumber) & 0xffffffffn; // uint32(uint256(randomNumber)) — lowest 32 bits
  if (d % 33n === 0n) return 10000n; // instant bust at 1.00x
  let raw = (0xffffffffn * 10000n) / (d + 1n);
  if (raw > MAX_CASHOUT_BPS) raw = MAX_CASHOUT_BPS;
  if (raw < 10000n) raw = 10000n;
  return raw;
}

interface CrashRound {
  roundId: string;
  owner: Address;
  token: Address;
  amountWei: bigint;
  serverSeed: Hex;
  clientSeed: Hex;
  commitment: Hex;
  crashBps: bigint;
  startTime: number; // ms epoch
  status: "flying" | "won" | "lost";
}

const rounds = new Map<string, CrashRound>();

function assertConfigured() {
  if (!vaultWalletClient || !config.custodialVault) {
    throw new CrashRoundError("Custodial vault isn't configured on this operator", 503);
  }
}

/** Seconds of flight until the multiplier curve reaches the crash point. */
function crashElapsedSec(crashBps: bigint): number {
  const crashMult = Number(crashBps) / 10000;
  return Math.log(crashMult) / GROWTH_RATE;
}

/** The multiplier the shared curve is at after `elapsedSec` seconds, in basis points. */
function multiplierBpsAt(elapsedSec: number): bigint {
  const mult = Math.exp(GROWTH_RATE * Math.max(0, elapsedSec));
  return BigInt(Math.floor(mult * 10000));
}

export async function startCrashRound(owner: Address, token: Address, amountWei: string): Promise<{ roundId: string; commitment: Hex; clientSeed: Hex; startTime: number }> {
  assertConfigured();
  if (!SUPPORTED_TOKENS.has(token)) throw new CrashRoundError("Unsupported token");
  const amount = BigInt(amountWei);
  if (amount <= 0n) throw new CrashRoundError("Amount must be greater than zero");

  const balance = (await publicClient.readContract({
    address: config.custodialVault!,
    abi: CUSTODIAL_VAULT_ABI,
    functionName: "balanceOf",
    args: [owner, token],
  })) as bigint;
  if (balance < amount) throw new CrashRoundError("Insufficient in-game balance");

  const serverSeed = toHex(randomBytes(32)) as Hex;
  const clientSeed = toHex(randomBytes(32)) as Hex;
  const commitment = keccak256(serverSeed);
  const randomNumber = keccak256(encodePacked(["bytes32", "bytes32"], [serverSeed, clientSeed]));
  const crashBps = crashPointBps(randomNumber);

  const roundId = toHex(randomBytes(16));

  // Debit the stake up front, exactly like every other vault bet. If the operator restarts
  // mid-flight the stake is already gone (the round can't be cashed out after a restart since it
  // only lives in memory) — acceptable given rounds last seconds, and it always favours the house
  // never the player, so it can never create an unbacked credit.
  const debitRef = keccak256(toHex(`crash-stake-${roundId}`));
  const debitHash = await writeWithGasBuffer(vaultWalletClient!, {
    address: config.custodialVault!,
    abi: CUSTODIAL_VAULT_ABI as Abi,
    functionName: "debit",
    args: [owner, token, amount, debitRef],
  });
  await publicClient.waitForTransactionReceipt({ hash: debitHash });

  const round: CrashRound = { roundId, owner, token, amountWei: amount, serverSeed, clientSeed, commitment, crashBps, startTime: Date.now(), status: "flying" };
  rounds.set(roundId, round);
  return { roundId, commitment, clientSeed, startTime: round.startTime };
}

/** Settles a won payout. Key accounting subtlety: the stake was debited from the player's LEDGER
 *  at round start, but debit() moves no tokens — so the staked tokens are still physically sitting
 *  in the vault. To back a payout of P = stake·X, the vault therefore only needs the PROFIT
 *  (P − stake) added; the stake portion is already there. Forwarding the full P (as an earlier
 *  version did) both over-drains the operator wallet AND strands the stake in the vault as
 *  permanent unbacked surplus. So: forward only the profit from the operator's bankroll, then
 *  credit the full payout to the ledger. Net result is an exactly-solvent vault (verified by the
 *  same real==liabilities identity as the single-shot flow). On a loss the stake simply stays in
 *  the vault as house profit, recoverable by the admin's surplus-only adminWithdraw. */
async function creditPayout(round: CrashRound, payoutWei: bigint) {
  const { token, owner } = round;
  const profitWei = payoutWei > round.amountWei ? payoutWei - round.amountWei : 0n;

  if (profitWei > 0n) {
    const isNative = token === NATIVE_TOKEN;
    await withRevertRetry(`[crash] forward profit for ${owner}`, async () => {
      const forwardHash = isNative
        ? await sendValueWithQueue(walletClient, config.custodialVault!, profitWei)
        : await writeWithGasBuffer(walletClient, {
            address: token,
            abi: ERC20_ABI as Abi,
            functionName: "transfer",
            args: [config.custodialVault!, profitWei],
          });
      const forwardReceipt = await publicClient.waitForTransactionReceipt({ hash: forwardHash });
      assertTxSucceeded(forwardReceipt, `[crash] forward profit to vault for ${owner}`);
      return forwardReceipt;
    });
  }

  const creditRef = keccak256(toHex(`crash-payout-${round.roundId}`));
  await withRevertRetry(`[crash] credit ${owner}`, async () => {
    const hash = await writeWithGasBuffer(vaultWalletClient!, {
      address: config.custodialVault!,
      abi: CUSTODIAL_VAULT_ABI as Abi,
      functionName: "credit",
      args: [owner, token, payoutWei, creditRef],
    });
    const r = await publicClient.waitForTransactionReceipt({ hash });
    assertTxSucceeded(r, `[crash] credit payout for ${owner}`);
    return r;
  });
}

export async function cashoutCrashRound(roundId: string): Promise<{ status: "won" | "lost"; multiplier: number; payoutAmount: string; crashPoint: number; serverSeed: Hex }> {
  const round = rounds.get(roundId);
  if (!round) throw new CrashRoundError("Round not found", 404);
  if (round.status !== "flying") throw new CrashRoundError("Round already settled", 409);

  const elapsedSec = (Date.now() - round.startTime) / 1000;
  const crashMult = Number(round.crashBps) / 10000;

  // Server clock is authoritative: the player can only bank the multiplier that this much real
  // elapsed time actually allows, and never past the (pre-committed, unchangeable) crash point.
  if (elapsedSec >= crashElapsedSec(round.crashBps)) {
    round.status = "lost";
    return { status: "lost", multiplier: crashMult, payoutAmount: "0", crashPoint: crashMult, serverSeed: round.serverSeed };
  }

  const cashoutBps = (() => {
    const byTime = multiplierBpsAt(elapsedSec);
    return byTime < round.crashBps ? byTime : round.crashBps;
  })();
  const payoutWei = (round.amountWei * cashoutBps) / 10000n;

  round.status = "won";
  // Return the win to the player INSTANTLY — the actual vault forward+credit are two on-chain
  // transactions that take a couple seconds, and (like every other game's result path) the player
  // shouldn't stare at a spinner waiting on backend bookkeeping. Fire it in the background; the
  // win/multiplier/payout are already decided and returned. creditPayout has its own retries, and
  // a final failure is logged loudly for manual reconciliation. The player's on-screen balance
  // catches up on its next 5s poll once the credit lands.
  void creditPayout(round, payoutWei).catch((err) =>
    console.error(`[crash] CRITICAL: round ${round.roundId} won ${payoutWei} for ${round.owner} but credit failed — needs manual reconciliation`, err),
  );

  return {
    status: "won",
    multiplier: Number(cashoutBps) / 10000,
    payoutAmount: payoutWei.toString(),
    crashPoint: crashMult,
    serverSeed: round.serverSeed,
  };
}

export function getCrashStatus(roundId: string): { status: "flying" | "won" | "lost"; crashPoint?: number; serverSeed?: Hex } {
  const round = rounds.get(roundId);
  if (!round) throw new CrashRoundError("Round not found", 404);

  if (round.status === "flying") {
    if ((Date.now() - round.startTime) / 1000 >= crashElapsedSec(round.crashBps)) {
      round.status = "lost";
    } else {
      return { status: "flying" };
    }
  }
  return { status: round.status, crashPoint: Number(round.crashBps) / 10000, serverSeed: round.serverSeed };
}
