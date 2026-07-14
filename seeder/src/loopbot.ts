// The control loop — the presence-gated state machine from the spec.
//
//   shouldJam = (activeVisitors >= 1) AND (humanCells == 0)
//
//   IDLE   → if shouldJam: take the next groove off the rotation, rent its cells
//   ACTIVE → if a human joins (humanCells > 0): STOP renewing (cede the floor)
//            elif the room empties (activeVisitors == 0): STOP renewing (fade)
//            elif the groove has been held for grooveHoldMs: rotate to the next
//            else: renew cells nearing expiry
//
// "Stop renewing" needs no teardown — the short rentals expire on their own
// within a loop or two, so the bot always fades musically rather than vanishing.
// If conditions return, it re-activates on the next tick.
//
// The rotation is a monotonic counter over a flat pool (see jam.buildPool). It is
// deliberately NOT derived from the tick count: the previous version indexed the
// genre list by `cycle % 4` while swapping on `cycle % 4 === 0`, so every swap
// landed on pool[0] and the bot played house, and only house, forever.

import {
  buildPool,
  chooseCells,
  pickGroove,
  specToCells,
  type CandidateCell,
  type Groove,
  type JamHand,
} from './jam.js'
import type { Grid } from './grid.js'
import type { Presence } from './presence.js'
import type { SeederConfig } from './config.js'
import type { Watchdog } from './notify.js'

type State = 'IDLE' | 'ACTIVE'

export class Loopbot {
  private state: State = 'IDLE'
  private pool: Groove[]
  /** Monotonic rotation counter. Seeded from the clock so a restart resumes the
   *  rotation somewhere new instead of replaying pool[0] every time the service
   *  bounces — which, for a unit that has crash-looped before, is its own way of
   *  always playing the same loop. */
  private rotor: number
  /** The groove currently on the grid, and the cells it stands for. */
  private groove: Groove | null = null
  private grooveCells: CandidateCell[] = []
  /** The cells the bot actually rented for the current groove. Only these get
   *  renewed: botCells() is every cell the WALLET holds, which after a rotation
   *  still includes the outgoing groove's cells. Renewing those would resurrect
   *  the loop we just rotated away from (and re-rent stray synth cells at pitch
   *  0, since cellDataFor() no longer knows their note). Let them fade. */
  private held = new Set<number>()
  private grooveStartedAt = 0
  private ticking = false
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private cfg: SeederConfig,
    private grid: Grid,
    private presence: Presence,
    private jam: JamHand,
    private watchdog: Watchdog,
  ) {
    this.pool = buildPool(cfg)
    this.rotor = Math.floor(Date.now() / 60_000)
    console.log(
      `[bot] rotation (${cfg.pool}, ${this.pool.length} grooves): ${this.pool.map((g) => g.name).join(' → ')}`,
    )
  }

  private activeVisitors(): number {
    return this.cfg.forceActive ? 1 : this.presence.activeVisitors()
  }

  /** Cell budget for a groove — a tune needs room for its melody. */
  private budgetFor(g: Groove): number {
    return g.kind === 'tune' ? this.cfg.setlistCells : this.cfg.cellsPerGroove
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

  /** Take the next groove off the rotation and put it on the grid. */
  private async play(reason: 'ACTIVE' | 'rotate'): Promise<boolean> {
    const groove = pickGroove(this.pool, this.rotor++)
    const budget = this.budgetFor(groove)

    if (this.jam.wouldExceedCap(budget)) {
      console.log(
        `[bot] rent cap reached (${this.jam.spentThisHour().toFixed(2)} USDm this hour) — sitting out`,
      )
      return false
    }

    const cells = specToCells(groove.spec)
    // Available = free cells PLUS the cells the bot itself still holds. The
    // outgoing groove's rental has ~rentLoops left on it at rotation time, and
    // freeCells() counts those as taken — so without this the incoming tune
    // renders with holes exactly where the two grooves overlap (the synth row,
    // most of all). toggle() lets the current renter re-toggle their own cell:
    // it stacks the duration and rewrites the pitch (Loopclub.sol:269-279).
    const available = new Set([...this.grid.freeCells(), ...this.grid.botCells().map((c) => c.cellId)])
    const pick = chooseCells(cells, available, budget, groove.kind)
    if (pick.length === 0) {
      console.log(`[bot] no free cells for ${groove.name} — skipping`)
      return false
    }

    const sent = await this.jam.rent(pick)
    if (sent === 0) return false

    this.groove = groove
    this.grooveCells = cells
    this.held = new Set(pick.map((c) => c.cellId))
    this.grooveStartedAt = Date.now()
    console.log(`[bot] ${reason} — ${groove.name} (${groove.kind}), rented ${sent}/${pick.length} cells`)
    return true
  }

  private async activate(): Promise<void> {
    if (await this.play('ACTIVE')) this.state = 'ACTIVE'
  }

  private async sustain(): Promise<void> {
    // The groove has had its turn — hand the grid to the next one on the list.
    // The outgoing cells are simply not renewed, so they fade on their own.
    if (Date.now() - this.grooveStartedAt >= this.cfg.grooveHoldMs) {
      await this.play('rotate')
      return
    }

    // Otherwise keep the current loop alive: re-rent anything about to expire.
    // Re-renting a cell the bot already holds stacks duration.
    const expiring = this.grid
      .botCells()
      .filter((c) => this.held.has(c.cellId) && c.loopsLeft < this.cfg.renewThresholdLoops)
    if (expiring.length === 0) return

    if (this.jam.wouldExceedCap(expiring.length)) {
      console.log('[bot] rent cap reached — letting cells fade')
      return
    }

    const renew: CandidateCell[] = expiring.map((c) => ({
      cellId: c.cellId,
      cellData: this.cellDataFor(c.cellId),
    }))
    const sent = await this.jam.rent(renew)
    console.log(`[bot] renew ${sent} expiring cells (${this.groove?.name ?? 'groove'})`)
  }

  /** Recover the pitch a synth cell should be renewed with from the current
   *  groove; drums and unknown cells use 0. */
  private cellDataFor(cellId: number): number {
    return this.grooveCells.find((c) => c.cellId === cellId)?.cellData ?? 0
  }

  private fade(reason: string): void {
    this.state = 'IDLE'
    this.groove = null
    this.held.clear()
    console.log(`[bot] IDLE — ${reason}`)
  }
}
