// Liveness — an internal self-watchdog, dependency-free.
//
// The spec called for systemd's Type=notify + WatchdogSec, but the native
// sd-notify addon fails to build on node 22 and node's dgram can't speak the
// AF_UNIX datagram protocol systemd uses — so we get the SAME guarantee in pure
// JS instead: the control loop must pet() on every healthy tick; an independent
// timer checks staleness and, if no pet has landed within `timeoutMs`, logs and
// exits non-zero. systemd's `Restart=always` then brings the unit back within
// RestartSec. A dead/wedged seeder is the exact "silent empty grid" failure we
// are guarding against, so crashing to recover is the correct bias.
//
// This catches the realistic hang (an await stuck on a stalled RPC — the event
// loop still services this timer). A fully event-loop-blocking bug (sync
// infinite loop) would freeze this timer too, but the bot does no synchronous
// heavy work, so that mode doesn't occur here.

export class Watchdog {
  private last = Date.now()
  private timer: ReturnType<typeof setInterval> | null = null

  /** @param timeoutMs max time allowed between healthy ticks before restart. */
  constructor(private timeoutMs: number) {}

  /** Call on every healthy control tick. */
  pet(): void {
    this.last = Date.now()
  }

  start(): void {
    // Check at a third of the timeout so we react promptly without busy-waiting.
    const period = Math.max(1000, Math.floor(this.timeoutMs / 3))
    this.timer = setInterval(() => {
      const stale = Date.now() - this.last
      if (stale > this.timeoutMs) {
        console.error(`[watchdog] no healthy tick for ${stale}ms (>${this.timeoutMs}ms) — exiting for restart`)
        process.exit(1)
      }
    }, period)
    // Don't let the watchdog timer itself keep the process alive.
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
