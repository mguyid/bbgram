"""OpenZeppelin StandardMerkleTree (leaf encoding ["address", "uint256"]) in Python.

Leaf  = keccak256(bytes.concat(keccak256(abi.encode(account, amount))))
Nodes = keccak256(sort(a, b)) (OZ MerkleProof sorted-pair hashing)
Layout matches @openzeppelin/merkle-tree: leaves sorted by hash, stored at the end of a flat array.
"""

from dataclasses import dataclass

from eth_abi import encode
from eth_utils import keccak, to_checksum_address


def leaf_hash(account: str, amount: int) -> bytes:
    return keccak(keccak(encode(["address", "uint256"], [to_checksum_address(account), int(amount)])))


def hash_pair(a: bytes, b: bytes) -> bytes:
    return keccak(a + b) if a < b else keccak(b + a)


@dataclass
class MerkleTree:
    tree: list[bytes]
    # leaf hash -> index in `tree`
    positions: dict[bytes, int]

    @property
    def root(self) -> str:
        return "0x" + self.tree[0].hex()

    def proof(self, account: str, amount: int) -> list[str]:
        i = self.positions[leaf_hash(account, amount)]
        out = []
        while i > 0:
            sibling = i - 1 if i % 2 == 0 else i + 1
            out.append("0x" + self.tree[sibling].hex())
            i = (i - 1) // 2
        return out


def build_tree(entries: list[tuple[str, int]]) -> MerkleTree:
    if not entries:
        raise ValueError("Cannot build a Merkle tree with no leaves")
    leaves = sorted(leaf_hash(a, v) for a, v in entries)
    if len(set(leaves)) != len(leaves):
        raise ValueError("Duplicate leaves")
    n = len(leaves)
    tree: list[bytes] = [b""] * (2 * n - 1)
    positions = {}
    for i, leaf in enumerate(leaves):
        idx = len(tree) - 1 - i
        tree[idx] = leaf
        positions[leaf] = idx
    for i in range(len(tree) - 1 - n, -1, -1):
        tree[i] = hash_pair(tree[2 * i + 1], tree[2 * i + 2])
    return MerkleTree(tree=tree, positions=positions)
