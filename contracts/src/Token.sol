// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title BabyGrandToken
/// @notice Fixed-supply BEP-20 with buy/sell tax on registered AMM pairs only.
contract BabyGrandToken is ERC20, Ownable2Step {
    uint256 public constant TOTAL_SUPPLY = 10_000_000e18;
    uint256 public constant MAX_BPS = 10_000;

    address public immutable treasury;
    address public taxWallet;
    uint256 public buyTaxBps;
    uint256 public sellTaxBps;
    string public socials;

    mapping(address => bool) public isTaxExempt;
    mapping(address => bool) public isAmmPair;

    error ZeroAddress();
    error TaxTooHigh();

    constructor(string memory name_, string memory symbol_, address treasury_, address owner_)
        ERC20(name_, symbol_)
        Ownable(owner_)
    {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        taxWallet = treasury_;
        isTaxExempt[owner_] = true;
        isTaxExempt[treasury_] = true;
        isTaxExempt[address(this)] = true;
        _mint(treasury_, TOTAL_SUPPLY);
    }

    function setBuyTax(uint256 bps) external onlyOwner {
        if (bps > MAX_BPS) revert TaxTooHigh();
        buyTaxBps = bps;
    }

    function setSellTax(uint256 bps) external onlyOwner {
        if (bps > MAX_BPS) revert TaxTooHigh();
        sellTaxBps = bps;
    }

    function setTaxWallet(address wallet) external onlyOwner {
        if (wallet == address(0)) revert ZeroAddress();
        taxWallet = wallet;
    }

    function setSocials(string calldata value) external onlyOwner {
        socials = value;
    }

    function setTaxExempt(address account, bool exempt) external onlyOwner {
        isTaxExempt[account] = exempt;
    }

    function setAmmPair(address pair, bool isPair) external onlyOwner {
        isAmmPair[pair] = isPair;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && !isTaxExempt[from] && !isTaxExempt[to]) {
            uint256 bps = 0;
            if (isAmmPair[from]) bps = buyTaxBps;
            else if (isAmmPair[to]) bps = sellTaxBps;
            uint256 tax = value * bps / MAX_BPS;
            if (tax > 0) {
                super._update(from, taxWallet, tax);
                value -= tax;
            }
        }
        super._update(from, to, value);
    }
}
