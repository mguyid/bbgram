// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {BabyGrandPresale} from "../src/Presale.sol";
import {MerkleHelper} from "./MerkleHelper.sol";

/// @notice Pins cross-language vectors (Merkle + EIP-712) for the API. Writes test/vectors.json.
contract VectorsTest is Test {
    address constant A = 0x1111111111111111111111111111111111111111;
    address constant B = 0x2222222222222222222222222222222222222222;
    uint256 constant AMOUNT_A = 100e18;
    uint256 constant AMOUNT_B = 200e18;

    uint256 constant CHAIN_ID = 97;
    address constant PRESALE = 0x3333333333333333333333333333333333333333;
    address constant WALLET = 0x1111111111111111111111111111111111111111;
    uint256 constant MAX_ALLOCATION = 2500e18;
    // Anvil default account #0 (public test key, never use for real funds).
    uint256 constant SIGNER_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    // Pinned results (cross-checked with `cast`). If these change, the API must change too.
    bytes32 constant LEAF_A = 0x923a571f712ff2d205bc7da76152ab30459ae47d04647ff145ba9ad746468fc6;
    bytes32 constant LEAF_B = 0x2769202b8c373ddf6a1c9e7e5f6bd2a3afb327e36f8214802c6820e2dde14f6b;
    bytes32 constant ROOT = 0x7e25c5ca3fff607b23aedc621186d516177aaa27d28fab2dcb329bf099b006f4;
    bytes32 constant DIGEST = 0xa16b357c870e2bb0138b11c76a5cc442e3240f2647b6d269b18700250920c89b;
    bytes constant SIGNATURE =
        hex"951591c6829c7ab5a14a122973588ce96176dc1fff38864fee3615fbfd8008372f8265015d79356cfadd924dc74ecd998a72d3cc69388a1e8bff047eabc2a9711c";

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

        // ---- EIP-712
        vm.chainId(CHAIN_ID);
        deployCodeTo("Presale.sol:BabyGrandPresale", abi.encode(address(0xdead), address(this)), PRESALE);
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("BabyGrandPresale"),
                keccak256("1"),
                CHAIN_ID,
                PRESALE
            )
        );
        bytes32 structHash =
            keccak256(abi.encode(keccak256("Whitelist(address wallet,uint256 maxAllocation)"), WALLET, MAX_ALLOCATION));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        assertEq(BabyGrandPresale(PRESALE).whitelistDigest(WALLET, MAX_ALLOCATION), digest);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        assertEq(digest, DIGEST);
        assertEq(signature, SIGNATURE);

        console2.log("leafA");
        console2.logBytes32(leaves[0]);
        console2.log("leafB");
        console2.logBytes32(leaves[1]);
        console2.log("root");
        console2.logBytes32(root);
        console2.log("domainSeparator");
        console2.logBytes32(domainSeparator);
        console2.log("digest");
        console2.logBytes32(digest);
        console2.log("signature");
        console2.logBytes(signature);

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

        string memory e = "eip712";
        vm.serializeString(e, "domain_name", "BabyGrandPresale");
        vm.serializeString(e, "domain_version", "1");
        vm.serializeUint(e, "chain_id", CHAIN_ID);
        vm.serializeAddress(e, "verifying_contract", PRESALE);
        vm.serializeString(e, "type", "Whitelist(address wallet,uint256 maxAllocation)");
        vm.serializeAddress(e, "wallet", WALLET);
        vm.serializeString(e, "max_allocation_wei", vm.toString(MAX_ALLOCATION));
        vm.serializeBytes32(e, "domain_separator", domainSeparator);
        vm.serializeBytes32(e, "struct_hash", structHash);
        vm.serializeBytes32(e, "digest", digest);
        vm.serializeBytes32(e, "signer_private_key", bytes32(SIGNER_KEY));
        vm.serializeAddress(e, "signer_address", vm.addr(SIGNER_KEY));
        string memory eipJson = vm.serializeBytes(e, "signature", signature);

        string memory root_ = "root";
        vm.serializeString(root_, "merkle", merkleJson);
        string memory json = vm.serializeString(root_, "eip712", eipJson);
        vm.writeJson(json, "./test/vectors.json");
    }
}
