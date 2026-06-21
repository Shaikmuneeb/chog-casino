import { config } from "./config.js";
import { SeedStore } from "./store.js";
import { watchAllSingleShotGames } from "./watcher.js";
import { watchBlackjack } from "./blackjackWatcher.js";
import { startServer } from "./server.js";
import { operatorAccount } from "./chain.js";

console.log(`[operator] starting as ${operatorAccount.address}`);
console.log(`[operator] this address MUST hold OPERATOR_ROLE on every game contract it watches —`);
console.log(`[operator] grant it via: cast send <game> "grantRole(bytes32,address)" <OPERATOR_ROLE hash> ${operatorAccount.address}`);

const store = new SeedStore(config.seedStorePath);

watchAllSingleShotGames(store);
watchBlackjack(config.blackjack, store);
startServer(store);
