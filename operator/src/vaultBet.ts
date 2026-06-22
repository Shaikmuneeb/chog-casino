import { randomBytes } from "node:crypto";
import { keccak256, parseEventLogs, toHex, type Abi, type Address, type Hex, type TransactionReceipt } from "viem";
import { publicClient, walletClient, vaultWalletClient, operatorAccount } from "./chain.js";
import { COINFLIP_ABI, DICE_ABI, ROULETTE_ABI, MINES_ABI, CRASH_ABI, BLACKJACK_ABI, CUSTODIAL_VAULT_ABI, ERC20_ABI } from "./abi.js";
import { SeedStore, type SeedRecord } from "./store.js";
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
 * The operator's own wallet is msg.sender for every vault-funded bet, so for ERC20 tokens
 * (CHOG/USDC) IT needs to have approved the Treasury to pull funds from it — exactly the same
 * one-time approval a normal player's wallet does on its first non-MON bet. Checked lazily so
 * a fresh operator wallet doesn't need a manual setup step.
 */
async function ensureOperatorAllowance(token: Address, amount: bigint) {
  if (token === NATIVE_TOKEN) return;
  const allowance = (await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [operatorAccount.address, config.treasury],
  })) as bigint;
  if (allowance < amount) {
    const hash = await walletClient.writeContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [config.treasury, 2n ** 256n - 1n],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assertTxSucceeded(receipt, `[allowance] operator approve for ${token}`);
  }
}

/** Every writeContract call here is preflight-simulated by viem, but the chain's actual state
 *  at inclusion time can differ from simulation time (a front-run, a solvency check that passed
 *  moments before and fails by the time it lands, etc.) — a mined-but-reverted transaction still
 *  produces a receipt, just with no event logs and status "reverted". Treating that the same as
 *  success (e.g. trying to decode a BetPlaced event that was never emitted) produces confusing,
 *  wrong error messages instead of the real one. */
function assertTxSucceeded(receipt: TransactionReceipt, context: string) {
  if (receipt.status !== "success") {
    throw new VaultBetError(`${context} reverted on-chain (tx ${receipt.transactionHash})`, 500);
  }
}

