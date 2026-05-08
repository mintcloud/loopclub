# Deployments

## MegaETH testnet (chain id 6343)

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
| `Loopchain` | [`0x6B921E8b699D3c780018Ca5E300a28eF3E63dab3`](https://megaeth.blockscout.com/address/0x6B921E8b699D3c780018Ca5E300a28eF3E63dab3) | 15,477,967 | [`0x6c34334d…91b891f7`](https://megaeth.blockscout.com/tx/0x6c34334d65883ace156545f6c9f5ea4f2e48b3719263d6aba1f06d1a91b891f7) |
| `USDm` (Ethena/MegaETH official, payment token) | [`0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7`](https://megaeth.blockscout.com/address/0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7) | — | — |

**Deployer / Owner / Treasury:** `0x6cF2577B57ab7041Ec8815afC768cf73fd9C0Ee3` (rotate treasury to multisig later via `setTreasury`)
**Constructor args (Loopchain):** `(payment, treasury, owner) = (0xFAfD…79E7, 0x6cF2…0Ee3, 0x6cF2…0Ee3)`
**RPC used:** `https://mainnet.megaeth.com/rpc`
**Forge artifacts:** `contracts/broadcast/Deploy.s.sol/4326/run-latest.json`
**Deploy date:** 2026-05-08
**Total gas paid:** ~0.000110 ETH

### Frontend wiring

Set in your Vite env (`frontend/.env.local`):

```
VITE_CHAIN_ID=4326
VITE_RPC_URL=https://mainnet.megaeth.com/rpc
VITE_LOOPCHAIN_ADDRESS=0x6B921E8b699D3c780018Ca5E300a28eF3E63dab3
VITE_PAYMENT_TOKEN_ADDRESS=0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7
VITE_EXPLORER_URL=https://megaeth.blockscout.com
```

USDm is real on mainnet (no faucet) — symbol `USDm`, name `MegaUSD`, 18 decimals. Users need to top up via Ethena/MegaETH onramp before they can rent cells.
