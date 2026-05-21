// React binding for Step 4 session keys. Owns the "fast mode" state machine:
// restore-on-load, arm (one signature), expiry, disarm, and the send() the
// toggle flow routes through. See sessionKey.ts for the crypto + safety model.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useWallets } from '@privy-io/react-auth'
import { createWalletClient, custom, type Hex } from 'viem'
import { megaethMainnet } from './config'
import {
  armSession,
  clearStoredSession,
  restoreSession,
  SessionKeyAddressMismatch,
  sendViaSession,
  sessionKeysConfigured,
  type SessionContext,
} from './sessionKey'

export type SessionStatus =
  | 'disabled' // feature off (no flag / no ZeroDev RPC)
  | 'idle' // available, not armed
  | 'restoring' // checking localStorage for a live session
  | 'arming' // waiting on the user's one-time Privy signature
  | 'armed' // session key live — toggles take the fast path
  | 'mismatch' // kernel address ≠ Privy wallet — safely fell back
  | 'error' // arming failed for some other reason

export type SessionKey = {
  status: SessionStatus
  armed: boolean
  expiresAt: number | null
  errorMsg: string | null
  arm: () => Promise<void>
  disarm: () => void
  /** Send a single toggle call via the session key. Throws if not armed. */
  send: (call: { to: Hex; data: Hex }) => Promise<Hex>
}

export function useSessionKey(smartAddress: Hex | null): SessionKey {
  const { wallets } = useWallets()
  const enabled = sessionKeysConfigured()

  const [status, setStatus] = useState<SessionStatus>(enabled ? 'idle' : 'disabled')
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const ctxRef = useRef<SessionContext | null>(null)
  // Rapid clicks (onToggle is fire-and-forget) used to race on the bundler's
  // nonce → second UserOp reverted with AA25. Chain sends through a promise
  // queue so each session.send() reads its nonce only after the previous
  // submission is bundler-accepted. Catch on the chain itself to avoid
  // poisoning the queue when a single send rejects.
  const sendQueueRef = useRef<Promise<unknown>>(Promise.resolve())

  // Restore a still-valid session from localStorage once the smart wallet
  // resolves — the returning-user path, no signature required.
  useEffect(() => {
    if (!enabled || !smartAddress) return
    let cancelled = false
    setStatus('restoring')
    restoreSession(smartAddress)
      .then((ctx) => {
        if (cancelled) return
        if (ctx) {
          ctxRef.current = ctx
          setExpiresAt(ctx.expiresAt)
          setStatus('armed')
        } else {
          setStatus('idle')
        }
      })
      .catch((e) => {
        if (cancelled) return
        console.warn('[sessionKey] restore error', e)
        setStatus('idle')
      })
    return () => {
      cancelled = true
    }
  }, [enabled, smartAddress])

  // Auto-disarm when the session key's on-chain expiry passes.
  useEffect(() => {
    if (status !== 'armed' || expiresAt == null) return
    const ms = expiresAt - Date.now()
    const expire = () => {
      ctxRef.current = null
      clearStoredSession()
      setExpiresAt(null)
      setStatus('idle')
    }
    if (ms <= 0) {
      expire()
      return
    }
    const t = setTimeout(expire, ms)
    return () => clearTimeout(t)
  }, [status, expiresAt])

  const arm = useCallback(async () => {
    if (!enabled || !smartAddress) return
    const embedded = wallets.find((w) => w.walletClientType === 'privy')
    if (!embedded) {
      setErrorMsg('No Privy embedded wallet found to authorise the session key.')
      setStatus('error')
      return
    }
    try {
      setStatus('arming')
      setErrorMsg(null)
      const provider = await embedded.getEthereumProvider()
      const ownerWalletClient = createWalletClient({
        account: embedded.address as Hex,
        chain: megaethMainnet,
        transport: custom(provider),
      })
      const ctx = await armSession({ ownerWalletClient, expectedSmartAddress: smartAddress })
      ctxRef.current = ctx
      setExpiresAt(ctx.expiresAt)
      setStatus('armed')
    } catch (e) {
      ctxRef.current = null
      if (e instanceof SessionKeyAddressMismatch) {
        setErrorMsg(e.message)
        setStatus('mismatch')
      } else {
        setErrorMsg((e as Error)?.message ?? 'Could not enable fast mode.')
        setStatus('error')
      }
      console.error('[sessionKey] arm failed', e)
    }
  }, [enabled, smartAddress, wallets])

  const disarm = useCallback(() => {
    ctxRef.current = null
    clearStoredSession()
    setExpiresAt(null)
    setErrorMsg(null)
    setStatus(enabled ? 'idle' : 'disabled')
  }, [enabled])

  const send = useCallback(async (call: { to: Hex; data: Hex }) => {
    const ctx = ctxRef.current
    if (!ctx) throw new Error('Fast mode is not armed.')
    const next = sendQueueRef.current.then(() => sendViaSession(ctx, call))
    sendQueueRef.current = next.catch(() => undefined)
    return next
  }, [])

  return {
    status,
    armed: status === 'armed',
    expiresAt,
    errorMsg,
    arm,
    disarm,
    send,
  }
}
