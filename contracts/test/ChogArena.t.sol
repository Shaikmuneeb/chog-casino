// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ChogShield} from "../src/ChogShield.sol";
import {PredictionMarket} from "../src/PredictionMarket.sol";

/// @dev Minimal stand-in for the Chog NFT — ChogShield.claimBailout() only reads
/// balanceOf(). Hand-rolled (not OZ ERC721) because OZ 5.6.1's ERC721.sol requires
/// solc ^0.8.24 while this project pins 0.8.20.
contract MockERC721 {
    string public constant name = "Mock Chog";
    string public constant symbol = "CHOG";

    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _owners;
    uint256 private _nextTokenId = 1;

    function balanceOf(address owner) external view returns (uint256) {
        return _balances[owner];
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address owner = _owners[tokenId];
        require(owner != address(0), "nonexistent token");
        return owner;
    }

    function mint(address to) external returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        _owners[tokenId] = to;
        _balances[to] += 1;
    }
}

contract ChogArenaTest is Test {
    MockERC721 internal nft;
    ChogShield internal shield;
    PredictionMarket internal pm;

    address internal alice;
    address internal bob;
    address internal charlie;
    address internal treasury;

    uint256 internal constant START_BALANCE = 1_000 ether;
    uint256 internal constant BET = 10 ether;

    // mirror of PredictionMarket/Shield events for vm.expectEmit
    event MarketCreated(uint256 indexed marketId, string question, uint256 endTime);
    event MarketResolved(uint256 indexed marketId, uint8 winningOutcome, uint256 shieldFee, uint256 treasuryFee);
    event WinningsClaimed(uint256 indexed marketId, address indexed user, uint256 payout);
    event BailoutClaimed(address indexed user, uint256 amount);

    function setUp() public {
        // realistic chain time — with lastClaimTimestamp starting at 0, claimBailout's
        // cooldown check needs block.timestamp >= 7 days to ever pass on a first claim
        vm.warp(30 days);

        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");
        treasury = makeAddr("treasury");

        nft = new MockERC721();
        shield = new ChogShield(address(nft));
        pm = new PredictionMarket(payable(address(shield)), treasury);

        // test contract is the deployer/owner of both, so this passes onlyOwner
        shield.setAuthorizedMarket(address(pm));

        vm.deal(alice, START_BALANCE);
        vm.deal(bob, START_BALANCE);
        vm.deal(charlie, START_BALANCE);

        // NFT minted to Alice only — Bob and Charlie hold 0
        nft.mint(alice);
        assertEq(nft.balanceOf(alice), 1);
        assertEq(nft.balanceOf(bob), 0);
        assertEq(nft.balanceOf(charlie), 0);
    }

    // ── helpers ──

    function _market(uint256 marketId)
        internal
        view
        returns (uint256 endTime, uint256 yesAmount, uint256 noAmount, bool resolved, uint8 outcome)
    {
        (, endTime, yesAmount, noAmount, resolved, outcome) = pm.markets(marketId);
    }

    function _openTwoSidedMarket() internal returns (uint256 marketId) {
        marketId = pm.createMarket("Will Monad flip bullish?", 1 days);
        vm.prank(alice);
        pm.placeBet{value: BET}(marketId, true); // Alice: YES
        vm.prank(bob);
        pm.placeBet{value: BET}(marketId, false); // Bob: NO
    }

    function _resolveAfterEnd(uint256 marketId, uint8 outcome) internal {
        (uint256 endTime,,,,) = _market(marketId);
        vm.warp(endTime);
        pm.resolveMarket(marketId, outcome);
    }

    // ── a ──

    function test_CreateAndPlaceBets() public {
        vm.expectEmit(true, false, false, true, address(pm));
        emit MarketCreated(1, "Will Monad flip bullish?", block.timestamp + 1 days);
        uint256 marketId = pm.createMarket("Will Monad flip bullish?", 1 days);

        assertEq(marketId, 1);
        assertEq(pm.marketCount(), 1);

        vm.prank(alice);
        pm.placeBet{value: BET}(marketId, true);
        vm.prank(bob);
        pm.placeBet{value: BET}(marketId, false);

        (, uint256 yesAmount, uint256 noAmount,,) = _market(marketId);
        assertEq(yesAmount, BET);
        assertEq(noAmount, BET);
        // per-user buckets are struct-internal (not exposed by the getter), so verify
        // them through the stake actually leaving each wallet
        assertEq(alice.balance, START_BALANCE - BET);
        assertEq(bob.balance, START_BALANCE - BET);
        assertEq(charlie.balance, START_BALANCE);

        // guards: zero stake and post-deadline bets are rejected
        vm.prank(charlie);
        vm.expectRevert("Zero bet");
        pm.placeBet{value: 0}(marketId, true);

        (uint256 endTime,,,,) = _market(marketId);
        vm.warp(endTime);
        vm.prank(charlie);
        vm.expectRevert("Market closed");
        pm.placeBet{value: 1 ether}(marketId, true);
        assertEq(charlie.balance, START_BALANCE); // rejected bets refund nothing / take nothing
    }

    // ── b ──

    function test_ResolveAndClaimWinnings() public {
        uint256 marketId = _openTwoSidedMarket(); // 10 YES (Alice) / 10 NO (Bob)

        uint256 shieldBefore = address(shield).balance;
        uint256 treasuryBefore = treasury.balance;

        (uint256 endTime,,,,) = _market(marketId);
        vm.warp(endTime);

        // fee split: 10 MON losing pool -> 0.25 fee -> 0.15 shield / 0.10 treasury
        vm.expectEmit(true, false, false, true, address(pm));
        emit MarketResolved(marketId, 1, 0.15 ether, 0.10 ether);
        pm.resolveMarket(marketId, 1);

        assertEq(address(shield).balance - shieldBefore, 0.15 ether);
        assertEq(treasury.balance - treasuryBefore, 0.10 ether);

        (, uint256 yesAmount, uint256 noAmount, bool resolved, uint8 outcome) = _market(marketId);
        assertTrue(resolved);
        assertEq(outcome, 1);
        assertEq(yesAmount + noAmount, 20 ether);

        // Alice (YES) wins the whole 20 MON pot minus the 0.25 MON rake = 19.75 MON
        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        vm.expectEmit(true, true, false, true, address(pm));
        emit WinningsClaimed(marketId, alice, 19.75 ether);
        pm.claimWinnings(marketId);
        assertEq(alice.balance - aliceBefore, 19.75 ether);

        // double claim blocked
        vm.prank(alice);
        vm.expectRevert("Already claimed");
        pm.claimWinnings(marketId);

        // Bob (NO) loses: no payout, but his 10 MON loss is recorded on the shield
        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        pm.claimWinnings(marketId);
        assertEq(bob.balance, bobBefore);
        assertEq(shield.userRecordedLosses(bob), BET);

        // market is fully drained: pot - fee = what Alice took
        assertEq(address(pm).balance, 0);
    }

    // ── c ──

    function test_ShieldClaimGate() public {
        // Bob books a real loss first so only the NFT gate can be what stops him
        uint256 marketId = _openTwoSidedMarket();
        _resolveAfterEnd(marketId, 1); // YES wins, Bob loses 10 MON

        vm.prank(bob);
        pm.claimWinnings(marketId);
        assertEq(shield.userRecordedLosses(bob), BET);
        assertEq(nft.balanceOf(bob), 0);

        vm.prank(bob);
        vm.expectRevert("No Chog NFT");
        shield.claimBailout();

        // Alice passes the gate (she holds the NFT), so the gate is what differs
        vm.prank(alice);
        vm.expectRevert("No loss to claim"); // Alice won, nothing recorded
        shield.claimBailout();
    }

    // ── d ──

    function test_ShieldBailoutSuccessAndCooldown() public {
        // Alice bets NO and loses 10 MON
        uint256 marketId = pm.createMarket("Alice's losing market?", 1 days);
        vm.prank(alice);
        pm.placeBet{value: BET}(marketId, false);
        vm.prank(bob);
        pm.placeBet{value: BET}(marketId, true);
        _resolveAfterEnd(marketId, 1);

        vm.prank(alice);
        pm.claimWinnings(marketId); // records Alice's loss, pays her nothing
        assertEq(shield.userRecordedLosses(alice), BET);

        // top the shield up (accumulated historical rake) so 20% isn't clamped:
        // rebate 2.0 MON vs. only the 0.15 MON this market raked in
        vm.deal(address(shield), address(shield).balance + 10 ether);

        uint256 aliceBefore = alice.balance;
        uint256 shieldBefore = address(shield).balance;

        vm.prank(alice);
        vm.expectEmit(true, false, false, true, address(shield));
        emit BailoutClaimed(alice, 2 ether);
        shield.claimBailout();

        assertEq(alice.balance - aliceBefore, 2 ether); // 20% of 10 MON
        assertEq(shieldBefore - address(shield).balance, 2 ether);
        assertEq(shield.userRecordedLosses(alice), 0);
        assertEq(shield.lastClaimTimestamp(alice), block.timestamp);

        vm.prank(alice);
        vm.expectRevert("Cooldown active");
        shield.claimBailout();

        // after the 7-day cooldown the rebate is empty, so it fails on "No loss"
        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        vm.expectRevert("No loss to claim");
        shield.claimBailout();
    }

    // ── e ──

    function test_ShieldSolvencyClamping() public {
        // Alice loses 10 MON -> theoretical rebate 2.0 MON
        uint256 marketId = pm.createMarket("Clamp market?", 1 days);
        vm.prank(alice);
        pm.placeBet{value: BET}(marketId, false);
        vm.prank(bob);
        pm.placeBet{value: BET}(marketId, true);
        _resolveAfterEnd(marketId, 1);

        vm.prank(alice);
        pm.claimWinnings(marketId);
        assertEq(shield.userRecordedLosses(alice), BET);

        // shield only holds this market's 0.15 MON rake — less than the 2.0 MON rebate
        uint256 shieldBalance = address(shield).balance;
        assertEq(shieldBalance, 0.15 ether);

        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        shield.claimBailout(); // must not revert

        uint256 received = alice.balance - aliceBefore;
        assertEq(received, shieldBalance); // clamped to remaining pool balance
        assertLt(received, 2 ether); // below the uncapped 20% rebate
        assertEq(address(shield).balance, 0);
        assertEq(shield.userRecordedLosses(alice), 0);
        assertEq(shield.lastClaimTimestamp(alice), block.timestamp);

        // pool is empty now: book another loss (as the authorized market) and a later
        // rebate request can't pay anything — clamps to 0 and reverts cleanly
        vm.prank(address(pm));
        shield.recordLoss(alice, 5 ether);
        assertEq(address(shield).balance, 0);

        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        vm.expectRevert("No loss to claim");
        shield.claimBailout();
    }

    // ── authorization / access control ──

    function test_RecordLoss_RevertsForNonMarket() public {
        vm.expectRevert("not market");
        shield.recordLoss(alice, 1 ether);
    }

    function test_SetAuthorizedMarket_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        shield.setAuthorizedMarket(alice);
    }
}
