// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BaseGame} from "./BaseGame.sol";

/// @notice 1.96x payout on a win (2% house edge), matching the frontend's audited math:
/// EV = 0.5 * 1.96 - 0.5 * 1 = -0.02.
contract CoinFlip is BaseGame {
    uint256 public constant PAYOUT_BPS = 19600; // 1.96x, in basis points of 10000

    constructor(address _treasury, address admin) BaseGame(_treasury, admin) {}

    function _maxPossiblePayout(uint256 amount) public pure returns (uint256) {
        return (amount * PAYOUT_BPS) / 10000;
    }

    /// @param wantsHeads true = bet on heads, false = bet on tails.
    function placeBet(
        address token,
        uint256 amount,
        bool wantsHeads,
        bytes32 userRandomNumber,
        bytes32 clientSeed,
        bytes32 serverSeedCommitment
    ) external payable nonReentrant whenNotPaused returns (uint256 betRef) {
        uint256 maxPayout = _maxPossiblePayout(amount);
        bytes memory params = abi.encode(wantsHeads);

        if (token == treasury.NATIVE()) {
            require(msg.value >= amount, "msg.value below bet amount");
        }

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
        bool wantsHeads = abi.decode(gameParams, (bool));
        bool landedHeads = uint256(randomNumber) % 2 == 0;
        bool won = landedHeads == wantsHeads;

        if (won) {
            _settleWin(token, player, amount, _maxPossiblePayout(amount));
        } else {
            _settleLoss(token, player, amount);
        }
    }
}
