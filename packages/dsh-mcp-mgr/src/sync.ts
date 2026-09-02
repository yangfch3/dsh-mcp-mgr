/**
 * Instance sync: diff the desired server set (parsed from each workspace's
 * mcp.json) against live mcp-client fibers, creating / disposing / rebuilding
 * instances as needed.
 *
 * The mcp-client plugin is instantiated through an injected factory so tests
 * can observe the lifecycle without a real MCP server or tool registry.
 * @module dsh-mcp-mgr/sync
 */

import type { Config as McpClientConfig } from '@deepseek-ai/dsh-mcp-client'
import type { McpServerState, McpServerStatus } from './types.ts'

/** One live or desired instance slot keyed by workspace + serverName. */
export interface McpInstance {
  readonly key: string
  readonly workspacePath: string
  readonly name: string
  /** Whether the mcp.json entry is enabled; a disabled instance never mounts. */
  readonly enabled: boolean
  readonly config: McpClientConfig
  status: McpServerStatus
  error?: string
  fiber?: unknown
  /** True when the factory probed real connectivity (tools registered). */
  connected?: boolean
  /** Reason the connectivity probe could not run/complete (shown on the row). */
  probeError?: string
}

/** Factory contract: mount one mcp-client instance. */
export interface InstanceFactory {
  /**
   * Create one plugin instance; resolves once its fiber activates. The
   * `connected` flag reports whether real connectivity was probed (tools
   * registered), distinguishing a live server from one that merely activated;
   * `probeError` carries the reason when the probe could not run.
   */
  create(config: McpClientConfig): Promise<{ fiber: unknown; connected?: boolean; probeError?: string }>
  /** Dispose a previously created fiber. */
  dispose(fiber: unknown): Promise<void>
}

export interface SyncEvents {
  /** One or more instances changed; fires after a settled sync pass. */
  onChange(): void
}

/** Desired state for one workspace. */
export interface DesiredWorkspace {
  readonly workspacePath: string
  readonly servers: readonly { readonly name: string; readonly enabled: boolean; readonly config: McpClientConfig }[]
}

/**
 * Diff and reconcile instance lifecycles. All mutations run on the caller's
 * promise chain; `sync()` resolves when the pass settles.
 */
export class McpSync {
  private readonly instances = new Map<string, McpInstance>()
  private readonly ownerByServerName = new Map<string, string>()
  private readonly factory: InstanceFactory
  private readonly events: SyncEvents
  private syncing: Promise<void> = Promise.resolve()
  /** serverNames live outside this sync (profile-level instances). */
  private reserved = new Set<string>()

  constructor(factory: InstanceFactory, events: SyncEvents) {
    this.factory = factory
    this.events = events
  }

  /**
   * Declare serverNames that are mounted elsewhere (profile-level mcp-client
   * instances): workspace servers with these names flag conflict instead of
   * mounting, matching mcp-client's global uniqueness rule.
   */
  setReservedNames(names: ReadonlySet<string>): void {
    this.reserved = new Set(names)
  }

  /**
   * Reconcile the desired set for one workspace.
   * @param desired - parsed servers; an empty list removes every instance of the workspace.
   * @returns resolution after all instance mutations settle.
   */
  syncWorkspace(desired: DesiredWorkspace): Promise<void> {
    const run = async (): Promise<void> => {
      const desiredKeys = new Set(desired.servers.map(server => `${desired.workspacePath}#${server.name}`))
      const removals: McpInstance[] = []
      for (const [key, instance] of this.instances) {
        if (instance.workspacePath === desired.workspacePath && !desiredKeys.has(key)) {
          removals.push(instance)
        }
      }
      for (const instance of removals) {
        await this.removeInstance(instance)
      }
      for (const server of desired.servers) {
        await this.upsertInstance(desired.workspacePath, server.name, server.enabled, server.config)
      }
      this.events.onChange()
    }
    // Serialize passes; a slow connection must not interleave with a newer diff.
    const next = this.syncing.then(run, run)
    this.syncing = next.catch(() => undefined)
    return next
  }

  /** Drop every instance of one workspace (e.g. workspace deleted). */
  removeWorkspace(workspacePath: string): Promise<void> {
    return this.syncWorkspace({ workspacePath, servers: [] })
  }

  /** Dispose every mounted instance before the owning Cordis context closes. */
  dispose(): Promise<void> {
    const run = async (): Promise<void> => {
      for (const instance of [...this.instances.values()]) {
        await this.removeInstance(instance)
      }
    }
    const next = this.syncing.then(run, run)
    this.syncing = next.catch(() => undefined)
    return next
  }

