/**
 * Where the notes builder keeps its settings (Phase AI, ROADMAP AI.7; proposal §3.3 "Age gate and
 * storage", §5.5; requirements R-17.1, R-17.12). The settings are the `brief_prefs` of a save file
 * (Q3, default: an optional field of save 1.0), so they go where saves go: one autosave in
 * `localStorage`, `hb:save:v1:prefs`, holding a **prefs-only save** (`sessions: []`, the `anon_id`
 * minted on the first write or taken from the saves already on the device). Every other reader of
 * autosaves (`restoreAutosaves`, the session flow, "forget my data") sees it like any save, and a
 * merge joins it with a save that has sessions (`save/merge.ts`).
 *
 * - **Nothing is written before the first `write`**, which the page calls only after the person said
 *   they are 18 or older. Creating the store and loading read storage and never write it (the
 *   under-18 path writes nothing; `e2e/notes.spec.ts` checks the storage stays empty).
 * - **Only settings are stored:** the argument of `write` is the stored form (`brief/stored.ts`);
 *   interests, own lines and notes never reach this module.
 * - Writes are coalesced by the save module's autosaver and flushed when the page is hidden.
 *   A blocked or full storage is reported through `status()`; the page goes on and still offers the
 *   download.
 * - **Remove** deletes the prefs autosave and strips `brief_prefs` from every other autosave on the
 *   device (a session autosave carries the settings of the save it started from). Copies the person
 *   downloaded are theirs and are left alone.
 * - The settings never go anywhere: no network API is named here (`scripts/brief-source.test.ts`
 *   scans this folder too), and M2's upload strip is `toUploadPayload()` (AI.26).
 *
 * This module reads no clock of its own: the wall clock comes in as `wallClockMs`.
 */

import type { NotesStore, ImportOutcome, StoreStatus } from '../brief/store-types'
import type { StoredPrefs } from '../brief/stored'
import { autosaveKey, autosaveKeys, bindFlushOnHide, browserStorage, createAutosaver, restoreAutosaves, type Autosaver, type StorageLike } from '../save/autosave'
import { restoreBriefPrefs } from '../save/brief-prefs'
import { utcSeconds } from '../save/clock'
import { newAnonId } from '../save/ids'
import { downloadSave, type DownloadEnv } from '../save/io'
import { jcs } from '../save/jcs'
import { mergeAll } from '../save/merge'
import { readSaveFile, parseSaveText } from '../save/parse'
import { SCHEMA_URL, SCHEMA_VERSION, type SaveContext, type SaveFileV1 } from '../save/types'
import { assertValidSave } from '../save/validate'

/** The "session id" of the settings autosave: its key is `hb:save:v1:prefs`. */
export const PREFS_AUTOSAVE_ID = 'prefs'

/**
 * The versions a save written from the notes page is stamped with. The same values as the session
 * flow's (`session/constants.ts` SAVE_CTX, M1.15); a merge restamps a save with the running app's
 * context, so the stamp only matters for a file downloaded from this page.
 */
export const STATIC_SAVE_CTX: SaveContext = Object.freeze({ bank_version: 'm1-static', param_version: 'm1-provisional' })

export interface PrefsStoreOptions {
  /** Default: `localStorage`, or none when the browser blocks it. */
  readonly storage?: StorageLike | null
  /** Wall-clock epoch ms, for `created_utc` only (`save/clock.ts`). */
  readonly wallClockMs: () => number
  readonly ctx?: SaveContext
  readonly delayMs?: number
  readonly setTimer?: (fn: () => void, ms: number) => unknown
  readonly clearTimer?: (handle: unknown) => void
  /** Flush a pending write when the page is hidden (default true; tests turn it off). */
  readonly bindHide?: boolean
  /** Download environment (tests). */
  readonly downloadEnv?: DownloadEnv
  readonly newAnonId?: () => string
}

export interface LoadedPrefs {
  /** The settings kept on this device (every autosave joined), or null when there are none. */
  readonly prefs: StoredPrefs | null
  /** The saves on this device joined, or null when there are none. */
  readonly save: SaveFileV1 | null
}

export interface PrefsStore extends NotesStore {
  /** Read what the device holds. Reads storage; never writes it. */
  load(): LoadedPrefs
}

/** A save holding only these settings (sessions: []). */
export function prefsOnlySave(prefs: StoredPrefs, anonId: string, createdMs: number, ctx: SaveContext = STATIC_SAVE_CTX): SaveFileV1 {
  const doc: SaveFileV1 = {
    $schema: SCHEMA_URL,
    schema_version: SCHEMA_VERSION,
    bank_version: ctx.bank_version,
    anon_id: anonId,
    created_utc: utcSeconds(createdMs),
    sessions: [],
    seen_items: [],
    seen_families: [],
    brief_prefs: prefs,
  }
  assertValidSave(doc)
  return mergeAll([doc], ctx)
}

