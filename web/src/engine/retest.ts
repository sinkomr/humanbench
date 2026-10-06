/**
 * Retest (practice) model and multi-session re-scoring (DESIGN §7.8; ROADMAP M1.Q, estimation in
 * M4.7). TypeScript mirror of bank `hb.calib.retest`; both reproduce `golden/retest_v1.json`
 * (A17 copy in `__fixtures__/`) to 1e-9.
 *
 * ## Model (§7.8, exactly)
 *
 * θ_{k,s} = θ_k + ρ_k(s), with ρ_k(s) = ρ_k^max · (1 − e^{−(s−1)/1.2}):
 * - θ_k is the person's trait on axis k, the retest-adjusted ("practice-adjusted", §7.8) θ that
 *   is reported;
 * - s is the test number on that axis: the ordinal, in time order, of the session's sitting
 *   among the person's sittings that took axis k ({@link sessionOrdinals}): those with a scored
 *   observation on k or with k in `exposed_axes` (items presented on k that gave no observation:
 *   pretest items, ids this build cannot regenerate, unscored or unscorable responses). Practice
 *   comes from exposure, not from scorability, so s does not depend on which build re-scores. The
 *   first test is s = 1, where ρ = 0; a session that skipped the axis is not a retest of it;
 * - a sitting is a session together with the continuation sessions that follow it
 *   ({@link sessionSittings}). A session with `continuation` true carries on the session just
 *   before it in time order (an interrupted session picked up again: its finished parts are not
 *   served again, UX-064) and is not a retest of it: on every axis it gets the test number
 *   of its sitting, so two parts of one sitting never adjust each other for practice. A
 *   continuation flag on the first session is ignored. Without continuations every session is its
 *   own sitting and s counts sessions, as before;
 * - ρ_k^max is the plateau gain. Priors (§7.8): 0.45 for reasoning, spatial and speed, 0.25 for
 *   knowledge (alternate forms). §7.8 names only those clusters; the others are assigned here
 *   [SPEC] ({@link RHO_MAX_BY_CLUSTER}) and every value is provisional until M4.7 estimates ρ
 *   from returning users (§7.8: N ≥ 300).
 *
 * An observation made at test s measures θ_{k,s}. Re-expressed on θ_k it is the same likelihood
 * with the item shifted by ρ ({@link adjustObservation}, exact): 2PL/3PL b → b − ρ, GRM thresholds
 * b_i → b_i − ρ, Gaussian d → d + λ·ρ. So p(y | θ_k + ρ, item) = p(y | θ_k, adjusted item).
 *
 * ## Aggregation (§7.8 "always re-score from raw responses", §8 merge step 3)
 *
 * {@link rescoreRetest} scores every session's observations together: one correlated-factor MAP
 * + Laplace covariance and the per-axis EAP (engine scorer, A2) over the adjusted observations of
 * all sessions, with the population prior N(μ, Σ) once. This is the same posterior as sequential
 * updating in which the prior for session s is the posterior after sessions 1…s−1 (moved by the
 * practice gain) — each later session's prior combines the earlier sessions with the population
 * prior — but computed exactly from the raw data rather than chained through Laplace
 * approximations. {@link nextSessionPrior} gives that prior for the session about to start (the
 * in-session selector's EAP prior, M1.15).
 *
 * Consequences the tests pin: with ρ^max = 0 the sessions are pooled as if one session; a
 * single-session save re-scores exactly as {@link scoreAll} (s = 1, ρ = 0); ρ_k(s) is 0 at s = 1,
 * nondecreasing in s for ρ^max ≥ 0 and tends to ρ^max; a larger ρ^max lowers θ̂_k (more of a
 * later session's performance is credited to practice); marking a session as a continuation never
 * raises a test number; and a sitting split into a session and its continuations scores exactly as
 * the one session holding all their observations.
 *
 * ## Task-spec mapping (ROADMAP M1.Q)
 *
 * The M1.Q task text described ρ_k(s) as a *stability* that carries the earlier posterior over as
 * a function of the *spacing* s between sessions, with the properties "ρ = 0 → independent
 * sessions; ρ = 1 and s = 0 → full carry-over; monotone in s". It also said "implement exactly per
 * §7.8", and §7.8 (authoritative, CLAUDE.md) defines ρ_k(s) as an additive practice gain indexed
 * by the test number, with no interval term. This module implements §7.8. The trait θ_k is constant
 * across sessions, so carry-over is always full and ρ^max = 0 pools the sessions as one (never
 * independence, which has no §7.8 analogue); s starts at 1 (ρ = 0, a single session is the plain
 * score), not 0; ρ_k(s) is monotone in s. A spacing term (§7.8 lists the interval among the
 * literature's moderators) is for M4.7 to estimate, not assumed here.
 */

