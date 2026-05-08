import { defineChain } from 'viem'

export const config = {
  privyAppId: import.meta.env.VITE_PRIVY_APP_ID as string,
  chainId: Number(import.meta.env.VITE_CHAIN_ID),
  rpcUrl: import.meta.env.VITE_RPC_URL as string,
  loopchainAddress: import.meta.env.VITE_LOOPCHAIN_ADDRESS as `0x${string}`,
  paymentTokenAddress: import.meta.env.VITE_PAYMENT_TOKEN_ADDRESS as `0x${string}`,
  explorerUrl: import.meta.env.VITE_EXPLORER_URL as string,
}

export const megaethMainnet = defineChain({
  id: config.chainId,
  name: 'MegaETH Mainnet',
  nativeCurrency: { name: 'MegaETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
  blockExplorers: { default: { name: 'Blockscout', url: config.explorerUrl } },
  testnet: false,
})

export const STEPS = 16
export const TRACKS = 4
export const CELLS = STEPS * TRACKS
export const SYNTH_CELL_START = 48
export const TRACK_LABELS = ['kick', 'snare', 'hat', 'synth'] as const
export const PITCH_LABELS = ['C', 'D', 'E', 'G', 'A'] as const
export const LOOP_DURATION_SECONDS = 4
