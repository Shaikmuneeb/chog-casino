import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import GamesLobby from "@/pages/GamesLobby";
import CoinFlip from "@/pages/games/CoinFlip";
import Mines from "@/pages/games/Mines";
import Roulette from "@/pages/games/Roulette";
import Blackjack from "@/pages/games/Blackjack";
import Profile from "@/pages/Profile";
import { wagmiConfig } from "@/lib/wagmi";
import { GameModeProvider } from "@/context/GameModeContext";
import "@rainbow-me/rainbowkit/styles.css";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/games" component={GamesLobby} />
      <Route path="/games/coin-flip" component={CoinFlip} />
      <Route path="/games/mines" component={Mines} />
      <Route path="/games/roulette" component={Roulette} />
      <Route path="/games/blackjack" component={Blackjack} />
      <Route path="/profile" component={Profile} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "hsl(280, 80%, 60%)",
            accentColorForeground: "white",
            borderRadius: "medium",
            fontStack: "system",
            overlayBlur: "small",
          })}
        >
          <GameModeProvider>
            <TooltipProvider>
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                <Router />
              </WouterRouter>
              <Toaster />
            </TooltipProvider>
          </GameModeProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export default App;
