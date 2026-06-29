import { keccak256, toHex, type Abi, type Address } from "viem";
import { publicClient, vaultWalletClient, vaultOperatorAccount, deriveDepositAccount, depositAddressClient } from "./chain.js";
import { ERC20_ABI, CUSTODIAL_VAULT_ABI } from "./abi.js";
import { DepositStore } from "./depositStore.js";
import { config, NATIVE_TOKEN, DEPOSIT_TOKENS } from "./config.js";
import { writeWithGasBuffer, sendValueWithQueue, withRevertRetry, assertTxSucceeded } from "./txSafety.js";

/**
 * Polls every known deposit address for MON/USDC/CHOG balances and sweeps anything found
 * straight into CustodialVault, crediting the owning player's balance once the sweep
 * transaction confirms. Polling (not event-watching) because deposits can arrive from any
 * external wallet/exchange we have no event subscription on — we only know the address, not
 * who's sending to it or when.
 *
 * Funds sit at the derived deposit address for at most one poll interval before being swept —
 * see operator/README.md for the security tradeoff this implies.
 */
export function startDepositWatcher(store: DepositStore) {
  if (!config.depositMnemonic) {
    console.log("[deposit-watcher] DEPOSIT_MNEMONIC not set — custodial deposit addresses disabled");
    return;
  }
  if (!vaultWalletClient || !vaultOperatorAccount || !config.custodialVault) {
    console.log("[deposit-watcher] VAULT_OPERATOR_PRIVATE_KEY or CUSTODIAL_VAULT_ADDRESS not set — disabled");
    return;
  }

  console.log(`[deposit-watcher] polling every ${config.depositPollIntervalMs}ms, vault operator ${vaultOperatorAccount.address}`);

  // Resume any sweep that moved funds but never got credited (e.g. crashed mid-flow).
  for (const sweep of store.uncreditedSweepsWithTx()) {
    creditSweep(store, sweep.owner as Address, sweep.depositAddress as Address, sweep.token as Address, BigInt(sweep.amount)).catch((err) =>
      console.error(`[deposit-watcher] failed to resume credit for sweep ${sweep.sweepTxHash}`, err),
    );
  }

  // setInterval would let a new cycle start while a slow one is still running (a single ERC20
  // sweep alone can take several seconds across gas estimation + a top-up + up to 4 retries at
  // 1.5s apart) — confirmed directly as the cause of repeated CHOG sweep failures: an overlapping
  // cycle's NATIVE-token sweep swept away the gas float a CHOG-token sweep had just topped up,
  // moments before the CHOG transfer tried to spend it, every single time. Scheduling the next
  // poll only after the current one fully finishes makes that impossible.
  void (async function loop() {
    await pollAll(store).catch((err) => console.error("[deposit-watcher] poll cycle failed", err));
    setTimeout(loop, config.depositPollIntervalMs);
  })();
}

async function pollAll(store: DepositStore) {
  for (const record of store.allAddresses()) {
    try {
      await pollOne(store, record.owner, record.depositAddress, record.index);
    } catch (err) {
      console.error(`[deposit-watcher] error polling ${record.depositAddress}`, err);
    }
  }
}

async function pollOne(store: DepositStore, owner: Address, depositAddress: Address, index: number) {
  for (const { address: token } of DEPOSIT_TOKENS) {
    const balance =
      token === NATIVE_TOKEN
        ? await publicClient.getBalance({ address: depositAddress })
        : ((await publicClient.readContract({
            address: token,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [depositAddress],
          })) as bigint);

    if (balance === 0n) continue;
    await sweep(store, owner, depositAddress, index, token, balance);
  }
}

/** Reads the configured vault's real holding of `token` — native balance for MON, ERC20
 *  balanceOf otherwise. Used to verify a sweep actually landed before crediting the ledger. */
async function vaultHolding(token: Address): Promise<bigint> {
  const vaultAddress = config.custodialVault!;
  if (token === NATIVE_TOKEN) {
    return publicClient.getBalance({ address: vaultAddress });
  }
  return (await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [vaultAddress],
  })) as bigint;
}

