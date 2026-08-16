/**
 * MCP manager tab registered into Web Settings.
 */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { TYPERT_REMOTE } from 'dsh-mcp-mgr/remote'
import type { McpApplyResult, McpManagerSnapshot, McpServerDraft } from 'dsh-mcp-mgr/types'
import { loadStrictMode, McpSettingsTab, type McpSettingsTabInjected } from './McpSettingsTab.tsx'
import { en, zh, type McpLocaleKey } from './locales.ts'

export type { McpSettingsTabInjected, McpSettingsTabProps } from './McpSettingsTab.tsx'
export { STRICT_MODE_KEY, loadStrictMode } from './McpSettingsTab.tsx'
export type { McpLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** MCP manager copy. */
    'settings.mcpMgr': McpLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.mcpMgr'

/** Services required by the Settings registration. */
export const inject = ['slots', 'locale', 'remote', 'connection', 'sessions', 'workspaces']

/** The namespace service this plugin mounts itself — fetched via `ctx.get`, never injected. */
interface McpMgrNamespace {
  snapshot(): Promise<RemoteResult<McpManagerSnapshot>>
  apply(draft: McpServerDraft): Promise<RemoteResult<McpApplyResult>>
  removeServer(workspace: string, name: string): Promise<RemoteResult<McpApplyResult>>
  setStrictMode(enabled: boolean): Promise<RemoteResult<McpManagerSnapshot>>
  setActiveWorkspace(path: string): Promise<RemoteResult<McpManagerSnapshot>>
}

/**
 * Mount the mcpMgr Remote contribution and register the tab into the
 * Plugins settings section.
 *
 * The mount is awaited in `apply` (the api-remotes pattern) so the tab is
 * only registered after the namespace service exists. The namespace is not
 * injected: this plugin provides it itself, and injecting a self-provided
 * service deadlocks the fiber (pending forever). Consumers read it through
 * `ctx.get`, which bypasses the inject guard.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  const disposeMount = await ctx.remote.$mount(TYPERT_REMOTE)
  ctx.effect(() => () => disposeMount(), 'dsh-mcp-mgr-ui: remote mount')

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-mcp-mgr-ui: dictionaries')

  const t = ctx.locale.bind(NS)
  const mcpMgr = (): McpMgrNamespace => {
    const namespace = ctx.get('remote.mcpMgr') as McpMgrNamespace | undefined
    if (namespace === undefined) {
      throw new Error('mcpMgr namespace service is not mounted')
    }
    return namespace
  }

  const setStrictMode = async (enabled: boolean): Promise<McpManagerSnapshot> => {
    const result = await mcpMgr().setStrictMode(enabled)
    if (!result.ok) {
      throw new Error(`mcpMgr.setStrictMode failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const setActiveWorkspace = async (path: string): Promise<void> => {
    const result = await mcpMgr().setActiveWorkspace(path)
    if (!result.ok) {
      throw new Error(`mcpMgr.setActiveWorkspace failed: ${result.error.code}: ${result.error.message}`)
    }
  }

  // Replay the persisted strict-mode preference once the remote is mounted.
  const storedStrict = loadStrictMode()
  if (storedStrict !== null) {
    void setStrictMode(storedStrict).catch((reason: unknown) => {
      console.warn('mcp-mgr: strict-mode replay failed:', reason)
    })
  }

  // Strict mode mounts only the selected workspace's servers: report the
  // workspace of the currently open session whenever it (or the workspace
  // list) changes. Non-strict host ignores the push.
  const pushActiveWorkspace = (): void => {
    const current = ctx.sessions.list.getSnapshot().current
    const items = ctx.workspaces.list.getSnapshot().items
    const active = current === undefined
      ? undefined
      : items.find(workspace => workspace.sessionIds.includes(current))
    void setActiveWorkspace(active?.path ?? '').catch((reason: unknown) => {
      console.warn('mcp-mgr: active-workspace push failed:', reason)
    })
  }
  ctx.effect(() => {
    const unsubscribeSessions = ctx.sessions.list.subscribe(pushActiveWorkspace)
    const unsubscribeWorkspaces = ctx.workspaces.list.subscribe(pushActiveWorkspace)
    pushActiveWorkspace()
    return () => {
      unsubscribeSessions()
      unsubscribeWorkspaces()
    }
  }, 'dsh-mcp-mgr-ui: active workspace watch')

  const injected = (): McpSettingsTabInjected => ({
    snapshot: async () => {
      const result = await mcpMgr().snapshot()
      if (!result.ok) {
        throw new Error(`mcpMgr.snapshot failed: ${result.error.code}: ${result.error.message}`)
      }
      return result.value
    },
    apply: async (draft) => {
      const result = await mcpMgr().apply(draft)
      if (!result.ok) {
        throw new Error(`mcpMgr.apply failed: ${result.error.code}: ${result.error.message}`)
      }
      return result.value
    },
    removeServer: async (workspace, name) => {
      const result = await mcpMgr().removeServer(workspace, name)
      if (!result.ok) {
        throw new Error(`mcpMgr.removeServer failed: ${result.error.code}: ${result.error.message}`)
      }
      return result.value
    },
    setStrictMode,
    listWorkspaces: () => ctx.workspaces.list.getSnapshot().items.map(workspace => ({
      path: workspace.path,
      title: workspace.title,
    })),
    currentWorkspacePath: () => {
      const current = ctx.sessions.list.getSnapshot().current
      if (current === undefined) return ''
      return ctx.workspaces.list.getSnapshot().items
        .find(workspace => workspace.sessionIds.includes(current))?.path ?? ''
    },
    openSourceFile: async (sourceFile) => {
      const connection = ctx.get('connection') as ConnectionHandle | undefined
      if (connection === undefined) {
        throw new Error('connection service is not mounted')
      }
      const response = await connection.api.host.openPath({ path: sourceFile }, new AbortController().signal)
      if (!response.result.ok) {
        throw new Error(response.result.error.message)
      }
    },
  })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'mcpMgr',
    order: 20,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, McpSettingsTab))
}
