import { useMemo } from 'react'
import type { CellState } from './useLiveGrid'
import { ownerColor, sameAddr, shortAddr } from './owner'

interface Props {
  cells: CellState[]
  currentLoop: number
  myAddress: string | null
}

// Legend of everyone currently holding a live cell — a colour key for the grid
// and an at-a-glance "N people are building this loop" signal.
export function ContributorStrip({ cells, currentLoop, myAddress }: Props) {
  const contributors = useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of cells) {
      if (c.owner && c.expiryLoop > currentLoop) {
        counts.set(c.owner, (counts.get(c.owner) ?? 0) + 1)
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [cells, currentLoop])

  if (contributors.length === 0) {
    return <div className="contrib-strip empty">Grid is empty — tap a cell to start the jam.</div>
  }

  return (
    <div className="contrib-strip">
      <span className="contrib-label">
        {contributors.length} {contributors.length === 1 ? 'player' : 'players'} on the grid
      </span>
      <div className="contrib-list">
        {contributors.map(([addr, count]) => {
          const mine = sameAddr(addr, myAddress)
          return (
            <span key={addr} className={`contrib-chip${mine ? ' mine' : ''}`} title={addr}>
              <span
                className="contrib-dot"
                style={{ background: mine ? 'var(--accent)' : ownerColor(addr) }}
              />
              {mine ? 'you' : shortAddr(addr)}
              <span className="contrib-count">{count}</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}
