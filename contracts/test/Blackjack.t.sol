// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {TreasuryContract} from "../src/TreasuryContract.sol";
import {Blackjack} from "../src/Blackjack.sol";

/// @notice Verifies the full hit/stand/double/split replay logic in Blackjack.sol by
/// independently recomputing the same deterministic card sequence the contract uses
/// (keccak256(serverSeed, clientSeed, roundId, cardIndex) % 13) and checking the contract's
/// payout matches what that sequence implies, rather than asserting on brute-forced outcomes.
contract BlackjackTest is Test {
    address admin = address(0xA11CE);
    address player = address(0xB0B);
    address constant NATIVE = address(0);

    TreasuryContract treasury;
    Blackjack bj;

    function setUp() public {
        treasury = new TreasuryContract(admin);
        bj = new Blackjack(address(treasury), admin);

        vm.startPrank(admin);
        treasury.grantRole(treasury.GAME_ROLE(), address(bj));
        treasury.setMaxBet(NATIVE, 1_000 ether);
        vm.stopPrank();

        vm.deal(address(treasury), 1_000 ether);
        vm.deal(player, 100 ether);
    }

    // ── Test helpers mirroring Blackjack.sol's private math exactly ──

    function cardAt(bytes32 seed, bytes32 clientSeed, uint256 roundId, uint8 idx) internal pure returns (uint8) {
        return uint8(uint256(keccak256(abi.encodePacked(seed, clientSeed, roundId, idx))) % 13);
    }

    function cardValue(uint8 rank) internal pure returns (uint8) {
        if (rank <= 8) return rank + 2;
        if (rank <= 11) return 10;
        return 11;
    }

    function handValue(uint8[] memory cards) internal pure returns (uint8 total) {
        uint8 aces;
        for (uint256 i = 0; i < cards.length; i++) {
            total += cardValue(cards[i]);
            if (cards[i] == 12) aces += 1;
        }
        while (total > 21 && aces > 0) {
            total -= 10;
            aces -= 1;
        }
    }

    // ── Happy path: deal, one hit, stand — no split/double ──

    function test_HitThenStand_PaysExactlyWhatReplayImplies() public {
        bytes32 clientSeed = keccak256("client-a");
        bytes32 serverSeed = keccak256("server-a");
        bytes32 commitment = keccak256(abi.encodePacked(serverSeed));
        uint256 roundId = 0;

        vm.prank(player);
        bj.placeBet{value: 1 ether}(NATIVE, 1 ether, clientSeed, commitment);

        vm.prank(player);
        bj.hit(roundId, 0);
        vm.prank(player);
        bj.stand(roundId, 0);

        // Independently recompute the round exactly as revealAndResolve will.
        uint8 c0 = cardAt(serverSeed, clientSeed, roundId, 0);
        uint8 dUp = cardAt(serverSeed, clientSeed, roundId, 1);
        uint8 c1 = cardAt(serverSeed, clientSeed, roundId, 2);
        uint8 dHole = cardAt(serverSeed, clientSeed, roundId, 3);
        uint8 hitCard = cardAt(serverSeed, clientSeed, roundId, 4);

        uint8[] memory hand = new uint8[](3);
        hand[0] = c0;
        hand[1] = c1;
        hand[2] = hitCard;
        uint8 playerTotal = handValue(hand);

        uint8[] memory dealerCards = new uint8[](2);
        dealerCards[0] = dUp;
        dealerCards[1] = dHole;
        uint8 dealerTotal = handValue(dealerCards);

        uint8 nextIdx = 5;
        if (playerTotal <= 21) {
            uint8[] memory growing = dealerCards;
            while (dealerTotal < 17) {
                uint8[] memory next = new uint8[](growing.length + 1);
                for (uint256 i = 0; i < growing.length; i++) next[i] = growing[i];
                next[growing.length] = cardAt(serverSeed, clientSeed, roundId, nextIdx++);
                growing = next;
                dealerTotal = handValue(growing);
            }
        }

        uint256 expectedPayout;
        if (playerTotal > 21) expectedPayout = 0;
        else if (dealerTotal > 21 || playerTotal > dealerTotal) expectedPayout = 2 ether;
        else if (playerTotal == dealerTotal) expectedPayout = 1 ether;
        else expectedPayout = 0;

        uint256 balBefore = player.balance;
        vm.prank(admin);
        bj.revealAndResolve(roundId, serverSeed);

        assertEq(player.balance - balBefore, expectedPayout, "payout must match independently-replayed outcome");
    }

    // ── Double down: bet doubles, exactly one more card, hand closes immediately ──

    function test_Double_PaysDoubleStakeOnExpectedOutcome() public {
        bytes32 clientSeed = keccak256("client-b");
        bytes32 serverSeed = keccak256("server-b");
        bytes32 commitment = keccak256(abi.encodePacked(serverSeed));
        uint256 roundId = 0;

        vm.prank(player);
        bj.placeBet{value: 1 ether}(NATIVE, 1 ether, clientSeed, commitment);

        vm.prank(player);
        bj.double{value: 1 ether}(roundId, 0);

        (,, uint256 betHand0,,,,,,,,,,,) = bj.rounds(roundId);
        assertEq(betHand0, 2 ether, "double must set the hand's stake to 2x");

        uint8 c0 = cardAt(serverSeed, clientSeed, roundId, 0);
        uint8 dUp = cardAt(serverSeed, clientSeed, roundId, 1);
        uint8 c1 = cardAt(serverSeed, clientSeed, roundId, 2);
        uint8 dHole = cardAt(serverSeed, clientSeed, roundId, 3);
        uint8 doubleCard = cardAt(serverSeed, clientSeed, roundId, 4);

        uint8[] memory hand = new uint8[](3);
        hand[0] = c0;
        hand[1] = c1;
        hand[2] = doubleCard;
        uint8 playerTotal = handValue(hand);

        uint8[] memory dealerCards = new uint8[](2);
        dealerCards[0] = dUp;
        dealerCards[1] = dHole;
        uint8 dealerTotal = handValue(dealerCards);
        uint8 nextIdx = 5;
        if (playerTotal <= 21) {
            uint8[] memory growing = dealerCards;
            while (dealerTotal < 17) {
                uint8[] memory next = new uint8[](growing.length + 1);
                for (uint256 i = 0; i < growing.length; i++) next[i] = growing[i];
                next[growing.length] = cardAt(serverSeed, clientSeed, roundId, nextIdx++);
                growing = next;
                dealerTotal = handValue(growing);
            }
        }

        uint256 expectedPayout;
        if (playerTotal > 21) expectedPayout = 0;
        else if (dealerTotal > 21 || playerTotal > dealerTotal) expectedPayout = 4 ether; // 2x stake * 2
        else if (playerTotal == dealerTotal) expectedPayout = 2 ether;
        else expectedPayout = 0;

        uint256 balBefore = player.balance;
        vm.prank(admin);
        bj.revealAndResolve(roundId, serverSeed);

        assertEq(player.balance - balBefore, expectedPayout, "double payout must match independently-replayed outcome");
    }

    // ── Split: two independent hands, each settled against the same dealer total ──

    function test_Split_SettlesBothHandsIndependently() public {
        bytes32 clientSeed = keccak256("client-c");
        bytes32 serverSeed = keccak256("server-c");
        bytes32 commitment = keccak256(abi.encodePacked(serverSeed));
        uint256 roundId = 0;

        vm.prank(player);
        bj.placeBet{value: 1 ether}(NATIVE, 1 ether, clientSeed, commitment);
        vm.prank(player);
        bj.split{value: 1 ether}(roundId);
        vm.prank(player);
        bj.stand(roundId, 0);
        vm.prank(player);
        bj.stand(roundId, 1);

        uint8 origC0 = cardAt(serverSeed, clientSeed, roundId, 0);
        uint8 dUp = cardAt(serverSeed, clientSeed, roundId, 1);
        uint8 origC1 = cardAt(serverSeed, clientSeed, roundId, 2);
        uint8 dHole = cardAt(serverSeed, clientSeed, roundId, 3);
        uint8 freshForHand0 = cardAt(serverSeed, clientSeed, roundId, 4);
        uint8 freshForHand1 = cardAt(serverSeed, clientSeed, roundId, 5);

        uint8[] memory hand0 = new uint8[](2);
        hand0[0] = origC0;
        hand0[1] = freshForHand0;
        uint8[] memory hand1 = new uint8[](2);
        hand1[0] = origC1;
        hand1[1] = freshForHand1;

        uint8 h0v = handValue(hand0);
        uint8 h1v = handValue(hand1);

        uint8[] memory dealerCards = new uint8[](2);
        dealerCards[0] = dUp;
        dealerCards[1] = dHole;
        uint8 dealerTotal = handValue(dealerCards);
        uint8 nextIdx = 6;
        bool anyAlive = h0v <= 21 || h1v <= 21;
        if (anyAlive) {
            uint8[] memory growing = dealerCards;
            while (dealerTotal < 17) {
                uint8[] memory next = new uint8[](growing.length + 1);
                for (uint256 i = 0; i < growing.length; i++) next[i] = growing[i];
                next[growing.length] = cardAt(serverSeed, clientSeed, roundId, nextIdx++);
                growing = next;
                dealerTotal = handValue(growing);
            }
        }

        uint256 expectedTotal = _settle(h0v, dealerTotal) + _settle(h1v, dealerTotal);

        uint256 balBefore = player.balance;
        vm.prank(admin);
        bj.revealAndResolve(roundId, serverSeed);

        assertEq(player.balance - balBefore, expectedTotal, "split payout must equal sum of both hands settled independently");
    }

    function _settle(uint8 playerTotal, uint8 dealerTotal) internal pure returns (uint256) {
        if (playerTotal > 21) return 0;
        if (dealerTotal > 21 || playerTotal > dealerTotal) return 2 ether;
        if (playerTotal == dealerTotal) return 1 ether;
        return 0;
    }

    // ── Security checks ──

    function test_RevertsIfNonOperatorReveals() public {
        bytes32 clientSeed = keccak256("client-d");
        bytes32 serverSeed = keccak256("server-d");
        bytes32 commitment = keccak256(abi.encodePacked(serverSeed));

        vm.prank(player);
        bj.placeBet{value: 1 ether}(NATIVE, 1 ether, clientSeed, commitment);
        vm.prank(player);
        bj.stand(0, 0);

        vm.prank(player);
        vm.expectRevert();
        bj.revealAndResolve(0, serverSeed);
    }

    function test_RevertsIfRoundStillOpen() public {
        bytes32 clientSeed = keccak256("client-e");
        bytes32 serverSeed = keccak256("server-e");
        bytes32 commitment = keccak256(abi.encodePacked(serverSeed));

        vm.prank(player);
        bj.placeBet{value: 1 ether}(NATIVE, 1 ether, clientSeed, commitment);
        // Hand 0 never stood/doubled — round is still "in progress".

        vm.prank(admin);
        vm.expectRevert("round still in progress");
        bj.revealAndResolve(0, serverSeed);
    }

    function test_RevertsOnWrongSeed() public {
        bytes32 clientSeed = keccak256("client-f");
        bytes32 serverSeed = keccak256("server-f");
        bytes32 commitment = keccak256(abi.encodePacked(serverSeed));

        vm.prank(player);
        bj.placeBet{value: 1 ether}(NATIVE, 1 ether, clientSeed, commitment);
        vm.prank(player);
        bj.stand(0, 0);

        vm.prank(admin);
        vm.expectRevert("seed does not match commitment");
        bj.revealAndResolve(0, keccak256("wrong-seed"));
    }
}
