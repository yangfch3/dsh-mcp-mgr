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
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { readFileSync, writeFileSync, mkdirSync, renameSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import { collectWorkspaces, hasManagerFile } from './discovery.ts'
import { draftToEntry, mcpJsonPath, parseMcpJson, validateDraft, type ParsedServer } from './parse.ts'
import { profileServerNames, scanProfileEntries, type LoaderEntryView } from './profile.ts'
import { McpSync } from './sync.ts'
import { createFileWatcher } from './watch.ts'
import { checkPluginVersion } from './version.ts'
import type { McpApplyResult, McpManagerSnapshot, McpPluginVersionInfo, McpServerDraft, McpServerState } from './types.ts'

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
  /** Startup npm update check (fires once; never rejects). */
  private readonly versionCheck: Promise<McpPluginVersionInfo>
  private profileServers: readonly McpServerState[] = []
  private rescanning = false
  /** Strict mode: only {@link activeWorkspace}'s servers are mounted. */
  private strictMode = false
  /** Workspace path the web client currently has selected; '' = none. */
  private activeWorkspace = ''
  /** Serialized rescan chain so Remote-triggered passes apply in order. */
  private rescanChain: Promise<void> = Promise.resolve()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'mcpMgr')
    this.sync = new McpSync(
      {
        create: async config => {
          const fiber = await ctx.plugin(MCP_CLIENT_PLUGIN, config)
          // Activation awaits the initial connect + tool discovery: tools
          // registered under the server namespace prove real connectivity,
          // while a failed connect activates with no tools. The probe must
          // never reject create — a rejected create would leak the already
          // activated fiber (its serverName stays held) and the next mount
          // of the same name would fail as a duplicate. Any probe failure is
          // surfaced on the row so a silent "registered" is explainable.
          let connected = false
          let probeError: string | undefined
          const tools = (ctx as { get?: (name: string) => unknown }).get?.('tools')
          if (tools === undefined) {
            probeError = 'tools service not accessible'
          } else {
            try {
              connected = serverHasTools(ctx, config.serverName)
            } catch (error) {
              probeError = String(error instanceof Error ? error.message : error)
            }
          }
          if (probeError !== undefined) {
            ctx.logger.warn(`mcp-mgr: connectivity probe failed for ${config.serverName}: ${probeError}`)
          }
          return { fiber, connected, ...(probeError === undefined ? {} : { probeError }) }
        },
        dispose: fiber => (fiber as { dispose(): Promise<void> }).dispose(),
      },
      { onChange: () => this.emitChange() },
    )
    this.rescanTimer = setInterval(() => {
      void this.runRescan()
    }, config.rescanIntervalMs)
    // Self-update check on startup; failures are silent by design.
    this.versionCheck = checkPluginVersion()
    void this.versionCheck.then(info => {
      if (info.updateAvailable) {
        ctx.logger.info(`mcp-mgr: update available: ${info.localVersion} -> ${info.latestVersion} (${info.updateUrl})`)
      } else if (info.latestVersion === '') {
        ctx.logger.warn('mcp-mgr: plugin update check failed (npm registry unreachable)')
      }
    })
    ctx.effect(() => () => {
      this.fileWatcher.dispose()
      clearInterval(this.rescanTimer)
    }, 'mcp-mgr: cleanup')
    void this.runRescan()
  }

  /**
   * Self-update check result (startup npm lookup). Awaits the in-flight
   * check so the first UI load is deterministic; the check itself never
   * rejects, so this resolves as soon as the lookup settles.
   */
  @Remote('versionInfo')
  async versionInfo(): Promise<McpPluginVersionInfo> {
    return this.versionCheck
  }

  /** Full current projection for the UI. */
  @Remote('snapshot')
  snapshot(): McpManagerSnapshot {
    return {
      servers: [...this.sync.snapshot(), ...this.profileServers],
      watchedWorkspaces: [...this.workspaceSet].sort(),
      strictMode: this.strictMode,
      activeWorkspace: this.activeWorkspace,
    }
  }

  /**
   * Turn strict mode on/off and resync. Strict: only the active workspace's
   * servers stay mounted. Non-strict: every workspace's servers mount (union).
   * @param enabled - strict mode flag.
   * @returns the post-resync snapshot.
   */
  @Remote('setStrictMode')
  async setStrictMode(enabled: boolean): Promise<McpManagerSnapshot> {
    this.strictMode = enabled
    await this.runRescan()
    return this.snapshot()
  }

  /**
   * Report the web client's currently selected workspace ('' = none). Only
   * strict mode reacts; non-strict keeps the union untouched.
   * @param path - canonical workspace path, or '' for no selection.
   * @returns the post-resync snapshot.
   */
  @Remote('setActiveWorkspace')
  async setActiveWorkspace(path: string): Promise<McpManagerSnapshot> {
    this.activeWorkspace = path
    if (this.strictMode) await this.runRescan()
    return this.snapshot()
  }

  /**
   * Create one server entry in a workspace's mcp.json (file created when
   * absent). Resolves only after the resync settles, so a caller's follow-up
   * snapshot already reflects the mounted state.
   */
  @Remote('apply')
  async apply(draft: McpServerDraft): Promise<McpApplyResult> {
    const invalid = validateDraft(draft)
    if (invalid !== undefined) return { ok: false, error: invalid }
    // One canonical path for the file write and the parse-cache key, so a
    // non-canonical client input (e.g. a symlinked form) can never desync
    // this mutation from the resync below.
    const workspacePath = realpathSync(draft.workspace)
    const path = mcpJsonPath(workspacePath)
    let document: { mcpServers?: Record<string, unknown> }
    try {
      document = JSON.parse(readFileSync(path, 'utf8')) as { mcpServers?: Record<string, unknown> }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return { ok: false, error: `unreadable mcp.json: ${String(error instanceof Error ? error.message : error)}` }
      }
      document = {}
    }
    if (document === null || typeof document !== 'object' || Array.isArray(document)) {
      return { ok: false, error: 'mcp.json must contain a JSON object' }
    }
    const servers = document.mcpServers ?? {}
    if (typeof servers !== 'object' || Array.isArray(servers)) {
      return { ok: false, error: 'mcpServers must be an object' }
    }
    if (servers[draft.name] !== undefined) {
      return { ok: false, error: `serverName "${draft.name}" already exists in ${workspacePath}` }
    }
    servers[draft.name] = draftToEntry(draft)
    document.mcpServers = servers
    try {
      atomicWriteJson(path, document)
    } catch (error) {
      return { ok: false, error: `write failed: ${String(error instanceof Error ? error.message : error)}` }
    }
    // A brand-new file is not watched yet: resync now so the entry mounts
    // without waiting for the periodic rescan. The mutation invalidates the
    // parse cache, or this pass would re-sync the pre-write parse.
    this.parseCache.delete(workspacePath)
    await this.runRescan()
    return { ok: true }
  }

  /**
   * Remove one server entry from a workspace's mcp.json.
   * Named `removeServer`: `remove` collides with the client gateway's
   * RemoteNamespaceService prototype method and fails contribution mounts.
   * Resolves only after the resync settles, so the caller's follow-up
   * snapshot already reflects the unload.
   */
  @Remote('removeServer')
  async removeServer(workspace: string, serverName: string): Promise<McpApplyResult> {
    // Canonical path shared by the file write and the parse-cache key.
    const workspacePath = realpathSync(workspace)
    const path = mcpJsonPath(workspacePath)
    if (!hasManagerFile(workspacePath)) {
      return { ok: false, error: `no mcp.json under ${workspacePath}` }
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
    // Invalidate the cached parse so the resync below drops the removed
    // entry instead of replaying the pre-write state.
    this.parseCache.delete(workspacePath)
    await this.runRescan()
    return { ok: true }
  }

  /**
   * Enable or disable one server entry in a workspace's mcp.json. Disabling
   * writes `enabled: false`; enabling removes the field (absent = enabled).
   * Resolves only after the resync settles, so the caller's follow-up
   * snapshot already reflects the mounted/unmounted state.
   */
  @Remote('setServerEnabled')
  async setServerEnabled(workspace: string, serverName: string, enabled: boolean): Promise<McpApplyResult> {
    // Canonical path shared by the file write and the parse-cache key.
    const workspacePath = realpathSync(workspace)
    const path = mcpJsonPath(workspacePath)
    if (!hasManagerFile(workspacePath)) {
      return { ok: false, error: `no mcp.json under ${workspacePath}` }
    }
    try {
      const document = JSON.parse(readFileSync(path, 'utf8')) as { mcpServers?: Record<string, unknown> }
      const servers = document.mcpServers
      if (servers === undefined || typeof servers !== 'object' || Array.isArray(servers)) {
        return { ok: false, error: 'mcpServers must be an object' }
      }
      const entry = servers[serverName]
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        return { ok: false, error: `serverName "${serverName}" not found in ${workspacePath}` }
      }
      const entryRecord = entry as Record<string, unknown>
      if (enabled) {
        delete entryRecord.enabled
      } else {
        entryRecord.enabled = false
      }
      atomicWriteJson(path, document)
    } catch (error) {
      return { ok: false, error: `write failed: ${String(error instanceof Error ? error.message : error)}` }
    }
    // Invalidate the cached parse so the resync below applies the new flag
    // instead of replaying the pre-write state.
    this.parseCache.delete(workspacePath)
    await this.runRescan()
    return { ok: true }
  }

  /**
   * Serialize rescan passes: a Remote-triggered pass must apply after any
   * in-flight one settles (a skipped pass would drop the newest selection).
   * @returns resolution after this queued pass settles.
   */
  private runRescan(): Promise<void> {
    const next = this.rescanChain.then(() => this.rescan(), () => this.rescan())
    this.rescanChain = next.catch(() => undefined)
    return next
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
        void this.runRescan()
      })
      for (const path of next) this.workspaceSet.add(path)
      // Names live in profile-level mcp-client instances are unmountable:
      // flag workspace rows conflict instead of failing the mount.
      this.sync.setReservedNames(profileServerNames(this.loaderEntries()))
      for (const path of [...next].sort()) {
        const servers = this.parseCache.get(path)
        if (servers === undefined) continue
        // Strict mode mounts only the selected workspace; empty desires
        // unmount every other workspace's instances (profile rows stay).
        const desired = this.strictMode && path !== this.activeWorkspace ? [] : servers
        await this.sync.syncWorkspace({ workspacePath: path, servers: desired })
      }
      // A server down at mount reconnects in the background; re-probe so its
      // status flips to connected once the tools actually register.
      this.sync.refreshConnectivity(name => {
        try {
          return serverHasTools(this.ctx, name)
        } catch {
          return false
        }
      })
      this.profileServers = await this.scanProfileEntries()
    } finally {
      this.rescanning = false
    }
  }

  /** Loader entries when the loader service is mounted (web profile). */
  private loaderEntries(): readonly LoaderEntryView[] {
    const loader = (this.ctx as { get?: (name: string) => unknown }).get?.('loader') as
      | { entries(): readonly LoaderEntryView[] }
      | undefined
    return loader?.entries() ?? []
  }

  /**
   * Project profile-level mcp-client registrations (cordis config tree: profile
   * patches, bundles, --patch overlays) as read-only server rows.
   */
  private async scanProfileEntries(): Promise<McpServerState[]> {
    return scanProfileEntries(this.loaderEntries(), new Set(this.sync.snapshot().map(server => server.name)))
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

/** Whether the tools registry holds any `mcp__<serverName>__*` tool. */
function serverHasTools(ctx: unknown, serverName: string): boolean {
  // ctx.get, never property access: un-injected service properties throw
  // under Cordis's inject guard, and `tools` is an optional probe here.
  const tools = (ctx as { get?: (name: string) => unknown }).get?.('tools') as
    | { schemas(scope?: string | undefined): readonly { name: string }[] }
    | undefined
  if (tools === undefined) return false
  const prefix = `mcp__${serverName}__`
  // The gateway's own scope view: includes the global layer and every scope
  // on the gateway's chain, so scoped registrations are visible too.
  const names = tools.schemas(scopeOf(ctx))
  return names.some(schema => schema.name.startsWith(prefix))
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
