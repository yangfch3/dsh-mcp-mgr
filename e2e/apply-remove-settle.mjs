/**
 * Regression: after apply / removeServer resolve, the gateway snapshot is
 * already settled — no stale list after add or remove. Guards the parse-cache
 * invalidation (keyed by the canonical path) + resync-before-return contract.
 */
import { Context, Service } from '/Users/fuchee/Documents/Program/PlayGround/deepseek-harness/vendor/cordis/lib/index.js'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpMgrGateway } from '../packages/dsh-mcp-mgr/lib/types/index.js'

class FakeTools extends Service {
  constructor(ctx) { super(ctx, 'tools') }
  get() { return undefined }
  register() {}
  unregister() {}
  schemas() { return [] }
  execute() { throw new Error('unused') }
}

let failures = 0
function check(label, condition) {
  console.log(condition ? `  ok: ${label}` : `  FAIL: ${label}`)
  if (!condition) failures += 1
}

const workspace = `${process.env.TMPDIR ?? '/tmp'}/dsh-mcp-mgr-settle-${process.pid}`
rmSync(workspace, { recursive: true, force: true })
mkdirSync(join(workspace, '.dsh', 'dshmm'), { recursive: true })
process.chdir(workspace)

const serverScript = fileURLToPath(new URL('./mcp-test-server.mjs', import.meta.url))

const ctx = new Context()
await ctx.plugin(FakeTools)
const gateway = new McpMgrGateway(ctx, { enabled: true, rescanIntervalMs: 600_000 })
try {
  const first = await gateway.apply({
    workspace,
    name: 'probe',
    transport: 'stdio',
    command: process.execPath,
    args: [serverScript],
  })
  check('first apply ok', first.ok)
  check('first server present after apply resolves', gateway.snapshot().servers.some(s => s.name === 'probe'))

  // Apply a second server onto the now-existing file (the real app scenario).
  const second = await gateway.apply({
    workspace,
    name: 'second',
    transport: 'streamable-http',
    url: 'http://localhost:1/mcp',
  })
  check('second apply ok', second.ok)
  check('second server present after apply resolves', gateway.snapshot().servers.some(s => s.name === 'second'))

  const removed = await gateway.removeServer(workspace, 'probe')
  check('removeServer ok', removed.ok)
  check('removed server gone after removeServer resolves', !gateway.snapshot().servers.some(s => s.name === 'probe'))
} finally {
  await ctx.fiber.dispose()
  rmSync(workspace, { recursive: true, force: true })
}

console.log(failures === 0 ? 'SETTLE PASS' : `${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
