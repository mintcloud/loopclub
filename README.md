# Loopchain

One global 16×4 grid drum machine on MegaETH. Cells rented in USDm, full loops mintable as NFTs with revenue share back to the cell owners whose toggles ended up in the snapshot.

**Live:** MegaETH mainnet (chain 4326). Loopchain `0x6B92…dab3` · USDm `0xFAfD…79E7`. See [`docs/deployments.md`](docs/deployments.md).

---

## How it works (user flow)

```
 ┌─────────────────┐
 │ 1. Connect      │   Privy login (email/Google) → Kernel smart wallet auto-created
 └────────┬────────┘
          │
 ┌────────▼────────┐
 │ 2. Approve once │   One-time max-uint256 approve of USDm → Loopchain contract.
 │    (modal)      │   Confirms the long-running spend permission. Modal is intentional.
 └────────┬────────┘
          │
 ┌────────▼────────┐
 │ 3. Toggle cells │   Click a cell → pick duration (1–32 loops) + pitch (synth row).
 │    (silent)     │   Smart-wallet userOp ships without modal. Cell lights up live for
 │                 │   everyone watching. Costs `rentPerLoop × durationLoops` USDm.
 └────────┬────────┘
          │
 ┌────────▼────────┐
 │ 4. Cells expire │   After N loops (4s each), cell auto-clears. Owner can `renew()`
 │    on time      │   before expiry, or someone else can rent it once expired. Lazy
 │                 │   expiry — no "tick" tx needed.
 └────────┬────────┘
          │
 ┌────────▼────────┐
 │ 5. Record       │   Anyone can call `record()` for `mintPrice` USDm. Snapshots the
 │   (mint NFT)    │   current pattern + active holders into an ERC-721. Mint fee
 │                 │   distributes 80/10/10 (holders / recorder / treasury) atomically.
 └────────┬────────┘
          │
 ┌────────▼────────┐
 │ 6. Resale       │   ERC-2981 5% royalty → contract → `claimRoyalty(tokenId)` lets
 │   royalties     │   each *original* cell holder pull their share. Famous loops keep
 │                 │   paying their original authors forever.
 └─────────────────┘
```

**Key UX guarantees:**
- One approval modal at session start, zero modals on per-cell toggles (`uiOptions.showWalletUIs: false` on the smart-wallet `sendTransaction`).
- Sub-cent gas on MegaETH; rent is paid in USDm so the cost is stable in dollars.
- Lazy expiry — anyone reading `livePattern()` gets the truthful current state without a keeper.

---

## Economics (v1, in production)

All prices are owner-tunable via `setPrices(rentPerLoop, mintPrice, maxRentDurationLoops)`. Treasury is rotatable via `setTreasury(addr)`.

| Param | Value | Why |
|---|---|---|
| Loop length | 4 s @ 120 BPM | One bar at the canonical tempo. |
| Grid | 16 steps × 4 tracks = 64 cells | Tight enough for collision pressure, loose enough for collaboration. Tracks: kick / snare / hat / synth. |
| Synth pitch | 3-bit pentatonic (5 of 8 slots used) | Anything you toggle in row 3 sounds in key. Cells 48–63 carry a `pitchIdx` 0..4. |
| Rent | **0.004 USDm / cell / loop** | At ~$0.004 it's effectively free per click; full-grid spam costs ~$1/min. |
| Max rent duration | **32 loops** (~2 min) | Stops anyone from camping a cell across a viral pattern. Renewable. |
| Mint price | **4 USDm** | High enough to deter trash mints, low enough for casual recording. |
| Mint split | **80 / 10 / 10** holders / recorder / treasury | Recorder kickback intentionally rewards whoever pays to archive a great loop. |
| Royalty | **5% (ERC-2981)** | Pull-claim by *original* holders via `claimRoyalty(tokenId)`. |

**Calibration intent:** rent so cheap that ~1–2 mints break even for a loop with average participation. Most loops won't get any mint — that's expected, the tail is what matters. Tune from data, not from theory. Full rationale in [`docs/economics.md`](docs/economics.md).

### Mint mechanics in detail

`record()` does, atomically, in one tx:

1. Reads `livePattern()` (lazy: cells whose `expiresAtLoop > currentLoop()`).
2. Reverts if pattern is empty.
3. Pulls `mintPrice` USDm from the recorder.
4. Counts unique holders × cells held, deduped on-chain (≤64 entries, linear scan is fine).
5. Splits the fee:
   - **80%** divided pro-rata across cells, paid to each cell owner directly (`safeTransfer` of USDm).
   - **10%** kicked back to `msg.sender` (the recorder).
   - **10%** to `treasury`.
