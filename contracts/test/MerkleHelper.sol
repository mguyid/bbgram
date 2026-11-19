// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Test-only Merkle tree with sorted-pair keccak hashing (OZ MerkleProof compatible).
/// Odd nodes at the end of a level are carried up unchanged.
library MerkleHelper {
    function leaf(address account, uint256 amount) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
    }

    function hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function _next(bytes32[] memory level) private pure returns (bytes32[] memory up) {
        up = new bytes32[]((level.length + 1) / 2);
        for (uint256 i = 0; i < up.length; i++) {
            up[i] = 2 * i + 1 < level.length ? hashPair(level[2 * i], level[2 * i + 1]) : level[2 * i];
        }
    }

    function root(bytes32[] memory leaves) internal pure returns (bytes32) {
        bytes32[] memory level = leaves;
        while (level.length > 1) {
            level = _next(level);
        }
        return level[0];
    }

    function proof(bytes32[] memory leaves, uint256 index) internal pure returns (bytes32[] memory) {
        bytes32[] memory tmp = new bytes32[](256);
        uint256 n = 0;
        bytes32[] memory level = leaves;
        while (level.length > 1) {
            uint256 sibling = index ^ 1;
            if (sibling < level.length) tmp[n++] = level[sibling];
            level = _next(level);
            index /= 2;
        }
        bytes32[] memory out = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            out[i] = tmp[i];
        }
        return out;
    }
}
