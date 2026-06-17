import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { WalletProvider } from './wallet'
import '../../design-system/index.css'
import './index.css'

// WalletProvider is whichever backend VITE_WALLET_PROVIDER selected (Privy by
// default, MOSS when set to 'moss') — see src/wallet/index.ts. The App below is
// wallet-agnostic and talks only to the `useWallet()` hook.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WalletProvider>
      <App />
    </WalletProvider>
  </StrictMode>
)
