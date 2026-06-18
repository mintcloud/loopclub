// On-chain ownership map — the headless port of frontend/src/useLiveGrid.ts.
//
// Backfills a full 144-cell snapshot via multicall, then keeps it current from
// CellRented events (WebSocket push when configured, else a getLogs poll). A
// periodic multicall reconcile self-heals any dropped event. Cells expire
// silently by loop count (no event fires), so "live" is always derived against
// a locally-ticked currentLoop corrected for wall-clock skew.
//
// The seeder reads three things off this map each tick:
//   • humanCells   — cells live and owned by someone OTHER than the bot
//   • botCells      — cells the bot currently holds (for renew / fade)
//   • freeCells     — cells not live (rentable right now)

import { getAddress, zeroAddress, type Address } from 'viem'
import { CELLS, SYNTH_CELL_START } from 'loopclub-loopgen'
import { loopclubAbi } from './abi.js'
import type { Clients } from './chain.js'
import { LOOP_DURATION_SECONDS, type SeederConfig } from './config.js'

export interface Cell {
  owner: Address | null
  expiryLoop: number
}

const RECONCILE_MS = 20_000

function loopNow(): number {
  return Math.floor(Date.now() / 1000 / LOOP_DURATION_SECONDS)
}

export class Grid {
  private cells: Cell[] = Array.from({ length: CELLS }, () => ({ owner: null, expiryLoop: 0 }))
  private loopOffset = 0
  private bot: string
  private lc: { address: Address; abi: typeof loopclubAbi }
  private timers: Array<() => void> = []

  constructor(
    private clients: Clients,
    private cfg: SeederConfig,
  ) {
    this.bot = clients.account.toLowerCase()
    this.lc = { address: cfg.loopclubAddress, abi: loopclubAbi }
  }

  /** Chain-corrected current loop counter. */
  currentLoop(): number {
    return loopNow() + this.loopOffset
  }

  /** Apply one CellRented. Guarded against stale / out-of-order delivery: a
   *  cell's expiry only ever moves forward, so a lower expiry is stale. */
  private applyEvent(cellId: number, renter: Address, expiryLoop: bigint): void {
    if (cellId < 0 || cellId >= CELLS) return
    const expiry = Number(expiryLoop)
    const c = this.cells[cellId]!
    if (expiry < c.expiryLoop) return
    this.cells[cellId] = { owner: renter, expiryLoop: expiry }
  }

  /** Full ownership snapshot — two batched multicalls + the chain loop counter. */
  async snapshot(): Promise<void> {
    const { publicClient } = this.clients
    const [owners, expiries, chainLoop] = await Promise.all([
      publicClient.multicall({
        contracts: Array.from(
          { length: CELLS },
          (_, i) => ({ ...this.lc, functionName: 'cellOwner', args: [i] }) as const,
        ),
        allowFailure: false,
      }),
      publicClient.multicall({
        contracts: Array.from(
          { length: CELLS },
          (_, i) => ({ ...this.lc, functionName: 'cellExpiryLoop', args: [i] }) as const,
        ),
        allowFailure: false,
      }),
      publicClient.readContract({ ...this.lc, functionName: 'currentLoop' }),
    ])

    this.loopOffset = Number(chainLoop) - loopNow()
    this.cells = Array.from({ length: CELLS }, (_, i) => {
      const owner = owners[i] as Address
      return {
        owner: owner === zeroAddress ? null : owner,
        expiryLoop: Number(expiries[i]),
      }
    })
  }

  /** Start the live subscription + reconcile loop. Returns a stop fn. */
  watch(): () => void {
    const unwatchEvents = this.clients.eventClient.watchContractEvent({
      address: this.cfg.loopclubAddress,
      abi: loopclubAbi,
      eventName: 'CellRented',
      pollingInterval: 1000,
      onLogs: (logs) => {
        for (const log of logs) {
          const a = log.args as { cellId?: number; renter?: Address; expiryLoop?: bigint }
          if (a.cellId === undefined || !a.renter || a.expiryLoop === undefined) continue
          this.applyEvent(a.cellId, a.renter, a.expiryLoop)
        }
      },
      onError: (e) => console.warn('[grid] CellRented watch error:', e.message),
    })

    const reconcile = setInterval(() => {
      void this.snapshot().catch((e) => console.warn('[grid] reconcile failed:', e?.message ?? e))
    }, RECONCILE_MS)

    this.timers.push(unwatchEvents, () => clearInterval(reconcile))
    return () => this.stop()
  }

  stop(): void {
    for (const t of this.timers) t()
    this.timers = []
  }

  private isLive(c: Cell, now: number): boolean {
    return c.owner !== null && c.expiryLoop > now
  }

  /** Cells live and owned by someone OTHER than the bot. The "is a human on
   *  the floor?" signal — when > 0 the bot cedes the floor. */
  humanCellCount(): number {
    const now = this.currentLoop()
    let n = 0
    for (const c of this.cells) {
      if (this.isLive(c, now) && c.owner!.toLowerCase() !== this.bot) n++
    }
    return n
  }

  /** Cells the bot currently holds live, with loops remaining. */
  botCells(): Array<{ cellId: number; loopsLeft: number }> {
    const now = this.currentLoop()
    const out: Array<{ cellId: number; loopsLeft: number }> = []
    this.cells.forEach((c, cellId) => {
      if (this.isLive(c, now) && c.owner!.toLowerCase() === this.bot) {
        out.push({ cellId, loopsLeft: c.expiryLoop - now })
      }
    })
    return out
  }

  /** Cells not currently live — free to rent right now. */
  freeCells(): number[] {
    const now = this.currentLoop()
    const out: number[] = []
    this.cells.forEach((c, cellId) => {
      if (!this.isLive(c, now)) out.push(cellId)
    })
    return out
  }

  /** True if the given cell is a synth cell (carries a pitch). */
  static isSynth(cellId: number): boolean {
    return cellId >= SYNTH_CELL_START
  }
}

export function normalizeAddress(a: string): Address {
  return getAddress(a)
}