  /**
   * Re-probe live instances' connectivity (tools registered). A server that
   * was down at mount keeps its initial `connected: false` while mcp-client
   * reconnects in the background; this flips the flag once its tools appear
   * (and back when a final failure unregisters them).
   * @param probe - resolves one serverName to its current connectivity.
   * @returns whether any instance changed.
   */
  refreshConnectivity(probe: (serverName: string) => boolean): boolean {
    let changed = false
    for (const instance of this.instances.values()) {
      if (instance.status !== 'active') continue
      const connected = probe(instance.name)
      if (connected !== instance.connected) {
        instance.connected = connected
        changed = true
      }
    }
    if (changed) this.events.onChange()
    return changed
  }

  /** Current live instance projection, sorted by workspace then name. */
  snapshot(): McpServerState[] {
    return [...this.instances.values()]
      .sort((left, right) =>
        left.workspacePath.localeCompare(right.workspacePath) || left.name.localeCompare(right.name))
      .map(instance => ({
        key: instance.key,
        source: 'workspace' as const,
        workspace: instance.workspacePath,
        name: instance.name,
        enabled: instance.enabled,
        transport: instance.config.transport,
        status: instance.status,
        ...(instance.connected === undefined ? {} : { connected: instance.connected }),
        ...(instance.probeError === undefined ? {} : { probeError: instance.probeError }),
        ...(instance.error === undefined ? {} : { error: instance.error }),
      }))
  }

  private async upsertInstance(workspacePath: string, name: string, enabled: boolean, config: McpClientConfig): Promise<void> {
    const key = `${workspacePath}#${name}`
    const existing = this.instances.get(key)
    // A conflict row re-evaluates every pass: when the blocker (workspace
    // owner or profile reservation) clears, it mounts without a config change.
    // A disabled row must also re-evaluate: re-enabling mounts even though
    // the mcp-client config is unchanged.
    if (existing !== undefined && enabled && sameConfig(existing.config, config)
      && existing.status !== 'conflict' && existing.status !== 'disabled') return
    if (existing !== undefined && !enabled && existing.status === 'disabled') return
    if (existing !== undefined) {
      await this.removeInstance(existing)
    }
    if (!enabled) {
      // Disabled: keep the row visible but never mount and never hold the
      // serverName — an enabled sibling in another workspace stays conflict-free.
      this.instances.set(key, {
        key,
        workspacePath,
        name,
        enabled: false,
        config,
        status: 'disabled',
      })
      return
    }
    const owner = this.ownerByServerName.get(name)
    if (owner !== undefined && owner !== key) {
      const ownerWorkspace = this.instances.get(owner)?.workspacePath ?? owner
      this.instances.set(key, {
        key,
        workspacePath,
        name,
        enabled: true,
        config,
        status: 'conflict',
        error: `serverName "${name}" is already used by workspace ${ownerWorkspace}`,
      })
      return
    }
    if (this.reserved.has(name)) {
      this.instances.set(key, {
        key,
        workspacePath,
        name,
        enabled: true,
        config,
        status: 'conflict',
        error: `serverName "${name}" is already used by a profile-level mcp-client instance`,
      })
      return
    }
    const instance: McpInstance = {
      key,
      workspacePath,
      name,
      enabled: true,
      config,
      status: 'connecting',
    }
    this.instances.set(key, instance)
    this.ownerByServerName.set(name, key)
    try {
      const created = await this.factory.create(config)
      instance.fiber = created.fiber
      if (created.connected !== undefined) instance.connected = created.connected
      if (created.probeError !== undefined) instance.probeError = created.probeError
      instance.status = 'active'
    } catch (error) {
      instance.status = 'error'
      instance.error = String(error instanceof Error ? error.message : error)
      this.ownerByServerName.delete(name)
    }
  }

  private async removeInstance(instance: McpInstance): Promise<void> {
    instance.status = 'removing'
    try {
      if (instance.fiber !== undefined) await this.factory.dispose(instance.fiber)
    } catch (error) {
      instance.error = `dispose failed: ${String(error instanceof Error ? error.message : error)}`
      instance.status = 'error'
      return
    }
    this.instances.delete(instance.key)
    if (this.ownerByServerName.get(instance.name) === instance.key) {
      this.ownerByServerName.delete(instance.name)
    }
  }
}

function sameConfig(left: McpClientConfig, right: McpClientConfig): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
