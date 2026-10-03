/**
 * What may leave the device (ROADMAP M2.7, AI.26; DESIGN §8, §17.5 R-17.1, R-17.12; ROADMAP A16).
 *
 * The notes settings (`brief_prefs`) never reach the server. Three lines hold that, in this order:
 *
 *   1. {@link toUploadPayload} removes the key from a save before any call that sends one, so a
 *      person's preferences are never in a request body, in the server mirror, or in a log;
 *   2. {@link assertNoBriefPrefs} looks through the arguments of EVERY call, at any depth, just before
 *      the transport sends them, and refuses (a `local` {@link BackendError}) rather than editing a
 *      payload on the quiet. It is the guard for a future caller that forgot step 1;
 *   3. the server rejects a payload that holds the key anywhere (`hb.reject_brief_prefs`, M2.1), and
 *      its mirror table refuses such a blob.
 *
 * The strip never changes what a session's signature covers: the per-session MAC of A16 is over
 * the session's own data and the anon_id it was issued to (`save/mac-input.ts`), and `brief_prefs`
 * is a field of the file around the sessions. So editing preferences never makes a session
 * unverified (AI.26 acceptance; `upload.test.ts` and the database test check it).
 *
 * Two kinds of character are cleaned on the way out, because the database cannot store them and refuses the whole call
 * (HTTP 400, before any function runs; supabase/README.md, Errors). U+0000: JSON (I-JSON, and the save validator) allows
 * it in a string, but PostgreSQL's jsonb and text do not (SQLSTATE 22P05 or 22021); it is removed. A lone UTF-16
 * surrogate, half of a pair with no other half beside it (a string cut in the middle of an emoji, a keyboard's stray
 * unit): JSON.stringify writes it as an escape, and PostgreSQL answers 22P02, "Unicode low surrogate must follow a
 * high surrogate"; it becomes U+FFFD, the replacement character, so the text keeps its length and place. The save
 * validator already refuses a lone surrogate in a file, but a typed answer and the text of a report never pass it.
 * {@link toUploadPayload} cleans every string and object key of a save, and the guarded transport cleans the
 * arguments of every other call (an answer typed into a box, the text of a report), so a stray character in a typed
 * answer cannot make the server refuse a save, a mirror, an answer or a report. A session the server signed never
 * holds either (jsonb cannot), so the cleaning never touches a signature's bytes; a session that held one was never
 * signed.
 *
 * Data minimisation (DESIGN §13, R-12.1): a call that only needs the sessions the server issued
 * sends only those (`signedSessionsOnly`). A session without a signature is the person's own copy
 * (the offline version, the timed tasks that stay on the device in M2) and is of no use to the
 * server for a verification, a re-score or a proof, so it is not uploaded for them. The server
 * mirror is the one exception: it is a backup the person asked for, and holds the whole file
 * (minus the notes settings).
 */

import type { SaveFileV1 } from '../save/types'
import { BackendError } from './errors'

/** The one key that must never be sent. */
export const BRIEF_PREFS_KEY = 'brief_prefs'

/** True when `value` holds an object key `brief_prefs` at any depth (arrays included; cycle-safe, iterative). */
export function hasBriefPrefs(value: unknown): boolean {
  const seen = new Set<object>()
  const stack: unknown[] = [value]
  while (stack.length > 0) {
    const v = stack.pop()
    if (typeof v !== 'object' || v === null || seen.has(v)) continue
    seen.add(v)
    if (Array.isArray(v)) {
      for (const x of v) stack.push(x)
      continue
    }
    for (const k of Object.keys(v)) {
      if (k === BRIEF_PREFS_KEY) return true
      stack.push((v as Record<string, unknown>)[k])
    }
  }
  return false
}

/** Throws a `local` error naming the call if `args` holds a `brief_prefs` key at any depth. */
export function assertNoBriefPrefs(args: unknown, fn: string): void {
  if (hasBriefPrefs(args)) throw new BackendError('local', 'brief_prefs_in_payload', { detail: `${fn}: notes settings stay on this device and are never sent` })
}

/** The character PostgreSQL cannot store in jsonb or text. */
const NUL = '\u0000'
/** What a lone surrogate becomes: the replacement character (PostgreSQL stores it; the text keeps its length). */
const REPLACEMENT = '\ufffd'
/** How deep {@link storable} follows a value that needs cleaning (a real save is under 10; the server refuses more than 24). */
const MAX_CLEAN_DEPTH = 256

const isHigh = (c: number): boolean => c >= 0xd800 && c <= 0xdbff
const isLow = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff

/** True when `s` holds a UTF-16 surrogate unit that is not half of a proper pair. (A loop, not a lookbehind regex: iOS Safari before 16.4 rejects those at parse time.) */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (isHigh(c)) {
      if (!isLow(s.charCodeAt(i + 1))) return true // (NaN past the end is not a low surrogate)
      i++
    } else if (isLow(c)) {
      return true
    }
  }
  return false
}