async function sweep(
  store: DepositStore,
  owner: Address,
  depositAddress: Address,
  index: number,
  token: Address,
  balance: bigint,
) {
  const depositClient = depositAddressClient(index);
  const vaultAddress = config.custodialVault!;

  // Snapshot the vault's real holding before the sweep. We credit the player based on how much
  // the vault's balance ACTUALLY increased — not on how much we intended to send. This is the
  // guard that prevents the ledger from ever claiming more than the vault physically received:
  // if the sweep lands in the wrong contract (e.g. a stale vault address after a migration),
  // reverts, or moves a different amount than expected, the measured delta reflects reality and
  // a bad/zero delta is never credited. (This is exactly the failure that previously inflated
  // the ledger far beyond the vault's real funds.)
  const vaultBefore = await vaultHolding(token);

  let swept: bigint;
  let sweepTxHash: `0x${string}`;

  if (token === NATIVE_TOKEN) {
    // Native sweep pays its own gas — reserve enough to cover it, sweep the rest. The vault is
    // a CONTRACT (its receive() actually executes), which costs more gas than a plain EOA-to-EOA
    // transfer — a flat 21_000 here previously caused the sweep to run out of gas and revert
    // on-chain while the code still credited the player as if it had succeeded. Estimate for
    // real instead of assuming the bare minimum.
    const [gasPrice, gasLimit] = await Promise.all([
      publicClient.getGasPrice(),
      publicClient.estimateGas({ account: depositClient.account, to: vaultAddress, value: 1n }),
    ]);
    const gasCost = gasPrice * gasLimit * 2n; // generous safety margin — this is dust money either way
    if (balance <= gasCost) return; // not worth sweeping yet (dust)
    swept = balance - gasCost;
    sweepTxHash = await depositClient.sendTransaction({ to: vaultAddress, value: swept, gas: gasLimit * 2n });
  } else {
    // ERC20 sweep needs the deposit address to hold a little MON for gas — top it up from the
    // vault operator's wallet first if it doesn't already have enough. The required amount is
    // computed from the ACTUAL transfer's estimated gas cost, not a flat configured reserve:
    // a real CHOG transfer needed ~82,646 gas (~0.0114 MON at the going gas price), while the
    // static DEPOSIT_GAS_RESERVE_WEI was only 0.002 MON — far below what any real ERC20
    // transfer costs.
    //
    // Chicken-and-egg bug fixed here: a first version of this function estimated the transfer's
    // gas cost BEFORE checking/topping-up native balance, on the assumption that gas estimation
    // doesn't require the sender to actually hold funds. On Monad it does — confirmed directly,
    // with the deposit address sitting at exactly 0 native MON, `eth_estimateGas` for this exact
    // transfer call reverted with "Signer had insufficient balance" (a node-level check on the
    // gas-paying account, unrelated to the ERC20 contract's own logic). That meant the top-up
    // logic, which only ran *after* the estimate succeeded, never executed at all — a real
    // sweep attempt for a freshly-derived or fully-drained deposit address could never get off
    // the ground. Bootstrap a flat, conservative native balance FIRST if it's near zero, so the
    // gas estimate that follows has something to simulate against; only then refine with the
    // precise estimate-based top-up for the (rare) call that needs more than the flat bootstrap.
    // IMPORTANT: route every send from vaultWalletClient through sendValueWithQueue, never
    // vaultWalletClient.sendTransaction directly. This same wallet also sends credit() calls
    // (via writeWithGasBuffer, below in creditSweep) for the NATIVE-token sweep path, which runs
    // for this same address moments before this code does. Calling .sendTransaction() raw here
    // bypassed txSafety.ts's per-account nonce queue entirely — confirmed directly: it produced
    // real "Transaction nonce too low" failures on this exact wallet, which is what was actually
    // causing the CHOG transfer below to fail with "Signer had insufficient balance" (it never
    // got properly gas-funded, because the raw send here collided with a queued credit() call
    // and silently lost the nonce race).
    const BOOTSTRAP_GAS_WEI = 30_000_000_000_000_000n; // 0.03 MON — comfortably above every real ERC20 sweep cost observed so far
    let nativeBalance = await publicClient.getBalance({ address: depositAddress });
    if (nativeBalance < BOOTSTRAP_GAS_WEI / 2n) {
      const bootstrapHash = await sendValueWithQueue(vaultWalletClient!, depositAddress, BOOTSTRAP_GAS_WEI - nativeBalance);
      await publicClient.waitForTransactionReceipt({ hash: bootstrapHash });
      nativeBalance = await publicClient.getBalance({ address: depositAddress });
    }

    const [gasPrice, gasEstimate] = await Promise.all([
      publicClient.getGasPrice(),
      publicClient.estimateContractGas({
        address: token,
        abi: ERC20_ABI as Abi,
        functionName: "transfer",
        args: [vaultAddress, balance],
        account: depositClient.account,
      } as Parameters<typeof publicClient.estimateContractGas>[0]),
    ]);
    const requiredGasCost = gasPrice * gasEstimate * 2n; // generous margin, same as the native sweep path above
    if (nativeBalance < requiredGasCost) {
      const topUpHash = await sendValueWithQueue(vaultWalletClient!, depositAddress, requiredGasCost - nativeBalance);
      await publicClient.waitForTransactionReceipt({ hash: topUpHash });
    }
    swept = balance;
    // The transfer below has been observed to get rejected outright at *submission* time
    // ("Signer had insufficient balance", an InternalRpcError from eth_sendRawTransaction, not a
    // mined revert) even moments after the top-up above was confirmed with plenty of margin —
    // consistent with Monad's public RPC endpoint being a load-balanced pool of nodes with brief
    // replication lag, where the node that admits this raw tx hasn't yet seen the balance the
    // top-up's *own* receipt was confirmed against (on a different node in the pool). Retrying
    // after a short pause works around exactly this same class of transient inconsistency that
    // withRevertRetry was already built for elsewhere in this codebase.
    sweepTxHash = await withRevertRetry(`deposit-watcher CHOG-class sweep ${depositAddress}`, async () => {
      const hash = await writeWithGasBuffer(depositClient, {
        address: token,
        abi: ERC20_ABI as Abi,
        functionName: "transfer",
        args: [vaultAddress, swept],
      });
      return hash;
    }, 4);
  }

  const receipt = await publicClient.waitForTransactionReceipt({ hash: sweepTxHash });
  if (receipt.status !== "success") {
    // The transfer reverted on-chain (e.g. ran out of gas) — the deposit address still holds
    // the real funds, untouched. Do NOT record this as a sweep or credit anything; the next
    // poll cycle will see the same balance and try again. Crediting here would fabricate a
    // balance the vault never actually received.
    console.error(`[deposit-watcher] sweep tx ${sweepTxHash} from ${depositAddress} REVERTED on-chain — funds were not moved, not crediting`);
    return;
  }

  // Credit only what the vault's real balance actually GAINED, not what we intended to send.
  const vaultAfter = await vaultHolding(token);
  const received = vaultAfter - vaultBefore;
  if (received <= 0n) {
    // Sweep tx succeeded but the vault's balance didn't go up — funds went somewhere other than
    // the configured vault (stale address, wrong contract, etc.). Never credit in this case.
    console.error(
      `[deposit-watcher] sweep ${sweepTxHash} succeeded but vault holding of ${token} did not increase ` +
        `(before ${vaultBefore}, after ${vaultAfter}) — NOT crediting ${owner}; manual check required`,
    );
    return;
  }
  if (received !== swept) {
    // Defensive: credit the verified on-chain delta, not the assumed amount, and log the mismatch.
    console.warn(
      `[deposit-watcher] sweep ${sweepTxHash}: expected to credit ${swept} but vault gained ${received} — crediting the measured amount`,
    );
  }

  store.addSweep({
    owner,
    depositAddress,
    token,
    amount: received.toString(),
    sweepTxHash,
    credited: false,
    createdAt: Date.now(),
  });
  console.log(`[deposit-watcher] swept ${received} of ${token} from ${depositAddress} into vault (tx ${sweepTxHash})`);

  await creditSweep(store, owner, depositAddress, token, received, sweepTxHash);
}

async function creditSweep(
  store: DepositStore,
  owner: Address,
  depositAddress: Address,
  token: Address,
  amount: bigint,
  sweepTxHash?: `0x${string}`,
) {
  const sweepRef = keccak256(toHex(sweepTxHash ?? `${depositAddress}-${token}-${amount}`));
  const hash = await writeWithGasBuffer(vaultWalletClient!, {
    address: config.custodialVault!,
    abi: CUSTODIAL_VAULT_ABI as Abi,
    functionName: "credit",
    args: [owner, token, amount, sweepRef],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assertTxSucceeded(receipt, `[deposit-watcher] credit for ${owner}`);
  store.markSweepCredited(depositAddress, token);
  console.log(`[deposit-watcher] credited ${owner} with ${amount} of ${token} (tx ${hash})`);
}

export function getOrCreateDepositAddress(store: DepositStore, owner: Address): Address {
  const existing = store.findByOwner(owner);
  if (existing) return existing.depositAddress;

  const index = store.nextIndex();
  const account = deriveDepositAccount(index);
  store.addAddress({ owner, index, depositAddress: account.address, createdAt: Date.now() });
  return account.address;
}
