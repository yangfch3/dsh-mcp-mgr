/**
 * Repro: gateway mounted inside a SCOPED context — does the probe miss tools
 * registered in the scope layer while the agent (child scope) can see them?
 */
import { Context, Service } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpMgrGateway } from '../packages/dsh-mcp-mgr/lib/types/index.js'
import { waitFor } from './wait-for.mjs'

class StubSystemPrompt extends Service {
  constructor(ctx) { super(ctx, 'systemPrompt') }
  tools() { return [] }
}

const previousCwd = process.cwd()
const workspace = `${process.env.TMPDIR ?? '/tmp'}/dsh-mcp-mgr-scope-${process.pid}`
rmSync(workspace, { recursive: true, force: true })
mkdirSync(join(workspace, '.dsh', 'dshmm'), { recursive: true })
process.chdir(workspace)
const mcpJson = join(workspace, '.dsh', 'dshmm', 'mcp.json')
const serverScript = fileURLToPath(new URL('./mcp-test-server.mjs', import.meta.url))
writeFileSync(mcpJson, JSON.stringify({
  mcpServers: { spike: { type: 'stdio', command: process.execPath, args: [serverScript] } },
}, null, 2))

const root = new Context()
await root.plugin(StubSystemPrompt)
await root.plugin(ToolRuntime)
// Simulate the web host running plugins inside a scope (agent children inherit).
const scope = createScope(root, {})
const gateway = new McpMgrGateway(scope.ctx, { enabled: true, rescanIntervalMs: 600_000 })
try {
  await gateway.rescan()
  await waitFor(() => gateway.snapshot().servers.some(s => s.status === 'active'), 30_000)
  const row = gateway.snapshot().servers.find(s => s.name === 'spike')
  // What the gateway's probe sees: global view from its ctx
  const globalNames = scope.ctx.get('tools').schemas().map(s => s.name)
  console.log('row connected:', row?.connected)
  console.log('global view has mcp tools:', globalNames.some(n => n.startsWith('mcp__spike__')), '| total global tools:', globalNames.length)
  console.log(row?.connected === true ? 'PROBE OK' : 'PROBE MISSED (scope theory confirmed)')
} finally {
  await scope.dispose()
  await root.fiber.dispose()
  process.chdir(previousCwd)
  rmSync(workspace, { recursive: true, force: true })
}
