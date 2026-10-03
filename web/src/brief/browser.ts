/**
 * The two things the builder page does with the notes: copy them to the clipboard, and hand them
 * over as a file. Neither is storage or network. Both are called straight from a click handler, so
 * the user activation that iOS Safari and WebKit require is still in force.
 *
 * Copy tries the async Clipboard API first and falls back to selecting a temporary text box and
 * `execCommand('copy')`, which older WebKit builds still need. If both are refused the caller shows
 * the notes selected for manual copying. Download is a Blob and `<a download>`, like the save file
 * (`save/io.ts`, DESIGN §8): it works on iOS Safari 13 and later.
 */

export interface CopyEnv {
  readonly clipboard?: Partial<Pick<Clipboard, 'writeText'>>
  readonly document: Pick<Document, 'createElement' | 'body' | 'execCommand' | 'activeElement'>
}

const defaultCopyEnv = (): CopyEnv => ({ clipboard: typeof navigator === 'undefined' ? undefined : navigator.clipboard, document })

/** Put `text` on the clipboard. Resolves to whether any route worked. */
export async function copyText(text: string, env: CopyEnv = defaultCopyEnv()): Promise<boolean> {
  if (typeof env.clipboard?.writeText === 'function') {
    try {
      await env.clipboard.writeText(text)
      return true
    } catch {
      // fall through to the selection route
    }
  }
  const doc = env.document
  const box = doc.createElement('textarea')
  box.value = text
  box.setAttribute('readonly', '')
  box.setAttribute('aria-hidden', 'true')
  box.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none'
  const previous = doc.activeElement as HTMLElement | null
  doc.body.appendChild(box)
  try {
    box.select()
    box.setSelectionRange(0, text.length)
    return doc.execCommand('copy')
  } catch {
    return false
  } finally {
    box.remove()
    previous?.focus?.()
  }
}

export interface DownloadEnv {
  readonly document: Pick<Document, 'createElement' | 'body'>
  readonly URL: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>
  readonly setTimeout: (fn: () => void, ms: number) => unknown
}

const defaultDownloadEnv = (): DownloadEnv => ({ document, URL, setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) })

/** How long the object URL stays alive after the click (iOS reads it after the handler returns). */
export const REVOKE_AFTER_MS = 60_000

/** Download `text` as a file called `name` (UTF-8, `mime`). Returns the name. */
export function downloadText(text: string, name: string, mime: string, env: DownloadEnv = defaultDownloadEnv()): string {
  const url = env.URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }))
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

/**
 * A short random token for unique download names (`k3f9`), drawn from the browser's crypto: a lower-case letter, then a digit,
 * alternating. No two letters ever touch, so the name the page shows can never spell a word the language lint bans (A13, R-5.6.1;
 * every banned term is two or more letters, and digits delimit): a free draw once showed `hb-notes-2026-10-iq5y.txt`.
 */
export function fileToken(length = 4, source: Pick<Crypto, 'getRandomValues'> = crypto): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  const digits = '0123456789'
  const bytes = source.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b, i) => {
    const set = i % 2 === 0 ? letters : digits
    return set.charAt(b % set.length)
  }).join('')
}

/** `length` random lowercase hex digits from the browser's crypto (fit note ids). */
export function hexToken(length = 6, source: Pick<Crypto, 'getRandomValues'> = crypto): string {
  const bytes = source.getRandomValues(new Uint8Array(Math.ceil(length / 2)))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, length)
}
