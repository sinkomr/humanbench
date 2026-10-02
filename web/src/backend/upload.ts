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

/**
 * The save as it may be uploaded: `brief_prefs` removed from the file. Pure; the input is not
 * modified and the sessions are the same objects (so their bytes, and their signatures, are
 * untouched).
 */
export function toUploadPayload(save: SaveFileV1): SaveFileV1 {
  if (!Object.hasOwn(save, BRIEF_PREFS_KEY)) return save
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
