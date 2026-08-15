/**
 * dsh-mcp-mgr: workspace-level MCP manager for DeepSeek Harness.
 *
 * Discovers `.dsh/dshmm/mcp.json` under every registered workspace (or the
 * process cwd in headless), maps its `mcpServers` entries to
 * `@deepseek-ai/dsh-mcp-client` configs, and dynamically mounts one plugin
 * instance per server. File changes and periodic rescans keep the live set in
 * sync. A Typert Remote (`mcpMgr`) serves state and write-back to the web UI.
 * @module dsh-mcp-mgr
 */

import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// The mcp-client plugin object; dynamically mounted one instance per server.
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import { collectWorkspaces, hasManagerFile } from './discovery.ts'
import { draftToEntry, mcpJsonPath, parseMcpJson, type ParsedServer } from './parse.ts'
import { McpSync } from './sync.ts'
import { createFileWatcher } from './watch.ts'
import type { McpApplyResult, McpManagerSnapshot, McpServerDraft } from './types.ts'

export type * from './types.ts'
export { parseMcpJson, mcpJsonPath, expandEnv } from './parse.ts'
export { McpSync } from './sync.ts'
export type { McpInstance, InstanceFactory } from './sync.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'mcp-mgr'

/** The manager's Remote namespace. */
export const REMOTE_NAMESPACE = 'mcpMgr'

/** Plugin configuration supplied through cordis.yml. */
export interface Config {
  /** Master switch for workspace discovery. */
  enabled: boolean
  /** Periodic rescan interval covering workspaces added at runtime. */
  rescanIntervalMs: number
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  rescanIntervalMs: Schema.number().min(1000).max(3600_000).default(10_000),
})

/** mcp-client plugin object passed to `ctx.plugin` per server. */
const MCP_CLIENT_PLUGIN = {
  name: mcpClient.name,
  inject: mcpClient.inject,
  apply: mcpClient.apply,
}

/**
 * The manager service: owns discovery, sync, and the Remote surface.
 * `workspaceRegistry` is deliberately NOT injected — it is a web-only service
 * that appears asynchronously; discovery re-probes on every rescan.
 */
export class McpMgrGateway extends TypertRemoteService {
  private readonly sync: McpSync
  private readonly fileWatcher = createFileWatcher(
    (handler, ms) => setTimeout(handler, ms),
    handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  )
  private readonly rescanTimer: ReturnType<typeof setInterval>
  private readonly parseCache = new Map<string, readonly ParsedServer[]>()
  private readonly workspaceSet = new Set<string>()
  private rescanning = false

  constructor(ctx: Context, config: Config) {
    super(ctx, 'mcpMgr')
    this.sync = new McpSync(
      {
        create: async config => ctx.plugin(MCP_CLIENT_PLUGIN, config),
        dispose: fiber => (fiber as { dispose(): Promise<void> }).dispose(),
      },
      { onChange: () => this.emitChange() },
    )
    this.rescanTimer = setInterval(() => {
      void this.rescan()
    }, config.rescanIntervalMs)
    ctx.effect(() => () => {
      this.fileWatcher.dispose()
      clearInterval(this.rescanTimer)
    }, 'mcp-mgr: cleanup')
    void this.rescan()
  }

  /** Full current projection for the UI. */
  @Remote('snapshot')
  snapshot(): McpManagerSnapshot {
    return {
      servers: this.sync.snapshot(),
      watchedWorkspaces: [...this.workspaceSet].sort(),
    }
  }

  /** Create or update one server entry in a workspace's mcp.json. */
  @Remote('apply')
  apply(draft: McpServerDraft): McpApplyResult {
    const path = mcpJsonPath(draft.workspace)
    if (!hasManagerFile(draft.workspace)) {
      return { ok: false, error: `no mcp.json under ${draft.workspace}` }
    }
    let document: { mcpServers?: Record<string, unknown> }
    try {
      document = JSON.parse(readFileSync(path, 'utf8')) as { mcpServers?: Record<string, unknown> }
    } catch (error) {
      return { ok: false, error: `unreadable mcp.json: ${String(error instanceof Error ? error.message : error)}` }
    }
    if (document === null || typeof document !== 'object' || Array.isArray(document)) {
      return { ok: false, error: 'mcp.json must contain a JSON object' }
    }
    const servers = document.mcpServers ?? {}
    if (typeof servers !== 'object' || Array.isArray(servers)) {
      return { ok: false, error: 'mcpServers must be an object' }
    }
    servers[draft.name] = draftToEntry(draft)
    document.mcpServers = servers
    try {
      atomicWriteJson(path, document)
    } catch (error) {
      return { ok: false, error: `write failed: ${String(error instanceof Error ? error.message : error)}` }
    }
    return { ok: true }
  }

