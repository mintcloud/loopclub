# Loopchain v1 — locked spec + next steps

*2026-05-08 · for Theo*

---

## TL;DR

- All 5 open questions resolved. **Material change vs. last memo: grid expands from 32 → 64 cells (16 steps × 4 tracks) for collision headroom, and the synth track gets a 5-note pentatonic pitch per cell.** Drum tracks stay binary on/off.
- **Payment token is parameterized from day 1.** Testnet ships with a mock USDm. Mainnet ships with real USDm. ETH path doesn't get built — same code, just a different `paymentToken` address at deploy. Saves a refactor.
- **Treasury is a single `address public treasury` with `setTreasury(address)` gated by `onlyOwner`.** Hot wallet at deploy, rotate to Safe (or whatever multisig is live on MegaETH at launch) when ready. Zero contract change required.
- **NFT stores its own `holders[]` snapshot** at mint time. Both primary distribution and ERC-2981 resale royalties pay that exact list — those are "the original holders." Famous loops keep paying their authors forever.
- **What I need from you (4 things):** confirm grid dims, confirm pentatonic key/scale, share your hot wallet address, decide whether to self-deploy Safe or wait.
- **Next concrete step:** I write the v1 contract today, you faucet a hot wallet on testnet, we deploy + run the forge tests + open the explorer. Frontend after that.

---

## 1 · Answers to your 5 answers

### Q1 · Empty loops → revert. Confirmed.

`record()` reverts if `_livePattern() == 0`. No further design impact. (Side note: nobody pays rent on empty cells in any version of the design — rent is per filled cell. So "empty loops should not be rented" is automatic.)

### Q2 · Who are the "original holders"?

The list is **whoever owned the active cells at the moment the NFT was minted**, frozen forever in the NFT's storage. Not the addresses that held the cells across the whole loop's history — just the snapshot at mint time.

Implementation:

```solidity
struct LoopNFT {
    uint64  pattern;           // 64-bit bitmap (16 steps × 4 tracks)
    bytes16 pitches;           // packed pentatonic indices for synth track
    uint64  mintedAtLoop;
    address[] holders;         // snapshot of cell owners — fixed at mint
    uint8[]   cellIds;         // parallel array: which cell each holder owned
}
mapping(uint256 => LoopNFT) public loops;
```

When a secondary sale happens, ERC-2981 returns the contract address as royalty receiver, and the marketplace sends 5% to the contract. The contract holds those funds until original holders call `claimRoyalty(tokenId)`. Each holder pulls their equal-share-per-cell.

Why pull-pattern not push: a marketplace's royalty payment can't loop through 64 holders in a single transfer (gas, plus reverts in any one transfer break all of them). Pull is safer and lets the contract receive batches across multiple sales before any holder claims.

### Q3 · Hot wallet treasury, upgradable.

Confirmed approach:

```solidity
address public treasury;
address public owner;

constructor(address _paymentToken, address _treasury) {
    paymentToken = IERC20(_paymentToken);
    treasury     = _treasury;
    owner        = msg.sender;
}

function setTreasury(address _new) external {
    require(msg.sender == owner, "not owner");
    treasury = _new;
    emit TreasuryRotated(_new);
}
```

**Multisig status on MegaETH:** Safe is on 30+ networks including most major L2s, but I couldn't confirm a canonical Safe deployment on MegaETH specifically. Three paths:

1. **Wait & watch.** Safe almost certainly lands on MegaETH given mainnet is fresh — check `app.safe.global` near launch time.
2. **Self-deploy Safe contracts.** They're open source ([safe-contracts repo](https://github.com/safe-global/safe-smart-account)). Deploy them yourself, point your treasury at the resulting Safe. ~1 hr of work, well-documented.
3. **Skip Safe, use a simpler 2-of-3.** A custom 2-of-3 multisig is ~50 lines of Solidity. Honestly fine for a small revenue treasury. Ugly relative to Safe's UI.

**Recommend path 1 → fall back to 2 if needed.** Until then, hot wallet. Don't block launch on this.

### Q4 · Toggles + collision avoidance.

You're right that 32 cells could feel cramped. Two changes:

#### Change 1: expand grid to 16 steps × 4 tracks = 64 cells

- Loop length stays 4s at 120 BPM, but resolution is now 16th notes (every 250ms) instead of 8th notes (every 500ms). Tighter rhythmic detail.
- 64 cells halves collision probability for the same usage volume.
- Still fits cleanly in a uint256 bitmap (uses only 64 bits).
- Frontend: 16 columns × 4 rows. Phone-friendly with horizontal scroll on mobile, full grid on laptop.

#### Change 2: pentatonic pitch on the synth track only

Drum tracks (kick / snare / hat) stay binary. The synth track's 16 cells each carry a 3-bit pitch index (5 values: pentatonic scale degrees 1-2-3-5-6, with 3 reserved bits). 16 × 3 = 48 bits, fits comfortably in a single `uint64` alongside the bitmap.

