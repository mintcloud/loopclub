import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type Address, zeroAddress } from 'viem'
import { config, CELLS, SYNTH_CELL_START, LOOP_DURATION_SECONDS } from './config'
import { loopchainAbi } from './abi'
import { publicClient, eventClient } from './viemClient'

// Per-cell rental state — the single source of truth for the live grid.
export interface CellState {
  owner: Address | null
  expiryLoop: number
  pitch: number
  /** Optimistic: our toggle tx is in flight, not yet confirmed on chain. */
  pending: boolean
}

// Emitted on each incoming CellRented so the grid can fire a one-shot animation.
export interface RentEvent {
  cellId: number
  owner: Address
  at: number
}

export interface LiveGrid {
  cells: CellState[]
  pattern: bigint
  pitches: bigint
  currentLoop: number
  blockNumber: number
  lastRent: RentEvent | null
  liveCellCount: number
  /** Light a cell instantly on tap, before the tx is mined. */
  applyOptimistic: (cellId: number, owner: Address, durationLoops: number, pitch: number) => void
  /** Re-read one cell from chain — used to confirm or roll back an optimistic tap. */
  refreshCell: (cellId: number) => Promise<void>
}

const RECONCILE_MS = 20_000
const lc = { address: config.loopchainAddress, abi: loopchainAbi } as const
const SYNTH_IDS = Array.from({ length: CELLS - SYNTH_CELL_START }, (_, i) => SYNTH_CELL_START + i)

function emptyCells(): CellState[] {
  return Array.from({ length: CELLS }, () => ({ owner: null, expiryLoop: 0, pitch: 0, pending: false }))
}

// Loop counter the contract uses: block.timestamp / LOOP_DURATION_SECONDS.
function loopNow(): number {
  return Math.floor(Date.now() / 1000 / LOOP_DURATION_SECONDS)
}

/**
 * Owns the live grid. Backfills a full ownership snapshot via multicall, then
 * keeps it current from CellRented events (WebSocket push when configured,
 * otherwise a tight getLogs poll). A periodic multicall reconcile self-heals
 * any dropped event. Cells expire silently by loop count — no event fires — so
 * the live pattern is derived against a locally-ticked currentLoop.
 */
