// The provider-agnostic wallet surface the app codes against.
//
// loopclub historically talked straight to Privy's smart wallet
// (`useSmartWallets().client.sendTransaction({ calls })`). MegaETH then shipped
// MOSS — its own embedded wallet built for MegaETH apps — and Theo wants the
// app to work with it. Rather than fork the UI per wallet, App.tsx now depends
// only on this interface; `./index` binds it to one backend at build time via
// `VITE_WALLET_PROVIDER` (privy | moss). Adding a third wallet later is one new
// adapter file, no changes in App.tsx.

import type { Hex } from 'viem'
import type { SessionKey } from '../useSessionKey'

// A single call inside a batched transaction (one UserOperation). Mirrors the
// shape the app has always built with `encodeFunctionData` — raw calldata to a
// target. Both backends accept an array and submit it as one atomic batch.
export type Call = { to: Hex; data: Hex }

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
  // "Fast mode" (ZeroDev session keys). Real on the Privy backend; a permanently
  // -disabled stub on MOSS, whose native equivalent is `grantPermissions`
  // (see wallet/moss.tsx for the migration note). When disabled the ⚡ control
  // doesn't render, so the app behaves as if fast mode never existed.
  session: SessionKey
}
