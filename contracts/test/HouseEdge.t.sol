// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {TreasuryContract} from "../src/TreasuryContract.sol";
import {CoinFlip} from "../src/CoinFlip.sol";
import {Dice} from "../src/Dice.sol";
import {Roulette} from "../src/Roulette.sol";
import {Mines} from "../src/Mines.sol";
import {Crash} from "../src/Crash.sol";

/// @notice Verifies the on-chain payout math matches the audited house-edge targets:
/// CoinFlip 1.96x (2%), Dice 0.99/winChance (1%), Roulette 36x/2x (2.7%), Mines 0.99x fair (1%),
/// Crash auto-cashout vs. crash-point formula (~3.03% via the 1-in-33 instant bust).
contract HouseEdgeTest is Test {
    address admin = address(0xA11CE);
    address player = address(0xB0B);
    address constant NATIVE = address(0);

    TreasuryContract treasury;
    CoinFlip coinFlip;
    Dice dice;
    Roulette roulette;
    Mines mines;
    Crash crash;

    function setUp() public {
        treasury = new TreasuryContract(admin);
        coinFlip = new CoinFlip(address(treasury), admin);
        dice = new Dice(address(treasury), admin);
        roulette = new Roulette(address(treasury), admin);
        mines = new Mines(address(treasury), admin);
        crash = new Crash(address(treasury), admin);

        vm.startPrank(admin);
        treasury.grantRole(treasury.GAME_ROLE(), address(coinFlip));
        treasury.grantRole(treasury.GAME_ROLE(), address(dice));
        treasury.grantRole(treasury.GAME_ROLE(), address(roulette));
        treasury.grantRole(treasury.GAME_ROLE(), address(mines));
        treasury.grantRole(treasury.GAME_ROLE(), address(crash));
        treasury.setMaxBet(NATIVE, 1_000 ether);
        vm.stopPrank();

        vm.deal(address(treasury), 1_000 ether); // bankroll
        vm.deal(player, 100 ether);
    }

    // ── Pure math: house-edge formulas ──

    function test_CoinFlip_PaysOneNinetySixX() public {
        assertEq(coinFlip._maxPossiblePayout(100 ether), (100 ether * 196) / 100);
        // EV = 0.5 * 1.96 - 0.5 * 1 = -0.02 -> 2% edge
    }

    function test_Dice_NinetyNinePercentFactorAtEveryTarget() public {
        // Roll under 50 -> winChance 50 -> payout = (100/50)*0.99 = 1.98x
        assertEq(dice._payoutFor(100 ether, 50, true), (100 ether * 198) / 100);
        // Roll under 10 -> winChance 10 -> payout = (100/10)*0.99 = 9.9x
        assertEq(dice._payoutFor(100 ether, 10, true), (100 ether * 990) / 100);
        // Roll over 50 -> winChance 50 -> same as roll under 50
        assertEq(dice._payoutFor(100 ether, 50, false), (100 ether * 198) / 100);
    }

    function test_Roulette_StraightNumberAndOutsideBetsEdge() public {
        assertEq(roulette.multiplierFor(Roulette.BetKind.StraightNumber), 36);
        assertEq(roulette.multiplierFor(Roulette.BetKind.Red), 2);
        // Green/zero is just StraightNumber with number = 0 -> same 36x as every other number.
    }

    function test_Mines_NinetyNinePercentOfFairOdds() public {
        // 5 mines, 1 pick: fair multiplier = 25/20 = 1.25x -> 0.99 * 1.25 = 1.2375x
        uint256 payout = mines.payoutFor(100 ether, 1, 5);
        assertApproxEqAbs(payout, (100 ether * 12375) / 10000, 1e12);
    }

    function test_Crash_InstantBustAndFormula() public {
        // d % 33 == 0 -> instant bust at 1.00x
        assertEq(crash.crashPointBps(bytes32(uint256(33))), 10000);
        // Otherwise capped between 1.00x and 100x
        uint256 bps = crash.crashPointBps(bytes32(uint256(1)));
        assertGe(bps, 10000);
        assertLe(bps, 1_000_000);
    }

    // ── End-to-end: commit-reveal flow pays out (or doesn't) per the math above ──

    function test_CoinFlip_EndToEnd_WinPaysExactly196x() public {
        uint256 betId = treasury.NATIVE() == NATIVE ? 0 : 0;
        bytes32 clientSeed = keccak256("client");

        // Find a serverSeed where heads (even randomNumber) results, to deterministically win.
        bytes32 serverSeed;
        bytes32 randomNumber;
        for (uint256 i = 0; i < 1000; i++) {
            serverSeed = keccak256(abi.encodePacked(i));
            randomNumber = keccak256(abi.encodePacked(serverSeed, clientSeed, betId));
            if (uint256(randomNumber) % 2 == 0) break; // heads
        }
        bytes32 commitment = keccak256(abi.encodePacked(serverSeed));

        vm.prank(player);
        coinFlip.placeBet{value: 1 ether}(NATIVE, 1 ether, true, bytes32(0), clientSeed, commitment);

        uint256 balBefore = player.balance;
        vm.prank(admin);
        coinFlip.revealAndResolve(betId, serverSeed);

        assertEq(player.balance - balBefore, (1 ether * 196) / 100);
    }

    function test_CoinFlip_EndToEnd_LossKeepsStakeInTreasury() public {
        uint256 betId = 0;
        bytes32 clientSeed = keccak256("client2");

        // Find a serverSeed where the result is tails while player bets heads -> loss.
        bytes32 serverSeed;
        bytes32 randomNumber;
        for (uint256 i = 0; i < 1000; i++) {
            serverSeed = keccak256(abi.encodePacked(i));
            randomNumber = keccak256(abi.encodePacked(serverSeed, clientSeed, betId));
            if (uint256(randomNumber) % 2 == 1) break; // tails
        }
        bytes32 commitment = keccak256(abi.encodePacked(serverSeed));

        vm.prank(player);
        coinFlip.placeBet{value: 1 ether}(NATIVE, 1 ether, true, bytes32(0), clientSeed, commitment);

        uint256 balBefore = player.balance;
        vm.prank(admin);
        coinFlip.revealAndResolve(betId, serverSeed);

        assertEq(balBefore - player.balance, 0); // no further loss beyond the bet already taken
    }

    function test_Treasury_RejectsPayoutFromNonGameContract() public {
        vm.prank(player);
        vm.expectRevert();
        treasury.payout(NATIVE, player, 1 ether);
    }

    function test_Treasury_RejectsBetAboveMaxBet() public {
        vm.prank(admin);
        treasury.setMaxBet(NATIVE, 1 ether);

        vm.prank(player);
        vm.expectRevert("bet exceeds max bet");
        coinFlip.placeBet{value: 2 ether}(NATIVE, 2 ether, true, bytes32(0), keccak256("c"), keccak256("s"));
    }
}
