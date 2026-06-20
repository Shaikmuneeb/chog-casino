import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrivyProvider } from "@privy-io/react-auth";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import GamesLobby from "@/pages/GamesLobby";
import CoinFlip from "@/pages/games/CoinFlip";
import Mines from "@/pages/games/Mines";
import Roulette from "@/pages/games/Roulette";
import Blackjack from "@/pages/games/Blackjack";
import Aviator from "@/pages/games/Aviator";
import Profile from "@/pages/Profile";
import { monad } from "@/chains";
import { GameModeProvider } from "@/context/GameModeContext";

const queryClient = new QueryClient();
const privyAppId = import.meta.env.VITE_PRIVY_APP_ID;

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/games" component={GamesLobby} />
      <Route path="/games/coin-flip" component={CoinFlip} />
      <Route path="/games/mines" component={Mines} />
      <Route path="/games/roulette" component={Roulette} />
      <Route path="/games/blackjack" component={Blackjack} />
      <Route path="/games/aviator" component={Aviator} />
      <Route path="/profile" component={Profile} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <PrivyProvider
      appId={privyAppId}
      config={{
        loginMethods: ["email", "wallet"],
        appearance: {
          theme: "dark",
          accentColor: "#676FFF",
        },
        embeddedWallets: {
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
        },
        defaultChain: monad,
        supportedChains: [monad],
      }}
    >
      <QueryClientProvider client={queryClient}>
        <GameModeProvider>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </GameModeProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}

export default App;
