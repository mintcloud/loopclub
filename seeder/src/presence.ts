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

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { SeederConfig } from './config.js'

const MAX_BODY_BYTES = 2 * 1024 // a beat is ~50 bytes; bound the parser anyway
const MAX_TRACKED = 50_000 // hard cap on the map so a flood can't OOM us

export class Presence {
  private seen = new Map<string, number>()
  private server: Server | null = null

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

  private beat(id: string): void {
    // Bound memory: if we're at the cap and this is a new id, prune first.
    if (this.seen.size >= MAX_TRACKED && !this.seen.has(id)) {
      const cutoff = Date.now() - this.cfg.presenceTtlMs
      for (const [k, last] of this.seen) if (last < cutoff) this.seen.delete(k)
    }
    if (this.seen.size >= MAX_TRACKED && !this.seen.has(id)) return // still full → drop
    this.seen.set(id, Date.now())
  }

  private cors(res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', this.cfg.presenceAllowOrigin)
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'content-type')
    res.setHeader('Access-Control-Max-Age', '86400')
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/'

    if (req.method === 'OPTIONS') {
      this.cors(res)
      res.writeHead(204)
      res.end()
      return
    }

    // Liveness probe for the tunnel / local health checks — no CORS needed.
    if (req.method === 'GET' && (url === '/health' || url === '/healthz')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, active: this.activeVisitors() }))
      return
    }

    if (req.method !== 'POST' || !url.startsWith('/beat')) {
      res.writeHead(404)
      res.end()
      return
    }

    this.cors(res)
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
        if (typeof id === 'string' && id.length > 0 && id.length <= 128) this.beat(id)
      } catch {
        // Malformed beat — ignore. A beat is best-effort; never error the client.
      }
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
    await new Promise<void>((resolve, reject) => {
      this.server = createServer((req, res) => this.handle(req, res))
      this.server.on('error', reject)
      this.server.listen(this.cfg.presencePort, this.cfg.presenceBind, () => {
        console.log(`[presence] listening on ${this.cfg.presenceBind}:${this.cfg.presencePort} (TTL ${this.cfg.presenceTtlMs}ms)`)
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
