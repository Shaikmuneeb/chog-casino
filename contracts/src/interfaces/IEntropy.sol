// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal subset of Pyth Entropy's interface needed for request/callback RNG.
/// See: https://docs.pyth.network/entropy
interface IEntropy {
    function requestWithCallback(address provider, bytes32 userRandomNumber)
        external
        payable
        returns (uint64 sequenceNumber);

    function getFee(address provider) external view returns (uint128);
}

/// @notice Implemented by any contract that wants to receive Pyth Entropy callbacks.
interface IEntropyConsumer {
    function entropyCallback(uint64 sequenceNumber, address provider, bytes32 randomNumber) external;
}
