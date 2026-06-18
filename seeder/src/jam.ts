// The musical brain + the on-chain hand.
//
// pickGroove() leans on loopgen's GENRES + humanize so the bot plays idiomatic
// loops, not random cells (loopgen is the shared brain — same encoder the MCP
// and frontend use). specToCells() flattens a LoopSpec into rentable cells.
// JamHand owns the wallet side: a one-time max USDm approval, then toggle()
// per cell, with a daily spend cap and dry-run support.

import { maxUint256, type Address } from 'viem'
import {
  GENRES,
  humanize,
  cellId as cellIdOf,
  TRACK_LABELS,
  SYNTH_CELL_START,
  toMidi,
  type LoopSpec,
} from 'loopclub-loopgen'
import { loopclubAbi, usdmAbi } from './abi.js'
import type { Clients } from './chain.js'
import type { SeederConfig } from './config.js'

const GENRE_NAMES = Object.keys(GENRES)

export interface CandidateCell {
  cellId: number
  /** MIDI note for synth cells; 0 for drums (contract ignores it). */
  cellData: number
}

/** Pick a groove for this activation cycle. Rotates genres for variety and
 *  applies a small deterministic-per-cycle density nudge so repeats don't read
 *  as a loop. */
export function pickGroove(cycle: number): LoopSpec {
  const name = GENRE_NAMES[cycle % GENRE_NAMES.length]!
  const base = GENRES[name]!()
  // Nudge density by a small amount that varies with the cycle (no RNG — keeps
  // the bot reproducible and avoids Math.random in a long-lived daemon).
  const amt = ((cycle % 3) - 1) * 0.15 // -0.15, 0, +0.15
  return amt === 0 ? base : humanize(base, amt, seededRng(cycle))
}

/** Tiny deterministic PRNG (mulberry32) so humanize() is reproducible per cycle
 *  without a global Math.random. */
