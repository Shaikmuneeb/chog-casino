// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Holds custodial per-player balances funded by deposit-address sweeps from the
/// off-chain operator. Separate from TreasuryContract (the wallet-direct betting bankroll).
/// Also used as the accounting ledger for instant vault-funded bets: the operator's own wallet
/// fronts a bet's stake on the actual game contract (since those contracts always treat
/// msg.sender as the player — see Blackjack.sol/BaseGame.sol), and debits/credits this vault
/// to reflect the real player's win/loss without ever requiring their wallet's signature.
///
/// Security model: only OPERATOR_ROLE (the backend's hot wallet) can credit a player's balance,
/// after it has verified and swept a real on-chain deposit. Withdrawal has two paths: the
/// player's own signed transaction (withdraw, below — the operator can never block, delay, or
/// redirect this one), and an operator-executed withdrawal to an address the player specifies
/// off-chain (operatorWithdraw, below) — added for players whose wallet can't reliably sign
/// Monad transactions directly (e.g. broken chain support in some wallet apps), following the
/// same custodial-cashout pattern used by other Monad betting sites. This SECOND path is a
/// genuine trust tradeoff: it relies on the operator backend correctly authenticating that the
/// caller of its withdrawal API really is the balance owner (see operator/src/server.ts) before
/// ever calling this function — a compromised operator key CAN drain any player's balance to any
/// address via this path, unlike the player-signed path above. Documented here so anyone
/// auditing this contract understands operatorWithdraw is a deliberate, narrower-than-ideal
/// trust boundary, not an oversight.
contract CustodialVault is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    address public constant NATIVE_TOKEN = address(0);

    // mirrors TreasuryContract's hardcoded token registry
    address public constant CHOG = 0x350035555E10d9AfAF1566AaebfCeD5BA6C27777;
    address public constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;

    mapping(address => mapping(address => uint256)) public balanceOf;

    /// @dev Sum of every player's balanceOf for a token — what the vault owes out in total.
    /// adminWithdraw is capped by this so the admin can never pull the contract below what it
    /// owes players, no matter how many times it's called or how the operator's bookkeeping
    /// drifted getting there.
    mapping(address => uint256) public totalLiabilities;

    event Credited(address indexed player, address indexed token, uint256 amount, bytes32 indexed sweepRef);
    event Debited(address indexed player, address indexed token, uint256 amount, bytes32 indexed betRef);
    event Withdrawn(address indexed player, address indexed token, uint256 amount);
    event OperatorWithdrawn(address indexed player, address indexed to, address indexed token, uint256 amount, bytes32 requestRef);
    event AdminWithdraw(address indexed token, address indexed to, uint256 amount);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
    }

    function NATIVE() external pure returns (address) {
        return NATIVE_TOKEN;
    }

    /// @dev Called by the operator after sweeping a confirmed deposit into this contract.
    /// `sweepRef` is an opaque off-chain reference (e.g. the deposit-address sweep tx hash,
    /// truncated to bytes32) purely for audit/event-tracing — it has no on-chain meaning.
    function credit(address player, address token, uint256 amount, bytes32 sweepRef)
        external
        onlyRole(OPERATOR_ROLE)
        whenNotPaused
    {
        require(player != address(0), "bad player");
        require(token == NATIVE_TOKEN || token == CHOG || token == USDC, "unsupported token");
        require(amount > 0, "zero amount");
        balanceOf[player][token] += amount;
        totalLiabilities[token] += amount;
        emit Credited(player, token, amount, sweepRef);
    }

    /// @dev Called by the operator when it's about to front a bet's stake from its own wallet
    /// on a player's behalf (see operator/src/server.ts's /vault-bet routes). Pure accounting —
    /// no tokens move here, since the operator's own wallet (not this vault) actually pays the
    /// game contract. `betRef` is an opaque off-chain reference for audit/event-tracing only.
    function debit(address player, address token, uint256 amount, bytes32 betRef)
        external
        onlyRole(OPERATOR_ROLE)
        whenNotPaused
    {
        require(amount > 0, "zero amount");
        uint256 bal = balanceOf[player][token];
        require(bal >= amount, "insufficient balance");
        balanceOf[player][token] = bal - amount;
        totalLiabilities[token] -= amount;
        emit Debited(player, token, amount, betRef);
    }

    /// @dev Player-initiated only — msg.sender always pays itself, never anyone else.
    function withdraw(address token, uint256 amount) external whenNotPaused nonReentrant {
        require(amount > 0, "zero amount");
        uint256 bal = balanceOf[msg.sender][token];
        require(bal >= amount, "insufficient balance");

        balanceOf[msg.sender][token] = bal - amount;
        totalLiabilities[token] -= amount;

        if (token == NATIVE_TOKEN) {
            (bool ok, ) = payable(msg.sender).call{value: amount}("");
            require(ok, "native withdraw failed");
        } else {
            IERC20(token).safeTransfer(msg.sender, amount);
        }

        emit Withdrawn(msg.sender, token, amount);
    }

    /// @dev Operator-executed withdrawal to an address the player specified off-chain (the
    /// operator's HTTP API is responsible for authenticating that the request really came from
    /// `player` — this contract has no way to verify that itself, since there's no player
    /// signature on this call at all). `requestRef` is an opaque off-chain reference (e.g. a
    /// hash of the withdrawal request) purely for audit/event-tracing.
    function operatorWithdraw(address player, address token, uint256 amount, address to, bytes32 requestRef)
        external
        onlyRole(OPERATOR_ROLE)
        whenNotPaused
        nonReentrant
    {
        require(to != address(0), "bad recipient");
        require(amount > 0, "zero amount");
        uint256 bal = balanceOf[player][token];
        require(bal >= amount, "insufficient balance");

        balanceOf[player][token] = bal - amount;
        totalLiabilities[token] -= amount;

        if (token == NATIVE_TOKEN) {
            (bool ok, ) = payable(to).call{value: amount}("");
            require(ok, "native withdraw failed");
        } else {
            IERC20(token).safeTransfer(to, amount);
        }

        emit OperatorWithdrawn(player, to, token, amount, requestRef);
    }

    // ── Admin ──

    /// @dev Lets the admin recover funds that aren't backing any credited balance (e.g. an
    /// accidental over-sweep, or dust). Does NOT touch player balance accounting, and — crucially
    /// — can never pull the contract's real balance below totalLiabilities[token], so the admin
    /// can never leave a credited player unable to withdraw, even by mistake or repeated calls.
    function adminWithdraw(address token, uint256 amount, address to) external onlyRole(ADMIN_ROLE) nonReentrant {
        require(to != address(0), "bad recipient");
        require(getBalance(token) >= amount, "insufficient balance");
        require(getBalance(token) - amount >= totalLiabilities[token], "would breach player liabilities");

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

    function getBalance(address token) public view returns (uint256) {
        if (token == NATIVE_TOKEN) return address(this).balance;
        return IERC20(token).balanceOf(address(this));
    }

    /// @dev Allows the vault to receive swept native MON deposits.
    receive() external payable {}
}
