// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {BabyGrandPresale} from "../src/Presale.sol";
import {BabyGrandToken} from "../src/Token.sol";
import {MockUSDT} from "../src/MockUSDT.sol";

contract PresaleTest is Test {
    event Contributed(address indexed buyer, uint256 amount, uint256 total);
    event Claimed(address indexed buyer, uint256 tokens);

    MockUSDT usdt;
    BabyGrandPresale presale;
    BabyGrandToken token;

    address owner = makeAddr("owner");
    address signer;
    uint256 signerKey;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant PRICE = 100e18; // tokensPerUsdt: $0.01 per token
    uint256 constant HARD_CAP = 10_000e18;
    uint256 constant MIN = 10e18;
    uint256 constant MAX = 2_500e18;
    uint64 start;
    uint64 end;

    function setUp() public {
        (signer, signerKey) = makeAddrAndKey("signer");
        start = uint64(block.timestamp + 1 days);
        end = start + 7 days;
        usdt = new MockUSDT();
        presale = new BabyGrandPresale(address(usdt), owner);
        vm.startPrank(owner);
        presale.setSigner(signer);
        presale.setPrice(PRICE);
        presale.setHardCap(HARD_CAP);
        presale.setTimes(start, end);
        vm.stopPrank();
        token = new BabyGrandToken("Baby Grand", "BGRAND", owner, owner);
    }

    // ------------------------------------------------------------ helpers

    function _sign(address wallet, uint256 maxAllocation) internal view returns (bytes memory) {
        return _signWith(signerKey, wallet, maxAllocation);
    }

    function _signWith(uint256 key, address wallet, uint256 maxAllocation) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, presale.whitelistDigest(wallet, maxAllocation));
        return abi.encodePacked(r, s, v);
    }

    function _fund(address who, uint256 amount) internal {
        usdt.mint(who, amount);
        vm.prank(who);
        usdt.approve(address(presale), type(uint256).max);
    }

    function _buy(address who, uint256 amount, uint256 maxAllocation) internal {
        bytes memory sig = _sign(who, maxAllocation);
        vm.prank(who);
        presale.buy(amount, maxAllocation, sig);
    }

    function _live() internal {
        vm.warp(start);
    }

    function _pause() internal {
        vm.prank(owner);
        presale.pause();
    }

    // ------------------------------------------------------------ constructor / views

    function test_ConstructorDefaults() public {
        BabyGrandPresale p = new BabyGrandPresale(address(usdt), owner);
        assertEq(address(p.usdt()), address(usdt));
        assertEq(p.owner(), owner);
        assertEq(address(p.token()), address(0));
        assertEq(p.signer(), address(0));
        assertEq(p.tokensPerUsdt(), 0);
        assertEq(p.hardCapWei(), 0);
        assertEq(p.minWei(), 10e18);
        assertEq(p.maxWei(), 2_500e18);
        assertEq(p.startTime(), 0);
        assertEq(p.endTime(), 0);
        assertEq(p.totalRaised(), 0);
        assertEq(p.totalTokensSold(), 0);
        assertFalse(p.claimEnabled());
        assertEq(p.claimStart(), 0);
        assertEq(p.unlockBps(), 10_000);
        assertEq(p.vestingDuration(), 0);
        assertFalse(p.paused());
    }

    function test_ConstructorRejectsZeroUsdt() public {
        vm.expectRevert(BabyGrandPresale.ZeroAddress.selector);
        new BabyGrandPresale(address(0), owner);
    }

    function test_SetupValues() public view {
        assertEq(presale.signer(), signer);
        assertEq(presale.tokensPerUsdt(), PRICE);
        assertEq(presale.hardCapWei(), HARD_CAP);
        assertEq(presale.startTime(), start);
        assertEq(presale.endTime(), end);
    }

    function test_BuyRevertsBeforeTimesSet() public {
        BabyGrandPresale p = new BabyGrandPresale(address(usdt), owner);
        vm.prank(alice);
        vm.expectRevert(BabyGrandPresale.NotLive.selector);
        p.buy(MIN, MAX, "");
    }

    function test_BuyRevertsWithoutPrice() public {
        BabyGrandPresale p = new BabyGrandPresale(address(usdt), owner);
        vm.prank(owner);
        p.setTimes(start, end);
        vm.warp(start);
        vm.prank(alice);
        vm.expectRevert(BabyGrandPresale.NotLive.selector);
        p.buy(MIN, MAX, "");
    }

    function test_DigestMatchesEip712() public view {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("BabyGrandPresale"),
                keccak256("1"),
                block.chainid,
                address(presale)
            )
        );
        bytes32 structHash =
            keccak256(abi.encode(keccak256("Whitelist(address wallet,uint256 maxAllocation)"), alice, MAX));
        bytes32 expected = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        assertEq(presale.whitelistDigest(alice, MAX), expected);
    }

    // ------------------------------------------------------------ signature

    function test_BuyValidSignature() public {
        _live();
        _fund(alice, 100e18);
        bytes memory sig = _sign(alice, MAX);
        vm.expectEmit(true, false, false, true, address(presale));
        emit Contributed(alice, 100e18, 100e18);
        vm.prank(alice);
        presale.buy(100e18, MAX, sig);
        assertEq(presale.contributed(alice), 100e18);
        assertEq(presale.totalRaised(), 100e18);
        assertEq(usdt.balanceOf(address(presale)), 100e18);
        assertEq(presale.purchased(alice), 10_000e18);
        assertEq(presale.totalTokensSold(), 10_000e18);
    }

    function test_BuyRevertsWrongSigner() public {
        _live();
        _fund(alice, 100e18);
        (, uint256 otherKey) = makeAddrAndKey("other");
        bytes memory sig = _signWith(otherKey, alice, MAX);
        vm.prank(alice);
        vm.expectRevert(BabyGrandPresale.InvalidSignature.selector);
        presale.buy(100e18, MAX, sig);
    }

    function test_BuyRevertsSignatureForOtherWallet() public {
        _live();
        _fund(bob, 100e18);
        bytes memory sig = _sign(alice, MAX);
        vm.prank(bob);
        vm.expectRevert(BabyGrandPresale.InvalidSignature.selector);
        presale.buy(100e18, MAX, sig);
    }

    function test_BuyRevertsTamperedAllocation() public {
        _live();
        _fund(alice, 100e18);
        bytes memory sig = _sign(alice, 50e18);
        vm.prank(alice);
        vm.expectRevert(BabyGrandPresale.InvalidSignature.selector);
        presale.buy(100e18, MAX, sig);
    }

    function test_BuyRevertsMalformedSignature() public {
        _live();
        _fund(alice, 100e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureLength.selector, 3));
        presale.buy(100e18, MAX, hex"010203");
    }

    function test_SetSignerRejectsZero() public {
        vm.prank(owner);
        vm.expectRevert(BabyGrandPresale.ZeroAddress.selector);
        presale.setSigner(address(0));
    }

    function test_SetSignerInvalidatesOldSignatures() public {
        _live();
        _fund(alice, 100e18);
        bytes memory sig = _sign(alice, MAX);
        vm.prank(owner);
        presale.setSigner(bob);
        assertEq(presale.signer(), bob);
        vm.prank(alice);
        vm.expectRevert(BabyGrandPresale.InvalidSignature.selector);
        presale.buy(100e18, MAX, sig);
    }

    // ------------------------------------------------------------ limits

    function test_BelowMinReverts() public {
        _live();
        _fund(alice, 100e18);
        bytes memory sig = _sign(alice, MAX);
        vm.prank(alice);
        vm.expectRevert(BabyGrandPresale.BelowMin.selector);
        presale.buy(MIN - 1, MAX, sig);
    }

    function test_ZeroAmountReverts() public {
        _live();
        bytes memory sig = _sign(alice, MAX);
        vm.prank(alice);
        vm.expectRevert(BabyGrandPresale.ZeroAmount.selector);
        presale.buy(0, MAX, sig);
    }

    function test_MaxCumulative() public {
        _live();
        _fund(alice, 3_000e18);
        _buy(alice, 2_000e18, MAX);
        bytes memory sig = _sign(alice, MAX);
        vm.prank(alice);
        vm.expectRevert(BabyGrandPresale.WalletCapExceeded.selector);
        presale.buy(501e18, MAX, sig);
        _buy(alice, 500e18, MAX);
        assertEq(presale.contributed(alice), MAX);
    }

    function test_BelowMinAllowedWhenFillingCap() public {
        _live();
        _fund(alice, MAX);
        _buy(alice, MAX - 5e18, MAX);
        _buy(alice, 5e18, MAX); // below min but fills cap exactly
        assertEq(presale.contributed(alice), MAX);
    }

    function test_MaxAllocationCapsBelowMaxWei() public {
        _live();
        _fund(alice, MAX);
        uint256 alloc = 100e18;
        bytes memory sig = _sign(alice, alloc);
        vm.prank(alice);
        vm.expectRevert(BabyGrandPresale.WalletCapExceeded.selector);
        presale.buy(101e18, alloc, sig);
        _buy(alice, 100e18, alloc);
        assertEq(presale.contributed(alice), 100e18);
    }

    function test_MaxAllocationAboveMaxWeiCappedAtMaxWei() public {
        _live();
        _fund(alice, 5_000e18);
        bytes memory sig = _sign(alice, 5_000e18);
        vm.prank(alice);
        vm.expectRevert(BabyGrandPresale.WalletCapExceeded.selector);
        presale.buy(MAX + 1, 5_000e18, sig);
    }

    function test_HardCap() public {
        _live();
        for (uint256 i = 0; i < 4; i++) {
            address buyer = address(uint160(0x1000 + i));
            _fund(buyer, MAX);
            _buy(buyer, MAX, MAX);
        }
        assertEq(presale.totalRaised(), HARD_CAP);
        _fund(alice, MIN);
        bytes memory sig = _sign(alice, MAX);
        vm.prank(alice);
        vm.expectRevert(BabyGrandPresale.HardCapExceeded.selector);
        presale.buy(MIN, MAX, sig);
    }

    function testFuzz_Limits(uint256 first, uint256 second, uint256 maxAllocation) public {
        first = bound(first, 1, 5_000e18);
        second = bound(second, 1, 5_000e18);
        maxAllocation = bound(maxAllocation, 1, 5_000e18);
        uint256 cap = maxAllocation < MAX ? maxAllocation : MAX;
        _live();
        _fund(alice, 10_000e18);
        bytes memory sig = _sign(alice, maxAllocation);

        uint256 total;
        uint256[2] memory amounts = [first, second];
        for (uint256 i = 0; i < 2; i++) {
            uint256 amount = amounts[i];
            bool ok = total + amount <= cap && (amount >= MIN || total + amount == cap);
            vm.prank(alice);
            if (!ok) vm.expectRevert();
            presale.buy(amount, maxAllocation, sig);
            if (ok) total += amount;
            assertEq(presale.contributed(alice), total);
            assertLe(total, cap);
        }
        assertEq(presale.totalRaised(), total);
        assertEq(usdt.balanceOf(address(presale)), total);
    }

    // ------------------------------------------------------------ time window / pause

    function test_TimeWindow() public {
        _fund(alice, 1_000e18);
        bytes memory sig = _sign(alice, MAX);

        vm.warp(start - 1);
        vm.prank(alice);
        vm.expectRevert(BabyGrandPresale.NotLive.selector);
        presale.buy(MIN, MAX, sig);

        vm.warp(start);
        vm.prank(alice);
        presale.buy(MIN, MAX, sig);

        vm.warp(end - 1);
        vm.prank(alice);
        presale.buy(MIN, MAX, sig);

        vm.warp(end);
        vm.prank(alice);
        vm.expectRevert(BabyGrandPresale.NotLive.selector);
        presale.buy(MIN, MAX, sig);
    }

    function test_SetTimes() public {
        vm.prank(owner);
        vm.expectRevert(BabyGrandPresale.InvalidTimes.selector);
        presale.setTimes(100, 100);
        vm.prank(owner);
        presale.setTimes(100, 200);
        assertEq(presale.startTime(), 100);
        assertEq(presale.endTime(), 200);
    }

    function test_Pause() public {
        _live();
        _fund(alice, 1_000e18);
        bytes memory sig = _sign(alice, MAX);
        vm.prank(owner);
        presale.pause();
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        presale.buy(MIN, MAX, sig);
        vm.prank(owner);
        presale.unpause();
        vm.prank(alice);
        presale.buy(MIN, MAX, sig);
    }

    // ------------------------------------------------------------ terms editability

    function test_TermsEditableWhenTimesUnset() public {
        BabyGrandPresale p = new BabyGrandPresale(address(usdt), owner);
        vm.startPrank(owner);
        p.setPrice(1);
        p.setHardCap(1);
        p.setLimits(1, 2);
        vm.stopPrank();
        assertEq(p.tokensPerUsdt(), 1);
        assertEq(p.hardCapWei(), 1);
        assertEq(p.minWei(), 1);
        assertEq(p.maxWei(), 2);
    }

    function test_TermsEditableBeforeStart() public {
        vm.warp(start - 1);
        vm.startPrank(owner);
        presale.setPrice(200e18);
        presale.setHardCap(20_000e18);
        presale.setLimits(20e18, 1_000e18);
        vm.stopPrank();
        assertEq(presale.tokensPerUsdt(), 200e18);
        assertEq(presale.hardCapWei(), 20_000e18);
        assertEq(presale.minWei(), 20e18);
        assertEq(presale.maxWei(), 1_000e18);
    }

    function test_TermsLockedWhileLive() public {
        _live();
        vm.startPrank(owner);
        vm.expectRevert(BabyGrandPresale.SaleLive.selector);
        presale.setPrice(200e18);
        vm.expectRevert(BabyGrandPresale.SaleLive.selector);
        presale.setHardCap(20_000e18);
        vm.expectRevert(BabyGrandPresale.SaleLive.selector);
        presale.setLimits(20e18, 1_000e18);
        vm.stopPrank();
    }

    function test_TermsLockedAfterEndUnlessPaused() public {
        vm.warp(end);
        vm.prank(owner);
        vm.expectRevert(BabyGrandPresale.SaleLive.selector);
        presale.setPrice(200e18);
        _pause();
        vm.prank(owner);
        presale.setPrice(200e18);
        assertEq(presale.tokensPerUsdt(), 200e18);
    }

    function test_TermsEditableWhilePaused() public {
        _live();
        _pause();
        vm.startPrank(owner);
        presale.setPrice(200e18);
        presale.setHardCap(20_000e18);
        presale.setLimits(20e18, 1_000e18);
        presale.unpause();
        vm.expectRevert(BabyGrandPresale.SaleLive.selector);
        presale.setPrice(300e18);
        vm.stopPrank();
        assertEq(presale.tokensPerUsdt(), 200e18);
        assertEq(presale.hardCapWei(), 20_000e18);
        assertEq(presale.minWei(), 20e18);
        assertEq(presale.maxWei(), 1_000e18);
    }

    function test_SetHardCapNotBelowRaised() public {
        _live();
        _fund(alice, 500e18);
        _buy(alice, 500e18, MAX);
        _pause();
        vm.startPrank(owner);
        vm.expectRevert(BabyGrandPresale.HardCapBelowRaised.selector);
        presale.setHardCap(500e18 - 1);
        presale.setHardCap(500e18);
        vm.stopPrank();
        assertEq(presale.hardCapWei(), 500e18);
    }

    function test_SetLimitsMinNotAboveMax() public {
        vm.startPrank(owner);
        vm.expectRevert(BabyGrandPresale.InvalidLimits.selector);
        presale.setLimits(101e18, 100e18);
        presale.setLimits(100e18, 100e18);
        vm.stopPrank();
        assertEq(presale.minWei(), 100e18);
        assertEq(presale.maxWei(), 100e18);
    }

    function test_NewLimitsApplyToBuys() public {
        vm.prank(owner);
        presale.setLimits(50e18, 200e18);
        _live();
        _fund(alice, 1_000e18);
        bytes memory sig = _sign(alice, MAX);
        vm.startPrank(alice);
        vm.expectRevert(BabyGrandPresale.BelowMin.selector);
        presale.buy(49e18, MAX, sig);
        vm.expectRevert(BabyGrandPresale.WalletCapExceeded.selector);
        presale.buy(201e18, MAX, sig);
        presale.buy(200e18, MAX, sig);
        vm.stopPrank();
    }

    function test_PriceChangeKeepsExistingPurchases() public {
        _live();
        _fund(alice, 1_000e18);
        _fund(bob, 1_000e18);
        _buy(alice, 100e18, MAX); // 10,000 tokens at 100 tokens/USDT
        assertEq(presale.purchased(alice), 10_000e18);

        _pause();
        vm.startPrank(owner);
        presale.setPrice(50e18);
        presale.unpause();
        vm.stopPrank();

        assertEq(presale.purchased(alice), 10_000e18);
        _buy(bob, 100e18, MAX);
        assertEq(presale.purchased(bob), 5_000e18);
        _buy(alice, 100e18, MAX);
        assertEq(presale.purchased(alice), 15_000e18);
        assertEq(presale.contributed(alice), 200e18);
        assertEq(presale.totalTokensSold(), 20_000e18);
        assertEq(presale.totalRaised(), 300e18);
    }

    function testFuzz_TokensAtPurchasePrice(uint256 amount, uint256 price) public {
        amount = bound(amount, MIN, MAX);
        price = bound(price, 1, 1e30);
        vm.prank(owner);
        presale.setPrice(price);
        _live();
        _fund(alice, amount);
        _buy(alice, amount, MAX);
        assertEq(presale.purchased(alice), amount * price / 1e18);
        assertEq(presale.totalTokensSold(), amount * price / 1e18);
    }

    // ------------------------------------------------------------ claim / vesting

    function _setupClaim() internal {
        _live();
        _fund(alice, MAX);
        _buy(alice, 250e18, MAX); // 25,000 tokens
        vm.startPrank(owner);
        presale.setToken(address(token));
        token.transfer(address(presale), 1_000_000e18);
        vm.stopPrank();
    }

    function _enableClaim() internal {
        vm.prank(owner);
        presale.enableClaim();
    }

    function _setUnlock(uint256 bps, uint64 duration) internal {
        vm.prank(owner);
        presale.setUnlock(bps, duration);
    }

    function test_ClaimFlowFullUnlock() public {
        _setupClaim();
        assertEq(presale.vested(alice), 0);
        assertEq(presale.claimable(alice), 0);
        vm.prank(alice);
        vm.expectRevert(BabyGrandPresale.ClaimNotEnabled.selector);
        presale.claim();

        vm.warp(block.timestamp + 3 days);
        _enableClaim();
        assertTrue(presale.claimEnabled());
        assertEq(presale.claimStart(), vm.getBlockTimestamp());
        assertEq(presale.vested(alice), 25_000e18);
        assertEq(presale.claimable(alice), 25_000e18);

        vm.expectEmit(true, false, false, true, address(presale));
        emit Claimed(alice, 25_000e18);
        vm.prank(alice);
        presale.claim();
        assertEq(token.balanceOf(alice), 25_000e18);
        assertEq(presale.claimed(alice), 25_000e18);
        assertEq(presale.claimable(alice), 0);

        vm.prank(alice);
        vm.expectRevert(BabyGrandPresale.NothingToClaim.selector);
        presale.claim();
    }

    function test_VestingSchedule() public {
        _setupClaim();
        _setUnlock(2_500, 30 days);
        assertEq(presale.unlockBps(), 2_500);
        assertEq(presale.vestingDuration(), 30 days);
        _enableClaim();
        uint256 t0 = vm.getBlockTimestamp();

        assertEq(presale.vested(alice), 6_250e18); // 25% at claim start
        vm.warp(t0 + 10 days);
        assertEq(presale.vested(alice), 12_500e18); // + 1/3 of 18,750
        vm.warp(t0 + 15 days);
        assertEq(presale.vested(alice), 15_625e18); // + 1/2
        vm.warp(t0 + 30 days - 1);
        assertLt(presale.vested(alice), 25_000e18);
        vm.warp(t0 + 30 days);
        assertEq(presale.vested(alice), 25_000e18);
        vm.warp(t0 + 365 days);
        assertEq(presale.vested(alice), 25_000e18);
    }

    function test_RepeatedClaims() public {
        _setupClaim();
        _setUnlock(2_500, 30 days);
        _enableClaim();
        uint256 t0 = vm.getBlockTimestamp();

        vm.prank(alice);
        presale.claim();
        assertEq(token.balanceOf(alice), 6_250e18);

        vm.prank(alice);
        vm.expectRevert(BabyGrandPresale.NothingToClaim.selector);
        presale.claim();

        vm.warp(t0 + 15 days);
        assertEq(presale.claimable(alice), 9_375e18);
        vm.expectEmit(true, false, false, true, address(presale));
        emit Claimed(alice, 9_375e18);
        vm.prank(alice);
        presale.claim();
        assertEq(token.balanceOf(alice), 15_625e18);

        vm.warp(t0 + 40 days);
        vm.prank(alice);
        presale.claim();
        assertEq(token.balanceOf(alice), 25_000e18);
        assertEq(presale.claimed(alice), 25_000e18);
        assertEq(presale.claimable(alice), 0);
    }

    function test_ZeroInitialUnlock() public {
        _setupClaim();
        _setUnlock(0, 10 days);
        _enableClaim();
        assertEq(presale.vested(alice), 0);
        vm.prank(alice);
        vm.expectRevert(BabyGrandPresale.NothingToClaim.selector);
        presale.claim();
        vm.warp(block.timestamp + 5 days);
        assertEq(presale.vested(alice), 12_500e18);
    }

    function test_ZeroDurationIsFullUnlock() public {
        _setupClaim();
        _setUnlock(2_500, 0);
        _enableClaim();
        assertEq(presale.vested(alice), 25_000e18);
    }

    function testFuzz_Vesting(uint256 bps, uint64 duration, uint256 t1, uint256 t2) public {
        bps = bound(bps, 0, 10_000);
        duration = uint64(bound(duration, 1, 5 * 365 days));
        t1 = bound(t1, 0, 10 * 365 days);
        t2 = bound(t2, t1, 10 * 365 days);
        _setupClaim();
        _setUnlock(bps, duration);
        _enableClaim();
        uint256 t0 = vm.getBlockTimestamp();
        uint256 total = presale.purchased(alice);

        vm.warp(t0 + t1);
        uint256 v1 = presale.vested(alice);
        assertGe(v1, total * bps / 10_000);
        if (presale.claimable(alice) > 0) {
            vm.prank(alice);
            presale.claim();
        }
        vm.warp(t0 + t2);
        uint256 v2 = presale.vested(alice);
        assertGe(v2, v1);
        assertLe(v2, total);
        if (t2 >= duration) assertEq(v2, total);
        if (presale.claimable(alice) > 0) {
            vm.prank(alice);
            presale.claim();
        }
        assertEq(token.balanceOf(alice), v2);
    }

    function test_SetUnlockBounds() public {
        vm.prank(owner);
        vm.expectRevert(BabyGrandPresale.InvalidBps.selector);
        presale.setUnlock(10_001, 0);
    }

    function test_SetUnlockLockedAfterEnableClaim() public {
        _setupClaim();
        _setUnlock(5_000, 7 days);
        _enableClaim();
        vm.prank(owner);
        vm.expectRevert(BabyGrandPresale.ClaimAlreadyEnabled.selector);
        presale.setUnlock(10_000, 0);
    }

    function test_EnableClaimOnce() public {
        _setupClaim();
        _enableClaim();
        vm.prank(owner);
        vm.expectRevert(BabyGrandPresale.ClaimAlreadyEnabled.selector);
        presale.enableClaim();
    }

    function test_ClaimNotAffectedByPause() public {
        _setupClaim();
        _pause();
        _enableClaim();
        vm.prank(alice);
        presale.claim();
        assertEq(token.balanceOf(alice), 25_000e18);
    }

    function test_ClaimNothing() public {
        _setupClaim();
        _enableClaim();
        vm.prank(bob);
        vm.expectRevert(BabyGrandPresale.NothingToClaim.selector);
        presale.claim();
    }

    function test_SetTokenOnce() public {
        vm.prank(owner);
        vm.expectRevert(BabyGrandPresale.ZeroAddress.selector);
        presale.setToken(address(0));
        vm.prank(owner);
        presale.setToken(address(token));
        assertEq(address(presale.token()), address(token));
        vm.prank(owner);
        vm.expectRevert(BabyGrandPresale.TokenAlreadySet.selector);
        presale.setToken(address(usdt));
    }

    function test_EnableClaimRequiresToken() public {
        vm.prank(owner);
        vm.expectRevert(BabyGrandPresale.TokenNotSet.selector);
        presale.enableClaim();
    }

    // ------------------------------------------------------------ withdrawals

    function test_WithdrawUsdt() public {
        _live();
        _fund(alice, 300e18);
        _buy(alice, 300e18, MAX);
        address to = makeAddr("to");
        vm.prank(owner);
        presale.withdrawUsdt(to);
        assertEq(usdt.balanceOf(to), 300e18);
        assertEq(usdt.balanceOf(address(presale)), 0);
    }

    function test_WithdrawTokens() public {
        _setupClaim();
        address to = makeAddr("to");
        vm.prank(owner);
        presale.withdrawTokens(to, 1_000e18);
        assertEq(token.balanceOf(to), 1_000e18);
    }

    // ------------------------------------------------------------ access control

    function test_OwnerFunctionsOnlyOwner() public {
        bytes memory err = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice);
        vm.startPrank(alice);
        vm.expectRevert(err);
        presale.pause();
        vm.expectRevert(err);
        presale.unpause();
        vm.expectRevert(err);
        presale.setSigner(alice);
        vm.expectRevert(err);
        presale.setTimes(1, 2);
        vm.expectRevert(err);
        presale.setPrice(1);
        vm.expectRevert(err);
        presale.setHardCap(1);
        vm.expectRevert(err);
        presale.setLimits(1, 2);
        vm.expectRevert(err);
        presale.setUnlock(1, 1);
        vm.expectRevert(err);
        presale.setToken(address(token));
        vm.expectRevert(err);
        presale.enableClaim();
        vm.expectRevert(err);
        presale.withdrawUsdt(alice);
        vm.expectRevert(err);
        presale.withdrawTokens(alice, 1);
        vm.expectRevert(err);
        presale.transferOwnership(alice);
        vm.stopPrank();
    }

    function test_Ownable2Step() public {
        vm.prank(owner);
        presale.transferOwnership(bob);
        assertEq(presale.owner(), owner);
        assertEq(presale.pendingOwner(), bob);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        presale.acceptOwnership();
        vm.prank(bob);
        presale.acceptOwnership();
        assertEq(presale.owner(), bob);
        assertEq(presale.pendingOwner(), address(0));
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        presale.pause();
        vm.prank(bob);
        presale.pause();
    }
}
