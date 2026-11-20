// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/console2.sol";
import {DeployBase} from "./DeployBase.sol";
import {BabyGrandMultisend} from "../src/Multisend.sol";

/// Env: DEPLOYER_PRIVATE_KEY. No owner and no configuration.
contract DeployMultisend is DeployBase {
    function run() external returns (BabyGrandMultisend multisend) {
        uint256 key = _deployerKey();
        vm.startBroadcast(key);
        multisend = new BabyGrandMultisend();
        vm.stopBroadcast();
        console2.log("MULTISEND_ADDRESS=%s", address(multisend));
    }
}
