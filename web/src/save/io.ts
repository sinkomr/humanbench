/**
 * Getting a save out of the browser (DESIGN §8 "Download and upload compatibility"):
 * - {@link downloadSave}: `Blob` + `URL.createObjectURL` + `<a download>` (iOS Safari 13+ saves
 *   to Files/Downloads);
 * - {@link shareSave}: the Web Share API with `files` when `navigator.canShare({ files })` allows
 *   it (best on iOS), else a download;
 * - {@link copySaveCode}: the gzip + base64url "copy save code" on the clipboard, returned as well
 *   so the UI can show it for manual copying when the clipboard is refused.
 * - {@link withDeviceBriefPrefs}: the save with the notes settings kept on this device joined in, which the
 *   results page does when the person presses one of those buttons (D17);
 * - {@link saveFileName}: the name carries the person's local day (D19).
 *
 * The file body is the RFC 8785 canonical JSON: deterministic bytes for a given save. The session
 * flow (M1.15) and reveal (M1.R) wire these to buttons; the WebKit/iOS e2e is M1.22.
 *
 * Call `shareSave` and `copySaveCode` directly from a click handler: both reach the gated API
 * (share, clipboard) before their first `await`, so the user activation still holds.
 */

import { autosaveKeys, browserStorage, type StorageLike } from './autosave'
import { mergeBriefPrefs, withBriefPrefs } from './brief-prefs'
import { encodeSaveCode, type CodecOptions } from './codec'
import { parseUtcSeconds } from './clock'
import { jcs } from './jcs'
import { loadSaveDocument } from './parse'
import type { BriefPrefsV1, SaveFileV1 } from './types'
import { validateSave } from './validate'

export const SAVE_MIME = 'application/json'

/** How long a download's object URL stays alive (iOS reads it after the click returns). */
export const REVOKE_AFTER_MS = 60_000

/**
 * `YYYY-MM-DD` in the person's own time zone (the calendar day on their wall clock), for the names of the
 * files they download: a save or a card made at 8 pm in California is not dated tomorrow. It formats the
 * `Date` it is given and reads no clock, so the caller decides what moment it is (a save's `created_utc`,
 * or `wallClockMs()` for a card). A `Date` that is not a real time (NaN) throws a RangeError.
 */
export function localDateStamp(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new RangeError('localDateStamp: not a real time')
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${String(date.getFullYear()).padStart(4, '0')}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
}

/**
 * `humanbench-<shortid>-<YYYY-MM-DD>.hbsave.json` (§8); shortid = the first 6 characters of the id, and the
 * date is the person's own calendar day at `created_utc` (the moment the save was made, which is the moment it
 * is handed over), not the UTC one: a save made at 8 pm in California is not dated tomorrow, and it carries
 * the same day as the share card's file name (`viz/export.ts` cardFileName). A `created_utc` that cannot be
 * read as a time (a hand-edited file) keeps the UTC date it has.
 */
export function saveFileName(save: SaveFileV1): string {
  const shortId = save.anon_id.replace(/^hb_/, '').slice(0, 6)
  const ms = parseUtcSeconds(save.created_utc)
  const day = Number.isNaN(ms) ? save.created_utc.slice(0, 10) : localDateStamp(new Date(ms))
  return `humanbench-${shortId}-${day}.hbsave.json`
}

/**
 * The notes settings kept on this device (`brief_prefs`, R-17.1; the notes page's own autosave and the copy that
 * every session autosave carries), joined exactly as the notes page joins them when it opens (`prefs-store`
 * `load()`: {@link mergeBriefPrefs} over every readable autosave), so that a restore of the saved file gives that
 * page back what it shows. Notes settings belong to the device, as on that page, whichever identifier an autosave
 * carries. Reads storage and never writes it; `undefined` when there are none, or storage is blocked.
 */
export function deviceBriefPrefs(storage: StorageLike | null = browserStorage()): BriefPrefsV1 | undefined {
  if (storage === null) return undefined
  const found: BriefPrefsV1[] = []
  for (const key of autosaveKeys(storage)) {
    let doc: unknown
    try {
      const text = storage.getItem(key)
      if (text === null) continue
      doc = JSON.parse(text)
    } catch {
      continue
    }
    const r = loadSaveDocument(doc, 'json')
    if (r.ok && r.save.brief_prefs !== undefined) found.push(r.save.brief_prefs)
  }
  return mergeBriefPrefs(found)
}

/**
 * The save with the device's notes settings joined into its own (D17: one file per person, so a second device
 * that loads it gets the notes settings back instead of "That save has no notes settings."). `device` is what
 * {@link deviceBriefPrefs} read at the click. The join is the save module's
 * (`mergeBriefPrefs`: the higher edit count wins per set, fit notes are a union), so nothing the save already
 * holds is lost; the content is what `brief_prefs` always is (R-17.12: enums, ids, versions and months, never
 * text the person typed). It is the save itself, not a copy, when the device adds nothing, and when the joined
 * file would not pass the save schema. A file-level `sig` stays: the notes settings are outside its scope (R-17.1).
 */
