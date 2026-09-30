/**
 * The results model (DESIGN §7.8, §9, §10; ROADMAP M1.R, M1.Q, A12, A18): what the reveal shows,
 * built from the SAVE and nothing else, so a returning person sees all their sessions and the same
 * numbers a re-score of the file would give.
 *
 * - **Practice-adjusted re-score.** {@link rescoreSessions} (M1.Q) re-scores every session from its
 *   raw responses with the §7.8 retest model. With one session this is the plain score (s = 1,
 *   ρ = 0); with more, later sessions are credited for practice ("practice-adjusted" in the UI).
 * - **Skipped skills** (§13). A person who skipped a skill in a session did not want it measured
 *   there: that session's answers on the skill stay in the save but are left out of the estimate
 *   (their items still count as a test of the axis for the practice model). A skill is "skipped"
 *   on the profile when every session that took it skipped it; one session that measured it is
 *   enough for it to show.
 * - **Facet observations** for the drill-down (§9.6, A12): each scored response with its item's
 *   facet, expressed on the trait θ like the score is (adjusted by that session's practice gain).
 *
 * Nothing here returns a total, a mean or any other single number across skills (§9.5 a).
 */

import { AXIS_CODES, type AxisCode } from '../engine/axes'
import { adjustObservation } from '../engine/retest'
import type { ResponseTuple } from '../engine/types'
import { itemAxis, registryObservation, rescoreSessions, type ResolvedResponse, type SaveRescore } from '../save/rescore'
import type { SaveFileV1, SaveSession } from '../save/types'
import { getFamily, resolveItem } from '../tasks/registry'
import type { FacetObservation } from '../viz/facets'
import type { ProfileInput } from '../viz/profile'

export interface ResultsModel {
  /** The practice-adjusted re-score of every session in the save. */
  readonly rescore: SaveRescore
  /** What the blob and the bar view take (`ProfileView`). */
  readonly input: ProfileInput
  /** Skills shown as skipped (module comment). */
  readonly skipped: readonly AxisCode[]
  readonly facetObservations: readonly FacetObservation[]
  readonly nSessions: number
  /** Some session was credited for practice (ρ > 0 on some skill): the profile differs from a plain score. */
  readonly practiceAdjusted: boolean
}

/** The session's `skipped_<axis>` flag (§13, `run.ts`). */
export function skippedIn(session: Pick<SaveSession, 'flags'>, axis: AxisCode): boolean {
  return session.flags[`skipped_${axis.toLowerCase()}`] === true
}

/**
 * The results of `save`, or null when it holds nothing scorable (a session that was finished at
 * once, or only skipped parts). Throws a RangeError on a save with duplicate session ids.
 */
export function buildResults(save: SaveFileV1): ResultsModel | null {
  // Responses a session gave on a skill it then skipped: left out of the estimate.
  const ignored = new Map<ResponseTuple, AxisCode>()
  for (const s of save.sessions) {
    for (const k of AXIS_CODES) {
      if (!skippedIn(s, k)) continue
      for (const t of s.responses) if (itemAxis(t[0]) === k) ignored.set(t, k)
    }
  }
  const resolve = (t: ResponseTuple): ResolvedResponse => {
    const k = ignored.get(t)
    return k === undefined ? registryObservation(t) : { skip: 'unscored', axis: k }
  }
  const rescore = rescoreSessions(save, { resolve })
  if (rescore.n_scored === 0) return null

  const sessionById = new Map(save.sessions.map((s) => [s.session_id, s]))
  const skipped = AXIS_CODES.filter((k) => {
    if (!save.sessions.some((s) => skippedIn(s, k))) return false
    // Measured by a session that did not skip it?
    return !rescore.sessions.some((rs) => rs.ordinals[k] !== undefined && !skippedIn(sessionById.get(rs.session_id)!, k))
  })

  const facetObservations: FacetObservation[] = []
  const rho = new Map(rescore.sessions.map((rs) => [rs.session_id, rs.rho]))
  for (const s of save.sessions) {
    for (const t of s.responses) {
      if (ignored.has(t)) continue
      const r = registryObservation(t)
      if (!('observation' in r)) continue
      const item = resolveItem(t[0])
      if (item === null) continue
      const o = adjustObservation(r.observation, rho.get(s.session_id)?.[r.observation.axis] ?? 0)
      const block = getFamily(item.family)?.kind === 'block'
      facetObservations.push({ facet: item.facet, obs: o, ...(block ? { block: true } : {}) })
    }
  }

  return {
    rescore,
    input: { score: rescore, skipped },
    skipped,
    facetObservations,
    nSessions: save.sessions.length,
    practiceAdjusted: rescore.sessions.some((rs) => Object.values(rs.rho).some((v) => v > 0)),
  }
}
