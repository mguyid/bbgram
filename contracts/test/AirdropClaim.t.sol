// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {BabyGrandAirdrop} from "../src/AirdropClaim.sol";
import {BabyGrandToken} from "../src/Token.sol";
import {MerkleHelper} from "./MerkleHelper.sol";

contract AirdropClaimTest is Test {
    event Claimed(address indexed account, uint256 amount);

    BabyGrandToken token;
    BabyGrandAirdrop airdrop;
    address owner = makeAddr("owner");
    address to = makeAddr("to");
    uint64 deadline;

    address[5] accounts;
    uint256[5] amounts;
    bytes32[] leaves;

    function setUp() public {
        token = new BabyGrandToken("Baby Grand", "BGRAND", owner, owner);
        for (uint256 i = 0; i < 5; i++) {
            accounts[i] = makeAddr(string(abi.encodePacked("user", vm.toString(i))));
            amounts[i] = (i + 1) * 100e18;
            leaves.push(MerkleHelper.leaf(accounts[i], amounts[i]));
        }
        deadline = uint64(block.timestamp + 30 days);
        airdrop = new BabyGrandAirdrop(address(token), owner);
        vm.startPrank(owner);
        airdrop.setRoot(MerkleHelper.root(leaves));
        airdrop.setDeadline(deadline);
        token.transfer(address(airdrop), 1_500e18); // exact total
        vm.stopPrank();
    }

    function _claim(uint256 i) internal {
        bytes32[] memory p = MerkleHelper.proof(leaves, i);
        vm.prank(accounts[i]);
        airdrop.claim(amounts[i], p);
    }

    // ------------------------------------------------------------ constructor / setters

    function test_Constructor() public {
        BabyGrandAirdrop a = new BabyGrandAirdrop(address(token), owner);
        assertEq(address(a.token()), address(token));
        assertEq(a.merkleRoot(), bytes32(0));
        assertEq(a.deadline(), 0);
        assertEq(a.owner(), owner);
    }

    function test_ConstructorRejectsZeroToken() public {
        vm.expectRevert(BabyGrandAirdrop.ZeroAddress.selector);
        new BabyGrandAirdrop(address(0), owner);
    }

    function test_SetRootAndDeadline() public view {
        assertEq(airdrop.merkleRoot(), MerkleHelper.root(leaves));
        assertEq(airdrop.deadline(), deadline);
    }

    function test_SetRootReplacesRoot() public {
        bytes32[] memory other = new bytes32[](2);
        other[0] = MerkleHelper.leaf(accounts[0], 1e18);
        other[1] = MerkleHelper.leaf(accounts[1], 2e18);
        vm.prank(owner);
        airdrop.setRoot(MerkleHelper.root(other));
        assertEq(airdrop.merkleRoot(), MerkleHelper.root(other));

        bytes32[] memory p = MerkleHelper.proof(leaves, 0);
        vm.prank(accounts[0]);
        vm.expectRevert(BabyGrandAirdrop.InvalidProof.selector);
        airdrop.claim(amounts[0], p);

        p = MerkleHelper.proof(other, 0);
        vm.prank(accounts[0]);
        airdrop.claim(1e18, p);
        assertEq(token.balanceOf(accounts[0]), 1e18);
    }

    function test_ClaimBeforeRootReverts() public {
        BabyGrandAirdrop a = new BabyGrandAirdrop(address(token), owner);
        bytes32[] memory p = MerkleHelper.proof(leaves, 0);
        vm.prank(accounts[0]);
        vm.expectRevert(BabyGrandAirdrop.RootNotSet.selector);
        a.claim(amounts[0], p);
    }

    function test_SettersOnlyOwner() public {
        bytes memory err = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, accounts[0]);
        vm.startPrank(accounts[0]);
        vm.expectRevert(err);
        airdrop.setRoot(bytes32(uint256(1)));
        vm.expectRevert(err);
        airdrop.setDeadline(1);
        vm.expectRevert(err);
        airdrop.recover(accounts[0]);
        vm.expectRevert(err);
        airdrop.transferOwnership(accounts[0]);
        vm.stopPrank();
    }

    function test_Ownable2Step() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(owner);
        airdrop.transferOwnership(newOwner);
        assertEq(airdrop.owner(), owner);
        assertEq(airdrop.pendingOwner(), newOwner);
        vm.prank(accounts[0]);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, accounts[0]));
        airdrop.acceptOwnership();
        vm.prank(newOwner);
        airdrop.acceptOwnership();
        assertEq(airdrop.owner(), newOwner);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        airdrop.setDeadline(1);
        vm.prank(newOwner);
        airdrop.setDeadline(1);
    }

    // ------------------------------------------------------------ claim

    function test_AllClaim() public {
        for (uint256 i = 0; i < 5; i++) {
            vm.expectEmit(true, false, false, true, address(airdrop));
            emit Claimed(accounts[i], amounts[i]);
            _claim(i);
            assertEq(token.balanceOf(accounts[i]), amounts[i]);
            assertTrue(airdrop.claimed(accounts[i]));
        }
        assertEq(token.balanceOf(address(airdrop)), 0);
    }

    function test_DoubleClaimReverts() public {
        _claim(2);
        bytes32[] memory p = MerkleHelper.proof(leaves, 2);
        vm.prank(accounts[2]);
        vm.expectRevert(BabyGrandAirdrop.AlreadyClaimed.selector);
        airdrop.claim(amounts[2], p);
    }

    function test_WrongAmountReverts() public {
        bytes32[] memory p = MerkleHelper.proof(leaves, 1);
        vm.prank(accounts[1]);
        vm.expectRevert(BabyGrandAirdrop.InvalidProof.selector);
        airdrop.claim(amounts[1] + 1, p);
    }

    function test_WrongSenderReverts() public {
        bytes32[] memory p = MerkleHelper.proof(leaves, 1);
        vm.prank(accounts[0]);
        vm.expectRevert(BabyGrandAirdrop.InvalidProof.selector);
        airdrop.claim(amounts[1], p);
    }

    function test_ClaimAfterDeadlineReverts() public {
        bytes32[] memory p = MerkleHelper.proof(leaves, 0);
        vm.warp(uint256(deadline) + 1);
        vm.prank(accounts[0]);
        vm.expectRevert(BabyGrandAirdrop.ClaimEnded.selector);
        airdrop.claim(amounts[0], p);
    }

    function test_ClaimAtDeadline() public {
        vm.warp(deadline);
        _claim(0);
    }

    function test_DeadlineZeroMeansNoDeadline() public {
        vm.prank(owner);
        airdrop.setDeadline(0);
        vm.warp(uint256(deadline) + 365 days);
        _claim(0);
        assertEq(token.balanceOf(accounts[0]), amounts[0]);
    }

    function test_ExtendDeadlineReopensClaim() public {
        vm.warp(uint256(deadline) + 1);
        vm.prank(owner);
        airdrop.setDeadline(deadline + 10 days);
        _claim(0);
    }

    // ------------------------------------------------------------ recover

    function test_RecoverOnlyAfterDeadline() public {
        _claim(0);
        vm.prank(owner);
        vm.expectRevert(BabyGrandAirdrop.DeadlineNotReached.selector);
        airdrop.recover(to);

        vm.warp(deadline);
        vm.prank(owner);
        vm.expectRevert(BabyGrandAirdrop.DeadlineNotReached.selector);
        airdrop.recover(to);

        vm.warp(uint256(deadline) + 1);
        vm.prank(owner);
        airdrop.recover(to);
        assertEq(token.balanceOf(to), 1_400e18);
        assertEq(token.balanceOf(address(airdrop)), 0);
    }

    function test_RecoverRevertsWithoutDeadline() public {
        vm.prank(owner);
        airdrop.setDeadline(0);
        vm.warp(uint256(deadline) + 365 days);
        vm.prank(owner);
        vm.expectRevert(BabyGrandAirdrop.DeadlineNotReached.selector);
        airdrop.recover(to);
    }

    function test_RecoverRejectsZeroAddress() public {
        vm.warp(uint256(deadline) + 1);
        vm.prank(owner);
        vm.expectRevert(BabyGrandAirdrop.ZeroAddress.selector);
        airdrop.recover(address(0));
    }

    function testFuzz_ClaimWindow(uint64 deadline_, uint256 warpTo) public {
        warpTo = bound(warpTo, block.timestamp, type(uint64).max);
        vm.prank(owner);
        airdrop.setDeadline(deadline_);
        vm.warp(warpTo);
        bool open = deadline_ == 0 || warpTo <= deadline_;
        bytes32[] memory p = MerkleHelper.proof(leaves, 3);
        vm.prank(accounts[3]);
        if (!open) vm.expectRevert(BabyGrandAirdrop.ClaimEnded.selector);
        airdrop.claim(amounts[3], p);
        assertEq(token.balanceOf(accounts[3]), open ? amounts[3] : 0);
    }
}
