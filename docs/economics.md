# Loopchain economics v1

*2026-05-08 · for Theo*

---

## TL;DR

- **Your instinct is right.** Pay-to-contribute + revenue-share on mint is the cleanest skin-in-game design for a collaborative on-chain instrument. It also gives the loop a self-cleaning mechanism for free.
- **Pick rent, not toggle-fee.** "Pay 0.0001 ETH per loop" implies *rental for duration* — that's the right primitive. Pay X upfront for N loops, cell auto-expires. Avoid per-toggle flat fees (no decay) and per-block streams (gas overhead, ugly UX).
- **Mint = snapshot of current pattern. Mint fee splits 80% / 10% / 10% across active cell holders / recorder / treasury.** Each filled cell = one share. No weighting by tenure in v1.
- **The system is positive-sum only if mints actually happen.** Most contributors will net negative on most loops — that's expected. Bootstrapping mint demand is the real product problem, not the contract design.
- **Calibration target: rent so cheap that ~1–2 mints break even** (0.000001 ETH/cell/loop, mint price 0.001 ETH). Keep both fees movable by a multisig until you observe behavior.
- **Defer the v2 stuff:** Harberger override, time-slice recordings, royalty on resale, native token, bonding curves. They're all reasonable. None belong in v1.

---

## 1 · The forking question: per-toggle vs per-duration

You hinted at both ("pay to contribute" and "pay for enduring your change for a duration"). They're different primitives:

| Model | What it is | Pros | Cons |
|---|---|---|---|
| **A. Flat per-toggle** | Pay X each time you flip a cell. Cell stays until someone toggles it off. | Trivial to implement. Single fee, no expiry logic. | No decay. A single bad cell stays forever unless someone *also* pays to toggle it off. Spam-resistant only if X is high enough to hurt — but then casual play dies. |
| **B. Pre-paid duration (rent)** | Pay NX upfront. Cell active for N loops, then auto-clears. Holder can renew before expiry. | Built-in decay. Skin in game scales with confidence. Cleans the loop without anyone "policing." | Need expiry tracking. Slightly more contract code. |
| **C. Streamed (per-block rent)** | Cell continuously consumes a balance you've topped up. Stops when balance hits zero. | Most "fair" — you pay only while occupying. | Per-block accounting = gas hell. Bad UX (top-up flows). |
| **D. Harberger** | You name a price; anyone can buy you out at that price. You pay tax proportional to your declared price. | Beautiful price discovery. | Way too complex for v1. The signing UX would be brutal. |

**Recommend B — pre-paid duration rent.** It matches your wording ("0.0001 ETH per loop") and gives you decay for free.

### Concrete v1 rule

```
toggle(cellId, durationLoops) {
    require(durationLoops >= 1 && durationLoops <= 32);   // hard cap on commitment
    require(msg.value >= rentPerLoop * durationLoops);
    require(cells[cellId].expiresAtLoop <= currentLoop);  // cell must be free
    
    cells[cellId] = Cell({
        owner: msg.sender,
        expiresAtLoop: currentLoop + durationLoops,
        rentPaid: msg.value
    });
    pattern |= (1 << cellId);
    rentPool[currentBatch] += msg.value;   // collected for this minting window
    emit CellRented(cellId, msg.sender, durationLoops);
}
```

A cell expires by *time*, not by being toggled off. The loop view is computed lazy: a cell is "on" iff `cells[i].expiresAtLoop > currentLoop`.

A renew is just "extend my expiry by paying more rent" — same function, only callable by current owner before expiry.

A 32-loop cap stops anyone from front-running a future viral pattern by camping a cell for a year. 32 loops at 4s/loop = ~2 minutes max occupancy.

## 2 · The reward side: what does a "mint" mean?

This is the bit that creates the upside — without it, contributors only ever pay. Three sub-questions:

### 2a · What gets recorded?

Two reasonable answers:

