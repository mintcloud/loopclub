# loopclub-mcp

**Jam with Claude.** An [MCP](https://modelcontextprotocol.io) server that turns
a described beat into a [loopclub](https://loopclub.xyz) link — ready to audition
and rent on-chain. It is a **pure encoder over [`loopgen`](../loopgen)**: it holds
no keys, talks to no chain, and signs nothing. Your Claude does the musical
thinking and calls `build_loop`; the server bit-packs it and returns a `?jam=`
deep link. You open the link, audition the loop free, and rent the cells
yourself in the app.

```
 you (to your Claude):  "dark techno — four-on-the-floor kick, off-beat hats, a low C2 synth drone"
        │
        ▼  Claude calls build_loop({ tracks: [...] })
 loopclub-mcp  →  loopgen.encode → toLink → ?jam= link + ASCII grid
        │
        ▼  Claude replies with the link
 you click  →  loopclub opens with the loop pre-loaded  →  "Rent these cells"  →  one signature
```

## Install

**Claude Code:**
```bash
claude mcp add loopclub -- npx -y loopclub-mcp
```

**Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "loopclub": { "command": "npx", "args": ["-y", "loopclub-mcp"] }
  }
}
```

Set `LOOPCLUB_ORIGIN` to point links at a specific deployment (defaults to
`https://app.loopclub.xyz` — the app subdomain that handles `?jam=` links; the
apex `loopclub.xyz` is the landing page and ignores the param):
```json
{ "mcpServers": { "loopclub": {
  "command": "npx", "args": ["-y", "loopclub-mcp"],
  "env": { "LOOPCLUB_ORIGIN": "https://app.loopclub.xyz" }
}}}
```

## Remote (hosted) — add it on claude.ai with no install

The same server runs over MCP's **Streamable HTTP** transport so claude.ai
(Pro/Max) users can add it as a **custom connector** by URL — no local tooling:

> Settings → Connectors → Add custom connector → `https://mcp.tg-itsavibe.com/mcp`

That is the live host today. The branded `mcp.loopclub.xyz` is **not** wired:
loopclub.xyz's DNS is on Vercel, and a Cloudflare tunnel hostname needs the zone
on Cloudflare, so the branded name has to wait for a nameserver move. Exact
deploy steps for the VPS are in `deploy/` (systemd user unit + tunnel rule).

Run it yourself:
```bash
npm run build
npm run start:http          # listens on 127.0.0.1:8787 (POST /mcp), front with a proxy
```
It binds to **localhost only** and is meant to sit behind a TLS-terminating
reverse proxy / Cloudflare tunnel (see `deploy/`). It is **no-auth by design** —
the server holds no keys, signs nothing, and is a pure stateless encoder, so
there is nothing to steal. The risks of a public endpoint are *abuse / DoS*, not
data loss; those are bounded both in-process (body cap, input bounds, host/origin
allowlist, rate limit, stateless JSON mode) and at the edge (Cloudflare WAF).
**Full threat model: [`SECURITY.md`](./SECURITY.md).**

Config (env, all optional):

| var | default | purpose |
|-----|---------|---------|
| `PORT` | `8787` | listen port |
| `MCP_BIND_HOST` | `127.0.0.1` | bind address — keep on localhost behind a proxy |
| `MCP_ALLOWED_HOSTS` | `mcp.loopclub.xyz,localhost,127.0.0.1` | Host-header allowlist (DNS-rebind defense) |
| `MCP_ALLOWED_ORIGINS` | `https://app.loopclub.xyz,https://loopclub.xyz` | Origin allowlist (absent Origin = allowed; foreign = 403) |
| `MCP_MAX_BODY_BYTES` | `65536` | request body cap |
| `MCP_RATE_MAX` / `MCP_RATE_WINDOW_MS` | `120` / `60000` | coarse per-IP rate limit (Cloudflare is primary) |
| `LOOPCLUB_ORIGIN` | `https://app.loopclub.xyz` | origin baked into emitted `?jam=` links |

## What it exposes

**Tools**
- `build_loop({ tracks, name? })` → `{ deepLink, asciiGrid, cellCount, instruments, note }`.
  The core. `tracks` mirror a loopgen `LoopSpec`: drum tracks carry lit `steps`
  (0–15); the `synth` track carries `notes` (`{ step, pitch }`, pitch as MIDI or
  a name like `"C3"`).
- `describe_loop({ link } | { pattern, synthData? })` → a per-track summary + the
  ASCII grid. Reads a `?jam=` link a user pasted, or raw wire bigints.

**Resources** (so Claude generates *good* loops, not random cells)
- `loopclub://vocabulary` — the grid rules, pitch range, and how to be musical.
- `loopclub://genres` — worked example loops (house, techno, boom-bap, dnb) as
  ASCII + spec, for few-shot grounding.
- `loopclub://how-it-works` — the free-audition / paid-press lifecycle.

**Prompt**
- `jam({ genre?, bpm? })` — a one-click entry point that tells Claude to read the
  resources, build something idiomatic and in-key, and return the link.

## Design boundary (deliberate)

- **No signing, no keys, no wallet, no chain reads.** The server only produces
  links; the user signs rent in the app. This is why session keys / PR #6 are
  irrelevant here.
- **Stateless.** Same spec in → same link out. Restartable, trivially scalable
  if hosted later (a remote Streamable-HTTP build is a fast-follow).
- The musical engine is entirely `loopgen`; this package is ~3 small files of
  glue (`schemas` → `handlers` → `server`).

## Develop

```bash
npm install          # links ../loopgen via file: (build loopgen first)
npm test             # vitest — handler logic + loopgen round-trip
node scripts/smoke.mjs   # end-to-end: spawns the server, drives real JSON-RPC
npm run build        # tsc → dist/ (bin: loopclub-mcp)
```

> `loopgen` is consumed via `file:../loopgen` while the repo has no workspace
> wiring. When the monorepo is rearchitected, this can become a workspace
> dependency with no code change (see `../loopgen/README.md`).
