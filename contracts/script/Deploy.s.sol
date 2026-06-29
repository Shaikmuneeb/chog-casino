// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {TreasuryContract} from "../src/TreasuryContract.sol";
import {CoinFlip} from "../src/CoinFlip.sol";
import {Dice} from "../src/Dice.sol";
import {Roulette} from "../src/Roulette.sol";
import {Mines} from "../src/Mines.sol";
import {Crash} from "../src/Crash.sol";
import {Plinko} from "../src/Plinko.sol";

/// @notice Deploys the full casino stack to Monad mainnet (chain id 41454) in the order
/// specified by the spec: Treasury first, then each game, then grant GAME_ROLE per game.
///
/// This script is NOT run automatically by Claude — you (or your dev) must execute it
/// yourselves with your own deployer key, e.g.:
///
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url monad_mainnet \
///     --private-key $DEPLOYER_PRIVATE_KEY \
///     --broadcast
///
/// Set DEPLOYER_PRIVATE_KEY and ADMIN_ADDRESS in your shell env or a .env file (untracked)
/// before running. Never commit a real private key to this repo.
contract Deploy is Script {
    function run() external {
        address admin = vm.envAddress("ADMIN_ADDRESS");
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerKey);

        TreasuryContract treasury = new TreasuryContract(admin);
        console2.log("TreasuryContract deployed at", address(treasury));

        CoinFlip coinFlip = new CoinFlip(address(treasury), admin);
        Dice dice = new Dice(address(treasury), admin);
        Roulette roulette = new Roulette(address(treasury), admin);
        Mines mines = new Mines(address(treasury), admin);
        Crash crash = new Crash(address(treasury), admin);
        Plinko plinko = new Plinko(address(treasury), admin);

        console2.log("CoinFlip deployed at", address(coinFlip));
        console2.log("Dice deployed at", address(dice));
        console2.log("Roulette deployed at", address(roulette));
        console2.log("Mines deployed at", address(mines));
        console2.log("Crash deployed at", address(crash));
        console2.log("Plinko deployed at", address(plinko));

        bytes32 gameRole = treasury.GAME_ROLE();
        treasury.grantRole(gameRole, address(coinFlip));
        treasury.grantRole(gameRole, address(dice));
        treasury.grantRole(gameRole, address(roulette));
        treasury.grantRole(gameRole, address(mines));
        treasury.grantRole(gameRole, address(crash));
        treasury.grantRole(gameRole, address(plinko));

        vm.stopBroadcast();

        console2.log("\nAll games granted GAME_ROLE on the treasury.");
        console2.log("Next steps (manual, NOT part of this script):");
        console2.log("1. Fund the treasury: send MON to it, or call depositToken() for USDC/CHOG.");
        console2.log("2. Call treasury.setMaxBet(token, amount) for MON/USDC/CHOG.");
        console2.log("3. Paste these addresses into src/config/contracts.ts.");
    }
}
