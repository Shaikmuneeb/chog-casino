// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BaseGame} from "./BaseGame.sol";

/// @notice Plinko: ball drops through a pyramid of pins (8-16 rows), bouncing left or right
/// at each row. The final slot index determines the payout multiplier. Multiplier = 0.99 /
/// binomialProbability, giving a uniform 1% house edge at every slot — identical to Stake's
/// claimed 99% RTP.
contract Plinko is BaseGame {
    uint8 public constant MIN_ROWS = 8;
    uint8 public constant MAX_ROWS = 16;
    uint256 public constant HOUSE_EDGE_BPS = 100; // 1% = 100 basis points

    constructor(address _treasury, address admin) BaseGame(_treasury, admin) {}

    /// @dev Binomial coefficient C(n, k) computed via Pascal's triangle row iteration.
    function comb(uint8 n, uint8 k) public pure returns (uint256) {
        if (k > n) return 0;
        if (k > n - k) k = n - k;
        // Build row n of Pascal's triangle, keeping only the values we need.
        // C(n, 0) = 1; C(n, k) = C(n, k-1) * (n - k + 1) / k
        uint256 result = 1;
        for (uint8 i = 1; i <= k; i++) {
            result = result * (n - i + 1) / i;
        }
        return result;
    }

    /// @dev Count the number of set bits in `value`, considering only the first `n` bits.
    function popcount(bytes32 value, uint8 n) internal pure returns (uint8 count) {
        for (uint8 i = 0; i < n; i++) {
            if (uint8(uint8(value[i / 8]) >> (i % 8)) & 1 == 1) {
                count++;
            }
        }
    }

    /// @dev Payout multiplier in basis points (10000 = 1.00x). Formula:
    ///      multiplier = (10000 - HOUSE_EDGE_BPS) * 2^rows / C(rows, slot)
    ///      This gives exactly 1% house edge regardless of slot.
    function payoutMultiplierBps(uint8 rows, uint8 slot) public pure returns (uint256) {
        uint256 c = comb(rows, slot);
        uint256 twoPowRows = uint256(1) << rows;
        return ((10000 - HOUSE_EDGE_BPS) * twoPowRows) / c;
    }

    /// @dev Max multiplier across all slots for a given row count (always at the edge slots).
    function maxPayoutMultiplierBps(uint8 rows) public pure returns (uint256) {
        return payoutMultiplierBps(rows, 0); // slot 0 and slot rows are symmetric
    }

    function placeBet(
        address token,
        uint256 amount,
        uint8 rows,
        bytes32 userRandomNumber,
        bytes32 clientSeed,
        bytes32 serverSeedCommitment
    ) external payable nonReentrant whenNotPaused returns (uint256 betRef) {
        require(rows >= MIN_ROWS && rows <= MAX_ROWS, "rows out of range");

        uint256 maxMultBps = maxPayoutMultiplierBps(rows);
        uint256 maxPayout = (amount * maxMultBps) / 10000;
        bytes memory params = abi.encode(rows);

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
        (uint8 rows) = abi.decode(gameParams, (uint8));

        // Simulate ball path: each of the first `rows` bits determines left (0) or right (1).
        uint8 slot = popcount(randomNumber, rows);
        uint256 multBps = payoutMultiplierBps(rows, slot);
        uint256 payout = (amount * multBps) / 10000;

        if (payout > amount) {
            _settleWin(token, player, amount, payout);
        } else {
            _settleLoss(token, player, amount);
        }
    }
}
