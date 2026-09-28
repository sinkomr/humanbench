/**
 * Adaptive item selector and fixed-block scheduler (ROADMAP M1.14; DESIGN §7.4 L570–588, §6.iii
 * "Exposure control" L489–492, §7.7 L619, §11.2 `next_item` L810; ROADMAP A9, A10, A11 amended,
 * A15). Pure: no UI, no clock, no `Math.random`. The session flow (M1.15) owns the clock and the
 * responses and calls in here.
 *
 * ## Two kinds of work (A10, A15)
 *
 * - **CAT items**: keyed dichotomous items (2PL, 3PL, 2PL-testlet; A9) from the families of
 *   `kind: 'item'` (rotation, matrices, series, quant; contract v2, M1.F2). {@link selectNext}
 *   picks them one at a time.
 * - **Fixed blocks**: the families of `kind: 'block'`, one per sub-task (M1.F2): RT (rt_simple,
 *   rt_choice4), span (span_fwd, span_bwd, corsi), coding and reading are whole blocks with GRM or
 *   Gaussian observations (A10). They are never CAT items; {@link planSession} and
 *   {@link scheduleBlocks} return them in the A15 order RT → Matrix/Series → Spatial → Memory →
 *   Quant → Coding/Reading, with a CAT segment for each power axis in between. Calibration is
 *   embedded (confidence on items, M1.15), so it has no segment.
 *
 * ## Selection (§7.4)
 *
 * 1. **Eligible axes**: in the current segment's `axes` (all CAT axes by default), weight w_k > 0
 *    (0 = skipped, §7.4 L577), at least one CAT family, and not yet done (posterior SD ≥ 0.3,
 *    §7.4 L588 / A15, {@link axisDone}).
 * 2. **Candidates**: for each CAT family of an eligible axis, the {@link NEAR_STRATA} strata whose
 *    default b band centre is nearest the axis's current θ̂ (`STRATUM_B_CUTS`, §6.ii), and up to
 *    {@link CANDIDATES_PER_STRATUM} items per stratum from the deterministic seeds
 *    `<sessionSeed>.<counter>.<j>` (counter = CAT items administered so far this session), each
 *    generated with `{ stratum }`, so `item_id` regenerates the item (A11). Skipped while drawing:
 *    a family seen this session or in an earlier one (§7.7, §8 `seen_families`), an item whose
 *    `sibling_group` was already served this session (A11 amended, M1.F2: a family is its own
 *    group; quant's near-isomorph variants share `g:quant:<label>`, `QUANT_SIBLING_SETS`), and
 *    an item whose E[T] exceeds the remaining time. Duplicate family_ids in the pool keep the
 *    best score. If fewer than top-k candidates compete, the next nearest strata are added one
 *    at a time; 'exhausted' is reported only after a {@link SWEEP_ATTEMPTS}-seed sweep of every
 *    stratum finds nothing.
 * 3. **Criterion** (§7.4 L573): score_j = w_k · I_j(θ̂_k) · Var(θ_k) / E[T_j], where I_j is the
 *    Fisher information of the ITEM's own model (A9: 2PL a²P(1−P), 3PL with c = 1/k, 2PL-testlet
 *    discounted by 20% per §7.1), never the axis default; θ̂_k and Var(θ_k) are the current
 *    posterior mean and variance (§7.4 L576), and E[T_j] is `expected_time_s` (§7.4 L575).
 * 4. **Coverage floor** (§7.4 L584): in session 1, while any eligible axis has fewer than 3
 *    administered items, only those axes' candidates compete.
 * 5. **Randomesque** (§6.iii L490, §7.4 L579): a uniform pick from the top 5 (ties in score are
 *    broken by item_id, so the top 5 is a deterministic set), drawn from the injected seeded RNG.
 *
 * Exposure caps (§6.iii L491) need server-side exposure counts; procedural items are effectively
 * unlimited, so M1 has none (M2's `next_item` adds them, §11.2 L810).
 *
 * Not re-exported from the engine barrel: this module imports the task registry, and the tasks
 * import the engine barrel, so a re-export would make an import cycle. Import
 * `engine/selector` explicitly.
 */

