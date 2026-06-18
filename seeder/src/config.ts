// Seeder configuration — everything comes from the environment (the systemd
// EnvironmentFile / seeder.env). The custodial private key is the only secret;
// it is read here and never logged. All other knobs have sane defaults so a
// minimal env (key + RPC + address) boots a working bot.

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
  presenceAllowOrigin: string
  /** A session is "active" if seen within this window (ms). The hysteresis. */
  presenceTtlMs: number

  // ── Jam control ──
  /** Control loop cadence (ms). */
  tickMs: number
  /** How many drum/synth cells the bot lights per groove. */
  cellsPerGroove: number
  /** Rent duration per cell, in loops. Short so the bot fades fast. */
  rentLoops: number
  /** Renew when a held cell has fewer than this many loops left. */
  renewThresholdLoops: number
  /** Swap groove every Nth activation cycle for variety. */
  grooveSwapEveryCycles: number

  // ── Safety / testing ──
  /** Bypass the presence collector and always behave as if 1 visitor is here.
   *  Build-order step 1 — proves the on-chain behaviour before the heartbeat
   *  exists. NEVER leave on in production (the always-on failure mode). */
  forceActive: boolean
  /** Hard ceiling on USDm spent per UTC day (whole USDm). 0 = unlimited. */
  dailyRentCapUsdm: number
  /** When true, run the full control loop but never send a tx (log instead). */
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
    presenceAllowOrigin: process.env.PRESENCE_ALLOW_ORIGIN?.trim() || 'https://app.loopclub.xyz',
    presenceTtlMs: num('PRESENCE_TTL_MS', 30_000),

    tickMs: num('TICK_MS', 3_000),
    cellsPerGroove: num('CELLS_PER_GROOVE', 6),
    rentLoops: num('RENT_LOOPS', 8),
    renewThresholdLoops: num('RENEW_THRESHOLD_LOOPS', 3),
    grooveSwapEveryCycles: num('GROOVE_SWAP_EVERY_CYCLES', 4),

    forceActive: bool('FORCE_ACTIVE', false),
    dailyRentCapUsdm: num('DAILY_RENT_CAP_USDM', 0),
    dryRun: bool('DRY_RUN', false),
  }
}

// Mainnet loop duration (seconds) — mirrors the contract + frontend config.
// currentLoop = block.timestamp / LOOP_DURATION_SECONDS.
export const LOOP_DURATION_SECONDS = 4
