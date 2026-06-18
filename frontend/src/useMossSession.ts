// MOSS "fast mode" — the native session-key bridge.
//
// This is the MOSS twin of useSessionKey.ts (the Privy/ZeroDev session key).
// Both satisfy the provider-agnostic `SessionKey` interface, so App.tsx's fast
// path (`session.armed ? session.send(call) : wallet.sendCalls(calls)`) works
// unchanged whichever wallet backend is bound.
//
// How MOSS does it (vs the Privy stack):
//   • arm()    → mega.grantPermissions(...) — ONE approval for a scoped, expiring
//                policy: toggle() on the loopclub contract only, with a daily
//                spend cap. This is the single full-page MOSS approval.
//   • send()   → mega.callContract([{ …, silent: true }]) — once a grant covers
//                the call, MOSS executes it WITHOUT an approval surface. No
//                full-page takeover, no per-toggle signing.
//   • restore  → mega.getPermissions(address) (usePermissions) reads the live
//                grant straight off the wallet. No localStorage, no in-browser
//                keypair, no address guard — the grant lives wallet-side, so it
//                survives reloads and is enforced by MegaETH's own infra. (The
//                Privy path had to generate a key, persist it, and byte-match the
//                Kernel address; none of that is needed here.)
//   • disarm() → mega.revokePermissions().
//
// Why this is safe to ship where Privy fast mode wasn't: MOSS permissions don't
// use ZeroDev's TimestampPolicy, so the `AA23 reverted` breakage that hard-
// disabled the Privy session key on chain 4326 simply doesn't exist. Gated
// behind config.mossFastMode (VITE_MOSS_FAST_MODE) — off by default.

import { useCallback, useMemo, useState } from 'react'
import {
  useCallContract,
  useGrantPermissions,
  usePermissions,
  useRevokePermissions,
} from '@megaeth-labs/wallet-sdk-react'
import type { Hex } from 'viem'
import { config } from './config'
import type { SessionKey, SessionStatus } from './useSessionKey'

// The only function the grant authorises, on the only contract it authorises —
// mirrors the Privy session key's scope (sessionKey.ts TOGGLE_SELECTOR). MOSS
// matches the calldata selector against this human-readable signature wallet-side.
const TOGGLE_SIGNATURE = 'toggle(uint8,uint16,uint16)'

// 4-byte selector of TOGGLE_SIGNATURE. We grant with the human-readable
// signature, but the hosted wallet may normalise it to the selector when it
// reports the grant back via getPermissions — so coversToggle() has to accept
// either form, else a live grant reads as "doesn't cover toggle" and the badge
// never leaves 'idle'.
const TOGGLE_SELECTOR = '0xd755885d'

// 24h — MOSS's recommended TTL for an active interactive session ("keep expiry
// short: 24h for active sessions"). Long enough that "one signature lasts" a
// whole jam, short enough to bound a leaked grant. The badge counts it down.
const MOSS_SESSION_TTL_SEC = 24 * 60 * 60

// Daily spend ceiling on the grant — a safety bound, not a feature. Toggles
// carry no msg.value and (user-pays mode) only cost a little gas; when sponsored
// the user spends nothing. 5e18 of the gas token comfortably covers a day of
// jamming while capping the blast radius if the grant is ever abused.
const MOSS_SESSION_SPEND_LIMIT = BigInt('5000000000000000000')

// Does a live grant actually cover loopclub.toggle()? Guards against a stale or
// differently-scoped grant being read as "armed".
function coversToggle(
  grant: { calls: { signature: string; to: string }[] } | undefined,
  loopclub: string,
): boolean {
  if (!grant) return false
  const target = loopclub.toLowerCase()
  return grant.calls.some((c) => {
    if (c.to.toLowerCase() !== target) return false
    const sig = (c.signature ?? '').toLowerCase()
    // Accept the human-readable signature ("toggle(...)") OR the 4-byte selector
    // the wallet may hand back instead.
    return sig.includes('toggle') || sig.startsWith(TOGGLE_SELECTOR)
  })
}