import { AXES, AXIS_CODES, AXIS_INDEX, N_AXES, initialSigma, type AxisCode, type Cluster } from './axes'
import { checkObservation, eapByAxis, mapTheta, type ReadonlyMatrix, type ScoreResult } from './scorer'
import type { Observation } from './types'

/** Version of the retest model and its golden file (`golden/retest_v1.json`). */
export const RETEST_VERSION = 'retest_v1'

/** §7.8 time constant of the practice curve, in tests: ρ(s) = ρ^max(1 − e^{−(s−1)/1.2}). */
export const RETEST_TAU = 1.2

/** §7.8 prior ρ^max for reasoning, spatial and speed axes (SD units). */
export const RHO_MAX_FLUID = 0.45
/** §7.8 prior ρ^max for knowledge axes, which use alternate forms (SD units). */
export const RHO_MAX_KNOWLEDGE = 0.25

/**
 * Provisional ρ^max per cluster (A7 clusters), until M4.7 estimates it. §7.8 gives Reasoning,
 * Spatial/Memory ("spatial") and Speed 0.45 and Knowledge 0.25. [SPEC] for the rest: Quantitative
 * 0.45 (procedurally generated reasoning items, like matrices and series), Verbal, Estimation and
 * Social-Creative 0.25 (finite banks served as alternate forms, like knowledge; §7.7). Working
 * Memory shares the Spatial/Memory cluster and gets 0.45.
 */
export const RHO_MAX_BY_CLUSTER: Readonly<Record<Cluster, number>> = Object.freeze({
  Reasoning: RHO_MAX_FLUID,
  Verbal: RHO_MAX_KNOWLEDGE,
  Quantitative: RHO_MAX_FLUID,
  'Spatial/Memory': RHO_MAX_FLUID,
  Speed: RHO_MAX_FLUID,
  Estimation: RHO_MAX_KNOWLEDGE,
  Knowledge: RHO_MAX_KNOWLEDGE,
  'Social-Creative': RHO_MAX_KNOWLEDGE,
})

/** The provisional ρ^max of every axis, from its cluster ({@link RHO_MAX_BY_CLUSTER}). */
export const RHO_MAX_PRIOR: Readonly<Record<AxisCode, number>> = Object.freeze(
  Object.fromEntries(AXES.map((a) => [a.code, RHO_MAX_BY_CLUSTER[a.cluster]])) as Record<AxisCode, number>,
)

/** ρ^max per axis; missing axes take {@link RHO_MAX_PRIOR}. */
export type RhoMax = Partial<Record<AxisCode, number>>

function finite(name: string, v: unknown): asserts v is number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new RangeError(`${name} must be a finite number, got ${String(v)}`)
}

/** The full ρ^max table: `rhoMax` over the prior; throws a RangeError on an unknown axis or a non-finite value. */
export function resolveRhoMax(rhoMax: RhoMax = {}): Record<AxisCode, number> {
  const out = { ...RHO_MAX_PRIOR }
  for (const [k, v] of Object.entries(rhoMax)) {
    if (!Object.hasOwn(AXIS_INDEX, k)) throw new RangeError(`rhoMax: unknown axis ${JSON.stringify(k)}`)
    finite(`rhoMax.${k}`, v)
    out[k as AxisCode] = v
  }
  return out
}

