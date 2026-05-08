import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PrivyProvider } from '@privy-io/react-auth'
import { SmartWalletsProvider } from '@privy-io/react-auth/smart-wallets'
import { App } from './App'
import { config, megaethTestnet } from './config'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrivyProvider
      appId={config.privyAppId}
      config={{
        defaultChain: megaethTestnet,
        supportedChains: [megaethTestnet],
        appearance: { theme: 'dark', accentColor: '#7c5cff' },
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
      }}
    >
      <SmartWalletsProvider>
        <App />
      </SmartWalletsProvider>
    </PrivyProvider>
  </StrictMode>
)
