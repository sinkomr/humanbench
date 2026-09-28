/**
 * Integrity flags (DESIGN §13 "Anomaly heuristics", ROADMAP M1.19): pure functions over one
 * session's scored responses and its browser event logs. Nothing here touches the DOM or a clock;
 * the session flow (M1.15) records the logs with `performance.now()` timestamps and calls
 * {@link integrityReport} at the end of the session.
 *
 * The report is internal bookkeeping for calibration hygiene (§6.iii step 1, §12 `sessions.flags`,
 * `responses.client_flags`, §8 session `flags`). It is never shown to the user, and its kinds and
 * evidence use neutral, non-diagnostic wording (R-5.6.x, ROADMAP A13). A flagged user still gets
 * results (§13).
 *
 * The six checks and how each reads §13:
 * - `visibility_hidden`: the page was hidden (`visibilitychange`) for more than
 *   {@link HIDDEN_MAX_S} s in total during one item. Hidden time is summed per item, so repeated
 *   short switches during one item count too; hidden time outside every item window (breaks,
 *   interstitials) is ignored. A spell still open at the end of the log runs to +∞, clipped to
 *   each item's window.
 * - `paste`: at least one paste event in an entry field (the renderer logs only those).
 * - `too_fast`: a correct answer with RT < {@link TOO_FAST_RATIO} × the item's median time on an
 *   item whose median time is > {@link TOO_FAST_MIN_MEDIAN_S} s. **Median source:** the norms
 *   median `median_time_s` once norms exist (M4 calibration); until then the item's
 *   `expected_time_s` (the family's E[T] prior, §7.4). E[T] of a right-skewed RT distribution is
 *   a little above its median, so the prior makes the check slightly stricter than norms will.
 * - `uniform_rt`: the RTs are implausibly uniform across items of very different lengths: at least
 *   {@link UNIFORM_RT_MIN_ITEMS} timed items, whose expected times span a ratio of at least
 *   {@link UNIFORM_RT_MIN_TIME_RATIO} (max/min), with SD(ln RT) < {@link UNIFORM_RT_MAX_SD}.
 *   ROADMAP writes "CV of log-RT"; the CV of a logarithm depends on the time unit (ms vs s shifts
 *   the mean of ln RT by ln 1000 but not its SD), so the unit-free SD of ln RT is used, which is
 *   the CV of RT to first order (√(e^{s²} − 1) ≈ s). Sample SD (n − 1).
 * - `hard_item_accuracy`: on the dichotomous items with b > θ + {@link HARD_ITEM_MARGIN} (θ on the
 *   item's axis), the number correct X is improbably high under the model: the exact
 *   Poisson-binomial upper tail P(X ≥ x | P_1..P_n), with P_j each item's model probability at θ,
 *   is < {@link HARD_ITEM_ALPHA}. θ is the caller's estimate for the axis when given, else the
 *   per-axis Bayes modal estimate below. The test is only as good as θ: a θ shrunk toward the
 *   population mean makes items look harder to a high-ability user than they are and the test
 *   liberal (with a N(0, 1) prior, 3–19% flagged at θ = +2.5 instead of ≤ 1%), so the default
 *   estimate uses the weak prior below, and a caller θ should not be pulled far toward 0 either
 *   (e.g. a returning user's running estimate, not a first-session MAP under the population
 *   prior). Given a θ̂ that is close to unbiased, including the hard responses in it pulls it up
 *   by their correct answers, which makes the test conservative.
 * - `person_fit`: Snijders' (2001) lz* < {@link LZ_STAR_MAX} over at least
 *   {@link LZ_STAR_MIN_ITEMS} dichotomous items ({@link lzStar}).
 *
 * Calibration eligibility (§13 "each sets client_flags; ≥2 flags in a session, or lz* < −2"):
 * the flags are counted as they are set, one per flagged response for the per-item kinds (a
 * response with a paste and a too-fast answer counts twice; pastes that belong to no response
 * count once in all) plus one per raised session-level kind. The session is eligible unless that
 * count is ≥ 2 or `person_fit` is raised ({@link calibrationEligible}). So two too-fast correct
 * answers (the item-exposure pattern that would bias b downward) exclude a session; one does not.
 *
 * Person-fit details ({@link lzStar}, Snijders 2001, Psychometrika 66:331–342; notation of Magis,
 * Raîche & Béland 2012, JEBS 37:57–81). For a dichotomous item i with P_i(θ), Q_i = 1 − P_i:
 *   w_i = ln(P_i/Q_i) (the l_0 weight: l_0 − E l_0 = Σ (X_i − P_i) w_i),
 *   r_i = P_i'/(P_i Q_i) (so that the likelihood score is Σ (X_i − P_i) r_i),
 *   W = Σ (X_i − P_i(θ̂)) w_i(θ̂).
 * θ̂ solves r_0(θ̂) + Σ (X_i − P_i(θ̂)) r_i(θ̂) = 0: r_0 = 0 for ML, r_0 = −(θ − μ)/σ² for the
 * Bayes modal estimate with a N(μ, σ²) prior. Then c = Σ P_i' w_i / Σ P_i' r_i,
 * w̃_i = w_i − c r_i, and
 *   lz* = (W + c·r_0(θ̂)) / √(Σ w̃_i² P_i Q_i),
 * all at θ̂. Without the correction (c = 0) this is Drasgow et al.'s (1985) lz, whose variance is
 * below 1 when θ is estimated. The session has several axes, each with its own θ̂; every item
 * loads on one axis (simple structure, §7.2), so the estimating equations separate by axis and
 * the correction is applied per axis (c_k, r_0k), which reduces to Snijders' statistic when there
 * is one axis. θ̂ here is the Bayes modal estimate per axis with the weakly informative
 * N(0, 3²) prior ({@link PERSON_FIT_PRIOR_SD}), computed with the engine MAP under a diagonal Σ.
 * It is always finite, even for all-correct or all-wrong patterns (unlike ML), and it barely
 * shrinks: Snijders' correction is first order, and a strongly shrunk θ̂ leaves a residual bias
 * that makes lz* flag honest users at the ends of the scale. With the M1 population prior N(0, 1)
 * (A8), simulated users at θ = ±2.5 whose items are targeted at θ (b ~ θ + N(0, 1)) got
 * P(lz* < −2) = 5–6% on 4 axes × 10 items and 13–17% on 12 axes × 4 items (nominal Φ(−2) = 2.3%);
 * with σ = 3 it is 0.6–2.3% for |θ| ≤ 3 in both designs, the same as with Warm's WLE (r_0 =
 * J/(2I), also in Magis et al. 2012) within simulation error. A '2pl_testlet' item counts as a
 * 2PL item (its testlet effect is ignored here).
 */

