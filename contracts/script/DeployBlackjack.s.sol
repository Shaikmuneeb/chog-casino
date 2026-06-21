// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {TreasuryContract} from "../src/TreasuryContract.sol";
import {Blackjack} from "../src/Blackjack.sol";

/// @notice Deploys Blackjack against the ALREADY-DEPLOYED Treasury (see Deploy.s.sol, run
/// separately and earlier) and grants it GAME_ROLE. Run this once, after Deploy.s.sol.
///
///   forge script script/DeployBlackjack.s.sol:DeployBlackjack \
///     --rpc-url https://rpc.monad.xyz \
///     --broadcast
///
/// Set DEPLOYER_PRIVATE_KEY, ADMIN_ADDRESS, and TREASURY_ADDRESS (the existing deployed
/// Treasury's address) in your shell env before running. Never commit a real private key.
contract DeployBlackjack is Script {
    function run() external {
        address admin = vm.envAddress("ADMIN_ADDRESS");
        address treasuryAddress = vm.envAddress("TREASURY_ADDRESS");
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerKey);

        Blackjack blackjack = new Blackjack(treasuryAddress, admin);
        console2.log("Blackjack deployed at", address(blackjack));

        TreasuryContract treasury = TreasuryContract(payable(treasuryAddress));
        treasury.grantRole(treasury.GAME_ROLE(), address(blackjack));

        vm.stopBroadcast();

        console2.log("Blackjack granted GAME_ROLE on the existing treasury.");
        console2.log("Next step: paste this address into src/config/contracts.ts under CONTRACTS.blackjack.");
    }
}
