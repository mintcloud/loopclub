#!/usr/bin/env node
// loopclub-mcp — remote HTTP entrypoint (Streamable HTTP transport).
//
// This is the SAME server as the stdio build (createServer()), exposed over
// MCP's Streamable HTTP so claude.ai users can add it as a connector by URL
// (mcp.loopclub.xyz) with no local install. It is intended to run behind a
// reverse proxy / Cloudflare tunnel that terminates TLS — so it binds to
// localhost only and never speaks to the public internet directly.
//
// SECURITY POSTURE (see SECURITY.md):
//   • No auth, by design — the server holds no keys, signs nothing, touches no
//     chain, and is a pure stateless encoder. There is nothing to steal.
//   • The risks of a *public, unauthenticated* endpoint are abuse / DoS, not
//     data loss. Mitigations live here AND at the edge (Cloudflare):
//       - stateless, JSON-response mode  → no SSE streams to hold open, no
//         per-session memory to exhaust;
//       - request body size cap          → bounds the JSON parser + decoder;
//       - input bounds (schemas.ts)      → bounds encode()/decode() work;
//       - Host/Origin allowlist          → DNS-rebinding / cross-origin defense;
//       - in-process rate limit          → coarse backstop; Cloudflare is primary;
//       - localhost bind                 → origin is never directly reachable.

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createServer } from './server.js'

const PORT = Number(process.env.PORT ?? 8787)
const HOST = process.env.MCP_BIND_HOST ?? '127.0.0.1' // localhost only — front with a proxy
const MCP_PATH = process.env.MCP_PATH ?? '/mcp'

// Host header allowlist — the public hostname(s) this server answers on, plus
// localhost for health checks. Blocks DNS-rebinding and stray vhosts. A request
// whose Host isn't here is rejected before it reaches the MCP layer.
const ALLOWED_HOSTS = new Set(
  (process.env.MCP_ALLOWED_HOSTS ?? 'mcp.loopclub.xyz,localhost,127.0.0.1')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
)

// Origin header allowlist. MCP clients (Claude) send no Origin; only browsers
// do. We therefore allow *absent* Origin and reject any present-but-unlisted
// Origin — i.e. no browser from a foreign page can drive the server.
const ALLOWED_ORIGINS = new Set(
  (process.env.MCP_ALLOWED_ORIGINS ?? 'https://app.loopclub.xyz,https://loopclub.xyz')
    .split(',')
    .map((o) => o.trim().toLowerCase())
    .filter(Boolean),
)

const MAX_BODY_BYTES = Number(process.env.MCP_MAX_BODY_BYTES ?? 64 * 1024) // 64 KB
const REQUEST_TIMEOUT_MS = Number(process.env.MCP_REQUEST_TIMEOUT_MS ?? 15_000)

// ── Coarse in-process rate limit ──────────────────────────────────────────
// A fixed-window counter per client IP. This is a backstop only: behind
// Cloudflare the real limiter/WAF lives at the edge, and the IP we see is the
// CF-Connecting-IP header. Bounded memory: the map is swept every window.
const RATE_WINDOW_MS = Number(process.env.MCP_RATE_WINDOW_MS ?? 60_000)
const RATE_MAX = Number(process.env.MCP_RATE_MAX ?? 120) // requests / window / IP
const hits = new Map<string, { count: number; resetAt: number }>()

function clientIp(req: IncomingMessage): string {
  const cf = req.headers['cf-connecting-ip']
  if (typeof cf === 'string' && cf) return cf
  const xff = req.headers['x-forwarded-for']
  if (typeof xff === 'string' && xff) return xff.split(',')[0]!.trim()
  return req.socket.remoteAddress ?? 'unknown'
}

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const e = hits.get(ip)
  if (!e || now >= e.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return false
  }
  e.count += 1
  return e.count > RATE_MAX
}

// Sweep expired buckets so the map can't grow unbounded under a churning-IP
// flood. unref() so this timer never keeps the process alive on its own.
setInterval(() => {
  const now = Date.now()
  for (const [ip, e] of hits) if (now >= e.resetAt) hits.delete(ip)
}, RATE_WINDOW_MS).unref()

// ── helpers ────────────────────────────────────────────────────────────────

