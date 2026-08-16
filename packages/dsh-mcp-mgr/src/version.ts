/**
 * Startup self-update check: compare the installed package version against
 * the npm registry's latest tag and report whether an upgrade is available.
 * Every failure path is silent (returns ''/false) so an offline host or a
 * dead proxy never stalls startup or spams the log.
 * @module dsh-mcp-mgr/version
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { McpPluginVersionInfo } from './types.ts'

/** The npm package this plugin ships as. */
const NPM_PACKAGE = 'dsh-mcp-mgr'
/** Project page carrying the update instructions (the README). */
export const UPDATE_URL = 'https://github.com/yangfch3/dsh-mcp-mgr'
/** Cap on the registry request so a dead proxy cannot stall startup. */
const FETCH_TIMEOUT_MS = 5_000

/**
 * Run the startup update check. Never rejects: registry and file failures
 * degrade to a result with '' versions and `updateAvailable: false`.
 */
export function checkPluginVersion(): Promise<McpPluginVersionInfo> {
  return fetchLatestVersion().then(
    latestVersion => buildInfo(latestVersion),
    () => buildInfo(undefined),
  )
}

function buildInfo(latestVersion: string | undefined): McpPluginVersionInfo {
  const localVersion = readLocalVersion()
  const updateAvailable = localVersion !== undefined && latestVersion !== undefined
    && compareVersions(latestVersion, localVersion) > 0
  return {
    localVersion: localVersion ?? '',
    latestVersion: latestVersion ?? '',
    updateAvailable,
    updateUrl: UPDATE_URL,
  }
}

/** Installed package version via self-reference, then direct file reads. */
function readLocalVersion(): string | undefined {
  try {
    const require = createRequire(import.meta.url)
    const pkg = require(`${NPM_PACKAGE}/package.json`) as { version?: unknown }
    return typeof pkg.version === 'string' ? pkg.version : undefined
  } catch {
    // Not resolvable as a package (dev layout): read the file relative to
    // this module (src/ -> ../package.json, lib/types/ -> ../../package.json).
    for (const relative of ['../package.json', '../../package.json']) {
      try {
        const pkg = JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8')) as { version?: unknown }
        if (typeof pkg.version === 'string') return pkg.version
      } catch {
        // try the next layout
      }
    }
    return undefined
  }
}

/** Latest published version from the npm dist-tags endpoint; undefined on any failure. */
async function fetchLatestVersion(): Promise<string | undefined> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  // unref: a startup check must never keep a short-lived host alive.
  timer.unref?.()
  try {
    const response = await fetch(
      `https://registry.npmjs.org/-/package/${NPM_PACKAGE}/dist-tags`,
      { signal: controller.signal },
    )
    if (!response.ok) return undefined
    const body = (await response.json()) as { latest?: unknown }
    return typeof body.latest === 'string' && body.latest !== '' ? body.latest : undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/** Compare two version strings: <0 / 0 / >0. A prerelease sorts below its release. */
function compareVersions(left: string, right: string): number {
  const parse = (version: string): [number[], string] => {
    const [core = '', pre = ''] = version.split('-', 2)
    return [core.split('.').map(part => Number.parseInt(part, 10) || 0), pre]
  }
  const [leftNums, leftPre] = parse(left)
  const [rightNums, rightPre] = parse(right)
  const width = Math.max(leftNums.length, rightNums.length)
  for (let index = 0; index < width; index += 1) {
    const diff = (leftNums[index] ?? 0) - (rightNums[index] ?? 0)
    if (diff !== 0) return diff
  }
  if (leftPre === rightPre) return 0
  if (leftPre === '') return 1
  if (rightPre === '') return -1
  return leftPre < rightPre ? -1 : 1
}