/**
 * The practice gain at test s (§7.8): ρ^max · (1 − e^{−(s−1)/1.2}), computed as
 * −ρ^max · expm1(−(s−1)/1.2) (exactly 0 at s = 1). s is real ≥ 1 here (tests use integers).
 */
export function retestGain(rhoMax: number, s: number): number {
  finite('rhoMax', rhoMax)
  finite('s', s)
  if (!(s >= 1)) throw new RangeError(`test number s must be ≥ 1, got ${s}`)
  const g = -rhoMax * Math.expm1(-(s - 1) / RETEST_TAU)
  return g === 0 ? 0 : g // never −0
}

/**
 * The observation re-expressed on the trait θ_k when it was made at practice gain ρ (module
 * comment): the same likelihood as a function of θ_k as the original at θ_k + ρ. A new object;
 * `o` is not modified. Throws a RangeError on an invalid observation or a non-finite ρ.
 */
export function adjustObservation(o: Observation, rho: number): Observation {
  checkObservation(o)
  finite('rho', rho)
  switch (o.kind) {
    case '2pl':
      return { kind: '2pl', axis: o.axis, a: o.a, b: o.b - rho, y: o.y }
    case '3pl':
      return { kind: '3pl', axis: o.axis, a: o.a, b: o.b - rho, c: o.c, y: o.y }
    case 'grm':
      return { kind: 'grm', axis: o.axis, a: o.a, b: o.b.map((t) => t - rho), y: o.y }
    case 'gaussian':
      return { kind: 'gaussian', axis: o.axis, lam: o.lam, d: o.d + o.lam * rho, sigma: o.sigma, x: o.x }
    case 'testlet': // every item at θ + ρ; the shared γ does not depend on the shift
      return { kind: 'testlet', axis: o.axis, tau: o.tau, items: o.items.map((it) => ({ a: it.a, b: it.b - rho, y: it.y })) }
  }
}

/** One session's scored observations (from its §8 responses) and its identity and start time. */
export interface RetestSession {
  readonly session_id: string
  /** `YYYY-MM-DDTHH:MM:SSZ` (§8); sessions are ordered by it, then by id (as `mergeSessions`). */
  readonly started_utc: string
  readonly observations: readonly Observation[]
  /**
   * Axes the session presented items on beyond its observations (pretest, unregenerable or
   * unscored responses): they count as a test of the axis (module comment). Any order; repeats
   * and axes that also have observations change nothing.
   */
  readonly exposed_axes?: readonly AxisCode[]
  /**
   * The session continues the sitting of the session just before it in time order (module
   * comment): same test numbers, no practice adjustment between the two. Ignored on the first
   * session. A save marks it with the session flag `CONTINUATION_FLAG` (`save/types.ts`).
   */
  readonly continuation?: boolean
}

/** Per-session result: the test number and practice gain of each axis it took (observed or exposed). */
export interface SessionRetest {
  readonly session_id: string
  readonly started_utc: string
  /**
   * Present (true) when the session counts as a continuation of the session before it: its input
   * `continuation` was true and it is not the first session. Absent otherwise.
   */
  readonly continuation?: true
  readonly n_observations: number
  /** Test number s per axis the session took (observed or exposed), in canonical axis order. */
  readonly ordinals: Partial<Record<AxisCode, number>>
  /** ρ_k(s) applied to that axis's observations. */
  readonly rho: Partial<Record<AxisCode, number>>
}

/** Code-unit order (as `mergeSessions` and RFC 8785 keys). */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * The sessions in time order: by `started_utc`, then `session_id` (the order of `mergeSessions`,
 * §8). Throws a RangeError on a duplicate or empty session_id or a non-string start time.
 */
