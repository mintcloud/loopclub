// The brain — where the spec robodj is about to play comes from.
//
// Two modes, one interface:
//
//   MCP_URL unset  → local. loopgen renders the groove in-process, as it always
//                    has. Nothing crosses the network.
//   MCP_URL set    → every groove is rendered by calling `build_loop` on the MCP
//                    server, and the returned deep link is decoded back into a
//                    spec. Same brain, different interface — the loop robodj
//                    plays is now literally the loop the MCP server built.
//
// The second mode exists so that the MCP call becomes the *chokepoint*: a single
// place every spec robodj will ever play must pass through, carrying the thing
// that decides the money. Cost is `cells × rentPerLoop × rentLoops`, so cost
// lives in the arguments of that call — which means a proxy in front of it (a
// gateway, a policy engine, a logger) can see and price every future spend
// before a single toggle() is signed. Point MCP_URL at the proxy instead of the
// server and robodj's code doesn't change by one line.
//
// Two rules make the chokepoint real, and they're the whole reason this file is
// worth its weight:
//
//   1. EVERY groove goes through it — the idle pulse as much as a visitor's
//      request. A chokepoint with a second door is not a chokepoint.
//   2. It FAILS CLOSED. If the MCP call errors or times out, robodj plays
//      nothing. It does not quietly fall back to the local renderer, because a
//      bypass you can trigger by knocking the proxy over is not a control — it's
//      a suggestion. Silence is the correct failure direction here, and it's the
//      same bias the presence collector already takes.

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

export class Brain {
  private client: Client | null = null
  private connecting: Promise<Client> | null = null

  constructor(private cfg: SeederConfig) {}

  get remote(): boolean {
    return this.cfg.mcpUrl !== undefined
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
   * Throws in remote mode if the call fails. The caller must NOT fall back.
   */
  async render(groove: Groove): Promise<LoopSpec> {
    if (!this.remote) return groove.spec

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
