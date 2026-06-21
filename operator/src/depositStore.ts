import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Address } from "viem";

export interface DepositAddressRecord {
  owner: Address;
  index: number;
  depositAddress: Address;
  createdAt: number;
}

export interface PendingSweep {
  owner: Address;
  depositAddress: Address;
  token: Address;
  amount: string; // bigint serialized as string
  sweepTxHash?: `0x${string}`;
  credited: boolean;
  createdAt: number;
}

/**
 * File-based persistence for deposit addresses and in-flight sweeps. Same durability
 * requirement as SeedStore (operator/src/store.ts): if a sweep is recorded as sent but the
 * process crashes before the matching CustodialVault.credit() call lands, restart must be able
 * to find and finish it rather than silently losing track of real, already-moved funds.
 *
 * This is an MVP — see operator/README.md for the production-hardening caveats.
 */
export class DepositStore {
  private addresses: DepositAddressRecord[] = [];
  private sweeps: PendingSweep[] = [];

  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      const data = JSON.parse(readFileSync(path, "utf-8"));
      this.addresses = data.addresses ?? [];
      this.sweeps = data.sweeps ?? [];
    } else {
      this.flush();
    }
  }

  private flush() {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify({ addresses: this.addresses, sweeps: this.sweeps }, null, 2));
    renameSync(tmp, this.path);
  }

  findByOwner(owner: Address): DepositAddressRecord | undefined {
    return this.addresses.find((r) => r.owner.toLowerCase() === owner.toLowerCase());
  }

  nextIndex(): number {
    return this.addresses.length;
  }

  addAddress(record: DepositAddressRecord) {
    this.addresses.push(record);
    this.flush();
  }

  allAddresses(): DepositAddressRecord[] {
    return this.addresses;
  }

  addSweep(sweep: PendingSweep) {
    this.sweeps.push(sweep);
    this.flush();
  }

  markSweepSent(depositAddress: Address, token: Address, sweepTxHash: `0x${string}`) {
    const sweep = this.sweeps.find(
      (s) => s.depositAddress.toLowerCase() === depositAddress.toLowerCase() && s.token === token && !s.credited,
    );
    if (!sweep) return;
    sweep.sweepTxHash = sweepTxHash;
    this.flush();
  }

  markSweepCredited(depositAddress: Address, token: Address) {
    const sweep = this.sweeps.find(
      (s) => s.depositAddress.toLowerCase() === depositAddress.toLowerCase() && s.token === token && !s.credited,
    );
    if (!sweep) return;
    sweep.credited = true;
    this.flush();
  }

  /** Sweeps whose on-chain transfer succeeded but the matching credit() call never confirmed —
   *  resumed on restart so a crash between "moved the funds" and "credited the player" can't
   *  silently strand a deposit. */
  uncreditedSweepsWithTx(): PendingSweep[] {
    return this.sweeps.filter((s) => s.sweepTxHash && !s.credited);
  }
}