import { AXIS_CODES, AXIS_INDEX, initialSigma, isAxisCode, N_AXES, type AxisCode } from './axes'
import { info2pl, info3pl } from './irt'
import type { Matrix } from './linalg'
import { createRng, type Rng } from './prng'
import { eapByAxis, mapTheta, type ReadonlyMatrix } from './scorer'
import type { ItemParams, Observation } from './types'
import type { AnyFamily, ItemInstance } from '../tasks/family'
import type { Stratum } from '../tasks/ids'
import { STRATUM_B_CUTS } from '../tasks/priors'
import { FAMILIES, getFamily } from '../tasks/registry'

// ---------------------------------------------------------------------------- constants

/** Randomesque pool size: pick uniformly from the top 5 by information per second (§6.iii L490). */
export const RANDOMESQUE_K = 5
/** Coverage floor: scored items per axis in session 1 before the criterion alone decides (§7.4 L584). */
export const COVERAGE_FLOOR = 3
/** Per-axis early stop: an axis is done once its posterior SD < 0.3 (§7.4 L588, A15). */
export const STOP_SD = 0.3
/** Strata per family in a candidate pool: those whose b-band centre is nearest θ̂ (widened when the pool is short). */
export const NEAR_STRATA = 3
/** Candidate items per (family, stratum). */
export const CANDIDATES_PER_STRATUM = 4
/** Seeds tried per (family, stratum) before giving up on excluded or over-time draws. */
export const ATTEMPTS_PER_STRATUM = 3 * CANDIDATES_PER_STRATUM
/**
 * Seeds per (family, stratum) of the sweep that runs before a pool is reported 'exhausted'. The
 * rarest quant variant (a recip one) is 1 in 30 draws of its stratum, so 576 draws miss a lone
 * unseen one with p ≈ 3·10⁻⁹.
 */
export const SWEEP_ATTEMPTS = 48 * ATTEMPTS_PER_STRATUM
/** Information multiplier of a '2pl_testlet' item: the §7.1 testlet effect γ ~ N(0, 0.3²) discounts it by ~20%. */
export const TESTLET_INFO_FACTOR = 0.8
/** Default M1 session length for {@link planSession}: A15's target of about 25–30 min, taken at the midpoint. */
export const A15_TARGET_S = 27.5 * 60

// ------------------------------------------------------------------------------- types

/** One axis's current posterior: mean θ̂_k and SD √Var(θ_k). */
export interface AxisPosterior {
  readonly mean: number
  readonly sd: number
}

/** Per-axis posteriors by axis code; {@link sessionPosterior} fills every axis. */
export type SessionPosterior = Readonly<Partial<Record<AxisCode, AxisPosterior>>>

/** Axis weights w_k (§7.4 L577): 1.0 by default, 0 for an axis the person skipped. */
export type AxisWeights = Readonly<Partial<Record<AxisCode, number>>>

/** Any family's item instance (what `AnyFamily.generate` returns). */
export type AnyItem = ItemInstance<object, object>

/** What the selector needs to know about an administered item (an {@link ItemInstance} fits). */
export type AdministeredItem = Pick<AnyItem, 'item_id' | 'family_id' | 'family' | 'axis' | 'sibling_group'>

/** The session state a selection depends on. */
export interface SelectorState {
  /** The session seed; candidate seeds are `<sessionSeed>.<counter>.<j>`. */
  readonly sessionSeed: string
  /** Current per-axis posterior (from {@link sessionPosterior}); needed for every eligible axis. */
  readonly posterior: SessionPosterior
  /** CAT items administered so far this session, in order. Their count is the seed counter. */
  readonly administered: readonly AdministeredItem[]
  /** family_ids seen in earlier sessions (§8 `seen_families`, §7.7), excluded like this session's. */
  readonly seenFamilies?: Iterable<string>
  /** Seconds left in the current block or session, whichever ends first (default: no limit). */
  readonly remainingS?: number
  /** 1 for a person's first session (the coverage floor applies only then, §7.4 L584). Default 1. */
  readonly sessionNumber?: number
}

/** Selector settings; every field has a default. */
export interface SelectorOptions {
  /** Families to draw from; fixed blocks among them are ignored. Default: the task registry. */
  readonly families?: readonly AnyFamily[]
  /** w_k per axis (§7.4); missing axes weigh 1.0. */
  readonly weights?: AxisWeights
  /** Restrict selection to these axes (the current A15 segment). Default: every CAT axis. */
  readonly axes?: readonly AxisCode[]
  /** Randomesque pool size, default {@link RANDOMESQUE_K}. */
  readonly topK?: number
  /** Coverage floor, default {@link coverageFloor}(sessionNumber). */
  readonly floor?: number
  /** Per-axis stop SD, default {@link STOP_SD}. */
  readonly stopSd?: number
}

