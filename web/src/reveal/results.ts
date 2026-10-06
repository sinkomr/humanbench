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
 * - **Served parts** (M2.7). With a server, the counted questions of the Matrix & Series, Spatial and
 *   Quantitative parts are scored where their keys are, and the page never learns a verdict
 *   (R-11.1). Their sessions are left out of the local re-score ({@link ServedScores.sessionIds}; they
 *   still count as exposures for the practice model), and the server's own-axis posterior for each
 *   axis it publishes (`rescore`: mean and sd, rounded) replaces the local estimate of that axis
 *   ({@link overlayServed}), with the axis uncorrelated with the others since the server returns no
 *   covariance. Its facets arrive as computed estimates. An axis the server withholds (too few answers
 *   in one session) or could not be asked about shows as not measured, as any axis with no data does.
 *
 * - **Skills not offered yet** (§9.7, A15). The profile is told which skills a session of this build
 *   puts in front of the person ({@link OFFERED_AXES}), so a skill no part measures reads "not offered
 *   yet" rather than plain "not measured" (UX-048b).
 *
 * Nothing here returns a total, a mean or any other single number across skills (§9.5 a).
 */

import type { RescoreReply } from '../backend/replies'
import { AXES, AXIS_CODES, AXIS_INDEX, N_AXES, type AxisCode } from '../engine/axes'
import { adjustObservation, sessionSittings } from '../engine/retest'
import { A15_SEGMENTS } from '../engine/selector'
import type { ResponseTuple } from '../engine/types'
import { itemAxis, registryObservation, rescoreSessions, type ResolvedResponse, type SaveRescore } from '../save/rescore'
import { TIMED_TASKS_ONLY_FLAG, type SaveFileV1, type SaveSession } from '../save/types'
import { getFamily, resolveItem } from '../tasks/registry'
import type { FacetObservation, FacetOptions } from '../viz/facets'
import type { ProfileInput } from '../viz/profile'

/**
 * The skills a session of this build puts in front of the person: the axes of the A15 plan and the
 * embedded ones (Calibration, measured with every rated answer). With a server the plan is the same and
 * the server scores some of its parts (M2.7), so it offers no others.
 */
export const OFFERED_AXES: ReadonlySet<AxisCode> = new Set([
  ...A15_SEGMENTS.flatMap((s) => (s.kind === 'block' ? [s.axis] : s.axes)),
  ...AXES.filter((a) => a.embedded).map((a) => a.code),
])

/** The part of a save the server scores (M2.7). */
export interface ServedScores {
  /** Ids of the sessions whose answers the server scores: the page does not (and cannot) score them. */
  readonly sessionIds: ReadonlySet<string>
  /** What `rescore` returned, or null when the server could not be asked. */
  readonly estimates: RescoreReply | null
}

/**
 * `local` with the server's own-axis estimates in place of the axes it publishes. The server returns
 * a mean and an sd per axis, no covariance, so each such axis is made independent of the others (its
 * row and column of the covariance are zero but for the variance). The input is not modified.
 */
export function overlayServed(local: SaveRescore, est: RescoreReply): SaveRescore {
  const theta = local.theta.slice()
  const cov = local.cov.map((row) => row.slice())
  const eap: SaveRescore['eap'] = {}
  for (const k of AXIS_CODES) {
    const e = est.eap[k]
    const i = AXIS_INDEX[k]
    if (e === undefined) {
      const kept = local.eap[k]
      if (kept !== undefined) eap[k] = kept
      continue
    }
    theta[i] = e.mean
    for (let j = 0; j < N_AXES; j++) {
      cov[i]![j] = 0
      cov[j]![i] = 0
    }
    cov[i]![i] = Math.max(e.sd * e.sd, 1e-6)
    eap[k] = { mean: e.mean, sd: e.sd }
  }
  return { ...local, theta, cov, eap }
}

export interface ResultsModel {
  /** The practice-adjusted re-score of every session in the save. */
  readonly rescore: SaveRescore
  /** What the blob and the bar view take (`ProfileView`). */
  readonly input: ProfileInput
  /** Skills shown as skipped (module comment). */
  readonly skipped: readonly AxisCode[]
  readonly facetObservations: readonly FacetObservation[]
  readonly nSessions: number
  /** Facet estimates the server computed for the parts it scores (M2.7), or undefined. */
  readonly servedFacets?: FacetOptions['precomputed']
  /** Sessions the server scored that contributed (M2.7): the ones `rescore` holds and verified, when it published anything. Absent without a server. */
  readonly servedSessions?: number
  /**
   * Sittings that scored something here through the device's half of an online sitting (the timed
   * tasks, `TIMED_TASKS_ONLY_FLAG`): the other half is a session the server scored. Counted by sitting
   * like {@link scoredSessions} (a continuation is not a sitting of its own). Absent when none.
   */
  readonly devicePartSessions?: number
  /** Some session was credited for practice (ρ > 0 on some skill): the profile differs from a plain score. */
  readonly practiceAdjusted: boolean
}

