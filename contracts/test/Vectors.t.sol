// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {MerkleHelper} from "./MerkleHelper.sol";

/// @notice Pins cross-language Merkle vectors for the API. Writes test/vectors.json.
contract VectorsTest is Test {
    address constant A = 0x1111111111111111111111111111111111111111;
    address constant B = 0x2222222222222222222222222222222222222222;
    uint256 constant AMOUNT_A = 100e18;
    uint256 constant AMOUNT_B = 200e18;

    // Pinned results (cross-checked with `cast`). If these change, the API must change too.
    bytes32 constant LEAF_A = 0x923a571f712ff2d205bc7da76152ab30459ae47d04647ff145ba9ad746468fc6;
    bytes32 constant LEAF_B = 0x2769202b8c373ddf6a1c9e7e5f6bd2a3afb327e36f8214802c6820e2dde14f6b;
    bytes32 constant ROOT = 0x7e25c5ca3fff607b23aedc621186d516177aaa27d28fab2dcb329bf099b006f4;

    function test_Vectors() public {
        // ---- Merkle
        bytes32[] memory leaves = new bytes32[](2);
        leaves[0] = MerkleHelper.leaf(A, AMOUNT_A);
        leaves[1] = MerkleHelper.leaf(B, AMOUNT_B);
        bytes32 root = MerkleHelper.root(leaves);
        bytes32[] memory proofA = MerkleHelper.proof(leaves, 0);
        bytes32[] memory proofB = MerkleHelper.proof(leaves, 1);
        assertTrue(MerkleProof.verify(proofA, root, leaves[0]));
        assertTrue(MerkleProof.verify(proofB, root, leaves[1]));
        assertEq(leaves[0], LEAF_A);
        assertEq(leaves[1], LEAF_B);
        assertEq(root, ROOT);
        assertEq(proofA.length, 1);
        assertEq(proofA[0], LEAF_B);
        assertEq(proofB.length, 1);
        assertEq(proofB[0], LEAF_A);

        console2.log("leafA");
        console2.logBytes32(leaves[0]);
        console2.log("leafB");
        console2.logBytes32(leaves[1]);
        console2.log("root");
        console2.logBytes32(root);

        // ---- write vectors.json
        string memory m = "merkle";
        vm.serializeString(m, "leaf_encoding", "keccak256(bytes.concat(keccak256(abi.encode(address,uint256))))");
        vm.serializeString(m, "pair_hashing", "keccak256(abi.encodePacked(min(a,b), max(a,b)))");
        vm.serializeAddress(m, "account_a", A);
        vm.serializeString(m, "amount_a_wei", vm.toString(AMOUNT_A));
        vm.serializeAddress(m, "account_b", B);
        vm.serializeString(m, "amount_b_wei", vm.toString(AMOUNT_B));
        vm.serializeBytes32(m, "leaf_a", leaves[0]);
        vm.serializeBytes32(m, "leaf_b", leaves[1]);
        vm.serializeBytes32(m, "proof_a", proofA);
        vm.serializeBytes32(m, "proof_b", proofB);
        string memory merkleJson = vm.serializeBytes32(m, "root", root);

        string memory root_ = "root";
        string memory json = vm.serializeString(root_, "merkle", merkleJson);
        vm.writeJson(json, "./test/vectors.json");
    }
}