import { AXIS_CODES, AXIS_INDEX, isAxisCode, modelFamilyOf, N_AXES, type AxisCode } from './axes'
import { check3pl, logistic, loglik3pl } from './irt'
import { mapTheta } from './scorer'
import type { ItemParams, Observation } from './types'

// ------------------------------------------------------------------------ thresholds (§13)

/** `visibility_hidden`: hidden time during one item above this (seconds) is flagged. */
export const HIDDEN_MAX_S = 10
/** `too_fast`: RT below this fraction of the item's median time is too fast. */
export const TOO_FAST_RATIO = 0.25
/** `too_fast` applies only to items whose median time is above this (seconds). */
export const TOO_FAST_MIN_MEDIAN_S = 20
/** `uniform_rt`: SD(ln RT) below this is implausibly uniform. */
export const UNIFORM_RT_MAX_SD = 0.1
/** `uniform_rt` applies only when the items' expected times span at least this ratio. */
export const UNIFORM_RT_MIN_TIME_RATIO = 2
/**
 * `uniform_rt` applies only to at least this many timed items. Not in §13: with two or three
 * items a genuine SD(ln RT) below 0.1 is too likely (two RTs within ±7% of each other).
 */
export const UNIFORM_RT_MIN_ITEMS = 5
/** `hard_item_accuracy`: an item is hard when b > θ + this margin. */
export const HARD_ITEM_MARGIN = 1.5
/** `hard_item_accuracy`: significance level of the one-sided exact test. */
export const HARD_ITEM_ALPHA = 0.01
/** `person_fit`: lz* below this is flagged. */
export const LZ_STAR_MAX = -2
/** `person_fit` applies only to at least this many dichotomous items. */
export const LZ_STAR_MIN_ITEMS = 20
/**
 * Prior mean and SD of the per-axis Bayes modal θ̂ behind lz* and the default hard-item θ: weakly
 * informative (the whole θ scale [−3, 3] within ±1 SD), not the N(0, 1) population prior, whose
 * shrinkage inflates both flags for users at the ends of the scale (module comment).
 */
export const PERSON_FIT_PRIOR_MEAN = 0
export const PERSON_FIT_PRIOR_SD = 3

/** Flag kinds in report order. */
export const FLAG_KINDS = [
  'visibility_hidden',
  'paste',
  'too_fast',
  'uniform_rt',
  'hard_item_accuracy',
  'person_fit',
] as const

export type FlagKind = (typeof FLAG_KINDS)[number]

/** Kinds attached to single responses (§12 `responses.client_flags`); the others are session-level. */
export type ItemFlagKind = 'visibility_hidden' | 'paste' | 'too_fast'

const ITEM_FLAG_ORDER: readonly ItemFlagKind[] = ['visibility_hidden', 'paste', 'too_fast']

// ----------------------------------------------------------------------------- inputs

export type VisibilityState = 'hidden' | 'visible'

