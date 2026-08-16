/**
 * Public payload types of the dsh-mcp-mgr Remote surface and internal state.
 * @module dsh-mcp-mgr/types
 */

/** Where one MCP server registration comes from. */
export type McpServerSource = 'workspace' | 'profile'

/** Model-visible lifecycle status of one dynamically registered MCP server. */
export type McpServerStatus =
  | 'connecting'
  | 'active'
  | 'error'
  | 'conflict'
  | 'removing'
  | 'configured'

/** One dynamically registered MCP server as seen by the UI. */
export interface McpServerState {
  /** Stable instance key: `<workspacePath>#<serverName>` for workspace rows, `profile#<entryId>` for profile rows. */
  readonly key: string
  /** Registration origin: workspace mcp.json or a profile-level config entry. */
  readonly source: McpServerSource
  /** serverName namespace (also the mcp.json entry name). */
  readonly name: string
  readonly transport: 'stdio' | 'streamable-http'
  readonly status: McpServerStatus
  /** Human-readable failure text when status is error/conflict. */
  readonly error?: string
  /**
   * Workspace instances only: whether real connectivity was probed at mount
   * (the server's tools are registered). Absent for profile rows.
   */
  readonly connected?: boolean
  /** Why the connectivity probe could not run/complete (workspace rows only). */
  readonly probeError?: string
  /** Workspace source only: directory that contributed this server. */
  readonly workspace?: string
  /** Profile source only: config file declaring the entry. */
  readonly sourceFile?: string
}

/** Full manager projection served to the UI. */
export interface McpManagerSnapshot {
  readonly servers: readonly McpServerState[]
  /** Workspace directories currently being discovered. */
  readonly watchedWorkspaces: readonly string[]
  /** Strict mode: only the active workspace's servers are mounted. */
  readonly strictMode: boolean
  /** Strict-mode target: the workspace the web client currently has selected ('' when none). */
  readonly activeWorkspace: string
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
