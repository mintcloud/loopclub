// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// @title loopclub v1 (series + bonding-curve editions, sound-expansion build)
/// @notice One global 16x9 step grid (16 steps x 9 tracks). Cells are rented for N loops; a
///         pattern is recorded as a Series whose first NFT edition is minted at `basePrice`.
///         Subsequent presses mint additional editions of the same Series at a quadratic price:
///         `price(n) = basePrice + alpha * (n - 1)^2`.
///         The recorder/presser receives an NFT but no financial cut — all primary-sale proceeds
///         (minus treasury cut) flow to the Series' co-creators (the cell holders snapshotted at
///         record() time), pro-rata to cells contributed.
///         Three globals colour the live grid: `kitId` (the sound kit), `scaleId` and `swing`.
///         `scaleId`/`swing` are owner-curated; `kitId` is community-flippable — anyone can call
///         the paid `setKit` flip (fee split 50% treasury / 50% to live-cell co-creators).
///         All three are snapshotted into a Series at record() time and frozen on the minted NFT.
///         Each NFT carries a fully on-chain `tokenURI`: its name states the exact Series (loop)
///         and edition number, so editions #1..#N of a loop are explicitly tied to that loop.
contract loopclub is ERC721, IERC2981, Ownable {
    using SafeERC20 for IERC20;

    // ───────────────────────── Constants ─────────────────────────

    uint8  public constant STEPS = 16;
    uint8  public constant TRACKS = 9;
    uint8  public constant CELLS = 144;          // STEPS * TRACKS
    uint8  public constant SYNTH_CELL_START = 128; // track 9 (index 8) → 8 * 16
    uint16 public constant PITCH_OPTIONS = 128;  // full MIDI note range (0..127), 7-bit
    uint64 public constant LOOP_DURATION_SECONDS = 4;
    uint96 public constant ROYALTY_BPS = 500;    // 5%
    uint16 public constant FLIP_COCREATOR_BPS = 5_000; // 50% of a kit-flip fee → co-creators

    // ───────────────────────── Storage ─────────────────────────

    IERC20 public immutable paymentToken;

    address public treasury;

    uint256 public rentPerLoop = 0.004e18;       // 0.004 USDm
    uint16  public maxRentDurationLoops = 32;    // ~2 minutes

    // Bonding curve: price(edition n) = basePrice + alpha * (n-1)^2.
    // basePrice = price for edition #1 (the recorder mint).
    uint256 public basePrice = 1e18;             // 1 USDm
    uint256 public alpha     = 0.25e18;          // 0.25 USDm per (n-1)^2

    // Primary-sale split (basis points, must sum to 10_000): holders / treasury.
    uint16 public holdersBps  = 7_000;
    uint16 public treasuryBps = 3_000;

    // Kit-flip fee (USDm). Owner-tunable, like the prices. Split is the constant FLIP_COCREATOR_BPS.
    uint256 public flipFee = 10e18;              // 10 USDm

    // Live-grid globals, snapshotted into each Series at record() time.
    uint8 public kitId;    // the live kit — mutated by the paid setKit() flip; anyone can flip
    uint8 public scaleId;  // owner-set — the scale every loop is keyed to
    uint8 public swing;    // owner-set — the swing amount the live grid plays with

    // Per-cell rental state (live grid).
    mapping(uint8 => address) public cellOwner;
    mapping(uint8 => uint64)  public cellExpiryLoop;
    mapping(uint8 => uint16)  public cellSynthData; // synth cells (cellId >= 128); bits 0-6 = MIDI note

    // Series (one per record()) and per-NFT lookup tables.
    struct Series {
        uint256 pattern;            // 144-bit live-grid snapshot
        uint256 synthData;          // 16 bits x 16 synth cells (see Appendix layout)
        uint64  mintedAtLoop;
        uint32  nextEdition;        // edition number for the NEXT press; 0 means "no series"
        uint16  cellCount;          // lit cells in `pattern`, snapshotted at record() time
        uint8   kitId;              // kit this Series was recorded with — frozen
        uint8   scaleId;            // scale at record() time — frozen
        uint8   swing;              // swing at record() time — frozen
        address[] holders;          // unique cell owners at record time
        uint8[]   cellsPerHolder;   // parallel array
    }
    mapping(uint256 => Series) private _series;
    mapping(uint256 => uint256) public seriesOf;   // tokenId → seriesId
    mapping(uint256 => uint32)  public editionOf;  // tokenId → edition number (1, 2, 3, ...)
    uint256 public nextSeriesId = 1;
    uint256 public nextTokenId  = 1;

    // Royalty bookkeeping (pull-claim) — keyed by SERIES (all editions share the same co-creators).
    mapping(uint256 => uint256) public royaltyDepositedSeries;                       // seriesId → total deposited
    mapping(uint256 => mapping(address => uint256)) public royaltyClaimedSeries;     // seriesId → holder → claimed

    // ───────────────────────── Events ─────────────────────────

    event CellRented(
        uint8 indexed cellId,
        address indexed renter,
        uint64 expiryLoop,
        uint16 cellData
    );
    event SeriesRecorded(
        uint256 indexed seriesId,
        uint256 indexed tokenId,
        address indexed recorder,
        uint256 pattern,
        uint256 synthData,
        uint64 mintedAtLoop,
        uint256 holdersCount,
        uint256 pricePaid
    );
    event SeriesPressed(
        uint256 indexed seriesId,
        uint256 indexed tokenId,
        address indexed presser,
        uint32 edition,
        uint256 pricePaid
    );
    event RoyaltyDeposited(uint256 indexed seriesId, address indexed from, uint256 amount);
    event RoyaltyClaimed(uint256 indexed seriesId, address indexed holder, uint256 amount);
    event TreasuryRotated(address indexed previous, address indexed current);
    event PricesUpdated(uint256 rentPerLoop, uint256 basePrice, uint256 alpha, uint16 maxRentDurationLoops);
    event SplitUpdated(uint16 holdersBps, uint16 treasuryBps);
    event KitFlipped(address indexed flipper, uint8 oldKit, uint8 newKit, uint256 feePaid);
    event GlobalsUpdated(uint8 scaleId, uint8 swing);
    event FlipFeeUpdated(uint256 flipFee);

    // ───────────────────────── Errors ─────────────────────────

    error BadCell();
    error BadDuration();
    error BadPitch();
    error BadSplit();
    error CellOccupied(address occupant, uint64 expiryLoop);
    error EmptyPattern();
    error KitUnchanged();
    error NotAHolder();
    error NothingToClaim();
    error UnknownSeries();

    // ───────────────────────── Constructor ─────────────────────────

    constructor(address _paymentToken, address _treasury, address _owner)
        ERC721("loopclub", "LOOP")
        Ownable(_owner)
    {
        paymentToken = IERC20(_paymentToken);
        treasury = _treasury;
        emit TreasuryRotated(address(0), _treasury);
    }

    // ───────────────────────── Public read ─────────────────────────

    function currentLoop() public view returns (uint64) {
        return uint64(block.timestamp / LOOP_DURATION_SECONDS);
    }

    /// @notice Live grid pattern (bit i = cell i is currently rented). 144 cells → one uint256.
    function livePattern() public view returns (uint256 pattern) {
        uint64 nowLoop = currentLoop();
        for (uint8 i = 0; i < CELLS; i++) {
            if (cellOwner[i] != address(0) && cellExpiryLoop[i] > nowLoop) {
                pattern |= (uint256(1) << i);
            }
        }
    }

    /// @notice Live synth word — 16 bits per synth cell, 16 synth cells → one uint256.
    ///         v1 uses only bits 0-6 of each cell (MIDI note number, 0..127); bits 7-15 are
    ///         reserved for future per-cell fields (velocity, glide, etc.).
    function liveSynthData() public view returns (uint256 synthData) {
        uint64 nowLoop = currentLoop();
        for (uint8 i = 0; i < STEPS; i++) {
            uint8 cellId = SYNTH_CELL_START + i;
            if (cellOwner[cellId] != address(0) && cellExpiryLoop[cellId] > nowLoop) {
                synthData |= uint256(cellSynthData[cellId]) << (uint256(i) * 16);
            }
        }
    }

    /// @notice Read a Series snapshot.
    function seriesInfo(uint256 seriesId)
        external
        view
        returns (
            uint256 pattern,
            uint256 synthData,
            uint64 mintedAtLoop,
            uint32 nextEdition,
            uint8 kitId_,
            uint8 scaleId_,
            uint8 swing_,
            address[] memory holders,
            uint8[] memory cellsPerHolder
        )
    {
        Series storage s = _series[seriesId];
        return (
            s.pattern, s.synthData, s.mintedAtLoop, s.nextEdition,
            s.kitId, s.scaleId, s.swing, s.holders, s.cellsPerHolder
        );
    }

    /// @notice Convenience: snapshot of the series this token belongs to.
    function loopOf(uint256 tokenId)
        external
        view
        returns (
            uint256 pattern,
            uint256 synthData,
            uint64 mintedAtLoop,
            uint8 kitId_,
            uint8 scaleId_,
            uint8 swing_,
            address[] memory holders,
            uint8[] memory cellsPerHolder
        )
    {
        uint256 sid = seriesOf[tokenId];
        if (sid == 0) revert UnknownSeries();
        Series storage s = _series[sid];
        return (
            s.pattern, s.synthData, s.mintedAtLoop,
            s.kitId, s.scaleId, s.swing, s.holders, s.cellsPerHolder
        );
    }

    /// @notice Price (in USDm wei) the next presser will pay for a given series.
    function pressPriceFor(uint256 seriesId) public view returns (uint256) {
        uint32 n = _series[seriesId].nextEdition;
        if (n == 0) revert UnknownSeries();
        return _priceForEdition(n);
    }

    /// @notice Price for a specific edition number (1, 2, 3, …). Pure helper.
    function priceForEdition(uint32 edition) external view returns (uint256) {
        return _priceForEdition(edition);
    }

    function _priceForEdition(uint32 edition) internal view returns (uint256) {
        if (edition <= 1) return basePrice;
        uint256 diff = uint256(edition) - 1;
        return basePrice + alpha * diff * diff;
    }

    // ───────────────────────── Toggle (rent a cell) ─────────────────────────

    /// @param cellData For synth cells (cellId >= SYNTH_CELL_START), the 16-bit synth word.
    ///        v1 stores a 7-bit MIDI note number (0..127) in bits 0-6; bits 7-15 must be zero
    ///        (reserved for velocity/glide/future per-cell fields). Ignored for drum cells,
    ///        which are binary on/off.
    function toggle(uint8 cellId, uint16 durationLoops, uint16 cellData) external {
        if (cellId >= CELLS) revert BadCell();
        if (durationLoops == 0 || durationLoops > maxRentDurationLoops) revert BadDuration();

        uint64 nowLoop = currentLoop();
        address occupant = cellOwner[cellId];
        uint64 expiry    = cellExpiryLoop[cellId];

        if (occupant != address(0) && occupant != msg.sender && expiry > nowLoop) {
            revert CellOccupied(occupant, expiry);
        }

        uint256 cost = rentPerLoop * uint256(durationLoops);
        paymentToken.safeTransferFrom(msg.sender, address(this), cost);

        cellOwner[cellId] = msg.sender;
        uint64 baseLoop = (occupant == msg.sender && expiry > nowLoop) ? expiry : nowLoop;
        uint64 newExpiry = baseLoop + uint64(durationLoops);
        cellExpiryLoop[cellId] = newExpiry;

        if (cellId >= SYNTH_CELL_START) {
            // v1: cellData is the 7-bit MIDI note number (0..127). PITCH_OPTIONS = 128 enforces
            // both the range AND that reserved bits 7-15 are zero — they're held for velocity /
            // glide / future per-cell fields (frontend-only, no redeploy needed).
            if (cellData >= PITCH_OPTIONS) revert BadPitch();
            cellSynthData[cellId] = cellData;
        }

        emit CellRented(cellId, msg.sender, newExpiry, cellData);
    }

    // ───────────────────────── Record (mint edition #1, create series) ─────────────────────────

    function record() external returns (uint256 tokenId) {
        uint256 pattern = livePattern();
        if (pattern == 0) revert EmptyPattern();

        uint256 synthData = liveSynthData();
        uint64 nowLoop = currentLoop();

        uint256 price = basePrice;
        paymentToken.safeTransferFrom(msg.sender, address(this), price);

        // Build dedup'd holder snapshot from the current live pattern.
        (address[] memory uniq, uint8[] memory cnts, uint256 uniqLen, uint256 cellCount)
            = _snapshotHolders(pattern);

        // Distribute. NB: no recorder cut — caller only gets paid if they're also a holder.
        _distribute(price, uniq, cnts, uniqLen, cellCount);

        // Create the series — pattern, synth word, and the three live globals are all frozen here.
        uint256 seriesId = nextSeriesId++;
        Series storage s = _series[seriesId];
        s.pattern = pattern;
        s.synthData = synthData;
        s.mintedAtLoop = nowLoop;
        s.nextEdition = 2; // edition #1 is being minted now
        s.cellCount = uint16(cellCount); // frozen lit-cell count; used for all later splits
        s.kitId = kitId;     // whatever the last paid flip left live
        s.scaleId = scaleId;
        s.swing = swing;
        s.holders = new address[](uniqLen);
        s.cellsPerHolder = new uint8[](uniqLen);
        for (uint256 k = 0; k < uniqLen; k++) {
            s.holders[k] = uniq[k];
            s.cellsPerHolder[k] = cnts[k];
        }

        // Mint edition #1 to the recorder.
        tokenId = nextTokenId++;
        seriesOf[tokenId] = seriesId;
        editionOf[tokenId] = 1;
        _safeMint(msg.sender, tokenId);

        emit SeriesRecorded(seriesId, tokenId, msg.sender, pattern, synthData, nowLoop, uniqLen, price);
    }

    // ───────────────────────── Press (mint next edition of an existing series) ─────────────────────────

    function press(uint256 seriesId) external returns (uint256 tokenId) {
        Series storage s = _series[seriesId];
        uint32 edition = s.nextEdition;
        if (edition == 0) revert UnknownSeries();

        uint256 price = _priceForEdition(edition);
        paymentToken.safeTransferFrom(msg.sender, address(this), price);

        // Distribute to the series' frozen holder set, using the lit-cell count
        // captured at record() time.
        _distribute(price, s.holders, s.cellsPerHolder, s.holders.length, s.cellCount);

        // Mint edition #N to the presser.
        tokenId = nextTokenId++;
        seriesOf[tokenId] = seriesId;
        editionOf[tokenId] = edition;
        s.nextEdition = edition + 1;
        _safeMint(msg.sender, tokenId);

        emit SeriesPressed(seriesId, tokenId, msg.sender, edition, price);
    }

    // ───────────────────────── Kit flip (paid global, anyone) ─────────────────────────

    /// @notice Flip the live kit. Anyone may call; costs `flipFee` USDm, split 50% to the
    ///         treasury and 50% pushed pro-rata to the live-cell co-creators inside this tx.
    ///         The flip moves the LIVE grid's kit only — a recorded Series keeps the kit it was
    ///         recorded with, forever. Sticky, no cooldown by design (see master spec §3).
    /// @dev    Co-creators are pushed directly (`safeTransfer`), the same as `_distribute` does
    ///         for a primary sale: the flip is a direct-sale-shaped event (payer = msg.sender,
    ///         money in hand, recipient set known now), so there is no pull-claim path.
    function setKit(uint8 newKitId) external {
        if (newKitId == kitId) revert KitUnchanged();

        // Effects before interactions (plain ERC-20 has no callback, but keep CEI as a matter of form).
        uint8 oldKit = kitId;
        kitId = newKitId;

        paymentToken.safeTransferFrom(msg.sender, address(this), flipFee);

        uint256 coCreatorCut = (flipFee * FLIP_COCREATOR_BPS) / 10_000;
        uint256 treasuryCut  = flipFee - coCreatorCut;

        // Co-creator set = live-cell owners at the instant of the flip (drum + synth).
        (address[] memory uniq, uint8[] memory cnts, uint256 uniqLen, uint256 cellCount)
            = _snapshotHolders(livePattern());

        if (cellCount > 0 && uniqLen > 0) {
            uint256 perCell = coCreatorCut / cellCount;
            for (uint256 k = 0; k < uniqLen; k++) {
                uint256 amt = perCell * uint256(cnts[k]);
                if (amt > 0) paymentToken.safeTransfer(uniq[k], amt);
            }
            // Rounding dust stays in the contract (sweepable by owner) — as in _distribute.
        } else {
            // No live cells → no co-creators → the whole fee goes to treasury.
            treasuryCut = flipFee;
        }

        paymentToken.safeTransfer(treasury, treasuryCut);

        emit KitFlipped(msg.sender, oldKit, newKitId, flipFee);
    }

    // ───────────────────────── Royalty (pull-claim, series-keyed) ─────────────────────────

    /// @notice Anyone can deposit secondary-sale royalty for a specific series. Marketplaces typically
    ///         transfer to the contract address without context; a keeper invokes this with attribution.
    function depositRoyalty(uint256 seriesId, uint256 amount) external {
        if (_series[seriesId].nextEdition == 0) revert UnknownSeries();
        paymentToken.safeTransferFrom(msg.sender, address(this), amount);
        royaltyDepositedSeries[seriesId] += amount;
        emit RoyaltyDeposited(seriesId, msg.sender, amount);
    }

    function claimRoyalty(uint256 seriesId) external {
        Series storage s = _series[seriesId];
        if (s.nextEdition == 0) revert UnknownSeries();
        uint256 deposited = royaltyDepositedSeries[seriesId];

        uint8 caller_cells = 0;
        for (uint256 i = 0; i < s.holders.length; i++) {
            if (s.holders[i] == msg.sender) {
                caller_cells = s.cellsPerHolder[i];
                break;
            }
        }
        if (caller_cells == 0) revert NotAHolder();

        uint256 entitled = (deposited * caller_cells) / s.cellCount;
        uint256 already = royaltyClaimedSeries[seriesId][msg.sender];
        if (entitled <= already) revert NothingToClaim();

        uint256 owed = entitled - already;
        royaltyClaimedSeries[seriesId][msg.sender] = entitled;
        paymentToken.safeTransfer(msg.sender, owed);
        emit RoyaltyClaimed(seriesId, msg.sender, owed);
    }

    // ───────────────────────── ERC-2981 ─────────────────────────

    /// @dev Marketplaces pay royalty to this contract; a keeper attributes per-series via depositRoyalty.
    function royaltyInfo(uint256, uint256 salePrice)
        external
        view
        override
        returns (address, uint256)
    {
        return (address(this), (salePrice * ROYALTY_BPS) / 10_000);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, IERC165) returns (bool) {
        return interfaceId == type(IERC2981).interfaceId || super.supportsInterface(interfaceId);
    }

    // ───────────────────────── Token metadata (fully on-chain) ─────────────────────────

    /// @notice ERC-721 metadata for `tokenId`, generated entirely on-chain as a base64 JSON
    ///         data URI. The token's name states the exact Series (loop) and edition number it
    ///         belongs to — e.g. "loopclub Loop #1 - Edition #2" — and the `Loop`/`Edition`
    ///         attributes encode the same link in structured form. Every edition of a loop
    ///         renders the identical pattern image, since they share the same `Series.pattern`.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId); // reverts ERC721NonexistentToken for unminted ids
        uint256 sid = seriesOf[tokenId];
        uint32  edition = editionOf[tokenId];
        Series storage s = _series[sid];

        string memory sidStr = Strings.toString(sid);
        string memory edStr  = Strings.toString(edition);

        string memory json = string.concat(
            '{"name":"loopclub Loop #', sidStr, ' - Edition #', edStr,
            '","description":"Edition #', edStr, ' of Loop #', sidStr,
            ': a 16-step x 9-track drum pattern recorded on loopclub (MegaETH). Every edition of '
            'this loop shares the same beat and the same co-creators; each press costs more along '
            'the bonding curve.","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(_renderSVG(s.pattern))),
            '","attributes":', _attributes(sid, edition, s), '}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /// @dev Structured trait list. `Loop` + `Edition` are the explicit on-chain link between
    ///      this NFT and the specific loop / position in its 1..N edition run. `Kit`/`Scale`/
    ///      `Swing` are the live globals frozen into the Series at record() time.
    function _attributes(uint256 sid, uint32 edition, Series storage s)
        internal
        view
        returns (string memory)
    {
        return string.concat(
            '[{"trait_type":"Loop","value":', Strings.toString(sid),
            '},{"trait_type":"Edition","value":', Strings.toString(edition),
            '},{"trait_type":"Cells","value":', Strings.toString(s.cellCount),
            '},{"trait_type":"Co-creators","value":', Strings.toString(s.holders.length),
            '},{"trait_type":"Recorded at loop","value":', Strings.toString(s.mintedAtLoop),
            '},{"trait_type":"Kit","value":', Strings.toString(s.kitId),
            '},{"trait_type":"Scale","value":', Strings.toString(s.scaleId),
            '},{"trait_type":"Swing","value":', Strings.toString(s.swing),
            '},{"trait_type":"Pattern","value":"', Strings.toHexString(s.pattern, 18),
            '"}]'
        );
    }

    /// @dev Renders the loop's 16x9 grid as an SVG — 9 track rows (kick / snare / clap-rim /
    ///      closed hat / open hat / cowbell / crash / ride / synth), lit cells filled in their
    ///      track colour. All editions of a series render identically.
    function _renderSVG(uint256 pattern) internal pure returns (string memory) {
        string memory cells = "";
        for (uint8 row = 0; row < TRACKS; row++) {
            for (uint8 col = 0; col < STEPS; col++) {
                uint8 cellId = row * STEPS + col;
                bool lit = (pattern >> cellId) & 1 == 1;
                cells = string.concat(
                    cells,
                    '<rect x="', Strings.toString(12 + uint256(col) * 34),
                    '" y="', Strings.toString(12 + uint256(row) * 34),
                    '" width="30" height="30" rx="5" fill="',
                    lit ? _trackColor(row) : "#2a2a44",
                    '"/>'
                );
            }
        }
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="564" height="326" viewBox="0 0 564 326">',
            '<rect width="564" height="326" fill="#1a1a2e"/>',
            cells,
            '</svg>'
        );
    }

    function _trackColor(uint8 row) internal pure returns (string memory) {
        if (row == 0) return "#ff6b6b"; // kick
        if (row == 1) return "#ffd93d"; // snare
        if (row == 2) return "#ff9f43"; // clap / rim
        if (row == 3) return "#6bcb77"; // closed hat
        if (row == 4) return "#4dd0a8"; // open hat
        if (row == 5) return "#c084fc"; // cowbell
        if (row == 6) return "#f06595"; // crash
        if (row == 7) return "#74c0fc"; // ride
        return "#64b5f6";               // synth
    }

    // ───────────────────────── Owner controls ─────────────────────────

    function setTreasury(address _new) external onlyOwner {
        require(_new != address(0), "zero");
        emit TreasuryRotated(treasury, _new);
        treasury = _new;
    }

    function setPrices(
        uint256 _rentPerLoop,
        uint256 _basePrice,
        uint256 _alpha,
        uint16 _maxRentDurationLoops
    ) external onlyOwner {
        require(_maxRentDurationLoops > 0, "zero duration");
        rentPerLoop = _rentPerLoop;
        basePrice = _basePrice;
        alpha = _alpha;
        maxRentDurationLoops = _maxRentDurationLoops;
        emit PricesUpdated(_rentPerLoop, _basePrice, _alpha, _maxRentDurationLoops);
    }

    function setSplit(uint16 _holdersBps, uint16 _treasuryBps) external onlyOwner {
        if (uint256(_holdersBps) + uint256(_treasuryBps) != 10_000) revert BadSplit();
        holdersBps = _holdersBps;
        treasuryBps = _treasuryBps;
        emit SplitUpdated(_holdersBps, _treasuryBps);
    }

    /// @notice Set the owner-curated live globals — the scale every loop is keyed to and the
    ///         swing the grid plays with. `kitId` is NOT here: it is community-flippable via setKit().
    function setGlobals(uint8 _scaleId, uint8 _swing) external onlyOwner {
        scaleId = _scaleId;
        swing = _swing;
        emit GlobalsUpdated(_scaleId, _swing);
    }

    /// @notice Retune the kit-flip fee. The 50/50 split (FLIP_COCREATOR_BPS) is a constant by design.
    function setFlipFee(uint256 _flipFee) external onlyOwner {
        flipFee = _flipFee;
        emit FlipFeeUpdated(_flipFee);
    }

    /// @notice Sweep payment-token balance not earmarked for royalties.
    function sweepUnattributed(address to, uint256 amount) external onlyOwner {
        paymentToken.safeTransfer(to, amount);
    }

    // ───────────────────────── Internals ─────────────────────────

    function _snapshotHolders(uint256 pattern)
        internal
        view
        returns (address[] memory uniq, uint8[] memory cnts, uint256 uniqLen, uint256 cellCount)
    {
        uniq = new address[](CELLS);
        cnts = new uint8[](CELLS);
        for (uint8 i = 0; i < CELLS; i++) {
            if ((pattern >> i) & 1 == 0) continue;
            address h = cellOwner[i];
            cellCount++;
            bool found = false;
            for (uint256 j = 0; j < uniqLen; j++) {
                if (uniq[j] == h) {
                    cnts[j] += 1;
                    found = true;
                    break;
                }
            }
            if (!found) {
                uniq[uniqLen] = h;
                cnts[uniqLen] = 1;
                uniqLen += 1;
            }
        }
    }

    function _distribute(
        uint256 price,
        address[] memory uniq,
        uint8[] memory cnts,
        uint256 uniqLen,
        uint256 cellCount
    ) internal {
        uint256 holdersCut  = (price * holdersBps) / 10_000;
        uint256 treasuryCut = price - holdersCut;

        if (cellCount > 0 && uniqLen > 0) {
            uint256 perCell = holdersCut / cellCount;
            for (uint256 k = 0; k < uniqLen; k++) {
                uint256 amt = perCell * uint256(cnts[k]);
                if (amt > 0) paymentToken.safeTransfer(uniq[k], amt);
            }
            // Rounding dust stays in the contract (sweepable by owner).
        } else {
            // No holders (shouldn't happen for valid series) — entire share falls through to treasury via sweep.
            treasuryCut = price;
        }

        if (treasuryCut > 0) paymentToken.safeTransfer(treasury, treasuryCut);
    }
}