async function debitVault(owner: Address, token: Address, amount: bigint, ref: Hex, context: string) {
  try {
    const debitHash = await vaultWalletClient!.writeContract({
      address: config.custodialVault!,
      abi: CUSTODIAL_VAULT_ABI,
      functionName: "debit",
      args: [owner, token, amount, ref],
    });
    await publicClient.waitForTransactionReceipt({ hash: debitHash });
  } catch (err) {
    console.error(`[vault-bet] CRITICAL: ${context} but debit failed — player was not charged`, err);
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
  await ensureOperatorAllowance(token, amount);

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
  assertTxSucceeded(receipt, `[${game}] placeBet for ${owner}`);

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
  const debitRef = keccak256(toHex(`${commitment}-stake`));
  await debitVault(owner, token, amount, debitRef, `[${game}] bet ${betRef} placed for ${owner}`);

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

type BlackjackRoundTuple = readonly [
  string, // player
  string, // token
  bigint, // betHand0
  bigint, // betHand1
  number, // totalHands
  number, // cardCount0
  number, // cardCount1
  boolean, // hand0Closed
  boolean, // hand1Closed
  boolean, // isSplit
  boolean, // resolved
  boolean, // exists
  Hex, // clientSeed
  Hex, // serverSeedCommitment
];

async function getBlackjackRound(roundId: bigint): Promise<BlackjackRoundTuple> {
  return (await publicClient.readContract({
    address: config.blackjack,
    abi: BLACKJACK_ABI,
    functionName: "rounds",
    args: [roundId],
  })) as unknown as BlackjackRoundTuple;
}

/** Looks up the vault-funded Blackjack round and verifies `owner` is really the player who
 *  opened it — without this check, anyone could call hit/stand/double/split on someone else's
 *  round just by knowing its roundId. */
function requireOwnedBlackjackRound(store: SeedStore, owner: Address, roundId: string): SeedRecord {
  const record = store.findByBetRef("blackjack", roundId);
  if (!record || !record.vaultOwner) throw new VaultBetError("Round not found or not vault-funded", 404);
  if (record.vaultOwner.toLowerCase() !== owner.toLowerCase()) {
    throw new VaultBetError("This round does not belong to you", 403);
  }
  return record;
}

/**
 * Places an instant, signature-free Blackjack bet funded by the player's CustodialVault
 * balance. Unlike the single-shot games, the round stays open across several more relay calls
 * (hit/stand/double/split below) before it resolves — see blackjackWatcher.ts for resolution.
 */
export async function placeBlackjackBet(
  store: SeedStore,
  owner: Address,
  token: Address,
  amount: bigint,
): Promise<{ roundId: string }> {
  assertVaultConfigured();
  if (!SUPPORTED_TOKENS.has(token)) throw new VaultBetError("Unsupported token");
  if (amount <= 0n) throw new VaultBetError("Amount must be greater than zero");

  await assertSufficientVaultBalance(owner, token, amount);
  await ensureOperatorAllowance(token, amount);

  const serverSeed = toHex(randomBytes(32)) as Hex;
  const clientSeed = toHex(randomBytes(32)) as Hex;
  const commitment = keccak256(serverSeed);

  store.add({
    serverSeed,
    clientSeed,
    commitment,
    game: "blackjack",
    resolved: false,
    createdAt: Date.now(),
    vaultOwner: owner,
  });

  const hash = await walletClient.writeContract({
    address: config.blackjack,
    abi: BLACKJACK_ABI,
    functionName: "placeBet",
    args: [token, amount, clientSeed, commitment],
    value: token === NATIVE_TOKEN ? amount : 0n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assertTxSucceeded(receipt, `[blackjack] placeBet for ${owner}`);

  const [openedLog] = parseEventLogs({ abi: BLACKJACK_ABI, eventName: "RoundOpened", logs: receipt.logs }) as Array<{
    args: { roundId?: bigint };
  }>;
  if (!openedLog || openedLog.args.roundId === undefined) {
    throw new VaultBetError("Round opened on-chain but its roundId could not be read back", 500);
  }
  const roundId = openedLog.args.roundId;
  store.markMatched(commitment, roundId.toString());

  const debitRef = keccak256(toHex(`${commitment}-stake`));
  await debitVault(owner, token, amount, debitRef, `[blackjack] round ${roundId} opened for ${owner}`);

  return { roundId: roundId.toString() };
}

export async function blackjackHit(store: SeedStore, owner: Address, roundId: string, handIndex: number) {
  requireOwnedBlackjackRound(store, owner, roundId);
  const hash = await walletClient.writeContract({
    address: config.blackjack,
    abi: BLACKJACK_ABI,
    functionName: "hit",
    args: [BigInt(roundId), handIndex],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assertTxSucceeded(receipt, `[blackjack] hit on round ${roundId} for ${owner}`);
}

export async function blackjackStand(store: SeedStore, owner: Address, roundId: string, handIndex: number) {
  requireOwnedBlackjackRound(store, owner, roundId);
  const hash = await walletClient.writeContract({
    address: config.blackjack,
    abi: BLACKJACK_ABI,
    functionName: "stand",
    args: [BigInt(roundId), handIndex],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assertTxSucceeded(receipt, `[blackjack] stand on round ${roundId} for ${owner}`);
}

/**
 * Double and split both require an additional stake equal to the original per-hand bet —
 * same safety ordering as every other vault bet: the operator fronts the extra stake and
 * places the action on-chain FIRST, only debiting the player's vault once that succeeds.
 */
export async function blackjackDouble(store: SeedStore, owner: Address, roundId: string, handIndex: number) {
  assertVaultConfigured();
  const record = requireOwnedBlackjackRound(store, owner, roundId);
  const round = await getBlackjackRound(BigInt(roundId));
  const [, token, betHand0, betHand1] = round;
  const extraAmount = handIndex === 0 ? betHand0 : betHand1;

  await assertSufficientVaultBalance(owner, token as Address, extraAmount);
  await ensureOperatorAllowance(token as Address, extraAmount);

  const hash = await walletClient.writeContract({
    address: config.blackjack,
    abi: BLACKJACK_ABI,
    functionName: "double",
    args: [BigInt(roundId), handIndex],
    value: token === NATIVE_TOKEN ? extraAmount : 0n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assertTxSucceeded(receipt, `[blackjack] double on round ${roundId} hand ${handIndex} for ${owner}`);

  const debitRef = keccak256(toHex(`${record.commitment}-double-${handIndex}`));
  await debitVault(owner, token as Address, extraAmount, debitRef, `[blackjack] round ${roundId} double on hand ${handIndex} for ${owner}`);
}

export async function blackjackSplit(store: SeedStore, owner: Address, roundId: string) {
  assertVaultConfigured();
  const record = requireOwnedBlackjackRound(store, owner, roundId);
  const round = await getBlackjackRound(BigInt(roundId));
  const [, token, betHand0] = round;

  await assertSufficientVaultBalance(owner, token as Address, betHand0);
  await ensureOperatorAllowance(token as Address, betHand0);

  const hash = await walletClient.writeContract({
    address: config.blackjack,
    abi: BLACKJACK_ABI,
    functionName: "split",
    args: [BigInt(roundId)],
    value: token === NATIVE_TOKEN ? betHand0 : 0n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assertTxSucceeded(receipt, `[blackjack] split on round ${roundId} for ${owner}`);

  const debitRef = keccak256(toHex(`${record.commitment}-split`));
  await debitVault(owner, token as Address, betHand0, debitRef, `[blackjack] round ${roundId} split for ${owner}`);
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
