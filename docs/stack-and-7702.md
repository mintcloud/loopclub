# loopclub · Kernel vs Stateless + EIP-7702 setup

*2026-05-08 · for Theo*

---

## TL;DR

- **Hot wallet noted: `0x6cF2577B57ab7041Ec8815afC768cf73fd9C0Ee3`.** I'll use it for the testnet deploy once you've funded it. No rush.
- **Kernel was a fine choice. Probably a slightly better one than Stateless7702 for shipping speed. Don't switch.** Honest tradeoff laid out below — it's not "you got it wrong, here's the right answer."
- **Privy default is counterfactual.** You don't need to do anything in the Privy dashboard to "enable 7702" — there's no toggle there. EIP-7702 mode is set in **frontend SDK code**, per the recipe you linked. I'll handle it when I get to step 12.
- **We want 7702 on.** It gives us the "fund the EOA once, that's also your smart-wallet address" UX. Without it (counterfactual), users have to fund a different derived address — workable but a UX wrinkle.

---

## 1 · Was Kernel a good choice?

Direct answer: **yes**. The architecture doc (§3) recommended MetaMask Smart Accounts Kit + Stateless7702. You picked Kernel because that's what Privy's Smart Wallets UI surfaces front-and-center. Both stacks are valid. Here's the honest diff.

### What you get with Kernel (ZeroDev)

| Aspect | Status |
|---|---|
| Production maturity | Most battle-tested smart account on EVM. ZeroDev runs millions of UserOps/month. |
| Privy integration | First-class. `useSmartWallets()` returns a Kernel client out of the box. Bundler/paymaster URLs in the dashboard work as-is. |
| EIP-7702 support | Kernel v3.3+ supports 7702 natively. Privy's recipe link you shared documents the exact wiring. |
| Session keys | Via `@zerodev/permissions` — modular validator pattern. Scope by target contract, selector, gas, value, expiry. Same shape as ERC-7710, different bytes. |
| SDK polish | Mature, well-documented, lots of examples. ZeroDev has been at this since 2022. |
| MegaETH support | Works — that's why their bundler/paymaster URLs were addressable. |

### What you'd have gotten with Stateless7702 (the §3 stack)

| Aspect | Status |
|---|---|
| Open standard | ERC-7710 delegations are an EIP, multiple implementations possible. Kernel's permissions are ZeroDev-specific. (Probably doesn't matter for us.) |
| MegaETH "official" | The MegaETH dev skills (`smart-accounts.md`, `erc7710-delegations.md`) document this stack. DelegationManager has a known address on MegaETH. So it's the path MegaETH itself most loudly endorses. |
| Privy integration | Privy supports it but it's less front-and-center than Kernel. |
| SDK polish | MetaMask Smart Accounts Kit is newer; rougher edges. |
| Session keys | ERC-7710 caveats list (allowedTargets, allowedMethods, valueLte, timestamp, limitedCalls). Slightly more declarative than Kernel's permission validators. |

### What it would cost to switch back

Real numbers:
- 1 hour to swap Privy's smart-wallet provider config from Kernel to MetaMask DeleGator
- Rewrite steps 12–13 of the build plan with `@metamask/smart-accounts-kit` + `DelegationManager.redeemDelegations()` instead of `@zerodev/sdk` + `@zerodev/permissions`
- Find a Stateless7702 implementation address on MegaETH (the skill doesn't list one — would need to check the kit's deployment config or deploy our own)

### My recommendation

**Stay on Kernel.** Reasons in priority order:

1. **You already configured the bundler/paymaster URLs.** Throwing that away is real friction.
2. **Kernel has better Privy integration.** Less SDK glue code I have to write.
3. **Production maturity beats ideological purity.** Kernel is what most live "Web2-feeling" crypto apps use. There's a reason.
4. **The user-facing UX is identical.** One signature → silent for an hour. The user doesn't know or care which smart-account standard is under the hood.

The §3 recommendation was based on the MegaETH dev skills explicitly featuring DelegationManager / ERC-7710. If you'd been deploying *with no Privy*, I'd still pick Stateless7702 because the MegaETH guides treat it as the default. With Privy in the picture, Kernel is the path of least resistance.

If anything, this is a case of me writing a doc that didn't account for the smart-wallet provider being chosen via Privy's UI. Calling that out so future stack picks include "what does Privy default to" as a factor.

---

## 2 · EIP-7702 vs counterfactual — what's actually going on

You said "I'm not sure whether it's setup as counterfactual or EIP-7702." Two things to know.

### a. There's no dashboard setting for 7702

The Privy dashboard's Smart Wallets config has fields for:
- Smart wallet provider (Kernel — set ✓)
- Bundler URL (set ✓)
- Paymaster URL (set ✓)

