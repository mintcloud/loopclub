# Loopchain build progress · 2026-05-08

*Status check after Privy + Kernel onboarding · updated 2026-05-15*

> **⚠️ Superseded — the body of this doc is a snapshot from 2026-05-08.** It describes the
> pre-deploy build state and the original one-shot contract. The "Current status" section
> immediately below reflects reality; for live status prefer the README and
> [`deployments.md`](deployments.md).

---

## Current status (2026-05-15)

| Layer | State |
|---|---|
| Contracts | ✅ reworked one-shot → **Series + bonding-curve editions**; `forge test` 23/23 pass |
| Mainnet deploy | ✅ chain 4326 — `Loopchain` `0x64D8…bf76`, deployed 2026-05-15 (the old one-shot `0x6B92…dab3` is superseded) |
| Testnet deploy | stale — chain 6343 still runs the old one-shot model; not redeployed |
| Frontend | ✅ record / press / library / royalty-claim UI wired; `tsc` clean; `.env.local` repointed. Vercel still needs `VITE_LOOPCHAIN_ADDRESS` updated + a redeploy |
| Smart-account stack | Kernel via Privy (the §2 pivot below held) |
| Open items | Vercel env + redeploy · session keys · two-device live demo · WS subscriptions (still 2s polling) · O(N) library fetch |

What changed since the snapshot below: the contract was reworked from a one-shot flat mint
into the Series + bonding-curve model (`record()` + `press()`, 70/30 co-creator/treasury
split, series-keyed royalties — see [`v1-spec.md`](v1-spec.md) / [`economics.md`](economics.md));
the frontend gained record / press / library / royalty-claim UI; both contract and frontend
are committed and deployed to mainnet.

The snapshot below (2026-05-08) is kept for the record.

---

## TL;DR

- **Steps 1–5 of the build plan are done.** Foundry scaffold + `MockUsdm.sol` + full `Loopchain.sol` + Forge tests + deploy script are written and sitting in `loopchain-contracts/`. Pure contract layer — unaffected by your Kernel choice.
- **One stack divergence to flag.** The architecture doc §3 quoted **MetaMask Smart Accounts Kit + Stateless7702 + ERC-7710 DelegationManager**. You went with **Kernel** in Privy. That's an entire smart-account ecosystem swap (ZeroDev SDK, not MetaMask's; Kernel session keys, not ERC-7710 delegations). It does NOT affect the contracts I just wrote — that whole layer is above `Loopchain.sol`. But steps 12–13 of the build plan (the "single signature → silent for an hour" flow) need different SDKs than what §3 specified. Detail below.
- **Single blocker on you:** I need a hot-wallet address you control on MegaETH testnet, with ~0.005 testnet ETH in it. I'll deploy from there. ~5 min on your end.
- **One thing to verify in Privy dashboard before we wire the frontend:** is your Kernel smart-wallet config set to **EIP-7702 mode** or **counterfactual**? It affects whether the user funds their EOA or a derived smart-wallet address. Counterfactual works fine, just changes the funding-flow UI copy.

---

## 1 · What's done (in `loopchain-contracts/`)

| # | Plan step | File | Notes |
|---|---|---|---|
| 1 | Foundry init + remappings | `foundry.toml`, `remappings.txt` | Solc 0.8.26, Cancun EVM, optimizer 200 runs |
| 2 | MockUsdm | `src/MockUsdm.sol` | ERC-20 + EIP-2612 permit + open `faucet()` for 1k testnet USDm |
| 3 | Loopchain v1 | `src/Loopchain.sol` | 64 cells, drum/synth split, USDm rent + mint, ERC-2981 royalty, pull-claim, treasury rotation, owner-tunable prices |
| 4 | Forge tests | `test/Loopchain.t.sol` | Rent + expiry + collision + same-owner-extends + record distribution + snapshot + royalty deposit/claim/non-holder/zero-claim + treasury auth |
| 5 | Deploy script | `script/Deploy.s.sol` | Auto-deploys MockUsdm if `PAYMENT_TOKEN` env var is unset; reuses real USDm address otherwise |

I've not run `forge test` because there's no Foundry repo on the VPS yet — these are deliverable files. Once you (or I, with VPS access) run `forge install OpenZeppelin/openzeppelin-contracts forge-rs/forge-std` against this scaffold and `forge build`, tests should pass. If something breaks at compile, I'll fix it on the next pass.

### Quick spec re-check

What I implemented vs the locked spec:

