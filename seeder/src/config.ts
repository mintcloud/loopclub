// Seeder configuration — everything comes from the environment (the systemd
// EnvironmentFile / seeder.env). The custodial private key is the only secret;
// it is read here and never logged. All other knobs have sane defaults so a
// minimal env (key + RPC + address) boots a working bot.

import { homedir } from 'node:os'
import { join } from 'node:path'
import { type Address, type Hex, getAddress, isHex } from 'viem'

function required(name: string): string {
  const v = process.env[name]
  if (!v || !v.trim()) throw new Error(`Missing required env var ${name}`)
  return v.trim()
}

function num(name: string, dflt: number): number {
  const v = process.env[name]
  if (v === undefined || v.trim() === '') return dflt
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`env ${name} must be a number, got "${v}"`)
  return n
}

function bool(name: string, dflt: boolean): boolean {
  const v = process.env[name]
  if (v === undefined || v.trim() === '') return dflt
  return v.trim().toLowerCase() === 'true'
}

function poolMode(): 'genres' | 'setlist' | 'mixed' {
  const v = (process.env.POOL ?? 'mixed').trim().toLowerCase()
  if (v !== 'genres' && v !== 'setlist' && v !== 'mixed') {
    throw new Error(`env POOL must be genres | setlist | mixed, got "${v}"`)
  }
  return v
}

/** PRESENCE_ALLOW_ORIGIN is a comma-separated allowlist. Normalised the way an
 *  Origin header arrives — lowercase, no trailing slash — so comparison is exact.
 *  Unset keeps the single-origin default; `*` means "no check" (see presence.ts). */
function originList(): string[] {
  const raw = process.env.PRESENCE_ALLOW_ORIGIN?.trim() || 'https://app.loopclub.xyz'
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/\/$/, ''))
    .filter(Boolean)
}

function privateKey(): Hex {
  const raw = required('SEEDER_PRIVATE_KEY')
  const key = (raw.startsWith('0x') ? raw : `0x${raw}`) as Hex
  if (!isHex(key) || key.length !== 66) {
    throw new Error('SEEDER_PRIVATE_KEY must be a 32-byte hex string (0x + 64 chars)')
  }
  return key
}

export interface SeederConfig {
  // ── Chain ──
  privateKey: Hex
  rpcUrl: string
  /** Optional WebSocket RPC — when set, CellRented arrives via eth_subscribe. */
  wsRpcUrl: string | undefined
  chainId: number
  loopclubAddress: Address
  paymentTokenAddress: Address

  // ── Presence ──
  presencePort: number
  presenceBind: string
  /** Origins allowed to beat (comma-separated in the env). Checked server-side:
   *  CORS headers alone stop nothing, since a forger doesn't use a browser. `*`
   *  disables the check and lets any page on the web make robodj spend. */
  presenceAllowOrigins: string[]
  /** A session is "active" if seen within this window (ms). The hysteresis. */
  presenceTtlMs: number
  /** Beats one IP may send per minute. A real tab beats 4×/min, so this is loose
   *  by design — it exists to stop a flood, not to police a visitor. */
  presenceMaxBeatsPerMin: number
  /** Concurrent sessions one IP may hold. Bounds how big a room a single host
   *  can fake; a household behind one NAT is still comfortably under it. */
  presenceMaxSessionsPerIp: number

  // ── Jam control ──
  /** Control loop cadence (ms). */
  tickMs: number
  /** How many drum/synth cells the bot lights per groove. */
  cellsPerGroove: number
  /** Rent duration per cell, in loops. Short so the bot fades fast. */
  rentLoops: number
  /** Renew when a held cell has fewer than this many loops left. */
  renewThresholdLoops: number
  /** Hold a groove this long before rotating to the next one (ms). Renewals keep
   *  it alive until then. Time-based, so it can't alias against the pool size. */
  grooveHoldMs: number
  /** Which pool the bot rotates through: the procedural GENRES, the hand-authored
   *  SETLIST (Seven Nation Army, anthems, terrace chants), or both interleaved. */
  pool: 'genres' | 'setlist' | 'mixed'
  /** Cell budget for a setlist groove. Higher than cellsPerGroove because a tune
   *  needs its melody: trimming a setlist loop to 6 cells leaves an unrecognisable
   *  stub. Drums are dropped before synth notes when the budget bites. */
  setlistCells: number
  /** Extra loops for the rotation, as `?jam=` deep links (comma-separated) — the
   *  ones you built with the MCP `build_loop` tool. Decoded at boot; a malformed
   *  link is logged and skipped rather than crashing the bot. */
  setlistLinks: string[]

