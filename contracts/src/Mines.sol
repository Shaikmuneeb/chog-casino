// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BaseGame} from "./BaseGame.sol";

/// @notice On-chain Mines collapses the frontend's tile-by-tile reveal into a single bet:
/// the player commits upfront to "I will survive `picks` reveals out of a 5x5 grid with
/// `mineCount` mines", and one RNG draw resolves the whole bet. This preserves the exact
/// combinatorial odds (and 1% house-edge scaling) the frontend uses to compute its
/// per-reveal multiplier, just evaluated as a single all-or-nothing draw.
contract Mines is BaseGame {
    uint8 public constant GRID_SIZE = 25;

    constructor(address _treasury, address admin) BaseGame(_treasury, admin) {}

    /// @dev Probability (scaled to 1e18) of revealing `picks` safe tiles in a row out of
    /// `GRID_SIZE` tiles containing `mineCount` mines. Same product the frontend computes
    /// before inverting it into a fair multiplier.
    function survivalProbabilityE18(uint8 picks, uint8 mineCount) public pure returns (uint256 probE18) {
        require(mineCount >= 1 && mineCount <= 24, "mineCount out of range");
        require(picks >= 1 && picks <= GRID_SIZE - mineCount, "picks out of range");
        probE18 = 1e18;
        for (uint8 i = 0; i < picks; i++) {
            probE18 = (probE18 * (GRID_SIZE - mineCount - i)) / (GRID_SIZE - i);
        }
    }

    /// @dev payout = amount * 0.99 / survivalProbability — the fair multiplier (1/prob)
    /// scaled by the same 0.99 house-edge factor as the frontend.
    function payoutFor(uint256 amount, uint8 picks, uint8 mineCount) public pure returns (uint256) {
        uint256 probE18 = survivalProbabilityE18(picks, mineCount);
        return (amount * 99 * 1e16) / probE18;
    }

    function placeBet(
        address token,
        uint256 amount,
        uint8 picks,
        uint8 mineCount,
        bytes32 userRandomNumber,
        bytes32 clientSeed,
        bytes32 serverSeedCommitment
    ) external payable nonReentrant whenNotPaused returns (uint256 betRef) {
        uint256 maxPayout = payoutFor(amount, picks, mineCount);
        bytes memory params = abi.encode(picks, mineCount);

        if (rngMode == RngMode.PythEntropy) {
            uint128 fee = entropy.getFee(entropyProvider);
            uint256 nativeBetPortion = token == treasury.NATIVE() ? amount : 0;
            require(msg.value == nativeBetPortion + fee, "msg.value must cover bet + entropy fee");
            betRef = _requestEntropyBet(token, amount, maxPayout, params, userRandomNumber, fee);
        } else {
            if (token == treasury.NATIVE()) {
                require(msg.value == amount, "msg.value must equal bet amount");
            }
            betRef = _openCommitRevealBet(token, amount, maxPayout, params, clientSeed, serverSeedCommitment);
        }
    }

    function _resolveBet(address player, address token, uint256 amount, bytes memory gameParams, bytes32 randomNumber)
        internal
        override
    {
        (uint8 picks, uint8 mineCount) = abi.decode(gameParams, (uint8, uint8));
        uint256 probE18 = survivalProbabilityE18(picks, mineCount);
        uint256 roll = uint256(randomNumber) % 1e18;

        bool won = roll < probE18;

        if (won) {
            _settleWin(token, player, amount, payoutFor(amount, picks, mineCount));
        } else {
            _settleLoss(token, player, amount);
        }
    }
}
