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
    nonce?: number;
  }) => Promise<Hex>;
  sendTransaction?: (args: { to: Address; value: bigint; nonce?: number }) => Promise<Hex>;
}

/**
 * Every transaction sent by a given account must get a strictly increasing nonce. Mines'
 * real-mode flow fires a brand new placeBet for *every tile click*, and each placeBet also
 * kicks off its own revealAndResolve in the background (see vaultBet.ts), so two writes from the
 * same operator wallet can legitimately be in flight close together.
 *
 * Naively serializing the JS-side calls (queue each write, don't start the next until the
 * previous one's writeContract() promise resolves) is *not* enough on its own — confirmed by
 * direct reproduction. viem's default nonce behavior asks the RPC for the account's "pending"
 * transaction count on every call, and Monad's node doesn't reliably reflect a just-broadcast
 * transaction in that count immediately, so the very next call can still get back the same
 * nonce as the one before it. The second send then fails with "An existing transaction had
 * higher priority" — a real on-chain rejection, not a bug in the contract, but one that surfaced
 * to players as a raw, unhandled "internal error" instead of a normal bet result.
 *
 * Fix: track the next nonce ourselves in-process instead of asking the RPC each time. Combined
 * with the queue (so only one write per account is ever in flight), this is fully race-free —
 * nothing else is allowed to submit a transaction for this account between our reading the
 * nonce and incrementing it.
 */
const accountQueues = new Map<Address, Promise<unknown>>();
const localNonces = new Map<Address, number>();

async function withExplicitNonce(client: MinimalWalletClient, send: (nonce: number) => Promise<Hex>): Promise<Hex> {
  const address = client.account!.address;
  let nonce = localNonces.get(address);
  if (nonce === undefined) {
    nonce = await publicClient.getTransactionCount({ address, blockTag: "pending" });
  }
  try {
    const hash = await send(nonce);
    localNonces.set(address, nonce + 1);
    return hash;
  } catch (err) {
    // Our guess might now be wrong (e.g. this send never actually got broadcast) — drop the
    // cache so the next attempt re-derives the real nonce from chain state instead of
    // potentially leaving a permanent gap.
    localNonces.delete(address);
    throw err;
  }
}

function withAccountQueue<T>(client: MinimalWalletClient, fn: () => Promise<T>): Promise<T> {
  const address = client.account?.address;
  if (!address) return fn();
  const previous = accountQueues.get(address) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  // Store a settled-or-not marker so a failed write doesn't permanently wedge the queue for
  // whoever's next — only the resolution order matters, not the error itself.
  accountQueues.set(address, next.catch(() => undefined));
  return next;
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
  return withAccountQueue(client, async () => {
    const estimate = await publicClient.estimateContractGas({
      ...params,
      account: client.account,
    } as Parameters<typeof publicClient.estimateContractGas>[0]);
    return withExplicitNonce(client, (nonce) => client.writeContract({ ...params, gas: (estimate * 130n) / 100n, nonce }));
  });
}

/**
 * Settling a bet (revealAndResolve) has been observed to use *wildly* different amounts of
 * gas on Monad depending on what the call actually has to do — checked directly against past
 * resolved bets' real receipts: as low as 141,450 gas for a quick loss, up into the 12-19
 * million range for calls that have to run a payout/transfer path, despite the contract logic
 * itself being a couple of hashes and a storage write with no loops.
 *
 * Monad's RPC also enforces a hard per-transaction gas ceiling at *submission* time that's
 * lower than its 200M block gas limit and not documented anywhere we could find — confirmed by
 * direct experiment: `eth_call` simulation (e.g. `cast call --gas-limit`) accepts any gas value
 * up to 40M+ with no complaint, since it's a stateless read with no real inclusion, but actually
 * *sending* a transaction with gas=40,000,000 gets rejected outright with "Exceeds transaction
 * gas limit" — a real RPC-node rejection (verified: this exact string doesn't appear anywhere in
 * any installed library, so it's not a client-side check). The ceiling sits somewhere between
 * the proven-working ~25.4M and the proven-failing 40M — most likely the common
 * go-ethereum-derived default of 30,000,000.
 *
 * A flat 28M for every single call was tried first and works, but it's expensive: confirmed
 * directly that Monad does *not* refund unused gas the way standard EVM chains do — a resolve
 * that only needed 141,450 gas, given a 28,000,000 limit, comes back with gasUsed == 28,000,000
 * on its receipt and is billed for the full amount. Every bit of unnecessary headroom is real
 * MON burned, every single resolve. So: estimate normally (like every other call here), pad it,
 * but clamp the result to the proven-safe ceiling instead of ignoring the estimate entirely —
 * cheap calls stay cheap, and the clamp only kicks in for the rare call that's genuinely close
 * to the ceiling. If this ever starts failing again, the bet is *not* lost (the stake stays
 * collected in the Treasury until a resolve succeeds) — just lower the ceiling further and
 * restart.
 */
const RESOLVE_GAS_CEILING = 28_000_000n;

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
  return withAccountQueue(client, async () => {
    const estimate = await publicClient.estimateContractGas({
      ...params,
      account: client.account,
    } as Parameters<typeof publicClient.estimateContractGas>[0]);
    const padded = (estimate * 130n) / 100n;
    const gas = padded > RESOLVE_GAS_CEILING ? RESOLVE_GAS_CEILING : padded;
    return withExplicitNonce(client, (nonce) => client.writeContract({ ...params, gas, nonce }));
  });
}

/**
 * Plain native-MON transfer (no contract call), routed through the same per-account queue +
 * explicit-nonce machinery as every other send from this wallet — used to actually forward a
 * win's payout into CustodialVault (see watcher.ts's creditVaultIfWon) so the credit() ledger
 * entry it then records is backed by real MON, not just a number.
 */
export async function sendValueWithQueue(client: MinimalWalletClient, to: Address, value: bigint): Promise<Hex> {
  return withAccountQueue(client, () => withExplicitNonce(client, (nonce) => client.sendTransaction!({ to, value, nonce })));
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
