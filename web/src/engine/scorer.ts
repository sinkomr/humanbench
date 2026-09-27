/**
 * Person scorer (DESIGN §7.2, §11.2): correlated-factor MAP θ with a Laplace covariance, and the
 * per-axis grid EAP. TypeScript port of the bank reference `hb.calib.mirt_score` (ROADMAP A2); it
 * matches bank `golden/scoring_v1.json` to 1e-6 on θ, cov, EAP and the log posterior.
 *
 * Model (simple structure, §7.2). θ ∈ R^K over the axes in canonical order (K = mu.length, the 17
 * axes of axes.ts by default), prior θ ~ N(μ, Σ). Each observation loads on exactly one axis and
 * is a 2PL, 3PL, GRM or Gaussian term (irt.ts; wire schema in types.ts).
 *
 * Log posterior ({@link logPosterior}): the log joint density with every normalising constant,
 *   Σ_j log p(y_j | θ_k(j)) − ½·K·log 2π − ½·log|Σ| − ½·(θ − μ)ᵀΣ⁻¹(θ − μ),
 * i.e. the log posterior up to the (θ-free) log evidence. Gaussian terms include −log σ − ½·log 2π.
 *
 * MAP ({@link mapTheta}), the convention recorded in the golden file (A2). Start at θ = μ; per
 * iteration:
 * 1. g = Σ_j score_j(θ) − Σ⁻¹(θ − μ), the exact gradient;
 * 2. candidate curvatures, in order: Newton H = Σ⁻¹ + diag(observed information) if its Cholesky
 *    succeeds (a correct 3PL answer at low θ has negative observed information, so it can be
 *    indefinite far from the mode), then Fisher H = Σ⁻¹ + diag(expected information), always PD;
 * 3. for each candidate: step = H⁻¹g, then s = 1, ½, ¼, … (at most {@link MAP_MAX_HALVINGS}
 *    halvings) until lp(θ + s·step) ≥ lp(θ) − 2⁻⁴⁶·(1 + |lp(θ)|) (a rounding-noise slack). The
 *    first candidate that passes wins; if none passes, stop without moving (θ is the MAP to
 *    floating-point resolution);
 * 4. θ ← θ + s·step; stop when max|s·step| < {@link MAP_TOL}, or after {@link MAP_MAX_ITER}
 *    iterations. `nIter` counts iterations (1 with no observations) and is informational only.
 * Laplace covariance: (Σ⁻¹ + diag(total expected information at the MAP))⁻¹ (§7.2: expected, not
 * observed, information).
 *
 * EAP ({@link eapAxis}, the in-session estimator of §11.2): unidimensional, per axis, on the grid
 * t_i = lo + i·(hi − lo)/(n − 1) with n = 61 points over [−4, 4]; prior N(μ_k, Σ_kk); likelihood
 * from that axis's observations only. Log-space accumulation ℓ_i = −(t_i − μ_k)²/(2Σ_kk) +
 * Σ_j log p(y_j | t_i), equal weights w_i = exp(ℓ_i − max ℓ) normalised to 1; returns the mean
 * Σ w_i t_i and SD sqrt(Σ w_i (t_i − mean)²).
 */

import { AXIS_CODES, AXIS_INDEX, initialSigma, isAxisCode, N_AXES, type AxisCode } from './axes'
import {
  check3pl,
  checkGaussian,
  checkGrm,
  observationInfo,
  observationLoglik,
  observationObservedInfo,
  observationScore,
} from './irt'
import {
  cholesky,
  choleskyInverse,
  choleskyLogDet,
  choleskySolve,
  matvec,
  tryCholesky,
  type Matrix,
  type Vector,
} from './linalg'
import type { Observation } from './types'

/** Maximum Newton / Fisher-scoring iterations in {@link mapTheta} (A2). */
export const MAP_MAX_ITER = 50
/** Convergence tolerance on the accepted step max|s·step| in {@link mapTheta} (A2). */
export const MAP_TOL = 1e-8
/** Maximum step halvings per candidate step in {@link mapTheta}. */
export const MAP_MAX_HALVINGS = 30
/** Relative slack (64 machine epsilons, 2⁻⁴⁶) on the log posterior in the step-halving test (A2). */
export const MAP_LP_SLACK = 2 ** -46
/** EAP grid (§11.2, A2): 61 equally spaced points over [−4, 4]. */
export const EAP_N_GRID = 61
export const EAP_LO = -4
export const EAP_HI = 4
/** Absolute tolerance of the Σ symmetry check (as bank `_Prior`). */
const SIGMA_SYMMETRY_TOL = 1e-12