export function orderSessions<T extends Pick<RetestSession, 'session_id' | 'started_utc'>>(sessions: readonly T[]): T[] {
  if (!Array.isArray(sessions)) throw new RangeError('sessions must be an array')
  const seen = new Set<string>()
  for (const s of sessions) {
    if (typeof s.session_id !== 'string' || s.session_id.length === 0) throw new RangeError('session_id must be a non-empty string')
    if (typeof s.started_utc !== 'string') throw new RangeError(`session ${s.session_id}: started_utc must be a string`)
    if (seen.has(s.session_id)) throw new RangeError(`duplicate session_id ${JSON.stringify(s.session_id)}`)
    seen.add(s.session_id)
  }
  return [...sessions].sort((a, b) => cmp(a.started_utc, b.started_utc) || cmp(a.session_id, b.session_id))
}

/**
 * Axes (canonical order) the session took: its observations' axes and its `exposed_axes`. Throws a
 * RangeError on an invalid observation or an unknown exposed axis.
 */
function takenAxes(s: RetestSession): AxisCode[] {
  const idx = new Set(s.observations.map((o) => checkObservation(o)))
  const exposed = s.exposed_axes ?? []
  if (!Array.isArray(exposed)) throw new RangeError(`session ${s.session_id}: exposed_axes must be an array`)
  for (const k of exposed) {
    if (typeof k !== 'string' || !Object.hasOwn(AXIS_INDEX, k)) throw new RangeError(`session ${s.session_id}: exposed_axes: unknown axis ${JSON.stringify(k)}`)
    idx.add(AXIS_INDEX[k as AxisCode])
  }
  return AXIS_CODES.filter((_, i) => idx.has(i))
}

/**
 * The sitting of each session, for sessions already in time order ({@link orderSessions}): 0 for
 * the first; a session with `continuation` true is in the sitting of the session before it, any
 * other session starts the next sitting. A continuation flag on the first session is ignored, so
 * the number of sittings is the last index + 1 (0 for no sessions). Throws a RangeError when
 * `continuation` is present and not a boolean.
 */
export function sessionSittings(ordered: readonly Pick<RetestSession, 'session_id' | 'continuation'>[]): number[] {
  let sitting = -1
  return ordered.map((s, i) => {
    const c: unknown = s.continuation
    if (c !== undefined && typeof c !== 'boolean') throw new RangeError(`session ${s.session_id}: continuation must be a boolean, got ${String(c)}`)
    if (i === 0 || c !== true) sitting += 1
    return sitting
  })
}

/**
 * The test number s of each axis each session took (observed or exposed), for sessions already in
 * time order ({@link orderSessions}): 1 + the number of earlier sittings ({@link sessionSittings})
 * that took that axis. The parts of one sitting share it; without continuations it is 1 + the
 * number of earlier sessions that took the axis.
 */
export function sessionOrdinals(ordered: readonly RetestSession[]): Partial<Record<AxisCode, number>>[] {
  const sittings = sessionSittings(ordered)
  const count = new Map<AxisCode, number>()
  const lastSitting = new Map<AxisCode, number>()
  return ordered.map((s, i) => {
    const sitting = sittings[i]!
    const out: Partial<Record<AxisCode, number>> = {}
    for (const k of takenAxes(s)) {
      if (lastSitting.get(k) !== sitting) {
        count.set(k, (count.get(k) ?? 0) + 1)
        lastSitting.set(k, sitting)
      }
      out[k] = count.get(k)!
    }
    return out
  })
}

/** Result of {@link retestAdjust}. */
export interface RetestAdjusted {
  /** Per session, in time order. */
  readonly sessions: SessionRetest[]
  /** Every session's adjusted observations, concatenated in time order. */
  readonly observations: Observation[]
  /**
   * The test number the next session would be on each axis (1 for axes never taken), when it starts
   * a new sitting: 1 + the number of sittings that took the axis.
   */
  readonly next_ordinals: Record<AxisCode, number>
}

