// Wallet backend selection — bound ONCE at module load from the build-time env
// `VITE_WALLET_PROVIDER` (privy | moss; default privy). The whole app imports
// `WalletProvider` and `useWallet` from here and never touches a specific SDK.
//
// Binding at module scope (not per-render) is deliberate: it keeps the hook
// identity stable, so React's rules-of-hooks hold — a single build only ever
// calls one backend's hooks, in a fixed order. To switch wallets you redeploy
// with a different env var; you don't toggle it at runtime.

import { config } from '../config'
import { PrivyWalletProvider, usePrivyWallet } from './privy'
import { MossWalletProvider, useMossWallet } from './moss'

const useMoss = config.walletProvider === 'moss'

// The provider component to wrap <App/> with (in main.tsx).
export const WalletProvider = useMoss ? MossWalletProvider : PrivyWalletProvider

// The hook the app reads wallet state + sendCalls from.
export const useWallet = useMoss ? useMossWallet : usePrivyWallet

export type { Call, Wallet } from './types'
