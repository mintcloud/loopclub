import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PrivyProvider } from '@privy-io/react-auth'
import { SmartWalletsProvider } from '@privy-io/react-auth/smart-wallets'
import { App } from './App'
import { config, megaethMainnet } from './config'
import '../../design-system/index.css'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
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
      <SmartWalletsProvider>
        <App />
      </SmartWalletsProvider>
    </PrivyProvider>
  </StrictMode>
)
