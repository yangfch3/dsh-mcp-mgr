/**
 * New-server form: pick a workspace, describe one MCP server, validate, and
 * merge it into the workspace's mcp.json through the mcpMgr Remote.
 */

import { useState, type ReactNode } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { McpApplyResult, McpServerDraft } from 'dsh-mcp-mgr/types'
import type { McpLocaleKey } from './locales.ts'
import css from './McpServerForm.module.css'

/** Mirrors the host-side serverName budget. */
const NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

interface KvRow {
  key: string
  value: string
}

export interface McpServerFormProps {
  /** Registered workspaces to target. */
  workspaces: readonly { path: string; title: string }[]
  /** Workspace preselected by default ('' when none is current). */
  defaultWorkspace: string
  /** Host-side create; resolves with the host business result. */
  submit: (draft: McpServerDraft) => Promise<McpApplyResult>
  t: (key: McpLocaleKey) => string
  onClose: () => void
  /** Called with the target workspace after a successful write. */
  onAdded: (workspace: string) => void
}

/** Drop blank-key rows; a key with an empty value stays (value '') . */
function kvRecord(rows: readonly KvRow[]): Record<string, string> {
  const record: Record<string, string> = {}
  for (const row of rows) {
    const key = row.key.trim()
    if (key === '') continue
    record[key] = row.value
  }
  return record
}

/** One key-value input row with add/remove. */
function KvRows({ label, rows, onChange, t }: {
  label: string
  rows: KvRow[]
  onChange: (rows: KvRow[]) => void
  t: (key: McpLocaleKey) => string
}): ReactNode {
  const update = (index: number, patch: Partial<KvRow>): void => {
    onChange(rows.map((row, i) => i === index ? { ...row, ...patch } : row))
  }
  return (
    <div className={css.field}>
      <span>{label}</span>
      {rows.length === 0 ? <p className={css.kvEmpty}>{t('kvEmpty')}</p> : null}
      {rows.map((row, index) => (
        <div className={css.kvRow} key={index}>
          <Input
            value={row.key}
            placeholder={t('kvKey')}
            onChange={(event) => { update(index, { key: event.target.value }) }}
          />
          <Input
            value={row.value}
            placeholder={t('kvValue')}
            onChange={(event) => { update(index, { value: event.target.value }) }}
          />
          <button type="button" className={css.kvRemove} onClick={() => { onChange(rows.filter((_, i) => i !== index)) }}>
            {t('removeRow')}
          </button>
        </div>
      ))}
      <button type="button" className={css.kvAdd} onClick={() => { onChange([...rows, { key: '', value: '' }]) }}>
        {t('addRow')}
      </button>
    </div>
  )
}

/** Modal form body for adding one server to a workspace mcp.json. */
export function McpServerForm({
  workspaces, defaultWorkspace, submit, t, onClose, onAdded,
}: McpServerFormProps): ReactNode {
  const [workspace, setWorkspace] = useState(() => {
    if (workspaces.some(item => item.path === defaultWorkspace)) return defaultWorkspace
    return workspaces[0]?.path ?? ''
  })
  const [name, setName] = useState('')
  const [transport, setTransport] = useState<'stdio' | 'streamable-http'>('streamable-http')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [cwd, setCwd] = useState('')
  const [url, setUrl] = useState('')
  const [envRows, setEnvRows] = useState<KvRow[]>([])
  const [headerRows, setHeaderRows] = useState<KvRow[]>([])
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'name' | 'command' | 'url', string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submitForm = async (): Promise<void> => {
    const next: typeof fieldErrors = {}
    if (!NAME_PATTERN.test(name.trim())) next.name = t('namePatternError')
    if (transport === 'stdio' && command.trim() === '') next.command = t('commandRequired')
    if (transport === 'streamable-http' && url.trim() === '') next.url = t('urlRequired')
    setFieldErrors(next)
    if (Object.keys(next).length > 0) return
    const env = kvRecord(envRows)
    const headers = kvRecord(headerRows)
    const draft: McpServerDraft = transport === 'stdio'
      ? {
          workspace,
          name: name.trim(),
          transport,
          command: command.trim(),
          ...(args.trim() !== '' ? { args: args.trim().split(/\s+/) } : {}),
          ...(cwd.trim() !== '' ? { cwd: cwd.trim() } : {}),
          ...(Object.keys(env).length > 0 ? { env } : {}),
        }
      : {
          workspace,
          name: name.trim(),
          transport,
          url: url.trim(),
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
        }
    setSubmitting(true)
    setFormError(null)
    try {
      const result = await submit(draft)
      if (!result.ok) {
        setFormError(result.error)
        setSubmitting(false)
        return
      }
      onAdded(workspace)
    } catch (error) {
      setFormError(String(error instanceof Error ? error.message : error))
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('add')}
      closeLabel={t('cancel')}
      footer={
        <div className={css.formActions}>
          <Button variant="ghost" disabled={submitting} onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" disabled={submitting} onClick={() => { void submitForm() }}>{t('submit')}</Button>
        </div>
      }
    >
      <div className={css.form}>
        <label className={css.field}>
          <span>{t('workspaceLabel')}</span>
          <select value={workspace} onChange={(event) => { setWorkspace(event.target.value) }}>
            {workspaces.map(item => (
              <option key={item.path} value={item.path}>{item.title}</option>
            ))}
          </select>
        </label>
        <label className={css.field}>
          <span>{t('nameLabel')}</span>
          <Input value={name} placeholder={t('namePlaceholder')} onChange={(event) => { setName(event.target.value) }} />
          {fieldErrors.name !== undefined ? <em className={css.fieldError}>{fieldErrors.name}</em> : null}
        </label>
        <label className={css.field}>
          <span>{t('transportLabel')}</span>
          <select value={transport} onChange={(event) => { setTransport(event.target.value as 'stdio' | 'streamable-http') }}>
            <option value="stdio">stdio</option>
            <option value="streamable-http">streamable-http</option>
          </select>
        </label>
        {transport === 'stdio' ? (
          <>
            <label className={css.field}>
              <span>{t('commandLabel')}</span>
              <Input value={command} onChange={(event) => { setCommand(event.target.value) }} />
              {fieldErrors.command !== undefined ? <em className={css.fieldError}>{fieldErrors.command}</em> : null}
            </label>
            <label className={css.field}>
              <span>{t('argsLabel')}</span>
              <Input value={args} placeholder={t('argsPlaceholder')} onChange={(event) => { setArgs(event.target.value) }} />
            </label>
            <label className={css.field}>
              <span>{t('cwdLabel')}</span>
              <Input value={cwd} placeholder={t('cwdPlaceholder')} onChange={(event) => { setCwd(event.target.value) }} />
            </label>
            <KvRows label={t('envLabel')} rows={envRows} onChange={setEnvRows} t={t} />
          </>
        ) : (
          <>
            <label className={css.field}>
              <span>{t('urlLabel')}</span>
              <Input value={url} onChange={(event) => { setUrl(event.target.value) }} />
              {fieldErrors.url !== undefined ? <em className={css.fieldError}>{fieldErrors.url}</em> : null}
            </label>
            <KvRows label={t('headersLabel')} rows={headerRows} onChange={setHeaderRows} t={t} />
          </>
        )}
        {formError !== null ? <p className={css.formError} role="alert">{formError}</p> : null}
      </div>
    </Modal>
  )
}
