"""Merkle tree (OZ StandardMerkleTree) and EIP-712 whitelist signatures."""

import random

import pytest
from eth_abi import encode
from eth_utils import keccak, to_checksum_address

from app.merkle import build_tree, leaf_hash


def oz_verify(proof: list[str], root: str, leaf: bytes) -> bool:
    """Pure-Python port of OpenZeppelin MerkleProof.verify (commutative keccak256)."""
    computed = leaf
    for p in proof:
        sibling = bytes.fromhex(p[2:])
        a, b = sorted((computed, sibling))
        computed = keccak(a + b)
    return computed == bytes.fromhex(root[2:])


@pytest.mark.parametrize("n", [1, 2, 3, 7, 64, 101])
def test_merkle_proofs_verify(n):
    rng = random.Random(n)
    entries = [(to_checksum_address(rng.randbytes(20)), rng.randint(1, 10**24)) for _ in range(n)]
    tree = build_tree(entries)
    for account, amount in entries:
        proof = tree.proof(account, amount)
        assert oz_verify(proof, tree.root, leaf_hash(account, amount))
        assert not oz_verify(proof, tree.root, leaf_hash(account, amount + 1))


def test_merkle_leaf_encoding_is_double_keccak_abi_encode():
    a = "0x1111111111111111111111111111111111111111"
    assert leaf_hash(a, 5) == keccak(keccak(encode(["address", "uint256"], [a, 5])))


A = "0x1111111111111111111111111111111111111111"
B = "0x2222222222222222222222222222222222222222"
LEAF_A = "0x923a571f712ff2d205bc7da76152ab30459ae47d04647ff145ba9ad746468fc6"
LEAF_B = "0x2769202b8c373ddf6a1c9e7e5f6bd2a3afb327e36f8214802c6820e2dde14f6b"
ROOT = "0x7e25c5ca3fff607b23aedc621186d516177aaa27d28fab2dcb329bf099b006f4"


def test_merkle_matches_contract_vectors():
    """Vectors from contracts/test/vectors.json."""
    entries = [(A, 100 * 10**18), (B, 200 * 10**18)]
    assert "0x" + leaf_hash(*entries[0]).hex() == LEAF_A
    assert "0x" + leaf_hash(*entries[1]).hex() == LEAF_B
    tree = build_tree(entries)
    assert tree.root == ROOT
    assert tree.proof(*entries[0]) == [LEAF_B]
    assert tree.proof(*entries[1]) == [LEAF_A]
