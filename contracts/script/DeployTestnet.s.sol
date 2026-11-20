// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/console2.sol";
import {DeployBase} from "./DeployBase.sol";
import {MockUSDT} from "../src/MockUSDT.sol";
import {BabyGrandToken} from "../src/Token.sol";
import {BabyGrandAirdrop} from "../src/AirdropClaim.sol";
import {BabyGrandMultisend} from "../src/Multisend.sol";

/// Testnet/local: MockUSDT + Token + Airdrop + Multisend, owned by the deployer (also the token treasury).
/// Env: DEPLOYER_PRIVATE_KEY only. There is no presale contract: the presale wallet is set in admin Settings.
contract DeployTestnet is DeployBase {
    function run() external {
        uint256 key = _deployerKey();
        address deployer = vm.addr(key);

        vm.startBroadcast(key);
        MockUSDT usdt = new MockUSDT();
        BabyGrandToken token = new BabyGrandToken("Baby Grand", "BBGRAM", deployer, deployer);
        BabyGrandAirdrop airdrop = new BabyGrandAirdrop(address(token), deployer);
        BabyGrandMultisend multisend = new BabyGrandMultisend();
        vm.stopBroadcast();

        console2.log("USDT_ADDRESS=%s", address(usdt));
        console2.log("TOKEN_ADDRESS=%s", address(token));
        console2.log("AIRDROP_ADDRESS=%s", address(airdrop));
        console2.log("MULTISEND_ADDRESS=%s", address(multisend));
    }
}