| Option | What it is | v1 fit? |
|---|---|---|
| **Snapshot** | NFT captures the pattern at a single block. Plays the same 4-second loop forever. | **Yes.** One uint256 in metadata. Trivial. |
| **Time-slice** | NFT captures all toggles across an N-loop window. Plays back the *evolution* of the loop. | No. Requires logging per-toggle within the window, way more state. v2. |

Go snapshot in v1. Each NFT is a frozen moment of the collective — that's already a meaningful artifact.

### 2b · Mint price

Three options:

- **Fixed price** — every mint costs the same M ETH. Simple, predictable, slightly leaves money on the table for viral loops.
- **Per-loop bonding curve** — mint #1 costs M, mint #2 costs 1.1M, etc. Extracts more from popular loops. More complex.
- **English auction** — recordings are auctioned. Way too slow for the UX.

**v1: fixed price.** Make the price a multisig-tunable param. You'll learn the right number from data.

### 2c · Who gets paid?

Your instinct: "the creator gets paid." But there are 8–32 creators per loop. Distribution rules:

| Rule | What it does | Verdict |
|---|---|---|
| **Equal share per active cell** | If 12 cells filled and you have 3, you get 3/12 of the holder pool. | **Yes for v1.** Simple. Sybil-resistant (you'd just pay yourself rent + recover from your own mints, net zero). |
| **Time-weighted** | Weight by how long cell was held during the recording window | More "fair" but window-based recordings are v2 anyway. |
| **Quality-weighted** | Cells in "popular" loops earn more retroactively | No way to define "quality" on-chain without governance. Skip. |

### Final split for v1

```
Mint fee M flows as:
  80% → split equally across all currently-active cells (paid to cell.owner)
  10% → recorder (the address that called mint())
  10% → treasury (multisig)
```

The 10% recorder kickback is intentional — it incentivizes someone to actually pay to mint a great loop. Without it, you have a free-rider problem (everyone wants the loop archived but nobody wants to pay).

## 3 · Calibration: actual numbers

ETH at $4k. Loop length = 4s.

**Scenario A — your numbers (0.0001 ETH/loop):**
- 1 cell × 1 loop = $0.40
- Average loop has 12 cells filled, runs 100 loops (6m 40s window before something resets) → 12 × 100 × 0.0001 = 0.12 ETH = $480 paid in rent
- For 80% of mint to cover that: need $600 in mint volume = 600 mints at $1 each, or 6 mints at $100 each
- Mint at 0.001 ETH = $4 → need 150 mints in 6m 40s. Not happening.

That's too rich for casual play.

**Scenario B — recommended starting numbers:**
- Rent: **0.000001 ETH/cell/loop** ($0.004 — basically free)
- Mint: **0.001 ETH** ($4 — friction to deter trash mints, low enough to do casually)
- 12 cells × 100 loops × 0.000001 = 0.0012 ETH = $4.80 in rent
- 80% of one mint = $3.20 → break-even at ~1.5 mints
- Two mints in a 6-minute window = profitable for contributors

That's a calibration where playing is cheap, and any loop that gets *any* recognition pays its contributors. Most contributors still net slightly negative (most loops won't get even one mint). That's fine — same as Twitter, most posts get no engagement, the tail is what matters.

**v1 contract should expose all three params behind a multisig:**
```solidity
uint256 public rentPerLoop = 0.000001 ether;
uint256 public mintPrice = 0.001 ether;
uint256 public maxRentDurationLoops = 32;
```

## 4 · Attack & gaming analysis

