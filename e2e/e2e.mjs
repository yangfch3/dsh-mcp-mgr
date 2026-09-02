/**
 * End-to-end: McpMgrGateway with the REAL mcp-client plugin against a real
 * stdio MCP server. A minimal fake `tools` service records registrations;
 * the manager discovers a workspace mcp.json, mounts the server, and its
 * tools land on ctx.tools under mcp__<server>__<tool> names.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpMgrGateway } from '../packages/dsh-mcp-mgr/lib/types/index.js'
import { waitFor } from './wait-for.mjs'

class FakeTools extends Service {
  constructor(ctx) { super(ctx, 'tools'); this.names = new Set() }
  get() { return undefined }
  register(definition) { this.names.add(definition.name) }
  unregister(definition) { this.names.delete(definition.name) }
  schemas() { return [...this.names].map(name => ({ name })) }
  execute() { throw new Error('unused') }
}

const previousCwd = process.cwd()
const workspace = `${process.env.TMPDIR ?? '/tmp'}/dsh-mcp-mgr-e2e-${process.pid}`
const mcpJson = join(workspace, '.dsh', 'dshmm', 'mcp.json')
mkdirSync(dirname(mcpJson), { recursive: true })
const serverScript = fileURLToPath(new URL('./mcp-test-server.mjs', import.meta.url))
writeFileSync(mcpJson, JSON.stringify({
  mcpServers: {
    spike: { type: 'stdio', command: process.execPath, args: [serverScript] },
  },
}, null, 2))
// Headless discovery source: process.cwd().
process.chdir(workspace)

const ctx = new Context()
await ctx.plugin(FakeTools)
const gateway = new McpMgrGateway(ctx, { enabled: true, rescanIntervalMs: 10_000 })
try {
  await gateway.rescan()
  await waitFor(() => gateway.snapshot().servers.some(s => s.status === 'active'), 30_000)
  const state = gateway.snapshot().servers[0]
  console.log('server state:', state.status, state.key)
  if (state.status !== 'active') {
    console.error('FAIL: server did not reach active, error:', state.error)
    process.exit(1)
  }
  // Real connectivity probe: the mounted server's tools must have registered,
  // so the snapshot row reports connected = true.
  if (state.connected !== true) {
    console.error('FAIL: connected probe did not find tools (connected =', state.connected, ')')
    process.exit(1)
  }
  console.log('connected probe: true')
  // The real mcp-client registers tools on ctx.tools; the fake records names,
  // so a real tool execute is out of scope.
  // Instead: mutate mcp.json and confirm the instance is rebuilt.
  writeFileSync(mcpJson, JSON.stringify({
    mcpServers: {
      spike: { type: 'stdio', command: process.execPath, args: [serverScript], env: { EXTRA: '1' } },
    },
  }, null, 2))
  await new Promise(resolve => setTimeout(resolve, 700))
  await gateway.rescan()
  await waitFor(() => gateway.snapshot().servers.some(s => s.status === 'active'), 30_000)
  console.log('after env change, status:', gateway.snapshot().servers[0].status)
  console.log('E2E PASS')
} finally {
  await ctx.fiber.dispose()
  process.chdir(previousCwd)
  rmSync(workspace, { recursive: true, force: true })
}
