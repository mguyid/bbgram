// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/console2.sol";
import {DeployBase} from "./DeployBase.sol";
import {BabyGrandAirdrop} from "../src/AirdropClaim.sol";

/// Env: DEPLOYER_PRIVATE_KEY, TOKEN_ADDRESS (required), OWNER_ADDRESS (default deployer).
/// Merkle root and deadline are set, and the contract is funded, from the admin Contracts page.
contract DeployAirdrop is DeployBase {
    function run() external returns (BabyGrandAirdrop airdrop) {
        uint256 key = _deployerKey();
        _required("TOKEN_ADDRESS");

        vm.startBroadcast(key);
        airdrop = new BabyGrandAirdrop(vm.envAddress("TOKEN_ADDRESS"), _addr("OWNER_ADDRESS", vm.addr(key)));
        vm.stopBroadcast();

        console2.log("AIRDROP_ADDRESS=%s", address(airdrop));
    }
}
