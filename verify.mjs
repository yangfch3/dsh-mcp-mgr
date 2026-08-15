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
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
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

// ── 3. profile entry scan ───────────────────────────────────────────────────
console.log('profile scan:')
{
  const { scanProfileEntries, findProfilePatchFile } = await import(join(root, './packages/dsh-mcp-mgr/lib/types/profile.js'))
  const tmpProfiles = join(root, '.verify-tmp-profiles')
  rmSync(tmpProfiles, { recursive: true, force: true })
  mkdirSync(join(tmpProfiles, 'web'), { recursive: true })
  writeFileSync(join(tmpProfiles, 'web', 'cordis.patch.yml'), '- insert:\n    - id: mcp-deepwiki\n      name: "@deepseek-ai/dsh-mcp-client"\n      config:\n        serverName: deepwiki\n        transport: streamable-http\n        url: https://mcp.deepwiki.com/mcp\n    - id: "mcp-quoted"\n      name: "@deepseek-ai/dsh-mcp-client"\n      config:\n        serverName: quoted\n        transport: stdio\n', 'utf8')
  const entries = [
    // profile patch entry with a live active fiber
    { id: 'mcp-deepwiki', options: { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'deepwiki', transport: 'streamable-http' } }, fiber: { state: 2, await: async () => undefined } },
    // loader-prefixed entry id must fall back to the raw options.id
    { id: 'root:mcp-quoted', options: { id: 'mcp-quoted', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'quoted', transport: 'stdio' } } },
    // entry with a failed fiber (duplicate serverName at runtime)
    { id: 'mcp-dup', options: { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'dup', transport: 'stdio' } }, fiber: { state: 3, await: async () => { throw new Error('duplicate serverName "dup"') } } },
    // declared but not yet loaded
    { id: 'mcp-idle', options: { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'idle', transport: 'streamable-http' } } },
    // name collision with a workspace server
    { id: 'mcp-clash', options: { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'unity', transport: 'streamable-http' } } },
    // not an mcp-client entry
    { id: 'mcp-mgr', options: { name: 'dsh-mcp-mgr' } },
    // disabled mcp-client entry
    { id: 'mcp-off', options: { name: '@deepseek-ai/dsh-mcp-client', disabled: true, config: { serverName: 'off', transport: 'stdio' } } },
    // bare plugin name spelling
    { id: 'mcp-bare', options: { name: 'dsh-mcp-client', config: { serverName: 'bare', transport: 'stdio' } } },
  ]
  const rows = await scanProfileEntries(entries, new Set(['unity']), tmpProfiles)
  check('profile rows exclude non-mcp entries', rows.every(r => r.source === 'profile'))
  check('active fiber -> active', rows.some(r => r.name === 'deepwiki' && r.status === 'active' && r.sourceFile === join(tmpProfiles, 'web', 'cordis.patch.yml')))
  check('failed fiber -> error with message', rows.some(r => r.name === 'dup' && r.status === 'error' && r.error === 'duplicate serverName "dup"'))
  check('no fiber -> configured', rows.some(r => r.name === 'idle' && r.status === 'configured'))
  check('workspace name collision -> conflict', rows.some(r => r.name === 'unity' && r.status === 'conflict'))
  check('disabled entry skipped', !rows.some(r => r.name === 'off'))
  check('bare name spelling included', rows.some(r => r.name === 'bare' && r.transport === 'stdio'))
  check('sorted by name', rows.every((r, i) => i === 0 || rows[i - 1].name <= r.name))
  check('unknown entry has no source file', rows.find(r => r.name === 'idle').sourceFile === undefined)
  check('prefixed id falls back to raw options.id', rows.find(r => r.name === 'quoted')?.sourceFile === join(tmpProfiles, 'web', 'cordis.patch.yml'))
  rmSync(tmpProfiles, { recursive: true, force: true })
}

// ── 4. Remote artifact shape ────────────────────────────────────────────────
console.log('remote artifact:')
{
  const contribution = (await import(join(root, './packages/dsh-mcp-mgr/lib/typert.remote-client.js'))).default
  check('package identity', contribution.package === 'dsh-mcp-mgr')
  check('five methods', contribution.descriptors.length === 5)
  check('removeServer not colliding name', contribution.descriptors.some(d => d.method === 'removeServer') && !contribution.descriptors.some(d => d.method === 'remove'))
  for (const d of contribution.descriptors) {
    check(`strict codec ${d.namespace}/${d.method}`, d.result.mode === 'strict')
  }
  const applyDesc = contribution.descriptors.find(d => d.method === 'apply')
  check('apply has draft parameter', applyDesc.parameters.length === 1 && applyDesc.parameters[0].wire === 'draft')
  const strictDesc = contribution.descriptors.find(d => d.method === 'setStrictMode')
  check('setStrictMode has boolean parameter', strictDesc.parameters.length === 1 && strictDesc.parameters[0].wire === 'enabled')
  const activeDesc = contribution.descriptors.find(d => d.method === 'setActiveWorkspace')
  check('setActiveWorkspace has path parameter', activeDesc.parameters.length === 1 && activeDesc.parameters[0].wire === 'path')
  const snapshotSchema = contribution.descriptors.find(d => d.method === 'snapshot').result.schema
  const parsedSnap = snapshotSchema.parse({ servers: [{ key: 'k', source: 'workspace', workspace: '/w', name: 'n', transport: 'stdio', status: 'active' }], watchedWorkspaces: ['/w'], strictMode: false, activeWorkspace: '' })
  check('snapshot codec accepts payload', parsedSnap.servers[0].name === 'n' && parsedSnap.strictMode === false)
  try {
    snapshotSchema.parse({ servers: [{ key: 'k', source: 'workspace', workspace: '/w', name: 'n', transport: 'bogus', status: 'active' }], watchedWorkspaces: [], strictMode: true, activeWorkspace: '/w' })
    check('snapshot codec rejects bad transport', false)
  } catch { check('snapshot codec rejects bad transport', true) }
  try {
    snapshotSchema.parse({ servers: [{ key: 'k', source: 'profile', name: 'n', transport: 'streamable-http', status: 'configured', sourceFile: '/x/cordis.patch.yml' }], watchedWorkspaces: [], strictMode: false, activeWorkspace: '' })
    check('snapshot codec accepts profile row', true)
  } catch { check('snapshot codec accepts profile row', false) }
}

// ── 4. Real registry mount ──────────────────────────────────────────────────
console.log('registry mount:')
{
  const contribution = (await import(join(root, './packages/dsh-mcp-mgr/lib/typert.remote-client.js'))).default
  const ctx = new Context()
  await ctx.plugin(TypertRegistry)
  const dispose = ctx.typert.remotes.register(contribution)
  const snapshot = contribution.descriptors.find(d => d.method === 'snapshot')
  const result = snapshot.result.schema.parse({ servers: [], watchedWorkspaces: [], strictMode: false, activeWorkspace: '' })
  check('registered and codec-parseable', result.watchedWorkspaces.length === 0)
  dispose()
  await ctx.fiber.dispose()
  check('disposed cleanly', true)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
