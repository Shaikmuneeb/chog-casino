import { generateCodeChallenge, generateRandomString } from "@/lib/pkce";

const STORAGE_KEY = "chog_social_connection";
const X_STATE_KEY = "chog_x_oauth_state";
const X_VERIFIER_KEY = "chog_x_pkce_verifier";

/** Fired whenever the connection changes in this tab — `storage` only fires in *other* tabs. */
export const CONNECTION_CHANGED_EVENT = "chog-social-connection-changed";

export type Provider = "x";

export interface Connection {
  provider: Provider;
  connectedAt: number;
}

export const PROVIDER_LABELS: Record<Provider, string> = {
  x: "X (Twitter)",
};

// Both providers redirect back to the homepage with ?code&state — handled by handleOAuthRedirect().
function getRedirectUri(): string {
  return `${window.location.origin}/`;
}

export function getStoredConnection(): Connection | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Connection;
  } catch {
    return null;
  }
}

function setStoredConnection(connection: Connection): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(connection));
  window.dispatchEvent(new Event(CONNECTION_CHANGED_EVENT));
}

export function clearConnection(): void {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(CONNECTION_CHANGED_EVENT));
}

/** Redirects to Twitter's real OAuth 2.0 authorize screen (PKCE is mandatory). */
export async function startXLogin(): Promise<void> {
  const clientId = import.meta.env.VITE_TWITTER_CLIENT_ID;
  if (!clientId) {
    throw new Error("VITE_TWITTER_CLIENT_ID is missing in your .env file.");
  }

  const verifier = generateRandomString(48);
  const challenge = await generateCodeChallenge(verifier);
  const state = generateRandomString(16);
  sessionStorage.setItem(X_VERIFIER_KEY, verifier);
  sessionStorage.setItem(X_STATE_KEY, state);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    scope: "users.read tweet.read",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  window.location.href = `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
}

/**
 * Call once on app load. If the current URL is an OAuth redirect (?code&state),
 * matches the `state` to the provider, records the connection, and cleans the URL.
 * Returns the new connection if one was just established.
 */
export function handleOAuthRedirect(): Connection | null {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return null;

  const xState = sessionStorage.getItem(X_STATE_KEY);

  let provider: Provider | null = null;
  if (state === xState) provider = "x";

  sessionStorage.removeItem(X_STATE_KEY);
  sessionStorage.removeItem(X_VERIFIER_KEY);
  // Strip the OAuth params from the URL so a refresh doesn't re-trigger.
  window.history.replaceState({}, "", window.location.pathname);

  if (!provider) return null;

  const connection: Connection = { provider, connectedAt: Date.now() };
  setStoredConnection(connection);
  return connection;
}
