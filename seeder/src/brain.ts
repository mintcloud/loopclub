// The brain — where the spec robodj is about to play comes from.
//
// Two modes, one interface:
//
//   MCP_URL unset  → local. loopgen renders the groove in-process, as it always
//                    has. Nothing crosses the network.
//   MCP_URL set    → the groove is rendered by calling `build_loop` on the MCP
//                    server, and the returned deep link is decoded back into a
//                    spec. Same brain, different interface — the loop robodj
//                    plays is now literally the loop the MCP server built.
//
// The second mode exists so that the MCP call becomes a *chokepoint*: a single
// place a spec must pass through, carrying the thing that decides the money.
// Cost is `cells × rentPerLoop × rentLoops`, so cost lives in the arguments of
// that call — which means a proxy in front of it (a gateway, a policy engine, a
// logger) can see and price the spend before a single toggle() is signed. Point
// MCP_URL at the proxy instead of the server and robodj's code doesn't change by
// one line.
//
// WHICH grooves take that path is MCP_SCOPE, and the default is `requests`:
// a visitor's request is rendered remotely, the idle pulse is rendered locally.
// That is a deliberate, load-bearing asymmetry, so be precise about why it isn't
// the "second door" this file used to warn about:
//
//   • The gateway exists to police arguments that came from OUTSIDE. A request
//     is the only thing on this bot that qualifies. The idle pulse is robodj
//     playing its own authored pool to itself — same trust boundary as the
//     source file it was compiled from.
//   • Routing by ORIGIN is not a bypass. A stranger cannot turn their request
//     into an idle pulse; there is no input they control that selects the local
//     path. Falling back to local ON ERROR *would* be a bypass — an attacker
//     triggers it by knocking the proxy over — and that is the thing this brain
//     must never do, and doesn't, in either scope.
//   • The payoff is operational and it's the point: the gateway becomes
//     TEARDOWN-SAFE. Kill it and robodj keeps filling cells; only requests stop.
//     A policy plane whose outage silences the product is a policy plane nobody
//     dares deploy.
//
// MCP_SCOPE=all restores the purist mode — the idle pulse goes through MCP too,
// so 100% of spend crosses the proxy. It's the right mode for capturing a
// gateway demo and the wrong mode to walk away from, because it couples robodj's
// liveness to the gateway's.
//
// The rule that holds in BOTH scopes: it FAILS CLOSED. If the MCP call errors or
// times out, the groove it was rendering is not played. Silence is the correct
// failure direction, and it's the same bias the presence collector takes. What
// happens next is the caller's business (loopbot drops the request and falls
// back to its own rotation — which is a different groove, not a second door for
// the same one).

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { decode, fromLink, type LoopSpec } from 'loopclub-loopgen'
import type { SeederConfig } from './config.js'
import type { Groove } from './jam.js'

/** What the MCP `build_loop` tool hands back (mcp/src/handlers.ts). */
interface BuildLoopResult {
  deepLink: string
  cellCount: number
  instruments: string[]
}

/** Where a groove came from. The only thing that decides whether it must cross
 *  the chokepoint — and, crucially, something no visitor can choose. */
export type GrooveOrigin = 'request' | 'idle'

export class Brain {
  private client: Client | null = null
  private connecting: Promise<Client> | null = null

  constructor(private cfg: SeederConfig) {}

  /** Is MCP wired at all? (For the boot log — routing decisions use remoteFor.) */
  get configured(): boolean {
    return this.cfg.mcpUrl !== undefined
  }

  /** Does a groove of this origin go through MCP? A request always does, when
   *  MCP is wired. The idle pulse only does under MCP_SCOPE=all. */
  remoteFor(origin: GrooveOrigin): boolean {
    if (!this.configured) return false
    return origin === 'request' || this.cfg.mcpScope === 'all'
  }

  /** What to print at boot, so the log says exactly what is governed. */
  get description(): string {
    if (!this.configured) return 'local loopgen'
    const scope = this.cfg.mcpScope === 'all' ? 'ALL grooves' : 'requests only (idle pulse stays local)'
    return `MCP ${this.cfg.mcpUrl} — ${scope}, fails closed`
  }

  /** Lazy, memoised connect. A dropped connection is re-established on next use. */
  private async connect(): Promise<Client> {
    if (this.client) return this.client
    if (this.connecting) return this.connecting

    this.connecting = (async () => {
      const client = new Client({ name: 'loopclub-seeder', version: '0.1.0' })
      const transport = new StreamableHTTPClientTransport(new URL(this.cfg.mcpUrl!))
      await client.connect(transport)
      client.onclose = () => {
        this.client = null // next render reconnects
      }
      this.client = client
      return client
    })()

    try {
      return await this.connecting
    } finally {
      this.connecting = null
    }
  }

  /**
   * Render a groove into the spec robodj will actually play.
   *
   * Local mode returns the groove's own spec. Remote mode round-trips it through
   * `build_loop` and decodes the deep link that comes back — so what plays is
   * exactly what the MCP server (and anything proxying it) saw and approved.
   *
   * Throws in remote mode if the call fails. The caller must NOT retry this same
   * groove locally — that is the bypass. (It may play a different, idle groove.)
   */
  async render(groove: Groove, origin: GrooveOrigin): Promise<LoopSpec> {
    if (!this.remoteFor(origin)) return groove.spec

    const client = await this.connect()
    const res = (await client.callTool(
      {
        name: 'build_loop',
        arguments: { tracks: groove.spec.tracks, name: groove.name },
      },
      undefined,
      { timeout: this.cfg.mcpTimeoutMs },
    )) as { content?: Array<{ type: string; text?: string }>; isError?: boolean }

    if (res.isError) throw new Error(`build_loop returned an error for "${groove.name}"`)

    const text = res.content?.find((c) => c.type === 'text')?.text
    if (!text) throw new Error(`build_loop returned no content for "${groove.name}"`)

    const built = JSON.parse(text) as BuildLoopResult
    if (!built.deepLink) throw new Error(`build_loop returned no deepLink for "${groove.name}"`)

    // Decode what came back rather than trusting what we sent: if a proxy rewrote
    // the loop (trimmed it, refused part of it), we play the version that was
    // approved, not the version we asked for.
    const spec = decode(fromLink(built.deepLink))
    return { ...spec, name: groove.name }
  }

  async close(): Promise<void> {
    await this.client?.close().catch(() => {})
    this.client = null
  }
}
