// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BaseGame} from "./BaseGame.sol";

/// @notice On-chain Crash/Aviator. Since a single transaction can't watch a live multiplier
/// climb, the player commits to an auto-cashout target multiplier when placing the bet; the
/// round resolves as a win if the (provably-fair) crash point reached or exceeded that target.
/// Crash-point formula mirrors the frontend exactly: a 1-in-33 instant bust at 1.00x gives
/// the ~3.03% house edge, otherwise crashPoint = floor(2^32 / (d+1) * 100) / 100, capped at 100x.
contract Crash is BaseGame {
    uint256 public constant MIN_CASHOUT_BPS = 10100; // 1.01x
    uint256 public constant MAX_CASHOUT_BPS = 1000000; // 100x

    constructor(address _treasury, address admin) BaseGame(_treasury, admin) {}

    /// @dev Returns the crash point in basis points (10000 = 1.00x), capped at 100x.
    function crashPointBps(bytes32 randomNumber) public pure returns (uint256) {
        uint32 d = uint32(uint256(randomNumber));
        if (d % 33 == 0) return 10000; // instant bust at 1.00x

        uint256 raw = (uint256(type(uint32).max) * 10000) / (uint256(d) + 1);
        if (raw > MAX_CASHOUT_BPS) raw = MAX_CASHOUT_BPS;
        if (raw < 10000) raw = 10000;
        return raw;
    }

    function placeBet(
        address token,
        uint256 amount,
        uint256 autoCashoutBps, // e.g. 20000 = 2.00x
        bytes32 userRandomNumber,
        bytes32 clientSeed,
        bytes32 serverSeedCommitment
    ) external payable nonReentrant whenNotPaused returns (uint256 betRef) {
        require(autoCashoutBps >= MIN_CASHOUT_BPS && autoCashoutBps <= MAX_CASHOUT_BPS, "cashout target out of range");

        uint256 maxPayout = (amount * autoCashoutBps) / 10000;
        bytes memory params = abi.encode(autoCashoutBps);

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
        uint256 autoCashoutBps = abi.decode(gameParams, (uint256));
        uint256 crashBps = crashPointBps(randomNumber);

        bool won = crashBps >= autoCashoutBps;

        if (won) {
            _settleWin(token, player, amount, (amount * autoCashoutBps) / 10000);
        } else {
            _settleLoss(token, player, amount);
        }
    }
}
