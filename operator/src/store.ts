import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Hex } from "viem";

export interface SeedRecord {
  serverSeed: Hex;
  clientSeed: Hex;
  commitment: Hex;
  game: string;
  /** Set once we've matched this commitment to an on-chain betId/roundId. */
  betRef?: string;
  /** Set once revealAndResolve has actually been submitted, so we never reveal twice. */
  resolved: boolean;
  createdAt: number;
}

/**
 * File-based persistence for server seeds. This MUST survive a process restart — if a seed
 * is lost after its commitment is on-chain but before it's revealed, that bet/round can never
 * be settled (the contract has no other way to recover the seed). Writes are atomic
 * (write-to-temp-then-rename) so a crash mid-write can't corrupt the store.
 *
 * This is an MVP. For real volume, replace this with a proper database (Postgres/SQLite)
 * with real backups — the durability requirement doesn't change, just the implementation.
 */
export class SeedStore {
  private records: SeedRecord[] = [];

  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      this.records = JSON.parse(readFileSync(path, "utf-8"));
    } else {
      this.flush();
    }
  }

  private flush() {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.records, null, 2));
    renameSync(tmp, this.path);
  }

  add(record: SeedRecord) {
    this.records.push(record);
    this.flush();
  }

  findByCommitment(commitment: Hex): SeedRecord | undefined {
    return this.records.find((r) => r.commitment.toLowerCase() === commitment.toLowerCase());
  }

  findByBetRef(game: string, betRef: string): SeedRecord | undefined {
    return this.records.find((r) => r.game === game && r.betRef === betRef);
  }

  markMatched(commitment: Hex, betRef: string) {
    const record = this.findByCommitment(commitment);
    if (!record) return;
    record.betRef = betRef;
    this.flush();
  }

  markResolved(commitment: Hex) {
    const record = this.findByCommitment(commitment);
    if (!record) return;
    record.resolved = true;
    this.flush();
  }

  /** Records whose commitment is on-chain (matched) but not yet revealed — used on startup
   *  to resume any reveals that were interrupted by a restart. */
  pendingReveals(): SeedRecord[] {
    return this.records.filter((r) => r.betRef && !r.resolved);
  }

  /** Records not yet matched to an on-chain bet/round — used on startup to resume watching
   *  for their BetPlaced/RoundOpened event in case it was missed while the process was down. */
  unmatched(): SeedRecord[] {
    return this.records.filter((r) => !r.betRef);
  }
}
