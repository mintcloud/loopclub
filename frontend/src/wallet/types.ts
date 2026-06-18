// The provider-agnostic wallet surface the app codes against.
//
// loopclub historically talked straight to Privy's smart wallet
// (`useSmartWallets().client.sendTransaction({ calls })`). MegaETH then shipped
// MOSS — its own embedded wallet built for MegaETH apps — and we want the
// app to work with it. Rather than fork the UI per wallet, App.tsx now depends
// only on this interface; `./index` binds it to one backend at build time via
// `VITE_WALLET_PROVIDER` (privy | moss). Adding a third wallet later is one new
// adapter file, no changes in App.tsx.

import type { Hex } from 'viem'
import type { SessionKey } from '../useSessionKey'

// A single call inside a batched transaction (one UserOperation). Mirrors the
// shape the app has always built with `encodeFunctionData` — raw calldata to a
// target. Both backends accept an array and submit it as one atomic batch.
// `value` (wei) is optional and defaults to 0 — every loopclub contract call
// (rent/press/approve) moves no native ETH. It's set only by the "Withdraw"
// flow's native-ETH path, which submits `{ to: recipient, data: '0x', value }`
// — a plain ETH transfer expressed as a one-call batch. Keeping it on Call (not
// a separate method) means both backends withdraw ETH through the same
// `sendCalls` they already use, and the amount is always exact wei — no
// human-readable-unit ambiguity that could mis-size a transfer.
export type Call = { to: Hex; data: Hex; value?: bigint }

export type Wallet = {
  // Provider has finished its initial load (Privy `ready` / MOSS `initialised`).
  ready: boolean
  // A wallet is connected and usable for signing.
  authenticated: boolean
  // The address the app rents/presses from (Privy smart-wallet account / MOSS
  // account). Null until a wallet resolves.
  address: Hex | null
  // Best-effort human label for the connected identity (Privy email/Google).
  // MOSS doesn't surface one, so it's null there — purely cosmetic.
  email: string | null
  // Begin the connect flow (opens the wallet's connect UI).
  login: () => void
  // Disconnect / sign out.
  logout: () => void
  // Submit one or more calls as a single atomic batch and resolve to the
  // on-chain transaction hash. Every downstream confirm/log-decode goes through
  // `publicClient.waitForTransactionReceipt(hash)`, so the hash is all the app
  // needs back — the receipt is re-read from the chain, provider-agnostically.
  sendCalls: (calls: Call[]) => Promise<Hex>
  // "Fast mode" — one approval, then toggles sign without a per-tx prompt.
  // Privy implements it with a ZeroDev session key (useSessionKey.ts); MOSS with
  // its native grantPermissions + silent callContract (useMossSession.ts). Both
  // satisfy this one interface, so App.tsx's fast path is backend-agnostic. When
  // a backend reports `disabled` the ⚡ control doesn't render and the app
  // behaves as if fast mode never existed.
  session: SessionKey
}
