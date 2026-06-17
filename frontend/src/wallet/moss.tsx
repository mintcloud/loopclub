// MOSS backend for the wallet abstraction.
//
// MOSS (https://docs.megaeth.com/moss-docs) is MegaETH's own embedded wallet
// for MegaETH apps — "connect, signing, transfers, contract calls, paymaster
// flows". It is NOT an injected EIP-1193 provider or WalletConnect; it's an SDK
// (@megaeth-labs/wallet-sdk-react) with a React provider + TanStack-Query hooks.
// This adapter maps that SDK onto the provider-agnostic `Wallet` interface so
// the rest of the app is unchanged. Selected by `VITE_WALLET_PROVIDER=moss`.
//
// Mapping from the app's needs to the MOSS SDK:
//   login/logout      → useConnect()/useDisconnect().mutate()
//   ready/auth/address → useStatus() { initialised, status, address }
//   sendCalls(batch)  → useCallContract().mutateAsync(CallContractRequest[])
// MOSS's useCallContract natively accepts an ARRAY of calls and submits them as
// one atomic batch — the same primitive loopclub's approve+toggle batching
// needs — and returns a receipt whose transactionHash we hand back so the
// existing `publicClient.waitForTransactionReceipt` path works untouched.

import { MegaProvider, useCallContract, useConnect, useDisconnect, useStatus } from '@megaeth-labs/wallet-sdk-react'
import type { Config } from '@megaeth-labs/wallet-sdk'
import type { PropsWithChildren } from 'react'
import type { Hex } from 'viem'
import { config } from '../config'
import type { SessionKey } from '../useSessionKey'
import type { Call, Wallet } from './types'

// Gas payment model.
//
// DEFAULT (VITE_MOSS_SPONSOR unset/false) — users pay their own gas. We pin
// `sponsorMode: 'explicit'` and never mark any call `sponsor: true`, so nothing
// is ever sponsored — deterministic user-pays, independent of MOSS's server-
// side default (which is 'app-only'). Users pay in ETH or an enabled stablecoin
// (USDm/USDT0) from their MOSS balance.
//
// SPONSORED (VITE_MOSS_SPONSOR=true) — gasless one-tap, mirroring the old
// ZeroDev paymaster. Uses 'app-only', which sponsors every app-initiated
// contract call (all loopclub sends) while leaving the wallet's own UI
// swaps/transfers user-paid. NOTE: sponsorship only actually fires when a
// sponsor backend is wired via VITE_MOSS_SPONSOR_URL — the endpoint MOSS calls
// to approve/fund each op. Without it, MOSS has nothing to sponsor with and
// falls back to user-paid even when this is true.
const mossConfig: Config = config.mossSponsor
  ? {
      network: config.mossNetwork,
      logging: 'error',
      sponsorMode: 'app-only',
      ...(config.mossSponsorUrl ? { sponsorUrl: config.mossSponsorUrl } : {}),
    }
  : {
      network: config.mossNetwork,
      logging: 'error',
      sponsorMode: 'explicit', // nothing opts in → user pays their own gas
    }

export function MossWalletProvider({ children }: PropsWithChildren) {
  return <MegaProvider config={mossConfig}>{children}</MegaProvider>
}

// Fast mode (ZeroDev session keys) is a Privy-stack feature. MOSS has a native
// equivalent — useGrantPermissions / usePermissions — but that's a separate,
// larger piece of work (see output/MOSS-integration.md). Until then MOSS runs
// with fast mode permanently off: this stub reports 'disabled', so the ⚡ badge
// never renders and every toggle goes through the normal signing path.
const disabledSession: SessionKey = {
  status: 'disabled',
  armed: false,
  expiresAt: null,
  errorMsg: null,
  arm: async () => {},
  disarm: () => {},
  send: async () => {
    throw new Error('Fast mode is not available on the MOSS wallet.')
  },
}

export function useMossWallet(): Wallet {
  const status = useStatus()
  const connect = useConnect()
  const disconnect = useDisconnect()
  const callContract = useCallContract()

  return {
    ready: status.initialised,
    authenticated: status.status === 'connected',
    address: (status.address ?? null) as Hex | null,
    // MOSS doesn't surface an email/identity in its status payload; the chip
    // falls back to the address, which is all the app actually needs.
    email: null,
    login: () => connect.mutate(),
    logout: () => disconnect.mutate(),
    session: disabledSession,
    async sendCalls(calls: Call[]): Promise<Hex> {
      // App calldata is already ABI-encoded, so pass it raw via `data`. MOSS
      // accepts an array and batches it atomically — same semantics as the
      // Privy smart wallet's `{ calls }`. Sponsorship is decided by the config's
      // sponsorMode ('app-only' sponsors these app calls; 'explicit' = user
      // pays), so no per-call `sponsor` flag is needed here.
      const result = await callContract.mutateAsync(
        calls.map((c) => ({ address: c.to, data: c.data })),
      )
      if (result.status !== 'approved') {
        throw new Error(
          result.error ??
            (result.status === 'cancelled' ? 'Transaction cancelled.' : 'Transaction failed.'),
        )
      }
      // A batch is one on-chain tx → `receipt`. Fall back to the first of
      // `receipts` if the SDK split them. Either way we return a real hash the
      // public RPC can confirm and decode events from.
      const hash = result.receipt?.transactionHash ?? result.receipts?.[0]?.transactionHash
      if (!hash) throw new Error('MOSS returned no transaction hash.')
      return hash
    },
  }
}