/** A scored candidate. */
export interface Candidate {
  readonly item: AnyItem
  readonly axis: AxisCode
  /** Fisher information of the item at θ̂ (by the item's model, A9). */
  readonly info: number
  /** The §7.4 criterion w_k · I · Var(θ_k) / E[T]. */
  readonly score: number
}

/** Why no item was selected. */
export type NoItemReason =
  /** No allowed axis has weight > 0 and a CAT family. */
  | 'no_axes'
  /** Every eligible axis reached SD < stopSd. */
  | 'axes_done'
  /** No time left, or no candidate fits in the remaining time. */
  | 'time'
  /** Every candidate in every stratum was excluded (family / sibling exclusion), after the sweep. */
  | 'exhausted'

/** The ranked candidate pool of one selection. */
export interface CandidatePool {
  /** Candidates that compete, ranked by score (desc), then item_id (asc); one per family_id. */
  readonly ranked: readonly Candidate[]
  /** Axes that could be selected (weight > 0, a CAT family, not done). */
  readonly eligibleAxes: readonly AxisCode[]
  /** The coverage-floor axes, if the floor restricted the pool (else empty). */
  readonly floorAxes: readonly AxisCode[]
  /** Set when `ranked` is empty. */
  readonly reason?: NoItemReason
}

/** Result of {@link selectNext}. */
export type Selection =
  | {
      readonly kind: 'item'
      readonly item: AnyItem
      readonly axis: AxisCode
      readonly score: number
      /** 0-based rank of the pick in the ranked pool (< topK). */
      readonly rank: number
      /** Candidates that competed. */
      readonly poolSize: number
      /** True if the coverage floor restricted the pool. */
      readonly floor: boolean
    }
  | { readonly kind: 'none'; readonly reason: NoItemReason }

// ------------------------------------------------------------------------ small helpers

function finite(name: string, v: unknown): asserts v is number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new RangeError(`${name} must be a finite number, got ${String(v)}`)
}

/** True for the keyed dichotomous models a CAT item may have (A9); blocks are GRM / Gaussian (A10). */
export function isDichotomousParams(p: ItemParams): boolean {
  return p.model === '2pl' || p.model === '3pl' || p.model === '2pl_testlet'
}

/**
 * Fisher information of a CAT item at θ by the item's own model (A9, §7.1): 2PL a²P(1 − P); 3PL
 * with its c; 2PL-testlet × {@link TESTLET_INFO_FACTOR}. Throws a RangeError for block models.
 */
export function itemInformation(params: ItemParams, theta: number): number {
  finite('theta', theta)
  switch (params.model) {
    case '2pl':
      return info2pl(theta, params.a, params.b)
    case '2pl_testlet':
      return TESTLET_INFO_FACTOR * info2pl(theta, params.a, params.b)
    case '3pl':
      return info3pl(theta, params.a, params.b, params.c)
    default:
      throw new RangeError(`a ${params.model} item is a fixed block (A10), not a CAT item`)
  }
}

/**
 * The §7.4 criterion (L573): w_k · I_j(θ̂_k) · Var(θ_k) / E[T_j] with θ̂_k, Var(θ_k) the axis's
 * current posterior mean and variance and E[T_j] the item's `expected_time_s`.
 */
export function criterion(item: Pick<AnyItem, 'params' | 'expected_time_s'>, post: AxisPosterior, weight: number): number {
  checkPosterior('posterior', post)
  finite('weight', weight)
  if (weight < 0) throw new RangeError(`weight must be ≥ 0, got ${weight}`)
  const t = item.expected_time_s
  if (!(Number.isFinite(t) && t > 0)) throw new RangeError(`expected_time_s must be finite and > 0, got ${t}`)
  return (weight * itemInformation(item.params, post.mean) * post.sd * post.sd) / t
}

