import { useEffect, useState } from 'react'
import { config } from './config'
import { presenceSessionId } from './usePresence'
import { track } from './analytics'

// Ask robodj for something. The strip renders the bot's repertoire as chips —
// the same rotation it plays from — and a click puts that groove at the front of
// its queue. It plays within a few seconds if the floor is free.
//
// The vocabulary is deliberately closed: you pick a loop robodj already knows,
// you don't describe one. That isn't a UI simplification, it's the safety
// property — a request names a groove and never carries a spec, so what a
// request costs stays a number the seeder chose. (See seeder/src/requests.ts.)
//
// The whole component is self-erasing: if the seeder isn't deployed, or requests
// are off, /repertoire says so and this renders nothing. No env var to forget.

const OK_MS = 4000

export function RequestStrip() {
  const [grooves, setGrooves] = useState<string[]>([])
  const [pending, setPending] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const url = config.presenceUrl?.replace(/\/$/, '')

  useEffect(() => {
    if (!url) return
    let live = true
    fetch(`${url}/repertoire`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { enabled?: boolean; grooves?: string[] } | null) => {
        if (live && data?.enabled && data.grooves?.length) setGrooves(data.grooves)
      })
      .catch(() => {
        /* seeder not deployed / unreachable → no request UI, no error */
      })
    return () => {
      live = false
    }
  }, [url])

  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(null), OK_MS)
    return () => clearTimeout(t)
  }, [note])

  if (!url || grooves.length === 0) return null

  const request = async (groove: string) => {
    if (pending) return
    setPending(groove)
    track('robodj_requested', { groove })
    try {
      const res = await fetch(`${url}/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: presenceSessionId(), groove }),
      })
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string }
      // The seeder answers honestly here (unlike a beat) because the UI has to
      // say something true: queued, or why not.
      setNote(body.ok ? `robodj will play ${groove} next` : (body.reason ?? 'robodj is busy'))
    } catch {
      setNote('robodj is not listening right now')
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="request-strip">
      <span className="contrib-label">request robodj</span>
      <div className="contrib-list">
        {grooves.map((g) => (
          <button
            key={g}
            className={`contrib-chip request-chip${pending === g ? ' pending' : ''}`}
            onClick={() => void request(g)}
            disabled={pending !== null}
            title={`Ask robodj to play ${g} next`}
          >
            {g}
          </button>
        ))}
      </div>
      {note && <span className="request-note">{note}</span>}
    </div>
  )
}