/** `s` with each lone surrogate unit replaced by U+FFFD; proper pairs are kept. */
function replaceLoneSurrogates(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (isHigh(c) && isLow(s.charCodeAt(i + 1))) {
      out += s.slice(i, i + 2)
      i++
    } else {
      out += isHigh(c) || isLow(c) ? REPLACEMENT : s[i]
    }
  }
  return out
}

/** True when a string holds a character the database cannot store: U+0000 or a lone surrogate. */
const isUnstorable = (s: string): boolean => s.includes(NUL) || hasLoneSurrogate(s)

/** True when a string or an object key anywhere in `value` holds a character the database cannot store: U+0000 or a lone surrogate (arrays and objects, any depth; cycle-safe, iterative). */
export function hasUnstorable(value: unknown): boolean {
  const seen = new Set<object>()
  const stack: unknown[] = [value]
  while (stack.length > 0) {
    const v = stack.pop()
    if (typeof v === 'string') {
      if (isUnstorable(v)) return true
      continue
    }
    if (typeof v !== 'object' || v === null || seen.has(v)) continue
    seen.add(v)
    if (Array.isArray(v)) {
      for (const x of v) stack.push(x)
      continue
    }
    for (const k of Object.keys(v)) {
      if (isUnstorable(k)) return true
      stack.push((v as Record<string, unknown>)[k])
    }
  }
  return false
}

function cleanText(s: string): string {
  if (!isUnstorable(s)) return s
  const noNul = s.includes(NUL) ? s.split(NUL).join('') : s
  return hasLoneSurrogate(noNul) ? replaceLoneSurrogates(noNul) : noNul
}

function clean(v: unknown, depth: number): unknown {
  if (typeof v === 'string') return cleanText(v)
  if (typeof v !== 'object' || v === null) return v
  if (depth > MAX_CLEAN_DEPTH) throw new BackendError('local', 'payload_too_deep', { detail: 'a value nested more than 256 levels cannot be cleaned of characters the database cannot store, and is not sent' })
  let changed = false
  if (Array.isArray(v)) {
    const out = v.map((x) => {
      const y = clean(x, depth + 1)
      if (y !== x) changed = true
      return y
    })
    return changed ? out : v
  }
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    const key = cleanText(k)
    const y = clean(x, depth + 1)
    if (key !== k || y !== x) changed = true
    // defineProperty, not assignment: a key "__proto__" read from JSON must stay a key
    Object.defineProperty(out, key, { value: y, enumerable: true, writable: true, configurable: true })
  }
  return changed ? out : v
}

/**
 * `value` with every character the database cannot store taken out of each string and object key: U+0000 is removed
 * and a lone surrogate becomes U+FFFD. Pure: the input is not modified, and anything that holds none comes back as
 * the very same object (so the sessions of a save, and with them their signatures, stay byte for byte). Two keys that
 * differ only by those characters merge, the later one winning. Throws a `local` {@link BackendError} for a value that
 * needs cleaning and is nested deeper than 256 levels.
 */
export function storable<T>(value: T): T {
  return hasUnstorable(value) ? (clean(value, 0) as T) : value
}

/**
 * The save as it may be uploaded: `brief_prefs` removed from the file, and the characters the database refuses
 * (U+0000, lone surrogates; {@link storable}) taken out of every string and key. Pure; the input is not modified and,
 * when nothing has to go, the sessions are the same objects (so their bytes, and their signatures, are untouched).
 */
export function toUploadPayload(save: SaveFileV1): SaveFileV1 {
  // the characters first: a key such as "brief_<U+0000>prefs" is the notes key once it is gone
  const cleaned = storable(save)
  return Object.hasOwn(cleaned, BRIEF_PREFS_KEY) ? omitPrefs(cleaned) : cleaned
}

function omitPrefs(save: SaveFileV1): SaveFileV1 {
  const { brief_prefs: _prefs, ...rest } = save
  return rest
}

/**
 * {@link toUploadPayload}, only the sessions that carry the server's signature, and not the posterior
 * cache: it summarises every session of the file, the unsigned ones (the timed tasks, which stay on the
 * device) included, so it would carry their estimates to the server. The server scores from its own rows.
 */
export function signedSessionsOnly(save: SaveFileV1): SaveFileV1 {
  const { posterior_cache: _cache, ...payload } = toUploadPayload(save)
  return { ...payload, sessions: payload.sessions.filter((s) => s.sig !== undefined) }
}

/** The save with `anon_id` set to `anonId` (the server mirror and its proofs name the id a session was issued to). */
export function withAnonId(save: SaveFileV1, anonId: string): SaveFileV1 {
  return save.anon_id === anonId ? save : { ...save, anon_id: anonId }
}