```solidity
// Layout:
//   pattern[bits 0..63]     = on/off bitmap, cell 0..63
//   pitches[bits 0..47]     = 3 bits × 16 synth cells (pentatonic index)
uint64 public pattern;
uint64 public pitches;
```

User picks pitch from a dropdown when toggling a synth cell. UX is "click a cell, a tiny note picker pops up, pick C/D/E/G/A". Pentatonic is intentional — it never sounds harmonically wrong, even when other people pick conflicting notes. This is the cheapest way to make the music actually sound good without a music theory engine.

**Collision math after these changes:**

- v0: 32 cells. If 100 people each toggle one random cell, expected collisions ~150 (heavy). 
- v1: 64 cells, with synth cells differentiated by pitch. Effectively ~144 distinct cell-states (48 binary + 16 × 5 pitched + 16 off). Same load → expected collisions ~30. ~5× better.

Not perfect, but good enough that a "tryToggle" no-op-on-collision is genuinely deferrable.

#### What we're NOT doing

- **Per-cell sample variation, velocity, swing, tempo voting** — all interesting, all v2+. Stay rigid: fixed BPM, fixed samples, just on/off + (synth) pitch. Constraint = the artistic primitive.
- **Multiple loops running in parallel ("rooms")** — also v2. v1 is one global loop. Drives concentration, makes the Twitter clip universally meaningful ("THE loop is sick right now"), no fragmentation.

### Q5 · Self-farming — agreed, dropped.

You're right. Treasury (10%) + recorder (10% — which goes to the recorder, who is the same person if self-pumping) = the self-farmer captures 90% of their own mint. So they lose 10% per round. That's a money-losing exploit. No need for a per-pattern cooldown.

### Q6 · USDm — agreed, you win.

You pushed back, you were right. Designing for ETH then refactoring is wasted work. Better to build with `IERC20 paymentToken` parameterized from day 1.

#### Strategy

```solidity
IERC20 public immutable paymentToken;

constructor(address _paymentToken, ...) {
    paymentToken = IERC20(_paymentToken);
}

function toggle(uint8 cellId, uint16 durationLoops, uint8 pitchIdx) external {
    uint256 cost = rentPerLoop * durationLoops;
    paymentToken.transferFrom(msg.sender, address(this), cost);
    // ... rest of toggle logic
}
```

#### Testnet vs mainnet

| Env | `paymentToken` | Why |
|---|---|---|
| **Testnet** | Mock USDm we deploy ourselves (~30 lines of standard ERC-20 with a public `mint()`) | USDm itself probably isn't on testnet, and we want users to play freely without faucet drama. Mock USDm has open mint, anyone can grab 1000 fake USDm. |
| **Mainnet** | Real USDm contract address from Ethena's MegaETH deployment | Same code path, just real money. |

#### UX cost of ERC-20

Approve + transferFrom = two signatures on first interaction. **Mitigations** (in order of preference):

