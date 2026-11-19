// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";

/// @notice Env helpers shared by deploy scripts. Unset and empty variables both fall back to the default.
abstract contract DeployBase is Script {
    function _has(string memory name) internal view returns (bool) {
        return bytes(vm.envOr(name, string(""))).length > 0;
    }

    function _str(string memory name, string memory def) internal view returns (string memory) {
        return _has(name) ? vm.envString(name) : def;
    }

    function _addr(string memory name, address def) internal view returns (address) {
        return _has(name) ? vm.envAddress(name) : def;
    }

    function _required(string memory name) internal view {
        require(_has(name), string.concat("missing env var ", name));
    }

    function _deployerKey() internal view returns (uint256) {
        _required("DEPLOYER_PRIVATE_KEY");
        return vm.envUint("DEPLOYER_PRIVATE_KEY");
    }
}