/**
 * One `visibilitychange` event: `document.visibilityState` after the change, at `performance.now()`
 * (or the event's `timeStamp`, the same clock); never `Date.now()` (CLAUDE.md timing rule).
 */
export interface VisibilityEvent {
  readonly t_ms: number
  readonly state: VisibilityState
}

/** One paste event in an entry field, at `performance.now()`; `item_id` when the renderer knows it. */
export interface PasteEvent {
  readonly t_ms: number
  readonly item_id?: string
}

/** One scored response with the item metadata the checks need. */
export interface IntegrityResponse {
  readonly item_id: string
  readonly axis: AxisCode
  readonly params: ItemParams
  /** E[T] in seconds (§7.4), the `too_fast` median until norms exist and the `uniform_rt` length. */
  readonly expected_time_s: number
  /** Norms median RT in seconds (M4 onward); overrides `expected_time_s` for `too_fast`. */
  readonly median_time_s?: number
  /** 0/1 for keyed items, null for blocks and continuous responses (§8). */
  readonly correct: 0 | 1 | null
  /** Response time in ms (§8 `rt_ms`). */
  readonly rt_ms: number
  /** `performance.now()` at stimulus onset (first rAF frame) and at the response: the item window. */
  readonly onset_ms: number
  readonly end_ms: number
}

export interface IntegritySession {
  /** The counted responses, one per item (item ids unique). */
  readonly responses: readonly IntegrityResponse[]
  readonly visibility?: readonly VisibilityEvent[]
  readonly paste?: readonly PasteEvent[]
  /** θ per axis for `hard_item_accuracy` (e.g. the session MAP); missing axes use the Bayes modal θ̂. */
  readonly theta?: Partial<Record<AxisCode, number>>
}

// ---------------------------------------------------------------------------- evidence

export interface VisibilityItemEvidence {
  readonly item_id: string
  /** Total hidden seconds within the item window. */
  readonly hidden_s: number
  /** Longest single hidden spell within the item window, seconds. */
  readonly longest_spell_s: number
}

export interface VisibilityEvidence {
  /** Items with hidden time > {@link HIDDEN_MAX_S} s. */
  readonly items: readonly VisibilityItemEvidence[]
  /** Hidden seconds summed over all item windows. */
  readonly total_hidden_s: number
}

export interface PasteEvidence {
  readonly count: number
  /** Items the events belong to (by `item_id`, else by time window), in response order. */
  readonly item_ids: readonly string[]
  /** Events that belong to no response (an unknown `item_id`, or outside every item window). */
  readonly unattributed: number
}

export interface TooFastItemEvidence {
  readonly item_id: string
  readonly rt_s: number
  readonly median_s: number
  readonly median_source: 'norms' | 'expected_time'
  /** rt_s / median_s. */
  readonly ratio: number
}

export interface TooFastEvidence {
  readonly count: number
  readonly items: readonly TooFastItemEvidence[]
}

export interface UniformRtEvidence {
  /** Timed items (rt_ms > 0) considered. */
  readonly n_items: number
  /** max/min expected_time_s over those items; null with no timed item. */
  readonly time_ratio: number | null
  /** Sample SD of ln RT; null with fewer than 2 timed items. */
  readonly sd_log_rt: number | null
  /** Whether the check applies (enough items with a wide enough spread of expected times). */
  readonly applies: boolean
}

export interface HardItemEvidence {
  readonly item_id: string
  readonly axis: AxisCode
  readonly b: number
  readonly theta: number
  /** Model P(correct) at θ. */
  readonly p: number
  readonly correct: 0 | 1
}

export interface HardItemsEvidence {
  readonly n_hard: number
  readonly n_correct: number
  /** Σ P_j over the hard items. */
  readonly expected_correct: number
  /** P(X ≥ n_correct) under the model; 1 with no hard item. */
  readonly p_value: number
  readonly items: readonly HardItemEvidence[]
}

export interface PersonFitEvidence {
  /** Dichotomous items used. */
  readonly n_items: number
  /** Snijders' lz*; null when it is undefined (see {@link LzStarResult.lz_star}). */
  readonly lz_star: number | null
  /** Uncorrected lz (Drasgow et al. 1985) at the same θ̂, for comparison. */
  readonly lz: number | null
  /** The per-axis Bayes modal θ̂ used. */
  readonly theta: Partial<Record<AxisCode, number>>
}

export interface EvidenceOf {
  visibility_hidden: VisibilityEvidence
  paste: PasteEvidence
  too_fast: TooFastEvidence
  uniform_rt: UniformRtEvidence
  hard_item_accuracy: HardItemsEvidence
  person_fit: PersonFitEvidence
}

/** One check's outcome, flagged or not. */
export interface CheckResult<E> {
  readonly flagged: boolean
  readonly evidence: E
}