  /**
   * Remove one server entry from a workspace's mcp.json.
   * Named `removeServer`: `remove` collides with the client gateway's
   * RemoteNamespaceService prototype method and fails contribution mounts.
   */
  @Remote('removeServer')
  removeServer(workspace: string, serverName: string): McpApplyResult {
    const path = mcpJsonPath(workspace)
    if (!hasManagerFile(workspace)) {
      return { ok: false, error: `no mcp.json under ${workspace}` }
    }
    try {
      const document = JSON.parse(readFileSync(path, 'utf8')) as { mcpServers?: Record<string, unknown> }
      if (document.mcpServers !== undefined && typeof document.mcpServers === 'object') {
        delete (document.mcpServers as Record<string, unknown>)[serverName]
        if (Object.keys(document.mcpServers as Record<string, unknown>).length === 0) {
          delete document.mcpServers
        }
      }
      atomicWriteJson(path, document)
    } catch (error) {
      return { ok: false, error: `write failed: ${String(error instanceof Error ? error.message : error)}` }
    }
    return { ok: true }
  }

  /** One full discovery + sync pass. */
  async rescan(): Promise<void> {
    if (this.rescanning) return
    this.rescanning = true
    try {
      const workspaces = collectWorkspaces(this.ctx)
      const next = new Set(workspaces.map(workspace => workspace.path))
      const removed = [...this.workspaceSet].filter(path => !next.has(path))
      for (const path of removed) {
        this.workspaceSet.delete(path)
        this.parseCache.delete(path)
        await this.sync.removeWorkspace(path)
      }
      const watchFiles: string[] = []
      for (const workspace of workspaces) {
        if (!hasManagerFile(workspace.path)) continue
        watchFiles.push(mcpJsonPath(workspace.path))
        const cached = this.parseCache.get(workspace.path)
        if (cached !== undefined) continue
        this.parseCache.set(workspace.path, this.readWorkspace(workspace.path))
      }
      this.fileWatcher.setWatchFiles(watchFiles, () => {
        this.parseCache.clear()
        void this.rescan()
      })
      for (const path of next) this.workspaceSet.add(path)
      for (const path of [...next].sort()) {
        const servers = this.parseCache.get(path)
        if (servers === undefined) continue
        await this.sync.syncWorkspace({ workspacePath: path, servers })
      }
    } finally {
      this.rescanning = false
    }
  }

  private readWorkspace(workspacePath: string): readonly ParsedServer[] {
    const path = mcpJsonPath(workspacePath)
    try {
      const parsed = parseMcpJson(readFileSync(path, 'utf8'), workspacePath)
      for (const error of parsed.errors) {
        this.ctx.logger.warn(`mcp-mgr: ${workspacePath}: ${error.name}: ${error.message}`)
      }
      return parsed.servers
    } catch (error) {
      this.ctx.logger.warn(`mcp-mgr: cannot read ${path}: ${String(error instanceof Error ? error.message : error)}`)
      return []
    }
  }

  private emitChange(): void {
    // The client subscribes through the forwarded-event allowlist; no direct
    // host-side delivery needed today (the UI polls snapshot on demand).
  }
}

function atomicWriteJson(path: string, document: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = join(dirname(path), `.mcp.json.tmp-${process.pid}`)
  writeFileSync(tmp, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
  renameSync(tmp, path)
}

/**
 * Plugin entry: register the gateway service.
 *
 * No default export: the loader's `unwrapExports` picks `exports.default`
 * when present, which would strip `Config` off the module namespace. A
 * namespace-shaped plugin (`name`/`inject`/`apply`/`Config` exports) is the
 * loader's object form.
 */
export function apply(ctx: Context, config: Config): void {
  if (!config.enabled) return
  new McpMgrGateway(ctx, config)
}
