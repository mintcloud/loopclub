# Loopchain

One global 16×4 grid drum machine on MegaETH. Cells rented in USDm, full loops mintable as NFTs with revenue share back to the cell owners whose toggles ended up in the snapshot.

## Status (2026-05-08)

| Layer | State |
|---|---|
| v1 spec | locked — see [`docs/v1-spec.md`](docs/v1-spec.md) |
| Economics | locked — see [`docs/economics.md`](docs/economics.md) |
| Smart-account stack | Kernel via Privy + EIP-7702 — see [`docs/stack-and-7702.md`](docs/stack-and-7702.md) |
| Contracts (`contracts/`) | ✅ built + tested (15/15) on Foundry 1.7.1 |
| Bundler / paymaster | configured in Privy dashboard (Kernel MegaETH testnet endpoints) |
| Hot wallet funding | ✅ `0x6cF2577B57ab7041Ec8815afC768cf73fd9C0Ee3` funded |
| Testnet deploy | ✅ deployed to MegaETH testnet (chain 6343) — see [`docs/deployments.md`](docs/deployments.md) |
| Frontend (`frontend/`) | not started |

Detailed step-by-step status: [`docs/progress.md`](docs/progress.md).

## Stack (locked)

- **Contracts** — Solidity 0.8.26, OpenZeppelin (ERC-721 + ERC-2981 + Ownable), Foundry.
- **Payment token** — `IERC20` parameter. Testnet uses `MockUsdm` (open faucet). Mainnet uses real Ethena USDm.
- **Smart wallet** — Kernel via Privy. Not Stateless7702, not MetaMask Smart Accounts Kit.
- **Session keys** — `@zerodev/sdk` + `@zerodev/permissions`.
- **EIP-7702** — set in client SDK code, defaults to counterfactual mode.
- **Frontend** — Vite + React + TS + Privy SDK + viem + Tone.js + WebSocket grid subscription.

## Repository layout

```
loopchain/
├── contracts/        # Foundry project — Loopchain.sol + MockUsdm.sol + tests + deploy
├── frontend/         # Vite + React app (placeholder, see frontend/README.md)
└── docs/
    ├── v1-spec.md            # the on-chain protocol spec
    ├── economics.md          # rent / mint / split rationale
    ├── ux-architecture.md    # FE architecture (note: §3 is superseded by stack-and-7702.md)
    ├── stack-and-7702.md     # current stack + EIP-7702 plan (authoritative)
    └── progress.md           # 21-step build plan + per-step status
```

## Quick start

### Contracts

```bash
cd contracts
forge install OpenZeppelin/openzeppelin-contracts --no-commit
forge install foundry-rs/forge-std --no-commit
cp .env.example .env   # fill DEPLOYER_PRIVATE_KEY + MEGAETH_TESTNET_RPC
forge build
forge test -vv
```

Deploy to MegaETH testnet:

```bash
source .env
forge script script/Deploy.s.sol --rpc-url $MEGAETH_TESTNET_RPC --broadcast --slow
```

### Frontend

Not scaffolded yet. See [`frontend/README.md`](frontend/README.md) for the planned setup.

## Key dimensions

- 16 steps × 4 tracks = 64 cells (kick / snare / hat / synth)
- Synth cells (cellId ≥ 48) carry 3-bit pentatonic pitch (C/D/E/G/A)
- Loop = 4 seconds @ 120 BPM
- Rent = 0.004 USDm / loop, max 32 loops per toggle
- Mint = 4 USDm, split 80 / 10 / 10 (cell holders / recorder / treasury)
- ERC-2981 5% royalty, pull-claim via `claimRoyalty(tokenId)` after `depositRoyalty(tokenId, amount)`

## Hot wallet

`0x6cF2577B57ab7041Ec8815afC768cf73fd9C0Ee3` — controlled by Theo, used for the testnet deploy. The deployer key stays on Theo's laptop.
