/**
 * mcp.json parsing and mapping to mcp-client configs.
 *
 * Format is the Claude/Codex `mcpServers` object; each entry maps to one
 * mcp-client plugin config. Invalid entries are reported per-server so one
 * broken row never blocks the rest.
 * @module dsh-mcp-mgr/parse
 */

import { join } from 'node:path'
import type { Config as McpClientConfig } from '@deepseek-ai/dsh-mcp-client'

/** One successfully mapped server. */
export interface ParsedServer {
  readonly name: string
  readonly config: McpClientConfig
}

/** One rejected server entry with the reason. */
export interface ParseError {
  readonly name: string
  readonly message: string
}

export interface ParseResult {
  readonly servers: readonly ParsedServer[]
  readonly errors: readonly ParseError[]
}

/** mcp-client serverName budget. */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/
/** Whole-string `${VAR}` env expansion. */
const ENV_REF_PATTERN = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/

/** Path of the manager file inside a workspace. */
export function mcpJsonPath(workspacePath: string): string {
  return join(workspacePath, '.dsh', 'dshmm', 'mcp.json')
}

/**
 * Expand `${VAR}` references in one env value.
 * @param value - raw env value.
 * @param source - entry name for error messages.
 * @returns the expanded value or the reason it cannot expand.
 */
export function expandEnv(value: string, source: string): { ok: true; value: string } | { ok: false; message: string } {
  const match = ENV_REF_PATTERN.exec(value)
  if (match === null) return { ok: true, value }
  const name = match[1] as string
  const resolved = process.env[name]
  if (resolved === undefined) {
    return { ok: false, message: `${source}: env ${JSON.stringify(name)} is not set` }
  }
  return { ok: true, value: resolved }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Parse one mcp.json document.
 * @param text - raw file content.
 * @param workspacePath - workspace root; the default server cwd.
 * @returns mapped servers plus per-entry errors.
 */
export function parseMcpJson(text: string, workspacePath: string): ParseResult {
  let document: unknown
  try {
    document = JSON.parse(text)
  } catch (error) {
    return {
      servers: [],
      errors: [{ name: '(document)', message: `invalid JSON: ${String(error instanceof Error ? error.message : error)}` }],
    }
  }
  if (!isRecord(document) || !isRecord(document.mcpServers)) {
    return {
      servers: [],
      errors: [{ name: '(document)', message: 'expected an object with an "mcpServers" object' }],
    }
  }

  const servers: ParsedServer[] = []
  const errors: ParseError[] = []
  for (const [name, rawEntry] of Object.entries(document.mcpServers)) {
    if (!SERVER_NAME_PATTERN.test(name)) {
      errors.push({ name, message: `serverName must match ${String(SERVER_NAME_PATTERN)}` })
      continue
    }
    if (!isRecord(rawEntry)) {
      errors.push({ name, message: 'entry must be an object' })
      continue
    }
    const transport = rawEntry.type === 'http' ? 'streamable-http' : 'stdio'
    if (transport === 'stdio') {
      const command = asString(rawEntry.command)
      if (command === undefined || command.length === 0) {
        errors.push({ name, message: 'stdio servers require a "command"' })
        continue
      }
      const args: string[] = []
      if (rawEntry.args !== undefined) {
        if (!Array.isArray(rawEntry.args) || rawEntry.args.some(arg => typeof arg !== 'string')) {
          errors.push({ name, message: '"args" must be an array of strings' })
          continue
        }
        args.push(...(rawEntry.args as string[]))
      }
      const env: Record<string, string> = {}
      if (rawEntry.env !== undefined) {
        if (!isRecord(rawEntry.env) || Object.values(rawEntry.env).some(value => typeof value !== 'string')) {
          errors.push({ name, message: '"env" must be an object of strings' })
          continue
        }
        let failed = false
        for (const [key, value] of Object.entries(rawEntry.env)) {
          const expanded = expandEnv(value as string, name)
          if (!expanded.ok) {
            errors.push({ name, message: expanded.message })
            failed = true
            break
          }
          env[key] = expanded.value
        }
        if (failed) continue
      }
      servers.push({
        name,
        config: {
          transport: 'stdio',
          serverName: name,
          command,
          args,
          env,
          cwd: asString(rawEntry.cwd) ?? workspacePath,
          toolCallTimeoutMs: 60_000,
          failOnStartupError: false,
        },
      })
    } else {
      const url = asString(rawEntry.url)
      if (url === undefined || url.length === 0) {
        errors.push({ name, message: 'http servers require a "url"' })
        continue
      }
      const headers: Record<string, string> = {}
      if (rawEntry.headers !== undefined) {
        if (!isRecord(rawEntry.headers) || Object.values(rawEntry.headers).some(value => typeof value !== 'string')) {
          errors.push({ name, message: '"headers" must be an object of strings' })
          continue
        }
        Object.assign(headers, rawEntry.headers)
      }
      servers.push({
        name,
        config: {
          transport: 'streamable-http',
          serverName: name,
          url,
          headers,
          toolCallTimeoutMs: 60_000,
          failOnStartupError: false,
        },
      })
    }
  }
  return { servers, errors }
}

/** Serialize a server draft back into one mcpServers entry. */
export function draftToEntry(draft: {
  readonly transport: 'stdio' | 'streamable-http'
  readonly command?: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly url?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly cwd?: string
}): Record<string, unknown> {
  if (draft.transport === 'stdio') {
    return {
      type: 'stdio',
      command: draft.command,
      ...(draft.args !== undefined && draft.args.length > 0 ? { args: [...draft.args] } : {}),
      ...(draft.env !== undefined && Object.keys(draft.env).length > 0 ? { env: { ...draft.env } } : {}),
      ...(draft.cwd !== undefined ? { cwd: draft.cwd } : {}),
    }
  }
  return {
    type: 'http',
    url: draft.url,
    ...(draft.headers !== undefined && Object.keys(draft.headers).length > 0 ? { headers: { ...draft.headers } } : {}),
  }
}
