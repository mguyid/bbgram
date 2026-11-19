// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title BabyGrandAirdrop
/// @notice Merkle claim. Leaf = keccak256(bytes.concat(keccak256(abi.encode(account, amount)))).
/// Root and deadline are set by the owner after deploy. Deadline 0 means no deadline.
contract BabyGrandAirdrop is Ownable2Step {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    bytes32 public merkleRoot;
    uint64 public deadline;

    mapping(address => bool) public claimed;

    event Claimed(address indexed account, uint256 amount);

    error ZeroAddress();
    error RootNotSet();
    error AlreadyClaimed();
    error InvalidProof();
    error ClaimEnded();
    error DeadlineNotReached();

    constructor(address token_, address owner_) Ownable(owner_) {
        if (token_ == address(0)) revert ZeroAddress();
        token = IERC20(token_);
    }

    function claim(uint256 amount, bytes32[] calldata proof) external {
        if (merkleRoot == bytes32(0)) revert RootNotSet();
        if (deadline != 0 && block.timestamp > deadline) revert ClaimEnded();
        if (claimed[msg.sender]) revert AlreadyClaimed();
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, amount))));
        if (!MerkleProof.verify(proof, merkleRoot, leaf)) revert InvalidProof();
        claimed[msg.sender] = true;
        // forge-lint: disable-next-line(reentrancy-events) -- only pure library calls precede this
        emit Claimed(msg.sender, amount);
        token.safeTransfer(msg.sender, amount);
    }

    function setRoot(bytes32 root) external onlyOwner {
        merkleRoot = root;
    }

    function setDeadline(uint64 deadline_) external onlyOwner {
        deadline = deadline_;
    }

    function recover(address to) external onlyOwner {
        if (deadline == 0 || block.timestamp <= deadline) revert DeadlineNotReached();
        if (to == address(0)) revert ZeroAddress();
        token.safeTransfer(to, token.balanceOf(address(this)));
    }
}
