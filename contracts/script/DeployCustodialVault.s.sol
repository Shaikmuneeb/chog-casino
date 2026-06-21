// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {CustodialVault} from "../src/CustodialVault.sol";

/// @notice Deploys CustodialVault standalone — it does NOT touch the existing TreasuryContract
/// or any game contract. Grants OPERATOR_ROLE to the operator backend's deposit-sweep address
/// (a DIFFERENT key than the one used for commit-reveal resolution — see operator/README.md).
///
///   forge script script/DeployCustodialVault.s.sol:DeployCustodialVault \
///     --rpc-url https://rpc.monad.xyz \
///     --broadcast
///
/// Set DEPLOYER_PRIVATE_KEY, ADMIN_ADDRESS, and VAULT_OPERATOR_ADDRESS in your shell env before
/// running. Never commit a real private key.
contract DeployCustodialVault is Script {
    function run() external {
        address admin = vm.envAddress("ADMIN_ADDRESS");
        address vaultOperator = vm.envAddress("VAULT_OPERATOR_ADDRESS");
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerKey);

        CustodialVault vault = new CustodialVault(admin);
        console2.log("CustodialVault deployed at", address(vault));

        vault.grantRole(vault.OPERATOR_ROLE(), vaultOperator);
        console2.log("Granted OPERATOR_ROLE to", vaultOperator);

        vm.stopBroadcast();

        console2.log("Next step: paste this address into src/config/contracts.ts under CONTRACTS.custodialVault");
        console2.log("and into operator/.env as CUSTODIAL_VAULT_ADDRESS.");
    }
}
