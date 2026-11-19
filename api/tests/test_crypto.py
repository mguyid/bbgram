"""Merkle tree (OZ StandardMerkleTree) and EIP-712 whitelist signatures."""

import random

import pytest
from eth_abi import encode
from eth_account import Account
from eth_utils import keccak, to_checksum_address

from app import chain
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


def test_eip712_matches_contract_vectors():
    anvil0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
    presale = "0x3333333333333333333333333333333333333333"
    max_alloc = 2500 * 10**18

    domain_type = keccak(text="EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
    domain_sep = keccak(encode(
        ["bytes32", "bytes32", "bytes32", "uint256", "address"],
        [domain_type, keccak(text="BabyGrandPresale"), keccak(text="1"), 97, presale],
    ))
    struct_hash = keccak(encode(["bytes32", "address", "uint256"],
                                [keccak(text="Whitelist(address wallet,uint256 maxAllocation)"), A, max_alloc]))
    digest = keccak(b"\x19\x01" + domain_sep + struct_hash)
    assert "0x" + domain_sep.hex() == "0x3f4ac228c413f9d56d27efca0bbcf11b750fff97ea705181c276cea8b7f3a62c"
    assert "0x" + struct_hash.hex() == "0x588d8f2f96ca6c84b97464024660d7adf90ac02e96a1d9c1031e6122a54840ea"
    assert "0x" + digest.hex() == "0xa16b357c870e2bb0138b11c76a5cc442e3240f2647b6d269b18700250920c89b"

    sig = chain.sign_whitelist(97, presale, anvil0, A, max_alloc)
    assert sig == (
        "0x951591c6829c7ab5a14a122973588ce96176dc1fff38864fee3615fbfd8008372f"
        "8265015d79356cfadd924dc74ecd998a72d3cc69388a1e8bff047eabc2a9711c"
    )
    signer = Account.from_key(anvil0).address
    assert chain.recover_whitelist_signer(97, presale, A, max_alloc, sig) == signer
    assert Account._recover_hash(digest, signature=bytes.fromhex(sig[2:])) == signer


def test_eip712_signature_recovers_to_signer():
    from tests.conftest import PRESALE, SIGNER

    wallet = Account.create().address
    sig = chain.sign_whitelist(97, PRESALE, SIGNER.key.hex(), wallet, 2500 * 10**18)
    assert chain.recover_whitelist_signer(97, PRESALE, wallet, 2500 * 10**18, sig) == SIGNER.address
    assert chain.recover_whitelist_signer(97, PRESALE, wallet, 2499 * 10**18, sig) != SIGNER.address
