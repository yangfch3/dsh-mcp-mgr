/**
 * Public payload types of the dsh-mcp-mgr Remote surface and internal state.
 * @module dsh-mcp-mgr/types
 */

/** Model-visible lifecycle status of one dynamically registered MCP server. */
export type McpServerStatus =
  | 'connecting'
  | 'active'
  | 'error'
  | 'conflict'
  | 'removing'

/** One dynamically registered MCP server as seen by the UI. */
export interface McpServerState {
  /** Stable instance key: `<workspacePath>#<serverName>`. */
  readonly key: string
  /** Workspace directory that contributed this server. */
  readonly workspace: string
  /** serverName namespace (also the mcp.json entry name). */
  readonly name: string
  readonly transport: 'stdio' | 'streamable-http'
  readonly status: McpServerStatus
  /** Human-readable failure text when status is error/conflict. */
  readonly error?: string
}

/** Full manager projection served to the UI. */
export interface McpManagerSnapshot {
  readonly servers: readonly McpServerState[]
  /** Workspace directories currently being discovered. */
  readonly watchedWorkspaces: readonly string[]
}

/** One server entry for create/update through the Remote. */
export interface McpServerDraft {
  /** Workspace directory owning the mcp.json to write. */
  readonly workspace: string
  /** serverName namespace; must match `[A-Za-z0-9_-]{1,32}`. */
  readonly name: string
  readonly transport: 'stdio' | 'streamable-http'
  /** stdio transport: executable. */
  readonly command?: string
  /** stdio transport: arguments. */
  readonly args?: readonly string[]
  /** stdio transport: extra env merged over the scrubbed ambient env. */
  readonly env?: Readonly<Record<string, string>>
  /** http transport: MCP endpoint URL. */
  readonly url?: string
  /** http transport: extra headers. */
  readonly headers?: Readonly<Record<string, string>>
  /** Child working directory; defaults to the workspace root. */
  readonly cwd?: string
}

export type McpApplyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string }
