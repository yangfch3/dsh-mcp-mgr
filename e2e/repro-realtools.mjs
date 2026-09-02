/**
 * Repro: does the connectivity probe see mcp tools with the REAL ToolRuntime?
 */
import { Context, Service } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpMgrGateway } from '../packages/dsh-mcp-mgr/lib/types/index.js'
import { waitFor } from './wait-for.mjs'

class StubSystemPrompt extends Service {
  constructor(ctx) { super(ctx, 'systemPrompt') }
  tools() { return [] }
}

const previousCwd = process.cwd()
const workspace = `${process.env.TMPDIR ?? '/tmp'}/dsh-mcp-mgr-realtools-${process.pid}`
rmSync(workspace, { recursive: true, force: true })
mkdirSync(join(workspace, '.dsh', 'dshmm'), { recursive: true })
process.chdir(workspace)
const mcpJson = join(workspace, '.dsh', 'dshmm', 'mcp.json')
const serverScript = fileURLToPath(new URL('./mcp-test-server.mjs', import.meta.url))
writeFileSync(mcpJson, JSON.stringify({
  mcpServers: { spike: { type: 'stdio', command: process.execPath, args: [serverScript] } },
}, null, 2))

const ctx = new Context()
await ctx.plugin(StubSystemPrompt)
await ctx.plugin(ToolRuntime)
const gateway = new McpMgrGateway(ctx, { enabled: true, rescanIntervalMs: 600_000 })
try {
  await gateway.rescan()
  await waitFor(() => gateway.snapshot().servers.some(s => s.status === 'active'), 30_000)
  const row = gateway.snapshot().servers.find(s => s.name === 'spike')
  const tools = ctx.get('tools').schemas().map(s => s.name).filter(n => n.startsWith('mcp__spike__'))
  console.log('row connected:', row?.connected, '| mcp__spike__ tools found:', tools.length, tools.slice(0, 3))
  console.log(row?.connected === true ? 'PROBE OK' : 'PROBE MISSED TOOLS')
} finally {
  await ctx.fiber.dispose()
  process.chdir(previousCwd)
  rmSync(workspace, { recursive: true, force: true })
}
