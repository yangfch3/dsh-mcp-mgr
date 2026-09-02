import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const action = process.argv[2]

function fail(message, code = 2) {
  console.error(`profile: ${message}`)
  process.exit(code)
}

if (action !== 'add' && action !== 'remove') {
  fail('usage: node scripts/profile.mjs <add|remove>')
}

const configuredRoot = process.env.DSH_HARNESS_ROOT?.trim()
if (configuredRoot === undefined || configuredRoot === '') {
  fail('DSH_HARNESS_ROOT must point to a deepseek-harness source checkout')
}
if (!isAbsolute(configuredRoot)) {
  fail('DSH_HARNESS_ROOT must be an absolute path')
}

const harnessRoot = resolve(configuredRoot)
const harnessManifestPath = join(harnessRoot, 'package.json')
if (!existsSync(harnessManifestPath) || !statSync(harnessManifestPath).isFile()) {
  fail(`source checkout not found at ${harnessRoot}`)
}

let harnessManifest
try {
  harnessManifest = JSON.parse(readFileSync(harnessManifestPath, 'utf8'))
} catch (error) {
  fail(`cannot read ${harnessManifestPath}: ${error instanceof Error ? error.message : String(error)}`)
}
if (typeof harnessManifest?.scripts?.dsh !== 'string' || !existsSync(join(harnessRoot, 'apps', 'cli', 'src', 'bin.ts'))) {
  fail(`${harnessRoot} is not a supported deepseek-harness source checkout`)
}

const uiRoot = join(repoRoot, 'packages', 'dsh-mcp-mgr-ui')
const hostRoot = join(repoRoot, 'packages', 'dsh-mcp-mgr')
for (const packageRoot of [uiRoot, hostRoot]) {
  const manifestPath = join(packageRoot, 'package.json')
  if (!existsSync(manifestPath)) fail(`plugin package not found at ${packageRoot}`)
}

const args = ['dsh', 'plugin', '--profile', 'web', action]
if (action === 'add') {
  args.push(uiRoot, hostRoot)
} else {
  args.push('dsh-mcp-mgr', 'dsh-mcp-mgr-ui')
}

const command = 'pnpm'
const result = spawnSync(command, args, {
  cwd: harnessRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (result.error !== undefined) {
  fail(`failed to start ${command}: ${result.error.message}`, 127)
}
process.exit(result.status ?? 1)