export function useLiveGrid(): LiveGrid {
  const [cells, setCells] = useState<CellState[]>(emptyCells)
  const [currentLoop, setCurrentLoop] = useState<number>(loopNow)
  const [blockNumber, setBlockNumber] = useState<number>(0)
  const [lastRent, setLastRent] = useState<RentEvent | null>(null)

  // chain currentLoop - local loopNow(); corrects wall-clock skew.
  const loopOffsetRef = useRef(0)
  const currentLoopRef = useRef(currentLoop)
  currentLoopRef.current = currentLoop

  // Apply an on-chain CellRented. Guarded against stale / out-of-order delivery:
  // a cell's expiryLoop only ever moves forward (re-rents stack, new owners can
  // only claim an expired cell), so an event with a lower expiry is stale.
  const applyEvent = useCallback(
    (cellId: number, renter: Address, expiryLoop: bigint, pitchIdx: number) => {
      if (cellId < 0 || cellId >= CELLS) return
      const expiry = Number(expiryLoop)
      setCells((prev) => {
        const c = prev[cellId]
        if (expiry < c.expiryLoop) return prev
        const next = prev.slice()
        next[cellId] = { owner: renter, expiryLoop: expiry, pitch: pitchIdx, pending: false }
        return next
      })
      setLastRent({ cellId, owner: renter, at: Date.now() })
    },
    [],
  )

  // Full ownership snapshot — 3 batched multicalls + the chain loop counter.
  const snapshot = useCallback(async () => {
    try {
      const [owners, expiries, pitches, chainLoop] = await Promise.all([
        publicClient.multicall({
          contracts: Array.from(
            { length: CELLS },
            (_, i) => ({ ...lc, functionName: 'cellOwner', args: [i] }) as const,
          ),
          allowFailure: false,
        }),
        publicClient.multicall({
          contracts: Array.from(
            { length: CELLS },
            (_, i) => ({ ...lc, functionName: 'cellExpiryLoop', args: [i] }) as const,
          ),
          allowFailure: false,
        }),
        publicClient.multicall({
          contracts: SYNTH_IDS.map((i) => ({ ...lc, functionName: 'cellPitch', args: [i] }) as const),
          allowFailure: false,
        }),
        publicClient.readContract({ ...lc, functionName: 'currentLoop' }),
      ])

      loopOffsetRef.current = Number(chainLoop) - loopNow()
      setCurrentLoop(loopNow() + loopOffsetRef.current)

      const snap: CellState[] = Array.from({ length: CELLS }, (_, i) => {
        const owner = owners[i] as Address
        const synthIdx = i - SYNTH_CELL_START
        return {
          owner: owner === zeroAddress ? null : owner,
          expiryLoop: Number(expiries[i]),
          pitch: synthIdx >= 0 ? Number(pitches[synthIdx]) : 0,
          pending: false,
        }
      })
      // Keep optimistic cells — their tx may not be mined yet; the event or a
      // later reconcile replaces them once it lands.
      setCells((prev) => prev.map((c, i) => (c.pending ? c : snap[i])))
    } catch (e) {
      console.warn('grid snapshot failed', e)
    }
  }, [])

  const refreshCell = useCallback(async (cellId: number) => {
    try {
      const isSynth = cellId >= SYNTH_CELL_START
      const [owner, expiry, pitch] = await Promise.all([
        publicClient.readContract({ ...lc, functionName: 'cellOwner', args: [cellId] }),
        publicClient.readContract({ ...lc, functionName: 'cellExpiryLoop', args: [cellId] }),
        isSynth
          ? publicClient.readContract({ ...lc, functionName: 'cellPitch', args: [cellId] })
          : Promise.resolve(0),
      ])
      setCells((prev) => {
        const next = prev.slice()
        next[cellId] = {
          owner: owner === zeroAddress ? null : (owner as Address),
          expiryLoop: Number(expiry),
          pitch: Number(pitch),
          pending: false,
        }
        return next
      })
    } catch (e) {
      console.warn('refreshCell failed', e)
    }
  }, [])

  const applyOptimistic = useCallback(
    (cellId: number, owner: Address, durationLoops: number, pitch: number) => {
      const now = currentLoopRef.current
      setCells((prev) => {
        const c = prev[cellId]
        const stacking = c.owner?.toLowerCase() === owner.toLowerCase() && c.expiryLoop > now
        const base = stacking ? c.expiryLoop : now
        const next = prev.slice()
        next[cellId] = { owner, expiryLoop: base + durationLoops, pitch, pending: true }
        return next
      })
    },
    [],
  )

  // Tick the loop counter locally so cells expire on time without polling.
  useEffect(() => {
    const id = setInterval(() => setCurrentLoop(loopNow() + loopOffsetRef.current), 1000)
    return () => clearInterval(id)
  }, [])

  // Backfill + live subscriptions.
  useEffect(() => {
    void snapshot()
    const reconcileId = setInterval(() => void snapshot(), RECONCILE_MS)

    const unwatchEvents = eventClient.watchContractEvent({
      address: config.loopchainAddress,
      abi: loopchainAbi,
      eventName: 'CellRented',
      pollingInterval: 1000,
      onLogs: (logs) => {
        for (const log of logs) {
          const a = log.args as {
            cellId?: number
            renter?: Address
            expiryLoop?: bigint
            pitchIdx?: number
          }
          if (a.cellId === undefined || !a.renter || a.expiryLoop === undefined) continue
          applyEvent(a.cellId, a.renter, a.expiryLoop, a.pitchIdx ?? 0)
        }
      },
      onError: (e) => console.warn('CellRented watch error', e),
    })

    const unwatchBlocks = publicClient.watchBlockNumber({
      emitOnBegin: true,
      pollingInterval: 1000,
      onBlockNumber: (bn) => setBlockNumber(Number(bn)),
      onError: (e) => console.warn('block watch error', e),
    })

    return () => {
      clearInterval(reconcileId)
      unwatchEvents()
      unwatchBlocks()
    }
  }, [snapshot, applyEvent])

  // Derive the live pattern/pitches bitmaps the grid + audio engine consume.
  const { pattern, pitches, liveCellCount } = useMemo(() => {
    let p = 0n
    let ps = 0n
    let count = 0
    for (let i = 0; i < CELLS; i++) {
      const c = cells[i]
      if (c.owner && c.expiryLoop > currentLoop) {
        p |= 1n << BigInt(i)
        count++
        if (i >= SYNTH_CELL_START) {
          ps |= BigInt(c.pitch & 0x7) << BigInt((i - SYNTH_CELL_START) * 3)
        }
      }
    }
    return { pattern: p, pitches: ps, liveCellCount: count }
  }, [cells, currentLoop])

  return {
    cells,
    pattern,
    pitches,
    currentLoop,
    blockNumber,
    lastRent,
    liveCellCount,
    applyOptimistic,
    refreshCell,
  }
}