/**
 * A raised flag with its evidence (a `sessions.flags` entry, §12). `n` is how many §13 flags it
 * counts as: the flagged responses for a per-item kind (at least 1), 1 for a session-level kind.
 */
export type IntegrityFlag = {
  [K in FlagKind]: { readonly kind: K; readonly n: number; readonly evidence: EvidenceOf[K] }
}[FlagKind]

export interface IntegrityReport {
  /** Every check's outcome. */
  readonly checks: { readonly [K in FlagKind]: CheckResult<EvidenceOf[K]> }
  /** The raised flags, in {@link FLAG_KINDS} order. */
  readonly flags: readonly IntegrityFlag[]
  /** Per-response flag kinds (§12 `responses.client_flags`), only for responses with any. */
  readonly item_flags: Readonly<Record<string, readonly ItemFlagKind[]>>
  /** The §8 save-file session `flags` object. */
  readonly save_flags: { readonly visibility_hidden_s: number; readonly paste_events: number; readonly fast_guess_n: number }
  /** The §13 flag count: Σ n over {@link flags} (per-response flags plus session-level kinds). */
  readonly flag_count: number
  /** §13: false when {@link flag_count} ≥ 2 or `person_fit` is raised. */
  readonly calibration_eligible: boolean
}

// -------------------------------------------------------------------------- validation

function finite(name: string, v: unknown): asserts v is number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new RangeError(`${name} must be a finite number, got ${String(v)}`)
}

function checkResponses(responses: readonly IntegrityResponse[]): void {
  if (!Array.isArray(responses)) throw new RangeError('responses must be an array')
  const seen = new Set<string>()
  for (const r of responses) {
    if (typeof r.item_id !== 'string' || r.item_id.length === 0) throw new RangeError('item_id must be a non-empty string')
    if (seen.has(r.item_id)) throw new RangeError(`duplicate item_id ${r.item_id}`)
    seen.add(r.item_id)
    if (!isAxisCode(r.axis)) throw new RangeError(`${r.item_id}: unknown axis ${String(r.axis)}`)
    finite(`${r.item_id}: expected_time_s`, r.expected_time_s)
    if (!(r.expected_time_s > 0)) throw new RangeError(`${r.item_id}: expected_time_s must be > 0`)
    if (r.median_time_s !== undefined) {
      finite(`${r.item_id}: median_time_s`, r.median_time_s)
      if (!(r.median_time_s > 0)) throw new RangeError(`${r.item_id}: median_time_s must be > 0`)
    }
    if (r.correct !== 0 && r.correct !== 1 && r.correct !== null) throw new RangeError(`${r.item_id}: correct must be 0, 1 or null`)
    finite(`${r.item_id}: rt_ms`, r.rt_ms)
    if (r.rt_ms < 0) throw new RangeError(`${r.item_id}: rt_ms must be ≥ 0`)
    finite(`${r.item_id}: onset_ms`, r.onset_ms)
    finite(`${r.item_id}: end_ms`, r.end_ms)
    if (r.end_ms < r.onset_ms) throw new RangeError(`${r.item_id}: end_ms before onset_ms`)
  }
}

// -------------------------------------------------------------------------- visibility

/**
 * Hidden spells [start, end) in ms from a `visibilitychange` log. The page is visible before the
 * first event; events are ordered by time (ties keep log order); repeated states are ignored;
 * a spell still open at the end runs to +∞; zero-length spells are dropped.
 */
export function hiddenIntervals(events: readonly VisibilityEvent[]): [number, number][] {
  if (!Array.isArray(events)) throw new RangeError('visibility events must be an array')
  for (const e of events) {
    finite('visibility t_ms', e.t_ms)
    if (e.state !== 'hidden' && e.state !== 'visible') throw new RangeError(`unknown visibility state ${String(e.state)}`)
  }
  const sorted = events.map((e, i) => ({ e, i })).sort((x, y) => x.e.t_ms - y.e.t_ms || x.i - y.i)
  const out: [number, number][] = []
  let start: number | null = null
  for (const { e } of sorted) {
    if (e.state === 'hidden') {
      if (start === null) start = e.t_ms
    } else if (start !== null) {
      if (e.t_ms > start) out.push([start, e.t_ms])
      start = null
    }
  }
  if (start !== null) out.push([start, Infinity])
  return out
}