function checkPosterior(name: string, p: AxisPosterior | undefined): asserts p is AxisPosterior {
  if (typeof p !== 'object' || p === null) throw new RangeError(`${name} is missing`)
  finite(`${name}.mean`, p.mean)
  finite(`${name}.sd`, p.sd)
  if (!(p.sd > 0)) throw new RangeError(`${name}.sd must be > 0, got ${p.sd}`)
}

/** Per-axis stop (§7.4 L588, A15): the axis is done once its posterior SD < `stopSd` (default 0.3). */
export function axisDone(post: AxisPosterior, stopSd: number = STOP_SD): boolean {
  checkPosterior('posterior', post)
  return post.sd < stopSd
}

/** The axes among `axes` (default: all) that are done ({@link axisDone}); axes without a posterior are not. */
export function doneAxes(posterior: SessionPosterior, stopSd: number = STOP_SD, axes: readonly AxisCode[] = AXIS_CODES): AxisCode[] {
  return axes.filter((k) => {
    const p = posterior[k]
    return p !== undefined && axisDone(p, stopSd)
  })
}

/** The coverage floor of a session (§7.4 L584): {@link COVERAGE_FLOOR} in session 1, none after. */
export function coverageFloor(sessionNumber = 1): number {
  if (!Number.isInteger(sessionNumber) || sessionNumber < 1) throw new RangeError(`sessionNumber must be an integer ≥ 1, got ${sessionNumber}`)
  return sessionNumber === 1 ? COVERAGE_FLOOR : 0
}

/** w_k: the given weight or 1.0 (§7.4 L577). Throws on a negative or non-finite weight. */
export function axisWeight(weights: AxisWeights | undefined, k: AxisCode): number {
  const w = weights?.[k]
  if (w === undefined) return 1
  finite(`weight of ${k}`, w)
  if (w < 0) throw new RangeError(`weight of ${k} must be ≥ 0, got ${w}`)
  return w
}

/** Centre of stratum k's default b band (`STRATUM_B_CUTS`): −2, −1, 0, 1, 2, 3 for strata 1–6. */
export function stratumCentre(k: Stratum): number {
  const cuts = STRATUM_B_CUTS
  if (k === 1) return cuts[0]! - 0.5
  if (k === cuts.length + 1) return cuts[cuts.length - 1]! + 0.5
  return (cuts[k - 2]! + cuts[k - 1]!) / 2
}

/** The `n` strata of `strata` whose band centre is nearest θ (ties: the lower stratum first). */
export function nearestStrata(strata: readonly Stratum[], theta: number, n: number = NEAR_STRATA): Stratum[] {
  finite('theta', theta)
  return [...strata].sort((x, y) => Math.abs(stratumCentre(x) - theta) - Math.abs(stratumCentre(y) - theta) || x - y).slice(0, n)
}

/** Seed of candidate j at selection `counter`: `<sessionSeed>.<counter>.<j>`. */
export function candidateSeed(sessionSeed: string, counter: number, j: number): string {
  return `${sessionSeed}.${counter}.${j}`
}

/** A seeded stream for the randomesque draw of selection `counter` (engine PRNG, never Math.random). */
export function selectionRng(sessionSeed: string, counter: number): Rng {
  return createRng(sessionSeed).fork(`select/${counter}`)
}

function checkSeed(seed: unknown): asserts seed is string {
  if (typeof seed !== 'string' || seed.length === 0) throw new RangeError('sessionSeed must be a non-empty string')
}

// --------------------------------------------------------------------- family roles

/**
 * True if `f` serves CAT items: its kind marker is 'item' (contract v2, M1.F2), which the
 * contract ties to the keyed dichotomous models (A9). A family of kind 'block' is never selected,
 * even if the A15 schedule does not name it (the registry test flags it as unscheduled); each
 * candidate's own model is still checked while drawing.
 */
export function isCatFamily(f: AnyFamily): boolean {
  return f.kind === 'item'
}

/** The CAT families of `families` (default: the registry), in the given order. */
export function catFamilies(families: readonly AnyFamily[] = Object.values(FAMILIES)): AnyFamily[] {
  return families.filter(isCatFamily)
}

/** The axes that have at least one CAT family, in canonical axis order. */
export function catAxes(families: readonly AnyFamily[] = Object.values(FAMILIES)): AxisCode[] {
  const s = new Set(catFamilies(families).map((f) => f.axis))
  return AXIS_CODES.filter((k) => s.has(k))
}

// -------------------------------------------------------------------------- posterior

