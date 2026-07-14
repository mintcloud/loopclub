// Presence collector — the in-process heartbeat sink. The frontend POSTs
// /beat { id } on load and every 15 s; we keep an in-memory Map<id, lastSeen>
// and never persist anything. "Active visitors" = sessions seen within the TTL
// window. That window IS the hysteresis: a page refresh re-beats well under the
// TTL so the count never flickers; a closed tab drops off within the TTL.
//
// Why this counts the right things:
//   • Crawlers/scrapers don't run JS → never beat → never counted.
//   • The seeder never beats itself → it can't self-trigger (always-on failure).
//   • Fail-safe: if beats stop (collector restart, tunnel down) the count → 0
//     and the bot goes SILENT, not runaway. Silence-on-failure is the right bias.
//
// What a beat is NOT: authenticated. The endpoint is public (a static frontend
// cannot hold a secret), so a beat is a *claim* of presence, not proof of one —
// and a claimed visitor makes robodj spend real USDm. The claim can't be made
// unforgeable; it can only be bounded:
//
//   1. Origin allowlist, checked server-side. CORS headers are a contract the
//      *browser* enforces — curl ignores them entirely — so setting them without
//      checking them is not a control at all. Checking Origin here stops every
//      beat from a page we don't own, and every naive script. A forged header
//      still gets through; that's inherent, hence (2) and (3).
//   2. Per-IP ceilings, so no single host can inflate the room or flood us.
//   3. The rent caps in jam.ts remain the hard economic stop. Presence decides
//      *whether* robodj plays; the caps decide what that can ever cost. Presence
//      is advisory; the caps are the perimeter — never the other way round.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { SeederConfig } from './config.js'

const MAX_BODY_BYTES = 2 * 1024 // a beat is ~50 bytes; bound the parser anyway
const MAX_TRACKED = 50_000 // hard cap on the map so a flood can't OOM us
const MAX_TRACKED_IPS = 10_000 // ditto for the per-IP ledger
const IP_WINDOW_MS = 60_000 // rolling window for the per-IP beat ceiling
const REJECT_LOG_MS = 60_000 // rejections are aggregated, never logged per-request

/** Per-IP ledger: a rolling beat count plus the sessions this address holds. */
interface IpState {
  windowStart: number
  beats: number
  sessions: Map<string, number> // sessionId → lastSeen
}

export class Presence {
  private seen = new Map<string, number>()
  private ips = new Map<string, IpState>()
  private server: Server | null = null

  private rejected = { origin: 0, throttled: 0 }
  private lastRejectLog = 0

  constructor(private cfg: SeederConfig) {}

  /** Count of sessions seen within the TTL window. Prunes on read. */
  activeVisitors(): number {
    const cutoff = Date.now() - this.cfg.presenceTtlMs
    let n = 0
    for (const [id, last] of this.seen) {
      if (last < cutoff) this.seen.delete(id)
      else n++
    }
    return n
  }

  /** True if this Origin may beat. `*` in the allowlist disables the check. */
  private originAllowed(origin: string | undefined): boolean {
    if (this.cfg.presenceAllowOrigins.includes('*')) return true
    if (!origin) return false // a browser always sends Origin on a JSON POST
    return this.cfg.presenceAllowOrigins.includes(origin.trim().toLowerCase().replace(/\/$/, ''))
  }

  /** The real client, as Cloudflare saw it. Undefined when unidentifiable. */
  private clientIp(req: IncomingMessage): string | undefined {
    // Behind the tunnel every connection arrives from 127.0.0.1, so the socket
    // address is useless as a limiter key — it would put every visitor on Earth
    // in one bucket and throttle the whole room. Only a real client IP, set by
    // the Cloudflare edge (which overwrites any client-supplied value), is a safe
    // key. No header → loopback/dev traffic → no per-IP limits.
    const cf = req.headers['cf-connecting-ip']
    if (typeof cf === 'string' && cf.trim()) return cf.trim()
    const xff = req.headers['x-forwarded-for']
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim()
    return first || undefined
  }

  /** Bound the per-IP ledger the way `seen` is bounded. */
  private pruneIps(now: number): void {
    const cutoff = now - Math.max(this.cfg.presenceTtlMs, IP_WINDOW_MS)
    for (const [ip, st] of this.ips) {
      if (st.windowStart < cutoff && st.sessions.size === 0) this.ips.delete(ip)
    }
  }

  /**
   * Record a beat. Returns false when the claim was throttled — a throttled
   * session is NOT counted, so it cannot lift the visitor count or start the bot.
   */
  private beat(id: string, ip: string | undefined): boolean {
    const now = Date.now()

    if (ip !== undefined) {
      if (this.ips.size >= MAX_TRACKED_IPS && !this.ips.has(ip)) this.pruneIps(now)
      if (this.ips.size >= MAX_TRACKED_IPS && !this.ips.has(ip)) return false // still full → drop

      let st = this.ips.get(ip)
      if (!st) {
        st = { windowStart: now, beats: 0, sessions: new Map() }
        this.ips.set(ip, st)
      }
      if (now - st.windowStart >= IP_WINDOW_MS) {
        st.windowStart = now
        st.beats = 0
      }
      st.beats++
      if (st.beats > this.cfg.presenceMaxBeatsPerMin) return false

      // Drop the sessions this address has let expire, then cap the live ones.
      const cutoff = now - this.cfg.presenceTtlMs
      for (const [sid, last] of st.sessions) if (last < cutoff) st.sessions.delete(sid)
      if (!st.sessions.has(id) && st.sessions.size >= this.cfg.presenceMaxSessionsPerIp) return false
      st.sessions.set(id, now)
    }

    // Bound memory: if we're at the cap and this is a new id, prune first.
    if (this.seen.size >= MAX_TRACKED && !this.seen.has(id)) {
      const cutoff = now - this.cfg.presenceTtlMs
      for (const [k, last] of this.seen) if (last < cutoff) this.seen.delete(k)
    }
    if (this.seen.size >= MAX_TRACKED && !this.seen.has(id)) return false // still full → drop
    this.seen.set(id, now)
    return true
  }

