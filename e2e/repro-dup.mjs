/**
 * Repro: mount / rebuild / unmount / remount cycles against the real gateway
 * to find which step triggers "serverName already in use".
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpMgrGateway } from '../packages/dsh-mcp-mgr/lib/types/index.js'

class FakeTools extends Service {
  constructor(ctx) { super(ctx, 'tools'); this.names = new Set() }
  get() { return undefined }
  register(definition) { this.names.add(definition.name) }
  unregister(definition) { this.names.delete(definition.name) }
  schemas() { throw new Error('simulated non-lossless tool parameters') }
  execute() { throw new Error('unused') }
}

const previousCwd = process.cwd()
const workspace = `${process.env.TMPDIR ?? '/tmp'}/dsh-mcp-mgr-dup-${process.pid}`
rmSync(workspace, { recursive: true, force: true })
mkdirSync(join(workspace, '.dsh', 'dshmm'), { recursive: true })
process.chdir(workspace)
const mcpJson = join(workspace, '.dsh', 'dshmm', 'mcp.json')
const serverScript = fileURLToPath(new URL('./mcp-test-server.mjs', import.meta.url))

const ctx = new Context()
await ctx.plugin(FakeTools)
const gateway = new McpMgrGateway(ctx, { enabled: true, rescanIntervalMs: 600_000 })

function state() {
  return gateway.snapshot().servers.map(s => `${s.name}:${s.status}${s.error !== undefined ? `(${s.error.slice(0, 60)})` : ''}`)
}

try {
  // 1. first mount
  writeFileSync(mcpJson, JSON.stringify({ mcpServers: { unity: { type: 'stdio', command: process.execPath, args: [serverScript] } } }))
  await gateway.rescan()
  console.log('after first mount:', state())
  if (!gateway.snapshot().servers.some(s => s.name === 'unity' && s.status === 'active')) process.exit(1)

  // 2. config change -> rebuild (the apply path writes the file then rescans)
  const apply1 = await gateway.apply({ workspace, name: 'unity', transport: 'stdio', command: process.execPath, args: [serverScript, '--extra'] })
  console.log('apply rebuild ok:', apply1.ok, '|', state())

  // 3. remove then remount
  const removed = await gateway.removeServer(workspace, 'unity')
  console.log('removed:', removed.ok, '|', state())
  const apply2 = await gateway.apply({ workspace, name: 'unity', transport: 'stdio', command: process.execPath, args: [serverScript] })
  console.log('remount ok:', apply2.ok, '|', state())

  // 4. strict toggle cycle
  await gateway.setStrictMode(true)
  await gateway.setActiveWorkspace('')
  console.log('strict, no active ws:', state())
  await gateway.setActiveWorkspace(workspace)
  console.log('strict, active ws:', state())
  await gateway.setStrictMode(false)
  console.log('non-strict:', state())

  const failed = gateway.snapshot().servers.filter(s => s.status === 'error' || s.status === 'conflict')
  console.log(failed.length === 0 ? 'REPRO CLEAN' : 'REPRO: FAILED ROWS PRESENT')
} finally {
  await ctx.fiber.dispose()
  process.chdir(previousCwd)
  rmSync(workspace, { recursive: true, force: true })
}
