import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { mainnet, polygon, arbitrum, base } from "wagmi/chains";

export const wagmiConfig = getDefaultConfig({
  appName: "Chog Casino",
  projectId: "chog-casino-demo",
  chains: [mainnet, polygon, arbitrum, base],
  ssr: false,
});