  /** Rejections are counted and flushed at most once a minute — a forger must
   *  not be able to fill the journal, and each line should say how bad it is. */
  private noteReject(kind: 'origin' | 'throttled'): void {
    this.rejected[kind]++
    const now = Date.now()
    if (now - this.lastRejectLog < REJECT_LOG_MS) return
    this.lastRejectLog = now
    const { origin, throttled } = this.rejected
    console.warn(
      `[presence] rejected beats: ${origin} bad-origin, ${throttled} throttled (in the last ${REJECT_LOG_MS / 1000}s)`,
    )
    this.rejected = { origin: 0, throttled: 0 }
  }

  private cors(res: ServerResponse, origin: string | undefined): void {
    // Echo the caller's Origin (already allowlisted) rather than the configured
    // one, so a multi-origin allowlist works. Vary, because the answer differs.
    const allow = this.cfg.presenceAllowOrigins.includes('*')
      ? '*'
      : (origin ?? this.cfg.presenceAllowOrigins[0] ?? '')
    res.setHeader('Access-Control-Allow-Origin', allow)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'content-type')
    res.setHeader('Access-Control-Max-Age', '86400')
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/'
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined

    if (req.method === 'OPTIONS') {
      if (!this.originAllowed(origin)) {
        this.noteReject('origin')
        res.writeHead(403)
        res.end()
        return
      }
      this.cors(res, origin)
      res.writeHead(204)
      res.end()
      return
    }

    // Liveness probe for the tunnel / local health checks — no CORS needed. The
    // visitor count is disclosed to loopback callers only: over the tunnel it
    // would tell a forger whether their beat landed.
    if (req.method === 'GET' && (url === '/health' || url === '/healthz')) {
      const local = this.clientIp(req) === undefined
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(local ? { ok: true, active: this.activeVisitors() } : { ok: true }))
      return
    }

    if (req.method !== 'POST' || !url.startsWith('/beat')) {
      res.writeHead(404)
      res.end()
      return
    }

    // The gate. A beat from a page we don't own is not a visitor of ours.
    if (!this.originAllowed(origin)) {
      this.noteReject('origin')
      res.writeHead(403)
      res.end()
      return
    }

    this.cors(res, origin)
    const ip = this.clientIp(req)
    let body = ''
    let tooBig = false
    req.on('data', (chunk: Buffer) => {
      body += chunk
      if (body.length > MAX_BODY_BYTES) {
        tooBig = true
        req.destroy()
      }
    })
    req.on('end', () => {
      if (tooBig) return
      try {
        const { id } = JSON.parse(body || '{}') as { id?: unknown }
        if (typeof id === 'string' && id.length > 0 && id.length <= 128) {
          if (!this.beat(id, ip)) this.noteReject('throttled')
        }
      } catch {
        // Malformed beat — ignore. A beat is best-effort; never error the client.
      }
      // 204 either way: the frontend ignores the response, and telling a forger
      // which beats were dropped only helps them tune the forgery.
      res.writeHead(204)
      res.end()
    })
    req.on('error', () => {
      try {
        res.writeHead(400)
        res.end()
      } catch {
        /* socket already gone */
      }
    })
  }

  async start(): Promise<void> {
    if (this.cfg.forceActive) {
      console.log('[presence] FORCE_ACTIVE set — heartbeat collector NOT started (always treats 1 visitor present)')
      return
    }
    if (this.cfg.presenceAllowOrigins.includes('*')) {
      console.warn('[presence] PRESENCE_ALLOW_ORIGIN=* — origin check DISABLED; any page on the web can make robodj spend')
    }
    await new Promise<void>((resolve, reject) => {
      this.server = createServer((req, res) => this.handle(req, res))
      this.server.on('error', reject)
      this.server.listen(this.cfg.presencePort, this.cfg.presenceBind, () => {
        console.log(
          `[presence] listening on ${this.cfg.presenceBind}:${this.cfg.presencePort} ` +
            `(TTL ${this.cfg.presenceTtlMs}ms, origins ${this.cfg.presenceAllowOrigins.join(' ')}, ` +
            `≤${this.cfg.presenceMaxBeatsPerMin} beats/min/ip, ≤${this.cfg.presenceMaxSessionsPerIp} sessions/ip)`,
        )
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    if (!this.server) return
    await new Promise<void>((resolve) => this.server!.close(() => resolve()))
    this.server = null
  }
}
