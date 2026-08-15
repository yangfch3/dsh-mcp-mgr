#!/usr/bin/env node
/**
 * Install dsh-mcp-mgr into a dsh profile.
 *
 * 1. Symlink the two packages into $DSH_HOME/profiles/node_modules (the
 *    cross-profile fallback resolution directory).
 * 2. Insert the two loader rows into $DSH_HOME/profiles/<name>/cordis.patch.yml.
 *
 * Idempotent: re-running updates symlinks and skips an already-present patch.
 * The patch file is edited by exact text blocks, so unrelated user edits are
 * preserved. Requires built artifacts; run the build first if missing.
 *
 * Usage: node scripts/install.mjs [--profile <name>]   (default profile: web)
 */
import {
  existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const home = process.env.HOME ?? ''
const dshHome = process.env.DSH_HOME ?? join(home, '.dsh')
const profileArg = process.argv.indexOf('--profile')
const profile = profileArg >= 0 ? process.argv[profileArg + 1] : 'web'

const PACKAGES = ['dsh-mcp-mgr', 'dsh-mcp-mgr-ui']
const PATCH_BLOCK = `- insert:
    - id: mcp-mgr
      name: dsh-mcp-mgr
    - id: ui-mcp-mgr
      name: dsh-mcp-mgr-ui
`
const PATCH_TEMPLATE = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; ` + '`!!js`' + ` expressions allowed).
[]`

function fail(message) {
  console.error(`install: ${message}`)
  process.exit(1)
}

// ── 0. Preconditions ────────────────────────────────────────────────────────
if (!existsSync(dshHome)) fail(`DSH_HOME not found: ${dshHome}`)
if (!existsSync(join(dshHome, 'profiles', profile))) {
  fail(`profile "${profile}" not found under ${dshHome}/profiles`)
}
for (const pkg of PACKAGES) {
  const built = join(repoRoot, 'packages', pkg, 'lib', pkg === 'dsh-mcp-mgr' ? 'types/index.js' : 'client.js')
  if (!existsSync(built)) {
    fail(`${pkg} is not built (missing ${built}); build first: tsc -p packages/${pkg} + gen.mjs / tsdown`)
  }
}

// ── 1. Symlink packages ─────────────────────────────────────────────────────
const fallbackDir = join(dshHome, 'profiles', 'node_modules')
mkdirSync(fallbackDir, { recursive: true })
for (const pkg of PACKAGES) {
  const link = join(fallbackDir, pkg)
  const target = join(repoRoot, 'packages', pkg)
  if (lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink() ?? false) {
    rmSync(link)
  } else if (existsSync(link)) {
    fail(`${link} exists and is not a symlink — remove it manually first`)
  }
  symlinkSync(target, link)
  console.log(`linked ${pkg} -> ${target}`)
}

// ── 2. Patch the profile ────────────────────────────────────────────────────
const patchPath = join(dshHome, 'profiles', profile, 'cordis.patch.yml')
const original = readFileSync(patchPath, 'utf8')
if (original.includes('dsh-mcp-mgr')) {
  console.log(`patch already contains dsh-mcp-mgr rows: ${patchPath} (skipped)`)
} else {
  const trimmed = original.trimEnd()
  const isTemplate = trimmed === PATCH_TEMPLATE || trimmed === '[]'
  const next = isTemplate ? PATCH_BLOCK : `${trimmed}\n\n${PATCH_BLOCK}`
  writeFileSync(patchPath, next, 'utf8')
  console.log(`patched ${patchPath} with ${PACKAGES.length} loader rows`)
}

console.log('\nInstall done. Restart dsh web (profile HMR is off):')
console.log('  cd <deepseek-harness checkout> && pnpm dsh web')