That's it. **There is no "enable 7702" toggle in the dashboard.** The mode is selected client-side, in the React app, when you instantiate the smart wallet client. So right now, with no frontend yet, your Privy app is in **counterfactual mode by default** — but that default applies only at the moment FE code runs, which is "never" right now. So nothing's actually deployed, you haven't committed to anything.

### b. The recipe you linked is exactly the right one

`https://docs.privy.io/recipes/react/eip-7702` is Privy's official recipe for putting their smart wallet in 7702 mode with Kernel. It walks through:

1. `PrivyProvider` config — adds `smartWallets: { eip7702: true }` (or similar — the exact key may have changed; I'll resolve when I write step 12)
2. The user's first interaction triggers a 7702 authorization tx that delegates their EOA to the Kernel implementation
3. After that, all UserOps execute through the EOA address (no separate smart-wallet address)

You don't need to follow this guide yourself — it's frontend SDK code. I'll wire it up during step 12.

### c. What changes for the user UX in each mode

| | Counterfactual | EIP-7702 |
|---|---|---|
| Smart wallet address | Different from EOA (CREATE2-derived) | Same as EOA |
| First-action signatures | 1 (session-key approval) | 2 (7702 authorization + session-key approval) — Kernel can batch these |
| Funding flow | "Send USDm + ETH to **0xABC** (your smart wallet address)" | "Send USDm + ETH to **0xABC** (your account)" — same thing |
| If user disconnects Privy and connects with MetaMask later | Sees their EOA empty; smart wallet at a different address | Sees their EOA with a 7702 delegation marker; same address everywhere |

For loopclub: **EIP-7702 is the cleaner choice.** Address-stability matters because users will want to off-ramp NFTs/USDm to "their wallet," and that mental model breaks if the Privy smart-wallet address ≠ their main wallet.

The 2-signature first-time cost (vs 1 with counterfactual) is genuinely small and Kernel batches them in some flows.

### d. Concrete plan

When I get to step 12 (Kernel session-key install):

1. Configure Privy SDK with `smartWallets: { provider: 'kernel', eip7702: true }`
2. On first user action: `useSmartWallets()` returns a client that issues both the 7702 auth and the permission install in one user-confirmation flow
3. Session key (random keypair in localStorage) signs subsequent UserOps, sent via `eth_sendRawTransactionSync` to the bundler

If 7702 turns out flaky on MegaETH testnet (unlikely, but possible — 7702 is newer), I fall back to counterfactual. The contracts don't care either way.

---

## 3 · Hot wallet next steps

`0x6cF2577B57ab7041Ec8815afC768cf73fd9C0Ee3`

When you have time:

1. Hit the MegaETH testnet faucet with that address — `https://testnet.megaeth.com/#faucet` (or wherever it lives this week; Discord pinned message has the live link).
2. Once it shows ~0.005 testnet ETH, ping me and I'll deploy. I do **not** need the private key — I'll send you the exact `forge script` command and you run it from your laptop. That keeps the key local. Output is the deployed `MockUsdm` and `loopclub` addresses, which you paste back to me.

If you'd rather I run it on the VPS, I'd need the key — share via 1Password or a Telegram message you delete after, and I'll forget it post-deploy. Not preferred but workable.

---

## 4 · Updated state vs build plan

| # | Step | Status |
|---|---|---|
| 1–5 | Foundry + contracts + tests + deploy script | ✅ written (last task) |
| 6 | Bundler endpoint | ✅ done — Kernel paymaster/bundler URLs configured in Privy |
| 7 | Hot wallet | 🟡 address provided, awaiting funding |
| 8 | Deploy | 🔒 blocked on 7 |
| 9–11 | FE scaffold, Privy auth, funding UI | next, after 8 |
| 12 | **Kernel session-key install — in EIP-7702 mode** (revised) | scheduled |
| 13 | Session signer + UserOp signing via `@zerodev/permissions` | scheduled |
| 14–21 | Grid, Tone.js, toggle/record, WS, profile, share | scheduled |

No new blockers introduced by the Kernel choice. The two soft items I called out last task are now resolved:
- Kernel mode question → answered above (counterfactual default, we'll switch to 7702 in code, no dashboard action needed)
- Royalty preference → defaulted to tagged-deposit unless you push back

---

## Summary of answers

1. **Was Kernel OK vs Stateless7702?** Yes. Kernel is more polished, has better Privy integration, you already configured it. Don't switch.
2. **Do you need to follow the 7702 recipe?** No — it's frontend code, not Privy dashboard config. I'll handle it during step 12. The link you shared is the right reference.
3. **Hot wallet?** Recorded. Fund when you can; cleanest deploy path is you running `forge script` from your laptop with the key local.
