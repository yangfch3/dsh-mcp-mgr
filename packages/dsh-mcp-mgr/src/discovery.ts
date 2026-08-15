/**
 * Workspace discovery: which directories contribute mcp.json files.
 *
 * Web profile: every registered workspace from `ctx.workspaceRegistry`
 * (union semantics — MCP tools are host-global). Headless: the process cwd.
 * The registry appears asynchronously (it waits for session persistence), so
 * callers re-probe on every rescan cycle instead of assuming it at startup.
 * @module dsh-mcp-mgr/discovery
 */

import { existsSync } from 'node:fs'
import { mcpJsonPath } from './parse.ts'

/** One directory that may own a manager file. */
export interface WorkspaceSource {
  readonly path: string
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
  if (registry !== undefined) {
    return registry.list().map(workspace => ({ path: workspace.path }))
  }
  return [{ path: process.cwd() }]
}

/** Whether a workspace currently carries a readable manager file. */
export function hasManagerFile(workspacePath: string): boolean {
  return existsSync(mcpJsonPath(workspacePath))
}
