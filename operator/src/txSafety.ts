import type { Abi, Address, Hex, TransactionReceipt } from "viem";
import { publicClient } from "./chain.js";

interface MinimalWalletClient {
  account: { address: Address } | undefined;
  writeContract: (args: {
    address: Address;
    abi: Abi;
    functionName: string;
    args: readonly unknown[];
    value?: bigint;
    gas?: bigint;
  }) => Promise<Hex>;
}

/**
 * viem's writeContract auto-estimates gas with zero safety margin when no `gas` override is
 * given. On Monad that estimate has been observed to land exactly at the gas actually used —
 * i.e. with no margin for any variance between estimation time and inclusion time — so the
 * transaction runs out of gas mid-execution and reverts (visible as gasUsed === gasLimit on the
 * receipt). Re-estimating ourselves and padding it fixes that without guessing a flat number
 * that might be wrong for a different contract call's gas cost.
 */
export async function writeWithGasBuffer(
  client: MinimalWalletClient,
  params: {
    address: Address;
    abi: Abi;
    functionName: string;
    args: readonly unknown[];
    value?: bigint;
  },
): Promise<Hex> {
  const estimate = await publicClient.estimateContractGas({
    ...params,
    account: client.account,
  } as Parameters<typeof publicClient.estimateContractGas>[0]);
  return client.writeContract({ ...params, gas: (estimate * 130n) / 100n });
}

/**
 * Settling a bet (revealAndResolve) has been observed to actually use ~25 million gas on
 * Monad — two confirmed past successes used 25,099,350 and 25,363,106 gas, despite the
 * contract logic itself being a couple of hashes and a storage write with no loops. Worse,
 * asking Monad's RPC to *estimate* gas for this call is unreliable at that magnitude: it can
 * outright revert with "Exceeds transaction gas limit" during estimation alone (this has been
 * seen for real on a stuck bet), even though the same call succeeds fine when actually sent
 * with a high enough explicit gas value. So for resolve-type calls, skip estimation entirely
 * and use a flat limit well above the observed real cost — 40M, comfortably under the chain's
 * 200M block gas limit.
 */
const FLAT_RESOLVE_GAS = 40_000_000n;

export async function writeWithFlatResolveGas(
  client: MinimalWalletClient,
  params: {
    address: Address;
    abi: Abi;
    functionName: string;
    args: readonly unknown[];
    value?: bigint;
  },
): Promise<Hex> {
  return client.writeContract({ ...params, gas: FLAT_RESOLVE_GAS });
}

/**
 * Every writeContract call is preflight-simulated by viem, but the chain's actual state at
 * inclusion time can differ from simulation time (a front-run, a solvency check that passed
 * moments before and fails by the time it lands, an out-of-gas edge case, etc.) — a
 * mined-but-reverted transaction still produces a receipt, just with no event logs and status
 * "reverted". Treating that the same as success produces confusing wrong behavior (crediting,
 * marking resolved, or decoding events that were never emitted) instead of surfacing the real
 * failure.
 */
export function assertTxSucceeded(receipt: TransactionReceipt, context: string): void {
  if (receipt.status !== "success") {
    throw new Error(`${context} reverted on-chain (tx ${receipt.transactionHash})`);
  }
}
