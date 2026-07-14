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
  SETLIST,
  humanize,
  decode,
  fromLink,
  cellId as cellIdOf,
  TRACK_LABELS,
  SYNTH_CELL_START,
  toMidi,
  type LoopSpec,
} from 'loopclub-loopgen'
import { loopclubAbi, usdmAbi } from './abi.js'
import type { Clients } from './chain.js'
import type { SeederConfig } from './config.js'

export interface CandidateCell {
  cellId: number
  /** MIDI note for synth cells; 0 for drums (contract ignores it). */
  cellData: number
}

/** One item in the rotation. `tune` entries (setlist + pasted jam links) are
 *  recognisable melodies: they get a bigger cell budget and their synth row is
 *  never sacrificed. `genre` entries are the procedural templates — sparse,
 *  drum-led, humanised. */
export interface Groove {
  name: string
  kind: 'genre' | 'tune'
  spec: LoopSpec
}

/**
 * Build the rotation pool once at boot.
 *
 * The pool is a flat, ordered list; the bot walks it with a monotonic counter.
 * `mixed` interleaves so a tune never sits behind three genres in a row.
 */
export function buildPool(cfg: SeederConfig): Groove[] {
  const genres: Groove[] = Object.keys(GENRES).map((name) => ({
    name,
    kind: 'genre',
    spec: GENRES[name]!(),
  }))

  const tunes: Groove[] = Object.keys(SETLIST).map((name) => {
    const spec = SETLIST[name]!()
    return { name: spec.name ?? name, kind: 'tune', spec }
  })

  // Loops Theo built with the MCP `build_loop` tool, pasted into SETLIST_LINKS.
  // A bad link must never take the bot down — skip it and keep the rest.
  cfg.setlistLinks.forEach((link, i) => {
    try {
      const spec = decode(fromLink(link))
      tunes.push({ name: spec.name ?? `custom ${i + 1}`, kind: 'tune', spec })
    } catch (e) {
      console.warn(`[jam] skipping SETLIST_LINKS[${i}]: ${(e as Error)?.message ?? e}`)
    }
  })

  if (cfg.pool === 'genres') return genres
  if (cfg.pool === 'setlist') return tunes.length > 0 ? tunes : genres

  // mixed — interleave, longest pool first so nothing is starved.
  const out: Groove[] = []
  const [long, short] = tunes.length >= genres.length ? [tunes, genres] : [genres, tunes]
  for (let i = 0; i < long.length; i++) {
    out.push(long[i]!)
    const s = short[i]
    if (s) out.push(s)
  }
  return out
}

/**
 * Pick the pool entry at `index`, wrapping.
 *
 * `index` MUST be a monotonic counter, not something derived from the tick/cycle
 * count. The old code took `cycle % GENRE_NAMES.length` while the swap fired on
 * `cycle % grooveSwapEveryCycles === 0` — with 4 genres and a swap every 4
 * cycles those two moduli aliased perfectly and every single swap landed on
 * pool[0]. The bot played house, and only house, forever.
 */
