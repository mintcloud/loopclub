# loopclub

One global 16×4 grid drum machine on MegaETH. Cells are rented in USDm; a finished pattern is recorded as a **Series** of NFT editions priced on a bonding curve, and every edition pressed pays the loop's co-creators — the cell owners snapshotted when it was recorded.

**Live:** MegaETH mainnet (chain 4326). loopclub `0x64D8…bf76` · USDm `0xFAfD…79E7`. See [`docs/deployments.md`](docs/deployments.md).

---

## How it works (user flow)

```
 ┌─────────────────┐
 │ 1. Connect      │   Privy login (email/Google) → Kernel smart wallet auto-created.
 │                 │   A fund popover surfaces the deposit address — copy + top up.
 └────────┬────────┘
          │
 ┌────────▼────────┐
 │ 2. Approve once │   One-time max-uint256 approve of USDm → loopclub contract.
 │    (modal)      │   Confirms the long-running spend permission. Modal is intentional.
 └────────┬────────┘
          │
 ┌────────▼────────┐
 │ 3. Toggle cells │   Click a cell → a popover opens right on it. Default 16 loops;
 │    (silent)     │   press T to toggle or M for a max toggle. Smart-wallet userOp
 │                 │   ships without modal. Cell lights up live for everyone watching.
 └────────┬────────┘
          │
 ┌────────▼────────┐
 │ 4. Cells expire │   After N loops (4s each), cell auto-clears. Owner can renew
 │    on time      │   before expiry, or someone else can rent it once expired. Lazy
 │                 │   expiry — no "tick" tx needed.
 └────────┬────────┘
          │
 ┌────────▼────────┐
 │ 5. Record       │   Anyone calls `record()` for `basePrice` (1 USDm). Snapshots the
 │  (Series + #1)  │   live pattern into a new **Series** and mints **edition #1** to the
 │                 │   recorder. The co-creator set (cell owners) is frozen here.
 └────────┬────────┘
          │
 ┌────────▼────────┐
 │ 6. Press        │   Anyone calls `press(seriesId)` to mint edition #N. Price follows
 │  (edition #N)   │   a quadratic curve: `basePrice + alpha·(n−1)²`. Each press splits
 │                 │   70% to the frozen co-creators (pro-rata to cells) / 30% treasury.
 └────────┬────────┘
          │
 ┌────────▼────────┐
 │ 7. Resale       │   ERC-2981 5% royalty → contract → `claimRoyalty(seriesId)` lets
 │   royalties     │   each original co-creator pull their share. Royalties are
 │                 │   series-keyed: every edition feeds one shared pool.
 └─────────────────┘
```

**Key UX guarantees:**
- One approval modal at session start, zero modals on per-cell toggles (`uiOptions.showWalletUIs: false` on the smart-wallet `sendTransaction`).
- Contextual toggle — the popover opens on the clicked cell (default 16 loops); `T` toggles, `M` max-toggles, so there are no mouse round-trips.
- Fund popover surfaces the smart-wallet deposit address on connect, re-openable any time from the header `⊕ fund` button.
- Sub-cent gas on MegaETH; rent and presses are paid in USDm so cost is stable in dollars.
- Lazy expiry — anyone reading `livePattern()` gets the truthful current state without a keeper.

---

## Economics (v1, in production)

Prices are owner-tunable via `setPrices(rentPerLoop, basePrice, alpha, maxRentDurationLoops)`; the primary-sale split via `setSplit(holdersBps, treasuryBps)`. Treasury is rotatable via `setTreasury(addr)`, and accumulated rent is moved out with `sweepUnattributed(to, amount)` — see *Rent collection* below.

