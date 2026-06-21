import { randomBytes } from "node:crypto";
import { keccak256, parseEventLogs, toHex, type Abi, type Address, type Hex } from "viem";
import { publicClient, walletClient, vaultWalletClient } from "./chain.js";
import { COINFLIP_ABI, DICE_ABI, ROULETTE_ABI, MINES_ABI, CRASH_ABI, CUSTODIAL_VAULT_ABI } from "./abi.js";
import { SeedStore } from "./store.js";
import { config, NATIVE_TOKEN, CHOG_ADDRESS, USDC_ADDRESS, type GameName } from "./config.js";

const SUPPORTED_TOKENS = new Set([NATIVE_TOKEN, CHOG_ADDRESS, USDC_ADDRESS]);

export class VaultBetError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

function assertVaultConfigured() {
  if (!vaultWalletClient || !config.custodialVault) {
    throw new VaultBetError("Custodial vault betting isn't configured on this operator", 503);
  }
}

async function assertSufficientVaultBalance(owner: Address, token: Address, amount: bigint) {
  const balance = (await publicClient.readContract({
    address: config.custodialVault!,
    abi: CUSTODIAL_VAULT_ABI,
    functionName: "balanceOf",
    args: [owner, token],
  })) as bigint;
  if (balance < amount) {
    throw new VaultBetError("Insufficient in-game balance");
  }
}

/**
 * Places an instant, signature-free single-shot bet (CoinFlip/Dice/Roulette/Mines/Crash, all of
 * which resolve in one shot with no further player decision) funded by the player's
 * CustodialVault balance.
 *
 * Order matters for safety: the operator's own wallet places the bet FIRST, using its own
 * bankroll — only once that succeeds do we debit the player's vault balance. This way, if
 * placeBet reverts for any reason, the player's balance was never touched. The reverse order
 * would risk debiting a player for a bet that never actually happened.
 */
async function placeSingleShotVaultBet(
  store: SeedStore,
  game: GameName,
  address: Address,
  abi: Abi,
  owner: Address,
  token: Address,
  amount: bigint,
  extraArgs: readonly unknown[],
): Promise<{ betRef: string }> {
  assertVaultConfigured();
  if (!SUPPORTED_TOKENS.has(token)) throw new VaultBetError("Unsupported token");
  if (amount <= 0n) throw new VaultBetError("Amount must be greater than zero");

  await assertSufficientVaultBalance(owner, token, amount);

  const serverSeed = toHex(randomBytes(32)) as Hex;
  const clientSeed = toHex(randomBytes(32)) as Hex;
  const commitment = keccak256(serverSeed);
  const userRandomNumber = toHex(randomBytes(32)) as Hex; // unused in commit-reveal mode, but required by the ABI

  store.add({
    serverSeed,
    clientSeed,
    commitment,
    game,
    resolved: false,
    createdAt: Date.now(),
    vaultOwner: owner,
  });

  const hash = await walletClient.writeContract({
    address,
    abi,
    functionName: "placeBet",
    args: [token, amount, ...extraArgs, userRandomNumber, clientSeed, commitment],
    value: token === NATIVE_TOKEN ? amount : 0n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  const [placedLog] = parseEventLogs({ abi, eventName: "BetPlaced", logs: receipt.logs }) as Array<{
    args: { betRef?: bigint };
  }>;
  if (!placedLog || placedLog.args.betRef === undefined) {
    throw new VaultBetError("Bet placed on-chain but its betRef could not be read back", 500);
  }
  const betRef = placedLog.args.betRef;
  store.markMatched(commitment, betRef.toString());

  // Bet is live on-chain now — debit the player. If this fails, the bet still resolves
  // normally (the existing watcher picks it up by commitment regardless), but the player
  // wasn't charged for it; logged loudly so it can be reconciled by hand rather than silently
  // giving away a free bet.
  try {
    const debitRef = keccak256(toHex(`${commitment}-stake`));
    const debitHash = await vaultWalletClient!.writeContract({
      address: config.custodialVault!,
      abi: CUSTODIAL_VAULT_ABI,
      functionName: "debit",
      args: [owner, token, amount, debitRef],
    });
    await publicClient.waitForTransactionReceipt({ hash: debitHash });
  } catch (err) {
    console.error(`[vault-bet:${game}] CRITICAL: bet ${betRef} placed for ${owner} but debit failed — player was not charged`, err);
  }

  return { betRef: betRef.toString() };
}

export function placeCoinFlipBet(store: SeedStore, owner: Address, token: Address, amount: bigint, wantsHeads: boolean) {
  return placeSingleShotVaultBet(store, "coinFlip", config.games.coinFlip, COINFLIP_ABI as Abi, owner, token, amount, [wantsHeads]);
}

export function placeDiceBet(store: SeedStore, owner: Address, token: Address, amount: bigint, target: number, isUnder: boolean) {
  return placeSingleShotVaultBet(store, "dice", config.games.dice, DICE_ABI as Abi, owner, token, amount, [target, isUnder]);
}

export function placeRouletteBet(store: SeedStore, owner: Address, token: Address, amount: bigint, kind: number, number_: number) {
  return placeSingleShotVaultBet(store, "roulette", config.games.roulette, ROULETTE_ABI as Abi, owner, token, amount, [kind, number_]);
}

export function placeMinesBet(store: SeedStore, owner: Address, token: Address, amount: bigint, picks: number, mineCount: number) {
  return placeSingleShotVaultBet(store, "mines", config.games.mines, MINES_ABI as Abi, owner, token, amount, [picks, mineCount]);
}

export function placeCrashBet(store: SeedStore, owner: Address, token: Address, amount: bigint, autoCashoutBps: bigint) {
  return placeSingleShotVaultBet(store, "crash", config.games.crash, CRASH_ABI as Abi, owner, token, amount, [autoCashoutBps]);
}

export interface VaultBetResult {
  resolved: boolean;
  won?: boolean;
  payoutAmount?: string;
  token?: Address;
}

export function getVaultBetResult(store: SeedStore, game: string, betRef: string): VaultBetResult | undefined {
  const record = store.findByBetRef(game, betRef);
  if (!record) return undefined;
  if (!record.resolved || !record.vaultOutcome) return { resolved: false };
  return {
    resolved: true,
    won: record.vaultOutcome.won,
    payoutAmount: record.vaultOutcome.payoutAmount,
    token: record.vaultOutcome.token,
  };
}
