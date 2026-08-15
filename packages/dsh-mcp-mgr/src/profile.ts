/**
 * Profile-level MCP server projection: scan the cordis config tree (profile
 * patches, bundles, --patch overlays) for mcp-client registrations and map
 * them to read-only server rows with real runtime status.
 * @module dsh-mcp-mgr/profile
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { McpServerState } from './types.ts'

/** Cordis fiber states (numeric values mirror @deepseek-ai/cordis). */
const FIBER_ACTIVE = 2
const FIBER_FAILED = 3

/** Plugin names matching profile-level mcp-client registrations. */
const MCP_CLIENT_ENTRY_NAMES = new Set(['@deepseek-ai/dsh-mcp-client', 'dsh-mcp-client'])

/** Loader entry view consumed by the profile scan. */
export interface LoaderEntryView {
  readonly id?: string
  readonly options?: {
    readonly id?: string
    readonly name?: unknown
    readonly disabled?: unknown
    readonly config?: { readonly serverName?: string; readonly transport?: string } | undefined
  }
  readonly fiber?: { readonly state?: number; await(): Promise<unknown> }
}

/**
 * Project profile-level mcp-client registrations as read-only server rows.
 * Loader entries carry the resolved config and the live fiber, so status is
 * real: active fiber -> active, failed fiber -> error (e.g. duplicate
 * serverName), otherwise -> configured. Rows colliding with a workspace
 * serverName are flagged conflict.
 */
export async function scanProfileEntries(
  entries: readonly LoaderEntryView[],
  workspaceNames: ReadonlySet<string>,
  profilesDir = defaultProfilesDir(),
): Promise<McpServerState[]> {
  const rows: McpServerState[] = []
  for (const entry of entries) {
    const options = entry.options ?? {}
    if (options.disabled === true) continue
    if (!MCP_CLIENT_ENTRY_NAMES.has(String(options.name))) continue
    const config = options.config
    const name = config?.serverName
    if (name === undefined || config?.transport === undefined) continue
    // Prefer the raw yml id: the loader's `entry.id` getter prefixes parent
    // group ids, which never appear verbatim in the patch file.
    const entryId = String(options.id ?? entry.id)
    const fiber = entry.fiber
    let status: McpServerState['status'] = 'configured'
    let error: string | undefined
    if (fiber !== undefined) {
      if (fiber.state === FIBER_ACTIVE) status = 'active'
      else if (fiber.state === FIBER_FAILED) {
        status = 'error'
        try { await fiber.await() } catch (failure) {
          error = failure instanceof Error ? failure.message : String(failure)
        }
      }
    }
    if (workspaceNames.has(name)) {
      status = 'conflict'
      error = `serverName "${name}" is also used by a workspace mcp.json`
    }
    const sourceFile = findProfilePatchFile(entryId, profilesDir)
    rows.push({
      key: `profile#${entryId}`,
      source: 'profile',
      name,
      transport: config.transport === 'stdio' ? 'stdio' : 'streamable-http',
      status,
      ...(error === undefined ? {} : { error }),
      ...(sourceFile === undefined ? {} : { sourceFile }),
    })
  }
  return rows.sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * Find the profile patch file declaring a loader entry, by scanning every
 * `cordis.patch.yml` under the profiles directory for the entry's raw id.
 * Loader entries do not expose their source file, so this probe is the
 * lightweight stand-in; overlay (--patch) declarations are not found.
 */
export function findProfilePatchFile(entryId: string, profilesDir = defaultProfilesDir()): string | undefined {
  // Entry ids are [A-Za-z0-9_-]; tolerate quoting and spacing variants.
  const idPattern = new RegExp(`id:\\s*['"]?${entryId}(?:['"]|\\s|$)`)
  let profileNames: string[]
  try {
    profileNames = readdirSync(profilesDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch {
    return undefined
  }
  for (const name of profileNames) {
    const patchFile = join(profilesDir, name, 'cordis.patch.yml')
    if (!existsSync(patchFile)) continue
    try {
      if (idPattern.test(readFileSync(patchFile, 'utf8'))) return patchFile
    } catch {
      // unreadable patch file: skip
    }
  }
  return undefined
}

function defaultProfilesDir(): string {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles')
}
