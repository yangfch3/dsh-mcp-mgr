/**
 * Repro: mount the REAL unity-mcp server (localhost:8090) through the real
 * gateway and check the connectivity probe — does unity-mcp's own tool
 * schemas break schemas()?
 */
import { Context, Service } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { McpMgrGateway } from '../packages/dsh-mcp-mgr/lib/types/index.js'

class StubSystemPrompt extends Service {
  constructor(ctx) { super(ctx, 'systemPrompt') }
  tools() { return [] }
}

const previousCwd = process.cwd()
const workspace = `${process.env.TMPDIR ?? '/tmp'}/dsh-mcp-mgr-unity-${process.pid}`
rmSync(workspace, { recursive: true, force: true })
mkdirSync(join(workspace, '.dsh', 'dshmm'), { recursive: true })
process.chdir(workspace)
const mcpJson = join(workspace, '.dsh', 'dshmm', 'mcp.json')
writeFileSync(mcpJson, JSON.stringify({
  mcpServers: { 'unity-mcp': { type: 'http', url: 'http://localhost:8090/' } },
}, null, 2))

const ctx = new Context()
await ctx.plugin(StubSystemPrompt)
await ctx.plugin(ToolRuntime)
const gateway = new McpMgrGateway(ctx, { enabled: true, rescanIntervalMs: 600_000 })
try {
  await gateway.rescan()
  await new Promise(resolve => setTimeout(resolve, 8000)) // let connect + sync settle
  const row = gateway.snapshot().servers.find(s => s.name === 'unity-mcp')
  console.log('row:', row?.status, '| connected:', row?.connected, row?.error !== undefined ? `| error: ${row.error}` : '')
  try {
    const names = ctx.get('tools').schemas().map(s => s.name).filter(n => n.startsWith('mcp__unity-mcp__'))
    console.log('schemas() succeeded, unity-mcp tools:', names.length)
  } catch (error) {
    console.log('schemas() THREW:', String(error instanceof Error ? error.message : error).slice(0, 120))
  }
  console.log(row?.connected === true ? 'PROBE OK' : 'PROBE FAILED WITH REAL UNITY-MCP')
} finally {
  await ctx.fiber.dispose()
  process.chdir(previousCwd)
  rmSync(workspace, { recursive: true, force: true })
}
