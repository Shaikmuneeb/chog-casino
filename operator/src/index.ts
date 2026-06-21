import { config } from "./config.js";
import { SeedStore } from "./store.js";
import { DepositStore } from "./depositStore.js";
import { watchAllSingleShotGames } from "./watcher.js";
import { watchBlackjack } from "./blackjackWatcher.js";
import { startDepositWatcher } from "./depositWatcher.js";
import { startServer } from "./server.js";
import { operatorAccount, vaultOperatorAccount } from "./chain.js";

console.log(`[operator] starting as ${operatorAccount.address}`);
console.log(`[operator] this address MUST hold OPERATOR_ROLE on every game contract it watches —`);
console.log(`[operator] grant it via: cast send <game> "grantRole(bytes32,address)" <OPERATOR_ROLE hash> ${operatorAccount.address}`);

if (vaultOperatorAccount) {
  console.log(`[operator] custodial vault operator: ${vaultOperatorAccount.address}`);
  console.log(`[operator] this address MUST hold OPERATOR_ROLE on CustodialVault — see DeployCustodialVault.s.sol`);
}

const store = new SeedStore(config.seedStorePath);
const depositStore = new DepositStore(config.depositStorePath);

watchAllSingleShotGames(store);
watchBlackjack(config.blackjack, store);
startDepositWatcher(depositStore);
startServer(store, depositStore);