/** Per-item hidden time; flagged when some item has more than {@link HIDDEN_MAX_S} s. */
export function visibilityCheck(
  responses: readonly IntegrityResponse[],
  events: readonly VisibilityEvent[],
): CheckResult<VisibilityEvidence> {
  checkResponses(responses)
  const spells = hiddenIntervals(events)
  const items: VisibilityItemEvidence[] = []
  let total = 0
  for (const r of responses) {
    let hidden = 0
    let longest = 0
    for (const [s, e] of spells) {
      const overlap = Math.min(e, r.end_ms) - Math.max(s, r.onset_ms)
      if (overlap > 0) {
        hidden += overlap
        longest = Math.max(longest, overlap)
      }
    }
    total += hidden
    if (hidden / 1000 > HIDDEN_MAX_S) items.push({ item_id: r.item_id, hidden_s: hidden / 1000, longest_spell_s: longest / 1000 })
  }
  return { flagged: items.length > 0, evidence: { items, total_hidden_s: total / 1000 } }
}

// ------------------------------------------------------------------------------- paste

/** Flagged on any paste event; each event is attributed by `item_id`, else by item window. */
export function pasteCheck(responses: readonly IntegrityResponse[], events: readonly PasteEvent[]): CheckResult<PasteEvidence> {
  checkResponses(responses)
  if (!Array.isArray(events)) throw new RangeError('paste events must be an array')
  const ids = new Set(responses.map((r) => r.item_id))
  const hit = new Set<string>()
  let unattributed = 0
  for (const e of events) {
    finite('paste t_ms', e.t_ms)
    let id: string | undefined
    if (e.item_id !== undefined) {
      if (typeof e.item_id !== 'string') throw new RangeError('paste item_id must be a string')
      id = ids.has(e.item_id) ? e.item_id : undefined
    } else {
      id = responses.find((x) => e.t_ms >= x.onset_ms && e.t_ms <= x.end_ms)?.item_id
    }
    if (id === undefined) unattributed++
    else hit.add(id)
  }
  const itemIds = responses.map((r) => r.item_id).filter((id) => hit.has(id))
  return { flagged: events.length > 0, evidence: { count: events.length, item_ids: itemIds, unattributed } }
}

// ---------------------------------------------------------------------------- too fast

/** Correct answers faster than {@link TOO_FAST_RATIO} × median on items with median > {@link TOO_FAST_MIN_MEDIAN_S} s. */
export function tooFastCheck(responses: readonly IntegrityResponse[]): CheckResult<TooFastEvidence> {
  checkResponses(responses)
  const items: TooFastItemEvidence[] = []
  for (const r of responses) {
    if (r.correct !== 1) continue
    const norms = r.median_time_s !== undefined
    const median = r.median_time_s ?? r.expected_time_s
    if (!(median > TOO_FAST_MIN_MEDIAN_S)) continue
    const rt = r.rt_ms / 1000
    if (rt < TOO_FAST_RATIO * median) {
      items.push({ item_id: r.item_id, rt_s: rt, median_s: median, median_source: norms ? 'norms' : 'expected_time', ratio: rt / median })
    }
  }
  return { flagged: items.length > 0, evidence: { count: items.length, items } }
}

// -------------------------------------------------------------------------- uniform RT

/** SD(ln RT) over timed items whose expected times span ≥ 2×; flagged below {@link UNIFORM_RT_MAX_SD}. */
export function uniformRtCheck(responses: readonly IntegrityResponse[]): CheckResult<UniformRtEvidence> {
  checkResponses(responses)
  const timed = responses.filter((r) => r.rt_ms > 0)
  const n = timed.length
  let lo = Infinity
  let hi = -Infinity
  for (const r of timed) {
    lo = Math.min(lo, r.expected_time_s)
    hi = Math.max(hi, r.expected_time_s)
  }
  const timeRatio = n > 0 ? hi / lo : null
  let sd: number | null = null
  if (n >= 2) {
    const logs = timed.map((r) => Math.log(r.rt_ms))
    const mean = logs.reduce((s, v) => s + v, 0) / n
    const ss = logs.reduce((s, v) => s + (v - mean) * (v - mean), 0)
    sd = Math.sqrt(ss / (n - 1))
  }
  const applies = n >= UNIFORM_RT_MIN_ITEMS && timeRatio !== null && timeRatio >= UNIFORM_RT_MIN_TIME_RATIO
  const flagged = applies && sd !== null && sd < UNIFORM_RT_MAX_SD
  return { flagged, evidence: { n_items: n, time_ratio: timeRatio, sd_log_rt: sd, applies } }
}

// -------------------------------------------------------------------- Poisson-binomial

function checkProbs(ps: readonly number[]): void {
  if (!Array.isArray(ps)) throw new RangeError('probabilities must be an array')
  for (const p of ps) {
    finite('probability', p)
    if (p < 0 || p > 1) throw new RangeError(`probability must be in [0, 1], got ${p}`)
  }
}

/**
 * Exact Poisson-binomial pmf P(X = k), k = 0..n, of X = Σ Bernoulli(p_j) independent, by the
 * standard O(n²) convolution (every step is a convex combination, so it is stable).
 */
