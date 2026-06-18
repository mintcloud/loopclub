import { useEffect } from 'react'
import { config } from './config'

// Presence heartbeat — the frontend half of the cold-start loopbot (shipping
// sequence Part 2). On mount we mint an ephemeral session id and POST it to the
// seeder's /beat endpoint immediately, then every 15 s. The seeder counts
// sessions seen in the last 30 s as "active visitors" and only jams the grid
// while at least one real person is here.
//
// Fully fire-and-forget: no cookie, no PII, no UX surface. If VITE_PRESENCE_URL
// is unset (bot not deployed) or a beat fails, nothing breaks — the worst case
// is the bot thinks the room is empty and stays silent.

const BEAT_INTERVAL_MS = 15_000
const SESSION_SLOT = 'loopclub.presence.sid'

function sessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_SLOT)
    if (!id) {
      id = crypto.randomUUID()
      sessionStorage.setItem(SESSION_SLOT, id)
    }
    return id
  } catch {
    // sessionStorage blocked (private mode / embedded) — fall back to a
    // per-load id. Still counts as one visitor for this page view.
    return crypto.randomUUID()
  }
}

export function usePresence(): void {
  useEffect(() => {
    const url = config.presenceUrl
    if (!url) return // bot not deployed → no heartbeat, no-op

    const id = sessionId()
    const beat = () => {
      // keepalive lets the final beat survive an unload; failures are ignored.
      void fetch(`${url.replace(/\/$/, '')}/beat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
        keepalive: true,
      }).catch(() => {})
    }

    beat() // announce arrival immediately so the bot lights up within ~3 s
    const timer = setInterval(beat, BEAT_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])
}
