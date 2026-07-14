// The request queue — "play Seven Nation Army next."
//
// A visitor on the site asks robodj for something off its repertoire; robodj
// plays it as soon as the floor is free. That's the whole feature. What follows
// is the part that matters, which is everything a stranger is NOT allowed to ask
// for.
//
// The threat isn't taste, it's money. A groove's cost is `cells × rentPerLoop ×
// rentLoops`, so **cost lives in the arguments**. Two consequences shape this
// file:
//
//   1. A request names a groove; it never carries a spec. The repertoire is a
//      closed vocabulary — the grooves the seeder already knows. So the cell
//      count of anything robodj plays is a number the seeder chose (REQUEST_CELLS,
//      applied through chooseCells), never one a requester supplied. If we ever
//      accept a spec — from a text box, from an LLM, from a ?jam= link — that
//      property dies, and the clamp in loopbot.play() becomes the only thing
//      standing between a stranger's "wall of sound" and 24× the rent.
//
//   2. Requests change the *rate*, and rate is what the caps meter. Left
//      unbounded, a queue of requests means robodj rotates continuously — new
//      groove, new rent, forever. So: a queue depth cap, a per-requester
//      cooldown, and a TTL (a request nobody stayed to hear is not worth paying
//      for).
//
// The rent caps in jam.ts remain the ceiling. This is a rate limiter, not a
// budget — it decides how often robodj is *asked*, not how much it can spend.

import type { SeederConfig } from './config.js'

export interface JamRequest {
  /** A groove name from the repertoire — never a spec. */
  groove: string
  /** The requester, as best we can tell: presence session id, and the CF IP. */
  sessionId: string
  ip: string | undefined
  at: number
}

export type SubmitResult =
  | { ok: true; queued: number }
  | { ok: false; status: 400 | 429; reason: string }

const MAX_TRACKED_REQUESTERS = 10_000

export class RequestQueue {
  private queue: JamRequest[] = []
  /** requester key → epoch ms of their last accepted request (the cooldown). */
  private lastSeen = new Map<string, number>()
  private repertoire = new Map<string, string>() // lowercased → canonical name

  constructor(private cfg: SeederConfig) {}

  /** The closed vocabulary. Set once from the bot's pool at boot. */
  setRepertoire(names: string[]): void {
    this.repertoire = new Map(names.map((n) => [n.toLowerCase(), n]))
  }

  /** What the frontend renders as chips. */
  names(): string[] {
    return [...this.repertoire.values()]
  }

  /** Cooldown key: prefer the IP (a session id is free to mint, an address isn't). */
  private key(sessionId: string, ip: string | undefined): string {
    return ip ? `ip:${ip}` : `sid:${sessionId}`
  }

  private prune(now: number): void {
    const stale = now - this.cfg.requestTtlMs
    this.queue = this.queue.filter((r) => r.at >= stale)

    if (this.lastSeen.size >= MAX_TRACKED_REQUESTERS) {
      const cutoff = now - this.cfg.requestCooldownMs
      for (const [k, t] of this.lastSeen) if (t < cutoff) this.lastSeen.delete(k)
    }
  }

  submit(groove: unknown, sessionId: string, ip: string | undefined): SubmitResult {
    const now = Date.now()
    this.prune(now)

    if (typeof groove !== 'string' || groove.length === 0 || groove.length > 120) {
      return { ok: false, status: 400, reason: 'no groove named' }
    }
    const canonical = this.repertoire.get(groove.trim().toLowerCase())
    if (!canonical) {
      // The closed vocabulary, enforced. A request that isn't in the repertoire
      // isn't a niche request — it's the beginning of an arbitrary spec.
      return { ok: false, status: 400, reason: 'not in the repertoire' }
    }

    if (this.queue.length >= this.cfg.requestQueueMax) {
      return { ok: false, status: 429, reason: 'the queue is full' }
    }

    const key = this.key(sessionId, ip)
    const last = this.lastSeen.get(key)
    if (last !== undefined && now - last < this.cfg.requestCooldownMs) {
      const wait = Math.ceil((this.cfg.requestCooldownMs - (now - last)) / 1000)
      return { ok: false, status: 429, reason: `one request per ${this.cfg.requestCooldownMs / 1000}s — try again in ${wait}s` }
    }

    this.lastSeen.set(key, now)
    this.queue.push({ groove: canonical, sessionId, ip, at: now })
    return { ok: true, queued: this.queue.length }
  }

  /** Next live request, dropping any that went stale while the floor was busy.
   *  A request nobody stayed around to hear is not worth renting cells for. */
  take(): JamRequest | undefined {
    this.prune(Date.now())
    return this.queue.shift()
  }

  get depth(): number {
    this.prune(Date.now())
    return this.queue.length
  }
}
