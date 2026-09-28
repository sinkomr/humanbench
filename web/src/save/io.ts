/**
 * Getting a save out of the browser (DESIGN §8 "Download and upload compatibility"):
 * - {@link downloadSave}: `Blob` + `URL.createObjectURL` + `<a download>` (iOS Safari 13+ saves
 *   to Files/Downloads);
 * - {@link shareSave}: the Web Share API with `files` when `navigator.canShare({ files })` allows
 *   it (best on iOS), else a download;
 * - {@link copySaveCode}: the gzip + base64url "copy save code" on the clipboard, returned as well
 *   so the UI can show it for manual copying when the clipboard is refused.
 * The file body is the RFC 8785 canonical JSON: deterministic bytes for a given save. The session
 * flow (M1.15) and reveal (M1.R) wire these to buttons; the WebKit/iOS e2e is M1.22.
 *
 * Call `shareSave` and `copySaveCode` directly from a click handler: both reach the gated API
 * (share, clipboard) before their first `await`, so the user activation still holds.
 */

import { encodeSaveCode, type CodecOptions } from './codec'
import { jcs } from './jcs'
import type { SaveFileV1 } from './types'

export const SAVE_MIME = 'application/json'

/** How long a download's object URL stays alive (iOS reads it after the click returns). */
export const REVOKE_AFTER_MS = 60_000

/** `humanbench-<shortid>-<YYYY-MM-DD>.hbsave.json` (§8); shortid = the first 6 characters of the id. */
export function saveFileName(save: SaveFileV1): string {
  const shortId = save.anon_id.replace(/^hb_/, '').slice(0, 6)
  return `humanbench-${shortId}-${save.created_utc.slice(0, 10)}.hbsave.json`
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
