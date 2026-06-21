import { OPERATOR_BASE_URL } from "@/config/contracts";

/** Shared by every game's "bet from in-game balance" hook — see operator/src/vaultBet.ts for
 *  the on-chain mechanics. No wallet signature anywhere in this path. */
export interface VaultBetResult {
  resolved: boolean;
  won?: boolean;
  payoutAmount?: string;
  token?: `0x${string}`;
}

export async function postVaultBet<T extends Record<string, unknown>>(
  game: string,
  body: T,
): Promise<{ betRef: string }> {
  const res = await fetch(`${OPERATOR_BASE_URL}/vault-bet/${game}/place`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error ?? `Bet failed (${res.status})`);
  }
  return res.json();
}

export async function pollVaultBetResult(game: string, betRef: string, timeoutMs = 90_000): Promise<VaultBetResult> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${OPERATOR_BASE_URL}/vault-bet/${game}/${betRef}/result`);
    if (!res.ok) throw new Error(`Could not check bet result (${res.status})`);
    const result: VaultBetResult = await res.json();
    if (result.resolved) return result;
    await new Promise((r) => setTimeout(r, 1200));
  }
  throw new Error("Timed out waiting for the bet to resolve — the operator service may be down.");
}
