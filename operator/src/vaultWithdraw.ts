import { keccak256, toHex, verifyMessage, type Abi, type Address, type Hex } from "viem";
import { publicClient, vaultWalletClient } from "./chain.js";
import { CUSTODIAL_VAULT_ABI } from "./abi.js";
import { config, NATIVE_TOKEN, CHOG_ADDRESS, USDC_ADDRESS } from "./config.js";
import { writeWithGasBuffer, withRevertRetry, assertTxSucceeded } from "./txSafety.js";

const SUPPORTED_TOKENS = new Set([NATIVE_TOKEN, CHOG_ADDRESS, USDC_ADDRESS]);

export class VaultWithdrawError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/**
 * operatorWithdraw (see contracts/src/CustodialVault.sol) has no player signature on the
 * on-chain call itself — the contract trusts whatever `player`/`to`/`amount` this backend sends
 * it. That makes THIS check the entire security boundary: without it, anyone who could reach
 * this HTTP endpoint and knew/guessed another player's address could withdraw that player's
 * balance to their own wallet in one request. A signed message (not a transaction — free, no
 * gas, works identically on every EVM wallet including ones with incomplete/broken support for
 * actually submitting Monad transactions) proves the request's sender really controls `owner`
 * without needing the wallet to interact with Monad's chain at all.
 *
 * The message embeds every field that matters (owner, token, amount, destination) so a signature
 * can't be replayed to authorize a DIFFERENT withdrawal than the one the player actually signed
 * for, and a timestamp so a captured signature can't be replayed indefinitely.
 */
const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

export function buildWithdrawMessage(owner: Address, token: Address, amountWei: string, to: Address, timestamp: number): string {
  return `Withdraw ${amountWei} of ${token} from Chog Casino vault (${owner}) to ${to} at ${timestamp}`;
}

async function assertValidWithdrawSignature(
  owner: Address,
  token: Address,
  amountWei: string,
  to: Address,
  timestamp: number,
  signature: Hex,
) {
  if (Math.abs(Date.now() - timestamp) > SIGNATURE_MAX_AGE_MS) {
    throw new VaultWithdrawError("Withdrawal request expired — please try again", 401);
  }
  const message = buildWithdrawMessage(owner, token, amountWei, to, timestamp);
  const valid = await verifyMessage({ address: owner, message, signature });
  if (!valid) {
    throw new VaultWithdrawError("Could not verify wallet signature for this withdrawal", 401);
  }
}

function assertVaultConfigured() {
  if (!vaultWalletClient || !config.custodialVault) {
    throw new VaultWithdrawError("Custodial vault withdrawals aren't configured on this operator", 503);
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
    throw new VaultWithdrawError("Insufficient in-game balance");
  }
}

export async function operatorWithdraw(
  owner: Address,
  token: Address,
  amountWei: string,
  to: Address,
  timestamp: number,
  signature: Hex,
): Promise<{ txHash: Hex }> {
  assertVaultConfigured();
  if (!SUPPORTED_TOKENS.has(token)) throw new VaultWithdrawError("Unsupported token");
  const amount = BigInt(amountWei);
  if (amount <= 0n) throw new VaultWithdrawError("Amount must be greater than zero");
  if (to === "0x0000000000000000000000000000000000000000") throw new VaultWithdrawError("Destination address is required");

  await assertValidWithdrawSignature(owner, token, amountWei, to, timestamp, signature);
  await assertSufficientVaultBalance(owner, token, amount);

  const requestRef = keccak256(toHex(`withdraw-${owner}-${token}-${amountWei}-${to}-${timestamp}`));

  const receipt = await withRevertRetry("operatorWithdraw", async () => {
    const hash = await writeWithGasBuffer(vaultWalletClient!, {
      address: config.custodialVault!,
      abi: CUSTODIAL_VAULT_ABI as Abi,
      functionName: "operatorWithdraw",
      args: [owner, token, amount, to, requestRef],
    });
    const r = await publicClient.waitForTransactionReceipt({ hash });
    assertTxSucceeded(r, `operatorWithdraw for ${owner} -> ${to}`);
    return r;
  });

  return { txHash: receipt.transactionHash };
}
