/**
 * File-change notification for the manager files.
 *
 * chokidar watches each existing `.dsh/dshmm` directory (settings-file
 * precedent). Periodic rescanning — which covers workspaces added after
 * startup, since the workspace registry emits no create/delete events — is
 * owned by the sync loop, not this module.
 * @module dsh-mcp-mgr/watch
 */

import { watch, type FSWatcher } from 'chokidar'
import { dirname } from 'node:path'

export interface FileWatcher {
  /** (Re)arm the watch set for the given manager files. */
  setWatchFiles(files: readonly string[], onChange: () => void): void
  /** Stop watching. */
  dispose(): void
}

/** Debounce window for file-change events. */
export const DEBOUNCE_MS = 300

/**
 * Create the file watcher.
 * @param setDebounceTimer - timeout factory (injected for testability).
 * @param clearDebounceTimer - matching cancel.
 */
export function createFileWatcher(
  setDebounceTimer: (handler: () => void, ms: number) => unknown,
  clearDebounceTimer: (handle: unknown) => void,
): FileWatcher {
  let watcher: FSWatcher | undefined
  let watched = new Set<string>()
  let pending: unknown | undefined

  return {
    setWatchFiles(files, onChange) {
      const next = new Set(files.map(dirname))
      if (watcher === undefined) {
        watcher = watch([...next], { ignoreInitial: true, depth: 0 })
        watcher.on('all', () => {
          if (pending !== undefined) clearDebounceTimer(pending)
          pending = setDebounceTimer(() => {
            pending = undefined
            onChange()
          }, DEBOUNCE_MS)
        })
      } else if (setsEqual(next, watched)) {
        return
      } else {
        void watcher.unwatch([...watched])
        watcher.add([...next])
      }
      watched = next
    },
    dispose() {
      if (pending !== undefined) clearDebounceTimer(pending)
      void watcher?.close()
      watcher = undefined
      watched = new Set()
    },
  }
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false
  for (const value of left) if (!right.has(value)) return false
  return true
}
