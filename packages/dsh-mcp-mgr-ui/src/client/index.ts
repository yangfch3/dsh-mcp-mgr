/**
 * MCP manager tab registered into Web Settings.
 */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { TYPERT_REMOTE } from 'dsh-mcp-mgr/remote'
import type { McpApplyResult, McpManagerSnapshot } from 'dsh-mcp-mgr/types'
import { McpSettingsTab, type McpSettingsTabInjected } from './McpSettingsTab.tsx'
import { en, zh, type McpLocaleKey } from './locales.ts'

export type { McpSettingsTabInjected, McpSettingsTabProps } from './McpSettingsTab.tsx'
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
export const inject = ['slots', 'locale', 'remote']

/** The namespace service this plugin mounts itself — fetched via `ctx.get`, never injected. */
interface McpMgrNamespace {
  snapshot(): Promise<RemoteResult<McpManagerSnapshot>>
  removeServer(workspace: string, name: string): Promise<RemoteResult<McpApplyResult>>
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
  const injected = (): McpSettingsTabInjected => ({
    snapshot: async () => {
      const result = await mcpMgr().snapshot()
      if (!result.ok) {
        throw new Error(`mcpMgr.snapshot failed: ${result.error.code}: ${result.error.message}`)
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
