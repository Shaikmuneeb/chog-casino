// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ITreasury} from "./interfaces/ITreasury.sol";

/// @notice Holds MON/USDC/CHOG bankroll for the casino and pays out winnings.
/// Only contracts holding GAME_ROLE (the per-game contracts) may call payout().
/// Admin (DEFAULT_ADMIN_ROLE) can pause everything, withdraw, and set per-token max bets.
contract TreasuryContract is ITreasury, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant GAME_ROLE = keccak256("GAME_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    address public constant NATIVE_TOKEN = address(0);

    mapping(address => uint256) public maxBet;

    // Hardcoded token registry — do not change without redeploying.
    address public constant CHOG = 0x350035555E10d9AfAF1566AaebfCeD5BA6C27777;
    address public constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
    }

    function NATIVE() external pure override returns (address) {
        return NATIVE_TOKEN;
    }

    // ── Deposits (bankroll funding by admin, or bets forwarded by game contracts) ──

    function depositNative() external payable override {
        emit BetReceived(msg.sender, NATIVE_TOKEN, msg.sender, msg.value);
    }

    function depositToken(address token, uint256 amount) external override {
        require(token == CHOG || token == USDC, "unsupported token");
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit BetReceived(msg.sender, token, msg.sender, amount);
    }

    /// @dev Called by a game contract to pull an ERC-20 bet from the player. The player must have
    /// approved the TREASURY address (not the game) as spender from the frontend.
    function collectBet(address token, address player, uint256 amount)
        external
        override
        onlyRole(GAME_ROLE)
        whenNotPaused
        nonReentrant
    {
        require(token == CHOG || token == USDC, "unsupported token");
        IERC20(token).safeTransferFrom(player, address(this), amount);
        emit BetReceived(msg.sender, token, player, amount);
    }

    // ── Payouts ──

    /// @dev Game contracts call this after resolving a round in the player's favor.
    function payout(address token, address player, uint256 amount)
        external
        override
        onlyRole(GAME_ROLE)
        whenNotPaused
        nonReentrant
    {
        require(player != address(0), "bad player");
        require(getBalance(token) >= amount, "treasury insolvent");

        if (token == NATIVE_TOKEN) {
            (bool ok, ) = payable(player).call{value: amount}("");
            require(ok, "native payout failed");
        } else {
            IERC20(token).safeTransfer(player, amount);
        }

        emit PayoutSent(msg.sender, token, player, amount);
    }

    // ── Views ──

    function getBalance(address token) public view override returns (uint256) {
        if (token == NATIVE_TOKEN) return address(this).balance;
        return IERC20(token).balanceOf(address(this));
    }

    /// @dev Game contracts must call this BEFORE accepting a bet to ensure the treasury
    /// can cover the worst-case payout if the player wins.
    function isSolventFor(address token, uint256 maxPossiblePayout) external view override returns (bool) {
        return getBalance(token) >= maxPossiblePayout;
    }

    // ── Admin ──

    function setMaxBet(address token, uint256 newMaxBet) external override onlyRole(ADMIN_ROLE) {
        maxBet[token] = newMaxBet;
        emit MaxBetUpdated(token, newMaxBet);
    }

    function adminWithdraw(address token, uint256 amount, address to) external onlyRole(ADMIN_ROLE) nonReentrant {
        require(to != address(0), "bad recipient");
        require(getBalance(token) >= amount, "insufficient balance");

        if (token == NATIVE_TOKEN) {
            (bool ok, ) = payable(to).call{value: amount}("");
            require(ok, "native withdraw failed");
        } else {
            IERC20(token).safeTransfer(to, amount);
        }

        emit AdminWithdraw(token, to, amount);
    }

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    /// @dev Allows the treasury to receive native MON sent directly (e.g. bankroll top-ups).
    receive() external payable {}
}
