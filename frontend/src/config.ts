import { defineChain } from 'viem'

export const config = {
  privyAppId: import.meta.env.VITE_PRIVY_APP_ID as string,
  chainId: Number(import.meta.env.VITE_CHAIN_ID),
  rpcUrl: import.meta.env.VITE_RPC_URL as string,
  // Optional WebSocket RPC. When set, the live grid pushes cell rentals over
  // eth_subscribe instead of polling getLogs. Falls back to the HTTP client.
  wsRpcUrl: (import.meta.env.VITE_WS_RPC_URL as string | undefined) || undefined,
  loopchainAddress: import.meta.env.VITE_LOOPCHAIN_ADDRESS as `0x${string}`,
  paymentTokenAddress: import.meta.env.VITE_PAYMENT_TOKEN_ADDRESS as `0x${string}`,
  explorerUrl: import.meta.env.VITE_EXPLORER_URL as string,
}

// Multicall3 — same deterministic CREATE2 address on MegaETH mainnet as every
// other EVM chain. Lets the live grid snapshot all 64 cells in one RPC round-trip.
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const

export const megaethMainnet = defineChain({
  id: config.chainId,
  name: 'MegaETH Mainnet',
  nativeCurrency: { name: 'MegaETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
  blockExplorers: { default: { name: 'Blockscout', url: config.explorerUrl } },
  contracts: { multicall3: { address: MULTICALL3 } },
  testnet: false,
})

export const STEPS = 16
export const TRACKS = 4
export const CELLS = STEPS * TRACKS
export const SYNTH_CELL_START = 48
export const TRACK_LABELS = ['kick', 'snare', 'hat', 'synth'] as const
export const PITCH_LABELS = ['C', 'D', 'E', 'G', 'A'] as const
export const LOOP_DURATION_SECONDS = 4

// Toggle defaults — the cell popover opens pre-set to DEFAULT and the M hotkey jumps to MAX.
export const DEFAULT_TOGGLE_LOOPS = 16
export const MAX_TOGGLE_LOOPS = 32

// A cell with this many loops (or fewer) of rent left renders as "expiring" —
// it desaturates and pulses so the grid reads as time-bounded, contested state.
export const EXPIRING_SOON_LOOPS = 2