6. Mints an ERC-721 to `msg.sender` storing `pattern`, `pitches`, `mintedAtLoop`, and the `holders[]` + `cellsPerHolder[]` snapshot.
7. Emits `RecordingMinted`.

Holders are paid push-style on mint (USDm `safeTransfer` cannot revert in the way ETH `transfer` can). Royalties are pull-style via `claimRoyalty(tokenId)` — marketplaces send ERC-2981 5% to the contract, a keeper or anyone calls `depositRoyalty(tokenId, amount)` to attribute it to a token, then each original holder can pull their share whenever they want.

---

## Status (2026-05-08)

| Layer | State |
|---|---|
| v1 spec | locked — see [`docs/v1-spec.md`](docs/v1-spec.md) |
| Economics | locked — see [`docs/economics.md`](docs/economics.md) |
| Smart-account stack | Kernel via Privy + EIP-7702 — see [`docs/stack-and-7702.md`](docs/stack-and-7702.md) |
| Contracts (`contracts/`) | ✅ built + tested (15/15) on Foundry 1.7.1 |
| Bundler / paymaster | configured in Privy dashboard (Kernel MegaETH mainnet endpoints) |
| Hot wallet funding | ✅ `0x6cF2577B57ab7041Ec8815afC768cf73fd9C0Ee3` funded |
| Testnet deploy | ✅ chain 6343 — see [`docs/deployments.md`](docs/deployments.md) |
| **Mainnet deploy** | ✅ chain 4326 — Loopchain `0x6B92…dab3` |
| Frontend (`frontend/`) | ✅ live on Vercel, points at mainnet |
| Toggle UX | ✅ silent (no modal), approve modal preserved |
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
loopchain/
├── contracts/        # Foundry project — Loopchain.sol + MockUsdm.sol + tests + deploy
├── frontend/         # Vite + React app — live on Vercel
└── docs/
    ├── v1-spec.md            # the on-chain protocol spec
    ├── economics.md          # rent / mint / split rationale (read this first)
    ├── ux-architecture.md    # FE architecture (note: §3 is superseded by stack-and-7702.md)
    ├── stack-and-7702.md     # current stack + EIP-7702 plan (authoritative)
    ├── deployments.md        # testnet + mainnet addresses
    └── progress.md           # 21-step build plan + per-step status
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
source .env
forge script script/Deploy.s.sol --rpc-url $MEGAETH_MAINNET_RPC --broadcast --slow
```

### Frontend

```bash
cd frontend
cp .env.example .env.local   # mainnet addresses already in .env.example
npm install
npm run dev
```

## Roadmap (post-v1)

- **Session keys** — install a permission-scoped key on the Kernel account at login (target = Loopchain, selector = `toggle()`, valid 24h). All toggles sign locally — sub-50ms latency, no Privy roundtrip. Today's `showWalletUIs: false` already kills the modal, but each toggle still hops through the bundler. Session keys would shave that to local-only signing.
- **Playable NFT page** — `/loop/:tokenId` route that plays the snapshot (Tone.js + on-chain pattern read). Shareable. Each mint = a 4s audio post.
- **Daily highlight auto-mint** — treasury-funded keeper records "loop of the day" by some heuristic (most renewals, most distinct contributors). Drives mint demand without requiring a human curator.
- **First-mint-free** — first N mints/day free for new users. Lower friction for "is this fun?" experiment.
- **USDm-denominated v2 rent** — already done in v1.
- **Treasury → multisig** — when revenue exists, swap deployer to a Safe (or self-deployed 2-of-3 if Safe isn't on MegaETH yet).

## Key contracts

| Contract | Mainnet | Testnet |
|---|---|---|
| `Loopchain` | [`0x6B921E8b699D3c780018Ca5E300a28eF3E63dab3`](https://megaeth.blockscout.com/address/0x6B921E8b699D3c780018Ca5E300a28eF3E63dab3) | [`0xc655B264Fb2Ae5Ccc203Ba2524FAA8F1834ef249`](https://megaeth-testnet-v2.blockscout.com/address/0xc655B264Fb2Ae5Ccc203Ba2524FAA8F1834ef249) |
| Payment token | USDm (real) `0xFAfD…79E7` | MockUsdm `0x6B92…dab3` (open faucet) |

## Hot wallet

`0x6cF2577B57ab7041Ec8815afC768cf73fd9C0Ee3` — controlled by Theo, used for testnet + mainnet deploy and currently the treasury. Deployer key stays on Theo's laptop. Rotate treasury to multisig when revenue justifies the operational overhead.
