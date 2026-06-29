const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * Wrapper around fetch that rejects after `timeoutMs` using AbortController.
 * Prevents the UI from hanging indefinitely when the operator is unreachable.
 */
export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(
        `Request to ${new URL(url).host} timed out — the operator service may be offline.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
