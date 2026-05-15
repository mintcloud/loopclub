// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title Loopchain v1 (series + bonding-curve editions)
/// @notice One global 16x4 step grid. Cells are rented for N loops; a pattern is recorded as
///         a Series whose first NFT edition is minted at `basePrice`. Subsequent presses mint
///         additional editions of the same Series at a quadratic price:
///         `price(n) = basePrice + alpha * (n - 1)^2`.
///         The recorder/presser receives an NFT but no financial cut — all primary-sale proceeds
///         (minus treasury cut) flow to the Series' co-creators (the cell holders snapshotted at
///         record() time), pro-rata to cells contributed.
contract Loopchain is ERC721, IERC2981, Ownable {
    using SafeERC20 for IERC20;

    // ───────────────────────── Constants ─────────────────────────

    uint8  public constant CELLS = 64;
    uint8  public constant STEPS = 16;
    uint8  public constant SYNTH_CELL_START = 48;
    uint8  public constant PITCH_OPTIONS = 5;
    uint64 public constant LOOP_DURATION_SECONDS = 4;
    uint96 public constant ROYALTY_BPS = 500; // 5%

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

    // Per-cell rental state (live grid).
    mapping(uint8 => address) public cellOwner;
    mapping(uint8 => uint64)  public cellExpiryLoop;
    mapping(uint8 => uint8)   public cellPitch; // synth cells (cellId >= 48), values 0..4

    // Series (one per record()) and per-NFT lookup tables.
    struct Series {
        uint64  pattern;
        uint64  pitches;
        uint64  mintedAtLoop;
        uint32  nextEdition;        // edition number for the NEXT press; 0 means "no series"
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
        uint8 pitchIdx
    );
    event SeriesRecorded(
        uint256 indexed seriesId,
        uint256 indexed tokenId,
        address indexed recorder,
        uint64 pattern,
        uint64 pitches,
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

    // ───────────────────────── Errors ─────────────────────────

    error BadCell();
    error BadDuration();
    error BadPitch();
    error BadSplit();
    error CellOccupied(address occupant, uint64 expiryLoop);
    error EmptyPattern();
    error NotAHolder();
    error NothingToClaim();
    error UnknownSeries();

    // ───────────────────────── Constructor ─────────────────────────

    constructor(address _paymentToken, address _treasury, address _owner)
        ERC721("Loopchain", "LOOP")
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

    /// @notice Live grid pattern (bit i = cell i is currently rented).
    function livePattern() public view returns (uint64 pattern) {
        uint64 nowLoop = currentLoop();
        for (uint8 i = 0; i < CELLS; i++) {
            if (cellOwner[i] != address(0) && cellExpiryLoop[i] > nowLoop) {
                pattern |= (uint64(1) << i);
            }
        }
    }

    /// @notice Live synth pitches (3 bits × 16 synth cells).
    function livePitches() public view returns (uint64 pitches) {
        uint64 nowLoop = currentLoop();
        for (uint8 i = 0; i < STEPS; i++) {
            uint8 cellId = SYNTH_CELL_START + i;
            if (cellOwner[cellId] != address(0) && cellExpiryLoop[cellId] > nowLoop) {
                pitches |= (uint64(cellPitch[cellId]) & 0x7) << (uint64(i) * 3);
            }
        }
    }

    /// @notice Read a Series snapshot.
    function seriesInfo(uint256 seriesId)
        external
        view
        returns (
            uint64 pattern,
            uint64 pitches,
            uint64 mintedAtLoop,
            uint32 nextEdition,
            address[] memory holders,
            uint8[] memory cellsPerHolder
        )
    {
        Series storage s = _series[seriesId];
        return (s.pattern, s.pitches, s.mintedAtLoop, s.nextEdition, s.holders, s.cellsPerHolder);
    }

    /// @notice Convenience: snapshot of the series this token belongs to.
    function loopOf(uint256 tokenId)
        external
        view
        returns (
            uint64 pattern,
            uint64 pitches,
            uint64 mintedAtLoop,
            address[] memory holders,
            uint8[] memory cellsPerHolder
        )
    {
        uint256 sid = seriesOf[tokenId];
        if (sid == 0) revert UnknownSeries();
        Series storage s = _series[sid];
        return (s.pattern, s.pitches, s.mintedAtLoop, s.holders, s.cellsPerHolder);
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

    function toggle(uint8 cellId, uint16 durationLoops, uint8 pitchIdx) external {
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
            if (pitchIdx >= PITCH_OPTIONS) revert BadPitch();
            cellPitch[cellId] = pitchIdx;
        }

        emit CellRented(cellId, msg.sender, newExpiry, pitchIdx);
    }

    // ───────────────────────── Record (mint edition #1, create series) ─────────────────────────

    function record() external returns (uint256 tokenId) {
        uint64 pattern = livePattern();
        if (pattern == 0) revert EmptyPattern();

        uint64 pitches = livePitches();
        uint64 nowLoop = currentLoop();

        uint256 price = basePrice;
        paymentToken.safeTransferFrom(msg.sender, address(this), price);

        // Build dedup'd holder snapshot from the current live pattern.
        (address[] memory uniq, uint8[] memory cnts, uint256 uniqLen, uint256 cellCount)
            = _snapshotHolders(pattern);

        // Distribute. NB: no recorder cut — caller only gets paid if they're also a holder.
        _distribute(price, uniq, cnts, uniqLen, cellCount);

        // Create the series.
        uint256 seriesId = nextSeriesId++;
        Series storage s = _series[seriesId];
        s.pattern = pattern;
        s.pitches = pitches;
        s.mintedAtLoop = nowLoop;
        s.nextEdition = 2; // edition #1 is being minted now
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

        emit SeriesRecorded(seriesId, tokenId, msg.sender, pattern, pitches, nowLoop, uniqLen, price);
    }

    // ───────────────────────── Press (mint next edition of an existing series) ─────────────────────────

    function press(uint256 seriesId) external returns (uint256 tokenId) {
        Series storage s = _series[seriesId];
        uint32 edition = s.nextEdition;
        if (edition == 0) revert UnknownSeries();

        uint256 price = _priceForEdition(edition);
        paymentToken.safeTransferFrom(msg.sender, address(this), price);

        // Distribute to the series' frozen holder set.
        uint256 cellCount = _popcount(s.pattern);
        _distribute(price, s.holders, s.cellsPerHolder, s.holders.length, cellCount);

        // Mint edition #N to the presser.
        tokenId = nextTokenId++;
        seriesOf[tokenId] = seriesId;
        editionOf[tokenId] = edition;
        s.nextEdition = edition + 1;
        _safeMint(msg.sender, tokenId);

        emit SeriesPressed(seriesId, tokenId, msg.sender, edition, price);
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

        uint256 cellCount = _popcount(s.pattern);
        uint256 entitled = (deposited * caller_cells) / cellCount;
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

    /// @notice Sweep payment-token balance not earmarked for royalties.
    function sweepUnattributed(address to, uint256 amount) external onlyOwner {
        paymentToken.safeTransfer(to, amount);
    }

    // ───────────────────────── Internals ─────────────────────────

    function _snapshotHolders(uint64 pattern)
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

    function _popcount(uint64 x) internal pure returns (uint256 c) {
        uint256 v = uint256(x);
        v = v - ((v >> 1) & 0x5555555555555555);
        v = (v & 0x3333333333333333) + ((v >> 2) & 0x3333333333333333);
        v = (v + (v >> 4)) & 0x0f0f0f0f0f0f0f0f;
        c = (v * 0x0101010101010101) >> 56;
    }
}
