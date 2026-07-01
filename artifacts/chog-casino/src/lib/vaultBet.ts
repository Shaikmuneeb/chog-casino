import { OPERATOR_BASE_URL } from "@/config/contracts";
import { fetchWithTimeout } from "./fetchWithTimeout";

const OPERATOR_TIMEOUT = 10_000;

/** Shared by every game's "bet from in-game balance" hook — see operator/src/vaultBet.ts for
 *  the on-chain mechanics. No wallet signature anywhere in this path. */
export interface VaultBetResult {
  resolved: boolean;
  won?: boolean;
  payoutAmount?: string;
  token?: `0x${string}`;
  /** Present only for roulette — the actual landed pocket (0-36), computed by the operator
   *  from the exact same formula the contract used to resolve the bet. */
  rouletteNumber?: number;
  /** Present only for dice — the actual roll (0-99), computed the same way. */
  diceRoll?: number;
}

async function postToOperator<R>(path: string, body: Record<string, unknown>): Promise<R> {
  const res = await fetchWithTimeout(
    `${OPERATOR_BASE_URL}${path}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    OPERATOR_TIMEOUT,
  );
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error ?? `Operator request failed (${res.status})`);
  }
  return res.json();
}

export function postVaultBet<R = { betRef: string }>(game: string, body: Record<string, unknown>): Promise<R> {
  return postToOperator<R>(`/vault-bet/${game}/place`, body);
}

export function postVaultBetAction<R>(path: string, body: Record<string, unknown>): Promise<R> {
  return postToOperator<R>(`/vault-bet/${path}`, body);
}

/** Withdraws from a player's vault balance to an address they choose, executed by the operator
 *  — see operator/src/vaultWithdraw.ts. Authenticated by a free signed message (no gas, no
 *  Monad-transaction support required from the wallet) instead of a wallet transaction. */
export function postVaultWithdraw(body: Record<string, unknown>): Promise<{ txHash: string }> {
  return postToOperator<{ txHash: string }>("/vault-withdraw", body);
}

export async function pollVaultBetResult(game: string, betRef: string, timeoutMs = 90_000): Promise<VaultBetResult> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetchWithTimeout(
      `${OPERATOR_BASE_URL}/vault-bet/${game}/${betRef}/result`,
      undefined,
      OPERATOR_TIMEOUT,
    );
    if (!res.ok) throw new Error(`Could not check bet result (${res.status})`);
    const result: VaultBetResult = await res.json();
    if (result.resolved) return result;
    // The operator's GET /result is an O(1) in-memory lookup (no on-chain reads on this path
    // once resolved), and Monad mines a block roughly every 400ms — confirmed directly via
    // eth_getBlockByNumber timestamps. A 1200ms poll interval was adding up to a full second of
    // pure "hasn't checked yet" delay on top of a result that was often already sitting there.
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("Timed out waiting for the bet to resolve — the operator service may be down.");
}
