// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {BabyGrandToken} from "../src/Token.sol";

contract TokenTest is Test {
    BabyGrandToken token;
    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address taxWallet = makeAddr("taxWallet");
    address pair = makeAddr("pair");
    address router = makeAddr("router");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        token = new BabyGrandToken("Baby Grand", "BGRAND", treasury, owner);
        vm.startPrank(owner);
        token.setTaxWallet(taxWallet);
        token.setAmmPair(pair, true);
        token.setBuyTax(300); // 3%
        token.setSellTax(500); // 5%
        vm.stopPrank();
        vm.startPrank(treasury);
        token.transfer(pair, 1_000_000e18);
        token.transfer(alice, 1_000_000e18);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ supply

    function test_SupplyMintedToTreasury() public {
        BabyGrandToken t = new BabyGrandToken("Baby Grand", "BGRAND", treasury, owner);
        assertEq(t.totalSupply(), 10_000_000e18);
        assertEq(t.balanceOf(treasury), 10_000_000e18);
        assertEq(t.decimals(), 18);
        assertEq(t.name(), "Baby Grand");
        assertEq(t.symbol(), "BGRAND");
        assertEq(t.owner(), owner);
        assertEq(t.treasury(), treasury);
        assertEq(t.taxWallet(), treasury);
        assertEq(t.buyTaxBps(), 0);
        assertEq(t.sellTaxBps(), 0);
    }

    function test_DefaultExemptions() public view {
        assertTrue(token.isTaxExempt(owner));
        assertTrue(token.isTaxExempt(treasury));
        assertTrue(token.isTaxExempt(address(token)));
        assertFalse(token.isTaxExempt(alice));
    }

    function test_ConstructorRejectsZeroTreasury() public {
        vm.expectRevert(BabyGrandToken.ZeroAddress.selector);
        new BabyGrandToken("a", "b", address(0), owner);
    }

    // ------------------------------------------------------------ tax

    function test_WalletToWalletNoTax() public {
        vm.prank(alice);
        token.transfer(bob, 1000e18);
        assertEq(token.balanceOf(bob), 1000e18);
        assertEq(token.balanceOf(taxWallet), 0);
    }

    function test_BuyTaxed() public {
        vm.prank(pair);
        token.transfer(bob, 1000e18);
        assertEq(token.balanceOf(bob), 970e18);
        assertEq(token.balanceOf(taxWallet), 30e18);
    }

    function test_SellTaxed() public {
        vm.prank(alice);
        token.transfer(pair, 1000e18);
        assertEq(token.balanceOf(pair), 1_000_000e18 + 950e18);
        assertEq(token.balanceOf(taxWallet), 50e18);
    }

    function test_SellViaTransferFromTaxed() public {
        vm.prank(alice);
        token.approve(router, 1000e18);
        vm.prank(router);
        token.transferFrom(alice, pair, 1000e18);
        assertEq(token.balanceOf(taxWallet), 50e18);
        assertEq(token.allowance(alice, router), 0);
    }

    function test_ExemptBuyerAndSellerNotTaxed() public {
        vm.prank(owner);
        token.setTaxExempt(alice, true);
        vm.prank(alice);
        token.transfer(pair, 1000e18);
        vm.prank(pair);
        token.transfer(alice, 1000e18);
        assertEq(token.balanceOf(taxWallet), 0);
        assertEq(token.balanceOf(alice), 1_000_000e18);
    }

    function test_TreasuryToPairNotTaxed() public {
        vm.prank(treasury);
        token.transfer(pair, 1000e18);
        assertEq(token.balanceOf(taxWallet), 0);
    }

    function test_ExemptPairNotTaxed() public {
        vm.prank(owner);
        token.setTaxExempt(pair, true);
        vm.prank(pair);
        token.transfer(bob, 1000e18);
        assertEq(token.balanceOf(bob), 1000e18);
    }

    function test_RemovedPairNotTaxed() public {
        vm.prank(owner);
        token.setAmmPair(pair, false);
        vm.prank(pair);
        token.transfer(bob, 1000e18);
        assertEq(token.balanceOf(bob), 1000e18);
    }

    function test_FullTax() public {
        vm.prank(owner);
        token.setSellTax(10_000);
        vm.prank(alice);
        token.transfer(pair, 1000e18);
        assertEq(token.balanceOf(taxWallet), 1000e18);
    }

    function testFuzz_TaxMath(uint256 amount, uint256 buyBps, uint256 sellBps, bool isBuy) public {
        amount = bound(amount, 0, 1_000_000e18);
        buyBps = bound(buyBps, 0, 10_000);
        sellBps = bound(sellBps, 0, 10_000);
        vm.startPrank(owner);
        token.setBuyTax(buyBps);
        token.setSellTax(sellBps);
        vm.stopPrank();

        address from = isBuy ? pair : alice;
        address to = isBuy ? bob : pair;
        uint256 bps = isBuy ? buyBps : sellBps;
        uint256 expectedTax = amount * bps / 10_000;
        uint256 fromBefore = token.balanceOf(from);
        uint256 toBefore = token.balanceOf(to);

        vm.prank(from);
        token.transfer(to, amount);

        assertEq(token.balanceOf(taxWallet), expectedTax);
        assertEq(token.balanceOf(from), fromBefore - amount);
        assertEq(token.balanceOf(to), toBefore + amount - expectedTax);
        assertEq(token.totalSupply(), 10_000_000e18);
    }

    function testFuzz_NoTaxBetweenWallets(uint256 amount, uint256 bps) public {
        amount = bound(amount, 0, 1_000_000e18);
        bps = bound(bps, 0, 10_000);
        vm.startPrank(owner);
        token.setBuyTax(bps);
        token.setSellTax(bps);
        vm.stopPrank();
        vm.prank(alice);
        token.transfer(bob, amount);
        assertEq(token.balanceOf(bob), amount);
        assertEq(token.balanceOf(taxWallet), 0);
    }

    // ------------------------------------------------------------ setters

    function test_Setters() public {
        address newTax = makeAddr("newTax");
        vm.startPrank(owner);
        token.setBuyTax(10_000);
        token.setSellTax(0);
        token.setTaxWallet(newTax);
        token.setSocials("https://t.me/babygrand");
        token.setTaxExempt(bob, true);
        token.setAmmPair(bob, true);
        vm.stopPrank();
        assertEq(token.buyTaxBps(), 10_000);
        assertEq(token.sellTaxBps(), 0);
        assertEq(token.taxWallet(), newTax);
        assertEq(token.socials(), "https://t.me/babygrand");
        assertTrue(token.isTaxExempt(bob));
        assertTrue(token.isAmmPair(bob));
    }

    function test_SetterBounds() public {
        vm.startPrank(owner);
        vm.expectRevert(BabyGrandToken.TaxTooHigh.selector);
        token.setBuyTax(10_001);
        vm.expectRevert(BabyGrandToken.TaxTooHigh.selector);
        token.setSellTax(10_001);
        vm.expectRevert(BabyGrandToken.ZeroAddress.selector);
        token.setTaxWallet(address(0));
        vm.stopPrank();
    }

    function test_SettersOnlyOwner() public {
        bytes memory err = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice);
        vm.startPrank(alice);
        vm.expectRevert(err);
        token.setBuyTax(1);
        vm.expectRevert(err);
        token.setSellTax(1);
        vm.expectRevert(err);
        token.setTaxWallet(alice);
        vm.expectRevert(err);
        token.setSocials("x");
        vm.expectRevert(err);
        token.setTaxExempt(alice, true);
        vm.expectRevert(err);
        token.setAmmPair(alice, true);
        vm.expectRevert(err);
        token.transferOwnership(alice);
        vm.stopPrank();
    }

    function test_Ownable2Step() public {
        vm.prank(owner);
        token.transferOwnership(bob);
        assertEq(token.owner(), owner);
        assertEq(token.pendingOwner(), bob);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        token.acceptOwnership();

        vm.prank(bob);
        token.acceptOwnership();
        assertEq(token.owner(), bob);
        assertEq(token.pendingOwner(), address(0));

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        token.setBuyTax(1);
        vm.prank(bob);
        token.setBuyTax(1);
    }
}
