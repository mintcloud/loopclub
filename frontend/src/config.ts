import { defineChain } from 'viem'

// ───── Fast mode (session keys) — RE-ENABLED 2026-05-21 ─────
// ZeroDev confirmed (and eth_getCode verified) that TimestampPolicy
// 0xB9f8f524bE6EcD8C945b1b87f9ae5C192FdCE20F is now deployed on chain 4326,
// unblocking the AA23 revert that put fast mode behind a hard gate on
// 2026-05-18. The session-key code in sessionKey.ts / useSessionKey.ts was
// left intact through that period, so flipping this flag back on is the only
// change needed; the ⚡ control reappears and toggles can take the fast path
// (still subject to VITE_ENABLE_SESSION_KEYS + VITE_ZERODEV_RPC_URL).
const SESSION_KEYS_SUPPORTED = true

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
  // ZeroDev bundler + paymaster RPC, used by "fast mode" (session keys) to
  // submit toggle UserOps signed by the in-browser session key. Same endpoint
  // the Privy Kernel wallet already uses. Session keys stay off unless set.
  zerodevRpcUrl: (import.meta.env.VITE_ZERODEV_RPC_URL as string | undefined) || undefined,
  // Master switch for Step 4 (session keys) — see sessionKey.ts. Requires BOTH
  // the build-time SESSION_KEYS_SUPPORTED gate above AND VITE_ENABLE_SESSION_KEYS.
  // The build-time gate exists to fail closed during periods when the on-chain
  // policy modules can't support the feature (cf. the 2026-05-18 → 2026-05-21
  // TimestampPolicy outage on MegaETH); flip it back to `false` in code if that
  // recurs, since an env-only switch is too easy to leave on.
  enableSessionKeys:
    SESSION_KEYS_SUPPORTED && import.meta.env.VITE_ENABLE_SESSION_KEYS === 'true',
}

// Multicall3 — same deterministic CREATE2 address on MegaETH mainnet as every
// other EVM chain. Lets the live grid snapshot all 144 cells in one RPC round-trip.
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

// Sound-expansion grid: 16 steps × 9 tracks = 144 cells. Track 8 (the last) is
// the synth row; its cells (id ≥ 128) carry a pitch. The eight rows above it are
// drum voices. These mirror the on-chain constants in Loopchain.sol.
export const STEPS = 16
export const TRACKS = 9
export const CELLS = STEPS * TRACKS // 144
export const SYNTH_CELL_START = 128 // track 8 → 8 * 16
// Track labels double as CSS class names — keep them class-safe (no spaces).
export const TRACK_LABELS = [
  'kick',
  'snare',
  'clap',
  'hat',
  'open-hat',
  'cowbell',
  'crash',
  'ride',
  'synth',
] as const
// Synth pitch is a 3-bit scale-degree index (0–7) — one diatonic octave.
export const PITCH_LABELS = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C↑'] as const
export const LOOP_DURATION_SECONDS = 4

// Toggle defaults — the cell popover opens pre-set to DEFAULT and the M hotkey jumps to MAX.
export const DEFAULT_TOGGLE_LOOPS = 16
export const MAX_TOGGLE_LOOPS = 32

// A cell with this many loops (or fewer) of rent left renders as "expiring" —
// it desaturates and pulses so the grid reads as time-bounded, contested state.
export const EXPIRING_SOON_LOOPS = 2

// ───── Session keys ("fast mode") — Step 4 ─────
// How long a single browser-armed session key stays valid before the user has
// to re-sign. Bounds the blast radius of a leaked key. Mirrors the 1-hour
// window from the original ux-architecture spec (§11).
export const SESSION_KEY_TTL_MS = 60 * 60 * 1000
// localStorage slot for the persisted session. Bump the suffix to invalidate
// every existing session (e.g. after a contract redeploy or policy change).
export const SESSION_KEY_STORAGE = 'loopchain.sessionkey.v1'
