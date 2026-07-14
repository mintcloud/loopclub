#!/usr/bin/env node
// loopclub seeder — entrypoint. Boots the presence collector + the on-chain
// grid mirror + the jam control loop in one process, then signals systemd ready.
//
//   node dist/index.js     (prod, under systemd Type=notify)
//   npm run dev            (local; NOTIFY_SOCKET unset → watchdog no-ops)

import { loadConfig } from './config.js'
import { makeClients } from './chain.js'
import { Grid } from './grid.js'
import { Presence } from './presence.js'
import { JamHand } from './jam.js'
import { Loopbot } from './loopbot.js'
import { Watchdog } from './notify.js'
import { Brain } from './brain.js'
import { RequestQueue } from './requests.js'

async function main(): Promise<void> {
  const cfg = loadConfig()
  const clients = makeClients(cfg)

  console.log('[seeder] starting')
  console.log(`[seeder] wallet     ${clients.account}`)
  console.log(`[seeder] contract   ${cfg.loopclubAddress} (chain ${cfg.chainId})`)
  console.log(`[seeder] mode       ${cfg.dryRun ? 'DRY_RUN' : 'LIVE'}${cfg.forceActive ? ' + FORCE_ACTIVE' : ''}`)

  const jam = new JamHand(clients, cfg)
  await jam.ensureReady()
  console.log(`[seeder] balance    ${await jam.balanceUsdm()} USDm`)

  const grid = new Grid(clients, cfg)
  await grid.snapshot()
  const stopGrid = grid.watch()
  console.log(`[seeder] grid       synced @ loop ${grid.currentLoop()} (${grid.freeCells().length} free cells)`)

  // Requests are off unless asked for. When on, the presence collector grows two
  // routes (GET /repertoire, POST /request) behind the origin gate it already has.
  const queue = cfg.requestsEnabled ? new RequestQueue(cfg) : undefined
  const presence = new Presence(cfg, queue)
  await presence.start()

  // The brain: loopgen in-process, or rendered by `build_loop` on the MCP server
  // when MCP_URL is set — which makes that call a chokepoint every spend it
  // governs must pass through. MCP_SCOPE says which grooves that is; by default
  // it's requests only, so the autonomous pulse never depends on the network.
  const brain = new Brain(cfg)
  console.log(`[seeder] brain      ${brain.description}`)

  // Restart if a tick stalls for >4 control periods (mirrors the spec's 30s
  // WatchdogSec at the default 3s tick). Independent of the control loop.
  const watchdog = new Watchdog(Math.max(30_000, cfg.tickMs * 10))
  watchdog.start()

  const bot = new Loopbot(cfg, grid, presence, jam, watchdog, brain, queue)
  bot.start()
  console.log(`[seeder] control    ticking every ${cfg.tickMs}ms`)
  console.log('[seeder] ready')

  const shutdown = async (sig: string) => {
    console.log(`[seeder] ${sig} — shutting down`)
    watchdog.stop()
    bot.stop()
    stopGrid()
    await presence.stop()
    await brain.close()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((e) => {
  console.error('[seeder] fatal:', e)
  process.exit(1)
})
