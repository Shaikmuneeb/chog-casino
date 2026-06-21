// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BaseGame} from "./BaseGame.sol";

/// @notice European roulette only — single zero, 37 pockets (0-36), no double-zero.
/// Straight-up number bets (including 0) pay 36x (2.7% edge); even-money outside bets
/// (red/black/odd/even/1-18/19-36) pay 2x (also 2.7% edge). Matches the frontend fix that
/// made the green/zero bet consistent with every other single-number bet.
contract Roulette is BaseGame {
    enum BetKind {
        StraightNumber,
        Red,
        Black,
        Odd,
        Even,
        Low, // 1-18
        High // 19-36
    }

    // Bitmask of red numbers on a European wheel: 1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36
    uint64 private constant RED_MASK =
        (uint64(1) << 1) | (uint64(1) << 3) | (uint64(1) << 5) | (uint64(1) << 7) | (uint64(1) << 9) |
        (uint64(1) << 12) | (uint64(1) << 14) | (uint64(1) << 16) | (uint64(1) << 18) | (uint64(1) << 19) |
        (uint64(1) << 21) | (uint64(1) << 23) | (uint64(1) << 25) | (uint64(1) << 27) | (uint64(1) << 30) |
        (uint64(1) << 32) | (uint64(1) << 34) | (uint64(1) << 36);

    constructor(address _treasury, address admin) BaseGame(_treasury, admin) {}

    function isRed(uint8 n) public pure returns (bool) {
        return (RED_MASK >> n) & 1 == 1;
    }

    function multiplierFor(BetKind kind) public pure returns (uint256) {
        return kind == BetKind.StraightNumber ? 36 : 2;
    }

    function placeBet(
        address token,
        uint256 amount,
        BetKind kind,
        uint8 number, // only used when kind == StraightNumber, must be 0-36
        bytes32 userRandomNumber,
        bytes32 clientSeed,
        bytes32 serverSeedCommitment
    ) external payable nonReentrant whenNotPaused returns (uint256 betRef) {
        if (kind == BetKind.StraightNumber) {
            require(number <= 36, "number out of range");
        }

        uint256 maxPayout = amount * multiplierFor(kind);
        bytes memory params = abi.encode(kind, number);

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
        (BetKind kind, uint8 number) = abi.decode(gameParams, (BetKind, uint8));
        uint8 result = uint8(uint256(randomNumber) % 37); // uniform 0-36, single-zero wheel

        bool won;
        if (kind == BetKind.StraightNumber) {
            won = result == number;
        } else if (kind == BetKind.Red) {
            won = result != 0 && isRed(result);
        } else if (kind == BetKind.Black) {
            won = result != 0 && !isRed(result);
        } else if (kind == BetKind.Odd) {
            won = result != 0 && result % 2 == 1;
        } else if (kind == BetKind.Even) {
            won = result != 0 && result % 2 == 0;
        } else if (kind == BetKind.Low) {
            won = result >= 1 && result <= 18;
        } else {
            won = result >= 19 && result <= 36;
        }

        if (won) {
            _settleWin(token, player, amount, amount * multiplierFor(kind));
        } else {
            _settleLoss(token, player, amount);
        }
    }
}
