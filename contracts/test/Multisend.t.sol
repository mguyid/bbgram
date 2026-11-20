// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {BabyGrandMultisend} from "../src/Multisend.sol";
import {BabyGrandToken} from "../src/Token.sol";

contract MultisendTest is Test {
    BabyGrandToken token;
    BabyGrandMultisend multisend;
    address treasury = makeAddr("treasury");
    address owner = makeAddr("owner");
    address pair = makeAddr("pair");

    function setUp() public {
        token = new BabyGrandToken("Baby Grand", "BBGRAM", treasury, owner);
        multisend = new BabyGrandMultisend();
    }

    function _batch(uint256 n) internal returns (address[] memory to, uint256[] memory amounts, uint256 total) {
        to = new address[](n);
        amounts = new uint256[](n);
        for (uint256 i = 0; i < n; ++i) {
            to[i] = makeAddr(string.concat("buyer", vm.toString(i)));
            amounts[i] = (i + 1) * 1e18;
            total += amounts[i];
        }
    }

    function test_SendsEachAmountFromCaller() public {
        (address[] memory to, uint256[] memory amounts, uint256 total) = _batch(3);
        vm.startPrank(treasury);
        token.approve(address(multisend), total);
        multisend.send(IERC20(address(token)), to, amounts);
        vm.stopPrank();
        for (uint256 i = 0; i < 3; ++i) {
            assertEq(token.balanceOf(to[i]), amounts[i]);
        }
        assertEq(token.balanceOf(treasury), token.TOTAL_SUPPLY() - total);
        assertEq(token.balanceOf(address(multisend)), 0);
        assertEq(token.allowance(treasury, address(multisend)), 0);
    }

    function test_BatchOf150FitsInABlock() public {
        (address[] memory to, uint256[] memory amounts, uint256 total) = _batch(150);
        vm.startPrank(treasury);
        token.approve(address(multisend), total);
        uint256 gasBefore = gasleft();
        multisend.send(IERC20(address(token)), to, amounts);
        uint256 used = gasBefore - gasleft();
        vm.stopPrank();
        assertEq(token.balanceOf(to[149]), 150e18);
        assertLt(used, 6_000_000); // well under the BSC block gas limit
    }

    function test_NotTaxedEvenWithAnAmmPair() public {
        // transfers are wallet-to-wallet, so buy/sell tax never applies
        vm.startPrank(owner);
        token.setAmmPair(pair, true);
        token.setBuyTax(500);
        token.setSellTax(500);
        vm.stopPrank();
        (address[] memory to, uint256[] memory amounts, uint256 total) = _batch(2);
        vm.startPrank(treasury);
        token.approve(address(multisend), total);
        multisend.send(IERC20(address(token)), to, amounts);
        vm.stopPrank();
        assertEq(token.balanceOf(to[0]), amounts[0]);
        assertEq(token.balanceOf(to[1]), amounts[1]);
    }

    function test_RevertsOnLengthMismatch() public {
        address[] memory to = new address[](2);
        uint256[] memory amounts = new uint256[](1);
        vm.expectRevert(BabyGrandMultisend.LengthMismatch.selector);
        multisend.send(IERC20(address(token)), to, amounts);
    }

    function test_RevertsWithoutAllowanceAndMovesNothing() public {
        (address[] memory to, uint256[] memory amounts, uint256 total) = _batch(3);
        vm.startPrank(treasury);
        token.approve(address(multisend), total - 1);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(multisend), 3e18 - 1, 3e18)
        );
        multisend.send(IERC20(address(token)), to, amounts);
        vm.stopPrank();
        assertEq(token.balanceOf(to[0]), 0);
        assertEq(token.balanceOf(treasury), token.TOTAL_SUPPLY());
    }

    function test_CannotSpendSomeoneElsesTokens() public {
        vm.prank(treasury);
        token.approve(address(multisend), 1e18);
        address[] memory to = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        to[0] = makeAddr("thief");
        amounts[0] = 1e18;
        vm.prank(makeAddr("thief"));
        vm.expectRevert();
        multisend.send(IERC20(address(token)), to, amounts);
        assertEq(token.balanceOf(to[0]), 0);
    }

    function testFuzz_Send(uint8 n, uint96 seed) public {
        n = uint8(bound(n, 0, 40));
        address[] memory to = new address[](n);
        uint256[] memory amounts = new uint256[](n);
        uint256 total;
        for (uint256 i = 0; i < n; ++i) {
            to[i] = address(uint160(uint256(keccak256(abi.encode(seed, i))) | 1));
            amounts[i] = uint256(keccak256(abi.encode(i, seed))) % 1000e18;
            total += amounts[i];
        }
        vm.startPrank(treasury);
        token.approve(address(multisend), total);
        multisend.send(IERC20(address(token)), to, amounts);
        vm.stopPrank();
        assertEq(token.balanceOf(treasury), token.TOTAL_SUPPLY() - total);
    }
}
