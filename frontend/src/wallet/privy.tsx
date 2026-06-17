// Privy + ZeroDev backend for the wallet abstraction (the original stack).
//
// Wraps the exact provider tree the app shipped with — a Privy smart wallet
// whose signer is the embedded wallet — behind the provider-agnostic `Wallet`
// interface. This is the DEFAULT backend; nothing about the production UX
// changes unless `VITE_WALLET_PROVIDER=moss` flips the binding in ./index.

import { PrivyProvider, usePrivy } from '@privy-io/react-auth'
import { SmartWalletsProvider, useSmartWallets } from '@privy-io/react-auth/smart-wallets'
import type { PropsWithChildren } from 'react'
import type { Hex } from 'viem'
import { config, megaethMainnet } from '../config'
import { useSessionKey } from '../useSessionKey'
import type { Call, Wallet } from './types'

export function PrivyWalletProvider({ children }: PropsWithChildren) {
  return (
    <PrivyProvider
      appId={config.privyAppId}
      config={{
        defaultChain: megaethMainnet,
        supportedChains: [megaethMainnet],
        appearance: { theme: 'dark', accentColor: '#7c5cff' },
        // Every loopclub action is signed by a Privy *smart wallet*, whose signer
        // is the embedded wallet (see SmartWalletsProvider below). So the embedded
        // wallet has to exist for `useSmartWallets().client` to be defined.
        // 'users-without-wallets' only provisions one for email/social logins —
        // a user who logs in with their OWN wallet (MetaMask/Rabby) is classified
        // as "already has a wallet", gets NO embedded wallet, hence no smart-wallet
        // signer, hence `client` stays undefined and the account chip sticks at "…".
        // 'all-users' provisions the embedded signer regardless of how they logged
        // in, so external-wallet logins also get a working smart wallet.
        embeddedWallets: { ethereum: { createOnLogin: 'all-users' } },
      }}
    >
      <SmartWalletsProvider>{children}</SmartWalletsProvider>
    </PrivyProvider>
  )
}

export function usePrivyWallet(): Wallet {
  const { ready, authenticated, user, login, logout } = usePrivy()
  const { client } = useSmartWallets()
  const address = (client?.account?.address ?? null) as Hex | null
  const session = useSessionKey(address)

  return {
    ready,
    authenticated,
    address,
    email: user?.email?.address ?? user?.google?.email ?? null,
    login,
    logout,
    session,
    async sendCalls(calls: Call[]): Promise<Hex> {
      if (!client) throw new Error('Smart wallet not ready yet — try again in a moment.')
      // Always submit through the batch form; a single call is a one-element
      // batch. `showWalletUIs: false` keeps the gasless one-tap UX the app had.
      return client.sendTransaction(
        { calls },
        { uiOptions: { showWalletUIs: false } },
      ) as Promise<Hex>
    },
  }
}
