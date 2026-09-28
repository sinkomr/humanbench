/**
 * Crash-recovery autosave to `localStorage` (DESIGN §8: "autosave to localStorage after every
 * item, keyed by session_id").
 *
 * - One key per session, `hb:save:v1:<session_id>`, whose value is a complete v1 save (RFC 8785
 *   JSON) holding that session and whatever the person started from. Restoring merges every
 *   autosave (R-8.1), so overlapping copies are harmless.
 * - Writes are coalesced: the first change arms a timer, later changes before it fires ride along,
 *   so a write lands at most `delayMs` after any change; {@link bindFlushOnHide} flushes on
 *   `pagehide` / hidden visibility.
 * - Storage can be missing, blocked (Safari private mode, disabled cookies: the accessor throws)
 *   or full. Every access is in try/catch; failures go to `onError` and never throw into the
 *   session. On a quota error, autosaves whose data the new save already holds are removed and the
 *   write is retried once; nothing else is ever deleted.
 * - Nothing is written before the caller creates an autosaver, so the under-18 path (M1.15, §13)
 *   writes nothing by simply never creating one.
 */

import { jcs } from './jcs'
import { distinctAnonIds, mergeAll, subsumes } from './merge'
import type { Migration } from './migrate'
import { loadSaveDocument, type ParseErrorCode } from './parse'
import type { SaveContext, SaveFileV1 } from './types'

/** Key prefix; the session id follows. The `v1` is the key layout, not the schema version. */
export const AUTOSAVE_PREFIX = 'hb:save:v1:'

/** Default coalescing delay. Items take seconds, so this costs at most one item on a crash. */
export const AUTOSAVE_DELAY_MS = 250

/** The part of the Web Storage API used here. */
export interface StorageLike {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** `localStorage`, or null when it is missing or its accessor throws (blocked storage). */
export function browserStorage(): StorageLike | null {
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage ?? null
  } catch {
    return null
  }
}

/** True for the quota errors of every engine (name or legacy code). */
export function isQuotaError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false
  const { name, code } = e as { name?: unknown; code?: unknown }
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014
}

export function autosaveKey(sessionId: string): string {
  return AUTOSAVE_PREFIX + sessionId
}

/** Autosave keys present in `storage` (empty if it cannot be read). */
export function autosaveKeys(storage: StorageLike | null = browserStorage()): string[] {
  if (storage === null) return []
  const keys: string[] = []
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i)
      if (k !== null && k.startsWith(AUTOSAVE_PREFIX)) keys.push(k)
    }
  } catch {
    return []
  }
  return keys.sort()
}

interface LoadedAutosave {
  key: string
  save?: SaveFileV1
  code?: ParseErrorCode | 'read_failed'
}

function loadAutosave(storage: StorageLike, key: string, migrations?: ReadonlyMap<number, Migration>): LoadedAutosave {
  let text: string | null
  try {
    text = storage.getItem(key)
  } catch {
    return { key, code: 'read_failed' }
  }
  if (text === null) return { key, code: 'empty' }
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    return { key, code: 'not_a_save' }
  }
  const r = loadSaveDocument(doc, 'json', migrations === undefined ? {} : { migrations })
  return r.ok ? { key, save: r.save } : { key, code: r.code }
}

/**
 * Remove every autosave (other than `exceptKey`) whose data `save` already holds. Unreadable or
 * newer-version entries are left alone. Returns the removed keys.
 */
export function pruneAutosaves(save: SaveFileV1, storage: StorageLike | null = browserStorage(), exceptKey?: string): string[] {
  if (storage === null) return []
  const removed: string[] = []
  for (const key of autosaveKeys(storage)) {
    if (key === exceptKey) continue
    const got = loadAutosave(storage, key)
    if (got.save === undefined || !subsumes(save, got.save)) continue
    try {
      storage.removeItem(key)
      removed.push(key)
    } catch {
      // Leave it: a failed removal loses nothing.
    }
  }
  return removed
}

/** Remove one session's autosave (e.g. after the person downloaded the save). */
export function clearAutosave(sessionId: string, storage: StorageLike | null = browserStorage()): boolean {
  if (storage === null) return false
  try {
    storage.removeItem(autosaveKey(sessionId))
    return true
  } catch {
    return false
  }
}

export interface RestoreResult {
  /** All readable autosaves merged (R-8.1) under `ctx`, or null if there were none. */
  save: SaveFileV1 | null
  /** Keys that were read and merged. */
  keys: string[]
  /** Keys that could not be used, with why; they are left in storage. */
  failures: { key: string; code: ParseErrorCode | 'read_failed' }[]
  /**
   * Distinct `anon_id`s of the merged autosaves (sorted). More than one means `save` combines
   * saves issued to different ids, e.g. two people on a shared device, or one person who started
   * fresh and then loaded an old file; the session flow (M1.15) should ask before keeping it.
   */
  anonIds: string[]
}

