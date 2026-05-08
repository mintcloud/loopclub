# Deployments

## MegaETH testnet (chain id 6343)

| Contract | Address | Deploy block | Deploy tx |
|---|---|---|---|
| `Loopchain` | [`0xc655B264Fb2Ae5Ccc203Ba2524FAA8F1834ef249`](https://www.megaexplorer.xyz/address/0xc655B264Fb2Ae5Ccc203Ba2524FAA8F1834ef249) | 18,554,910 | [`0xefa5f140…418c79c7`](https://www.megaexplorer.xyz/tx/0xefa5f1400de91ddba38e47f5a7b0a8f7f3a670930c22914c432080a7418c79c7) |
| `MockUsdm` (test payment token) | [`0x6B921E8b699D3c780018Ca5E300a28eF3E63dab3`](https://www.megaexplorer.xyz/address/0x6B921E8b699D3c780018Ca5E300a28eF3E63dab3) | 18,554,909 | [`0x6d5c5e4c…1e02c47c01`](https://www.megaexplorer.xyz/tx/0x6d5c5e4cc59996e2b3585c13ef51a8ccb426ec124ffa7e532c1bd31e02c47c01) |

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

## MegaETH mainnet

Not deployed.
