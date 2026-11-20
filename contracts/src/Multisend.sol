// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title BabyGrandMultisend
/// @notice Sends a token from the caller to many recipients in one transaction. Used after launch to credit
/// presale buyers from the treasury. No owner and no state: the caller approves this contract first, and
/// tokens only ever move from the caller.
contract BabyGrandMultisend {
    using SafeERC20 for IERC20;

    error LengthMismatch();

    function send(IERC20 token, address[] calldata recipients, uint256[] calldata amounts) external {
        if (recipients.length != amounts.length) revert LengthMismatch();
        for (uint256 i = 0; i < recipients.length; ++i) {
            token.safeTransferFrom(msg.sender, recipients[i], amounts[i]);
        }
    }
}
