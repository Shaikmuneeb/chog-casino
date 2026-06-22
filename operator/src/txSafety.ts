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
