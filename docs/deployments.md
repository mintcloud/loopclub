# Deployments

## MegaETH testnet (chain id 6343)

> **Stale:** this `Loopchain` is the old one-shot flat-mint model — testnet was not redeployed for the Series + bonding-curve rework (deploy went straight to mainnet on 2026-05-15). Redeploy here before any testnet smoke test.

| Contract | Address | Deploy block | Deploy tx |
|---|---|---|---|
| `Loopchain` | [`0xc655B264Fb2Ae5Ccc203Ba2524FAA8F1834ef249`](https://megaeth-testnet-v2.blockscout.com/address/0xc655B264Fb2Ae5Ccc203Ba2524FAA8F1834ef249) | 18,554,910 | [`0xefa5f140…418c79c7`](https://megaeth-testnet-v2.blockscout.com/tx/0xefa5f1400de91ddba38e47f5a7b0a8f7f3a670930c22914c432080a7418c79c7) |
| `MockUsdm` (test payment token) | [`0x6B921E8b699D3c780018Ca5E300a28eF3E63dab3`](https://megaeth-testnet-v2.blockscout.com/address/0x6B921E8b699D3c780018Ca5E300a28eF3E63dab3) | 18,554,909 | [`0x6d5c5e4c…1e02c47c01`](https://megaeth-testnet-v2.blockscout.com/tx/0x6d5c5e4cc59996e2b3585c13ef51a8ccb426ec124ffa7e532c1bd31e02c47c01) |

**Deployer / Owner / Treasury:** `0x6cF2577B57ab7041Ec8815afC768cf73fd9C0Ee3`
**Constructor args (Loopchain):** `(payment, treasury, owner) = (0x6B92…dab3, 0x6cF2…0Ee3, 0x6cF2…0Ee3)`
**RPC used:** `https://carrot.megaeth.com/rpc`
**Forge artifacts:** `contracts/broadcast/Deploy.s.sol/6343/run-latest.json`
**Deploy date:** 2026-05-08
**Total gas paid:** 0.000151 ETH (151 137 711 gas × 0.001 gwei)

### Frontend wiring

Set in your Vite env (`frontend/.env.local`):

```
VITE_CHAIN_ID=6343
VITE_RPC_URL=https://carrot.megaeth.com/rpc
VITE_LOOPCHAIN_ADDRESS=0xc655B264Fb2Ae5Ccc203Ba2524FAA8F1834ef249
VITE_PAYMENT_TOKEN_ADDRESS=0x6B921E8b699D3c780018Ca5E300a28eF3E63dab3
```

### Faucet for testnet USDm

Anyone can call `MockUsdm.faucet(amount)` to mint themselves test USDm — no allowlist. Use it before the first `toggle()` so the user has rent balance.

## MegaETH mainnet (chain id 4326)

| Contract | Address | Deploy block | Deploy tx |
|---|---|---|---|
| `Loopchain` (sound expansion — 16×9 grid + paid kit flip) | [`0xb083b818C07889005BfFBe264449cA85ac2039D6`](https://megaeth.blockscout.com/address/0xb083b818C07889005BfFBe264449cA85ac2039D6) | 16,386,694 | [`0xc3053071…89d300e4`](https://megaeth.blockscout.com/tx/0xc3053071a552d8349b3d0a1c7d36598882e1fdaafb9ae7722b1c934689d300e4) |
| `USDm` (Ethena/MegaETH official, payment token) | [`0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7`](https://megaeth.blockscout.com/address/0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7) | — | — |

**Deployer / Owner / Treasury:** `0x6cF2577B57ab7041Ec8815afC768cf73fd9C0Ee3` (rotate owner + treasury to a Safe later via `transferOwnership` / `setTreasury`)
**Constructor args (Loopchain):** `(payment, treasury, owner) = (0xFAfD…79E7, 0x6cF2…0Ee3, 0x6cF2…0Ee3)` — unchanged from the previous build.
**Source commit:** `981ae5f` ("contracts: sound expansion — 9-track grid + paid kit flip") — `forge test` 39/39. Runtime bytecode 16,846 B.
**On-chain config (verified post-deploy):** `CELLS = 144`, `TRACKS = 9`, `holdersBps = 7000`, `treasuryBps = 3000`, `basePrice = 1 USDm`, `alpha = 0.25 USDm`, `rentPerLoop = 0.004 USDm`, `flipFee = 10 USDm`, `maxRentDurationLoops = 32`, `kitId = scaleId = swing = 0`, `paymentToken = 0xFAfD…79E7`.
**RPC used:** `https://mainnet.megaeth.com/rpc`
**Forge artifacts:** `contracts/broadcast/Deploy.s.sol/4326/run-latest.json`
**Deploy date:** 2026-05-19
**Total gas paid:** ≈ 0.000175 ETH (175 306 917 gas × ~0.001 gwei)

> **Superseded — `0xE9Ba1E07Df5D95234F4e0102d06eAe2f16365f1a`** ([explorer](https://megaeth.blockscout.com/address/0xE9Ba1E07Df5D95234F4e0102d06eAe2f16365f1a), block 16,043,341, deployed 2026-05-15, tx `0xe95ec2f6…208eec67`). The pre-expansion 16×4 Series + bonding-curve build (`_popcount` fix + on-chain `tokenURI`, commit `405a203`). Replaced by the sound-expansion redeploy. Holds the loops recorded before 2026-05-19; the new frontend does not list them. Do not point any client at it.
> **Superseded — `0x64D8242efd689c16211e4778e3bc8eA1bb9fbf76`** ([explorer](https://megaeth.blockscout.com/address/0x64D8242efd689c16211e4778e3bc8eA1bb9fbf76), block 16,036,858, deployed 2026-05-15, tx `0xca83db99…973a983c`). First Series + bonding-curve deploy. Replaced because `press()`/`claimRoyalty()` underpaid holders — `_popcount()` mis-counted any pattern with cells ≥ #8. Still on-chain (holds 2 metadata-less NFTs); do not point any client at it.
> **Superseded — `0x6B921E8b699D3c780018Ca5E300a28eF3E63dab3`** ([explorer](https://megaeth.blockscout.com/address/0x6B921E8b699D3c780018Ca5E300a28eF3E63dab3), block 15,477,967, deployed 2026-05-08, tx `0x6c34334d…91b891f7`). The original one-shot flat-mint model. Do not point any client at it.

### Frontend wiring

Set in your Vite env (`frontend/.env.local`) **and** in the Vercel project env:

```
VITE_CHAIN_ID=4326
VITE_RPC_URL=https://mainnet.megaeth.com/rpc
VITE_LOOPCHAIN_ADDRESS=0xb083b818C07889005BfFBe264449cA85ac2039D6
VITE_PAYMENT_TOKEN_ADDRESS=0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7
VITE_EXPLORER_URL=https://megaeth.blockscout.com
```

> **The frontend must be on the sound-expansion build before this cutover.** The 16×9 contract's ABI is not compatible with the pre-expansion 16×4 frontend — point Vercel at this address only after the `feat/frontend-sound-expansion` migration is merged and preview-tested. See `frontend/README.md`.

USDm is real on mainnet (no faucet) — symbol `USDm`, name `MegaUSD`, 18 decimals. Users need to top up via Ethena/MegaETH onramp before they can rent cells.
