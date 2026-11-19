// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/console2.sol";
import {DeployBase} from "./DeployBase.sol";
import {BabyGrandPresale} from "../src/Presale.sol";
import {MockUSDT} from "../src/MockUSDT.sol";

/// Env: DEPLOYER_PRIVATE_KEY, OWNER_ADDRESS (default deployer).
/// USDT: BSC mainnet USDT on chain 56, otherwise a fresh MockUSDT.
/// Price, hard cap, limits, times, signer, unlock and token are set from the admin Contracts page.
contract DeployPresale is DeployBase {
    address constant BSC_USDT = 0x55d398326f99059fF775485246999027B3197955;

    function run() external returns (BabyGrandPresale presale) {
        uint256 key = _deployerKey();
        address owner = _addr("OWNER_ADDRESS", vm.addr(key));

        vm.startBroadcast(key);
        address usdt = block.chainid == 56 ? BSC_USDT : address(new MockUSDT());
        presale = new BabyGrandPresale(usdt, owner);
        vm.stopBroadcast();

        console2.log("USDT_ADDRESS=%s", usdt);
        console2.log("PRESALE_ADDRESS=%s", address(presale));
        console2.log("PRESALE_START_BLOCK=%s", block.number);
    }
}