export function useMossSession(address: Hex | null): SessionKey {
  const enabled = config.mossFastMode

  // All MOSS hooks run unconditionally (Rules of Hooks); behaviour is gated by
  // `enabled` below. usePermissions polls the wallet for the live grant.
  const grant = useGrantPermissions()
  const revoke = useRevokePermissions()
  const callContract = useCallContract()
  const perms = usePermissions(address ?? undefined)

  // Local state only holds the transient phases the query can't express:
  // 'arming' (grant in flight) and 'error'. Everything else is DERIVED from the
  // on-chain grant, so the wallet is the single source of truth for "armed".
  const [local, setLocal] = useState<{ status: 'idle' | 'arming' | 'error'; errorMsg: string | null }>({
    status: 'idle',
    errorMsg: null,
  })

  const liveGrant = perms.data?.permissions ?? null
  const expiresAt = useMemo(() => {
    if (!liveGrant?.expiry) return null
    const ms = liveGrant.expiry * 1000 // grant expiry is unix seconds; the badge wants ms
    return ms > Date.now() && coversToggle(liveGrant.permissions, config.loopclubAddress) ? ms : null
  }, [liveGrant])

  // Resolve the status the SessionKey surface reports.
  const status: SessionStatus = !enabled
    ? 'disabled'
    : local.status === 'arming'
      ? 'arming'
      : local.status === 'error'
        ? 'error'
        : !address || perms.isLoading
          ? 'restoring'
          : expiresAt
            ? 'armed'
            : 'idle'

  const arm = useCallback(async () => {
    if (!enabled) return
    setLocal({ status: 'arming', errorMsg: null })
    try {
      const res = await grant.mutateAsync({
        permissions: {
          expiry: Math.floor(Date.now() / 1000) + MOSS_SESSION_TTL_SEC,
          permissions: {
            calls: [{ to: config.loopclubAddress, signature: TOGGLE_SIGNATURE }],
            spend: [{ limit: MOSS_SESSION_SPEND_LIMIT, period: 'day' }],
          },
        },
        // Mirror the app's gas model: when the app sponsors gas, the grant is
        // sponsored too; otherwise the user pays from their MOSS balance.
        ...(config.mossSponsor ? { sponsor: true } : {}),
      })
      if (res.status !== 'approved') {
        // User dismissed the approval — not an error, just stay idle.
        setLocal({ status: 'idle', errorMsg: null })
        return
      }
      // The hosted wallet indexes the grant asynchronously, so a single refetch
      // can land before getPermissions reflects it — leaving us stuck 'idle' with
      // no retry, and (because App's auto-arm chains session.send right after
      // arm) firing the first silent send against a grant that isn't live yet.
      // Poll until the grant reads back as covering toggle(), bounded so a
      // genuinely-rejected grant still resolves.
      let covered = false
      for (let i = 0; i < 8; i++) {
        const { data } = await perms.refetch()
        const g = data?.permissions
        const live = !!g?.expiry && g.expiry * 1000 > Date.now()
        // TEST DIAGNOSTIC (preview only): shows exactly what getPermissions
        // returns so a stuck-'idle' is unambiguous — empty grant (indexing/scope)
        // vs a grant whose signature coversToggle() rejects (selector mismatch).
        console.debug('[fastmode] arm poll', i, {
          hasGrant: !!g,
          expiry: g?.expiry,
          live,
          calls: g?.permissions?.calls,
          covers: live && coversToggle(g!.permissions, config.loopclubAddress),
        })
        if (live && coversToggle(g!.permissions, config.loopclubAddress)) {
          covered = true
          break
        }
        await new Promise((r) => setTimeout(r, 400))
      }
      if (!covered) {
        setLocal({
          status: 'error',
          errorMsg: 'Fast mode grant approved but the wallet never reported it — every toggle will keep prompting.',
        })
        return
      }
      setLocal({ status: 'idle', errorMsg: null })
    } catch (e) {
      setLocal({
        status: 'error',
        errorMsg: e instanceof Error ? e.message : 'Could not turn on fast mode.',
      })
    }
  }, [enabled, grant, perms])

  const disarm = useCallback(() => {
    if (!enabled) return
    setLocal({ status: 'idle', errorMsg: null }) // optimistic — badge hides immediately
    revoke.mutate(undefined, { onSettled: () => void perms.refetch() })
  }, [enabled, revoke, perms])

  // Submit one OR many calls in a single silent UserOp. MOSS's callContract
  // already takes a call array, so a batch (row fill / renew / jam) is the same
  // path as a single toggle — every call is covered by the active grant, so MOSS
  // skips the approval UI. This is what lets fast mode's batch rents inherit the
  // armed permissions instead of re-prompting the wallet.
  const sendBatch = useCallback(
    async (calls: { to: Hex; data: Hex }[]): Promise<Hex> => {
      const result = await callContract.mutateAsync(
        calls.map((c) => ({ address: c.to, data: c.data, silent: true })),
      )
      if (result.status !== 'approved') {
        throw new Error(
          result.error ??
            (result.status === 'cancelled' ? 'Transaction cancelled.' : 'Transaction failed.'),
        )
      }
      const hash = result.receipt?.transactionHash ?? result.receipts?.[0]?.transactionHash
      if (!hash) throw new Error('MOSS returned no transaction hash.')
      return hash
    },
    [callContract],
  )

  const send = useCallback(
    (call: { to: Hex; data: Hex }): Promise<Hex> => sendBatch([call]),
    [sendBatch],
  )

  return {
    status,
    armed: status === 'armed',
    expiresAt,
    errorMsg: local.errorMsg,
    arm,
    disarm,
    send,
    sendBatch,
  }
}
