// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BaseGame} from "./BaseGame.sol";

/// @notice Roll under/over `target` (2-98). Payout = (100 / winChance) * 0.99, a flat 1% edge
/// at every target, matching the frontend's HOUSE_MULTIPLIER = 99 formula exactly.
contract Dice is BaseGame {
    uint256 public constant HOUSE_MULTIPLIER_BPS = 9900; // 0.99 in basis points of 10000

    constructor(address _treasury, address admin) BaseGame(_treasury, admin) {}

    function winChance(uint8 target, bool isUnder) public pure returns (uint256) {
        return isUnder ? target : (100 - target);
    }

    /// @dev payout = amount * 99 / winChance, expressed without floats:
    /// payout = (amount * HOUSE_MULTIPLIER_BPS) / (winChance * 100)
    function _payoutFor(uint256 amount, uint8 target, bool isUnder) public pure returns (uint256) {
        uint256 chance = winChance(target, isUnder);
        return (amount * HOUSE_MULTIPLIER_BPS) / (chance * 100);
    }

    function placeBet(
        address token,
        uint256 amount,
        uint8 target,
        bool isUnder,
        bytes32 userRandomNumber,
        bytes32 clientSeed,
        bytes32 serverSeedCommitment
    ) external payable nonReentrant whenNotPaused returns (uint256 betRef) {
        require(target >= 2 && target <= 98, "target out of range");

        uint256 maxPayout = _payoutFor(amount, target, isUnder);
        bytes memory params = abi.encode(target, isUnder);

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
        (uint8 target, bool isUnder) = abi.decode(gameParams, (uint8, bool));
        uint256 roll = uint256(randomNumber) % 100; // uniform 0-99

        bool won = isUnder ? roll < target : roll >= target;

        if (won) {
            _settleWin(token, player, amount, _payoutFor(amount, target, isUnder));
        } else {
            _settleLoss(token, player, amount);
        }
    }
}