const LOG_2PI = Math.log(2 * Math.PI)

/** A read-only square matrix (array of rows). */
export type ReadonlyMatrix = readonly (readonly number[])[]

/** Result of {@link mapTheta}. */
export interface MapResult {
  /** MAP θ in canonical axis order. */
  theta: number[]
  /** Laplace covariance (Σ⁻¹ + diag(expected information at θ))⁻¹; exactly symmetric. */
  cov: number[][]
  /** Iterations run (informational, A2). */
  nIter: number
  /** {@link logPosterior} at θ. */
  logPosterior: number
}

export interface MapOptions {
  /** Default {@link MAP_MAX_ITER}. */
  maxIter?: number
  /** Default {@link MAP_TOL}. */
  tol?: number
}

/** Posterior mean and SD of one axis from {@link eapAxis}. */
export interface EapResult {
  mean: number
  sd: number
}

export interface EapGrid {
  /** Default {@link EAP_N_GRID}. */
  nGrid?: number
  /** Default {@link EAP_LO}. */
  lo?: number
  /** Default {@link EAP_HI}. */
  hi?: number
}

/** Result of {@link scoreAll}: MAP + Laplace covariance, and the EAP of every observed axis. */
export interface ScoreResult extends MapResult {
  /** Per-axis EAP for the axes with at least one observation, in canonical axis order. */
  eap: Partial<Record<AxisCode, EapResult>>
}

// ------------------------------------------------------------------------- validation

function finite(name: string, v: unknown): void {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new RangeError(`${name} must be a finite number, got ${String(v)}`)
}

function binary(y: unknown): void {
  if (y !== 0 && y !== 1) throw new RangeError(`binary response y must be 0 or 1, got ${String(y)}`)
}

/** The fields of each observation kind besides `kind` and `axis` (bank `_JSON_FIELDS`). */
const OBSERVATION_FIELDS: Readonly<Record<Observation['kind'], readonly string[]>> = {
  '2pl': ['a', 'b', 'y'],
  '3pl': ['a', 'b', 'c', 'y'],
  grm: ['a', 'b', 'y'],
  gaussian: ['lam', 'd', 'sigma', 'x'],
}

/**
 * Validate one observation (the rules of bank `observation_from_json`: exactly the fields of its
 * kind, a known axis among the first `k`, finite parameters, 0 < c < 1, increasing GRM thresholds
 * with y ∈ 0..m, σ > 0) and return its axis index. Throws a RangeError otherwise, so e.g. a 3PL
 * item mislabelled `2pl` fails instead of being scored with c ignored.
 */
export function checkObservation(o: Observation, k: number = N_AXES): number {
  if (typeof o !== 'object' || o === null || Array.isArray(o)) throw new RangeError('observation must be an object')
  const kind: unknown = o.kind
  if (typeof kind !== 'string' || !Object.hasOwn(OBSERVATION_FIELDS, kind)) {
    throw new RangeError(`unknown observation kind ${JSON.stringify(kind)}`)
  }
  const want = new Set(['kind', 'axis', ...OBSERVATION_FIELDS[kind as Observation['kind']]])
  const got = Object.keys(o)
  if (got.length !== want.size || got.some((f) => !want.has(f))) {
    const fields = (xs: Iterable<string>): string => [...xs].sort().join(', ')
    throw new RangeError(`${kind} observation needs exactly the fields [${fields(want)}], got [${fields(got)}]`)
  }
  if (!isAxisCode(o.axis)) throw new RangeError(`unknown axis code ${JSON.stringify(o.axis)}`)
  const axis = AXIS_INDEX[o.axis]
  if (axis >= k) throw new RangeError(`observation axis ${o.axis} (index ${axis}) outside 0..${k - 1}`)
  switch (o.kind) {
    case '2pl':
      finite('a', o.a)
      finite('b', o.b)
      binary(o.y)
      break
    case '3pl':
      finite('a', o.a)
      finite('b', o.b)
      finite('c', o.c)
      check3pl(o.c)
      binary(o.y)
      break
    case 'grm':
      checkGrm(o.a, o.b)
      if (!Number.isInteger(o.y) || o.y < 0 || o.y > o.b.length) {
        throw new RangeError(`GRM category y must be an integer in 0..${o.b.length}, got ${o.y}`)
      }
      break
    case 'gaussian':
      finite('lam', o.lam)
      finite('d', o.d)
      finite('x', o.x)
      checkGaussian(o.sigma)
      break
    default:
      throw new RangeError(`unknown observation kind ${JSON.stringify((o as { kind?: unknown }).kind)}`)
  }
  return axis
}

