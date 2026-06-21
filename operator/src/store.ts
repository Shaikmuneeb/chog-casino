import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Address, Hex } from "viem";

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
  /** Set only for instant vault-funded bets (see server.ts's /vault-bet routes) — the
   *  operator's own wallet placed this bet on `vaultOwner`'s behalf, having already debited
   *  their CustodialVault balance for the stake. On resolution, if the bet won, the watcher
   *  credits the payout back to this address instead of doing nothing (wallet-direct bets
   *  leave this undefined and are paid out directly by the contract to the player's wallet). */
  vaultOwner?: Address;
  /** Set once a win's payout has been credited back to vaultOwner, so a restart can't double-credit. */
  vaultCredited?: boolean;
  /** The revealAndResolve transaction hash — lets a restart re-fetch this exact receipt to
   *  finish a vault credit that didn't complete, instead of scanning chain history. */
  resolveTxHash?: Hex;
  /** Decoded outcome of a vault-funded bet, recorded once resolved — lets GET
   *  /vault-bet/:game/:betRef/result answer without re-decoding the chain on every poll. */
  vaultOutcome?: { won: boolean; payoutAmount: string; token: Address };
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

  markResolved(commitment: Hex, resolveTxHash?: Hex) {
    const record = this.findByCommitment(commitment);
    if (!record) return;
    record.resolved = true;
    if (resolveTxHash) record.resolveTxHash = resolveTxHash;
    this.flush();
  }

  markVaultCredited(commitment: Hex, outcome?: SeedRecord["vaultOutcome"]) {
    const record = this.findByCommitment(commitment);
    if (!record) return;
    record.vaultCredited = true;
    if (outcome) record.vaultOutcome = outcome;
    this.flush();
  }

  /** Records whose commitment is on-chain (matched) but not yet revealed — used on startup
   *  to resume any reveals that were interrupted by a restart. */
  pendingReveals(): SeedRecord[] {
    return this.records.filter((r) => r.betRef && !r.resolved);
  }

  /** Vault-funded bets that resolved but never got their winning payout credited back —
   *  resumed on restart so a crash mid-credit can't strand a player's winnings. */
  pendingVaultCredits(): SeedRecord[] {
    return this.records.filter((r) => r.vaultOwner && r.resolved && !r.vaultCredited);
  }

  /** Records not yet matched to an on-chain bet/round — used on startup to resume watching
   *  for their BetPlaced/RoundOpened event in case it was missed while the process was down. */
  unmatched(): SeedRecord[] {
    return this.records.filter((r) => !r.betRef);
  }
}
