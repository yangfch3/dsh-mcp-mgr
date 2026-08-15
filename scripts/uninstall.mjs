#!/usr/bin/env node
/**
 * Uninstall dsh-mcp-mgr from a dsh profile.
 *
 * 1. Remove the two package symlinks from $DSH_HOME/profiles/node_modules.
 * 2. Remove the two loader rows from $DSH_HOME/profiles/<name>/cordis.patch.yml
 *    by exact text block; unrelated user edits are preserved, and a patch that
 *    only held our rows is restored to the template `[]`.
 *
 * Idempotent. Usage: node scripts/uninstall.mjs [--profile <name>]
 */
import { existsSync, lstatSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

// ── 1. Remove symlinks ──────────────────────────────────────────────────────
const fallbackDir = join(dshHome, 'profiles', 'node_modules')
for (const pkg of PACKAGES) {
  const link = join(fallbackDir, pkg)
  const stat = lstatSync(link, { throwIfNoEntry: false })
  if (stat === undefined) continue
  if (!stat.isSymbolicLink()) {
    console.error(`uninstall: ${link} is not a symlink — left untouched`)
    continue
  }
  rmSync(link)
  console.log(`removed link ${pkg}`)
}

// ── 2. Remove patch rows ────────────────────────────────────────────────────
const patchPath = join(dshHome, 'profiles', profile, 'cordis.patch.yml')
if (!existsSync(patchPath)) {
  console.log(`no patch file: ${patchPath} (nothing to do)`)
} else {
  const original = readFileSync(patchPath, 'utf8')
  const blockIndex = original.indexOf(PATCH_BLOCK)
  if (blockIndex < 0) {
    console.log(`patch contains no dsh-mcp-mgr rows: ${patchPath} (skipped)`)
  } else {
    const without = original.replace(PATCH_BLOCK, '').trimEnd()
    // A patch that only held our rows (or only comments) goes back to [].
    const hasContent = without.split('\n').some(line => line.trim().length > 0 && !line.trim().startsWith('#'))
    const next = hasContent ? `${without}\n` : `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; ` + '`!!js`' + ` expressions allowed).
[]
`
    writeFileSync(patchPath, next, 'utf8')
    console.log(`removed loader rows from ${patchPath}`)
  }
}

console.log('\nUninstall done. Restart dsh web to apply.')