/** An observation with its axis index resolved. */
interface Item {
  readonly obs: Observation
  readonly axis: number
}

function compile(obs: readonly Observation[], k: number): Item[] {
  if (!Array.isArray(obs)) throw new RangeError('observations must be an array')
  return obs.map((o) => ({ obs: o, axis: checkObservation(o, k) }))
}

/** N(μ, Σ) with the Cholesky factor, log-determinant and precision of Σ. */
interface Prior {
  readonly k: number
  readonly mu: Vector
  readonly L: Matrix
  readonly logdet: number
  /** Σ⁻¹, exactly symmetric. */
  readonly precision: Matrix
}

function makePrior(mu: readonly number[], sigma: ReadonlyMatrix): Prior {
  if (!Array.isArray(mu) || !Array.isArray(sigma)) throw new RangeError('mu and sigma must be arrays')
  const k = mu.length
  if (k < 1 || sigma.length !== k || sigma.some((row) => !Array.isArray(row) || row.length !== k)) {
    throw new RangeError(`mu must have K ≥ 1 entries and sigma be K×K; got ${k} and ${sigma.length} rows`)
  }
  mu.forEach((v, i) => finite(`mu[${i}]`, v))
  for (const row of sigma) for (const v of row) finite('sigma entry', v)
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      if (!(Math.abs(sigma[i]![j]! - sigma[j]![i]!) <= SIGMA_SYMMETRY_TOL)) throw new RangeError('sigma must be symmetric')
    }
  }
  const L = tryCholesky(sigma.map((row) => row.slice()))
  if (L === null) throw new RangeError('sigma must be positive definite')
  return { k, mu: mu.slice(), L, logdet: choleskyLogDet(L), precision: choleskyInverse(L) }
}

function checkTheta(theta: readonly number[], k: number): void {
  if (!Array.isArray(theta) || theta.length !== k) throw new RangeError(`theta must have ${k} entries`)
}

// -------------------------------------------------------------------------- posterior

/** log N(θ; μ, Σ) with the normalising constant. */
function priorLogpdf(prior: Prior, theta: Vector): number {
  const r = theta.map((t, i) => t - prior.mu[i]!)
  const x = choleskySolve(prior.L, r)
  let quad = 0
  for (let i = 0; i < r.length; i++) quad += r[i]! * x[i]!
  return -0.5 * (prior.k * LOG_2PI + prior.logdet + quad)
}

function loglik(theta: Vector, items: readonly Item[]): number {
  let total = 0
  for (const it of items) total += observationLoglik(it.obs, theta[it.axis]!)
  return total
}

/** Per-axis sums of the scores, expected information and observed information at θ. */
function derivatives(theta: Vector, items: readonly Item[]): { score: Vector; info: Vector; observed: Vector } {
  const k = theta.length
  const score = new Array<number>(k).fill(0)
  const info = new Array<number>(k).fill(0)
  const observed = new Array<number>(k).fill(0)
  for (const it of items) {
    const t = theta[it.axis]!
    score[it.axis]! += observationScore(it.obs, t)
    info[it.axis]! += observationInfo(it.obs, t)
    observed[it.axis]! += observationObservedInfo(it.obs, t)
  }
  return { score, info, observed }
}