| Attack | Threat | Defense |
|---|---|---|
| **Spam toggles** | Bad actor floods the loop with garbage cells. | Rent gates it. At 0.000001 ETH/cell/loop, full spam = 32 × 0.000001 × 900 (1hr) = 0.029 ETH/hr ($115). Costly enough that real spam is a paper attack. |
| **Self-mint pumping** | I record my own loops to fake popularity. | I lose 20% of mint value each round (recorder fee + treasury). Pure self-pumping is a money-losing proxy for vanity metrics. Only worth it if external systems care about mint count → don't expose mint count as a primary metric. |
| **Sybil for share inflation** | Split contributions across many wallets to inflate share. | No effect: share is per-cell, not per-wallet. Splitting wallets doesn't change cells held. |
| **Camp-then-record** | I camp empty cells right before a popular loop forms, then record. | The 32-loop cap on rent means you can't camp longer than ~2 min. AND the recorder share is only 10% — most of the value goes to actual cell holders. Marginal. |
| **Front-run record** | Alice sees a great loop, goes to record. Bob front-runs and gets the recorder kickback. | Not really an attack — Alice can record an instant later, both get the same loop NFT (though probably different timestamps/IDs). It's just a 10% kickback race. Acceptable. |
| **Eviction griefing** | I keep my expired cell in a desirable position to deny it to others. | Solved by lazy expiry: "owner" cell expired = cell is free, anyone can rent it. No active eviction needed. |
| **Collusion on shares** | Two wallets coordinate to fill all 32 cells then mint to themselves. | They lose 20% each round (treasury + recorder kickback to one of them, 80% goes back to themselves). Net: -10% per round (treasury). Money-losing collusion. |

The model is mostly self-defending. The single non-financial attack vector is *self-mint pumping for vanity stats* — the mitigation is don't make mint count a leaderboard metric.

## 5 · The actual problem: bootstrap mint demand

The economics work *if mints happen*. If nobody ever mints, contributors only ever pay. That's the v1 product risk.

Five things that drive mint demand:

1. **Make the NFT actually useful.** Each NFT should have a `play()` URL — embed it on a webpage and it plays. Not just a JPEG of the grid. A 4-second sound is sharable, gif-able, postable.
2. **Discord/Twitter integration.** Mint and post via one click. Each mint is an audio-NFT post on X.
3. **Curated daily highlights.** Treasury (10%) funds a daily auto-mint of the "loop of the day" judged by some heuristic (most renewals? most distinct contributors?). Public gallery.
4. **Free first mints.** First N mints/day are free for users with no prior mints. Lowers friction for the "is this thing actually fun?" experiment.
5. **Resale royalties.** Loop NFTs get a 5% royalty on secondary market sales, distributed to the original cell-holder pool. This means famous loops keep paying contributors over time. (ERC-2981 makes this trivial.)

Ship #1 and #5 in v1. #2 and #3 are post-launch growth levers.

## 6 · Updated v1 contract sketch

```solidity
contract Loopchain {
    struct Cell {
        address owner;
        uint64  expiresAtLoop;
        uint128 rentPaid;
    }

    uint256 public pattern;                   // bit i = cell i active (lazy view)
    Cell[32] public cells;
    uint256 public currentLoop;               // ticked by anyone via tick(), or computed from block.timestamp
    uint256 public rentPerLoop = 1e12;        // 0.000001 ETH
    uint256 public mintPrice    = 1e15;       // 0.001 ETH
    uint256 public maxRentDurationLoops = 32;

    // === Rent ===
    function toggle(uint8 cellId, uint16 durationLoops) external payable {
        require(cellId < 32 && durationLoops > 0 && durationLoops <= maxRentDurationLoops);
        require(msg.value >= rentPerLoop * durationLoops);
        require(cells[cellId].expiresAtLoop <= currentLoop, "still rented");

        cells[cellId] = Cell(msg.sender, uint64(currentLoop + durationLoops), uint128(msg.value));
        pattern |= (1 << cellId);

        emit CellRented(cellId, msg.sender, durationLoops, msg.value);
    }

    function renew(uint8 cellId, uint16 extraLoops) external payable {
        require(cells[cellId].owner == msg.sender);
        require(cells[cellId].expiresAtLoop > currentLoop, "already expired");
        require(msg.value >= rentPerLoop * extraLoops);
        cells[cellId].expiresAtLoop += extraLoops;
        cells[cellId].rentPaid     += uint128(msg.value);
    }

    // === Snapshot/mint ===
    function record() external payable returns (uint256 tokenId) {
        require(msg.value >= mintPrice);
        // Determine active cells right now, snapshot pattern
        uint256 livePattern = _livePattern();
        require(livePattern != 0, "empty loop");

        // Mint NFT with livePattern in metadata
        tokenId = _mintNft(msg.sender, livePattern, currentLoop);

        // Distribute mint fee
        uint256 holderShare  = (msg.value * 80) / 100;
        uint256 recorderTip  = (msg.value * 10) / 100;
        uint256 treasuryCut  = msg.value - holderShare - recorderTip;

        uint256 numActive = _popcount(livePattern);
        uint256 perCell   = holderShare / numActive;
        for (uint8 i = 0; i < 32; i++) {
            if (livePattern & (1 << i) != 0) {
                payable(cells[i].owner).transfer(perCell);
            }
        }
        payable(msg.sender).transfer(recorderTip);
        payable(treasury).transfer(treasuryCut);
    }

    function _livePattern() internal view returns (uint256 p) {
        for (uint8 i = 0; i < 32; i++) {
            if (cells[i].expiresAtLoop > currentLoop) p |= (1 << i);
        }
    }
}
```