| Param | Value | Why |
|---|---|---|
| Loop length | 4 s @ 120 BPM | One bar at the canonical tempo. |
| Grid | 16 steps × 4 tracks = 64 cells | Tight enough for collision pressure, loose enough for collaboration. Tracks: kick / snare / hat / synth. |
| Synth pitch | 3-bit pentatonic (5 of 8 slots used) | Anything you toggle in row 3 sounds in key. Cells 48–63 carry a `pitchIdx` 0..4. |
| Rent | **0.004 USDm / cell / loop** | At ~$0.004 it's effectively free per click; full-grid spam costs ~$1/min. |
| Max rent duration | **32 loops** (~2 min) | Stops anyone from camping a cell across a viral pattern. Renewable. |
| Base price (edition #1) | **1 USDm** | The flat cost to `record()` a loop and mint its first edition. |
| Press curve | `price(n) = basePrice + alpha·(n−1)²`, **alpha = 0.25 USDm** | Quadratic: #2 = 1.25, #5 = 5, #10 = 21.25 USDm. Popular loops get progressively expensive to copy. |
| Primary-sale split | **70 / 30** co-creators / treasury | Recorder/presser get the NFT but no cut — only cell holders earn. Kills rent-extraction by squatters. |
| Royalty | **5% (ERC-2981)** | Series-keyed pull-claim by original co-creators via `claimRoyalty(seriesId)`. |

**Calibration intent:** recording is cheap (1 USDm) so any finished loop is worth pressing once. The quadratic curve means a loop only gets expensive to copy if it's actually wanted — that's the demand signal. Most loops get pressed 0–1 times; the tail is what matters. Tune from data, not theory. Full rationale (and the original one-shot design it replaced) in [`docs/economics.md`](docs/economics.md).

### Record / press mechanics in detail

`record()` does, atomically, in one tx:

1. Reads `livePattern()` (lazy: cells whose `expiresAtLoop > currentLoop()`).
2. Reverts if the pattern is empty.
3. Pulls `basePrice` USDm from the recorder.
4. Counts unique cell holders × cells held, deduped on-chain (≤64 entries, linear scan is fine).
5. Creates a **Series** storing `pattern`, `pitches`, `mintedAtLoop`, and the frozen `holders[]` + `cellsPerHolder[]` co-creator snapshot.
6. Mints **edition #1** (an ERC-721) to the recorder.
7. Splits the `basePrice`: **70%** pro-rata across the co-creators by cells contributed, **30%** to `treasury`. The recorder gets the NFT but no financial cut.
8. Emits `SeriesRecorded`.

`press(seriesId)` mints **edition #N** of an existing series:

1. Computes `price(n) = basePrice + alpha·(n−1)²` for the next edition number.
2. Pulls that price in USDm from the presser.
3. Splits it 70 / 30 across the *same frozen co-creator set* — holders don't need to still own the cells.
4. Mints the edition to the presser and emits `SeriesPressed`.

Co-creators are paid push-style on every record/press (USDm `safeTransfer`). Resale royalties are pull-style and **series-keyed**: marketplaces send the ERC-2981 5% to the contract, anyone calls `depositRoyalty(seriesId, amount)` to attribute it, and each original co-creator pulls their pro-rata share via `claimRoyalty(seriesId)` whenever they want. The frontend Library surfaces a claim button when you have an unclaimed balance.

### Rent collection — accumulate, then sweep

The contract takes in money from two streams, and they are handled differently on purpose.

| Stream | Source | Routing |
|---|---|---|
| **Primary sale** | `record()` / `press()` | Split **immediately**, in the same tx — 70% `safeTransfer`'d to co-creators, 30% to `treasury`. Nothing lingers. |
| **Rent** | `toggle()` | **Accumulates in the contract.** `toggle()` pulls `rentPerLoop × durationLoops` USDm in and leaves it there — it is *not* forwarded per toggle. |

Rent is therefore an unattributed USDm balance that builds up on the contract over time. The **owner** drains it on whatever cadence suits them by calling `sweepUnattributed(to, amount)` — normally `to = treasury`, but the destination is chosen at sweep time, not hard-coded (treasury, a cold wallet, or a multisig — the owner decides each time).

**Why rent isn't auto-routed to the treasury.** `toggle()` is the hot path — it fires on every cell click. Adding a second `safeTransfer` (rent → treasury) inside `toggle()` would charge *every player* extra gas on *every click*, forever, only to spare the owner an occasional sweep transaction. Letting rent pool and draining it with infrequent owner-initiated sweeps keeps the per-click cost minimal and shifts the gas of moving funds onto the operator, who pays it rarely. This is a deliberate gas trade-off, not an oversight.

**Operator note.** `sweepUnattributed` is `onlyOwner` and transfers whatever `amount` is passed — it does *not* enforce the "unattributed" boundary on-chain. The safe-to-sweep balance is the contract's USDm balance **minus** still-unclaimed royalties (Σ `royaltyDepositedSeries` − Σ `royaltyClaimedSeries`). The operator must leave that royalty reserve in place; everything above it is rent plus primary-sale rounding dust.

---

## Status (2026-05-15)

| Layer | State |
|---|---|
| v1 spec | locked, then reworked one-shot → Series + bonding curve — see [`docs/v1-spec.md`](docs/v1-spec.md) |
| Economics | locked — see [`docs/economics.md`](docs/economics.md) |
| Smart-account stack | Kernel via Privy + EIP-7702 — see [`docs/stack-and-7702.md`](docs/stack-and-7702.md) |
| Contracts (`contracts/`) | ✅ built + tested (**23/23**) on Foundry 1.7.1 |
| Bundler / paymaster | configured in Privy dashboard (Kernel MegaETH mainnet endpoints) |
| Hot wallet funding | ✅ `0x6cF2577B57ab7041Ec8815afC768cf73fd9C0Ee3` funded |
| Testnet deploy | chain 6343 — **stale**, runs the old one-shot model (not redeployed) |
| **Mainnet deploy** | ✅ chain 4326 — loopclub `0x64D8…bf76` (Series + bonding curve, deployed 2026-05-15) |
| Frontend (`frontend/`) | ✅ live on Vercel — repoint `VITE_LOOPCLUB_ADDRESS` to the new address + redeploy |
| Toggle UX | ✅ silent (no modal), approve modal preserved |
| Live grid | ✅ event-streamed — `CellRented` over WebSocket (getLogs-poll fallback), cells coloured by owner, block-sync badge |
| Record / press / royalty-claim UI | ✅ wired |
| Session keys | not yet — see "Roadmap" below |

Detailed step-by-step status: [`docs/progress.md`](docs/progress.md).

## Stack (locked)

- **Contracts** — Solidity 0.8.26, OpenZeppelin (ERC-721 + ERC-2981 + Ownable), Foundry.
- **Payment token** — `IERC20` parameter. Testnet uses `MockUsdm` (open faucet). Mainnet uses real Ethena USDm at `0xFAfD…79E7`.
- **Smart wallet** — Kernel via Privy. Not Stateless7702, not MetaMask Smart Accounts Kit.
- **Session keys (planned)** — `@zerodev/sdk` + `@zerodev/permissions`.
- **EIP-7702** — set in client SDK code, defaults to counterfactual mode.
- **Frontend** — Vite + React + TS + Privy SDK + viem + Tone.js.

## Repository layout

```
loopclub/
├── contracts/        # Foundry project — Loopclub.sol + MockUsdm.sol + tests + deploy
├── frontend/         # Vite + React app — live on Vercel
└── docs/
    ├── v1-spec.md            # the on-chain protocol spec
    ├── economics.md          # rent / record / press / split rationale (read this first)
    ├── ux-architecture.md    # FE architecture (note: §3 is superseded by stack-and-7702.md)
    ├── stack-and-7702.md     # current stack + EIP-7702 plan (authoritative)
    ├── deployments.md        # testnet + mainnet addresses
    └── progress.md           # build plan + per-step status
```

## Quick start

### Contracts

```bash
cd contracts
forge install OpenZeppelin/openzeppelin-contracts --no-commit
forge install foundry-rs/forge-std --no-commit
cp .env.example .env   # fill DEPLOYER_PRIVATE_KEY + MEGAETH_MAINNET_RPC
forge build
forge test -vv
```

Deploy:

```bash
forge script script/Deploy.s.sol:Deploy --rpc-url megaeth_mainnet --broadcast -vvv
```

`forge` auto-loads `.env`. `PAYMENT_TOKEN` selects the payment token (real USDm on mainnet; unset on testnet to deploy a fresh `MockUsdm`). `TREASURY` defaults to the deployer if unset.

### Frontend

```bash
cd frontend
cp .env.example .env.local   # mainnet addresses already in .env.example
npm install
npm run dev
```

## Roadmap (post-v1)

- **Session keys** — install a permission-scoped key on the Kernel account at login (target = loopclub, selectors = `toggle` / `record` / `press`, valid 24h). All toggles sign locally — sub-50ms latency, no Privy roundtrip. Today's `showWalletUIs: false` already kills the modal, but each toggle still hops through the bundler.
- **True WebSocket push** — set `VITE_WS_RPC_URL` to a MegaETH WS endpoint so the live grid streams `CellRented` over `eth_subscribe` instead of the 1s `getLogs` poll it falls back to today.
- **Playable NFT / series page** — a `/loop/:seriesId` route that plays the snapshot (Tone.js + on-chain read). Share links already carry `?loop=<seriesId>`; this would give each loop a real page.
- **Per-loop share cards** — dynamic OG images for `?loop=N` links (needs a Vercel edge function); static OG card ships today.
- **Royalty keeper** — a bot that watches marketplace transfers and calls `depositRoyalty(seriesId, …)` so resale royalties get attributed without a manual step.
- **Daily highlight auto-mint** — treasury-funded keeper records "loop of the day" by some heuristic (most renewals, most distinct contributors). Drives press demand without a human curator.
- **Treasury → multisig** — when revenue exists, rotate `owner` + `treasury` to a Safe (or self-deployed 2-of-3 if Safe isn't on MegaETH yet).

## Key contracts

| Contract | Mainnet | Testnet |
|---|---|---|
| `Loopclub` | [`0x64D8242efd689c16211e4778e3bc8eA1bb9fbf76`](https://megaeth.blockscout.com/address/0x64D8242efd689c16211e4778e3bc8eA1bb9fbf76) | [`0xc655B264Fb2Ae5Ccc203Ba2524FAA8F1834ef249`](https://megaeth-testnet-v2.blockscout.com/address/0xc655B264Fb2Ae5Ccc203Ba2524FAA8F1834ef249) — stale, old one-shot model |
| Payment token | USDm (real) `0xFAfD…79E7` | MockUsdm `0x6B92…dab3` (open faucet) |

The previous mainnet one-shot `Loopclub` `0x6B92…dab3` is superseded — see [`docs/deployments.md`](docs/deployments.md).

## Hot wallet

`0x6cF2577B57ab7041Ec8815afC768cf73fd9C0Ee3` — controlled by Theo, used for testnet + mainnet deploy and currently both `owner` and `treasury`. Deployer key stays off-repo. Rotate `owner` + `treasury` to a multisig when revenue justifies the operational overhead.
