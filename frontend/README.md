# Loopchain frontend

Vite + React + TS + Privy (Kernel smart wallet) + ZeroDev session keys + viem + Tone.js.

## Quick start

```bash
cd frontend
cp .env.example .env.local   # edit if needed; defaults point at deployed mainnet
npm install
npm run dev                  # → http://localhost:5173
```

## Env vars

All in `.env.example`. The defaults are wired to the deployed MegaETH mainnet contracts (chain 4326):

- `VITE_PRIVY_APP_ID` — `cmoxau2fi00xd0clevvngoxzr`
- `VITE_LOOPCHAIN_ADDRESS` — `0xE9Ba1E07Df5D95234F4e0102d06eAe2f16365f1a`
- `VITE_PAYMENT_TOKEN_ADDRESS` — `0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7` (USDm)
- `VITE_RPC_URL`, `VITE_CHAIN_ID`, `VITE_EXPLORER_URL`
- `VITE_ZERODEV_RPC_URL` — ZeroDev bundler+paymaster RPC, used by fast mode (session keys)
- `VITE_ENABLE_SESSION_KEYS` — `true` / `false` master switch for fast mode (default `false`)

When the contracts redeploy, update `docs/deployments.md` and the corresponding `VITE_*` vars in Vercel.

## What's wired

- **Auth + smart wallet** — Privy with `SmartWalletsProvider`. Email login → embedded EOA → Kernel smart wallet auto-created. Bundler/paymaster configured in the Privy dashboard means users don't need ETH.
- **Live grid** — polls `Loopchain.livePattern()` and `Loopchain.livePitches()` every 2s.
- **Approve once** — `USDm.approve(loopchain, MAX_UINT256)`. Needed before the first toggle. (On testnet `MockUsdm` exposes an open `faucet()` for test USDm.)
- **Toggle a cell** — click any cell, pick duration (1–32 loops × 4s) and pitch (synth row only), pay rent.
- **Record + press** — `record()` snapshots the live grid into a Series and mints edition #1; `press(seriesId)` mints edition #N on the quadratic bonding curve.
- **Library** — browses recorded series (Recent / Most Collab / My Loops), plays snapshots, presses copies, copies `?loop=<seriesId>` share links.
- **Royalty claim** — series-keyed `claimRoyalty(seriesId)`; a claim button surfaces on a loop card when the connected wallet has an unclaimed share.
- **Audio** — Tone.js drives a 4-second pattern at 240 BPM (16 sixteenth-notes). Drum tracks are kick/snare/hat synths; track 4 is a polysynth that plays the pentatonic pitch stored on each synth cell.
- **Fast mode (session keys)** — opt-in, behind `VITE_ENABLE_SESSION_KEYS`. The user signs once to authorise an in-browser session key scoped to `Loopchain.toggle()` for one hour; every toggle after that is signed locally — no Privy round-trip. record/press/claim still go through the Privy client. Privy is unchanged as the login + root signer. See `src/sessionKey.ts` and `docs/checkpoints.md`.

## What's NOT wired yet

- Royalty *deposit* UI — `depositRoyalty(seriesId, amount)` exists on-chain; attribution is expected to come from a keeper bot watching marketplace transfers, not a manual button.
- Per-loop dynamic OG cards for `?loop=N` share links — a static OG card ships in `index.html`; dynamic per-loop images would need a Vercel edge function.
- Fast mode for record/press — session keys currently fast-path `toggle()` only; record/press are rarer, larger spends and stay on the deliberate Privy signing path. Extending the call policy to `record` is a small follow-up.
- Paymaster decision + MegaETH realtime send (`*Sync`) — step 5 of the latency plan; fast mode keeps the existing ZeroDev paymaster for now.
- EIP-7702 mode toggle (smart wallet defaults to counterfactual; if/when 7702 lands cleanly in Privy/Kernel we flip the flag).

## Vercel deploy

The repo root is `loopchain/`; the FE lives in `frontend/`. In the Vercel project settings:

- **Root Directory**: `frontend`
- **Framework preset**: Vite (auto-detected)
- **Build command**: `npm run build`
- **Output directory**: `dist`
- **Install command**: `npm install`

Add the `VITE_*` env vars from `.env.example` (skip `VITE_PRIVY_APP_ID` if you'd rather inject it only in Vercel).

## File map

```
src/
├── main.tsx            # PrivyProvider + SmartWalletsProvider
├── App.tsx             # state, polling, tx flows, layout
├── Grid.tsx            # 16×4 grid render
├── CellPopover.tsx     # duration + pitch picker (and the occupied-cell card)
├── ContributorStrip.tsx# per-player colour legend under the grid
├── useLiveGrid.ts      # event-streamed grid state (CellRented + multicall)
├── sessionKey.ts       # fast mode — ZeroDev session-key account + policies
├── useSessionKey.ts    # fast mode — arm / restore / expiry React state
├── owner.ts            # stable per-address hue for owner colouring
├── audio.ts            # Tone.js sequencer
├── viemClient.ts       # public + event clients for reads
├── abi.ts              # Loopchain + MockUsdm minimal ABIs
├── config.ts           # env-derived chain + contract addresses
└── index.css           # dark theme
```
