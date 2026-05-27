import { defineChain } from 'viem'

// ───── Fast mode (session keys) — HARD-DISABLED 2026-05-18 ─────
// Fast mode is non-functional on MegaETH and is removed from the deployment
// until that changes. The session-key permission depends on ZeroDev's
// TimestampPolicy contract (0xB9f8f524bE6EcD8C945b1b87f9ae5C192FdCE20F), which
// is NOT deployed on chain 4326 — so every fast-mode toggle reverts on-chain
// with `AA23 reverted 0x` (see sessionKey.ts for the full diagnosis).
//
// This build-time gate forces the feature off regardless of the
// VITE_ENABLE_SESSION_KEYS env var, so a stale Vercel setting can't ship the
// broken feature. With it off, useSessionKey() reports `disabled`, the ⚡
// fast-mode control is not rendered, and every cell toggle goes through the
// Privy client — i.e. the app behaves exactly as it did pre-session-keys.
//
// RE-ENABLE: flip this to `true` once ZeroDev deploys TimestampPolicy on chain
// 4326 (support ticket raised 2026-05-18). No other code change is needed —
// the session-key implementation (sessionKey.ts / useSessionKey.ts) is intact.
const SESSION_KEYS_SUPPORTED = false

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
  // the build-time SESSION_KEYS_SUPPORTED gate above (currently off — fast mode
  // is broken on MegaETH) AND the VITE_ENABLE_SESSION_KEYS env var. While
  // SESSION_KEYS_SUPPORTED is false this is always false, whatever the env says.
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
// Synth pitch is a 7-bit MIDI note number (0–127). The contract validates
// `cellData < PITCH_OPTIONS (=128)`; the frontend exposes a 3-octave subset
// (C1..C4, MIDI 24..60) — sub-bass to mid range, where the TB-303 voice sits
// most musically.
export const SYNTH_PITCH_MIN = 24 // C1 (low end of the in-app keyboard)
export const SYNTH_PITCH_MAX = 60 // C4 (high end, inclusive — 37 keys total)
export const SYNTH_PITCH_DEFAULT = 36 // C2 — opens a third of the way in, in the 303 sweet spot

// Names of the 12 pitch classes in semitone order. Indexed by `midi % 12`.
const PITCH_CLASS_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

// Scientific pitch notation: MIDI 60 = C4 (middle C), so the octave number is
// `floor(midi/12) - 1`. Used both for in-cell labels and key tooltips.
export function midiToLabel(midi: number): string {
  const cls = PITCH_CLASS_NAMES[((midi % 12) + 12) % 12]
  const octave = Math.floor(midi / 12) - 1
  return `${cls}${octave}`
}

// True when this MIDI note is a "white" piano key (natural — not a sharp).
export function isWhiteKey(midi: number): boolean {
  const cls = midi % 12
  return cls === 0 || cls === 2 || cls === 4 || cls === 5 || cls === 7 || cls === 9 || cls === 11
}

export const LOOP_DURATION_SECONDS = 4

// Toggle defaults — the cell popover opens pre-set to DEFAULT and the M hotkey jumps to MAX.
export const DEFAULT_TOGGLE_LOOPS = 16
export const MAX_TOGGLE_LOOPS = 32

// Cell-click tiers: 1 click = try (audition), 2 = toggle, 3 = max. Shared by
// the grid cells and the popover's piano keys so the gesture is identical
// wherever a sound can be triggered.
export type CellTier = 'try' | 'toggle' | 'max'

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
