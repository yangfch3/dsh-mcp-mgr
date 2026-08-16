import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { McpApplyResult, McpManagerSnapshot, McpServerDraft, McpServerState, McpServerStatus } from 'dsh-mcp-mgr/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { McpServerForm } from './McpServerForm.tsx'
import type { McpLocaleKey } from './locales.ts'
import css from './McpSettingsTab.module.css'

/** localStorage key for the strict-mode checkbox. */
export const STRICT_MODE_KEY = 'dsh.mcpMgr.strictMode'

/** Persisted strict-mode preference; null when never set (host default applies). */
export function loadStrictMode(): boolean | null {
  const stored = localStorage.getItem(STRICT_MODE_KEY)
  if (stored === null) return null
  return stored === '1'
}

/** One workspace row the add-form may target. */
export interface WorkspaceOption {
  readonly path: string
  readonly title: string
}

/** Registration-side Remote face used by the tab. */
export interface McpSettingsTabInjected {
  /** Read a current manager snapshot. */
  snapshot: () => Promise<McpManagerSnapshot>
  /** Create one server entry in a workspace's mcp.json. */
  apply: (draft: McpServerDraft) => Promise<McpApplyResult>
  /** Remove one server from a workspace's mcp.json. */
  removeServer: (workspace: string, name: string) => Promise<McpApplyResult>
  /** Open a profile config file with the Host's default application. */
  openSourceFile: (sourceFile: string) => Promise<void>
  /** Toggle strict mode host-side; resolves with the post-change snapshot. */
  setStrictMode: (enabled: boolean) => Promise<McpManagerSnapshot>
  /** Registered workspaces for the add-form target picker. */
  listWorkspaces: () => readonly WorkspaceOption[]
  /** Workspace of the currently open session ('' when none). */
  currentWorkspacePath: () => string
}

/** Full component props assembled by the Settings slot renderer. */
export type McpSettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.mcpMgr'>
  & InjectFace<McpSettingsTabInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: McpManagerSnapshot }

/** Badge label key for one display status (raw status + connectivity derivation). */
const DISPLAY_KEYS = {
  connected: 'connected',
  registered: 'active',
  connecting: 'connecting',
  active: 'active',
  error: 'errorStatus',
  conflict: 'conflict',
  removing: 'removing',
  configured: 'configured',
} satisfies Record<DisplayStatus, McpLocaleKey>

/** Display status: an 'active' row reports real connectivity when probed. */
type DisplayStatus = 'connected' | 'registered' | McpServerStatus

function displayStatus(server: McpServerState): DisplayStatus {
  return server.status === 'active'
    ? (server.connected === true ? 'connected' : 'registered')
    : server.status
}

/**
 * Short display form of a source path: last path segment by default, last two
 * when `forceLastTwo` (used for profile config files and colliding basenames).
 */
function shortPath(path: string, forceLastTwo = false): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  if (parts.length === 0) return path
  const count = forceLastTwo && parts.length > 2 ? 2 : 1
  return parts.slice(-count).join('/')
}

