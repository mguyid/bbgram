// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/console2.sol";
import {DeployBase} from "./DeployBase.sol";
import {MockUSDT} from "../src/MockUSDT.sol";
import {BabyGrandToken} from "../src/Token.sol";
import {BabyGrandPresale} from "../src/Presale.sol";
import {BabyGrandAirdrop} from "../src/AirdropClaim.sol";

/// Testnet/local: MockUSDT + Token + Presale + Airdrop, all owned by the deployer (also the token treasury).
/// Env: DEPLOYER_PRIVATE_KEY only. No configuration: everything is set from the admin Contracts page.
contract DeployTestnet is DeployBase {
    function run() external {
        uint256 key = _deployerKey();
        address deployer = vm.addr(key);

        vm.startBroadcast(key);
        MockUSDT usdt = new MockUSDT();
        BabyGrandToken token = new BabyGrandToken("Baby Grand", "BGRAND", deployer, deployer);
        BabyGrandPresale presale = new BabyGrandPresale(address(usdt), deployer);
        BabyGrandAirdrop airdrop = new BabyGrandAirdrop(address(token), deployer);
        vm.stopBroadcast();

        console2.log("USDT_ADDRESS=%s", address(usdt));
        console2.log("TOKEN_ADDRESS=%s", address(token));
        console2.log("PRESALE_ADDRESS=%s", address(presale));
        console2.log("PRESALE_START_BLOCK=%s", block.number);
        console2.log("AIRDROP_ADDRESS=%s", address(airdrop));
    }
}
