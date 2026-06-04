#!/usr/bin/env node
// loopclub-mcp — stdio entrypoint. Run via `npx loopclub-mcp` or
// `claude mcp add loopclub -- npx -y loopclub-mcp`.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from './server.js'

async function main(): Promise<void> {
  const server = createServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // stdout is the JSON-RPC channel — log lifecycle to stderr only.
  process.stderr.write('loopclub-mcp ready (stdio)\n')
}

main().catch((err) => {
  process.stderr.write(`loopclub-mcp fatal: ${(err as Error).stack ?? err}\n`)
  process.exit(1)
})