/** Render the currently registered MCP servers (workspace + profile sources). */
export function McpSettingsTab({
  snapshot, apply, removeServer, openSourceFile, setStrictMode, listWorkspaces, currentWorkspacePath, t,
}: McpSettingsTabProps): ReactNode {
  const [request, setRequest] = useState(0)
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [strictMode, setStrictModeState] = useState<boolean>(() => loadStrictMode() ?? false)
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => snapshot()).then(
      (value) => { if (current) { setState({ status: 'ready', snapshot: value }); setErrorDetail(null) } },
      (error) => {
        if (current) {
          setState({ status: 'error' })
          setErrorDetail(String(error instanceof Error ? error.message : error))
        }
      },
    )
    return () => { current = false }
  }, [snapshot, request])

  const servers = useMemo(
    () => state.status === 'ready' ? state.snapshot.servers : [],
    [state],
  )

  /** Source-cell display paths with basename collisions widened to two segments. */
  const sourceDisplay = useMemo(() => {
    const workspaceBasenames = new Map<string, number>()
    for (const server of servers) {
      if (server.source !== 'workspace' || server.workspace === undefined) continue
      const base = shortPath(server.workspace)
      workspaceBasenames.set(base, (workspaceBasenames.get(base) ?? 0) + 1)
    }
    return new Map(servers.map(server => [
      server.key,
      server.source === 'workspace' && server.workspace !== undefined
        ? shortPath(server.workspace, (workspaceBasenames.get(shortPath(server.workspace)) ?? 0) > 1)
        : shortPath(server.sourceFile ?? server.key, true),
    ]))
  }, [servers])

  const retry = (): void => {
    setNotice(null)
    setState({ status: 'loading' })
    setRequest(value => value + 1)
  }

  const onRemove = async (server: McpServerState): Promise<void> => {
    if (server.workspace === undefined) return
    setBusy(server.key)
    setNotice(null)
    let result: McpApplyResult
    try {
      result = await removeServer(server.workspace, server.name)
    } catch (error) {
      setBusy(null)
      setNotice(`${t('applyFailed')}: ${String(error instanceof Error ? error.message : error)}`)
      return
    }
    setBusy(null)
    setState({ status: 'loading' })
    setRequest(value => value + 1)
    setNotice(result.ok ? t('removed') : `${t('applyFailed')}: ${result.error}`)
  }

  const onAdded = (_workspace: string): void => {
    setShowForm(false)
    setState({ status: 'loading' })
    setRequest(value => value + 1)
    setNotice(strictMode ? t('addedStrict') : t('added'))
  }

  const onView = async (server: McpServerState): Promise<void> => {
    if (server.sourceFile === undefined) return
    setBusy(server.key)
    setNotice(null)
    try {
      await openSourceFile(server.sourceFile)
    } catch (error) {
      setNotice(`${t('applyFailed')}: ${String(error instanceof Error ? error.message : error)}`)
    } finally {
      setBusy(null)
    }
  }

  const onToggleStrict = async (enabled: boolean): Promise<void> => {
    setStrictModeState(enabled)
    localStorage.setItem(STRICT_MODE_KEY, enabled ? '1' : '0')
    setNotice(null)
    try {
      const snapshot = await setStrictMode(enabled)
      setState({ status: 'ready', snapshot })
    } catch (error) {
      setStrictModeState(!enabled)
      setNotice(`${t('applyFailed')}: ${String(error instanceof Error ? error.message : error)}`)
    }
  }

  return (
    <div className={css.section} aria-busy={state.status === 'loading'}>
      {notice !== null ? <p className={css.notice} role="status">{notice}</p> : null}
      <div className={css.heading}>
        <h3>{t('server')}</h3>
        <div className={css.headingActions}>
          <label className={css.strictLabel} title={t('strictModeHint')}>
            <input
              type="checkbox"
              checked={strictMode}
              onChange={(event) => { void onToggleStrict(event.target.checked) }}
            />
            {t('strictMode')}
          </label>
          <button
            type="button"
            className={css.add}
            disabled={listWorkspaces().length === 0}
            title={t('noWorkspace')}
            onClick={() => { setShowForm(true) }}
          >
            {t('add')}
          </button>
          <button type="button" className={css.refresh} onClick={retry}>{t('refresh')}</button>
        </div>
      </div>
      {showForm ? (
        <McpServerForm
          workspaces={listWorkspaces()}
          defaultWorkspace={currentWorkspacePath()}
          submit={apply}
          t={t}
          onClose={() => { setShowForm(false) }}
          onAdded={onAdded}
        />
      ) : null}
      {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {state.status === 'error' ? (
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          {errorDetail !== null ? <p className={css.errorText} role="alert">{errorDetail}</p> : null}
          <button type="button" onClick={retry}>{t('retry')}</button>
        </div>
      ) : null}
      {state.status === 'ready' && servers.length === 0
        ? <p className={css.status}>{t('empty')}</p>
        : null}
      {servers.length > 0 ? (
        <table className={css.table}>
          <thead>
            <tr>
              <th>{t('source')}</th>
              <th>{t('server')}</th>
              <th>{t('transport')}</th>
              <th>{t('status')}</th>
              <th>{t('action')}</th>
            </tr>
          </thead>
          <tbody>
            {servers.map((server) => {
              const fullPath = server.source === 'workspace' ? server.workspace : server.sourceFile
              return (
                <tr key={server.key} data-source={server.source}>
                  <td className={css.sourceCell}>
                    <span className={css.sourceChip} data-source={server.source}>
                      {t(server.source === 'workspace' ? 'sourceWorkspace' : 'sourceConfig')}
                    </span>
                    {fullPath !== undefined
                      ? <span className={css.sourcePath} title={fullPath}>{sourceDisplay.get(server.key)}</span>
                      : null}
                  </td>
                  <td className={css.nowrapCell} title={server.name}>{server.name}</td>
                  <td className={css.nowrapCell}>{server.transport}</td>
                  <td className={css.nowrapCell}>
                    {(() => {
                      const status = displayStatus(server)
                      return (
                        <>
                          <span
                            className={css.statusBadge}
                            data-status={status}
                            title={
                              status === 'connected' ? t('connectedHint')
                                : status === 'registered' ? t('activeHint')
                                : undefined
                            }
                          >
                            {t(DISPLAY_KEYS[status])}
                          </span>
                          {server.error !== undefined
                            ? <span className={css.errorText} title={server.error}>{server.error}</span>
                            : status === 'registered' && server.probeError !== undefined
                              ? <span className={css.errorText} title={server.probeError}>{server.probeError}</span>
                              : null}
                        </>
                      )
                    })()}
                  </td>
                  <td className={css.nowrapCell}>
                    {server.source === 'workspace' ? (
                      <button
                        type="button"
                        className={css.danger}
                        disabled={busy === server.key}
                        onClick={() => { void onRemove(server) }}
                      >
                        {t('remove')}
                      </button>
                    ) : server.sourceFile !== undefined ? (
                      <button
                        type="button"
                        disabled={busy === server.key}
                        onClick={() => { void onView(server) }}
                      >
                        {t('view')}
                      </button>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  )
}
