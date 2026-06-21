// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ITreasury} from "./interfaces/ITreasury.sol";
import {IEntropy, IEntropyConsumer} from "./interfaces/IEntropy.sol";

/// @notice Shared logic for every game: treasury wiring, bet-size/solvency validation,
/// and RNG via Pyth Entropy (primary) or commit-reveal (fallback). Concrete games
/// (CoinFlip, Dice, Roulette, Mines, Crash) implement `_resolveBet` with their own payout math.
///
/// Security notes:
/// - Never uses block.timestamp/blockhash/prevrandao for randomness.
/// - Only this contract (holding GAME_ROLE on the treasury) can trigger payouts.
/// - Solvency against the worst-case payout is checked BEFORE a bet is accepted.
abstract contract BaseGame is AccessControl, Pausable, ReentrancyGuard, IEntropyConsumer {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    /// @dev Off-chain operator that reveals the server seed in commit-reveal mode.
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    enum RngMode {
        PythEntropy,
        CommitReveal
    }

    ITreasury public immutable treasury;
    IEntropy public entropy;
    address public entropyProvider;
    RngMode public rngMode;

    uint256 public minBet;

    struct PendingBet {
        address player;
        address token;
        uint256 amount;
        bytes gameParams;
        bool resolved;
    }

    /// @dev Keyed by Pyth Entropy sequence number when rngMode == PythEntropy.
    mapping(uint64 => PendingBet) public betsBySequence;

    /// @dev Keyed by internal betId when rngMode == CommitReveal.
    mapping(uint256 => PendingBet) public betsById;
    mapping(uint256 => bytes32) public serverSeedCommitment;
    mapping(uint256 => bytes32) public clientSeedOf;
    uint256 public nextBetId;

    event BetPlaced(address indexed player, address indexed token, uint256 amount, uint256 indexed betRef);
    event BetResolved(address indexed player, address indexed token, uint256 amount, uint256 payoutAmount, bool won);

    constructor(address _treasury, address admin) {
        treasury = ITreasury(_treasury);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        rngMode = RngMode.CommitReveal; // safe default until Pyth Entropy is wired up
    }

    // ── Admin / RNG configuration ──

    function setEntropy(address _entropy, address _provider) external onlyRole(ADMIN_ROLE) {
        entropy = IEntropy(_entropy);
        entropyProvider = _provider;
    }

    function setRngMode(RngMode mode) external onlyRole(ADMIN_ROLE) {
        if (mode == RngMode.PythEntropy) {
            require(address(entropy) != address(0) && entropyProvider != address(0), "entropy not configured");
        }
        rngMode = mode;
    }

    function setMinBet(uint256 _minBet) external onlyRole(ADMIN_ROLE) {
        minBet = _minBet;
    }

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    // ── Bet intake (called by concrete game's placeBet, after it computes maxPossiblePayout) ──

    function _validateBet(address token, uint256 amount, uint256 maxPossiblePayout) internal view {
        require(amount >= minBet, "bet below minimum");
        require(amount <= treasury.maxBet(token), "bet exceeds max bet");
        require(treasury.isSolventFor(token, maxPossiblePayout), "treasury cannot cover max payout");
    }

    /// @dev Pulls the bet into the treasury. For native bets, `amount` of MON must already be
    /// held by this contract (i.e. included in the caller's msg.value) before calling this.
    function _collectBet(address token, uint256 amount) internal {
        if (token == treasury.NATIVE()) {
            treasury.depositNative{value: amount}();
        } else {
            treasury.collectBet(token, msg.sender, amount);
        }
    }

    /// @dev Entry point for Pyth Entropy mode. `entropyFee` (msg.value minus any native bet
    /// amount) must already be available to forward to the entropy contract.
    function _requestEntropyBet(
        address token,
        uint256 amount,
        uint256 maxPossiblePayout,
        bytes memory gameParams,
        bytes32 userRandomNumber,
        uint128 entropyFee
    ) internal returns (uint64 sequenceNumber) {
        require(rngMode == RngMode.PythEntropy, "wrong rng mode");
        _validateBet(token, amount, maxPossiblePayout);
        _collectBet(token, amount);

        sequenceNumber = entropy.requestWithCallback{value: entropyFee}(entropyProvider, userRandomNumber);
        betsBySequence[sequenceNumber] = PendingBet(msg.sender, token, amount, gameParams, false);
        emit BetPlaced(msg.sender, token, amount, sequenceNumber);
    }

    function entropyCallback(uint64 sequenceNumber, address provider, bytes32 randomNumber) external override {
        require(msg.sender == address(entropy), "only entropy contract");
        provider; // unused — single provider per deployment
        PendingBet storage b = betsBySequence[sequenceNumber];
        require(b.player != address(0) && !b.resolved, "unknown or resolved bet");
        b.resolved = true;
        _resolveBet(b.player, b.token, b.amount, b.gameParams, randomNumber);
    }

    /// @dev Entry point for commit-reveal mode. The server (OPERATOR_ROLE) must have generated
    /// `serverSeed` off-chain and sent only its hash to the player before this call.
    function _openCommitRevealBet(
        address token,
        uint256 amount,
        uint256 maxPossiblePayout,
        bytes memory gameParams,
        bytes32 _clientSeed,
        bytes32 _serverSeedCommitment
    ) internal returns (uint256 betId) {
        require(rngMode == RngMode.CommitReveal, "wrong rng mode");
        _validateBet(token, amount, maxPossiblePayout);
        _collectBet(token, amount);

        betId = nextBetId++;
        betsById[betId] = PendingBet(msg.sender, token, amount, gameParams, false);
        serverSeedCommitment[betId] = _serverSeedCommitment;
        clientSeedOf[betId] = _clientSeed;
        emit BetPlaced(msg.sender, token, amount, betId);
    }

    function revealAndResolve(uint256 betId, bytes32 serverSeed) external onlyRole(OPERATOR_ROLE) nonReentrant {
        PendingBet storage b = betsById[betId];
        require(b.player != address(0) && !b.resolved, "unknown or resolved bet");
        require(keccak256(abi.encodePacked(serverSeed)) == serverSeedCommitment[betId], "seed does not match commitment");
        b.resolved = true;
        bytes32 randomNumber = keccak256(abi.encodePacked(serverSeed, clientSeedOf[betId], betId));
        _resolveBet(b.player, b.token, b.amount, b.gameParams, randomNumber);
    }

    /// @dev Concrete games decode `gameParams`, compute the outcome from `randomNumber`,
    /// and call `_settleWin` or just return (stake already sits in the treasury) on a loss.
    function _resolveBet(address player, address token, uint256 amount, bytes memory gameParams, bytes32 randomNumber)
        internal
        virtual;

    function _settleWin(address token, address player, uint256 amount, uint256 payoutAmount) internal {
        treasury.payout(token, player, payoutAmount);
        emit BetResolved(player, token, amount, payoutAmount, true);
    }

    function _settleLoss(address token, address player, uint256 amount) internal {
        emit BetResolved(player, token, amount, 0, false);
    }
}
