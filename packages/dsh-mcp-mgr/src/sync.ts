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
  readonly config: McpClientConfig
  status: McpServerStatus
  error?: string
  fiber?: unknown
}

/** Factory contract: mount one mcp-client instance. */
export interface InstanceFactory {
  /** Create one plugin instance; resolves once its fiber activates. */
  create(config: McpClientConfig): Promise<unknown>
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
  readonly servers: readonly { readonly name: string; readonly config: McpClientConfig }[]
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

  constructor(factory: InstanceFactory, events: SyncEvents) {
    this.factory = factory
    this.events = events
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
        await this.upsertInstance(desired.workspacePath, server.name, server.config)
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
        transport: instance.config.transport,
        status: instance.status,
        ...(instance.error === undefined ? {} : { error: instance.error }),
      }))
  }

  private async upsertInstance(workspacePath: string, name: string, config: McpClientConfig): Promise<void> {
    const key = `${workspacePath}#${name}`
    const existing = this.instances.get(key)
    if (existing !== undefined && sameConfig(existing.config, config)) return
    if (existing !== undefined) {
      await this.removeInstance(existing)
    }
    const owner = this.ownerByServerName.get(name)
    if (owner !== undefined && owner !== key) {
      const ownerWorkspace = this.instances.get(owner)?.workspacePath ?? owner
      this.instances.set(key, {
        key,
        workspacePath,
        name,
        config,
        status: 'conflict',
        error: `serverName "${name}" is already used by workspace ${ownerWorkspace}`,
      })
      return
    }
    const instance: McpInstance = {
      key,
      workspacePath,
      name,
      config,
      status: 'connecting',
    }
    this.instances.set(key, instance)
    this.ownerByServerName.set(name, key)
    try {
      instance.fiber = await this.factory.create(config)
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