export function withDeviceBriefPrefs(save: SaveFileV1, device: BriefPrefsV1 | undefined): SaveFileV1 {
  const out = withBriefPrefs(save, device)
  return out === save || validateSave(out).ok ? out : save
}

/** The file body: RFC 8785 JSON (UTF-8 when written into a Blob). */
export function saveText(save: SaveFileV1): string {
  return jcs(save)
}

export interface DownloadEnv {
  document: Pick<Document, 'createElement' | 'body'>
  URL: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>
  setTimeout: (fn: () => void, ms: number) => unknown
}

const defaultDownloadEnv = (): DownloadEnv => ({ document, URL, setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) })

/** Download the save as a JSON file via `<a download>`. Returns the file name. */
export function downloadSave(save: SaveFileV1, env: DownloadEnv = defaultDownloadEnv()): string {
  const name = saveFileName(save)
  const url = env.URL.createObjectURL(new Blob([saveText(save)], { type: SAVE_MIME }))
  const a = env.document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  a.style.display = 'none'
  env.document.body.appendChild(a)
  try {
    a.click()
  } finally {
    a.remove()
    env.setTimeout(() => env.URL.revokeObjectURL(url), REVOKE_AFTER_MS)
  }
  return name
}

export interface ShareEnv extends DownloadEnv {
  navigator: Partial<Pick<Navigator, 'share' | 'canShare'>>
}

const defaultShareEnv = (): ShareEnv => ({ ...defaultDownloadEnv(), navigator })

export type ShareOutcome = 'shared' | 'cancelled' | 'downloaded'

/**
 * Share the save as a file (Web Share API level 2), trying `application/json` and then the same
 * content as `text/plain` (some platforms only share text files; upload parses by content, so a
 * `.txt` copy still loads). Falls back to {@link downloadSave}. A dismissed share sheet is
 * `cancelled` (no download is forced on the person).
 */
export async function shareSave(save: SaveFileV1, env: ShareEnv = defaultShareEnv()): Promise<ShareOutcome> {
  const text = saveText(save)
  const name = saveFileName(save)
  const nav = env.navigator
  if (typeof nav.share === 'function' && typeof nav.canShare === 'function') {
    const candidates = [new File([text], name, { type: SAVE_MIME }), new File([text], name.replace(/\.json$/, '.txt'), { type: 'text/plain' })]
    for (const file of candidates) {
      const data = { files: [file], title: 'HumanBench save' }
      let ok = false
      try {
        ok = nav.canShare(data)
      } catch {
        ok = false
      }
      if (!ok) continue
      try {
        await nav.share(data)
        return 'shared'
      } catch (e) {
        if ((e as { name?: unknown } | null)?.name === 'AbortError') return 'cancelled'
        break
      }
    }
  }
  downloadSave(save, env)
  return 'downloaded'
}

export interface ClipboardEnv {
  clipboard?: Partial<Pick<Clipboard, 'write' | 'writeText'>>
  /** The `ClipboardItem` constructor, where supported. */
  ClipboardItem?: typeof ClipboardItem
}

const defaultClipboardEnv = (): ClipboardEnv => ({
  clipboard: typeof navigator === 'undefined' ? undefined : navigator.clipboard,
  ClipboardItem: typeof ClipboardItem === 'undefined' ? undefined : ClipboardItem,
})

/**
 * Put the copy save code on the clipboard. Where `ClipboardItem` accepts a promise (Safari needs
 * the write to start inside the click), the code is encoded while the write is pending; otherwise
 * `writeText` runs after encoding. Always returns the code; `copied` is false when every clipboard
 * route was refused, and the UI then shows the code for manual copying.
 */
export async function copySaveCode(save: SaveFileV1, env: ClipboardEnv = defaultClipboardEnv(), opts: CodecOptions = {}): Promise<{ code: string; copied: boolean }> {
  const codeP = encodeSaveCode(save, opts)
  const cb = env.clipboard
  if (cb !== undefined && typeof cb.write === 'function' && env.ClipboardItem !== undefined) {
    try {
      const item = new env.ClipboardItem({ 'text/plain': codeP.then((c) => new Blob([c], { type: 'text/plain' })) })
      await cb.write([item])
      return { code: await codeP, copied: true }
    } catch {
      // Fall through to writeText.
    }
  }
  const code = await codeP
  if (cb !== undefined && typeof cb.writeText === 'function') {
    try {
      await cb.writeText(code)
      return { code, copied: true }
    } catch {
      // Refused (no permission or no user activation).
    }
  }
  return { code, copied: false }
}