export function poissonBinomialPmf(ps: readonly number[]): number[] {
  checkProbs(ps)
  let pmf = [1]
  for (const p of ps) {
    const next = new Array<number>(pmf.length + 1).fill(0)
    for (let k = 0; k < pmf.length; k++) {
      next[k]! += pmf[k]! * (1 - p)
      next[k + 1]! += pmf[k]! * p
    }
    pmf = next
  }
  return pmf
}

/** Exact upper tail P(X ≥ x) of the Poisson-binomial (summed from the far tail inward). */
export function poissonBinomialUpperTail(ps: readonly number[], x: number): number {
  finite('x', x)
  const pmf = poissonBinomialPmf(ps)
  const n = ps.length
  if (x <= 0) return 1
  if (x > n) return 0
  let tail = 0
  for (let k = n; k >= Math.ceil(x); k--) tail += pmf[k]!
  return Math.min(1, tail)
}

// ------------------------------------------------------------------- dichotomous terms

/** A dichotomous (2PL/3PL) scorer observation. */
export type DichotomousObservation = Extract<Observation, { kind: '2pl' | '3pl' }>

/**
 * The response as a dichotomous observation, or null when it is not one (GRM/Gaussian items, or
 * `correct` null). A '2pl_testlet' item becomes a 2PL observation.
 */
export function dichotomousObservation(r: IntegrityResponse): DichotomousObservation | null {
  const p = r.params
  if (r.correct === null || modelFamilyOf(p.model) !== 'dichotomous') return null
  if (p.model !== '3pl' && p.model !== '2pl' && p.model !== '2pl_testlet') return null // narrows p
  // Validate here, so a non-finite b is rejected rather than silently "not hard" (NaN > t is false).
  finite(`${r.item_id}: a`, p.a)
  finite(`${r.item_id}: b`, p.b)
  if (p.model === '3pl') {
    finite(`${r.item_id}: c`, p.c)
    check3pl(p.c)
    return { kind: '3pl', axis: r.axis, a: p.a, b: p.b, c: p.c, y: r.correct }
  }
  return { kind: '2pl', axis: r.axis, a: p.a, b: p.b, y: r.correct }
}

/** P, Q = 1 − P, w = ln(P/Q) and r = P'/(PQ) of a dichotomous item at θ, without cancellation. */
function term(o: DichotomousObservation, theta: number): { p: number; q: number; w: number; r: number } {
  finite('a', o.a)
  finite('b', o.b)
  const z = o.a * (theta - o.b)
  if (o.kind === '2pl') return { p: logistic(z), q: logistic(-z), w: z, r: o.a }
  check3pl(o.c)
  const s = logistic(z)
  const p = o.c + (1 - o.c) * s
  const q = (1 - o.c) * logistic(-z)
  const w = loglik3pl(theta, o.a, o.b, o.c, 1) - loglik3pl(theta, o.a, o.b, o.c, 0)
  return { p, q, w, r: (o.a * s) / p }
}

/** Model P(correct) of a dichotomous item at θ. */
export function pCorrect(o: DichotomousObservation, theta: number): number {
  return term(o, theta).p
}

// -------------------------------------------------------------------------- hard items

/**
 * Exact one-sided test of accuracy on hard items (b > θ + {@link HARD_ITEM_MARGIN}): flagged when
 * P(X ≥ correct count) < {@link HARD_ITEM_ALPHA} under the Poisson-binomial of the items' model
 * probabilities at θ. `theta` must cover the axis of every dichotomous response.
 */
export function hardItemCheck(
  responses: readonly IntegrityResponse[],
  theta: Partial<Record<AxisCode, number>>,
): CheckResult<HardItemsEvidence> {
  checkResponses(responses)
  const items: HardItemEvidence[] = []
  for (const r of responses) {
    const o = dichotomousObservation(r)
    if (o === null) continue
    const t = theta[o.axis]
    finite(`theta.${o.axis}`, t)
    if (!(o.b > t + HARD_ITEM_MARGIN)) continue
    items.push({ item_id: r.item_id, axis: o.axis, b: o.b, theta: t, p: pCorrect(o, t), correct: o.y })
  }
  const ps = items.map((it) => it.p)
  const nCorrect = items.reduce((s, it) => s + it.correct, 0)
  const pValue = poissonBinomialUpperTail(ps, nCorrect)
  return {
    flagged: pValue < HARD_ITEM_ALPHA,
    evidence: {
      n_hard: items.length,
      n_correct: nCorrect,
      expected_correct: ps.reduce((s, p) => s + p, 0),
      p_value: pValue,
      items,
    },
  }
}

// -------------------------------------------------------------------------- person fit

/** Corrected/uncorrected variance ratio at or below which lz* is undefined (rounding noise). */
const DEGENERATE_VARIANCE_RATIO = 1e-10