  // ── Safety / testing ──
  /** Bypass the presence collector and always behave as if 1 visitor is here.
   *  Build-order step 1 — proves the on-chain behaviour before the heartbeat
   *  exists. NEVER leave on in production (the always-on failure mode). */
  forceActive: boolean
  /** Hard ceiling on USDm spent per UTC day (whole USDm). 0 = unlimited. */
  dailyRentCapUsdm: number
  /** Ceiling on USDm spent in any rolling hour. 0 = unlimited. This is the knob
   *  that actually governs burn: a held cell costs rentPerLoop per loop, so cost
   *  scales with (cells lit × time held). When the hour's budget is spent the bot
   *  fades and sits out until the window frees — bursty, but solvent. */
  hourlyRentCapUsdm: number
  /** Where the spend windows are persisted. The caps are the seeder's only real
   *  ceiling (the wallet is refilled by the funder, so its balance is a faucet,
   *  not a fence) — and `Restart=always` used to reset them every five seconds.
   *  This file is what makes them a budget instead of a brake. */
  rentStatePath: string
  /** When true, run the full control loop but never send a tx (log instead).
   *  Dry-run spend is booked in memory only and never touches the ledger file. */
  dryRun: boolean
}

export function loadConfig(): SeederConfig {
  return {
    privateKey: privateKey(),
    rpcUrl: required('RPC_URL'),
    wsRpcUrl: process.env.WS_RPC_URL?.trim() || undefined,
    chainId: num('CHAIN_ID', 4326),
    loopclubAddress: getAddress(required('LOOPCLUB_ADDRESS')),
    paymentTokenAddress: getAddress(
      process.env.PAYMENT_TOKEN_ADDRESS?.trim() || '0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7',
    ),

    presencePort: num('PRESENCE_PORT', 3009),
    presenceBind: process.env.PRESENCE_BIND?.trim() || '127.0.0.1',
    presenceAllowOrigins: originList(),
    presenceTtlMs: num('PRESENCE_TTL_MS', 30_000),
    presenceMaxBeatsPerMin: num('PRESENCE_MAX_BEATS_PER_MIN', 40),
    presenceMaxSessionsPerIp: num('PRESENCE_MAX_SESSIONS_PER_IP', 8),

    tickMs: num('TICK_MS', 3_000),
    cellsPerGroove: num('CELLS_PER_GROOVE', 6),
    rentLoops: num('RENT_LOOPS', 8),
    renewThresholdLoops: num('RENEW_THRESHOLD_LOOPS', 3),
    grooveHoldMs: num('GROOVE_HOLD_MS', 30_000),
    pool: poolMode(),
    setlistCells: num('SETLIST_CELLS', 14),
    setlistLinks: (process.env.SETLIST_LINKS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),

    forceActive: bool('FORCE_ACTIVE', false),
    dailyRentCapUsdm: num('DAILY_RENT_CAP_USDM', 0),
    hourlyRentCapUsdm: num('HOURLY_RENT_CAP_USDM', 0),
    rentStatePath:
      process.env.RENT_STATE_PATH?.trim() || join(homedir(), '.config', 'loopclub', 'rent-state.json'),
    dryRun: bool('DRY_RUN', false),
  }
}

// Mainnet loop duration (seconds) — mirrors the contract + frontend config.
// currentLoop = block.timestamp / LOOP_DURATION_SECONDS.
export const LOOP_DURATION_SECONDS = 4
