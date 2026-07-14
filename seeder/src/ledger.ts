// The spend ledger — the rent caps' memory.
//
// The caps used to live in RAM. The unit is Restart=always / RestartSec=5, so
// every bounce forgave the whole hour's spend: the watchdog fires, the process
// comes back five seconds later with `daySpent = 0`, and the "cap" it enforces
// is a cap on an uptime, not on a day. A crash-looping bot could spend its
// hourly budget twelve times a minute and never break a single rule.
//
// That matters more than it looks, because the caps are the *only* real ceiling
// the seeder has. The USDm allowance is maxUint256 and the funder tops the wallet
// back up to FUND_TARGET_USDM whenever it dips below the low watermark — so the
// wallet balance is a faucet, not a fence. Everything that stands between a
// runaway loop and the contract's whole balance is the number in this file.
//
// So: one small JSON file, written after every spend, atomically (tmp + rename,
// so a kill -9 mid-write leaves the old file intact rather than a truncated one).
// Read back at boot. A restart now *remembers*.
//
// DRY_RUN never persists. A dry run books its imaginary spend in memory only —
// otherwise a cost-modelling run would eat the live bot's real budget.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const HOUR_MS = 3_600_000

interface Persisted {
  /** UTC date key the daily total belongs to. */
  dayKey: string
  /** Wei, as a string — JSON has no bigint. */
  daySpentWei: string
  /** [epoch ms, wei] pairs inside the rolling hour. */
  hourWindow: Array<[number, string]>
}

/**
 * Rolling-hour + UTC-day spend totals, durable across restarts.
 *
 * `path === null` → memory only (dry runs, tests). Everything else behaves the
 * same, so the only difference a dry run sees is that its books don't outlive it.
 */
export class SpendLedger {
  private dayKey = todayKey()
  private daySpent = 0n
  private hourWindow: Array<[number, bigint]> = []

  constructor(private readonly path: string | null) {}

  /** Read the file back. Missing → empty. Corrupt → empty, loudly, with a copy
   *  kept aside: a corrupt ledger must not wedge the bot, but it must be seen. */
  load(): void {
    if (!this.path || !existsSync(this.path)) return
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Persisted
      const cutoff = Date.now() - HOUR_MS
      this.dayKey = typeof raw.dayKey === 'string' ? raw.dayKey : todayKey()
      this.daySpent = BigInt(raw.daySpentWei ?? '0')
      this.hourWindow = (raw.hourWindow ?? [])
        .filter(([t]) => typeof t === 'number' && t >= cutoff)
        .map(([t, wei]) => [t, BigInt(wei)] as [number, bigint])
      this.rollDay() // the file may be from yesterday
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e)
      console.error(`[ledger] ${this.path} is unreadable (${msg}) — starting from zero. Old file kept as .corrupt`)
      try {
        renameSync(this.path, `${this.path}.corrupt`)
      } catch {
        /* best effort */
      }
      this.dayKey = todayKey()
      this.daySpent = 0n
      this.hourWindow = []
    }
  }

  /** Atomic write: a kill -9 mid-write leaves the previous ledger, never a stub. */
  private save(): void {
    if (!this.path) return
    const body: Persisted = {
      dayKey: this.dayKey,
      daySpentWei: this.daySpent.toString(),
      hourWindow: this.hourWindow.map(([t, wei]) => [t, wei.toString()]),
    }
    const tmp = `${this.path}.tmp`
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      writeFileSync(tmp, JSON.stringify(body), { mode: 0o600 })
      renameSync(tmp, this.path)
    } catch (e) {
      // A failed write must never take the bot down — but it means the cap has
      // gone back to being amnesiac, so say so every time.
      console.error(`[ledger] could not persist to ${this.path}: ${(e as Error)?.message ?? e}`)
    }
  }

  /** Zero the daily total when the UTC date turns over. */
  rollDay(): void {
    const key = todayKey()
    if (key === this.dayKey) return
    this.dayKey = key
    this.daySpent = 0n
    this.save()
  }

  /** Spend inside the rolling hour, pruning anything older. */
  hourSpentWei(): bigint {
    const cutoff = Date.now() - HOUR_MS
    this.hourWindow = this.hourWindow.filter(([t]) => t >= cutoff)
    return this.hourWindow.reduce((sum, [, wei]) => sum + wei, 0n)
  }

  daySpentWei(): bigint {
    this.rollDay()
    return this.daySpent
  }

  /** Book a spend against both windows and flush. */
  record(costWei: bigint): void {
    this.rollDay()
    this.daySpent += costWei
    this.hourWindow.push([Date.now(), costWei])
    this.save()
  }

  /** One line for the boot log — what the bot remembers it has already spent. */
  summary(): string {
    return `${usdm(this.hourSpentWei())} USDm this hour, ${usdm(this.daySpentWei())} today (${this.dayKey})`
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function usdm(wei: bigint): string {
  return (Number(wei) / 1e18).toFixed(2)
}
