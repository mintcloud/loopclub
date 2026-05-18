# Loopchain — checkpoints & rollback

*Started 2026-05-15. A running log of "known-good" points and how to get back to them.*

Each checkpoint is an annotated git tag on a commit that is build-verified and
deployed (or deployable). If a later change misbehaves, roll back to the
nearest checkpoint below.

---

## `pre-session-keys` — before Step 4

- **Tag:** `pre-session-keys`
- **Commit:** `7983a4f` — *frontend: event-streamed live grid + owner colours + block-sync badge*
- **Date:** 2026-05-15
- **What it is:** steps 1–3 of the latency/collab plan shipped (live grid,
  owner-coloured cells, block-sync badge). Pure frontend on the deployed
  mainnet contract. **No session keys.** Every transaction — toggle, record,
  press, claim — is signed through the Privy `useSmartWallets()` client.

**State at this checkpoint**

| Thing | Value |
|---|---|
| Network | MegaETH mainnet, chain `4326` |
| Loopchain contract | `0xE9Ba1E07Df5D95234F4e0102d06eAe2f16365f1a` |
| USDm (payment token) | `0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7` |
| Privy app id | `cmoxau2fi00xd0clevvngoxzr` |
| Smart-account stack | Privy + ZeroDev Kernel (counterfactual), `SmartWalletsProvider` |
| Frontend deps | no `@zerodev/*`; `permissionless` + `@privy-io/react-auth` only |

**Roll back to it**

```bash
# nuclear — discard everything after the checkpoint
git reset --hard pre-session-keys

# safer — keep history, add an inverse commit
git revert --no-commit <session-keys-commit>..HEAD && git commit
```

The contract is **not** redeployed by any of this, so a frontend rollback is
all that's needed — no on-chain action.

---

## Step 4 — session keys ("fast mode")

> **STATUS 2026-05-18 — fast mode is HARD-DISABLED.** It is non-functional on
> MegaETH: the session-key permission needs ZeroDev's `TimestampPolicy`
> contract (`0xB9f8f524…20F`), which is not deployed on chain 4326, so every
> fast-mode toggle reverts with `AA23 reverted 0x`. `config.ts` now gates the
> feature behind a build-time `SESSION_KEYS_SUPPORTED = false` constant, so the
> deployment ships without fast mode regardless of `VITE_ENABLE_SESSION_KEYS`.
> A ZeroDev support ticket (raised 2026-05-18) asks them to deploy
> `TimestampPolicy` on 4326. **Re-enable:** flip `SESSION_KEYS_SUPPORTED` to
> `true` once the contract is live — no other code change needed.

Added on top of `pre-session-keys`. Lets a user authorise an in-browser
session key once, after which cell toggles are signed locally (no Privy
round-trip). See `frontend/src/sessionKey.ts` for the full safety model.

**Three independent rollback levers, smallest blast radius first:**

1. **Feature flag (no deploy of code).** Set `VITE_ENABLE_SESSION_KEYS=false`
   in the Vercel env and redeploy. Fast mode vanishes from the UI; every
   toggle goes back through the Privy client. This is the kill switch — reach
   for it first if fast mode misbehaves in production.

2. **Disarm (per-user, no deploy at all).** The `✕` on the fast-mode badge
   clears that browser's session key. Also self-clears on the 1-hour expiry.

3. **Full revert (code).** `git revert` / `git reset --hard pre-session-keys`
   as above. Only needed if the feature flag isn't enough.

**Safe by construction:** even with the flag on, the session key is only used
if the ZeroDev Kernel account it builds has the *same address* as the live
Privy smart wallet. Any mismatch disables fast mode and falls back to Privy —
funds can never be routed to a different account.

**Verification gate — do this before flipping the flag on in production:**

1. Deploy a preview build with `VITE_ENABLE_SESSION_KEYS=true` and
   `VITE_ZERODEV_RPC_URL` set.
2. Connect, open the browser console, click **⚡ enable fast mode**.
3. Confirm the console logs `[sessionKey] kernel address matches ✓`.
   - If instead you see a `SessionKeyAddressMismatch`, Privy is on a Kernel
     version this build doesn't probe — widen `KERNEL_CANDIDATES` in
     `sessionKey.ts` with the version Privy reports, and re-test.
4. Toggle a cell. It should land with no wallet popup and no Privy round-trip.
   A failed toggle here usually means the ZeroDev call/timestamp policy
   contracts aren't deployed on MegaETH at the version pinned in
   `sessionKey.ts` — adjust `CallPolicyVersion` and re-test.
5. Only once 1–4 pass: set `VITE_ENABLE_SESSION_KEYS=true` in production.
