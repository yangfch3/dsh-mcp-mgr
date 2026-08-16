/**
 * Repro v2: ToolRuntime AND gateway both mounted INSIDE a scoped context
 * (matching the real web app). Does the probe's global view miss the tools
 * while the gateway's own scope view sees them?
 */
import { Context, Service } from '/Users/fuchee/Documents/Program/PlayGround/deepseek-harness/vendor/cordis/lib/index.js'
import ToolRuntime from '/Users/fuchee/Documents/Program/PlayGround/deepseek-harness/packages/core/tools/lib/types/index.js'
import { createScope, scopeOf } from '/Users/fuchee/Documents/Program/PlayGround/deepseek-harness/packages/core/scope/lib/types/index.js'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { McpMgrGateway } from '../packages/dsh-mcp-mgr/lib/types/index.js'

class StubSystemPrompt extends Service {
  constructor(ctx) { super(ctx, 'systemPrompt') }
  tools() { return [] }
}

const workspace = `${process.env.TMPDIR ?? '/tmp'}/dsh-mcp-mgr-scope2-${process.pid}`
rmSync(workspace, { recursive: true, force: true })
mkdirSync(join(workspace, '.dsh', 'dshmm'), { recursive: true })
process.chdir(workspace)
const mcpJson = join(workspace, '.dsh', 'dshmm', 'mcp.json')
const serverScript = new URL('./mcp-test-server.mjs', import.meta.url).pathname
writeFileSync(mcpJson, JSON.stringify({
  mcpServers: { spike: { type: 'stdio', command: process.execPath, args: [serverScript] } },
}, null, 2))

const root = new Context()
const scope = createScope(root, 'web-host')
await scope.ctx.plugin(StubSystemPrompt)
await scope.ctx.plugin(ToolRuntime) // ToolRuntime INSIDE the scope, like the web app
const gateway = new McpMgrGateway(scope.ctx, { enabled: true, rescanIntervalMs: 600_000 })
try {
  await gateway.rescan()
  await new Promise(resolve => setTimeout(resolve, 6000))
  const row = gateway.snapshot().servers.find(s => s.name === 'spike')
  const tools = scope.ctx.get('tools')
  const globalNames = tools.schemas().map(s => s.name)
  const scopeNames = tools.schemas(scopeOf(scope.ctx)).map(s => s.name)
  console.log('row connected:', row?.connected, '| probeError:', row?.probeError)
  console.log('global view has mcp tool:', globalNames.some(n => n.startsWith('mcp__spike__')), '| total:', globalNames.length)
  console.log('scope view has mcp tool:', scopeNames.some(n => n.startsWith('mcp__spike__')), '| total:', scopeNames.length)
  console.log(row?.connected === true ? 'PROBE OK' : 'SCOPE THEORY CONFIRMED (global view misses scoped tools)')
} finally {
  await scope.dispose()
  await root.fiber.dispose()
  rmSync(workspace, { recursive: true, force: true })
}