let sigmaInit: Matrix | null = null
const defaultSigma = (): Matrix => (sigmaInit ??= initialSigma())

export interface PosteriorOptions {
  /** Prior mean (default 0 on every axis). */
  readonly mu?: readonly number[]
  /** Prior covariance (default Σ_init, A8). */
  readonly sigma?: ReadonlyMatrix
  /**
   * 'eap' (default): the per-axis grid EAP, the in-session estimator of §11.2 L809 / A2; an axis
   * without observations keeps its marginal prior. 'map': the correlated MAP with the Laplace
   * covariance (§7.2), which borrows strength across axes.
   */
  readonly estimator?: 'eap' | 'map'
}

/** The current posterior of every axis from the session's observations (engine scorer, A2). */
export function sessionPosterior(obs: readonly Observation[], opts: PosteriorOptions = {}): Record<AxisCode, AxisPosterior> {
  const mu = opts.mu ?? new Array<number>(N_AXES).fill(0)
  const sigma = opts.sigma ?? defaultSigma()
  const out = {} as Record<AxisCode, AxisPosterior>
  if (opts.estimator === 'map') {
    const r = mapTheta(obs, mu, sigma)
    for (const k of AXIS_CODES) {
      const i = AXIS_INDEX[k]
      out[k] = { mean: r.theta[i]!, sd: Math.sqrt(r.cov[i]![i]!) }
    }
    return out
  }
  const eap = eapByAxis(obs, mu, sigma)
  for (const k of AXIS_CODES) {
    const i = AXIS_INDEX[k]
    out[k] = eap[k] ?? { mean: mu[i]!, sd: Math.sqrt(sigma[i]![i]!) }
  }
  return out
}

// -------------------------------------------------------------------------- selection

/**
 * Uniform pick from the first min(k, n) entries of an already ranked list (randomesque, §6.iii
 * L490), with one `rng.int` draw. Throws a RangeError on an empty list or k < 1.
 */
export function pickRandomesque<T>(ranked: readonly T[], rng: Rng, k: number = RANDOMESQUE_K): { value: T; rank: number } {
  if (!Number.isInteger(k) || k < 1) throw new RangeError(`k must be an integer ≥ 1, got ${k}`)
  if (ranked.length === 0) throw new RangeError('pickRandomesque(): empty list')
  const rank = rng.int(0, Math.min(k, ranked.length) - 1)
  return { value: ranked[rank]!, rank }
}

/** Score desc, then item_id asc (a total order, so the top k is one deterministic set). */
function byRank(x: Candidate, y: Candidate): number {
  return y.score - x.score || (x.item.item_id < y.item.item_id ? -1 : x.item.item_id > y.item.item_id ? 1 : 0)
}

/**
 * Build and rank the candidate pool of the next selection (steps 1–4 of the module comment). Pure
 * and deterministic in (state, opts). Throws a RangeError on an invalid state or options.
 */