/** g = score − Σ⁻¹(θ − μ). */
function gradient(prior: Prior, theta: Vector, score: Vector): Vector {
  const pr = matvec(
    prior.precision,
    theta.map((t, i) => t - prior.mu[i]!),
  )
  return score.map((s, i) => s - pr[i]!)
}

/** Σ⁻¹ + diag(d). */
function addDiag(precision: Matrix, d: Vector): Matrix {
  return precision.map((row, i) => row.map((v, j) => (i === j ? v + d[i]! : v)))
}

/**
 * log p(y | θ) + log N(θ; μ, Σ), every normalising constant included (module comment). This is
 * the golden `log_posterior_at_map` when evaluated at the MAP.
 */
export function logPosterior(
  theta: readonly number[],
  obs: readonly Observation[],
  mu: readonly number[],
  sigma: ReadonlyMatrix,
): number {
  const prior = makePrior(mu, sigma)
  checkTheta(theta, prior.k)
  const items = compile(obs, prior.k)
  return loglik(theta.slice(), items) + priorLogpdf(prior, theta.slice())
}

/** Exact gradient of {@link logPosterior} with respect to θ. */
export function gradLogPosterior(
  theta: readonly number[],
  obs: readonly Observation[],
  mu: readonly number[],
  sigma: ReadonlyMatrix,
): number[] {
  const prior = makePrior(mu, sigma)
  checkTheta(theta, prior.k)
  const th = theta.slice()
  return gradient(prior, th, derivatives(th, compile(obs, prior.k)).score)
}

/** Total expected (Fisher) information per axis at θ (K = theta.length); the Laplace diagonal. */
export function expectedInformation(theta: readonly number[], obs: readonly Observation[]): number[] {
  return derivatives(theta.slice(), compile(obs, theta.length)).info
}

/** Total observed information per axis at θ; Σ⁻¹ + diag(this) is −∇² log posterior. */
export function observedInformation(theta: readonly number[], obs: readonly Observation[]): number[] {
  return derivatives(theta.slice(), compile(obs, theta.length)).observed
}

// -------------------------------------------------------------------------------- MAP

/**
 * Correlated-factor MAP θ and Laplace covariance (DESIGN §7.2; the A2 convention in the module
 * comment). Throws a RangeError for invalid observations, a μ/Σ of mismatched size, or a Σ that
 * is not symmetric positive definite.
 */
export function mapTheta(
  obs: readonly Observation[],
  mu: readonly number[],
  sigma: ReadonlyMatrix,
  { maxIter = MAP_MAX_ITER, tol = MAP_TOL }: MapOptions = {},
): MapResult {
  if (!Number.isInteger(maxIter) || maxIter < 1) throw new RangeError('maxIter must be an integer ≥ 1')
  if (!(tol >= 0)) throw new RangeError('tol must be ≥ 0')
  const prior = makePrior(mu, sigma)
  const items = compile(obs, prior.k)
  const lp = (th: Vector): number => loglik(th, items) + priorLogpdf(prior, th)

  let theta = prior.mu.slice()
  let cur = lp(theta)
  let nIter = 0
  while (nIter < maxIter) {
    nIter++
    const { score, info, observed } = derivatives(theta, items)
    const g = gradient(prior, theta, score)
    const candidates: Matrix[] = []
    const newton = tryCholesky(addDiag(prior.precision, observed)) // Newton, if −∇² lp is PD here
    if (newton !== null) candidates.push(newton)
    candidates.push(cholesky(addDiag(prior.precision, info))) // Fisher scoring
    const acceptAt = cur - MAP_LP_SLACK * (1 + Math.abs(cur))
    let accepted: Vector | null = null
    let cand = theta
    let candLp = cur
    for (const L of candidates) {
      const step = choleskySolve(L, g)
      let s = 1
      cand = theta.map((t, i) => t + step[i]!)
      candLp = lp(cand)
      let halvings = 0
      while (!(candLp >= acceptAt) && halvings < MAP_MAX_HALVINGS) {
        s *= 0.5
        cand = theta.map((t, i) => t + s * step[i]!)
        candLp = lp(cand)
        halvings++
      }
      if (candLp >= acceptAt) {
        accepted = step.map((v) => s * v)
        break
      }
    }
    if (accepted === null) break // no step gives an ascent: θ is the MAP to floating-point resolution
    theta = cand
    cur = candLp
    let maxStep = 0
    for (const v of accepted) maxStep = Math.max(maxStep, Math.abs(v))
    if (maxStep < tol) break
  }

  const { info } = derivatives(theta, items)
  const cov = choleskyInverse(cholesky(addDiag(prior.precision, info)))
  return { theta, cov, nIter, logPosterior: cur }
}

