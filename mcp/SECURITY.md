# loopclub-mcp — security model (remote / no-auth build)

*Threat model for the public Streamable-HTTP deployment at `mcp.loopclub.xyz`. Last reviewed 2026-06-04.*

## Verdict

**No-auth is defensible here — but "no security issues" was too glib.** The
*confidentiality* and *integrity* story is genuinely strong: the server holds no
keys, signs nothing, writes nothing, and reads no chain. There is nothing to
steal and nothing to corrupt. What going public *does* introduce is an
**availability / abuse** surface that the stdio build never had — a free,
anonymous, internet-facing compute endpoint. That's a real risk class, and it's
the one this review (and the hardening in `src/http.ts` + `src/schemas.ts`)
addresses. With those controls plus Cloudflare at the edge, shipping no-auth is
reasonable. Auth becomes worth adding only if/when the server stops being a pure
encoder (see §8).

---

## 1. What changed by going remote

| | stdio build (today) | remote HTTP build (this) |
|---|---|---|
| Reachable by | the one local user who launched it | anyone on the internet |
| Authenticated | implicitly (it's your own process) | **no** |
| Isolation | OS process boundary | a public TCP port (behind a proxy) |
| Trust of input | your own Claude | arbitrary, hostile |
| Blast radius of a bug | your machine | the shared `mcp.loopclub.xyz` host |

The trust boundary moved from "my laptop" to "the public internet." Everything
below follows from that one shift.

## 2. Asset inventory — what is actually at risk?

This is the crux of why no-auth is tenable. Walk the usual targets:

- **Private keys / wallets** — none. The server never touches a key or signs. ✓
- **On-chain writes** — none. It makes zero chain calls; it only *encodes* a
  link the user later signs *in the app*. ✓
- **Secrets / API tokens / env credentials** — none required to run. ✓
- **User data / PII** — none collected, none stored. Stateless. ✓
- **Database / filesystem** — none. Nothing is persisted. ✓
- **Outbound network (SSRF risk)** — the server makes **no** outbound requests,
  so it can't be used as an SSRF pivot. ✓

The only assets are **availability** (the box stays up, doesn't get used as free
compute) and the **reputation** of the `loopclub.xyz` domain (don't let it be a
spam/abuse origin). Those are the things the controls protect.

## 3. Threat analysis (STRIDE-ish)

### 3.1 Denial of service — *the primary risk*
A public, unauthenticated endpoint is free compute. Even a pure function can be
abused. Sub-vectors and mitigations:

| Vector | Why it bites | Mitigation | Where |
|---|---|---|---|
| **Unbounded input arrays** — `tracks: [×millions]`, huge `steps`/`notes` | `encode()` does O(input) work; the *output* wire is bounded but the *processing* isn't | `.max()` caps: 32 tracks, 16 steps, 16 notes, 120-char name | `schemas.ts` |
| **Large request body** | balloons the JSON parser + decoder before validation | 64 KB hard cap, aborts mid-stream (stops buffering, flushes a clean 413) | `http.ts` `readBodyCapped` |
| **base64 decode allocation** in `describe_loop` | `fromLink` allocates ~0.75× the input length before `unpack` rejects | `link` capped at 4096 chars (schema) + body cap | `schemas.ts` / `link.ts` |
| **BigInt blow-up** via `pattern`/`synthData` strings | huge bigints → slow ops | bigint strings capped at 128 chars; `decode` only reads bits 0–143 regardless | `schemas.ts` / `codec.ts` |
| **Connection exhaustion** (held-open SSE streams) | stateful MCP can keep GET streams open per session | **stateless + `enableJsonResponse`** → no SSE, no sessions, no per-session memory | `http.ts` |
| **Slow-loris / hung handler** | sockets held open to exhaust the pool | `headersTimeout` + `requestTimeout` + per-request `setTimeout` (15 s) | `http.ts` |
| **Volumetric flood** | raw request rate | coarse per-IP fixed-window limiter (120/min, swept) **+ Cloudflare WAF (primary)** | `http.ts` + edge |
| **Box-level resource exhaustion** | a flood that slips through still shouldn't take the host down | systemd `MemoryMax=256M`, `TasksMax`, `CPUQuota` | `deploy/*.service` |

The decode path itself (`unpack` in `link.ts`) was already written as hostile-input-hardened: it validates length, version, `synthCount ≤ 16`, and bounds every cellId/midi. The new caps protect the *encode* path and the *allocation-before-validation* window.

### 3.2 Spoofing / authentication
There is no identity to spoof because there is no auth and no per-user state.
Anyone can call `build_loop`; the worst outcome is they get a link — which they
could also have produced by reading the open-source codec. **No privilege is
gained by calling the server.** (See §8 for the explicit no-auth decision.)

### 3.3 Tampering
The server is a deterministic pure function (`spec → link`). There is no state
to tamper with and no stored data to alter. A caller can only influence *their
own* response.

### 3.4 Information disclosure
- No secrets exist to leak.
- **Error messages**: handlers return `(e as Error).message` — these are
  loopgen's own validation strings (e.g. "bad midi 200"), not stack traces or
  paths. The HTTP layer returns generic JSON-RPC errors for transport faults
  and logs details to **stderr only**. ✓
- **Open-redirect check**: the emitted deep link's origin is **server-config
  controlled** (`LOOPCLUB_ORIGIN`), never user-controlled. A caller cannot make
  the server mint a link to an attacker domain. ✓

### 3.5 Elevation of privilege
The process performs no privileged operations. Defense in depth via systemd:
`NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome=read-only`,
`PrivateTmp`, restricted address families/namespaces. Runs unprivileged.

### 3.6 DNS rebinding / cross-origin
Classic local-MCP attack: a malicious web page resolves a name to 127.0.0.1 to
reach a local server. Mitigated by a **Host-header allowlist** (`mcp.loopclub.xyz`
+ localhost → otherwise 421) and an **Origin allowlist** (absent Origin, as real
MCP clients send, is allowed; a present foreign Origin → 403). So no browser on a
foreign page can drive the server.

### 3.7 Prompt injection (MCP-specific)
The server **executes nothing** and calls no model — it returns data (a link,
an ASCII grid, per-track text). The one place user text is echoed back is the
optional `name` field (into the share copy / encoded link). That's bounded to
120 chars and is *data*, not an instruction; the consuming Claude should treat
tool output as untrusted content (standard MCP hygiene). Low risk, noted for
completeness.

### 3.8 Supply chain
Runtime deps are minimal: `@modelcontextprotocol/sdk` (+ its `@hono/node-server`
for the Node HTTP shim) and `zod`. No new dependency was added for the remote
build — the HTTP server is raw `node:http`. Keep the SDK patched; pin via
lockfile; enable Dependabot/`npm audit` in CI.

## 4. Division of responsibility — origin vs. edge

Two layers, deliberately:

- **In-process (`src/`)** — correctness-critical bounds that must hold even if
  the edge is bypassed: input caps, body cap, host/origin checks, timeouts,
  stateless mode, the coarse rate limiter.
- **Cloudflare edge (must be configured)** — the *primary* volumetric defense:
  - TLS termination + hides the origin IP (origin binds 127.0.0.1, tunnel-only).
  - WAF + **rate-limiting rule** on `mcp.loopclub.xyz` (e.g. N req/min/IP).
  - Bot Fight / managed challenge for obvious abuse.
  - (Optional) a request-size limit at the edge so floods never reach origin.

The in-process limiter keys on `CF-Connecting-IP`; it is a backstop, not the
main control. **Do not ship without the Cloudflare rate-limit rule enabled.**

## 5. The no-auth decision

**Ship no-auth, with conditions.** Rationale:
- The MCP spec recommends OAuth for remote servers primarily to protect
  *privileged or stateful* tools. This server has neither — calling it grants no
  capability the caller didn't already have (the codec is open source).
- Auth would add real friction to the very thing we want (one-click connector
  for claude.ai users) for no confidentiality/integrity gain.
- The residual risk (abuse/DoS) is better handled by rate-limiting + WAF than by
  auth, which doesn't stop a determined abuser who can mint credentials.

**Revisit and add auth (OAuth 2.1 per MCP spec) the moment any of these become
true:**
1. A tool gains side effects (writes a DB, reserves cells, calls the chain,
   spends money, sends email).
2. You want per-user quotas/analytics or to attribute usage.
3. Abuse persists despite edge rate-limiting and you need accountable identity.

## 6. Residual risks (accepted, with eyes open)

- **Anonymous abuse within limits.** Someone can still burn your rate budget
  generating junk links. Impact: wasted compute, not data loss. Mitigation:
  edge limits; alert on sustained 4xx/429 spikes.
- **In-process rate limiter is per-instance and memory-based.** Fine for a
  single instance behind one tunnel; if you ever run multiple replicas it won't
  be shared (use the edge limiter as the source of truth).
- **No request logging/audit by default** (deliberate — no PII). If you later
  need abuse forensics, add structured access logs at the edge, not the origin.
- **`@hono/node-server` is pulled transitively** by the SDK's Node HTTP wrapper.
  It's reputable, but it's surface area; track it in audits.

## 7. Pre-launch checklist

- [ ] `npm run build && npm test` green (18 tests incl. input-bound tests).
- [ ] Service bound to `127.0.0.1` only (`MCP_BIND_HOST` default) — confirm it is
      **not** reachable on the public IP directly.
- [ ] `MCP_ALLOWED_HOSTS` includes `mcp.loopclub.xyz`; verify a bad Host → 421.
- [ ] Cloudflare tunnel ingress for `mcp.loopclub.xyz` → `127.0.0.1:8787`.
- [ ] **Cloudflare rate-limiting rule enabled** on the hostname.
- [ ] systemd unit installed with the resource caps; `Restart=on-failure`.
- [ ] `/healthz` returns 200 through the tunnel; `GET /mcp` → 405; oversized body
      → 413; foreign Origin → 403.
- [ ] Add the connector in claude.ai (`https://mcp.loopclub.xyz/mcp`) and run a
      `build_loop` end-to-end.

## 8. One-line summary for the changelog

> Remote MCP at `mcp.loopclub.xyz` — stateless pure encoder, no-auth by design
> (no keys/chain/state to protect); DoS/abuse bounded in-process (input caps,
> 64 KB body cap, host/origin allowlist, timeouts, rate limit) and at the
> Cloudflare edge.
