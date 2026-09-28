/**
 * Re-scoring a save file from its raw responses with the retest model (DESIGN §7.8, §8 merge
 * step 3; ROADMAP M1.Q, A11, A18).
 *
 * {@link rescoreSessions} turns every session's §8 response tuples into scorer observations and
 * hands them, session by session, to the engine's retest scorer (`engine/retest.ts`): each
 * observation is re-expressed on the trait θ_k by the practice gain ρ_k(s) of its session's test
 * number s on that axis, and all sessions are scored together under the population prior. The
 * result is the practice-adjusted posterior (§7.8: show "practice-adjusted"), the per-session
 * test numbers and gains, and every response that could not be scored, with the reason.
 *
 * Responses → observations ({@link registryObservation}, the default resolver):
 * - a pretest response (`pretest` = 1) is skipped: pretest items carry no scoring weight (§6.iii);
 * - the item is regenerated from its id with `resolveItem` (A11, A18: exact generator version).
 *   An id this build cannot regenerate is skipped as `unresolved`; its params must come from the
 *   server or a kept payload (M2), and the resolver is injectable for that;
 * - an item (kind 'item', A9 models) is re-scored from the stored response with the family's
 *   `score()` — raw data are authoritative (§7.8) — and becomes a 2PL (also 2PL-testlet) or 3PL
 *   observation with the item's params. When the stored response is not one the family accepts
 *   (e.g. a time-out with no answer, `MalformedResponseError`), the stored `correct` stands (§8:
 *   stored for offline re-scoring); with no stored `correct` either, the response is skipped;
 * - a block (kind 'block', A10) is scored with the family's `score()`: its GRM or Gaussian
 *   observation, or `no_observation` with the block's reasons (e.g. too few valid RT trials).
 *   Writers put the block's response object (e.g. `RtResponse`) in the tuple's `response`; the
 *   §8 example's layout, `response` = "trials" with the trial data in `extra`, is read too
 *   ({@link blockResponseOf}; convention in `engine/types.ts` `ResponseTuple`).
 *
 * Test numbers count exposure, not scorability (engine/retest.ts): every skipped response still
 * marks its session as having taken the item's axis (`exposed_axes`), taken from the resolver's
 * answer or else from the family named in the id ({@link itemAxis}; e.g. an id from before a
 * generator bump). So a session whose items this build cannot regenerate, or that was pretest
 * only, is still a test of the axis, and the next session's practice gain does not depend on the
 * build that re-scores.
 *
 * Not re-exported from the save barrel: this module imports the task registry (every family and
 * the reading passages), and the barrel must stay light (`scripts/bundle.test.ts`). Import
 * `save/rescore` explicitly.
 */

import { AXIS_CODES, N_AXES, type AxisCode } from '../engine/axes'
import { rescoreRetest, type RetestOptions, type RetestScore, type RetestSession } from '../engine/retest'
import type { JsonValue, Observation, ResponseTuple } from '../engine/types'
import { MalformedResponseError, type AnyFamily, type ItemInstance } from '../tasks/family'
import { parseItemId } from '../tasks/ids'
import { getFamily, resolveItem } from '../tasks/registry'
import type { PosteriorCache, SaveFileV1 } from './types'

/** Why a response yields no observation. */
export type SkipReason = 'pretest' | 'unresolved' | 'unscored' | 'malformed' | 'no_observation'

/**
 * A resolver's answer for one response tuple. A skip may name the item's axis (e.g. a resolver
 * with server metadata for an unregistered family); otherwise {@link itemAxis} is used.
 */
export type ResolvedResponse = { readonly observation: Observation } | { readonly skip: SkipReason; readonly detail?: string; readonly axis?: AxisCode }

/** Response tuple → observation (default {@link registryObservation}). */
export type ResponseResolver = (t: ResponseTuple) => ResolvedResponse

/** A response that was not scored, located in the save. */
export interface SkippedResponse {
  readonly session_id: string
  /** Index in the session's `responses`. */
  readonly index: number
  readonly item_id: string
  readonly reason: SkipReason
  readonly detail?: string
}

export interface RescoreOptions extends RetestOptions {
  /** Default {@link registryObservation}. */
  readonly resolve?: ResponseResolver
}

/** {@link rescoreSessions}'s result: the retest score plus what was left out. */
export interface SaveRescore extends RetestScore {
  readonly n_scored: number
  readonly skipped: SkippedResponse[]
}

function itemObservation(item: ItemInstance<object, object>, y: 0 | 1): ResolvedResponse {
  const p = item.params
  switch (p.model) {
    case '2pl':
    case '2pl_testlet': // scored as a 2PL observation; the testlet effect is the scorer's (M3.9)
      return { observation: { kind: '2pl', axis: item.axis, a: p.a, b: p.b, y } }
    case '3pl':
      return { observation: { kind: '3pl', axis: item.axis, a: p.a, b: p.b, c: p.c, y } }
    default:
      return { skip: 'no_observation', detail: `an item with a ${p.model} model` }
  }
}

