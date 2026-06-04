// Thin registration layer: wires the pure handlers into MCP tools, resources,
// and the jam prompt. No logic lives here beyond shaping MCP responses.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { LinkError } from 'loopclub-loopgen'
import { buildLoopShape, describeLoopShape, jamPromptShape, Track } from './schemas.js'
import {
  buildLoop,
  describeLoop,
  vocabularyText,
  genresText,
  howItWorksText,
  jamPromptText,
} from './handlers.js'
import type { z } from 'zod'

function jsonContent(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

function errorContent(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

export function createServer(): McpServer {
  const server = new McpServer({ name: 'loopclub', version: '0.1.0' })

  server.registerTool(
    'build_loop',
    {
      title: 'Build a loopclub loop',
      description:
        'Turn a described beat into a loopclub link. Returns a ?jam= deep link, ' +
        'an ASCII grid preview, the lit-cell count, and the instruments used. The ' +
        'user opens the link to audition the loop free and rent the cells in-app. ' +
        'Read loopclub://vocabulary and loopclub://genres first for idiomatic loops.',
      inputSchema: buildLoopShape,
    },
    async (args) => {
      try {
        const tracks = args.tracks as z.infer<typeof Track>[]
        return jsonContent(buildLoop({ tracks, name: args.name }))
      } catch (e) {
        return errorContent(`build_loop failed: ${(e as Error).message}`)
      }
    },
  )

  server.registerTool(
    'describe_loop',
    {
      title: 'Describe a loopclub loop',
      description:
        'Read a loop back: pass a ?jam= link (or raw pattern/synthData bigints) ' +
        'and get a human-readable, per-track summary plus the ASCII grid. Use it ' +
        'to inspect a loop a user pasted, or to verify what you just built.',
      inputSchema: describeLoopShape,
    },
    async (args) => {
      try {
        return jsonContent(describeLoop(args))
      } catch (e) {
        const msg = e instanceof LinkError ? `that doesn't look like a valid jam link: ${e.message}` : (e as Error).message
        return errorContent(`describe_loop failed: ${msg}`)
      }
    },
  )

  const textResource = (text: string) => (uri: URL) => ({
    contents: [{ uri: uri.href, mimeType: 'text/markdown', text }],
  })

  server.registerResource(
    'vocabulary',
    'loopclub://vocabulary',
    {
      title: 'Loop vocabulary',
      description: 'The grid rules: 16 steps, 9 tracks, the synth row, pitch range, and how to be musical.',
      mimeType: 'text/markdown',
    },
    textResource(vocabularyText()),
  )

  server.registerResource(
    'genres',
    'loopclub://genres',
    {
      title: 'Genre starting points',
      description: 'Worked example loops (house, techno, boom-bap, dnb) as ASCII + spec, for few-shot grounding.',
      mimeType: 'text/markdown',
    },
    textResource(genresText()),
  )

  server.registerResource(
    'how-it-works',
    'loopclub://how-it-works',
    {
      title: 'How a jammed loop becomes real',
      description: 'The link → audition → rent lifecycle. Auditioning is free; pressing cells costs USDm.',
      mimeType: 'text/markdown',
    },
    textResource(howItWorksText()),
  )

  server.registerPrompt(
    'jam',
    {
      title: 'Jam a loop',
      description: 'Kick off a loopclub jam: generate an idiomatic, in-key loop and return the link.',
      argsSchema: jamPromptShape,
    },
    (args) => ({
      messages: [
        {
          role: 'user' as const,
          content: { type: 'text' as const, text: jamPromptText(args.genre, args.bpm) },
        },
      ],
    }),
  )

  return server
}