/** Read and merge every autosave (crash recovery on load). Never throws. */
export function restoreAutosaves(
  ctx: SaveContext,
  storage: StorageLike | null = browserStorage(),
  migrations?: ReadonlyMap<number, Migration>,
): RestoreResult {
  const result: RestoreResult = { save: null, keys: [], failures: [], anonIds: [] }
  if (storage === null) return result
  const saves: SaveFileV1[] = []
  for (const key of autosaveKeys(storage)) {
    const got = loadAutosave(storage, key, migrations)
    if (got.save !== undefined) {
      saves.push(got.save)
      result.keys.push(key)
    } else {
      result.failures.push({ key, code: got.code ?? 'read_failed' })
    }
  }
  if (saves.length > 0) {
    try {
      result.save = mergeAll(saves, ctx)
      result.anonIds = distinctAnonIds(saves)
    } catch {
      result.failures.push(...result.keys.map((key) => ({ key, code: 'invalid' as const })))
      result.keys = []
    }
  }
  return result
}

export type AutosaveErrorKind = 'unavailable' | 'quota' | 'write_failed' | 'build_failed'

export interface AutosaveError {
  kind: AutosaveErrorKind
  key: string
  error?: unknown
}

export interface AutosaverOptions {
  /** Default: {@link browserStorage}(). */
  storage?: StorageLike | null
  delayMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  onError?: (e: AutosaveError) => void
  /** Called after each successful write with the key and the value's length in UTF-16 units. */
  onSaved?: (key: string, chars: number) => void
}

export interface Autosaver {
  readonly key: string
  /** True while a change is waiting for the timer. */
  readonly pending: boolean
  /** Record a change; `build` runs at write time and returns the full save to store. */
  schedule(build: () => SaveFileV1): void
  /** Write the pending change now. True if it was written or nothing was pending. */
  flush(): boolean
  /** Drop the pending change without writing it. */
  cancel(): void
}

/** An autosaver for one session (see the module comment). */
export function createAutosaver(sessionId: string, opts: AutosaverOptions = {}): Autosaver {
  const key = autosaveKey(sessionId)
  const storage = opts.storage === undefined ? browserStorage() : opts.storage
  const delay = opts.delayMs ?? AUTOSAVE_DELAY_MS
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number): unknown => globalThis.setTimeout(fn, ms))
  const clearTimer = opts.clearTimer ?? ((h: unknown): void => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>))
  const report = (e: AutosaveError): void => {
    try {
      opts.onError?.(e)
    } catch {
      // A failing error handler must not break the session.
    }
  }
  let build: (() => SaveFileV1) | null = null
  let timer: unknown = null

  const write = (save: SaveFileV1): boolean => {
    if (storage === null) {
      report({ kind: 'unavailable', key })
      return false
    }
    let text: string
    try {
      text = jcs(save)
    } catch (error) {
      report({ kind: 'build_failed', key, error })
      return false
    }
    const attempt = (): unknown => {
      try {
        storage.setItem(key, text)
        return null
      } catch (error) {
        return error ?? new Error('setItem failed')
      }
    }
    let err = attempt()
    if (err !== null && isQuotaError(err)) {
      pruneAutosaves(save, storage, key)
      err = attempt()
    }
    if (err !== null) {
      report({ kind: isQuotaError(err) ? 'quota' : 'write_failed', key, error: err })
      return false
    }
    try {
      opts.onSaved?.(key, text.length)
    } catch {
      // Ignore: the write succeeded.
    }
    return true
  }

  const self: Autosaver = {
    key,
    get pending() {
      return build !== null
    },
    schedule(b) {
      build = b
      if (timer === null) {
        timer = setTimer(() => {
          timer = null
          self.flush()
        }, delay)
      }
    },
    flush() {
      if (timer !== null) {
        clearTimer(timer)
        timer = null
      }
      const b = build
      build = null
      if (b === null) return true
      let save: SaveFileV1
      try {
        save = b()
      } catch (error) {
        report({ kind: 'build_failed', key, error })
        return false
      }
      return write(save)
    },
    cancel() {
      if (timer !== null) clearTimer(timer)
      timer = null
      build = null
    },
  }
  return self
}

/** Minimal event-target shapes, so tests can pass fakes. */
interface Listenable {
  addEventListener(type: string, fn: () => void): void
  removeEventListener(type: string, fn: () => void): void
}

/**
 * Flush `saver` when the page is hidden or unloaded (`visibilitychange` → hidden, `pagehide`;
 * iOS Safari fires `pagehide` but not `beforeunload`). Returns a function that unbinds.
 */
export function bindFlushOnHide(
  saver: Autosaver,
  win: Listenable | undefined = globalThis as unknown as Listenable,
  doc: (Listenable & { visibilityState?: string }) | undefined = (globalThis as { document?: Listenable & { visibilityState?: string } }).document,
): () => void {
  const onHide = (): void => {
    saver.flush()
  }
  const onVisibility = (): void => {
    if (doc?.visibilityState === 'hidden') saver.flush()
  }
  win?.addEventListener('pagehide', onHide)
  doc?.addEventListener('visibilitychange', onVisibility)
  return () => {
    win?.removeEventListener('pagehide', onHide)
    doc?.removeEventListener('visibilitychange', onVisibility)
  }
}