export function candidatePool(state: SelectorState, opts: SelectorOptions = {}): CandidatePool {
  checkSeed(state.sessionSeed)
  if (!Array.isArray(state.administered)) throw new RangeError('administered must be an array')
  const remaining = state.remainingS ?? Infinity
  if (typeof remaining !== 'number' || Number.isNaN(remaining)) throw new RangeError('remainingS must be a number')
  const floor = opts.floor ?? coverageFloor(state.sessionNumber ?? 1)
  if (!Number.isInteger(floor) || floor < 0) throw new RangeError(`floor must be an integer ≥ 0, got ${floor}`)
  const stopSd = opts.stopSd ?? STOP_SD
  finite('stopSd', stopSd)
  const topK = opts.topK ?? RANDOMESQUE_K
  if (!Number.isInteger(topK) || topK < 1) throw new RangeError(`topK must be an integer ≥ 1, got ${topK}`)
  const families = catFamilies(opts.families ?? Object.values(FAMILIES))
  const allowed = opts.axes ?? AXIS_CODES
  for (const k of allowed) if (!isAxisCode(k)) throw new RangeError(`unknown axis ${JSON.stringify(k)}`)

  // 1. Eligible axes: allowed, w_k > 0, a CAT family, not done.
  const withFamilies = new Set(families.map((f) => f.axis))
  const open = AXIS_CODES.filter((k) => allowed.includes(k) && axisWeight(opts.weights, k) > 0 && withFamilies.has(k))
  if (open.length === 0) return { ranked: [], eligibleAxes: [], floorAxes: [], reason: 'no_axes' }
  for (const k of open) checkPosterior(`posterior of ${k}`, state.posterior[k])
  const eligible = open.filter((k) => !axisDone(state.posterior[k]!, stopSd))
  if (eligible.length === 0) return { ranked: [], eligibleAxes: [], floorAxes: [], reason: 'axes_done' }
  if (!(remaining > 0)) return { ranked: [], eligibleAxes: eligible, floorAxes: [], reason: 'time' }

  // 2. Exclusions: families seen this session or earlier (§7.7), this session's sibling groups
  // (A11 amended, M1.F2 `sibling_group`).
  const seenFamilies = new Set<string>(state.seenFamilies ?? [])
  const usedSiblings = new Set<string>()
  const counts = new Map<AxisCode, number>()
  for (const a of state.administered) {
    seenFamilies.add(a.family_id)
    usedSiblings.add(a.sibling_group)
    counts.set(a.axis, (counts.get(a.axis) ?? 0) + 1)
  }
  const counter = state.administered.length

  // 2–3. Candidates per (family, stratum), scored by the §7.4 criterion; one per family_id.
  const best = new Map<string, Candidate>()
  let overTime = 0
  const plans = families
    .filter((fam) => eligible.includes(fam.axis))
    .map((fam) => {
      const post = state.posterior[fam.axis]!
      return { fam, post, w: axisWeight(opts.weights, fam.axis), strata: nearestStrata(fam.strata, post.mean, fam.strata.length) }
    })
  const draw = (p: (typeof plans)[number], k: Stratum, from: number, to: number): void => {
    let accepted = 0
    for (let j = from; j < to && accepted < CANDIDATES_PER_STRATUM; j++) {
      const item = p.fam.generate(candidateSeed(state.sessionSeed, counter, j), { stratum: k })
      if (!isDichotomousParams(item.params)) continue // defensive: blocks are never CAT items (A10)
      if (seenFamilies.has(item.family_id)) continue
      if (usedSiblings.has(item.sibling_group)) continue
      if (item.expected_time_s > remaining) {
        overTime++
        continue
      }
      accepted++
      const info = itemInformation(item.params, p.post.mean)
      const c: Candidate = { item, axis: p.fam.axis, info, score: criterion(item, p.post, p.w) }
      const prev = best.get(item.family_id)
      if (prev === undefined || byRank(c, prev) < 0) best.set(item.family_id, c)
    }
  }
  // 4. Coverage floor (§7.4 L584): under-floor axes with candidates compete alone.
  const rank = (): { ranked: Candidate[]; under: AxisCode[] } => {
    let ranked = [...best.values()]
    const under = eligible.filter((k) => (counts.get(k) ?? 0) < floor && ranked.some((c) => c.axis === k))
    if (under.length > 0) ranked = ranked.filter((c) => under.includes(c.axis))
    return { ranked: ranked.sort(byRank), under }
  }

  // The NEAR_STRATA nearest strata first; while fewer than topK candidates compete (the near
  // strata ran dry under exclusion), widen one stratum at a time, so the randomesque top k is
  // that of every stratum the families have (review fix).
  const rings = Math.max(0, ...plans.map((p) => p.strata.length))
  const near = Math.min(NEAR_STRATA, rings)
  let pool = rank()
  for (let ring = 0; ring < rings; ring++) {
    for (const p of plans) {
      const k = p.strata[ring]
      if (k !== undefined) draw(p, k, 0, ATTEMPTS_PER_STRATUM)
    }
    if (ring + 1 < near) continue
    pool = rank()
    if (pool.ranked.length >= topK) break
  }
  // 'exhausted' must mean nothing is left: before reporting it, sweep every stratum with
  // SWEEP_ATTEMPTS seeds, so a lone unseen variant is not missed by a few unlucky draws.
  if (pool.ranked.length === 0 && overTime === 0) {
    for (const p of plans) for (const k of p.strata) draw(p, k, ATTEMPTS_PER_STRATUM, SWEEP_ATTEMPTS)
    pool = rank()
  }
  const { ranked, under } = pool
  if (ranked.length === 0) return { ranked, eligibleAxes: eligible, floorAxes: [], reason: overTime > 0 ? 'time' : 'exhausted' }
  return { ranked, eligibleAxes: eligible, floorAxes: under }
}

