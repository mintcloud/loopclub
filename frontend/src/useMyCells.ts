import { useCallback, useEffect, useState } from 'react'

// A short, per-wallet memory of the cells you've recently rented — the backing
// store for the renew strip. It survives a refresh (localStorage) so a beat you
// were building doesn't vanish from view just because its rent lapsed.

const CAP = 32
const keyFor = (addr: string) => `loopchain.mycells.v1.${addr.toLowerCase()}`

export interface MyCells {
  /** Recently-touched cell ids, most-recent first, deduped, capped at CAP. */
  history: number[]
  /** Record cells you just toggled / filled / renewed. */
  remember: (cellIds: number[]) => void
}

export function useMyCells(address: string | null): MyCells {
  const [history, setHistory] = useState<number[]>([])

  // Reload the list whenever the connected wallet changes.
  useEffect(() => {
    if (!address) {
      setHistory([])
      return
    }
    try {
      const raw = localStorage.getItem(keyFor(address))
      const parsed = raw ? (JSON.parse(raw) as unknown) : []
      setHistory(Array.isArray(parsed) ? parsed.filter((n) => typeof n === 'number') : [])
    } catch {
      setHistory([])
    }
  }, [address])

  const remember = useCallback(
    (cellIds: number[]) => {
      if (!address || cellIds.length === 0) return
      setHistory((prev) => {
        // Newly-touched ids move to the front; dedupe keeps the first occurrence.
        const merged = [...cellIds, ...prev]
        const next = merged.filter((id, i) => merged.indexOf(id) === i).slice(0, CAP)
        try {
          localStorage.setItem(keyFor(address), JSON.stringify(next))
        } catch {
          // storage full / disabled — the in-memory list still works this session
        }
        return next
      })
    },
    [address],
  )

  return { history, remember }
}
