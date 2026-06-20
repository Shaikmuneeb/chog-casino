import { useEffect, useState } from "react";
import {
  type Connection,
  type Provider,
  CONNECTION_CHANGED_EVENT,
  getStoredConnection,
  clearConnection,
  handleOAuthRedirect,
  startXLogin,
} from "@/lib/socialAuth";

// Process the OAuth redirect only once per page load, no matter how many components use the hook.
let redirectHandled = false;

export function useSocialConnection() {
  const [connection, setConnection] = useState<Connection | null>(() => getStoredConnection());
  const [connecting, setConnecting] = useState<Provider | null>(null);

  useEffect(() => {
    if (!redirectHandled) {
      redirectHandled = true;
      handleOAuthRedirect();
    }

    const sync = () => setConnection(getStoredConnection());
    sync();
    window.addEventListener(CONNECTION_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener(CONNECTION_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  const connectX = async () => {
    setConnecting("x");
    try {
      await startXLogin();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to connect X.");
      setConnecting(null);
    }
  };

  const disconnect = () => clearConnection();

  return { connection, connecting, connectX, disconnect };
}
