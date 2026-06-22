import { keccak256, toHex, type Abi, type Address } from "viem";
import { publicClient, vaultWalletClient, vaultOperatorAccount, deriveDepositAccount, depositAddressClient } from "./chain.js";
import { ERC20_ABI, CUSTODIAL_VAULT_ABI } from "./abi.js";
import { DepositStore } from "./depositStore.js";
import { config, NATIVE_TOKEN, DEPOSIT_TOKENS } from "./config.js";
import { writeWithGasBuffer, assertTxSucceeded } from "./txSafety.js";

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
    void creditSweep(store, sweep.owner as Address, sweep.depositAddress as Address, sweep.token as Address, BigInt(sweep.amount));
  }

  setInterval(() => {
    void pollAll(store);
  }, config.depositPollIntervalMs);
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
    // vault operator's wallet first if it doesn't already have enough.
    const nativeBalance = await publicClient.getBalance({ address: depositAddress });
    if (nativeBalance < config.depositGasReserveWei) {
      const topUpHash = await vaultWalletClient!.sendTransaction({
        to: depositAddress,
        value: config.depositGasReserveWei - nativeBalance,
      });
      await publicClient.waitForTransactionReceipt({ hash: topUpHash });
    }
    swept = balance;
    sweepTxHash = await writeWithGasBuffer(depositClient, {
      address: token,
      abi: ERC20_ABI as Abi,
      functionName: "transfer",
      args: [vaultAddress, swept],
    });
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

  store.addSweep({
    owner,
    depositAddress,
    token,
    amount: swept.toString(),
    sweepTxHash,
    credited: false,
    createdAt: Date.now(),
  });
  console.log(`[deposit-watcher] swept ${swept} of ${token} from ${depositAddress} (tx ${sweepTxHash})`);

  await creditSweep(store, owner, depositAddress, token, swept, sweepTxHash);
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