/** Order the sessions, number the tests per axis and adjust every observation by its ρ_k(s). */
export function retestAdjust(sessions: readonly RetestSession[], rhoMax: RhoMax = {}): RetestAdjusted {
  const rmax = resolveRhoMax(rhoMax)
  const ordered = orderSessions(sessions)
  const sittings = sessionSittings(ordered)
  const ordinals = sessionOrdinals(ordered)
  const out: SessionRetest[] = []
  const observations: Observation[] = []
  const next = Object.fromEntries(AXIS_CODES.map((k) => [k, 1])) as Record<AxisCode, number>
  ordered.forEach((s, i) => {
    const ord = ordinals[i]!
    const rho: Partial<Record<AxisCode, number>> = {}
    for (const k of AXIS_CODES) {
      const n = ord[k]
      if (n === undefined) continue
      rho[k] = retestGain(rmax[k], n)
      next[k] = n + 1
    }
    for (const o of s.observations) observations.push(adjustObservation(o, rho[o.axis]!))
    const continuation = i > 0 && sittings[i] === sittings[i - 1]
    out.push({
      session_id: s.session_id,
      started_utc: s.started_utc,
      ...(continuation ? { continuation: true as const } : {}),
      n_observations: s.observations.length,
      ordinals: ord,
      rho,
    })
  })
  return { sessions: out, observations, next_ordinals: next }
}

/** Options of {@link rescoreRetest}. */
export interface RetestOptions {
  /** Population prior mean (default 0 on every axis). */
  readonly mu?: readonly number[]
  /** Population prior covariance (default Σ_init, A8). */
  readonly sigma?: ReadonlyMatrix
  /** ρ^max per axis (default {@link RHO_MAX_PRIOR}). */
  readonly rhoMax?: RhoMax
}

/** The retest-adjusted score of a person's sessions ({@link rescoreRetest}). */
export interface RetestScore extends ScoreResult {
  readonly retest_version: typeof RETEST_VERSION
  /** θ is the trait θ_k, adjusted for practice (§7.8: label it "practice-adjusted"). */
  readonly practice_adjusted: true
  readonly sessions: SessionRetest[]
  readonly next_ordinals: Record<AxisCode, number>
  /** The ρ^max table used. */
  readonly rho_max: Record<AxisCode, number>
}

/**
 * Re-score all sessions from their observations with the §7.8 retest model (module comment): the
 * MAP θ, Laplace covariance and per-axis EAP of the trait θ over every session's adjusted
 * observations, under the population prior N(μ, Σ). Throws a RangeError on invalid input.
 */
export function rescoreRetest(sessions: readonly RetestSession[], opts: RetestOptions = {}): RetestScore {
  const mu = opts.mu ?? new Array<number>(N_AXES).fill(0)
  const sigma = opts.sigma ?? initialSigma()
  const rmax = resolveRhoMax(opts.rhoMax)
  const adj = retestAdjust(sessions, rmax)
  const map = mapTheta(adj.observations, mu, sigma)
  return {
    ...map,
    eap: eapByAxis(adj.observations, mu, sigma),
    retest_version: RETEST_VERSION,
    practice_adjusted: true,
    sessions: adj.sessions,
    next_ordinals: adj.next_ordinals,
    rho_max: rmax,
  }
}

/**
 * The prior for the next session's in-session estimate (§7.8, §11.2): the retest-adjusted
 * posterior N(θ̂, cov) moved to that session's practice level, μ_k = θ̂_k + ρ_k(s_k) with s_k the
 * next test number on axis k (a new sitting, `next_ordinals`); the covariance is the Laplace
 * covariance. With no earlier sessions
 * this is the population prior (s = 1, ρ = 0); with ρ^max = 0 it is the earlier posterior itself.
 * The next session's raw observations are then scored against it as they are (they measure
 * θ_{k,s}).
 */
export function nextSessionPrior(result: Pick<RetestScore, 'theta' | 'cov' | 'next_ordinals' | 'rho_max'>): { mu: number[]; sigma: number[][] } {
  const mu = AXIS_CODES.map((k, i) => result.theta[i]! + retestGain(result.rho_max[k], result.next_ordinals[k]))
  return { mu, sigma: result.cov.map((row) => row.slice()) }
}