That's roughly 130 lines including ERC-721 and ERC-2981. Still a one-day build.

A few notes on this:
- `currentLoop` should ideally be derived: `block.timestamp / loopLengthSeconds` rather than a state var, to avoid needing a tick. Saves gas and avoids stalled clocks.
- The `_livePattern` loop runs 32 iterations on every read. Fine for a frontend `eth_call`. But if you want it as a public storage var, you'd need to update on every expiry — too much gas. Keep it computed.
- `transfer` to cell owners blocks if they're a contract that reverts. Use `call{value:}` with success check, or pull-pattern with a `claim()` function. Pull pattern is safer.

## 7 · USDm note

MegaETH has Ethena's USDm subsidizing sequencer fees. For a click-heavy app, denominating rent in USDm not ETH might be worth considering, because:
- ETH price volatility makes "0.000001 ETH" wobble between $0.003 and $0.005 in one week
- USDm transactions are gas-subsidized for the sequencer specifically — could mean cheaper UX for users
- USDm is the canonical stablecoin on MegaETH, integrated into the core economic loop

Argument against: more contract surface (need ERC-20 approvals before toggle), worse first-time UX. ETH is one-call.

**v1: stay in ETH.** Easier. v2: optional USDm path.

## 8 · Open questions for you

A few things I didn't decide:

1. **Empty loops** — should `record()` revert if the pattern is empty (zero cells filled)? My sketch says yes. Could also allow it as a kind of "anti-loop" art statement. Probably revert.
2. **Resale royalty target** — secondary sale 5% royalty. Where does it go? Equal split among the *original* cell holders at mint time, paid via pull-claim? Or all to treasury? My take: split among original holders — that's the strongest "good loops keep paying you" mechanic.
3. **Treasury governance** — multisig fine for v1. But who's on it? Just you for now. Stand up something more legit if/when there's revenue.
4. **Collision policy** — what happens if two people try to toggle the same cell in the same block? First one wins (cell is now rented), second one's tx reverts. They get gas back via revert, but lose the UX moment. Acceptable for v1, but if it happens often, consider a `tryToggle` that just no-ops on conflict.
5. **Soft maximum on `record()` rate** — should there be a cooldown so the same loop pattern can't be recorded 10 times in 5 seconds? Could add a "last record block per pattern" check — same pattern can only be minted once per N loops. Prevents farm-to-self. Worth adding.

---

## Bottom line

Your design works. Pre-paid rent (not toggle fee), snapshot mints, 80/10/10 split, ETH-denominated v1, NFT-as-playable-loop, free first mints to bootstrap, royalties on resale to keep famous loops paying contributors. Calibrate cheap (rent ≈ $0.004/cell/loop, mint ≈ $4) and tune from data.

The contract grows from ~80 lines to ~130. Still vibe-codable in a day. The product risk is mint demand, not the mechanism.
