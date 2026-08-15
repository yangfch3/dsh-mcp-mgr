/**
 * dsh-mcp-mgr end-to-end verification with a fake mcp-client factory:
 *  1. parse mcp.json documents (incl. ${VAR} expansion and rejections)
 *  2. sync lifecycle: create / update / remove / conflict / error paths
 *  3. Remote artifact shape (strict codecs)
 *  4. real Typert registry mount of the generated contribution
 */
import { Context } from '/Users/fuchee/Documents/Program/PlayGround/deepseek-harness/vendor/cordis/lib/index.js'
import TypertRegistry from '/Users/fuchee/Documents/Program/PlayGround/deepseek-harness/packages/typert/registry/lib/index.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseMcpJson, expandEnv } from './packages/dsh-mcp-mgr/lib/types/parse.js'
import { McpSync } from './packages/dsh-mcp-mgr/lib/types/sync.js'

const root = dirname(fileURLToPath(import.meta.url))
let failures = 0
function check(label, condition, detail = '') {
  if (condition) console.log(`  ok: ${label}`)
  else { failures += 1; console.error(`  FAIL: ${label} ${detail}`) }
}

// ── 1. parse ────────────────────────────────────────────────────────────────
console.log('parse:')
{
  const doc = JSON.stringify({
    mcpServers: {
      memory: { type: 'stdio', command: 'npx', args: ['-y', 'mcp-memory'], env: { TOKEN: '${MCP_TEST_TOKEN}' }, cwd: '/tmp/srv' },
      web: { type: 'http', url: 'http://localhost:3000/mcp', headers: { Authorization: 'Bearer x' } },
      'bad.name': { command: 'x' },
      missingCmd: { type: 'stdio' },
      brokenEnv: { type: 'stdio', command: 'x', env: { K: '${MCP_TEST_MISSING_VAR}' } },
    },
  })
  process.env.MCP_TEST_TOKEN = 'tok-123'
  const parsed = parseMcpJson(doc, '/ws/a')
  check('stdio mapped with expansion', parsed.servers.some(s => s.name === 'memory' && s.config.transport === 'stdio' && s.config.env.TOKEN === 'tok-123' && s.config.cwd === '/tmp/srv'))
  check('http mapped', parsed.servers.some(s => s.name === 'web' && s.config.transport === 'streamable-http' && s.config.headers.Authorization === 'Bearer x'))
  const stdio = parsed.servers.find(s => s.name === 'memory')
  check('stdio cwd explicit wins', stdio?.config.cwd === '/tmp/srv')
  const http = parsed.servers.find(s => s.name === 'web')
  check('http config shape', http !== undefined && http.config.cwd === undefined)
  check('bad name rejected', parsed.errors.some(e => e.name === 'bad.name'))
  check('missing command rejected', parsed.errors.some(e => e.name === 'missingCmd'))
  check('missing env rejected', parsed.errors.some(e => e.name === 'brokenEnv'))
  check('expandEnv literal passthrough', expandEnv('hello', 'x').ok && expandEnv('hello', 'x').value === 'hello')
  delete process.env.MCP_TEST_TOKEN
}

