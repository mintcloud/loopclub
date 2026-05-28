# Deployments

## MegaETH testnet (chain id 6343)

> **Stale:** this `Loopchain` (pre-rename contract name) is the old one-shot flat-mint model — testnet was not redeployed for the Series + bonding-curve rework (deploy went straight to mainnet on 2026-05-15). Redeploy here before any testnet smoke test.

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
VITE_LOOPCLUB_ADDRESS=0xc655B264Fb2Ae5Ccc203Ba2524FAA8F1834ef249
VITE_PAYMENT_TOKEN_ADDRESS=0x6B921E8b699D3c780018Ca5E300a28eF3E63dab3
```

### Faucet for testnet USDm

Anyone can call `MockUsdm.faucet(amount)` to mint themselves test USDm — no allowlist. Use it before the first `toggle()` so the user has rent balance.

## MegaETH mainnet (chain id 4326)

| Contract | Address | Deploy block | Deploy tx |
|---|---|---|---|
| `Loopclub` (post-rename redeploy — `name()` is `"Loopclub"`; 16×9 grid + paid kit flip + full MIDI synth) | [`0x1030D1a60e248E280294d1b04394f706904E3631`](https://megaeth.blockscout.com/address/0x1030D1a60e248E280294d1b04394f706904E3631) | 17,164,882 | [`0x01a5c16a…d7ae8f72`](https://megaeth.blockscout.com/tx/0x01a5c16ac75bfa0b040eb53a684a7bb383ea5afd172d637b0e826332d7ae8f72) |
| `USDm` (Ethena/MegaETH official, payment token) | [`0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7`](https://megaeth.blockscout.com/address/0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7) | — | — |

**Deployer / Owner / Treasury:** `0x6cF2577B57ab7041Ec8815afC768cf73fd9C0Ee3` (rotate owner + treasury to a Safe later via `transferOwnership` / `setTreasury`)
**Constructor args (Loopclub):** `(payment, treasury, owner) = (0xFAfD…79E7, 0x6cF2…0Ee3, 0x6cF2…0Ee3)` — unchanged from the previous build.
**Source commit:** `22deb93` ("contracts: PascalCase Loopclub + Loopclub Loop NFT name + brand logo rename") on `main` — `forge test` 40/40.
**On-chain config (verified post-deploy via `cast call`):** `name() = "Loopclub"`, `symbol() = "LOOP"`, `PITCH_OPTIONS = 128`, `CELLS = 144`, `TRACKS = 9`, `holdersBps = 7000`, `treasuryBps = 3000`, `basePrice = 1 USDm`, `alpha = 0.25 USDm`, `flipFee = 10 USDm`, `paymentToken = 0xFAfD…79E7`, `owner = treasury = 0x6cF2…0Ee3`.
**RPC used:** `https://mainnet.megaeth.com/rpc`
**Forge artifacts:** `contracts/broadcast/Deploy.s.sol/4326/run-latest.json`
**Deploy date:** 2026-05-28
**Total gas paid:** 0.000175252 ETH (175 202 717 gas × 0.001000001 gwei).

> **Superseded — `0xE67B314BFF454e99c875bb6666fe5d3F72E39A56`** ([explorer](https://megaeth.blockscout.com/address/0xE67B314BFF454e99c875bb6666fe5d3F72E39A56), block 17,085,145, deployed 2026-05-27, tx `0x4dcf08a8…2425ef94`). The MIDI 128 pitch build under the **pre-rename** `Loopchain` contract name (`name() = "Loopchain"`). Replaced by the post-rename `Loopclub` redeploy. Same business logic — only the contract identifier + ERC721 `name()` differ. Do not point any client at it.
> **Superseded — `0xb083b818C07889005BfFBe264449cA85ac2039D6`** ([explorer](https://megaeth.blockscout.com/address/0xb083b818C07889005BfFBe264449cA85ac2039D6), block 16,386,694, deployed 2026-05-19, tx `0xc3053071…89d300e4`). Sound-expansion build (16×9 grid + paid kit flip, commit `981ae5f`) — synth cells validated as 3-bit diatonic scale-degree (`PITCH_OPTIONS = 8`). Replaced by the MIDI 128 redeploy. Holds the loops recorded between 2026-05-19 and 2026-05-27; the new frontend does not list them. Do not point any client at it.
> **Superseded — `0xE9Ba1E07Df5D95234F4e0102d06eAe2f16365f1a`** ([explorer](https://megaeth.blockscout.com/address/0xE9Ba1E07Df5D95234F4e0102d06eAe2f16365f1a), block 16,043,341, deployed 2026-05-15, tx `0xe95ec2f6…208eec67`). The pre-expansion 16×4 Series + bonding-curve build (`_popcount` fix + on-chain `tokenURI`, commit `405a203`). Replaced by the sound-expansion redeploy. Holds the loops recorded before 2026-05-19; the new frontend does not list them. Do not point any client at it.
> **Superseded — `0x64D8242efd689c16211e4778e3bc8eA1bb9fbf76`** ([explorer](https://megaeth.blockscout.com/address/0x64D8242efd689c16211e4778e3bc8eA1bb9fbf76), block 16,036,858, deployed 2026-05-15, tx `0xca83db99…973a983c`). First Series + bonding-curve deploy. Replaced because `press()`/`claimRoyalty()` underpaid holders — `_popcount()` mis-counted any pattern with cells ≥ #8. Still on-chain (holds 2 metadata-less NFTs); do not point any client at it.
> **Superseded — `0x6B921E8b699D3c780018Ca5E300a28eF3E63dab3`** ([explorer](https://megaeth.blockscout.com/address/0x6B921E8b699D3c780018Ca5E300a28eF3E63dab3), block 15,477,967, deployed 2026-05-08, tx `0x6c34334d…91b891f7`). The original one-shot flat-mint model. Do not point any client at it.

### Frontend wiring

Set in your Vite env (`frontend/.env.local`) **and** in the Vercel project env:

```
VITE_CHAIN_ID=4326
VITE_RPC_URL=https://mainnet.megaeth.com/rpc
VITE_LOOPCLUB_ADDRESS=0x1030D1a60e248E280294d1b04394f706904E3631
VITE_PAYMENT_TOKEN_ADDRESS=0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7
VITE_EXPLORER_URL=https://megaeth.blockscout.com
```

> **Fresh state on the post-rename redeploy.** `nextSeriesId` and `nextTokenId` both start at 1. Loops recorded on the pre-rename `Loopchain` contract at `0xE67B…9A56` stay on-chain there forever but are not listed by the new frontend. Same ABI, same business logic — only the contract identifier and the ERC721 `name()` differ.

USDm is real on mainnet (no faucet) — symbol `USDm`, name `MegaUSD`, 18 decimals. Users need to top up via Ethena/MegaETH onramp before they can rent cells.
