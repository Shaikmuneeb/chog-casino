import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type GameMode = "real" | "fun";

const STORAGE_KEY = "chog_game_mode";

interface GameModeContextValue {
  mode: GameMode;
  setMode: (mode: GameMode) => void;
}

const GameModeContext = createContext<GameModeContextValue | null>(null);

function getStoredMode(): GameMode {
  return localStorage.getItem(STORAGE_KEY) === "real" ? "real" : "fun";
}

export function GameModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<GameMode>(() => getStoredMode());

  const setMode = (next: GameMode) => {
    setModeState(next);
    localStorage.setItem(STORAGE_KEY, next);
  };

  // Keep multiple tabs in sync.
  useEffect(() => {
    const sync = () => setModeState(getStoredMode());
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  return (
    <GameModeContext.Provider value={{ mode, setMode }}>
      {children}
    </GameModeContext.Provider>
  );
}

export function useGameMode(): GameModeContextValue {
  const ctx = useContext(GameModeContext);
  if (!ctx) {
    throw new Error("useGameMode must be used within a GameModeProvider");
  }
  return ctx;
}
