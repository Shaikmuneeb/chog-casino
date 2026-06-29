import type { Abi, Address, Hex, TransactionReceipt } from "viem";
import { publicClient } from "./chain.js";

/**
 * viem's watchContractEvent tracks its own fromBlock/toBlock cursor internally and never resets
 * it after a failed poll — confirmed directly: once a single eth_getLogs call fails for any
 * reason (a brief RPC indexing-lag blip right at boot was enough), fromBlock freezes at that
 * point forever while toBlock keeps growing on every subsequent poll, so the range only ever
 * gets WIDER and every future poll fails too ("eth_getLogs is limited to a 100 range") — a
 * permanent stuck state that not even restarting the whole operator reliably escapes, since the
 * same indexing-lag blip can recur at the next boot. The only way out is to tear down the stuck
 * subscription and start a fresh one, which resets viem's cursor to begin again from "latest".
 */
/**
 * `start` should call publicClient.watchContractEvent(...) inline (kept at the call site, not
 * routed through this helper) so TypeScript can fully infer the abi/eventName-specific log
 * shape for onLogs — threading the params through a generic wrapper instead collapses that
 * inference to the untyped base `Log` type. This helper only owns the error-classification and
 * restart-on-stuck-cursor behavior; `start`'s own onError must call the `onStuckCursor` callback
 * it's given whenever it detects the unrecoverable range error, and this helper handles tearing
 * down and restarting the subscription from there.
 */
export function classifyAndMaybeRestart(label: string, err: Error, restart: () => void, unwatch: () => void): void {
  console.error(`[${label}] event subscription error`, err);
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("limited to a 100 range") || message.includes("Invalid params")) {
    console.error(`[${label}] subscription cursor stuck — restarting it fresh`);
    unwatch();
    setTimeout(restart, 2000);
  }
}

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
  sendTransaction?: (args: { to: Address; value: bigint; nonce?: number; gas?: bigint }) => Promise<Hex>;
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
 * given; padding it gives a small cushion against estimate-vs-inclusion-time state drift.
 *
 * IMPORTANT: on Monad, a transaction's receipt reports gasUsed === gasLimit on EVERY
 * transaction, success or failure alike (confirmed directly: a successful CoinFlip.placeBet
 * receipt showed gasUsed exactly equal to its gasLimit, same as failed ones) — this chain
 * apparently doesn't report a gas refund/remainder at all. That means "gasUsed === gasLimit" is
 * NOT a usable signal for "this failed because it ran out of gas" here, unlike on most other
 * EVM chains. A previous version of this function chased that false signal by repeatedly raising
 * the gas margin (up to a flat 1.5M floor) — which did nothing to fix the real (non-gas) revert
 * cause, while making every failed attempt burn far more real MON in fees than necessary. Kept
 * at a modest 30% pad; if a genuine gas-estimation gap is ever found, diagnose it via
 * debug_traceTransaction's actual revert reason, not via gasUsed/gasLimit comparison.
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
  return withAccountQueue(client, async () => {
    // `to` here is frequently a CONTRACT (e.g. CustodialVault), whose receive() actually runs
    // code — that costs more than a plain EOA-to-EOA transfer's flat 21000, so estimate for real
    // rather than relying on viem's bare-transfer default. NOTE: a reverted send here that looked
    // like "out of gas" (gasUsed == gasLimit) turned out, on investigation, to actually be a
    // genuine insufficient-balance failure (the wallet held less MON than the value being sent) —
    // Monad's receipts report gasUsed == gasLimit on every transaction regardless of outcome, so
    // that comparison is not a usable signal here for "ran out of gas" vs. any other revert
    // reason. Don't escalate this margin again without confirming via debug_traceTransaction
    // first; a bigger gas limit makes every failed attempt (for whatever the real reason is)
    // burn more real MON in fees without fixing anything.
    const estimate = await publicClient.estimateGas({ account: client.account, to, value } as Parameters<typeof publicClient.estimateGas>[0]);
    return withExplicitNonce(client, (nonce) => client.sendTransaction!({ to, value, nonce, gas: (estimate * 130n) / 100n }));
  });
}

/**
 * Retries a full send-and-confirm cycle (not just the send) when it reverts on-chain. Confirmed
 * directly: a placeBet call that reverted on real inclusion replayed *successfully* moments
 * later via a full historical re-execution (`cast run`, which replays every preceding
 * transaction in the same block to reconstruct exact state) — using a small fraction of the gas
 * available, with the failed trace showing zero internal sub-calls at all. That combination (an
 * identical call succeeding when replayed serially, but failing with no Solidity-level revert
 * reason when actually included) doesn't look like a logic bug in our contracts; it's consistent
 * with Monad's parallel-execution layer detecting a conflict with another transaction landing in
 * the same block and aborting ours before EVM execution even begins. Retrying — which lands in a
 * different block with different neighboring transactions — is the practical mitigation until/
 * unless a clearer cause turns up. `attempt` should perform the entire send + wait + assert
 * cycle itself so each retry gets a fresh nonce and a fresh chance at an uncontested block.
 */
export async function withRevertRetry<T>(label: string, attempt: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await attempt();
    } catch (err) {
      lastErr = err;
      console.error(`[${label}] attempt ${i + 1}/${maxAttempts} failed`, err);
      if (i < maxAttempts - 1) await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  throw lastErr;
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
