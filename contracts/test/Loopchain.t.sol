// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {Loopchain} from "../src/Loopchain.sol";
import {MockUsdm} from "../src/MockUsdm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract LoopchainTest is Test {
    Loopchain internal lc;
    MockUsdm internal usdm;

    address internal owner    = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal alice    = makeAddr("alice");
    address internal bob      = makeAddr("bob");
    address internal carol    = makeAddr("carol");

    uint64 constant LOOP_DURATION = 4;

    function setUp() public {
        usdm = new MockUsdm();
        lc = new Loopchain(address(usdm), treasury, owner);

        // Fund players.
        usdm.mint(alice, 1_000e18);
        usdm.mint(bob,   1_000e18);
        usdm.mint(carol, 1_000e18);

        // Pre-approve.
        vm.prank(alice); usdm.approve(address(lc), type(uint256).max);
        vm.prank(bob);   usdm.approve(address(lc), type(uint256).max);
        vm.prank(carol); usdm.approve(address(lc), type(uint256).max);
    }

    // ─────── Toggle / rent ───────

    function test_toggle_chargesRent_andSetsState() public {
        uint256 balBefore = usdm.balanceOf(alice);

        vm.prank(alice);
        lc.toggle(0, 4, 0); // drum cell, 4 loops

        assertEq(lc.cellOwner(0), alice);
        assertEq(lc.cellExpiryLoop(0), lc.currentLoop() + 4);
        assertEq(usdm.balanceOf(alice), balBefore - 4 * lc.rentPerLoop());

        // Live pattern bit 0 should be set.
        assertEq(lc.livePattern() & 1, 1);
    }

    function test_toggle_synthCell_storesPitch() public {
        vm.prank(alice);
        lc.toggle(50, 2, 3); // synth cell, pitch index 3

        assertEq(lc.cellPitch(50), 3);

        uint64 pitches = lc.livePitches();
        // Cell 50 = synth idx 2; bits 6..8 hold its pitch (3 bits per cell).
        assertEq((pitches >> 6) & 0x7, 3);
    }

    function test_toggle_revertsOnCollision() public {
        vm.prank(alice);
        lc.toggle(5, 4, 0);

        vm.prank(bob);
        vm.expectRevert();
        lc.toggle(5, 1, 0);
    }

    function test_toggle_sameOwner_extendsExpiry() public {
        vm.prank(alice);
        lc.toggle(7, 2, 0);
        uint64 firstExpiry = lc.cellExpiryLoop(7);

        vm.prank(alice);
        lc.toggle(7, 3, 0);
        uint64 secondExpiry = lc.cellExpiryLoop(7);

        assertEq(secondExpiry, firstExpiry + 3);
    }

    function test_toggle_revertsOnBadDuration() public {
        vm.prank(alice);
        vm.expectRevert();
        lc.toggle(1, 0, 0);

        vm.prank(alice);
        vm.expectRevert();
        lc.toggle(1, 33, 0); // > maxRentDurationLoops (32)
    }

    function test_toggle_revertsOnBadPitch() public {
        vm.prank(alice);
        vm.expectRevert();
        lc.toggle(48, 2, 5); // pitch must be < 5
    }

    function test_toggle_afterExpiry_newOwnerCanRent() public {
        vm.prank(alice);
        lc.toggle(9, 2, 0);

        // Advance past expiry.
        vm.warp(block.timestamp + 3 * LOOP_DURATION);

        vm.prank(bob);
        lc.toggle(9, 1, 0);

        assertEq(lc.cellOwner(9), bob);
    }

    // ─────── Record / mint ───────

    function test_record_revertsOnEmptyPattern() public {
        vm.prank(alice);
        vm.expectRevert();
        lc.record();
    }

    function test_record_distributesProceeds_andMints() public {
        // Set up: alice owns 2 cells, bob 1 cell, all live.
        vm.prank(alice); lc.toggle(0, 4, 0);
        vm.prank(alice); lc.toggle(1, 4, 0);
        vm.prank(bob);   lc.toggle(2, 4, 0);

        uint256 mintPrice    = lc.mintPrice();
        uint256 holdersCut   = (mintPrice * 80) / 100;
        uint256 recorderCut  = (mintPrice * 10) / 100;
        uint256 treasuryCut  = mintPrice - holdersCut - recorderCut;
        uint256 perCell      = holdersCut / 3;

        uint256 aliceBefore    = usdm.balanceOf(alice);
        uint256 bobBefore      = usdm.balanceOf(bob);
        uint256 carolBefore    = usdm.balanceOf(carol);
        uint256 treasuryBefore = usdm.balanceOf(treasury);

        vm.prank(carol);
        uint256 tokenId = lc.record();

        assertEq(tokenId, 1);
        assertEq(lc.ownerOf(tokenId), carol);

        // Alice (2 cells) gets 2*perCell. Bob (1 cell) gets 1*perCell.
        assertEq(usdm.balanceOf(alice) - aliceBefore, perCell * 2);
        assertEq(usdm.balanceOf(bob)   - bobBefore,   perCell * 1);
        // Carol pays mintPrice and gets recorderCut back.
        assertEq(int256(usdm.balanceOf(carol)) - int256(carolBefore), int256(recorderCut) - int256(mintPrice));
        assertEq(usdm.balanceOf(treasury) - treasuryBefore, treasuryCut);
    }

    function test_record_storesSnapshot() public {
        vm.prank(alice); lc.toggle(0, 4, 0);
        vm.prank(bob);   lc.toggle(50, 4, 2);

        vm.prank(carol);
        uint256 tokenId = lc.record();

        (uint64 pat, uint64 pit, , address[] memory holders, uint8[] memory cells) = lc.loopOf(tokenId);

        assertEq(pat & 1, 1);                 // bit 0 set
        assertEq((pat >> 50) & 1, 1);         // bit 50 set
        assertEq((pit >> 6) & 0x7, 2);        // synth cell 2 pitch = 2
        assertEq(holders.length, 2);
        assertEq(cells[0], 1);
        assertEq(cells[1], 1);
    }

    // ─────── Royalty ───────

    function test_royalty_depositAndClaim() public {
        // Set up an NFT with two holders.
        vm.prank(alice); lc.toggle(0, 4, 0);
        vm.prank(alice); lc.toggle(1, 4, 0);
        vm.prank(bob);   lc.toggle(2, 4, 0);
        vm.prank(carol);
        uint256 tokenId = lc.record();

        // Simulate a royalty deposit.
        usdm.mint(address(this), 30e18);
        usdm.approve(address(lc), type(uint256).max);
        lc.depositRoyalty(tokenId, 30e18);

        // Each cell should be entitled to 10e18.
        // alice (2 cells) → 20e18, bob (1 cell) → 10e18.
        uint256 aliceBefore = usdm.balanceOf(alice);
        uint256 bobBefore   = usdm.balanceOf(bob);

        vm.prank(alice); lc.claimRoyalty(tokenId);
        vm.prank(bob);   lc.claimRoyalty(tokenId);

        assertEq(usdm.balanceOf(alice) - aliceBefore, 20e18);
        assertEq(usdm.balanceOf(bob)   - bobBefore,   10e18);

        // Second claim by alice should revert (nothing new).
        vm.prank(alice);
        vm.expectRevert();
        lc.claimRoyalty(tokenId);
    }

    function test_royalty_nonHolder_reverts() public {
        vm.prank(alice); lc.toggle(0, 4, 0);
        vm.prank(carol); uint256 tokenId = lc.record();

        usdm.mint(address(this), 1e18);
        usdm.approve(address(lc), type(uint256).max);
        lc.depositRoyalty(tokenId, 1e18);

        vm.prank(bob);
        vm.expectRevert();
        lc.claimRoyalty(tokenId);
    }

    function test_royaltyInfo_returnsContract_5pct() public {
        (address recv, uint256 amt) = lc.royaltyInfo(0, 1e18);
        assertEq(recv, address(lc));
        assertEq(amt, 0.05e18);
    }

    // ─────── Treasury ───────

    function test_setTreasury_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        lc.setTreasury(alice);

        address newT = makeAddr("newTreasury");
        vm.prank(owner);
        lc.setTreasury(newT);
        assertEq(lc.treasury(), newT);
    }

    function test_setPrices_onlyOwner_updatesAll() public {
        vm.prank(owner);
        lc.setPrices(0.005e18, 5e18, 16);
        assertEq(lc.rentPerLoop(), 0.005e18);
        assertEq(lc.mintPrice(),  5e18);
        assertEq(lc.maxRentDurationLoops(), 16);
    }
}
