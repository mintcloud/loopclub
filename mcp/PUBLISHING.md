# Publishing loopclub-mcp

Two steps, in this order: **npm first, then the MCP registry.** The registry
does not host code — it downloads the npm package and checks that its
`package.json` carries an `mcpName` field equal to the server name in
`server.json`. If the package isn't on npm, publishing to the registry fails.

Downstream directories (PulseMCP, Glama, Smithery, and the connector lists) all
ingest from the official registry, so this one publish is what feeds them.

Everything below is already prepared in the repo — `mcpName` is in
`package.json`, `server.json` validates against the official
`2025-12-11` schema, and the publish build is bundled so the tarball has no
`file:` dependency on `../loopgen`.

---

## 0. Prerequisites

- An npm account (`loopclub-mcp` was unclaimed as of 13 Jul 2026).
- A GitHub login as **`mintcloud`** — that's what authorises the
  `io.github.mintcloud/*` namespace.

Publish from a **clean checkout or a worktree**, not from
`~/projects/loopclub/mcp` — `prepublishOnly` runs `rm -rf dist`, and that's the
directory the running `loopclub-mcp-http` systemd unit executes from.

## 1. npm

```bash
cd mcp
npm install
npm login                 # or: npm adduser
npm publish --access public
```

`prepublishOnly` runs typecheck → tests → the bundled build automatically. The
tarball should be 4 files, ~12 kB: `README.md`, `dist/index.js`, `dist/http.js`,
`package.json`. Dry-run it first if you want to see it:

```bash
npm pack --dry-run
```

Verify it landed:

```bash
npm view loopclub-mcp mcpName     # → io.github.mintcloud/loopclub
npx -y loopclub-mcp               # should start and wait on stdio
```

## 2. The MCP registry

```bash
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher
sudo mv mcp-publisher /usr/local/bin/      # or keep it local: ./mcp-publisher

cd mcp
mcp-publisher login github                 # browser flow, log in as mintcloud
mcp-publisher publish                      # reads ./server.json
```

Do **not** run `mcp-publisher init` — it would overwrite the `server.json`
already in this directory.

Confirm:

```bash
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=loopclub" | jq
```

## 3. Republishing

Bump `version` in **both** `package.json` and `server.json` (they must match the
npm version you published), then repeat steps 1 and 2. The registry rejects a
`server.json` whose package version isn't on npm.

---

## What's in `server.json`

| field | value | why |
|---|---|---|
| `name` | `io.github.mintcloud/loopclub` | GitHub auth only grants the `io.github.<user>/` namespace |
| `packages[0]` | npm `loopclub-mcp`, stdio, `npx` hint | the local install path |
| `remotes[0]` | `https://mcp.tg-itsavibe.com/mcp` | the hosted connector — one-click for claude.ai Pro/Max, no npx |
| `description` | 96 chars | the schema caps it at 100 |

**The remote URL is on the VPS's tunnel domain, not `mcp.loopclub.xyz`.** The
branded host can't work until loopclub.xyz's nameservers move from Vercel to
Cloudflare (a Cloudflare tunnel hostname requires the zone to be on Cloudflare).
The registry does not require you to own the domain in `remotes`, so this
publishes fine — it's cosmetic. When the DNS moves, change the URL, bump the
version, republish.

If you'd rather not put the tunnel domain on a public listing, delete the whole
`remotes` block and publish stdio-only. The cost is that claude.ai users have to
install it locally instead of pasting a URL.
