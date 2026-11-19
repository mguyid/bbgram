// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/console2.sol";
import {DeployBase} from "./DeployBase.sol";
import {BabyGrandToken} from "../src/Token.sol";

/// Env: DEPLOYER_PRIVATE_KEY, TOKEN_SYMBOL, TOKEN_NAME (default "Baby Grand"),
///      TREASURY_ADDRESS (default deployer), OWNER_ADDRESS (default deployer).
/// Taxes, tax wallet, socials, exemptions and AMM pairs are set from the admin Contracts page.
contract DeployToken is DeployBase {
    function run() external returns (BabyGrandToken token) {
        uint256 key = _deployerKey();
        address deployer = vm.addr(key);
        _required("TOKEN_SYMBOL");

        vm.startBroadcast(key);
        token = new BabyGrandToken(
            _str("TOKEN_NAME", "Baby Grand"),
            vm.envString("TOKEN_SYMBOL"),
            _addr("TREASURY_ADDRESS", deployer),
            _addr("OWNER_ADDRESS", deployer)
        );
        vm.stopBroadcast();

        console2.log("TOKEN_ADDRESS=%s", address(token));
    }
}
