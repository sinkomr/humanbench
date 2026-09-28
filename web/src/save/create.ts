/**
 * Building the unsigned MVP save from the running session (DESIGN §8, §14.3 M1 "save file
 * (unsigned)", ROADMAP A16: no `sig` is ever written client-side, so the file is unverified).
 *
 * The session flow (M1.15) keeps a {@link SessionState}; after every item it asks for
 * {@link saveWithSession}`(base, state, …)`, where `base` is the save the person started from
 * (uploaded, or restored from autosave) or null. The result is the normal form of
 * `base ∪ this session`, so it merges idempotently with every earlier copy (`merge.ts`).
 */

import type { ResponseTuple } from '../engine/types'
import { utcSeconds } from './clock'
import { isUsableCache, mergeAll } from './merge'
import { SCHEMA_URL, SCHEMA_VERSION, type DeviceInfo, type PosteriorCache, type SaveContext, type SaveFileV1, type SaveSession, type SessionFlags } from './types'
import { assertValidSave } from './validate'

/** The running session as the session flow tracks it (TS-side; the file itself is snake_case). */
export interface SessionState {
  sessionId: string
  /** Wall-clock epoch ms at session start (`clock.ts`; metadata only). */
  startedMs: number
  /** Active session time in seconds, measured with `performance.now()`. */
  durationS: number
  device: DeviceInfo
  flags: SessionFlags
  responses: readonly ResponseTuple[]
  seenItems: readonly string[]
  seenFamilies: readonly string[]
}

export interface SaveMeta {
  ctx: SaveContext
  /** Wall-clock epoch ms of this write (`created_utc`). */
  createdMs: number
  /** Used only when there is no `base` save; otherwise the base's id is kept. */
  anonId?: string
  /**
   * Posterior over every session of the result (base + this one), if the caller scored it. Kept
   * only if its `param_version` is `ctx.param_version` and its shapes are consistent.
   */
  posteriorCache?: PosteriorCache
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** The §8 session record for `state` (deep-copied; no `sig`). */
export function sessionFromState(state: SessionState): SaveSession {
  return {
    session_id: state.sessionId,
    started_utc: utcSeconds(state.startedMs),
    duration_s: Math.round(Math.max(0, state.durationS)),
    device: clone(state.device),
    flags: clone(state.flags),
    responses: clone([...state.responses]),
  }
}

/**
 * The save holding `base` (or nothing) plus the current snapshot of `state`, normalised and
 * validated. The snapshot replaces any earlier copy of the same session in `base`. Throws a
 * TypeError if the result is not a valid v1 save (a programming error in the caller's state).
 */
export function saveWithSession(base: SaveFileV1 | null, state: SessionState, meta: SaveMeta): SaveFileV1 {
  const anonId = base?.anon_id ?? meta.anonId
  if (anonId === undefined) throw new TypeError('saveWithSession: anonId is required when there is no base save')
  const session = sessionFromState(state)
  const doc: SaveFileV1 = {
    $schema: SCHEMA_URL,
    schema_version: SCHEMA_VERSION,
    bank_version: meta.ctx.bank_version,
    anon_id: anonId,
    created_utc: utcSeconds(meta.createdMs),
    sessions: [...(base?.sessions ?? []).filter((s) => s.session_id !== state.sessionId), session],
    seen_items: [...(base?.seen_items ?? []), ...state.seenItems],
    seen_families: [...(base?.seen_families ?? []), ...state.seenFamilies],
  }
  if (isUsableCache(meta.posteriorCache, meta.ctx.param_version)) doc.posterior_cache = clone(meta.posteriorCache)
  assertValidSave(doc)
  return mergeAll([doc], meta.ctx)
}