| Spec item | Implementation |
|---|---|
| 16 × 4 = 64 cells, drum binary, synth pentatonic (C/D/E/G/A) | `CELLS = 64`, `SYNTH_CELL_START = 48`, pitch 0..4 enforced |
| 4-second loops at 120 BPM | `LOOP_DURATION_SECONDS = 4`, `currentLoop()` reads block.timestamp |
| Rent 0.004 USDm/loop · max 32 loops · mint 4 USDm | All settable defaults; `setPrices()` owner-gated |
| record() reverts on empty pattern | `EmptyPattern()` revert |
| 80/10/10 split (holders/recorder/treasury) on mint | Per-cell pro-rata; rounding dust stays in contract |
| NFT stores holders[] + cellsPerHolder[] + pattern + pitches + mintedAtLoop | `LoopNFT` struct, exposed via `loopOf(tokenId)` |
| ERC-2981 5% royalty + pull-claim | `royaltyInfo()` returns contract, `depositRoyalty()` tags receipts to a token, `claimRoyalty()` does pro-rata |
| Treasury rotation by owner | `setTreasury()` |

### One pragmatic deviation worth knowing

ERC-2981 royalty attribution is genuinely awkward: the spec returns a single receiver address per token, but marketplaces almost universally just transfer to that address without telling the receiver which token the payment is for. Three options I considered:

1. **Per-token splitter clone** at mint time (`Clones.clone(splitterImpl)`) — cleanest, marketplaces pay the splitter directly. ~50k extra gas per mint.
2. **Single global pool** distributed by lifetime cell-share — simplest but uncomposable with marketplace tools.
3. **Tagged deposit pattern** — anyone calls `depositRoyalty(tokenId, amount)` to attribute incoming royalties; without it, USDm sits unattributed.

I shipped option 3 in v1. Reason: keeps `record()` lean (just minting, not deploying clones), no one is reselling Loopchain NFTs yet anyway, and the tagged-deposit endpoint becomes a clean target for a future keeper bot. Option 1 is the right v2.

If you prefer option 1 from day one, say so and I'll swap it in — it's an extra contract (`RoyaltySplitter.sol`) plus 5 lines in `record()`.

---

## 2 · The Kernel pivot — what changes from the architecture doc

§3 of `loopchain-ux-architecture.md` quoted this stack:

> `@privy-io/react-auth`, `@metamask/smart-accounts-kit` (Stateless7702 implementation), `@megaeth/sdk` for `eth_sendRawTransactionSync`. […] DelegationManager, EntryPoint, HybridDeleGator, MultiSigDeleGator.

You went with **Kernel**. That's ZeroDev's smart-account implementation, not MetaMask's. Privy supports both via their Smart Wallets feature, and they're not interchangeable — different SDKs, different on-chain implementation contracts, different session-key mechanism.

### What changes

| Original §3 stack | What we use with Kernel |
|---|---|
| `@metamask/smart-accounts-kit` | `@zerodev/sdk` + `@privy-io/react-auth/smart-wallets` |
| Stateless7702 (MetaMask's) | Kernel v3.x implementation (ZeroDev's) |
| `DelegationManager.redeemDelegations()` | Kernel's permission-validator pattern via `@zerodev/permissions` |
| ERC-7710 delegations spec | Kernel's session-key permissions (Kernel-native, similar shape but different bytes/contracts) |
| `HybridDeleGator`, `MultiSigDeleGator` predeploys | Not used (irrelevant for our flow) |

### What stays the same

- Privy embedded wallet for email/social login.
- viem for chain interaction.
- `eth_sendRawTransactionSync` (EIP-7966) for instant submit on MegaETH.
- Tone.js for playback.
- WS subscriptions for live grid updates.
- The "single signature, silent for an hour" UX is the same — Kernel's session-key model gives you the same scoped-permission primitive as ERC-7710 (allowed contract, allowed selectors, expiry, gas cap, value cap). Just different SDK.
- **The `Loopchain.sol` contract above is unchanged.** Smart-account choice lives entirely above the contract layer.

### The two questions the Kernel pivot raises

**a. EIP-7702 vs counterfactual.** Privy's Kernel config can run in two modes:
- **EIP-7702 mode** — your EOA gets the Kernel implementation as its delegation. Smart-wallet address = EOA address. User funds one address. This is what we want for the "fund once" UX.
- **Counterfactual mode (default)** — Kernel deploys a new smart account at a CREATE2-derived address. Smart wallet ≠ EOA. User funds the smart-wallet address (Privy shows both).

Both work. 7702 is the cleaner UX. In Privy's dashboard, look for a toggle like "Use EIP-7702" inside the Smart Wallet config you just set up. If you can confirm which mode you're in (or just point me to a screenshot), I'll write the funding-flow UI to match.