1. **Use EIP-2612 `permit()` if USDm supports it.** Single signature includes the approval. Real USDm probably supports this — Ethena's tooling is mature. We'd wrap `toggle()` to accept an optional permit, falling back to assumed prior approval.
2. **Permit2 (Uniswap's universal permit).** Universal permit contract, even if USDm doesn't natively support EIP-2612. One approval ever (to Permit2), then signed permits per action. Standard on most L2s now.
3. **One-time `approve(MAX_UINT256)`.** Two-tx onboarding flow but only once. Acceptable fallback.

**Plan:** check USDm's interface when their mainnet contract is finalized. If permit is there, use it. If not, Permit2.

#### What we lose

- Slightly more contract code (~20 lines of token plumbing).
- One extra deploy step (deploy mock USDm on testnet first).
- Frontend has to handle approve/permit — wagmi has good hooks for this.

Cost is real but tiny. Worth it. You called it correctly.

---

## 2 · Locked v1 spec

### Grid

- **16 steps × 4 tracks = 64 cells**
- Tracks: `kick` (row 0), `snare` (row 1), `hat` (row 2), `synth` (row 3)
- Synth cells carry a pentatonic pitch (C / D / E / G / A) in addition to on/off
- Loop = 4 seconds @ 120 BPM (16th-note resolution)
- One global loop, no rooms in v1

### Token

- `paymentToken` parameter, immutable, set at deploy
- Testnet: mock USDm with open `mint()` for playtesting
- Mainnet: Ethena USDm (address TBD when finalized)

### Pricing

- `rentPerLoop = 0.004 USDm` per cell per loop
- `mintPrice = 4 USDm`
- `maxRentDurationLoops = 32` (max 2 minutes occupancy per rental)
- All three are owner-tunable

### Mint flow

- `record()` reverts if pattern empty
- Splits **80% holders / 10% recorder / 10% treasury**
- NFT stores holders array + cellIds + pattern + pitches + mintedAtLoop
- ERC-721 + ERC-2981 (5% royalty)
- Royalty pull-pattern: `claimRoyalty(tokenId)` — each holder claims their share

### Treasury

- `address treasury` with `setTreasury` owner-gated
- Initially Theo's hot wallet, rotated to multisig later

### Out of scope for v1

Everything from the previous memo's "v2" list, plus:
- Multiple parallel loops / rooms
- Tempo voting
- Velocity / swing / sample variation
- Per-pattern record cooldown
- Harberger override
- Time-slice recordings

---

## 3 · What I need from you

Four things, none blocking until step 4:

### A. Confirm grid dimensions

Confirm: **16 steps × 4 tracks = 64 cells, drums binary, synth pentatonic.** Or push back. (My case for it: 16th-note resolution gives genuinely danceable patterns, pentatonic synth lets people make melodies that sound good without thinking about theory, total cell count doubles for collision headroom.)

### B. Confirm pentatonic key/scale

I'm proposing **C major pentatonic (C, D, E, G, A)** — universally consonant, works in 80% of pop music, hardest to make sound bad. Alternatives: A minor pentatonic (A, C, D, E, G — moodier), or "dealer's choice" with pitch shift via a global key dropdown later. C major is the safest v1.

### C. Hot wallet address for treasury

I need an address you control on MegaETH testnet. Ideally a Privy embedded or similar that you can also use as deploy account. Or just a fresh MetaMask account funded via testnet faucet.

### D. Decide on multisig path

Three options from §1.Q3:

1. Wait — check Safe on MegaETH at launch time, hot wallet until then.
2. Self-deploy Safe contracts, point treasury at it pre-launch.
3. Custom 2-of-3 multisig, ~50 lines.

My recommendation: **option 1**, lazy. The hot wallet works fine until there's revenue worth protecting. Treasury rotation is one tx whenever you decide.

---

## 4 · Next concrete steps

Phasing is small, ordered, each step shippable independently. **You don't need to do anything until step 6.**

| # | Step | Who | Time | Output |
|---|---|---|---|---|
| 1 | Foundry project init, dependencies (OpenZeppelin ERC-721/2981/IERC20, Permit2 interface) | me | 30m | scaffolded repo |
| 2 | Write `MockUsdm.sol` (open-mint ERC-20 with permit) | me | 30m | one .sol file + test |
| 3 | Write `Loopchain.sol` (full v1 spec) | me | 2h | contract + interfaces |
| 4 | Forge tests: rent, expiry, renewal, record-with-empty-revert, mint distribution, royalty claim, treasury rotation | me | 2h | green test suite |
| 5 | Deploy script for testnet (deploys MockUsdm, then Loopchain pointed at it) | me | 30m | `forge script` ready to run |
| 6 | **You faucet 0.005 testnet ETH** to a hot wallet, share the address with me | you | 5m | deploy creds |
| 7 | I run deploy script with your hot wallet, contracts go live | me | 5m | block explorer links |
| 8 | Frontend scaffold (Vite + wagmi + viem + RainbowKit) | me | 1h | dev server up |
| 9 | Grid component + read flow (pattern decoding, owner color hashing) | me | 2h | grid renders live state |
| 10 | Tone.js scheduler with pentatonic synth | me | 2h | grid plays sound |
| 11 | Toggle + permit flow + record flow | me | 2h | end-to-end usable |
| 12 | WS subscription to events, live updates | me | 1h | magic moment |
| 13 | **You & me play it on two devices** | both | 30m | demo |
| 14 | Twitter / x.com share embed (NFT URL plays the loop) | me | 1h | shareable artifacts |

Total: ~16 hours of build, 35 minutes of you. Realistically over a weekend.

---

## 5 · Risk recheck (post-decisions)

- **USDm not yet stable on MegaETH testnet.** Mitigated by mock token, but verify Ethena's mainnet USDm address before mainnet launch.
- **Permit support unverified.** If USDm has no `permit()`, Permit2 fallback is a small frontend cost, no contract change.
- **Treasury hot wallet drain risk.** Until rotated to multisig: keep treasury balance small. Sweep to a cold wallet daily if revenue accrues.
- **64 holders × pull-claim royalty.** Storage cost per NFT mint is real (64 × 20 bytes for holders + 64 bytes for cellIds = ~1.4 KB on-chain per NFT). At $0.004/kb-equiv on a cheap L2 this is fine. On expensive L1 it'd be prohibitive. MegaETH's storage costs are L2-cheap, so fine.
- **Pentatonic gets boring.** Real risk. Mitigation: v2 ships a key/scale rotation (different key each day, or per-room).

---

## Bottom line

Spec is locked. I have everything I need to start building except your hot wallet address (step 6) — and I don't need that for ~6 hours of work. If you sign off on grid dims (§3.A) and key choice (§3.B) when you read this, I'll start.