function seededRng(seed: number): () => number {
  let a = (seed * 0x9e3779b1) >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Flatten a LoopSpec into the cells it would light, as (cellId, cellData). */
export function specToCells(spec: LoopSpec): CandidateCell[] {
  const out: CandidateCell[] = []
  for (const track of spec.tracks) {
    const trackIdx = TRACK_LABELS.indexOf(track.instrument)
    if (trackIdx < 0) continue
    if (track.instrument === 'synth') {
      for (const n of track.notes) {
        const pitch = clampPitch(toMidi(n.pitch))
        out.push({ cellId: cellIdOf(trackIdx, n.step), cellData: pitch })
      }
    } else {
      for (const step of track.steps) {
        out.push({ cellId: cellIdOf(trackIdx, step), cellData: 0 })
      }
    }
  }
  return out
}

function clampPitch(midi: number): number {
  return Math.max(0, Math.min(127, Math.round(midi)))
}

/** True if a cell belongs to the kick row (track 0) — the busiest row a
 *  newcomer reaches for first. We bias the bot OFF it so taps never collide. */
function isKickRow(cellId: number): boolean {
  return cellId < 16
}

/** Cap on melody (synth-row) cells per groove — drums alone read as random
 *  taps, so we always reserve 1-2 synth notes, but keep the footprint sparse. */
const MAX_SYNTH = 2

/** From a groove's candidate cells, choose up to `max` that are currently free.
 *  Guarantees a little melody (synth row) is present, then fills with non-kick
 *  drums, and only falls back to the kick row if still short — so the bot reads
 *  as a musical loop yet leaves a newcomer's first tap (usually the kick) room. */
export function chooseCells(
  candidates: CandidateCell[],
  freeCells: Set<number>,
  max: number,
): CandidateCell[] {
  const seen = new Set<number>()
  const free = candidates.filter((c) => freeCells.has(c.cellId) && !seen.has(c.cellId) && seen.add(c.cellId))

  const synth = free.filter((c) => c.cellId >= SYNTH_CELL_START)
  const nonKickDrums = free.filter((c) => c.cellId < SYNTH_CELL_START && !isKickRow(c.cellId))
  const kick = free.filter((c) => isKickRow(c.cellId))

  // 1. Reserve a melody slice (MIN..MAX synth notes, room permitting).
  const synthCount = Math.min(synth.length, MAX_SYNTH, max)
  const pick: CandidateCell[] = synth.slice(0, synthCount)
  // 2. Fill the rest off-kick, then from kick only if still short.
  for (const pool of [nonKickDrums, kick, synth.slice(synthCount)]) {
    for (const c of pool) {
      if (pick.length >= max) break
      pick.push(c)
    }
  }
  return pick
}

export class JamHand {
  private lc: { address: Address; abi: typeof loopclubAbi }
  private rentPerLoop = 0n
  private daySpent = 0n
  private dayKey = ''

  constructor(
    private clients: Clients,
    private cfg: SeederConfig,
  ) {
    this.lc = { address: cfg.loopclubAddress, abi: loopclubAbi }
  }

  /** Read current rent price and ensure the contract can pull USDm. Idempotent. */
  async ensureReady(): Promise<void> {
    const { publicClient } = this.clients
    this.rentPerLoop = (await publicClient.readContract({
      ...this.lc,
      functionName: 'rentPerLoop',
    })) as bigint

    const allowance = (await publicClient.readContract({
      address: this.cfg.paymentTokenAddress,
      abi: usdmAbi,
      functionName: 'allowance',
      args: [this.clients.account, this.cfg.loopclubAddress],
    })) as bigint

    const costPerCell = this.rentPerLoop * BigInt(this.cfg.rentLoops)
    if (allowance < costPerCell * BigInt(this.cfg.cellsPerGroove) * 100n) {
      if (this.cfg.dryRun) {
        console.log('[jam] DRY_RUN — would approve max USDm allowance')
      } else {
        console.log('[jam] approving max USDm allowance (one-time)…')
        const hash = await this.clients.walletClient.writeContract({
          address: this.cfg.paymentTokenAddress,
          abi: usdmAbi,
          functionName: 'approve',
          args: [this.cfg.loopclubAddress, maxUint256],
          chain: this.clients.chain,
          account: this.clients.walletClient.account!,
        })
        await this.clients.publicClient.waitForTransactionReceipt({ hash })
        console.log('[jam] allowance set:', hash)
      }
    }
  }

  /** USDm balance of the custodial wallet (whole USDm, for logging). */
  async balanceUsdm(): Promise<number> {
    const bal = (await this.clients.publicClient.readContract({
      address: this.cfg.paymentTokenAddress,
      abi: usdmAbi,
      functionName: 'balanceOf',
      args: [this.clients.account],
    })) as bigint
    return Number(bal / 10n ** 18n)
  }

  private costFor(cells: number): bigint {
    return this.rentPerLoop * BigInt(this.cfg.rentLoops) * BigInt(cells)
  }

  /** Rolls the daily spend window on UTC date change. */
  private rollDay(): void {
    const key = new Date().toISOString().slice(0, 10)
    if (key !== this.dayKey) {
      this.dayKey = key
      this.daySpent = 0n
    }
  }

  /** True if renting `cells` would breach the daily USDm cap. */
  wouldExceedCap(cells: number): boolean {
    if (this.cfg.dailyRentCapUsdm <= 0) return false
    this.rollDay()
    const capWei = BigInt(this.cfg.dailyRentCapUsdm) * 10n ** 18n
    return this.daySpent + this.costFor(cells) > capWei
  }

  /** Rent the given cells for `rentLoops`. Sends one toggle() per cell (the
   *  contract has no batch entrypoint; the custodial wallet signs each). Returns
   *  the number actually sent. */
  async rent(cells: CandidateCell[]): Promise<number> {
    if (cells.length === 0) return 0
    this.rollDay()
    const dur = this.cfg.rentLoops

    if (this.cfg.dryRun) {
      console.log(`[jam] DRY_RUN — would rent ${cells.length} cells:`, cells.map((c) => c.cellId).join(','))
      this.daySpent += this.costFor(cells.length)
      return cells.length
    }

    let sent = 0
    for (const c of cells) {
      try {
        const hash = await this.clients.walletClient.writeContract({
          ...this.lc,
          functionName: 'toggle',
          args: [c.cellId, dur, c.cellData],
          chain: this.clients.chain,
          account: this.clients.walletClient.account!,
        })
        sent++
        this.daySpent += this.costFor(1)
        // Don't block the tick on the receipt — fire the toggles and let the
        // grid event stream confirm them. Log the hash for journalctl.
        console.log(`[jam] toggle cell ${c.cellId}${c.cellData ? ` pitch ${c.cellData}` : ''} → ${hash}`)
      } catch (e) {
        const msg = (e as Error)?.message?.split('\n')[0] ?? String(e)
        console.warn(`[jam] toggle cell ${c.cellId} failed: ${msg}`)
      }
    }
    return sent
  }

  get isSynthCell(): (id: number) => boolean {
    return (id: number) => id >= SYNTH_CELL_START
  }
}
