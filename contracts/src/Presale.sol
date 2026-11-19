// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title BabyGrandPresale
/// @notice Whitelisted (EIP-712 signature) USDT presale. Tokens are recorded at purchase time and
/// claimed after `enableClaim`, with an initial unlock plus optional linear vesting.
contract BabyGrandPresale is Ownable2Step, EIP712, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant WHITELIST_TYPEHASH = keccak256("Whitelist(address wallet,uint256 maxAllocation)");
    uint256 public constant MAX_BPS = 10_000;

    IERC20 public immutable usdt;
    IERC20 public token;
    address public signer;
    uint256 public tokensPerUsdt; // token wei per 1 whole USDT (18-decimal fixed point)
    uint256 public hardCapWei;
    uint256 public minWei = 10e18;
    uint256 public maxWei = 2_500e18;
    uint64 public startTime;
    uint64 public endTime;
    uint256 public totalRaised;
    uint256 public totalTokensSold;
    bool public claimEnabled;
    uint64 public claimStart;
    uint256 public unlockBps = MAX_BPS;
    uint64 public vestingDuration;

    mapping(address => uint256) public contributed; // USDT wei
    mapping(address => uint256) public purchased; // token wei
    mapping(address => uint256) public claimed; // token wei

    event Contributed(address indexed buyer, uint256 amount, uint256 total);
    event Claimed(address indexed buyer, uint256 tokens);

    error ZeroAddress();
    error ZeroAmount();
    error InvalidTimes();
    error InvalidLimits();
    error InvalidBps();
    error NotLive();
    error SaleLive();
    error HardCapBelowRaised();
    error InvalidSignature();
    error BelowMin();
    error WalletCapExceeded();
    error HardCapExceeded();
    error TokenAlreadySet();
    error TokenNotSet();
    error ClaimNotEnabled();
    error ClaimAlreadyEnabled();
    error NothingToClaim();

    /// @dev Terms (price, cap, limits) change only while the sale is not started or is paused.
    modifier whenEditable() {
        if (startTime != 0 && block.timestamp >= startTime && !paused()) revert SaleLive();
        _;
    }

    constructor(address usdt_, address owner_) Ownable(owner_) EIP712("BabyGrandPresale", "1") {
        if (usdt_ == address(0)) revert ZeroAddress();
        usdt = IERC20(usdt_);
    }

    // ---------------------------------------------------------------- buyer

    function buy(uint256 amount, uint256 maxAllocation, bytes calldata signature) external nonReentrant whenNotPaused {
        if (startTime == 0 || block.timestamp < startTime || block.timestamp >= endTime || tokensPerUsdt == 0) {
            revert NotLive();
        }
        if (amount == 0) revert ZeroAmount();
        if (ECDSA.recover(whitelistDigest(msg.sender, maxAllocation), signature) != signer) revert InvalidSignature();

        uint256 cap = maxAllocation < maxWei ? maxAllocation : maxWei;
        uint256 total = contributed[msg.sender] + amount;
        if (total > cap) revert WalletCapExceeded();
        if (amount < minWei && total != cap) revert BelowMin();
        if (totalRaised + amount > hardCapWei) revert HardCapExceeded();

        uint256 tokens = amount * tokensPerUsdt / 1e18;
        contributed[msg.sender] = total;
        purchased[msg.sender] += tokens;
        totalRaised += amount;
        totalTokensSold += tokens;
        // forge-lint: disable-next-line(reentrancy-events) -- only pure library calls precede this
        emit Contributed(msg.sender, amount, total);
        usdt.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Pays everything vested and not yet claimed. Callable repeatedly; not affected by pause.
    function claim() external nonReentrant {
        if (!claimEnabled) revert ClaimNotEnabled();
        uint256 amount = claimable(msg.sender);
        if (amount == 0) revert NothingToClaim();
        claimed[msg.sender] += amount;
        emit Claimed(msg.sender, amount);
        token.safeTransfer(msg.sender, amount);
    }

    // ---------------------------------------------------------------- views

    function vested(address buyer) public view returns (uint256) {
        if (!claimEnabled) return 0;
        uint256 total = purchased[buyer];
        if (vestingDuration == 0) return total;
        uint256 initial = total * unlockBps / MAX_BPS;
        uint256 elapsed = block.timestamp - claimStart;
        if (elapsed > vestingDuration) elapsed = vestingDuration;
        return initial + (total - initial) * elapsed / vestingDuration;
    }

    function claimable(address buyer) public view returns (uint256) {
        return vested(buyer) - claimed[buyer];
    }

    /// @notice EIP-712 digest the signer signs for `wallet`.
    function whitelistDigest(address wallet, uint256 maxAllocation) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(WHITELIST_TYPEHASH, wallet, maxAllocation)));
    }

    // ---------------------------------------------------------------- owner: terms

    function setPrice(uint256 tokensPerUsdt_) external onlyOwner whenEditable {
        tokensPerUsdt = tokensPerUsdt_;
    }

    function setHardCap(uint256 hardCapWei_) external onlyOwner whenEditable {
        if (hardCapWei_ < totalRaised) revert HardCapBelowRaised();
        hardCapWei = hardCapWei_;
    }

    function setLimits(uint256 minWei_, uint256 maxWei_) external onlyOwner whenEditable {
        if (minWei_ > maxWei_) revert InvalidLimits();
        minWei = minWei_;
        maxWei = maxWei_;
    }

    // ---------------------------------------------------------------- owner: other

    function setTimes(uint64 startTime_, uint64 endTime_) external onlyOwner {
        if (startTime_ >= endTime_) revert InvalidTimes();
        startTime = startTime_;
        endTime = endTime_;
    }

    function setSigner(address signer_) external onlyOwner {
        if (signer_ == address(0)) revert ZeroAddress();
        signer = signer_;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setToken(address token_) external onlyOwner {
        if (token_ == address(0)) revert ZeroAddress();
        if (address(token) != address(0)) revert TokenAlreadySet();
        token = IERC20(token_);
    }

    function setUnlock(uint256 unlockBps_, uint64 vestingDuration_) external onlyOwner {
        if (claimEnabled) revert ClaimAlreadyEnabled();
        if (unlockBps_ > MAX_BPS) revert InvalidBps();
        unlockBps = unlockBps_;
        vestingDuration = vestingDuration_;
    }

    /// @notice Irreversible. Starts the unlock schedule now.
    function enableClaim() external onlyOwner {
        if (address(token) == address(0)) revert TokenNotSet();
        if (claimEnabled) revert ClaimAlreadyEnabled();
        claimEnabled = true;
        // forge-lint: disable-next-line(unsafe-typecast) -- timestamps fit in uint64
        claimStart = uint64(block.timestamp);
    }

    function withdrawUsdt(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        usdt.safeTransfer(to, usdt.balanceOf(address(this)));
    }

    function withdrawTokens(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (address(token) == address(0)) revert TokenNotSet();
        token.safeTransfer(to, amount);
    }
}