/** Result of {@link lzStar}. */
export interface LzStarResult {
  readonly n_items: number
  /**
   * Snijders' corrected statistic; null when the corrected variance is zero to rounding (at most
   * {@link DEGENERATE_VARIANCE_RATIO} of the uncorrected one), e.g. with no items, a single item per
   * axis, or equally difficult Rasch items: then the θ̂ correction absorbs every residual.
   */
  readonly lz_star: number | null
  /** Drasgow et al.'s uncorrected lz; null when its variance is 0. */
  readonly lz: number | null
  /** W = Σ (X_i − P_i) w_i. */
  readonly w: number
  /** Per-axis correction c_k = Σ P_i' w_i / Σ P_i' r_i. */
  readonly c: Partial<Record<AxisCode, number>>
}

/**
 * Snijders' (2001) lz* for dichotomous items (module comment) at the per-axis estimate `theta`,
 * with the estimator's `r0` per axis (0 for ML, −(θ̂ − μ)/σ² for the Bayes modal estimate with
 * a N(μ, σ²) prior). `theta` must solve the estimator's equation on each axis for lz* to have
 * its asymptotic N(0, 1) null distribution.
 */
export function lzStar(
  obs: readonly DichotomousObservation[],
  theta: Partial<Record<AxisCode, number>>,
  r0: Partial<Record<AxisCode, number>>,
): LzStarResult {
  const num = new Array<number>(N_AXES).fill(0) // Σ P_i' w_i per axis
  const den = new Array<number>(N_AXES).fill(0) // Σ P_i' r_i per axis (test information)
  const terms: { k: number; pq: number; w: number; r: number }[] = []
  let W = 0
  let v0 = 0
  for (const o of obs) {
    if (o.kind !== '2pl' && o.kind !== '3pl') throw new RangeError(`lzStar needs 2PL/3PL observations, got ${String((o as { kind?: unknown }).kind)}`)
    if (!isAxisCode(o.axis)) throw new RangeError(`unknown axis ${String(o.axis)}`)
    if (o.y !== 0 && o.y !== 1) throw new RangeError(`binary response y must be 0 or 1, got ${String(o.y)}`)
    const t = theta[o.axis]
    finite(`theta.${o.axis}`, t)
    const k = AXIS_INDEX[o.axis]
    const { p, q, w, r } = term(o, t)
    const pq = p * q
    W += (o.y === 1 ? q : -p) * w // (X − P)·w without computing 1 − P
    v0 += w * w * pq
    num[k]! += r * pq * w
    den[k]! += r * r * pq
    terms.push({ k, pq, w, r })
  }
  const c = num.map((v, k) => (den[k]! > 0 ? v / den[k]! : 0))
  let numerator = W
  const cOut: Partial<Record<AxisCode, number>> = {}
  for (const k of new Set(terms.map((x) => x.k))) {
    const code = AXIS_CODES[k]!
    const r0k = r0[code]
    finite(`r0.${code}`, r0k)
    numerator += c[k]! * r0k
    cOut[code] = c[k]!
  }
  let v = 0
  for (const { k, pq, w, r } of terms) {
    const wt = w - c[k]! * r
    v += wt * wt * pq
  }
  return {
    n_items: obs.length,
    lz_star: v > DEGENERATE_VARIANCE_RATIO * v0 ? numerator / Math.sqrt(v) : null,
    lz: v0 > 0 ? W / Math.sqrt(v0) : null,
    w: W,
    c: cOut,
  }
}

/**
 * Per-axis Bayes modal θ̂ with the N(`mean`, `sd`²) prior, by default
 * N({@link PERSON_FIT_PRIOR_MEAN}, {@link PERSON_FIT_PRIOR_SD}²) (the engine MAP with a diagonal
 * Σ, so axes are independent), for every axis with an observation.
 */
export function bayesModalTheta(
  obs: readonly DichotomousObservation[],
  sd: number = PERSON_FIT_PRIOR_SD,
  mean: number = PERSON_FIT_PRIOR_MEAN,
): Partial<Record<AxisCode, number>> {
  checkPrior(sd, mean)
  const out: Partial<Record<AxisCode, number>> = {}
  if (obs.length === 0) return out
  const v = sd * sd
  const mu = new Array<number>(N_AXES).fill(mean)
  const sigma = Array.from({ length: N_AXES }, (_, i) => Array.from({ length: N_AXES }, (_, j) => (i === j ? v : 0)))
  const { theta } = mapTheta(obs, mu, sigma)
  for (const o of obs) out[o.axis] = theta[AXIS_INDEX[o.axis]]!
  return out
}

/** r_0 of the N(`mean`, `sd`²) Bayes modal estimator at θ̂: −(θ̂ − mean)/sd² per axis (for {@link lzStar}). */
export function bayesModalR0(
  theta: Partial<Record<AxisCode, number>>,
  sd: number = PERSON_FIT_PRIOR_SD,
  mean: number = PERSON_FIT_PRIOR_MEAN,
): Partial<Record<AxisCode, number>> {
  checkPrior(sd, mean)
  const v = sd * sd
  const out: Partial<Record<AxisCode, number>> = {}
  for (const code of AXIS_CODES) {
    const t = theta[code]
    if (t !== undefined) out[code] = -(t - mean) / v
  }
  return out
}

