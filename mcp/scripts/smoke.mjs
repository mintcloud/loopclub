#!/usr/bin/env node
// End-to-end stdio smoke test: spawns the built server, runs the MCP handshake,
// then exercises tools/resources/prompt over real JSON-RPC. Exits non-zero on
// any failure. Run with: node scripts/smoke.mjs
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const entry = join(here, '..', 'dist', 'index.js')

const proc = spawn('node', [entry], { stdio: ['pipe', 'pipe', 'inherit'] })

let buf = ''
const waiters = new Map() // id → resolve
proc.stdout.on('data', (chunk) => {
  buf += chunk.toString()
  let nl
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line) continue
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      continue
    }
    if (msg.id != null && waiters.has(msg.id)) {
      waiters.get(msg.id)(msg)
      waiters.delete(msg.id)
    }
  }
})

let nextId = 1
function rpc(method, params) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    waiters.set(id, resolve)
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 5000)
  })
}
function notify(method, params) {
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
}

const checks = []
function assert(cond, label) {
  checks.push({ ok: !!cond, label })
  console.log(`${cond ? '✓' : '✗'} ${label}`)
}

try {
  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke', version: '0' },
  })
  assert(init.result?.serverInfo?.name === 'loopclub', 'initialize → serverInfo.name = loopclub')
  notify('notifications/initialized', {})

  const tools = await rpc('tools/list', {})
  const toolNames = (tools.result?.tools ?? []).map((t) => t.name)
  assert(toolNames.includes('build_loop'), 'tools/list includes build_loop')
  assert(toolNames.includes('describe_loop'), 'tools/list includes describe_loop')

  const built = await rpc('tools/call', {
    name: 'build_loop',
    arguments: {
      tracks: [
        { instrument: 'kick', steps: [0, 4, 8, 12] },
        { instrument: 'hat', steps: [2, 6, 10, 14] },
        { instrument: 'synth', notes: [{ step: 0, pitch: 'C3' }, { step: 8, pitch: 'G3' }] },
      ],
      name: 'smoke techno',
    },
  })
  const payload = JSON.parse(built.result.content[0].text)
  assert(/\/\?jam=/.test(payload.deepLink), `build_loop → deepLink (${payload.deepLink})`)
  assert(payload.cellCount === 10, `build_loop → cellCount 10 (got ${payload.cellCount})`)

  const described = await rpc('tools/call', { name: 'describe_loop', arguments: { link: payload.deepLink } })
  const dpayload = JSON.parse(described.result.content[0].text)
  assert(dpayload.cellCount === 10, 'describe_loop round-trips cellCount')
  assert(/C3@0/.test(dpayload.description), 'describe_loop reads the synth note back')

  const badDescribe = await rpc('tools/call', { name: 'describe_loop', arguments: { link: '?jam=@@@' } })
  assert(badDescribe.result?.isError === true, 'describe_loop flags a malformed link as isError')

  const resources = await rpc('resources/list', {})
  const uris = (resources.result?.resources ?? []).map((r) => r.uri)
  assert(uris.includes('loopclub://vocabulary'), 'resources/list includes loopclub://vocabulary')

  const vocab = await rpc('resources/read', { uri: 'loopclub://vocabulary' })
  assert(/C1–C4/.test(vocab.result.contents[0].text), 'vocabulary resource reads back the pitch range')

  const prompts = await rpc('prompts/list', {})
  assert((prompts.result?.prompts ?? []).some((p) => p.name === 'jam'), 'prompts/list includes jam')

  const jam = await rpc('prompts/get', { name: 'jam', arguments: { genre: 'techno', bpm: '132' } })
  assert(/techno/.test(jam.result.messages[0].content.text), 'jam prompt weaves in the genre')
} catch (e) {
  console.error('smoke error:', e.message)
  checks.push({ ok: false, label: e.message })
} finally {
  proc.kill()
}

const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
process.exit(failed.length ? 1 : 0)
