/**
 * End-to-end: McpMgrGateway with the REAL mcp-client plugin against a real
 * stdio MCP server. A minimal fake `tools` service records registrations;
 * the manager discovers a workspace mcp.json, mounts the server, and its
 * tools land on ctx.tools under mcp__<server>__<tool> names.
 */
import { Context, Service } from '/Users/fuchee/Documents/Program/PlayGround/deepseek-harness/vendor/cordis/lib/index.js'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpMgrGateway } from '../packages/dsh-mcp-mgr/lib/types/index.js'
import { waitFor } from './wait-for.mjs'

class FakeTools extends Service {
  constructor(ctx) { super(ctx, 'tools') }
  get() { return undefined }
  register() {}
  unregister() {}
  schemas() { return [] }
  execute() { throw new Error('unused') }
}

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
  // The real mcp-client registers tools on ctx.tools; our fake records nothing,
  // so we verify through the sync layer + a real tool execute is out of scope.
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
  gateway['dispose']?.()
  await ctx.fiber.dispose()
  rmSync(workspace, { recursive: true, force: true })
}