function checkPrior(sd: number, mean: number): void {
  finite('prior sd', sd)
  finite('prior mean', mean)
  if (!(sd > 0)) throw new RangeError(`prior sd must be > 0, got ${sd}`)
}

/** lz* at the per-axis Bayes modal θ̂; flagged when < {@link LZ_STAR_MAX} with ≥ {@link LZ_STAR_MIN_ITEMS} items. */
export function personFitCheck(responses: readonly IntegrityResponse[]): CheckResult<PersonFitEvidence> {
  checkResponses(responses)
  const obs = responses.map(dichotomousObservation).filter((o): o is DichotomousObservation => o !== null)
  const theta = bayesModalTheta(obs)
  const fit = lzStar(obs, theta, bayesModalR0(theta))
  const flagged = fit.n_items >= LZ_STAR_MIN_ITEMS && fit.lz_star !== null && fit.lz_star < LZ_STAR_MAX
  return { flagged, evidence: { n_items: fit.n_items, lz_star: fit.lz_star, lz: fit.lz, theta } }
}

// ---------------------------------------------------------------------------- report

/**
 * §13: eligible unless the raised flags count ≥ 2 (Σ n: per-response flags plus session-level
 * kinds, see {@link IntegrityFlag}) or `person_fit` is raised.
 */
export function calibrationEligible(flags: readonly { readonly kind: FlagKind; readonly n: number }[]): boolean {
  let count = 0
  for (const f of flags) {
    if (!Number.isInteger(f.n) || f.n < 1) throw new RangeError(`flag ${f.kind}: n must be an integer ≥ 1, got ${f.n}`)
    count += f.n
  }
  return count < 2 && !flags.some((f) => f.kind === 'person_fit')
}

/** All six §13 checks for one session, the raised flags, per-item flags and the §8 summary. */
export function integrityReport(session: IntegritySession): IntegrityReport {
  const { responses } = session
  checkResponses(responses)
  const person = personFitCheck(responses)
  const theta: Partial<Record<AxisCode, number>> = { ...person.evidence.theta }
  for (const [code, t] of Object.entries(session.theta ?? {})) {
    if (!isAxisCode(code)) throw new RangeError(`theta: unknown axis ${code}`)
    finite(`theta.${code}`, t)
    theta[code] = t
  }
  const checks = {
    visibility_hidden: visibilityCheck(responses, session.visibility ?? []),
    paste: pasteCheck(responses, session.paste ?? []),
    too_fast: tooFastCheck(responses),
    uniform_rt: uniformRtCheck(responses),
    hard_item_accuracy: hardItemCheck(responses, theta),
    person_fit: person,
  }
  // §13 flag counts: per-item kinds count their flagged responses (pastes that belong to no
  // response add one in all), session-level kinds count once.
  const n: Record<FlagKind, number> = {
    visibility_hidden: checks.visibility_hidden.evidence.items.length,
    paste: checks.paste.evidence.item_ids.length + (checks.paste.evidence.unattributed > 0 ? 1 : 0),
    too_fast: checks.too_fast.evidence.count,
    uniform_rt: 1,
    hard_item_accuracy: 1,
    person_fit: 1,
  }
  const flags: IntegrityFlag[] = []
  for (const kind of FLAG_KINDS) {
    const res = checks[kind]
    if (res.flagged) flags.push({ kind, n: n[kind], evidence: res.evidence } as IntegrityFlag)
  }

  const hits: Record<ItemFlagKind, Set<string>> = {
    visibility_hidden: new Set(checks.visibility_hidden.evidence.items.map((it) => it.item_id)),
    paste: new Set(checks.paste.evidence.item_ids),
    too_fast: new Set(checks.too_fast.evidence.items.map((it) => it.item_id)),
  }
  const itemFlags: Record<string, ItemFlagKind[]> = {}
  for (const r of responses) {
    const kinds = ITEM_FLAG_ORDER.filter((k) => hits[k].has(r.item_id))
    if (kinds.length > 0) itemFlags[r.item_id] = kinds
  }

  return {
    checks,
    flags,
    item_flags: itemFlags,
    save_flags: {
      visibility_hidden_s: Math.round(checks.visibility_hidden.evidence.total_hidden_s * 10) / 10,
      paste_events: checks.paste.evidence.count,
      fast_guess_n: checks.too_fast.evidence.count,
    },
    flag_count: flags.reduce((acc, f) => acc + f.n, 0),
    calibration_eligible: calibrationEligible(flags),
  }
}