/** The §8 example's block layout: `response` = "trials" with the trial data in `extra`. */
export const BLOCK_IN_EXTRA = 'trials'

/**
 * A block tuple's response object: `response`, or `extra` when `response` is
 * {@link BLOCK_IN_EXTRA} and `extra` is present (the §8 example's layout).
 */
export function blockResponseOf(t: ResponseTuple): JsonValue {
  const [, , response, , , , extra] = t
  return response === BLOCK_IN_EXTRA && extra !== undefined ? extra : response
}

/**
 * The axis of the family named in `itemId` (every item of a family is on the family's axis), or
 * undefined for a malformed id or an unregistered family. Unlike {@link resolveItem} it ignores the
 * generator version: exposure to an item does not depend on this build being able to rebuild it.
 */
export function itemAxis(itemId: string): AxisCode | undefined {
  const ids = typeof itemId === 'string' ? parseItemId(itemId) : null
  return ids === null ? undefined : getFamily(ids.family)?.axis
}

function scoreWith(family: AnyFamily, item: ItemInstance<object, object>, t: ResponseTuple): ResolvedResponse {
  const [, , response, stored] = t
  if (family.kind === 'block') {
    let s
    try {
      s = family.score(item, blockResponseOf(t))
    } catch (e) {
      if (e instanceof MalformedResponseError) return { skip: 'malformed', detail: e.message }
      throw e
    }
    return s.observation !== undefined ? { observation: s.observation } : { skip: 'no_observation', detail: s.reasons.join(',') }
  }
  let correct: 0 | 1 | null
  try {
    correct = family.score(item, response).correct
  } catch (e) {
    if (!(e instanceof MalformedResponseError)) throw e
    if (stored === null) return { skip: 'malformed', detail: e.message }
    correct = stored // e.g. a time-out: the serving app's verdict stands (§8)
  }
  return correct === null ? { skip: 'unscored' } : itemObservation(item, correct)
}

/** The default resolver: regenerate the item from the registry and score the stored response (module comment). */
export function registryObservation(t: ResponseTuple): ResolvedResponse {
  const [itemId, pretest] = t
  if (pretest === 1) return { skip: 'pretest' }
  const item = resolveItem(itemId)
  const family = item === null ? undefined : getFamily(item.family)
  if (item === null || family === undefined) return { skip: 'unresolved' }
  return scoreWith(family, item, t)
}

/**
 * Re-score every session of `save` from its responses with the §7.8 retest model (module
 * comment). Pure: `save` is not modified. The save is expected to be valid v1 (`parse.ts`);
 * throws a RangeError on duplicate session ids or invalid options.
 */
export function rescoreSessions(save: SaveFileV1, opts: RescoreOptions = {}): SaveRescore {
  const resolve = opts.resolve ?? registryObservation
  const skipped: SkippedResponse[] = []
  const sessions: RetestSession[] = save.sessions.map((s) => {
    const observations: Observation[] = []
    const exposed = new Set<AxisCode>()
    s.responses.forEach((t, index) => {
      const r = resolve(t)
      if ('observation' in r) {
        observations.push(r.observation)
        return
      }
      skipped.push({ session_id: s.session_id, index, item_id: t[0], reason: r.skip, ...(r.detail !== undefined ? { detail: r.detail } : {}) })
      const axis = r.axis ?? itemAxis(t[0]) // exposure still counts as a test of the axis (§7.8)
      if (axis !== undefined) exposed.add(axis)
    })
    const exposed_axes = AXIS_CODES.filter((k) => exposed.has(k))
    return { session_id: s.session_id, started_utc: s.started_utc, observations, ...(exposed_axes.length > 0 ? { exposed_axes } : {}) }
  })
  const score = rescoreRetest(sessions, opts)
  return { ...score, n_scored: sessions.reduce((n, s) => n + s.observations.length, 0), skipped }
}

/**
 * The §8 `posterior_cache` of a re-score under `paramVersion`: every axis in canonical order, the
 * MAP θ, and the row-major lower triangle of the Laplace covariance. A cache only (§7.8): the
 * raw responses stay authoritative.
 */
export function posteriorCacheOf(result: Pick<RetestScore, 'theta' | 'cov'>, paramVersion: string): PosteriorCache {
  if (result.theta.length !== N_AXES || result.cov.length !== N_AXES) throw new RangeError(`posteriorCacheOf(): need ${N_AXES} axes`)
  const cov_lower: number[] = []
  for (let i = 0; i < N_AXES; i++) for (let j = 0; j <= i; j++) cov_lower.push(result.cov[i]![j]!)
  return { param_version: paramVersion, axes: [...AXIS_CODES], mean: result.theta.slice(), cov_lower }
}