/**
 * Select the next CAT item (§7.4): {@link candidatePool}, then a randomesque pick from the top
 * `topK` with the injected seeded `rng` (e.g. {@link selectionRng}). Deterministic in
 * (state, rng seed, opts). Returns `{ kind: 'none', reason }` when nothing can be selected.
 */
export function selectNext(state: SelectorState, rng: Rng, opts: SelectorOptions = {}): Selection {
  const pool = candidatePool(state, opts)
  if (pool.ranked.length === 0) return { kind: 'none', reason: pool.reason ?? 'exhausted' }
  const { value, rank } = pickRandomesque(pool.ranked, rng, opts.topK ?? RANDOMESQUE_K)
  return {
    kind: 'item',
    item: value.item,
    axis: value.axis,
    score: value.score,
    rank,
    poolSize: pool.ranked.length,
    floor: pool.floorAxes.length > 0,
  }
}

// --------------------------------------------------------------------- block schedule

/** The A15 segments, in order. */
export type SegmentId = 'rt' | 'matrix_series' | 'spatial' | 'memory' | 'quant' | 'coding_reading'

/** One fixed block of a segment: a block family (one per sub-task, M1.F2). */
export interface BlockDef {
  readonly family: string
}

/** One A15 segment: fixed blocks, or a CAT segment on some axes. */
export type SegmentDef =
  | { readonly id: SegmentId; readonly kind: 'block'; readonly axis: AxisCode; readonly blocks: readonly BlockDef[] }
  | { readonly id: SegmentId; readonly kind: 'cat'; readonly axes: readonly AxisCode[] }

/**
 * The M1 session order (A15): RT → Matrix/Series → Spatial → Memory → Quant → Coding/Reading.
 * RT runs simple then 4-choice (M1.10); Memory runs digits forward, digits backward, Corsi (M1.9).
 * Each sub-task is its own block family (M1.F2).
 */
export const A15_SEGMENTS: readonly SegmentDef[] = Object.freeze([
  { id: 'rt', kind: 'block', axis: 'RT', blocks: [{ family: 'rt_simple' }, { family: 'rt_choice4' }] },
  { id: 'matrix_series', kind: 'cat', axes: ['MAT'] },
  { id: 'spatial', kind: 'cat', axes: ['SPA'] },
  { id: 'memory', kind: 'block', axis: 'WM', blocks: [{ family: 'span_fwd' }, { family: 'span_bwd' }, { family: 'corsi' }] },
  { id: 'quant', kind: 'cat', axes: ['QR'] },
  { id: 'coding_reading', kind: 'block', axis: 'PS', blocks: [{ family: 'coding' }, { family: 'reading' }] },
] as const satisfies readonly SegmentDef[])

/** Names of the fixed-block families of {@link A15_SEGMENTS}. */
export const FIXED_BLOCK_FAMILIES: ReadonlySet<string> = new Set(
  A15_SEGMENTS.flatMap((s) => (s.kind === 'block' ? s.blocks.map((b) => b.family) : [])),
)

/**
 * The block families exempt from seen-family exclusion: each RT sub-task is one family by design
 * (`rtStructure`), measured every session (A15).
 */
export const SEEN_EXEMPT_BLOCKS: ReadonlySet<string> = new Set(['rt_simple', 'rt_choice4'])

/** A planned step of the session. */
export type PlannedStep =
  | {
      readonly kind: 'block'
      readonly segment: SegmentId
      readonly family: string
      readonly axis: AxisCode
      /** The block instance (seed {@link blockSeed}, RT `…#<mode>`), so its id regenerates it. */
      readonly item: AnyItem
    }
  | {
      readonly kind: 'cat'
      readonly segment: SegmentId
      readonly axes: readonly AxisCode[]
      /** Planned seconds; the segment loops on {@link selectNext} until its axes are done or this runs out (A15). */
      readonly budget_s: number
    }

