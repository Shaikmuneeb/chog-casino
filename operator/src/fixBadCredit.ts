import { keccak256, toHex } from "viem";
import { publicClient, vaultWalletClient } from "./chain.js";
import { CUSTODIAL_VAULT_ABI } from "./abi.js";
import { config, NATIVE_TOKEN } from "./config.js";

/**
 * One-off correction for the fabricated balance caused by the now-fixed depositWatcher.ts bug
 * (it credited a player every poll cycle for a native sweep that was actually reverting
 * on-chain — see the commit that added the receipt.status check in depositWatcher.ts).
 *
 * Usage: npx tsx src/fixBadCredit.ts <owner> <tokenAddress|native> <amountWei>
 * Run this once per affected owner/token pair, then restart the operator normally.
 */
async function main() {
  const [ownerArg, tokenArg, amountArg] = process.argv.slice(2);
  if (!ownerArg || !tokenArg || !amountArg) {
    console.error("Usage: npx tsx src/fixBadCredit.ts <owner> <tokenAddress|native> <amountWei>");
    process.exit(1);
  }
  if (!vaultWalletClient || !config.custodialVault) {
    console.error("VAULT_OPERATOR_PRIVATE_KEY or CUSTODIAL_VAULT_ADDRESS not set in .env");
    process.exit(1);
  }

  const owner = ownerArg as `0x${string}`;
  const token = (tokenArg === "native" ? NATIVE_TOKEN : tokenArg) as `0x${string}`;
  const amount = BigInt(amountArg);

  const before = (await publicClient.readContract({
    address: config.custodialVault,
    abi: CUSTODIAL_VAULT_ABI,
    functionName: "balanceOf",
    args: [owner, token],
  })) as bigint;
  console.log(`Current credited balance for ${owner}: ${before}`);

  if (amount > before) {
    console.error(`Refusing to debit ${amount}, which is more than the current balance ${before}.`);
    process.exit(1);
  }

  const ref = keccak256(toHex(`fix-bad-credit-${Date.now()}`));
  const hash = await vaultWalletClient.writeContract({
    address: config.custodialVault,
    abi: CUSTODIAL_VAULT_ABI,
    functionName: "debit",
    args: [owner, token, amount, ref],
  });
  console.log(`Submitted debit tx ${hash}, waiting for confirmation...`);
  await publicClient.waitForTransactionReceipt({ hash });

  const after = (await publicClient.readContract({
    address: config.custodialVault,
    abi: CUSTODIAL_VAULT_ABI,
    functionName: "balanceOf",
    args: [owner, token],
  })) as bigint;
  console.log(`New credited balance for ${owner}: ${after}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
