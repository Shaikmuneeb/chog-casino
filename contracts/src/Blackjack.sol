// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ITreasury} from "./interfaces/ITreasury.sol";

/// @notice On-chain Blackjack with full hit/stand/double/split rules, even-money payouts
/// (no 3:2 natural-blackjack bonus, matching the existing frontend), dealer stands on 17.
///
/// Unlike the single-shot games (CoinFlip/Dice/Roulette/Mines/Crash), a hand of Blackjack
/// needs a fresh random card on every Hit/Double/Split *before* the round is over — there is
/// no single point where one random number resolves everything. This contract resolves that
/// with commit-reveal extended to a whole *sequence* of cards instead of one outcome:
///
///   - The off-chain operator (OPERATOR_ROLE) generates one server seed per round and commits
///     only its hash at placeBet time, exactly like the other games.
///   - Every card in the round — the initial deal, every hit, every split, every dealer draw —
///     is just `keccak256(serverSeed, clientSeed, roundId, cardIndex) % 13`, an increasing
///     index into a deterministic, never-repeating sequence.
///   - During play, this contract does NOT know any card's value (the seed isn't revealed
///     yet) — it only records *how many* cards each hand has received and which actions were
///     taken (Hit/Stand/Double/Split), in order. The operator's own backend already knows the
///     seed (it generated it) and is responsible for showing the player their real cards live
///     as they play, off-chain, through the frontend.
///   - Once both hands are closed (via Stand or Double), the operator reveals the seed on
///     `revealAndResolve`, which replays the recorded action log to deterministically
///     reconstruct every hand and the dealer's auto-play to 17, and pays out accordingly.
///
/// This still depends on the same off-chain operator service referenced in BaseGame.sol's
/// commit-reveal mode, which does not exist in this repo — see BaseGame.sol's docs. Blackjack
/// additionally needs that service to show live card values to players during a round, not
/// just the final result, since players must see their hand to decide whether to hit.
///
/// Security notes (same pattern as the other games):
/// - Never uses block.timestamp/blockhash/prevrandao for randomness.
/// - Only this contract (holding GAME_ROLE on the treasury) can trigger payouts.
/// - Solvency against the current worst-case payout is re-checked before every bet-increasing
///   action (placeBet, split, double), not just once — splitting and doubling both increase
///   the treasury's maximum exposure for the round.
contract Blackjack is AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    enum ActionType {
        Hit,
        Stand,
        Double,
        Split
    }

    struct ActionEntry {
        ActionType action;
        uint8 handIndex;
    }

    struct Round {
        address player;
        address token;
        uint256 betHand0;
        uint256 betHand1;
        uint8 totalHands; // 1, or 2 after a split
        uint8 cardCount0;
        uint8 cardCount1;
        bool hand0Closed;
        bool hand1Closed;
        bool isSplit;
        bool resolved;
        bool exists;
        bytes32 clientSeed;
        bytes32 serverSeedCommitment;
    }

    ITreasury public immutable treasury;
    uint256 public minBet;

    mapping(uint256 => Round) public rounds;
    mapping(uint256 => ActionEntry[]) private roundActions;
    uint256 public nextRoundId;

    event RoundOpened(uint256 indexed roundId, address indexed player, address indexed token, uint256 betAmount, bytes32 serverSeedCommitment);
    event ActionTaken(uint256 indexed roundId, ActionType action, uint8 handIndex);
    event RoundResolved(uint256 indexed roundId, uint256 totalPayout);

    constructor(address _treasury, address admin) {
        treasury = ITreasury(_treasury);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
    }

    // ── Admin ──

    function setMinBet(uint256 _minBet) external onlyRole(ADMIN_ROLE) {
        minBet = _minBet;
    }

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    // ── Round lifecycle ──

    /// @notice Opens a round: collects the bet and reserves the initial 4-card deal
    /// (player, dealer-up, player, dealer-hole — indices 0-3). Card *values* are not known
    /// until `revealAndResolve`; the operator shows them to the player off-chain in real time.
    function placeBet(address token, uint256 amount, bytes32 clientSeed, bytes32 serverSeedCommitment)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256 roundId)
    {
        require(amount >= minBet, "bet below minimum");
        require(amount <= treasury.maxBet(token), "bet exceeds max bet");
        _requireSolvent(token, amount, false, 0);
        _collectBet(token, amount);

        roundId = nextRoundId++;
        Round storage r = rounds[roundId];
        r.player = msg.sender;
        r.token = token;
        r.betHand0 = amount;
        r.totalHands = 1;
        r.cardCount0 = 2;
        r.exists = true;
        r.clientSeed = clientSeed;
        r.serverSeedCommitment = serverSeedCommitment;

        emit RoundOpened(roundId, msg.sender, token, amount, serverSeedCommitment);
    }

    /// @notice Draws one more card for `handIndex`. Whether this busts the hand is only known
    /// once the seed is revealed — the operator's off-chain service must tell the frontend the
    /// real value immediately and prompt an auto-`stand` if it busts, since this contract has
    /// no way to know a hand busted until settlement.
    function hit(uint256 roundId, uint8 handIndex) external nonReentrant whenNotPaused {
        Round storage r = _activeRound(roundId);
        require(handIndex < r.totalHands, "bad hand index");
        require(!_handClosed(r, handIndex), "hand already closed");

        if (handIndex == 0) r.cardCount0 += 1;
        else r.cardCount1 += 1;

        roundActions[roundId].push(ActionEntry(ActionType.Hit, handIndex));
        emit ActionTaken(roundId, ActionType.Hit, handIndex);
    }

    /// @notice Ends `handIndex`'s turn. Once every hand in the round is closed, it becomes
    /// eligible for `revealAndResolve`.
    function stand(uint256 roundId, uint8 handIndex) external nonReentrant whenNotPaused {
        Round storage r = _activeRound(roundId);
        require(handIndex < r.totalHands, "bad hand index");
        require(!_handClosed(r, handIndex), "hand already closed");

        if (handIndex == 0) r.hand0Closed = true;
        else r.hand1Closed = true;

        roundActions[roundId].push(ActionEntry(ActionType.Stand, handIndex));
        emit ActionTaken(roundId, ActionType.Stand, handIndex);
    }

    /// @notice Doubles `handIndex`'s bet, draws exactly one more card, then immediately closes
    /// that hand. Only allowed while the hand still has its original 2 cards.
    function double(uint256 roundId, uint8 handIndex) external payable nonReentrant whenNotPaused {
        Round storage r = _activeRound(roundId);
        require(handIndex < r.totalHands, "bad hand index");
        require(!_handClosed(r, handIndex), "hand already closed");
        uint8 cardCount = handIndex == 0 ? r.cardCount0 : r.cardCount1;
        require(cardCount == 2, "double only allowed as first decision");

        uint256 currentBet = handIndex == 0 ? r.betHand0 : r.betHand1;
        uint256 newBet = currentBet * 2;
        if (handIndex == 0) {
            _requireSolvent(r.token, newBet, r.isSplit, r.betHand1);
        } else {
            _requireSolvent(r.token, r.betHand0, r.isSplit, newBet);
        }
        _collectBetWithValue(r.token, currentBet);

        if (handIndex == 0) {
            r.betHand0 = newBet;
            r.cardCount0 += 1;
            r.hand0Closed = true;
        } else {
            r.betHand1 = newBet;
            r.cardCount1 += 1;
            r.hand1Closed = true;
        }

        roundActions[roundId].push(ActionEntry(ActionType.Double, handIndex));
        emit ActionTaken(roundId, ActionType.Double, handIndex);
    }

    /// @notice Splits hand 0 into two hands, each getting one fresh card. Only allowed as the
    /// very first decision (hand 0 still has its original, unhit 2 cards).
    function split(uint256 roundId) external payable nonReentrant whenNotPaused {
        Round storage r = _activeRound(roundId);
        require(!r.isSplit && r.totalHands == 1, "already split");
        require(r.cardCount0 == 2, "split only allowed as first decision");

        _requireSolvent(r.token, r.betHand0, true, r.betHand0);
        _collectBetWithValue(r.token, r.betHand0);

        r.isSplit = true;
        r.totalHands = 2;
        r.betHand1 = r.betHand0;
        r.cardCount1 = 2;

        roundActions[roundId].push(ActionEntry(ActionType.Split, 0));
        emit ActionTaken(roundId, ActionType.Split, 0);
    }

    /// @notice Reveals the server seed, replays the round's action log to reconstruct every
    /// hand and the dealer's auto-play to 17, and pays out. Only callable once every hand has
    /// been closed via `stand` or `double`.
    function revealAndResolve(uint256 roundId, bytes32 serverSeed) external onlyRole(OPERATOR_ROLE) nonReentrant {
        Round storage r = rounds[roundId];
        require(r.exists && !r.resolved, "unknown or resolved round");
        require(r.hand0Closed && (r.totalHands == 1 || r.hand1Closed), "round still in progress");
        require(keccak256(abi.encodePacked(serverSeed)) == r.serverSeedCommitment, "seed does not match commitment");
        r.resolved = true;

        ActionEntry[] storage actions = roundActions[roundId];

        uint8[] memory hand0 = new uint8[](r.cardCount0);
        uint8[] memory hand1 = new uint8[](r.cardCount1);
        uint8 h0n;
        uint8 h1n;
        uint8 cardIdx;

        // Initial deal: player, dealer-up, player, dealer-hole.
        hand0[h0n++] = _cardAt(r, serverSeed, roundId, cardIdx++);
        uint8 dealerUp = _cardAt(r, serverSeed, roundId, cardIdx++);
        hand0[h0n++] = _cardAt(r, serverSeed, roundId, cardIdx++);
        uint8 dealerHole = _cardAt(r, serverSeed, roundId, cardIdx++);

        for (uint256 i = 0; i < actions.length; i++) {
            ActionEntry memory a = actions[i];
            if (a.action == ActionType.Split) {
                hand1[h1n++] = hand0[1];
                hand0[1] = _cardAt(r, serverSeed, roundId, cardIdx++);
                hand1[h1n++] = _cardAt(r, serverSeed, roundId, cardIdx++);
            } else if (a.action == ActionType.Hit || a.action == ActionType.Double) {
                uint8 card = _cardAt(r, serverSeed, roundId, cardIdx++);
                if (a.handIndex == 0) hand0[h0n++] = card;
                else hand1[h1n++] = card;
            }
            // Stand consumes no cards.
        }

        uint8[14] memory dealer; // 2 initial + up to ~9 draws is the realistic worst case
        dealer[0] = dealerUp;
        dealer[1] = dealerHole;
        uint8 dealerLen = 2;

        bool anyHandAlive = _handValue(hand0) <= 21 || (r.isSplit && _handValue(hand1) <= 21);
        if (anyHandAlive) {
            while (_dealerTotal(dealer, dealerLen) < 17) {
                dealer[dealerLen++] = _cardAt(r, serverSeed, roundId, cardIdx++);
            }
        }
        uint8 dealerTotal = _dealerTotal(dealer, dealerLen);

        uint256 payout0 = _settleHand(hand0, dealerTotal, r.betHand0);
        uint256 payout1 = r.isSplit ? _settleHand(hand1, dealerTotal, r.betHand1) : 0;
        uint256 totalPayout = payout0 + payout1;

        if (totalPayout > 0) {
            treasury.payout(r.token, r.player, totalPayout);
        }
        emit RoundResolved(roundId, totalPayout);
    }

    function getActions(uint256 roundId) external view returns (ActionEntry[] memory) {
        return roundActions[roundId];
    }

    // ── Internal helpers ──

    function _activeRound(uint256 roundId) internal view returns (Round storage r) {
        r = rounds[roundId];
        require(r.exists, "unknown round");
        require(!r.resolved, "round already resolved");
        require(r.player == msg.sender, "not your round");
    }

    function _handClosed(Round storage r, uint8 handIndex) internal view returns (bool) {
        return handIndex == 0 ? r.hand0Closed : r.hand1Closed;
    }

    function _requireSolvent(address token, uint256 betHand0_, bool isSplit_, uint256 betHand1_) internal view {
        uint256 worstCase = betHand0_ * 2;
        if (isSplit_) worstCase += betHand1_ * 2;
        require(treasury.isSolventFor(token, worstCase), "treasury cannot cover max payout");
    }

    function _collectBet(address token, uint256 amount) internal {
        if (token == treasury.NATIVE()) {
            require(msg.value == amount, "msg.value must equal amount");
            treasury.depositNative{value: amount}();
        } else {
            require(msg.value == 0, "no native value for token bets");
            treasury.collectBet(token, msg.sender, amount);
        }
    }

    // Same as _collectBet but used from payable non-placeBet entry points (double/split) where
    // the additional stake being pulled is `amount`, separate from any prior native deposit.
    function _collectBetWithValue(address token, uint256 amount) internal {
        _collectBet(token, amount);
    }

    function _cardAt(Round storage r, bytes32 serverSeed, uint256 roundId, uint8 cardIndex) internal view returns (uint8) {
        return uint8(uint256(keccak256(abi.encodePacked(serverSeed, r.clientSeed, roundId, cardIndex))) % 13);
    }

    function _cardValue(uint8 rank) internal pure returns (uint8) {
        if (rank <= 8) return rank + 2; // 2..10
        if (rank <= 11) return 10; // J, Q, K
        return 11; // Ace — soft value, adjusted in _handValue
    }

    function _handValue(uint8[] memory cards) internal pure returns (uint8 total) {
        uint8 aces;
        for (uint256 i = 0; i < cards.length; i++) {
            total += _cardValue(cards[i]);
            if (cards[i] == 12) aces += 1;
        }
        while (total > 21 && aces > 0) {
            total -= 10;
            aces -= 1;
        }
    }

    function _dealerTotal(uint8[14] memory dealer, uint8 len) internal pure returns (uint8 total) {
        uint8 aces;
        for (uint8 i = 0; i < len; i++) {
            total += _cardValue(dealer[i]);
            if (dealer[i] == 12) aces += 1;
        }
        while (total > 21 && aces > 0) {
            total -= 10;
            aces -= 1;
        }
    }

    function _settleHand(uint8[] memory hand, uint8 dealerTotal, uint256 betHand) internal pure returns (uint256) {
        uint8 pv = _handValue(hand);
        if (pv > 21) return 0; // bust
        if (dealerTotal > 21 || pv > dealerTotal) return betHand * 2; // win
        if (pv == dealerTotal) return betHand; // push — stake returned
        return 0; // lose
    }
}
