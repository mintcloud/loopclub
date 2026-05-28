# loopclub contracts

Foundry project for the loopclub v1 contracts. See `loopclub-progress.md` for status and the v1 spec.

## Layout

```
src/
  Loopclub.sol       # ERC-721 + ERC-2981 + USDm rent/mint/royalty + kit flip
  MockUsdm.sol       # open-mint test ERC-20 with EIP-2612 permit (testnet only)
test/
  Loopclub.t.sol     # rent, expiry, collision, mint distribution, royalty, kit flip, treasury
script/
  Deploy.s.sol       # deploys MockUsdm (if no PAYMENT_TOKEN) then loopclub
```

## Setup

```bash
# Install foundry deps (one-time, registers as git submodules; Foundry 1.7+ skips auto-commit by default)
forge install OpenZeppelin/openzeppelin-contracts
forge install foundry-rs/forge-std

# Configure env + build
cp .env.example .env  # fill in DEPLOYER_PRIVATE_KEY + MEGAETH_TESTNET_RPC
forge build
forge test -vv
```

## Deploy to MegaETH testnet

```bash
source .env
forge script script/Deploy.s.sol \
  --rpc-url $MEGAETH_TESTNET_RPC \
  --broadcast \
  --slow
```

Without `PAYMENT_TOKEN` set, the script deploys MockUsdm first, then loopclub pointing at it. With `PAYMENT_TOKEN` set, it reuses that address (mainnet path → real USDm).

## Verify

```bash
forge verify-contract <ADDRESS> src/Loopclub.sol:Loopclub \
  --chain $CHAIN_ID \
  --etherscan-api-key $MEGAETH_EXPLORER_KEY
```

## Known v1 limitations

- **Marketplace royalty attribution.** ERC-2981 returns the contract address as receiver. Marketplaces transfer USDm to the contract without per-token context. A keeper (or the recorder) must call `depositRoyalty(tokenId, amount)` to attribute receipts. v2 candidates: per-token `Clones.clone(splitterImpl)` so the marketplace pays the splitter directly.
- **Per-claim gas.** `claimRoyalty()` does a linear scan over `holders[]` (≤144). Fine. `record()` and `setKit()` both run an O(n²) dedup over up to 144 cells; ~20k ops worst case, comfortably under any sane gas limit on MegaETH.
- **144 holders × `address[]` storage per mint.** ~3 KB per NFT worst case. MegaETH-cheap.
- **No `permit()` integration.** Frontend asks for a one-time `approve(MAX_UINT256)` against the loopclub contract. v2 can wrap `toggle/record` with EIP-2612 permits if real USDm supports them.