**b. Session-key SDK.** I'll plan steps 12–13 as:
```
const { client: smartWalletClient } = useSmartWallets();
// One-shot: install a permission validator on Kernel scoping
//   target = Loopchain
//   selectors = [toggle, record]
//   valueLimit = 5 USDm equivalent
//   expiry = now + 3600
const sessionKey = generatePrivateKey(); // localStorage
await smartWalletClient.installPermission({...});
// Per-toggle: session key signs UserOps
const op = await smartWalletClient.signUserOperation({
  // viaSession: sessionKey
  ...
});
await bundler.sendUserOperationSync(op); // EIP-7966
```

That's the Kernel-native version of the §3 flow. The "single signature → silent" property is preserved.

---

## 3 · Where we are vs the build plan

Steps from `loopchain-ux-architecture.md` §6:

| # | Step | Status |
|---|---|---|
| 1 | Foundry repo init + skills bundle | ✅ Scaffold written. Skills bundle install deferred until we're on a real repo on the VPS. |
| 2 | MockUsdm.sol | ✅ |
| 3 | Loopchain.sol full v1 | ✅ |
| 4 | Forge tests | ✅ Written. Not run (no Foundry repo set up yet). |
| 5 | Deploy script | ✅ |
| 6 | Verify MegaETH bundler endpoint | ✅ Done — you found and entered Kernel's MegaETH testnet bundler/paymaster URLs in Privy. |
| 6a | Self-host Pimlico Alto fallback | ❌ Not needed. |
| 7 | **You faucet hot wallet** | 🔴 **Pending you.** |
| 8 | Run deploy | 🔒 Blocked on 7. |
| 9 | Frontend scaffold (Vite + React + Privy) | Next, after 8. |
| 10 | Privy auth + embedded wallet | After 9. |
| 11 | Funding UI | After 10. |
| 12 | **Kernel session-key install** (was: 7702 + 7710) | After 11 — see §2 above for SDK swap. |
| 13 | Session signer + UserOp signing via `@zerodev/permissions` | After 12. |
| 14–21 | Grid + Tone.js + toggle/record handlers + WS + profile + share | After 13. |

Realistic time-to-magic-moment from now: ~20 hours of build, plus your 5 minutes for the hot wallet. 2 evenings if I get clear runs.

---

## 4 · Blockers

### Hard blocker (gates step 8)

**Hot wallet for deploy.** Need an address you control on MegaETH testnet with ~0.005 testnet ETH. Easiest path:
1. In MetaMask (or Privy itself, doesn't matter), generate a fresh account.
2. Hit the MegaETH testnet faucet with that address. (Privy's testnet docs link to the canonical faucet.)
3. Send me the address (paste in chat) AND the private key (encrypted via 1Password share, OR via a Telegram message I'll delete after deploy).

I will not commit the key to git. After deploy I'll forget it. If you'd rather run the deploy yourself, I'll give you the exact `forge script` command and you run it from your laptop — that's actually the cleaner path.

### Soft blocker (gates step 12, not 8)

**Privy Kernel mode.** Confirm whether your Privy Smart Wallets config has EIP-7702 enabled or is using counterfactual deployment. Affects funding UX, not contract deploy.

### Open Privy/Kernel detail (gates step 13, but I can spike it solo)

**`@zerodev/permissions` installation flow.** The exact call to register a session-key permission on a Privy-managed Kernel account requires confirming the modular validator entrypoint Kernel v3 exposes. ZeroDev docs are decent on this; I'll resolve during step 12. If I hit a Privy-side wall, I might need you to share the Privy app's secret with the VPS env (we discussed this last task — only needed if we add server-side calls, which session-key install does NOT require).

---

## 5 · What I'd like from you next

In order of urgency:

1. **Hot wallet address + funding** (step 7) — unblocks deploy.
2. **Privy Kernel mode confirmation** (7702 vs counterfactual) — affects the next FE pass.
3. **Royalty attribution preference** — ship v1 with tagged-deposit (current), or upgrade to per-token splitter clones (cleaner, +50k gas per mint)? I default to current unless you push back.
4. **Optional: deploy from your laptop instead of mine.** Cleaner key hygiene. I'd send you the command and you run it.

When you've got (1), I'll deploy and immediately start the frontend scaffold (steps 9–11).

---

## Files in this task's output

```
loopchain-progress.md          ← this file
loopchain-progress.html        ← rendered version
loopchain-contracts/
  foundry.toml
  remappings.txt
  .env.example
  README.md
  src/
    Loopchain.sol
    MockUsdm.sol
  test/
    Loopchain.t.sol
  script/
    Deploy.s.sol
```