export function pickGroove(pool: Groove[], index: number): Groove {
  const g = pool[((index % pool.length) + pool.length) % pool.length]!
  if (g.kind === 'tune') return g // a tune is the tune — never humanise it
  // Nudge genre density so a repeat of the same template doesn't read identically.
  const amt = ((index % 3) - 1) * 0.15 // -0.15, 0, +0.15
  return amt === 0 ? g : { ...g, spec: humanize(g.spec, amt, seededRng(index)) }
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

/** Cap on melody (synth-row) cells for a *genre* groove — drums alone read as
 *  random taps, so we always reserve 1-2 synth notes, but keep the footprint
 *  sparse. Tunes have no such cap: their melody is the whole point. */
const MAX_SYNTH_GENRE = 2

/** Drum cells held back for a *tune* whose melody would otherwise eat the whole
 *  budget (Ode to Joy is 14 notes). A tune with no pulse under it reads as a
 *  music-box, not a loop — two cells buy the kick that makes it a groove. */
const TUNE_DRUM_RESERVE = 2

/**
 * From a groove's candidate cells, choose up to `max` that are currently free.
 *
 * Two different priorities, because the two kinds of groove fail differently:
 *
 *   genre — reserve a sliver of melody, then fill with non-kick drums, and only
 *           fall back to the kick row if still short. A newcomer's first tap is
 *           almost always the kick, and a bot squatting there is the one
 *           collision that reads as rude.
 *   tune  — melody first, all of it, then the drums in the order the spec lists
 *           them. Seven Nation Army minus its riff is not Seven Nation Army; a
 *           kick collision is a fair price for a recognisable loop, and the bot
 *           cedes the floor the moment a human touches the grid anyway.
 */
export function chooseCells(
  candidates: CandidateCell[],
  freeCells: Set<number>,
  max: number,
  kind: 'genre' | 'tune' = 'genre',
): CandidateCell[] {
  const seen = new Set<number>()
  const free = candidates.filter((c) => freeCells.has(c.cellId) && !seen.has(c.cellId) && seen.add(c.cellId))

  const synth = free.filter((c) => c.cellId >= SYNTH_CELL_START)

  if (kind === 'tune') {
    const drums = free.filter((c) => c.cellId < SYNTH_CELL_START)
    // Melody first, but keep a couple of cells back for the pulse. The tail of a
    // long phrase is the cheapest thing to lose; the kick is not.
    const reserve = drums.length > 0 ? Math.min(TUNE_DRUM_RESERVE, Math.max(0, max - 1)) : 0
    const pick = synth.slice(0, Math.max(0, max - reserve))
    for (const c of drums) {
      if (pick.length >= max) break
      pick.push(c)
    }
    return pick
  }

  const nonKickDrums = free.filter((c) => c.cellId < SYNTH_CELL_START && !isKickRow(c.cellId))
  const kick = free.filter((c) => isKickRow(c.cellId))

  // 1. Reserve a melody slice (up to MAX_SYNTH_GENRE notes, room permitting).
  const synthCount = Math.min(synth.length, MAX_SYNTH_GENRE, max)
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
  /** Spend events in the last hour: [epoch ms, wei]. Pruned on read. */
  private hourWindow: Array<[number, bigint]> = []

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

  /** Spend inside the rolling hour, pruning anything older. */
  private hourSpent(): bigint {
    const cutoff = Date.now() - 3_600_000
    this.hourWindow = this.hourWindow.filter(([t]) => t >= cutoff)
    return this.hourWindow.reduce((sum, [, wei]) => sum + wei, 0n)
  }

  /** USDm spent in the rolling hour (for logging). */
  spentThisHour(): number {
    return Number(this.hourSpent()) / 1e18
  }

  /** True if renting `cells` would breach the daily OR the rolling-hour USDm cap.
   *  Both windows are in-memory, so a restart forgives the spend so far — the
   *  caps are a brake on runaway logic, not an accounting ledger. */
  wouldExceedCap(cells: number): boolean {
    const cost = this.costFor(cells)

    if (this.cfg.dailyRentCapUsdm > 0) {
      this.rollDay()
      const dayCapWei = BigInt(this.cfg.dailyRentCapUsdm) * 10n ** 18n
      if (this.daySpent + cost > dayCapWei) return true
    }

    if (this.cfg.hourlyRentCapUsdm > 0) {
      const hourCapWei = BigInt(this.cfg.hourlyRentCapUsdm) * 10n ** 18n
      if (this.hourSpent() + cost > hourCapWei) return true
    }

    return false
  }

  /** Book a spend against both windows. */
  private record(cells: number): void {
    const cost = this.costFor(cells)
    this.daySpent += cost
    this.hourWindow.push([Date.now(), cost])
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
      this.record(cells.length)
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
        this.record(1)
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