// -------------------------------------------------------------------------------- EAP

/**
 * Unidimensional grid EAP for one axis (DESIGN §11.2, A2): uses only `obsForAxis` (which must all
 * load on one axis) and the marginal prior N(`muK`, `varK`); correlations with other axes are
 * ignored by design.
 */
export function eapAxis(
  obsForAxis: readonly Observation[],
  muK: number,
  varK: number,
  { nGrid = EAP_N_GRID, lo = EAP_LO, hi = EAP_HI }: EapGrid = {},
): EapResult {
  if (!Number.isInteger(nGrid) || nGrid < 2) throw new RangeError('nGrid must be an integer ≥ 2')
  finite('lo', lo)
  finite('hi', hi)
  if (!(lo < hi)) throw new RangeError('need lo < hi')
  finite('muK', muK)
  finite('varK', varK)
  if (!(varK > 0)) throw new RangeError('varK must be positive')
  const axes = new Set(compile(obsForAxis, N_AXES).map((it) => it.axis))
  if (axes.size > 1) throw new RangeError('eapAxis observations must all load on the same axis')

  // t_i = lo + i·step, the last point exactly hi (as numpy.linspace).
  const step = (hi - lo) / (nGrid - 1)
  const grid = Array.from({ length: nGrid }, (_, i) => (i === nGrid - 1 ? hi : lo + i * step))
  const logw = grid.map((t) => (-0.5 * (t - muK) * (t - muK)) / varK)
  for (const o of obsForAxis) for (let i = 0; i < nGrid; i++) logw[i]! += observationLoglik(o, grid[i]!)
  let mx = -Infinity
  for (const v of logw) mx = Math.max(mx, v)
  const w = logw.map((v) => Math.exp(v - mx))
  let total = 0
  for (const v of w) total += v
  let mean = 0
  for (let i = 0; i < nGrid; i++) {
    w[i] = w[i]! / total
    mean += w[i]! * grid[i]!
  }
  let variance = 0
  for (let i = 0; i < nGrid; i++) variance += w[i]! * (grid[i]! - mean) * (grid[i]! - mean)
  return { mean, sd: Math.sqrt(Math.max(variance, 0)) }
}

/** {@link eapAxis} for every axis with at least one observation, keyed by code in axis order. */
export function eapByAxis(
  obs: readonly Observation[],
  mu: readonly number[],
  sigma: ReadonlyMatrix,
  grid: EapGrid = {},
): Partial<Record<AxisCode, EapResult>> {
  const prior = makePrior(mu, sigma)
  const items = compile(obs, prior.k)
  const out: Partial<Record<AxisCode, EapResult>> = {}
  for (let k = 0; k < prior.k; k++) {
    const mine = items.filter((it) => it.axis === k).map((it) => it.obs)
    if (mine.length === 0) continue
    out[AXIS_CODES[k]!] = eapAxis(mine, prior.mu[k]!, sigma[k]![k]!, grid)
  }
  return out
}

// ------------------------------------------------------------------------ convenience

/**
 * Score a session: MAP θ + Laplace covariance ({@link mapTheta}) and the per-axis EAP
 * ({@link eapByAxis}) of every axis with at least one observation. The prior defaults to
 * μ = 0 and the pinned Σ_init ({@link initialSigma}, ROADMAP A8).
 */
export function scoreAll(obs: readonly Observation[], mu?: readonly number[], sigma?: ReadonlyMatrix): ScoreResult {
  const m = mu ?? new Array<number>(N_AXES).fill(0)
  const S = sigma ?? initialSigma()
  return { ...mapTheta(obs, m, S), eap: eapByAxis(obs, m, S) }
}
