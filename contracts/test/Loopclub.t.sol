// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {Loopclub} from "../src/Loopclub.sol";
import {MockUsdm} from "../src/MockUsdm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract LoopclubTest is Test {
    Loopclub internal lc;
    MockUsdm internal usdm;

    address internal owner    = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal alice    = makeAddr("alice");
    address internal bob      = makeAddr("bob");
    address internal carol    = makeAddr("carol");
    address internal dave     = makeAddr("dave");

    uint64 constant LOOP_DURATION = 4;

    // First synth cell — track 9 (index 8) starts at cell 128.
    uint8 constant SYNTH0  = 128;
    uint8 constant SYNTH2  = 130;
    uint8 constant SYNTH15 = 143; // last cell of the 144-cell grid

    function setUp() public {
        usdm = new MockUsdm();
        lc = new Loopclub(address(usdm), treasury, owner);

        usdm.mint(alice, 10_000e18);
        usdm.mint(bob,   10_000e18);
        usdm.mint(carol, 10_000e18);
        usdm.mint(dave,  10_000e18);

        vm.prank(alice); usdm.approve(address(lc), type(uint256).max);
        vm.prank(bob);   usdm.approve(address(lc), type(uint256).max);
        vm.prank(carol); usdm.approve(address(lc), type(uint256).max);
        vm.prank(dave);  usdm.approve(address(lc), type(uint256).max);
    }

    // ─────── Toggle / rent ───────

    function test_toggle_chargesRent_andSetsState() public {
        uint256 balBefore = usdm.balanceOf(alice);

        vm.prank(alice);
        lc.toggle(0, 4, 0);

        assertEq(lc.cellOwner(0), alice);
        assertEq(lc.cellExpiryLoop(0), lc.currentLoop() + 4);
        assertEq(usdm.balanceOf(alice), balBefore - 4 * lc.rentPerLoop());
        assertEq(lc.livePattern() & 1, 1);
    }

    function test_toggle_synthCell_storesPitch() public {
        vm.prank(alice);
        lc.toggle(SYNTH2, 2, 3);

        assertEq(lc.cellSynthData(SYNTH2), 3);
        uint256 synthData = lc.liveSynthData();
        // Synth cell index 2 → bits [32..47]; pitch lives in bits 0-2 of that word.
        assertEq((synthData >> 32) & 0x7, 3);
    }

    function test_toggle_revertsOnCollision() public {
        vm.prank(alice); lc.toggle(5, 4, 0);
        vm.prank(bob);
        vm.expectRevert();
        lc.toggle(5, 1, 0);
    }

    function test_toggle_sameOwner_extendsExpiry() public {
        vm.prank(alice); lc.toggle(7, 2, 0);
        uint64 firstExpiry = lc.cellExpiryLoop(7);

        vm.prank(alice); lc.toggle(7, 3, 0);
        uint64 secondExpiry = lc.cellExpiryLoop(7);

        assertEq(secondExpiry, firstExpiry + 3);
    }

    function test_toggle_revertsOnBadDuration() public {
        vm.prank(alice);
        vm.expectRevert();
        lc.toggle(1, 0, 0);

        vm.prank(alice);
        vm.expectRevert();
        lc.toggle(1, 33, 0);
    }

    function test_toggle_revertsOnBadPitch() public {
        // PITCH_OPTIONS is 128 (full MIDI range) → cellData 0..127 valid; 128 reverts
        // (and keeps reserved bits 7-15 zero for future velocity/glide fields).
        vm.prank(alice);
        vm.expectRevert();
        lc.toggle(SYNTH0, 2, 128);
    }

    function test_toggle_synthCell_acceptsFullMidiRange() public {
        // C3 (MIDI 48) — the default center octave on the frontend.
        vm.prank(alice); lc.toggle(SYNTH0, 2, 48);
        assertEq(lc.cellSynthData(SYNTH0), 48);

        // Top of MIDI: G9 = 127.
        vm.prank(bob); lc.toggle(SYNTH15, 2, 127);
        assertEq(lc.cellSynthData(SYNTH15), 127);

        // Both should pack into liveSynthData() at their cell-index offsets.
        uint256 sd = lc.liveSynthData();
        assertEq(sd & 0x7F, 48);                    // idx 0  → bits [0..6]
        assertEq((sd >> (15 * 16)) & 0x7F, 127);    // idx 15 → bits [240..246]
    }

    function test_toggle_revertsOnBadCell() public {
        // CELLS is 144 → cell 144 is out of range.
        vm.prank(alice);
        vm.expectRevert();
        lc.toggle(144, 4, 0);
    }

    function test_toggle_afterExpiry_newOwnerCanRent() public {
        vm.prank(alice); lc.toggle(9, 2, 0);
        vm.warp(block.timestamp + 3 * LOOP_DURATION);
        vm.prank(bob); lc.toggle(9, 1, 0);
        assertEq(lc.cellOwner(9), bob);
    }

    // ─────── 9-track grid ───────

    function test_toggle_highCells_acrossNewTracks() public {
        vm.prank(alice); lc.toggle(100, 4, 0);     // cowbell track
        vm.prank(bob);   lc.toggle(SYNTH0, 4, 0);  // first synth cell
        vm.prank(carol); lc.toggle(SYNTH15, 4, 0); // last cell of the grid

        uint256 p = lc.livePattern();
        assertEq((p >> 100) & 1, 1);
        assertEq((p >> SYNTH0) & 1, 1);
        assertEq((p >> SYNTH15) & 1, 1);
    }

    function test_liveSynthData_packsSixteenBitsPerCell() public {
        vm.prank(alice); lc.toggle(SYNTH0,  8, 1);  // synth idx 0,  pitch 1
        vm.prank(alice); lc.toggle(SYNTH15, 8, 7);  // synth idx 15, pitch 7

        uint256 sd = lc.liveSynthData();
        assertEq(sd & 0xFFFF, 1);                 // idx 0  → bits [0..15]
        assertEq((sd >> (15 * 16)) & 0xFFFF, 7);  // idx 15 → bits [240..255]
    }

    // ─────── Pricing curve ───────

    function test_priceForEdition_quadratic() public view {
        // basePrice=1e18, alpha=0.25e18
        assertEq(lc.priceForEdition(1),  1e18);
        assertEq(lc.priceForEdition(2),  1e18 + 0.25e18 * 1);
        assertEq(lc.priceForEdition(3),  1e18 + 0.25e18 * 4);     // 2.0
        assertEq(lc.priceForEdition(5),  1e18 + 0.25e18 * 16);    // 5.0
        assertEq(lc.priceForEdition(10), 1e18 + 0.25e18 * 81);    // 21.25
        assertEq(lc.priceForEdition(20), 1e18 + 0.25e18 * 361);   // 91.25
    }

    function test_priceForEdition_zeroReturnsBase() public view {
        // Defensive: edition 0 returns basePrice (so callers don't hit underflow).
        assertEq(lc.priceForEdition(0), 1e18);
    }

    // ─────── Record (edition #1) ───────

    function test_record_revertsOnEmptyPattern() public {
        vm.prank(alice);
        vm.expectRevert();
        lc.record();
    }

    function test_record_chargesBasePrice_andCreatesSeries() public {
        vm.prank(alice); lc.toggle(0, 4, 0);
        vm.prank(alice); lc.toggle(1, 4, 0);
        vm.prank(bob);   lc.toggle(2, 4, 0);

        uint256 basePrice    = lc.basePrice();
        uint256 holdersBps   = lc.holdersBps();
        uint256 holdersCut   = (basePrice * holdersBps) / 10_000;
        uint256 treasuryCut  = basePrice - holdersCut;
        uint256 perCell      = holdersCut / 3;

        uint256 aliceBefore    = usdm.balanceOf(alice);
        uint256 bobBefore      = usdm.balanceOf(bob);
        uint256 carolBefore    = usdm.balanceOf(carol);
        uint256 treasuryBefore = usdm.balanceOf(treasury);

        vm.prank(carol);
        uint256 tokenId = lc.record();

        assertEq(tokenId, 1);
        assertEq(lc.ownerOf(tokenId), carol);
        assertEq(lc.seriesOf(tokenId), 1);
        assertEq(lc.editionOf(tokenId), 1);

        // Alice (2 cells) gets 2*perCell, Bob (1) gets 1*perCell, carol (recorder, no cells) pays full basePrice.
        assertEq(usdm.balanceOf(alice) - aliceBefore, perCell * 2);
        assertEq(usdm.balanceOf(bob)   - bobBefore,   perCell * 1);
        assertEq(int256(usdm.balanceOf(carol)) - int256(carolBefore), -int256(basePrice));
        assertEq(usdm.balanceOf(treasury) - treasuryBefore, treasuryCut);
    }

    function test_record_recorderIsAlsoHolder_getsTheirShare() public {
        // Alice contributed AND records. She pays basePrice but receives her holder share.
        vm.prank(alice); lc.toggle(0, 4, 0);
        vm.prank(alice); lc.toggle(1, 4, 0);
        vm.prank(bob);   lc.toggle(2, 4, 0);

        uint256 basePrice  = lc.basePrice();
        uint256 holdersCut = (basePrice * lc.holdersBps()) / 10_000;
        uint256 perCell    = holdersCut / 3;

        uint256 aliceBefore = usdm.balanceOf(alice);

        vm.prank(alice);
        uint256 tokenId = lc.record();
        assertEq(lc.ownerOf(tokenId), alice);

        // Alice's net = -basePrice + 2*perCell (she contributed 2 cells of 3).
        int256 expected = -int256(basePrice) + int256(perCell * 2);
        assertEq(int256(usdm.balanceOf(alice)) - int256(aliceBefore), expected);
    }

    function test_record_storesSnapshot() public {
        vm.prank(alice); lc.toggle(0, 4, 0);
        vm.prank(bob);   lc.toggle(SYNTH2, 4, 2);

        vm.prank(carol);
        uint256 tokenId = lc.record();

        (uint256 pat, uint256 sd, , , , , address[] memory holders, uint8[] memory cells)
            = lc.loopOf(tokenId);

        assertEq(pat & 1, 1);
        assertEq((pat >> SYNTH2) & 1, 1);
        assertEq((sd >> 32) & 0x7, 2);
        assertEq(holders.length, 2);
        assertEq(cells[0], 1);
        assertEq(cells[1], 1);
    }

    function test_record_snapshotsKitScaleSwing() public {
        // Owner sets scale/swing; a paid flip moves the live kit; record() freezes all three.
        vm.prank(owner); lc.setGlobals(3, 6);
        vm.prank(carol); lc.setKit(4);

        vm.prank(alice); lc.toggle(0, 8, 0);
        vm.prank(alice); uint256 tokenId = lc.record();

        (, , , , uint8 k, uint8 sc, uint8 sw, , ) = lc.seriesInfo(lc.seriesOf(tokenId));
        assertEq(k,  4);
        assertEq(sc, 3);
        assertEq(sw, 6);
    }

    // ─────── Press (editions 2+) ───────

    function test_press_chargesQuadratic_andMintsNextEdition() public {
        // Series of two holders.
        vm.prank(alice); lc.toggle(0, 8, 0);
        vm.prank(alice); lc.toggle(1, 8, 0);
        vm.prank(bob);   lc.toggle(2, 8, 0);

        vm.prank(carol);
        uint256 tokenId1 = lc.record();
        uint256 seriesId = lc.seriesOf(tokenId1);

        // Edition #2 should cost basePrice + alpha*1 = 1.25 USDm.
        uint256 expectedPrice = lc.pressPriceFor(seriesId);
        assertEq(expectedPrice, lc.basePrice() + lc.alpha());

        uint256 holdersCut = (expectedPrice * lc.holdersBps()) / 10_000;
        uint256 perCell    = holdersCut / 3;

        uint256 aliceBefore = usdm.balanceOf(alice);
        uint256 bobBefore   = usdm.balanceOf(bob);
        uint256 daveBefore  = usdm.balanceOf(dave);
        uint256 trBefore    = usdm.balanceOf(treasury);

        vm.prank(dave);
        uint256 tokenId2 = lc.press(seriesId);

        assertEq(tokenId2, 2);
        assertEq(lc.ownerOf(tokenId2), dave);
        assertEq(lc.seriesOf(tokenId2), seriesId);
        assertEq(lc.editionOf(tokenId2), 2);

        // Dave paid expectedPrice, alice (2 cells) got 2*perCell, bob (1) got 1*perCell, treasury got rest.
        assertEq(usdm.balanceOf(alice) - aliceBefore, perCell * 2);
        assertEq(usdm.balanceOf(bob)   - bobBefore,   perCell * 1);
        assertEq(int256(usdm.balanceOf(dave)) - int256(daveBefore), -int256(expectedPrice));
        assertEq(usdm.balanceOf(treasury) - trBefore, expectedPrice - holdersCut);

        // pressPriceFor should now advance to edition #3 (alpha*4 = 1.0 → 2.0 USDm).
        assertEq(lc.pressPriceFor(seriesId), lc.basePrice() + lc.alpha() * 4);
    }

    function test_press_unknownSeries_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        lc.press(42);
    }

    function test_press_doesNotRequireCellsToStillBeRented() public {
        // Cells rented for 1 loop; recorder records, then advance time so cells expire, then press.
        vm.prank(alice); lc.toggle(0, 1, 0);
        vm.prank(bob);   lc.toggle(1, 1, 0);

        vm.prank(carol);
        uint256 tokenId1 = lc.record();
        uint256 seriesId = lc.seriesOf(tokenId1);

        // Advance way past cell expiry.
        vm.warp(block.timestamp + 50 * LOOP_DURATION);
        // Live pattern is now empty, but pressing the SERIES should still work.
        assertEq(lc.livePattern(), 0);

        uint256 aliceBefore = usdm.balanceOf(alice);
        vm.prank(dave);
        lc.press(seriesId);

        // Alice (frozen holder) still gets her share.
        assertGt(usdm.balanceOf(alice), aliceBefore);
    }

    function test_press_pricesAdvanceCorrectly_overManyPresses() public {
        vm.prank(alice); lc.toggle(0, 32, 0);
        vm.prank(alice); lc.toggle(0, 32, 0); // extend
        vm.prank(alice); lc.toggle(0, 32, 0); // extend again
        vm.prank(alice); lc.toggle(0, 32, 0); // extend again

        vm.prank(alice);
        uint256 tokenId1 = lc.record();
        uint256 seriesId = lc.seriesOf(tokenId1);

        // Press 4 more times.
        for (uint32 n = 2; n <= 5; n++) {
            uint256 expected = lc.basePrice() + lc.alpha() * uint256(n - 1) * uint256(n - 1);
            assertEq(lc.pressPriceFor(seriesId), expected);
            vm.prank(dave);
            lc.press(seriesId);
        }
        // After 5 total editions (1 record + 4 press), nextEdition should be 6.
        (, , , uint32 nextEd, , , , , ) = lc.seriesInfo(seriesId);
        assertEq(nextEd, 6);
    }

    // ─────── Kit flip (paid global) ───────

    function test_setKit_chargesFee_andSplits50_50() public {
        // alice 2 cells, bob 1 cell — carol (no live cells) flips and pays full freight.
        vm.prank(alice); lc.toggle(0, 8, 0);
        vm.prank(alice); lc.toggle(1, 8, 0);
        vm.prank(bob);   lc.toggle(2, 8, 0);

        uint256 flipFee      = lc.flipFee();                                 // 10 USDm
        uint256 coCreatorCut = (flipFee * lc.FLIP_COCREATOR_BPS()) / 10_000;  // 5 USDm
        uint256 treasuryCut  = flipFee - coCreatorCut;                       // 5 USDm
        uint256 perCell      = coCreatorCut / 3;                             // 3 live cells

        uint256 aliceBefore = usdm.balanceOf(alice);
        uint256 bobBefore   = usdm.balanceOf(bob);
        uint256 carolBefore = usdm.balanceOf(carol);
        uint256 trBefore    = usdm.balanceOf(treasury);

        vm.prank(carol);
        lc.setKit(1);

        assertEq(lc.kitId(), 1);
        // Co-creator half is pushed pro-rata, in this tx (no claim step).
        assertEq(usdm.balanceOf(alice) - aliceBefore, perCell * 2);
        assertEq(usdm.balanceOf(bob)   - bobBefore,   perCell * 1);
        assertEq(usdm.balanceOf(treasury) - trBefore, treasuryCut);
        assertEq(int256(usdm.balanceOf(carol)) - int256(carolBefore), -int256(flipFee));
    }

    function test_setKit_creatorDiscount_ownerOfAllCellsPaysHalf() public {
        // Alice owns 100% of the live cells and flips → the co-creator half routes back to her.
        vm.prank(alice); lc.toggle(0, 8, 0);
        vm.prank(alice); lc.toggle(1, 8, 0);
        vm.prank(alice); lc.toggle(2, 8, 0);

        uint256 flipFee      = lc.flipFee();
        uint256 coCreatorCut = (flipFee * lc.FLIP_COCREATOR_BPS()) / 10_000;
        uint256 perCell      = coCreatorCut / 3;

        uint256 aliceBefore = usdm.balanceOf(alice);

        vm.prank(alice);
        lc.setKit(1);

        // Net = -flipFee + (her 3 cells' share). Owning everything → net ≈ -flipFee/2.
        int256 expected = -int256(flipFee) + int256(perCell * 3);
        assertEq(int256(usdm.balanceOf(alice)) - int256(aliceBefore), expected);
    }

    function test_setKit_noLiveCells_wholeFeeToTreasury() public {
        uint256 flipFee     = lc.flipFee();
        uint256 carolBefore = usdm.balanceOf(carol);
        uint256 trBefore    = usdm.balanceOf(treasury);

        vm.prank(carol);
        lc.setKit(2);

        assertEq(lc.kitId(), 2);
        assertEq(usdm.balanceOf(treasury) - trBefore, flipFee); // no co-creators → all to treasury
        assertEq(int256(usdm.balanceOf(carol)) - int256(carolBefore), -int256(flipFee));
    }

    function test_setKit_revertsOnSameKit() public {
        // kitId starts at 0; flipping to 0 is a no-op and must revert.
        vm.prank(carol);
        vm.expectRevert();
        lc.setKit(0);
    }

    function test_setKit_recordedSeriesKeepsItsKit() public {
        vm.prank(alice); lc.toggle(0, 8, 0);

        vm.prank(carol); lc.setKit(2);                  // live kit → 2
        vm.prank(alice); uint256 tokenId = lc.record(); // series frozen at kit 2
        uint256 seriesId = lc.seriesOf(tokenId);

        vm.prank(bob); lc.setKit(8);                    // live kit → 8

        (, , , , uint8 seriesKit, , , , ) = lc.seriesInfo(seriesId);
        assertEq(seriesKit, 2);  // recorded Series unaffected by the later flip
        assertEq(lc.kitId(), 8); // live grid moved on
    }

    function test_setKit_proRata_acrossThreeHolders() public {
        // alice 3, bob 2, carol 1 — co-creator half splits 3:2:1.
        vm.prank(alice); lc.toggle(0, 8, 0);
        vm.prank(alice); lc.toggle(1, 8, 0);
        vm.prank(alice); lc.toggle(2, 8, 0);
        vm.prank(bob);   lc.toggle(3, 8, 0);
        vm.prank(bob);   lc.toggle(4, 8, 0);
        vm.prank(carol); lc.toggle(5, 8, 0);

        uint256 flipFee      = lc.flipFee();
        uint256 coCreatorCut = (flipFee * lc.FLIP_COCREATOR_BPS()) / 10_000;
        uint256 perCell      = coCreatorCut / 6; // 6 live cells

        uint256 aliceBefore = usdm.balanceOf(alice);
        uint256 bobBefore   = usdm.balanceOf(bob);
        uint256 carolBefore = usdm.balanceOf(carol);

        vm.prank(dave);
        lc.setKit(1);

        assertEq(usdm.balanceOf(alice) - aliceBefore, perCell * 3);
        assertEq(usdm.balanceOf(bob)   - bobBefore,   perCell * 2);
        assertEq(usdm.balanceOf(carol) - carolBefore, perCell * 1);
    }

    // ─────── Royalty (series-keyed) ───────

    function test_royalty_depositAndClaim_perSeries() public {
        vm.prank(alice); lc.toggle(0, 4, 0);
        vm.prank(alice); lc.toggle(1, 4, 0);
        vm.prank(bob);   lc.toggle(2, 4, 0);
        vm.prank(carol);
        uint256 tokenId = lc.record();
        uint256 seriesId = lc.seriesOf(tokenId);

        usdm.mint(address(this), 30e18);
        usdm.approve(address(lc), type(uint256).max);
        lc.depositRoyalty(seriesId, 30e18);

        uint256 aliceBefore = usdm.balanceOf(alice);
        uint256 bobBefore   = usdm.balanceOf(bob);

        vm.prank(alice); lc.claimRoyalty(seriesId);
        vm.prank(bob);   lc.claimRoyalty(seriesId);

        assertEq(usdm.balanceOf(alice) - aliceBefore, 20e18);
        assertEq(usdm.balanceOf(bob)   - bobBefore,   10e18);

        vm.prank(alice);
        vm.expectRevert();
        lc.claimRoyalty(seriesId);
    }

    function test_royalty_nonHolder_reverts() public {
        vm.prank(alice); lc.toggle(0, 4, 0);
        vm.prank(carol); uint256 tokenId = lc.record();
        uint256 seriesId = lc.seriesOf(tokenId);

        usdm.mint(address(this), 1e18);
        usdm.approve(address(lc), type(uint256).max);
        lc.depositRoyalty(seriesId, 1e18);

        vm.prank(bob);
        vm.expectRevert();
        lc.claimRoyalty(seriesId);
    }

    function test_royaltyInfo_returnsContract_5pct() public view {
        (address recv, uint256 amt) = lc.royaltyInfo(0, 1e18);
        assertEq(recv, address(lc));
        assertEq(amt, 0.05e18);
    }

    // ─────── Owner controls ───────

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
        lc.setPrices(0.005e18, 2e18, 0.5e18, 16);
        assertEq(lc.rentPerLoop(), 0.005e18);
        assertEq(lc.basePrice(),   2e18);
        assertEq(lc.alpha(),       0.5e18);
        assertEq(lc.maxRentDurationLoops(), 16);
    }

    function test_setSplit_mustSumTo10000() public {
        vm.prank(owner);
        lc.setSplit(8_000, 2_000);
        assertEq(lc.holdersBps(),  8_000);
        assertEq(lc.treasuryBps(), 2_000);

        vm.prank(owner);
        vm.expectRevert();
        lc.setSplit(8_000, 1_000);
    }

    function test_setGlobals_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        lc.setGlobals(1, 1);

        vm.prank(owner);
        lc.setGlobals(5, 7);
        assertEq(lc.scaleId(), 5);
        assertEq(lc.swing(),   7);
    }

    function test_setFlipFee_onlyOwner_andTakesEffect() public {
        vm.prank(alice);
        vm.expectRevert();
        lc.setFlipFee(20e18);

        vm.prank(owner);
        lc.setFlipFee(20e18);
        assertEq(lc.flipFee(), 20e18);

        // A flip with no live cells now routes the new 20 USDm fee entirely to treasury.
        uint256 trBefore = usdm.balanceOf(treasury);
        vm.prank(carol);
        lc.setKit(1);
        assertEq(usdm.balanceOf(treasury) - trBefore, 20e18);
    }

    // ─────── Regression: holders' cut survives high-numbered cells ───────
    // The old _popcount() SWAR trick mis-counted any pattern with lit cells beyond
    // the first byte (#8+), collapsing the holders' cut to dust. These patterns now
    // also span the top of the widened 144-cell grid (#143).

    function test_press_holdersCut_correctWithHighCells() public {
        vm.prank(alice); lc.toggle(0,       8, 0);
        vm.prank(alice); lc.toggle(SYNTH15, 8, 0);
        vm.prank(bob);   lc.toggle(40,      8, 0);

        vm.prank(carol);
        uint256 tokenId1 = lc.record();
        uint256 seriesId = lc.seriesOf(tokenId1);

        uint256 price      = lc.pressPriceFor(seriesId);
        uint256 holdersCut = (price * lc.holdersBps()) / 10_000;
        uint256 perCell    = holdersCut / 3; // 3 lit cells

        uint256 aliceBefore = usdm.balanceOf(alice);
        uint256 bobBefore   = usdm.balanceOf(bob);

        vm.prank(dave);
        lc.press(seriesId);

        // Alice held 2 of 3 cells, Bob 1 — each gets the full pro-rata cut, not dust.
        assertEq(usdm.balanceOf(alice) - aliceBefore, perCell * 2);
        assertEq(usdm.balanceOf(bob)   - bobBefore,   perCell * 1);
    }

    function test_claimRoyalty_correctWithHighCells() public {
        vm.prank(alice); lc.toggle(0,       4, 0);
        vm.prank(alice); lc.toggle(SYNTH15, 4, 0);
        vm.prank(bob);   lc.toggle(40,      4, 0);
        vm.prank(carol); uint256 tokenId = lc.record();
        uint256 seriesId = lc.seriesOf(tokenId);

        usdm.mint(address(this), 30e18);
        usdm.approve(address(lc), type(uint256).max);
        lc.depositRoyalty(seriesId, 30e18);

        uint256 aliceBefore = usdm.balanceOf(alice);
        uint256 bobBefore   = usdm.balanceOf(bob);

        vm.prank(alice); lc.claimRoyalty(seriesId);
        vm.prank(bob);   lc.claimRoyalty(seriesId);

        // 3 lit cells: alice 2/3 = 20 USDm, bob 1/3 = 10 USDm.
        assertEq(usdm.balanceOf(alice) - aliceBefore, 20e18);
        assertEq(usdm.balanceOf(bob)   - bobBefore,   10e18);
    }

    // ─────── Token metadata (on-chain tokenURI) ───────

    function test_tokenURI_referencesSeriesAndEdition() public {
        vm.prank(alice); lc.toggle(0,  8, 0);
        vm.prank(alice); lc.toggle(44, 8, 0);
        vm.prank(carol); uint256 tokenId1 = lc.record();
        uint256 seriesId = lc.seriesOf(tokenId1);

        vm.prank(dave); uint256 tokenId2 = lc.press(seriesId);

        string memory uri1 = lc.tokenURI(tokenId1);
        string memory uri2 = lc.tokenURI(tokenId2);

        // Both are on-chain base64 JSON data URIs.
        assertTrue(_startsWith(uri1, "data:application/json;base64,"));
        assertTrue(_startsWith(uri2, "data:application/json;base64,"));
        // Editions #1 and #2 of the same loop yield distinct metadata (different edition #).
        assertTrue(keccak256(bytes(uri1)) != keccak256(bytes(uri2)));
    }

    function test_tokenURI_revertsForNonexistentToken() public {
        vm.expectRevert();
        lc.tokenURI(999);
    }

    function _startsWith(string memory s, string memory prefix) internal pure returns (bool) {
        bytes memory sb = bytes(s);
        bytes memory pb = bytes(prefix);
        if (sb.length < pb.length) return false;
        for (uint256 i = 0; i < pb.length; i++) {
            if (sb[i] != pb[i]) return false;
        }
        return true;
    }
}
