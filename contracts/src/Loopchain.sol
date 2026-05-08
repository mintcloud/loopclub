// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title Loopchain v1
/// @notice One global 16x4 step grid. Cells are rented for N loops; pattern is recorded as an NFT.
/// @dev Drum cells (rows 0..2 → cellIds 0..47) are binary on/off.
///      Synth cells (row 3 → cellIds 48..63) carry a 3-bit pentatonic pitch index (0..4).
contract Loopchain is ERC721, IERC2981, Ownable {
    using SafeERC20 for IERC20;

    // ───────────────────────── Constants ─────────────────────────

    uint8 public constant CELLS = 64;
    uint8 public constant STEPS = 16;
    uint8 public constant SYNTH_CELL_START = 48;
    uint8 public constant PITCH_OPTIONS = 5;
    uint64 public constant LOOP_DURATION_SECONDS = 4;
    uint96 public constant ROYALTY_BPS = 500; // 5%

    // ───────────────────────── Storage ─────────────────────────

    IERC20 public immutable paymentToken;

    address public treasury;

    uint256 public rentPerLoop = 0.004e18;       // 0.004 USDm
    uint256 public mintPrice  = 4e18;            // 4 USDm
    uint16  public maxRentDurationLoops = 32;    // ~2 minutes

    // Per-cell rental state
    mapping(uint8 => address) public cellOwner;
    mapping(uint8 => uint64)  public cellExpiryLoop;
    mapping(uint8 => uint8)   public cellPitch; // for synth cells only (cellId >= 48), values 0..4

    // NFT state
    uint256 public nextTokenId = 1;

    struct LoopNFT {
        uint64  pattern;         // bits 0..63: on/off bitmap (read at mint time)
        uint64  pitches;         // bits 0..47: 3 bits per synth cell (16 cells)
        uint64  mintedAtLoop;
        address[] holders;       // unique cell owners snapshot
        uint8[]   cellsPerHolder;// parallel array: how many cells each holder owned
    }
    mapping(uint256 => LoopNFT) private _loops;

    // Royalty bookkeeping (pull-claim)
    mapping(uint256 => uint256) public royaltyDeposited;             // total deposited per token
    mapping(uint256 => mapping(address => uint256)) public royaltyClaimed; // claimed by holder

    // ───────────────────────── Events ─────────────────────────

    event CellRented(
        uint8 indexed cellId,
        address indexed renter,
        uint64 expiryLoop,
        uint8 pitchIdx
    );
    event RecordingMinted(
        uint256 indexed tokenId,
        address indexed recorder,
        uint64 pattern,
        uint64 pitches,
        uint64 mintedAtLoop,
        uint256 holdersCount
    );
    event RoyaltyDeposited(uint256 indexed tokenId, address indexed from, uint256 amount);
    event RoyaltyClaimed(uint256 indexed tokenId, address indexed holder, uint256 amount);
    event TreasuryRotated(address indexed previous, address indexed current);
    event PricesUpdated(uint256 rentPerLoop, uint256 mintPrice, uint16 maxRentDurationLoops);

    // ───────────────────────── Errors ─────────────────────────

    error BadCell();
    error BadDuration();
    error BadPitch();
    error CellOccupied(address occupant, uint64 expiryLoop);
    error EmptyPattern();
    error NotAHolder();
    error NothingToClaim();

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

    /// @notice Live grid pattern as a uint64 bitmap (bit i = cell i is currently rented).
    function livePattern() public view returns (uint64 pattern) {
        uint64 nowLoop = currentLoop();
        for (uint8 i = 0; i < CELLS; i++) {
            if (cellOwner[i] != address(0) && cellExpiryLoop[i] > nowLoop) {
                pattern |= (uint64(1) << i);
            }
        }
    }

    /// @notice Live synth pitches packed: 3 bits × 16 synth cells (only meaningful for currently-rented synth cells).
    function livePitches() public view returns (uint64 pitches) {
        uint64 nowLoop = currentLoop();
        for (uint8 i = 0; i < STEPS; i++) {
            uint8 cellId = SYNTH_CELL_START + i;
            if (cellOwner[cellId] != address(0) && cellExpiryLoop[cellId] > nowLoop) {
                pitches |= (uint64(cellPitch[cellId]) & 0x7) << (uint64(i) * 3);
            }
        }
    }

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
        LoopNFT storage l = _loops[tokenId];
        return (l.pattern, l.pitches, l.mintedAtLoop, l.holders, l.cellsPerHolder);
    }

    // ───────────────────────── Toggle (rent a cell) ─────────────────────────

    function toggle(uint8 cellId, uint16 durationLoops, uint8 pitchIdx) external {
        if (cellId >= CELLS) revert BadCell();
        if (durationLoops == 0 || durationLoops > maxRentDurationLoops) revert BadDuration();

        uint64 nowLoop = currentLoop();
        address occupant = cellOwner[cellId];
        uint64 expiry    = cellExpiryLoop[cellId];

        // Collision: another address still holds the cell.
        if (occupant != address(0) && occupant != msg.sender && expiry > nowLoop) {
            revert CellOccupied(occupant, expiry);
        }

        // Charge rent.
        uint256 cost = rentPerLoop * uint256(durationLoops);
        paymentToken.safeTransferFrom(msg.sender, address(this), cost);

        // Update ownership.
        cellOwner[cellId] = msg.sender;

        // If renewing your own active cell, extend from old expiry. Otherwise start at nowLoop.
        uint64 baseLoop = (occupant == msg.sender && expiry > nowLoop) ? expiry : nowLoop;
        uint64 newExpiry = baseLoop + uint64(durationLoops);
        cellExpiryLoop[cellId] = newExpiry;

        // Synth cells carry pitch.
        if (cellId >= SYNTH_CELL_START) {
            if (pitchIdx >= PITCH_OPTIONS) revert BadPitch();
            cellPitch[cellId] = pitchIdx;
        }

        emit CellRented(cellId, msg.sender, newExpiry, pitchIdx);
    }

    // ───────────────────────── Record (mint NFT) ─────────────────────────

    function record() external returns (uint256 tokenId) {
        uint64 pattern = livePattern();
        if (pattern == 0) revert EmptyPattern();

        uint64 pitches = livePitches();
        uint64 nowLoop = currentLoop();

        // Charge mintPrice from recorder.
        paymentToken.safeTransferFrom(msg.sender, address(this), mintPrice);

        // Snapshot holders. Build unique-holder list with parallel cellsPerHolder count.
        // Worst case: 64 unique holders. Linear-scan dedupe is fine for this size.
        address[] memory uniq = new address[](CELLS);
        uint8[]   memory cnts = new uint8[](CELLS);
        uint256 uniqLen = 0;

        for (uint8 i = 0; i < CELLS; i++) {
            if ((pattern >> i) & 1 == 0) continue;
            address h = cellOwner[i];
            // Dedupe.
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

        // Distribute mint proceeds: 80% holders pro-rata to cells, 10% recorder, 10% treasury.
        uint256 holdersCut  = (mintPrice * 80) / 100;
        uint256 recorderCut = (mintPrice * 10) / 100;
        uint256 treasuryCut = mintPrice - holdersCut - recorderCut;

        // Pro-rata across active cells (livePattern bit count).
        uint256 cellCount = _popcount(pattern);
        uint256 perCell = holdersCut / cellCount;

        // Pay each holder their cells * perCell.
        for (uint256 k = 0; k < uniqLen; k++) {
            uint256 amt = perCell * uint256(cnts[k]);
            if (amt > 0) paymentToken.safeTransfer(uniq[k], amt);
        }
        // Dust from rounding stays in contract (ignored at this scale).
        paymentToken.safeTransfer(msg.sender, recorderCut);
        paymentToken.safeTransfer(treasury, treasuryCut);

        // Mint NFT and store snapshot.
        tokenId = nextTokenId++;
        LoopNFT storage l = _loops[tokenId];
        l.pattern = pattern;
        l.pitches = pitches;
        l.mintedAtLoop = nowLoop;
        l.holders = new address[](uniqLen);
        l.cellsPerHolder = new uint8[](uniqLen);
        for (uint256 k = 0; k < uniqLen; k++) {
            l.holders[k] = uniq[k];
            l.cellsPerHolder[k] = cnts[k];
        }

        _safeMint(msg.sender, tokenId);
        emit RecordingMinted(tokenId, msg.sender, pattern, pitches, nowLoop, uniqLen);
    }

    // ───────────────────────── Royalty (pull-claim) ─────────────────────────

    /// @notice Anyone can deposit royalty for a specific token. v1 leaves marketplace-side
    ///         attribution to a keeper or manual trigger; on-chain marketplaces typically just
    ///         transfer to the contract address without context.
    function depositRoyalty(uint256 tokenId, uint256 amount) external {
        require(_ownerOf(tokenId) != address(0), "no token");
        paymentToken.safeTransferFrom(msg.sender, address(this), amount);
        royaltyDeposited[tokenId] += amount;
        emit RoyaltyDeposited(tokenId, msg.sender, amount);
    }

    function claimRoyalty(uint256 tokenId) external {
        LoopNFT storage l = _loops[tokenId];
        uint256 deposited = royaltyDeposited[tokenId];

        // Find caller's cell count.
        uint8 caller_cells = 0;
        for (uint256 i = 0; i < l.holders.length; i++) {
            if (l.holders[i] == msg.sender) {
                caller_cells = l.cellsPerHolder[i];
                break;
            }
        }
        if (caller_cells == 0) revert NotAHolder();

        uint256 cellCount = _popcount(l.pattern);
        uint256 entitled = (deposited * caller_cells) / cellCount;
        uint256 already = royaltyClaimed[tokenId][msg.sender];
        if (entitled <= already) revert NothingToClaim();

        uint256 owed = entitled - already;
        royaltyClaimed[tokenId][msg.sender] = entitled;
        paymentToken.safeTransfer(msg.sender, owed);
        emit RoyaltyClaimed(tokenId, msg.sender, owed);
    }

    // ───────────────────────── ERC-2981 ─────────────────────────

    /// @dev Marketplace pays royalty to this contract; a keeper calls depositRoyalty(tokenId, amt)
    ///      to attribute it. Without that call, royalty USDm sits unattributed.
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

    function setPrices(uint256 _rentPerLoop, uint256 _mintPrice, uint16 _maxRentDurationLoops) external onlyOwner {
        require(_maxRentDurationLoops > 0, "zero duration");
        rentPerLoop = _rentPerLoop;
        mintPrice = _mintPrice;
        maxRentDurationLoops = _maxRentDurationLoops;
        emit PricesUpdated(_rentPerLoop, _mintPrice, _maxRentDurationLoops);
    }

    /// @notice Sweep payment-token balance not earmarked for royalties. Useful while
    ///         marketplace-royalty attribution flow is still off-chain.
    function sweepUnattributed(address to, uint256 amount) external onlyOwner {
        paymentToken.safeTransfer(to, amount);
    }

    // ───────────────────────── Internals ─────────────────────────

    function _popcount(uint64 x) internal pure returns (uint256 c) {
        // Hamming-weight, branchless. Sufficient for v1 (gas not critical).
        uint256 v = uint256(x);
        v = v - ((v >> 1) & 0x5555555555555555);
        v = (v & 0x3333333333333333) + ((v >> 2) & 0x3333333333333333);
        v = (v + (v >> 4)) & 0x0f0f0f0f0f0f0f0f;
        c = (v * 0x0101010101010101) >> 56;
    }
}