export interface PlanOptions {
  readonly sessionSeed: string
  /** w_k; an axis with w_k = 0 loses its blocks / CAT segment. */
  readonly weights?: AxisWeights
  /** Session length in seconds (default {@link A15_TARGET_S}). */
  readonly targetS?: number
  /**
   * family_ids seen in earlier sessions (§8 `seen_families`, §7.7). A block whose family was seen
   * is re-drawn from the next {@link blockSeed}; if none of {@link BLOCK_SEED_ATTEMPTS} seeds gives
   * an unseen family (e.g. every reading passage has been read), the block is dropped and its time
   * goes to the CAT segments. RT is exempt ({@link SEEN_EXEMPT_BLOCKS}): an RT sub-task is one
   * family by design (`rtStructure`), measured every session (A15).
   */
  readonly seenFamilies?: Iterable<string>
}

/**
 * Seeds tried per fixed block before it is dropped as seen (§7.7). With 8 reading passages, 128
 * uniform draws miss a lone unseen passage with p ≈ 4·10⁻⁸.
 */
export const BLOCK_SEED_ATTEMPTS = 128

/** Seed of a fixed block: `<sessionSeed>.blk.<family>`, then `….<n>` for the n-th re-draw (n ≥ 1). */
export function blockSeed(sessionSeed: string, family: string, n = 0): string {
  return n === 0 ? `${sessionSeed}.blk.${family}` : `${sessionSeed}.blk.${family}.${n}`
}

/** The block instance of `b`: the first seed whose family is unseen (RT exempt), or null. */
function blockItem(sessionSeed: string, b: BlockDef, seen: ReadonlySet<string>): AnyItem | null {
  const fam = getFamily(b.family)
  if (fam === undefined) throw new Error(`A15 block family ${b.family} is not registered`)
  if (fam.kind !== 'block') throw new Error(`A15 block family ${b.family} is of kind ${fam.kind}, not 'block' (M1.F2)`)
  if (SEEN_EXEMPT_BLOCKS.has(b.family)) return fam.generate(blockSeed(sessionSeed, b.family))
  for (let n = 0; n < BLOCK_SEED_ATTEMPTS; n++) {
    const item = fam.generate(blockSeed(sessionSeed, b.family, n))
    if (!seen.has(item.family_id)) return item
  }
  return null
}

/**
 * The session plan in A15 order: every fixed block (skipping axes with w_k = 0, and blocks whose
 * every draw was seen, see {@link PlanOptions.seenFamilies}) as a generated instance, and a CAT
 * segment for each power axis with w_k > 0. The time left after the blocks' E[T] is shared
 * equally by the CAT segments (never below 0), so a skipped axis's or dropped block's time goes
 * to the others. Deterministic in the options.
 */
export function planSession(opts: PlanOptions): PlannedStep[] {
  checkSeed(opts.sessionSeed)
  const target = opts.targetS ?? A15_TARGET_S
  finite('targetS', target)
  if (target < 0) throw new RangeError(`targetS must be ≥ 0, got ${target}`)
  const seen = new Set<string>(opts.seenFamilies ?? [])
  const kept = A15_SEGMENTS.filter((s) => (s.kind === 'block' ? axisWeight(opts.weights, s.axis) > 0 : s.axes.some((k) => axisWeight(opts.weights, k) > 0)))
  const steps: (PlannedStep | { kind: 'cat'; segment: SegmentId; axes: readonly AxisCode[] })[] = []
  let blockTime = 0
  let nCat = 0
  for (const s of kept) {
    if (s.kind === 'cat') {
      nCat++
      steps.push({ kind: 'cat', segment: s.id, axes: s.axes.filter((k) => axisWeight(opts.weights, k) > 0) })
      continue
    }
    for (const b of s.blocks) {
      const item = blockItem(opts.sessionSeed, b, seen)
      if (item === null) continue
      blockTime += item.expected_time_s
      steps.push({ kind: 'block', segment: s.id, family: b.family, axis: s.axis, item })
    }
  }
  const budget = nCat === 0 ? 0 : Math.max(0, target - blockTime) / nCat
  return steps.map((s): PlannedStep => (s.kind === 'cat' ? { kind: 'cat', segment: s.segment, axes: s.axes, budget_s: budget } : s))
}

/** The fixed blocks of {@link planSession}, in A15 order (the block scheduler; never CAT items). */
export function scheduleBlocks(opts: PlanOptions): Extract<PlannedStep, { kind: 'block' }>[] {
  return planSession(opts).filter((s): s is Extract<PlannedStep, { kind: 'block' }> => s.kind === 'block')
}
