# Loopchain frontend

Vite + React + TS + Privy (Kernel smart wallet) + viem + Tone.js.

## Quick start

```bash
cd frontend
cp .env.example .env.local   # edit if needed; defaults point at deployed testnet
npm install
npm run dev                  # → http://localhost:5173
```

## Env vars

All in `.env.example`. The defaults are wired to the deployed MegaETH testnet contracts (chain 6343):

- `VITE_PRIVY_APP_ID` — `cmowozv13029v0clbx15g9wqb`
- `VITE_LOOPCHAIN_ADDRESS` — `0xc655B264Fb2Ae5Ccc203Ba2524FAA8F1834ef249`
- `VITE_PAYMENT_TOKEN_ADDRESS` — `0x6B921E8b699D3c780018Ca5E300a28eF3E63dab3` (MockUsdm)
- `VITE_RPC_URL`, `VITE_CHAIN_ID`, `VITE_EXPLORER_URL`

When the contracts redeploy, update `docs/deployments.md` and the corresponding `VITE_*` vars in Vercel.

## What's wired

- **Auth + smart wallet** — Privy with `SmartWalletsProvider`. Email login → embedded EOA → Kernel smart wallet auto-created. Bundler/paymaster configured in the Privy dashboard means users don't need ETH.
- **Live grid** — polls `Loopchain.livePattern()` and `Loopchain.livePitches()` every 2s.
- **Faucet button** — calls `MockUsdm.faucet()` for 1000 test USDm.
- **Approve once** — `MockUsdm.approve(loopchain, MAX_UINT256)`. Needed before first toggle.
- **Toggle a cell** — click any cell, pick duration (1–32 loops × 4s) and pitch (synth row only), pay rent.
- **Audio** — Tone.js drives a 4-second pattern at 240 BPM (16 sixteenth-notes). Drum tracks are kick/snare/hat synths; track 4 is a polysynth that plays the pentatonic pitch stored on each synth cell.

## What's NOT wired yet

- `record()` (mint NFT) — contract supports it; UI button is the next slice.
- Royalty deposit/claim.
- NFT gallery / minted-loops view.
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
├── main.tsx          # PrivyProvider + SmartWalletsProvider
├── App.tsx           # state, polling, tx flows, layout
├── Grid.tsx          # 16×4 grid render
├── ToggleModal.tsx   # duration + pitch picker
├── audio.ts          # Tone.js sequencer
├── viemClient.ts     # public client for reads
├── abi.ts            # Loopchain + MockUsdm minimal ABIs
├── config.ts         # env-derived chain + contract addresses
└── index.css         # dark theme
```
