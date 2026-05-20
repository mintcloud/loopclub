import { useMemo } from 'react'
import { formatUnits } from 'viem'
import { EXPIRING_SOON_LOOPS, DEFAULT_TOGGLE_LOOPS } from './config'
import { sameAddr } from './owner'
import type { CellState } from './useLiveGrid'

interface Props {
  // Recently-touched cell ids (from useMyCells).
  history: number[]
  cells: CellState[]
  currentLoop: number
  myAddress: string | null
  rentPerLoop: bigint
  busy: boolean
  // Re-rent the given cells in one batched tx.
  onRenew: (cellIds: number[], duration: number) => void
  // Highlight the renewable cells on the grid while the user is hovering the
  // renew button — so they can see what's about to be re-rented.
  onPreview?: (cellIds: number[] | null) => void
}

// A short history of the cells you've rented, with a one-click renew. Renew
// re-rents whatever has expired or is about to — and optimistically skips any
// cell another player has since taken (the batch just leaves those out).
export function RenewStrip({
  history,
  cells,
  currentLoop,
  myAddress,
  rentPerLoop,
  busy,
  onRenew,
  onPreview,
}: Props) {
  const summary = useMemo(() => {
    let healthy = 0
    let expiring = 0
    let expired = 0
    let taken = 0
    const renewable: number[] = []
    for (const id of history) {
      const c = cells[id]
      if (!c) continue
      const live = Boolean(c.owner) && c.expiryLoop > currentLoop
      if (live && sameAddr(c.owner, myAddress)) {
        // Still yours. Renew only if the rent is nearly up.
        if (c.expiryLoop - currentLoop <= EXPIRING_SOON_LOOPS) {
          expiring++
          renewable.push(id)
        } else {
          healthy++
        }
      } else if (live) {
        // Yours expired and another player grabbed it — leave it be.
        taken++
      } else {
        // Lapsed and free — re-rentable.
        expired++
        renewable.push(id)
      }
    }
    return { healthy, expiring, expired, taken, renewable }
  }, [history, cells, currentLoop, myAddress])

  if (history.length === 0) return null

  const rentUsdm = Number(formatUnits(rentPerLoop, 18))
  const renewCost = (summary.renewable.length * rentUsdm * DEFAULT_TOGGLE_LOOPS).toFixed(3)
  const canRenew = summary.renewable.length > 0 && !busy

  return (
    <div className={`renew-strip${summary.expiring > 0 ? ' urgent' : ''}`}>
      <span className="contrib-label">your recent cells</span>
      <div className="renew-counts">
        {summary.healthy > 0 && <span className="rc live">{summary.healthy} live</span>}
        {summary.expiring > 0 && <span className="rc expiring">{summary.expiring} expiring</span>}
        {summary.expired > 0 && <span className="rc expired">{summary.expired} expired</span>}
        {summary.taken > 0 && <span className="rc taken">{summary.taken} taken</span>}
      </div>
      {summary.renewable.length > 0 ? (
        <button
          className={summary.expiring > 0 ? 'hot' : 'primary'}
          disabled={!canRenew}
          onClick={() => onRenew(summary.renewable, DEFAULT_TOGGLE_LOOPS)}
          onMouseEnter={() => onPreview?.(summary.renewable)}
          onMouseLeave={() => onPreview?.(null)}
          onFocus={() => onPreview?.(summary.renewable)}
          onBlur={() => onPreview?.(null)}
          title={`Re-rent ${summary.renewable.length} cell${
            summary.renewable.length === 1 ? '' : 's'
          } for ${DEFAULT_TOGGLE_LOOPS} loops — cells a player has taken are skipped`}
        >
          {busy ? 'renewing…' : `↻ renew ${summary.renewable.length} · ${renewCost} USDm`}
        </button>
      ) : (
        <span className="muted">all healthy ✓</span>
      )}
    </div>
  )
}