function send(res: ServerResponse, status: number, body: string, contentType = 'text/plain') {
  res.writeHead(status, { 'content-type': contentType }).end(body)
}

function rpcError(res: ServerResponse, status: number, message: string) {
  // JSON-RPC-shaped error so MCP clients surface something sane.
  send(
    res,
    status,
    JSON.stringify({ jsonrpc: '2.0', error: { code: -32600, message }, id: null }),
    'application/json',
  )
}

function hostAllowed(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? '').toLowerCase().split(':')[0]!
  return ALLOWED_HOSTS.has(host)
}

function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return true // non-browser MCP client — no Origin header
  return ALLOWED_ORIGINS.has(origin.toLowerCase())
}

class PayloadTooLargeError extends Error {}

// Read the request body with a hard byte cap. Stops buffering the instant the
// cap is crossed (so an oversized POST can't balloon memory) but does NOT tear
// the socket down here — the caller still wants to flush a clean 413 first.
function readBodyCapped(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    let aborted = false
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      if (aborted) return
      size += c.length
      if (size > maxBytes) {
        aborted = true
        req.pause()
        reject(new PayloadTooLargeError('payload too large'))
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (!aborted) resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
  })
}

// ── request handling ─────────────────────────────────────────────────────────

async function handleMcp(req: IncomingMessage, res: ServerResponse) {
  // Stateless mode: a fresh server + transport per request. No session store,
  // no cross-request state, no SSE streams — the cleanest shape for a pure
  // encoder and the one with the smallest attack surface.
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST')
    rpcError(res, 405, 'method not allowed; POST a JSON-RPC message')
    return
  }

  let body: unknown
  try {
    const raw = await readBodyCapped(req, MAX_BODY_BYTES)
    body = raw ? JSON.parse(raw) : undefined
  } catch (e) {
    const tooLarge = e instanceof PayloadTooLargeError
    if (!res.headersSent) {
      rpcError(res, tooLarge ? 413 : 400, tooLarge ? 'payload too large' : 'invalid JSON body')
    }
    // Now that the 413/400 is flushing, drop the rest of the upload.
    res.on('finish', () => req.destroy())
    return
  }

  const server = createServer()
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true, // plain JSON replies, no long-lived SSE
  })
  // Tear the per-request server/transport down once the response is flushed.
  res.on('close', () => {
    void transport.close()
    void server.close()
  })
  try {
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
  } catch (e) {
    process.stderr.write(`mcp request error: ${(e as Error).message}\n`)
    if (!res.headersSent) rpcError(res, 500, 'internal error')
  }
}

const httpServer = createHttpServer((req, res) => {
  // Per-request wall-clock cap — slow-loris / hung-handler backstop.
  req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy())

  const url = req.url ?? '/'
  const path = url.split('?')[0]

  // Liveness probe for the proxy / uptime check. No MCP, no rate limit.
  if (req.method === 'GET' && path === '/healthz') {
    send(res, 200, 'ok')
    return
  }

  if (!hostAllowed(req)) {
    rpcError(res, 421, 'host not allowed')
    return
  }
  if (!originAllowed(req)) {
    rpcError(res, 403, 'origin not allowed')
    return
  }
  if (path !== MCP_PATH) {
    rpcError(res, 404, 'not found')
    return
  }
  if (rateLimited(clientIp(req))) {
    res.setHeader('retry-after', String(Math.ceil(RATE_WINDOW_MS / 1000)))
    rpcError(res, 429, 'rate limit exceeded')
    return
  }

  void handleMcp(req, res)
})

// Cap header bloat too (Node default is 16KB; keep it tight).
httpServer.maxHeadersCount = 64
httpServer.headersTimeout = REQUEST_TIMEOUT_MS
httpServer.requestTimeout = REQUEST_TIMEOUT_MS

httpServer.listen(PORT, HOST, () => {
  process.stderr.write(
    `loopclub-mcp ready (http) — http://${HOST}:${PORT}${MCP_PATH} · hosts=[${[...ALLOWED_HOSTS].join(',')}]\n`,
  )
})

function shutdown(sig: string) {
  process.stderr.write(`loopclub-mcp: ${sig}, closing\n`)
  httpServer.close(() => process.exit(0))
  // Don't hang forever if a connection won't drain.
  setTimeout(() => process.exit(0), 5_000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
