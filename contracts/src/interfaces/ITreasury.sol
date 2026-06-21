// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITreasury {
    /// @notice Native MON is represented by the zero address, matching the token registry.
    function NATIVE() external view returns (address);

    function depositNative() external payable;

    function depositToken(address token, uint256 amount) external;

    /// @notice Pulls `amount` of `token` from `player` into the treasury, using the player's
    /// ERC-20 approval on the treasury itself (not on the calling game). GAME_ROLE only.
    function collectBet(address token, address player, uint256 amount) external;

    /// @notice Pays `amount` of `token` to `player`. Callable only by addresses holding GAME_ROLE.
    function payout(address token, address player, uint256 amount) external;

    function getBalance(address token) external view returns (uint256);

    function maxBet(address token) external view returns (uint256);

    function setMaxBet(address token, uint256 newMaxBet) external;

    function isSolventFor(address token, uint256 maxPossiblePayout) external view returns (bool);

    event BetReceived(address indexed game, address indexed token, address indexed player, uint256 amount);
    event PayoutSent(address indexed game, address indexed token, address indexed player, uint256 amount);
    event AdminWithdraw(address indexed token, address indexed to, uint256 amount);
    event MaxBetUpdated(address indexed token, uint256 newMaxBet);
}