/**
 * How many sittings the save's scored sessions come from (the count a share card states, M1.18:
 * "Based on n sessions"). A session finished at once, or with only skipped parts, is not one. An online
 * sitting is two sessions in the file, the timed tasks on the device and the questions the server
 * scored (M2.7), and counts once: a device half pairs with a served session. An interrupted session and
 * the continuation that picked it up (`CONTINUATION_FLAG`, UX-064) are one sitting too (the retest
 * model's sittings, `sessionSittings`): it counts once when any of its sessions scored.
 */
export function scoredSessions(results: Pick<ResultsModel, 'rescore'> & { readonly servedSessions?: number; readonly devicePartSessions?: number }): number {
  const sessions = results.rescore.sessions
  const sit = sessionSittings(sessions)
  const local = new Set(sessions.flatMap((s, i) => (s.n_observations > 0 ? [sit[i]!] : []))).size
  const halves = Math.min(results.devicePartSessions ?? 0, local)
  return Math.max(1, local - halves + Math.max(results.servedSessions ?? 0, halves))
}

/** The session's `skipped_<axis>` flag (§13, `run.ts`). */
export function skippedIn(session: Pick<SaveSession, 'flags'>, axis: AxisCode): boolean {
  return session.flags[`skipped_${axis.toLowerCase()}`] === true
}

/**
 * The results of `save`, or null when it holds nothing scorable (a session that was finished at
 * once, or only skipped parts). Throws a RangeError on a save with duplicate session ids.
 */
export function buildResults(save: SaveFileV1, served?: ServedScores): ResultsModel | null {
  // Responses a session gave on a skill it then skipped: left out of the estimate.
  const ignored = new Map<ResponseTuple, AxisCode>()
  // Responses the server scores (M2.7): not scored here, but still an exposure to the axis (§7.8).
  const byServer = new Set<ResponseTuple>()
  if (served !== undefined) for (const s of save.sessions) if (served.sessionIds.has(s.session_id)) for (const t of s.responses) byServer.add(t)
  for (const s of save.sessions) {
    for (const k of AXIS_CODES) {
      if (!skippedIn(s, k)) continue
      for (const t of s.responses) if (itemAxis(t[0]) === k) ignored.set(t, k)
    }
  }
  const resolve = (t: ResponseTuple): ResolvedResponse => {
    const k = ignored.get(t)
    if (k !== undefined) return { skip: 'unscored', axis: k }
    if (byServer.has(t)) {
      const axis = itemAxis(t[0])
      return axis === undefined ? { skip: 'unscored' } : { skip: 'unscored', axis }
    }
    return registryObservation(t)
  }
  const localRescore = rescoreSessions(save, { resolve })
  const est = served?.estimates ?? null
  const publishes = est !== null && AXIS_CODES.some((k) => est.eap[k] !== undefined)
  if (localRescore.n_scored === 0 && !publishes) return null
  const rescore = est !== null && publishes ? overlayServed(localRescore, est) : localRescore

  const sessionById = new Map(save.sessions.map((s) => [s.session_id, s]))
  const skipped = AXIS_CODES.filter((k) => {
    if (!save.sessions.some((s) => skippedIn(s, k))) return false
    // Measured by a session that did not skip it?
    return !rescore.sessions.some((rs) => rs.ordinals[k] !== undefined && !skippedIn(sessionById.get(rs.session_id)!, k))
  })

  // By sitting, as scoredSessions counts (rescore.sessions are in time order).
  const sittings = sessionSittings(rescore.sessions)
  const devicePartSessions = new Set(
    rescore.sessions.flatMap((rs, i) => (rs.n_observations > 0 && sessionById.get(rs.session_id)?.flags[TIMED_TASKS_ONLY_FLAG] === true ? [sittings[i]!] : [])),
  ).size

  const facetObservations: FacetObservation[] = []
  const rho = new Map(rescore.sessions.map((rs) => [rs.session_id, rs.rho]))
  for (const s of save.sessions) {
    for (const t of s.responses) {
      if (ignored.has(t) || byServer.has(t)) continue // a served answer is not scored here, not even for a facet
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
    input: { score: rescore, skipped, offered: OFFERED_AXES },
    skipped,
    facetObservations,
    ...(publishes && est !== null ? { servedFacets: est.facets as FacetOptions['precomputed'] } : {}),
    ...(publishes && est !== null ? { servedSessions: est.sessions.filter((x) => x.known).length } : {}),
    ...(devicePartSessions > 0 ? { devicePartSessions } : {}),
    nSessions: save.sessions.length,
    practiceAdjusted: rescore.sessions.some((rs) => Object.values(rs.rho).some((v) => v > 0)),
  }
}
