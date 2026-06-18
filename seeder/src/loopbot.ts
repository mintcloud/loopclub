// The control loop — the presence-gated state machine from the spec.
//
//   shouldJam = (activeVisitors >= 1) AND (humanCells == 0)
//
//   IDLE   → if shouldJam: pick a groove, rent ~6 free cells for `rentLoops`
//   ACTIVE → if a human joins (humanCells > 0): STOP renewing (cede the floor)
//            elif the room empties (activeVisitors == 0): STOP renewing (fade)
//            else: renew cells nearing expiry; swap groove every Nth cycle
//
// "Stop renewing" needs no teardown — the short rentals expire on their own
// within a loop or two, so the bot always fades musically rather than vanishing.
// If conditions return, it re-activates on the next tick.

import { chooseCells, pickGroove, specToCells, type CandidateCell, type JamHand } from './jam.js'
import type { Grid } from './grid.js'
import type { Presence } from './presence.js'
import type { SeederConfig } from './config.js'
import type { Watchdog } from './notify.js'

type State = 'IDLE' | 'ACTIVE'

export class Loopbot {
  private state: State = 'IDLE'
  private cycle = 0
  /** The groove the bot is currently playing (its candidate cells). */
  private groove: CandidateCell[] = []
  private ticking = false
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private cfg: SeederConfig,
    private grid: Grid,
    private presence: Presence,
    private jam: JamHand,
    private watchdog: Watchdog,
  ) {}

  private activeVisitors(): number {
    return this.cfg.forceActive ? 1 : this.presence.activeVisitors()
  }

  start(): void {
    this.timer = setInterval(() => {
      // Guard against overlapping ticks if a tick's awaits run long.
      if (this.ticking) return
      this.ticking = true
      void this.tick()
        .catch((e) => console.warn('[bot] tick error:', (e as Error)?.message ?? e))
        .finally(() => {
          this.ticking = false
        })
    }, this.cfg.tickMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async tick(): Promise<void> {
    const visitors = this.activeVisitors()
    const humans = this.grid.humanCellCount()
    const shouldJam = visitors >= 1 && humans === 0

    if (this.state === 'IDLE') {
      if (shouldJam) await this.activate()
    } else {
      // ACTIVE
      if (humans > 0) {
        this.fade('a human joined — ceding the floor')
      } else if (visitors === 0) {
        this.fade('room emptied — fading out')
      } else {
        await this.sustain()
      }
    }

    // Healthy tick → pet the watchdog. (A throw above skips this, so a wedged
    // RPC that rejects/hangs every tick eventually trips the staleness timeout
    // and the process restarts.)
    this.watchdog.pet()
  }

  private async activate(): Promise<void> {
    if (this.jam.wouldExceedCap(this.cfg.cellsPerGroove)) {
      console.log('[bot] daily rent cap reached — staying idle')
      return
    }
    const spec = pickGroove(this.cycle)
    this.groove = specToCells(spec)
    const free = new Set(this.grid.freeCells())
    const pick = chooseCells(this.groove, free, this.cfg.cellsPerGroove)
    if (pick.length === 0) {
      console.log('[bot] no free cells for groove — staying idle')
      return
    }
    const sent = await this.jam.rent(pick)
    if (sent > 0) {
      this.state = 'ACTIVE'
      console.log(`[bot] ACTIVE — ${spec.name ?? 'groove'} #${this.cycle}, rented ${sent} cells`)
    }
  }

  private async sustain(): Promise<void> {
    // Renew cells that are about to expire so the loop stays alive while the
    // room is occupied. Re-renting a cell the bot already holds stacks duration.
    const mine = this.grid.botCells()
    const expiring = mine.filter((c) => c.loopsLeft < this.cfg.renewThresholdLoops)
    if (expiring.length === 0) return

    // Every Nth cycle, swap to a fresh groove for variety instead of renewing
    // the same cells — rent the new groove's free cells; the old ones fade.
    this.cycle++
    const swap = this.cycle % this.cfg.grooveSwapEveryCycles === 0
    if (this.jam.wouldExceedCap(expiring.length)) {
      console.log('[bot] daily rent cap reached — letting cells fade')
      return
    }

    if (swap) {
      const spec = pickGroove(this.cycle)
      this.groove = specToCells(spec)
      const free = new Set(this.grid.freeCells())
      const pick = chooseCells(this.groove, free, this.cfg.cellsPerGroove)
      const sent = await this.jam.rent(pick)
      console.log(`[bot] swap groove → ${spec.name ?? 'groove'} #${this.cycle}, rented ${sent} cells`)
    } else {
      const renew: CandidateCell[] = expiring.map((c) => ({
        cellId: c.cellId,
        cellData: this.cellDataFor(c.cellId),
      }))
      const sent = await this.jam.rent(renew)
      console.log(`[bot] renew ${sent} expiring cells`)
    }
  }

  /** Recover the pitch a synth cell should be renewed with from the current
   *  groove; drums and unknown cells use 0. */
  private cellDataFor(cellId: number): number {
    const found = this.groove.find((c) => c.cellId === cellId)
    return found?.cellData ?? 0
  }

  private fade(reason: string): void {
    this.state = 'IDLE'
    this.cycle++
    console.log(`[bot] IDLE — ${reason}`)
  }
}