export function createPrefsStore(opts: PrefsStoreOptions): PrefsStore {
  const storage = opts.storage === undefined ? browserStorage() : opts.storage
  const ctx = opts.ctx ?? STATIC_SAVE_CTX
  const mintAnonId = opts.newAnonId ?? newAnonId
  let anonId: string | null = null
  let saver: Autosaver | null = null
  let last: StoreStatus = 'ok'
  const listeners = new Set<(s: StoreStatus) => void>()
  const setStatus = (s: StoreStatus): void => {
    last = s
    for (const l of listeners) l(s)
  }

  /** The saves on the device, joined. */
  const restored = (): SaveFileV1 | null => restoreAutosaves(ctx, storage).save

  const ensureSaver = (): Autosaver => {
    if (saver !== null) return saver
    saver = createAutosaver(PREFS_AUTOSAVE_ID, {
      storage,
      ...(opts.delayMs === undefined ? {} : { delayMs: opts.delayMs }),
      ...(opts.setTimer === undefined ? {} : { setTimer: opts.setTimer }),
      ...(opts.clearTimer === undefined ? {} : { clearTimer: opts.clearTimer }),
      onError: (e) => setStatus(e.kind === 'unavailable' ? 'unavailable' : 'error'),
      onSaved: () => setStatus('ok'),
    })
    if (opts.bindHide !== false) bindFlushOnHide(saver)
    return saver
  }

  return {
    available: storage !== null,

    load(): LoadedPrefs {
      const save = restored()
      if (save !== null) anonId = save.anon_id
      return { prefs: save?.brief_prefs ?? null, save }
    },

    write(prefs: StoredPrefs): void {
      if (storage === null) {
        setStatus('unavailable')
        return
      }
      anonId ??= restored()?.anon_id ?? mintAnonId()
      const id = anonId
      ensureSaver().schedule(() => prefsOnlySave(prefs, id, opts.wallClockMs(), ctx))
    },

    flush(): void {
      saver?.flush()
    },

    status(): StoreStatus {
      return storage === null ? 'unavailable' : last
    },

    onStatus(listener: (s: StoreStatus) => void): () => void {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },

    download(prefs: StoredPrefs | null): string {
      const now = restored()
      const own = prefs === null ? null : prefsOnlySave(prefs, now?.anon_id ?? anonId ?? mintAnonId(), opts.wallClockMs(), ctx)
      const parts = [now, own].filter((s): s is SaveFileV1 => s !== null)
      if (parts.length === 0) throw new RangeError('download: no settings to put in a save')
      return downloadSave(mergeAll(parts, ctx), opts.downloadEnv)
    },

    async importSave(input: Blob | string, current: StoredPrefs | null): Promise<ImportOutcome> {
      const r = typeof input === 'string' ? await parseSaveText(input) : await readSaveFile(input)
      if (!r.ok) return { ok: false, message: r.message }
      const loaded = r.save.brief_prefs
      if (loaded === undefined) return { ok: false, message: 'That save has no notes settings.', none: true }
      // A restore: the loaded sets win over the page's sets in the same slot (the revs of two devices are not comparable).
      const restored = restoreBriefPrefs(current ?? undefined, loaded)
      return restored.changed ? { ok: true, prefs: restored.prefs } : { ok: true, prefs: restored.prefs, unchanged: true }
    },

    remove(): boolean {
      saver?.cancel()
      if (storage === null) return false
      for (const key of autosaveKeys(storage)) {
        try {
          if (key === autosaveKey(PREFS_AUTOSAVE_ID)) {
            storage.removeItem(key)
            continue
          }
          const text = storage.getItem(key)
          if (text === null) continue
          const doc = JSON.parse(text) as Record<string, unknown> | null
          if (doc === null || typeof doc !== 'object' || !('brief_prefs' in doc)) continue
          delete doc.brief_prefs
          storage.setItem(key, jcsOrJson(doc))
        } catch {
          // Leave what cannot be read or changed; nothing else is touched.
        }
      }
      anonId = null
      setStatus('ok')
      // What is left is a save with test answers (or nothing): the page offers a fresh download of it.
      return restored() !== null
    },
  }
}

function jcsOrJson(doc: Record<string, unknown>): string {
  try {
    return jcs(doc)
  } catch {
    return JSON.stringify(doc)
  }
}