// ── 2. sync lifecycle (fake factory) ────────────────────────────────────────
console.log('sync:')
{
  const created = []
  const disposed = []
  const fake = {
    create: async config => { created.push(config.serverName); return { id: config.serverName } },
    dispose: async fiber => { disposed.push(fiber.id) },
  }
  const sync = new McpSync(fake, { onChange: () => undefined })
  const srv = (name, command) => ({ name, config: { transport: 'stdio', serverName: name, command, args: [], env: {}, cwd: '/ws', toolCallTimeoutMs: 60000, failOnStartupError: false } })
  await sync.syncWorkspace({ workspacePath: '/ws', servers: [srv('a', 'cmd-a'), srv('b', 'cmd-b')] })
  check('two instances created', created.length === 2 && created.includes('a') && created.includes('b'))
  check('both active', sync.snapshot().every(s => s.status === 'active'))
  // unchanged config: no churn
  await sync.syncWorkspace({ workspacePath: '/ws', servers: [srv('a', 'cmd-a'), srv('b', 'cmd-b')] })
  check('no churn on identical config', created.length === 2)
  // changed config: rebuild
  await sync.syncWorkspace({ workspacePath: '/ws', servers: [srv('a', 'cmd-a2'), srv('b', 'cmd-b')] })
  check('changed server rebuilt', created.length === 3 && disposed.includes('a'))
  // removal
  await sync.syncWorkspace({ workspacePath: '/ws', servers: [srv('a', 'cmd-a2')] })
  check('removed server disposed', disposed.includes('b') && sync.snapshot().length === 1)
  // cross-workspace conflict
  await sync.syncWorkspace({ workspacePath: '/ws2', servers: [srv('a', 'other')] })
  const conflict = sync.snapshot().find(s => s.key === '/ws2#a')
  check('conflict flagged', conflict?.status === 'conflict' && conflict.error !== undefined)
  check('conflict not mounted', created.length === 3)
  // create failure
  const failing = new McpSync({ create: async () => { throw new Error('boom') }, dispose: async () => undefined }, { onChange: () => undefined })
  await failing.syncWorkspace({ workspacePath: '/ws', servers: [srv('z', 'x')] })
  const failed = failing.snapshot().find(s => s.name === 'z')
  check('create failure recorded', failed?.status === 'error' && failed.error === 'boom')
  // workspace removal
  await sync.removeWorkspace('/ws2')
  check('conflict workspace removed', sync.snapshot().every(s => s.workspace === '/ws'))
}

// ── 3. Remote artifact shape ────────────────────────────────────────────────
console.log('remote artifact:')
{
  const contribution = (await import(join(root, './packages/dsh-mcp-mgr/lib/typert.remote-client.js'))).default
  check('package identity', contribution.package === 'dsh-mcp-mgr')
  check('three methods', contribution.descriptors.length === 3)
  check('removeServer not colliding name', contribution.descriptors.some(d => d.method === 'removeServer') && !contribution.descriptors.some(d => d.method === 'remove'))
  for (const d of contribution.descriptors) {
    check(`strict codec ${d.namespace}/${d.method}`, d.result.mode === 'strict')
  }
  const applyDesc = contribution.descriptors.find(d => d.method === 'apply')
  check('apply has draft parameter', applyDesc.parameters.length === 1 && applyDesc.parameters[0].wire === 'draft')
  const snapshotSchema = contribution.descriptors.find(d => d.method === 'snapshot').result.schema
  const parsedSnap = snapshotSchema.parse({ servers: [{ key: 'k', workspace: '/w', name: 'n', transport: 'stdio', status: 'active' }], watchedWorkspaces: ['/w'] })
  check('snapshot codec accepts payload', parsedSnap.servers[0].name === 'n')
  try {
    snapshotSchema.parse({ servers: [{ key: 'k', workspace: '/w', name: 'n', transport: 'bogus', status: 'active' }], watchedWorkspaces: [] })
    check('snapshot codec rejects bad transport', false)
  } catch { check('snapshot codec rejects bad transport', true) }
}

// ── 4. Real registry mount ──────────────────────────────────────────────────
console.log('registry mount:')
{
  const contribution = (await import(join(root, './packages/dsh-mcp-mgr/lib/typert.remote-client.js'))).default
  const ctx = new Context()
  await ctx.plugin(TypertRegistry)
  const dispose = ctx.typert.remotes.register(contribution)
  const snapshot = contribution.descriptors.find(d => d.method === 'snapshot')
  const result = snapshot.result.schema.parse({ servers: [], watchedWorkspaces: [] })
  check('registered and codec-parseable', result.watchedWorkspaces.length === 0)
  dispose()
  await ctx.fiber.dispose()
  check('disposed cleanly', true)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
