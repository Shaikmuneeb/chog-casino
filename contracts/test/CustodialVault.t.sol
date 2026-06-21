// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {CustodialVault} from "../src/CustodialVault.sol";

contract CustodialVaultTest is Test {
    address admin = address(0xA11CE);
    address operator = address(0x0DE7A7012);
    address player = address(0xB0B);
    address stranger = address(0xE4E);
    address constant NATIVE = address(0);

    CustodialVault vault;

    function setUp() public {
        vault = new CustodialVault(admin);

        bytes32 operatorRole = vault.OPERATOR_ROLE();
        vm.prank(admin);
        vault.grantRole(operatorRole, operator);

        vm.deal(address(vault), 1_000 ether);
    }

    function test_OperatorCanCredit() public {
        vm.prank(operator);
        vault.credit(player, NATIVE, 10 ether, bytes32("sweep-1"));

        assertEq(vault.balanceOf(player, NATIVE), 10 ether);
    }

    function test_NonOperatorCannotCredit() public {
        vm.prank(stranger);
        vm.expectRevert();
        vault.credit(player, NATIVE, 10 ether, bytes32("sweep-1"));
    }

    function test_AdminCannotCreditWithoutOperatorRole() public {
        // ADMIN_ROLE alone (without OPERATOR_ROLE) must not be sufficient to credit balances —
        // crediting is a distinct, narrower privilege than general admin control.
        vm.prank(admin);
        vm.expectRevert();
        vault.credit(player, NATIVE, 10 ether, bytes32("sweep-1"));
    }

    function test_PlayerCanWithdrawOwnCreditedBalance() public {
        vm.prank(operator);
        vault.credit(player, NATIVE, 10 ether, bytes32("sweep-1"));

        uint256 before = player.balance;
        vm.prank(player);
        vault.withdraw(NATIVE, 4 ether);

        assertEq(player.balance, before + 4 ether);
        assertEq(vault.balanceOf(player, NATIVE), 6 ether);
    }

    function test_WithdrawRevertsIfInsufficientBalance() public {
        vm.prank(operator);
        vault.credit(player, NATIVE, 5 ether, bytes32("sweep-1"));

        vm.prank(player);
        vm.expectRevert("insufficient balance");
        vault.withdraw(NATIVE, 6 ether);
    }

    function test_OperatorCanDebit() public {
        vm.prank(operator);
        vault.credit(player, NATIVE, 10 ether, bytes32("sweep-1"));

        vm.prank(operator);
        vault.debit(player, NATIVE, 4 ether, bytes32("bet-1"));

        assertEq(vault.balanceOf(player, NATIVE), 6 ether);
    }

    function test_DebitDoesNotMoveAnyTokens() public {
        // debit() is pure accounting — the operator's own wallet fronts the actual bet, so the
        // vault's real token balance must be untouched by a debit.
        vm.prank(operator);
        vault.credit(player, NATIVE, 10 ether, bytes32("sweep-1"));
        uint256 vaultBalBefore = vault.getBalance(NATIVE);

        vm.prank(operator);
        vault.debit(player, NATIVE, 4 ether, bytes32("bet-1"));

        assertEq(vault.getBalance(NATIVE), vaultBalBefore);
    }

    function test_NonOperatorCannotDebit() public {
        vm.prank(operator);
        vault.credit(player, NATIVE, 10 ether, bytes32("sweep-1"));

        vm.prank(stranger);
        vm.expectRevert();
        vault.debit(player, NATIVE, 1 ether, bytes32("bet-1"));
    }

    function test_DebitRevertsIfInsufficientBalance() public {
        vm.prank(operator);
        vault.credit(player, NATIVE, 5 ether, bytes32("sweep-1"));

        vm.prank(operator);
        vm.expectRevert("insufficient balance");
        vault.debit(player, NATIVE, 6 ether, bytes32("bet-1"));
    }

    function test_PauseBlocksDebit() public {
        vm.prank(operator);
        vault.credit(player, NATIVE, 10 ether, bytes32("sweep-1"));

        vm.prank(admin);
        vault.pause();

        vm.prank(operator);
        vm.expectRevert();
        vault.debit(player, NATIVE, 1 ether, bytes32("bet-1"));
    }

    function test_CannotWithdrawAnotherPlayersBalance() public {
        vm.prank(operator);
        vault.credit(player, NATIVE, 10 ether, bytes32("sweep-1"));

        // stranger has no credited balance of their own, so any withdrawal attempt reverts —
        // msg.sender is always who gets paid AND whose balance is debited, never an argument.
        vm.prank(stranger);
        vm.expectRevert("insufficient balance");
        vault.withdraw(NATIVE, 1 ether);

        assertEq(vault.balanceOf(player, NATIVE), 10 ether);
    }

    function test_PauseBlocksCreditAndWithdraw() public {
        vm.prank(operator);
        vault.credit(player, NATIVE, 10 ether, bytes32("sweep-1"));

        vm.prank(admin);
        vault.pause();

        vm.prank(operator);
        vm.expectRevert();
        vault.credit(player, NATIVE, 1 ether, bytes32("sweep-2"));

        vm.prank(player);
        vm.expectRevert();
        vault.withdraw(NATIVE, 1 ether);

        vm.prank(admin);
        vault.unpause();

        vm.prank(player);
        vault.withdraw(NATIVE, 1 ether);
        assertEq(vault.balanceOf(player, NATIVE), 9 ether);
    }

    function test_AdminWithdrawDoesNotTouchPlayerAccounting() public {
        vm.prank(operator);
        vault.credit(player, NATIVE, 10 ether, bytes32("sweep-1"));

        uint256 vaultBalBefore = vault.getBalance(NATIVE);
        vm.prank(admin);
        vault.adminWithdraw(NATIVE, 5 ether, admin);

        // Player's tracked balance is unaffected by an admin sweep-out of unbacked funds.
        assertEq(vault.balanceOf(player, NATIVE), 10 ether);
        assertEq(vault.getBalance(NATIVE), vaultBalBefore - 5 ether);
    }
}
