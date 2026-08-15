/**
 * Compile-time stub of `@deepseek-ai/dsh-mcp-client`.
 *
 * Importing the real package's declarations drags its transitive d.ts chain
 * (session, agent, …) into the Typert analysis program, where their
 * `declare module '@deepseek-ai/dsh-typert-protocol'` augmentations fail the
 * cross-package symbol checks. Runtime resolution is untouched: the compiled
 * output still imports the real specifier, which Node resolves through the
 * workspace node_modules links.
 */

/** Plugin name used by loader diagnostics. */
export const name: string

/** Services required by this plugin. */
export const inject: readonly string[]

/** Mount one MCP server instance. */
export function apply(ctx: unknown, config: unknown): Promise<void>

/** Reconnect policy after a lost connection. */
export interface ReconnectConfig {
  enabled: boolean
  initialDelayMs: number
  maxDelayMs: number
  maxAttempts: number
}

/** Config for a stdio MCP server. */
export interface StdioConfig {
  transport: 'stdio'
  serverName: string
  command: string
  args: string[]
  env: Record<string, string>
  cwd: string
  toolCallTimeoutMs: number
  failOnStartupError: boolean
  reconnect?: ReconnectConfig
}

/** Config for a streamable-http MCP server. */
export interface StreamableHttpConfig {
  transport: 'streamable-http'
  serverName: string
  url: string
  headers: Record<string, string>
  toolCallTimeoutMs: number
  failOnStartupError: boolean
  reconnect?: ReconnectConfig
}

/** One stdio or streamable-http server configuration. */
export type Config = StdioConfig | StreamableHttpConfig
