/**
 * Workspace discovery: which directories contribute mcp.json files.
 *
 * Web profile: every registered workspace from `ctx.workspaceRegistry`
 * (union semantics — MCP tools are host-global). Headless: the process cwd.
 * The registry appears asynchronously (it waits for session persistence), so
 * callers re-probe on every rescan cycle instead of assuming it at startup.
 * @module dsh-mcp-mgr/discovery
 */

import { existsSync, realpathSync } from 'node:fs'
import { mcpJsonPath } from './parse.ts'

/** One directory that may own mcp.json. */
export interface WorkspaceSource {
  readonly path: string
}

/**
 * Canonicalize a workspace directory for comparisons and file mutations.
 * A missing directory is kept as an absolute path so discovery remains
 * deterministic; mutation callers still require realpath success.
 */
export function canonicalWorkspacePath(workspacePath: string): string {
  try {
    return realpathSync(workspacePath)
  } catch {
    return workspacePath
  }
}

/**
 * Read the current workspace set from a Cordis context.
 *
 * Uses `ctx.get` (never property access): un-injected service properties
 * throw under Cordis's inject guard, and `workspaceRegistry` is deliberately
 * not injected because it only exists in the web profile.
 */
export function collectWorkspaces(ctx: unknown): WorkspaceSource[] {
  const registry = (ctx as { get?: (name: string) => unknown }).get?.('workspaceRegistry') as
    | { list(): readonly { path: string }[] }
    | undefined
  const paths = registry === undefined
    ? [process.cwd()]
    : registry.list().map(workspace => workspace.path)
  return paths.map(path => ({ path: canonicalWorkspacePath(path) }))
}

/** Whether a workspace currently carries a readable manager file. */
export function hasManagerFile(workspacePath: string): boolean {
  return existsSync(mcpJsonPath(workspacePath))
}
