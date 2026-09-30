/**
 * Item response functions, log-likelihoods, scores and Fisher information (DESIGN §7.1).
 * Mirrors the Python reference `hb.calib.irt` (ROADMAP A2).
 *
 * Conventions:
 * - 2pl: y ∈ {0,1}, P = σ(a(θ − b)).
 * - 3pl: y ∈ {0,1}, P = c + (1 − c)·σ(a(θ − b)), c fixed at 1/k for k ≤ 4 options (A9), 0 < c < 1.
 * - grm: Samejima graded response, y ∈ {0..m}, a > 0, thresholds b_1 < … < b_m,
 *   P*(≥j) = σ(a(θ − b_j)), P*(≥0) = 1, P*(≥m+1) = 0, P(y = j) = P*(≥j) − P*(≥j+1).
 * - gaussian: x ~ N(λθ + d, σ²) with σ > 0; λ (`lam`) may be negative (RT log-time has λ = −1).
 * - testlet: 1 to 8 2PL items sharing an effect γ ~ N(0, τ²), integrated out on a fixed grid
 *   (§7.1, M3.9; derivation in the "testlet" section below).
 *
 * Parameters outside these domains (c ∉ (0, 1), σ ≤ 0, unordered GRM thresholds, y outside the
 * category set, an unknown observation kind) throw a RangeError instead of returning NaN.
 *
 * "Score" is d log p(y | θ)/dθ. "Information" (`info*`) is the expected (Fisher) information,
 * which the Laplace covariance uses (§7.2) and the MAP falls back to where the observed information
 * is not usable. "Observed information" (`observedInfo*`) is −d² log p(y | θ)/dθ², which the MAP's
 * Newton step uses (ROADMAP A2). For 2PL and Gaussian terms the two coincide. For GRM terms the
 * observed information is never negative (the logistic GRM log-likelihood is concave in θ); for a
 * correct 3PL response it is negative where σ(z)·(u + 2c) < c with u = (1 − c)·σ(z), i.e. at low θ.
 *
 * Numerical stability: nothing overflows or divides by zero for logits |z| = |a(θ − b)| up to
 * 1e4 and beyond. 3PL quantities are written in σ(z), σ(−z) rather than differences like P − c,
 * and GRM log-probabilities use log(σ(x) − σ(y)) = log σ(x) + log σ(−y) + log(−expm1(y − x)).
 */

import type { Observation, TestletItem } from './types'

const LOG_2PI = Math.log(2 * Math.PI)

// ----------------------------------------------------------------------------- logistic

/** Numerically stable logistic σ(z) = 1/(1 + e^{−z}); exact 0/1 limits, never NaN for finite z. */
export function logistic(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z))
  const e = Math.exp(z)
  return e / (1 + e)
}

/** Numerically stable log σ(z) = −log(1 + e^{−z}). */
export function logLogistic(z: number): number {
  return z >= 0 ? -Math.log1p(Math.exp(-z)) : z - Math.log1p(Math.exp(z))
}

// ---------------------------------------------------------------------------------- 2PL

/** Throws unless y is exactly 0 or 1 (2PL/3PL responses). */
function checkBinary(y: number): void {
  if (y !== 0 && y !== 1) throw new RangeError(`binary response must be 0 or 1, got ${y}`)
}

/** 2PL P(correct) = σ(a(θ − b)). */
export function p2pl(theta: number, a: number, b: number): number {
  return logistic(a * (theta - b))
}

/** log P(y | θ) under the 2PL. */
export function loglik2pl(theta: number, a: number, b: number, y: 0 | 1): number {
  checkBinary(y)
  const z = a * (theta - b)
  return y === 1 ? logLogistic(z) : logLogistic(-z)
}

/** d log P(y | θ)/dθ = a(y − P). */
export function score2pl(theta: number, a: number, b: number, y: 0 | 1): number {
  checkBinary(y)
  return a * (y - p2pl(theta, a, b))
}

/** Fisher information a²·P·(1 − P). */
export function info2pl(theta: number, a: number, b: number): number {
  const z = a * (theta - b)
  return a * a * logistic(z) * logistic(-z)
}

// ---------------------------------------------------------------------------------- 3PL

/** Throws unless the 3PL guessing parameter satisfies 0 < c < 1. */
export function check3pl(c: number): void {
  if (!(c > 0 && c < 1)) throw new RangeError(`3PL guessing parameter must be in (0, 1), got ${c}`)
}

/** 3PL P(correct) = c + (1 − c)·σ(a(θ − b)). */
export function p3pl(theta: number, a: number, b: number, c: number): number {
  check3pl(c)
  return c + (1 - c) * logistic(a * (theta - b))
}

/** log P(y | θ) under the 3PL (0 < c < 1). */
export function loglik3pl(theta: number, a: number, b: number, c: number, y: 0 | 1): number {
  check3pl(c)
  checkBinary(y)
  const z = a * (theta - b)
  if (y === 0) return Math.log1p(-c) + logLogistic(-z)
  // log(c + (1 − c)σ(z)) as a log-sum-exp of log c and log(1 − c) + log σ(z).
  const u = Math.log(c)
  const v = Math.log1p(-c) + logLogistic(z)
  const m = Math.max(u, v)
  return m + Math.log(Math.exp(u - m) + Math.exp(v - m))
}

/**
 * d log P(y | θ)/dθ = a(y − P)(P − c)/(P(1 − c)) = a(y − P)·σ(z)/P (§7.1; P ≥ c > 0).
 */
export function score3pl(theta: number, a: number, b: number, c: number, y: 0 | 1): number {
  check3pl(c)
  checkBinary(y)
  const s = logistic(a * (theta - b))
  const p = c + (1 - c) * s
  return (a * (y - p) * s) / p
}

/**
 * Fisher information a²(P − c)²(1 − P)/(P(1 − c)²) = a²·σ(z)²·(1 − c)·σ(−z)/P.
 */
export function info3pl(theta: number, a: number, b: number, c: number): number {
  check3pl(c)
  const z = a * (theta - b)
  const s = logistic(z)
  const p = c + (1 - c) * s
  return (a * a * s * s * (1 - c) * logistic(-z)) / p
}

/**
 * Observed information −d² log P(y | θ)/dθ² under the 3PL (bank `observed_info_3pl`); can be
 * negative for y = 1. y = 0: a²·σ(z)·σ(−z) (as for the 2PL). y = 1: with s = σ(z),
 * u = (1 − c)·s and P = c + u, a²·u·σ(−z)·(s·(u + 2c) − c)/P².
 */
export function observedInfo3pl(theta: number, a: number, b: number, c: number, y: 0 | 1): number {
  check3pl(c)
  checkBinary(y)
  const z = a * (theta - b)
  const s = logistic(z)
  const q = logistic(-z)
  if (y === 0) return a * a * s * q
  const u = (1 - c) * s
  const p = c + u
  return (a * a * u * q * (s * (u + 2 * c) - c)) / (p * p)
}

// ---------------------------------------------------------------------------------- GRM

/** Throws unless a > 0 and the thresholds are non-empty, finite and strictly increasing. */
export function checkGrm(a: number, thresholds: readonly number[]): void {
  if (!(a > 0) || !Number.isFinite(a)) throw new RangeError(`GRM discrimination must be positive, got ${a}`)
  if (!Array.isArray(thresholds)) throw new RangeError('GRM thresholds must be an array')
  if (thresholds.length < 1) throw new RangeError('GRM needs at least one threshold')
  for (let j = 0; j < thresholds.length; j++) {
    const bj = thresholds[j]!
    if (!Number.isFinite(bj)) throw new RangeError(`GRM threshold ${j} is not finite`)
    if (j > 0 && !(bj > thresholds[j - 1]!)) throw new RangeError('GRM thresholds must be strictly increasing')
  }
}

/** Boundary curves P*(≥j) for j = 0..m+1 (length m + 2; first 1, last 0). */
export function grmCumulative(theta: number, a: number, thresholds: readonly number[]): number[] {
  checkGrm(a, thresholds)
  return [1, ...thresholds.map((bj) => logistic(a * (theta - bj))), 0]
}

/** log P(y = j | θ) for j = 0..m (length m + 1), computed without cancellation. */
export function grmLogProbs(theta: number, a: number, thresholds: readonly number[]): number[] {
  checkGrm(a, thresholds)
  const m = thresholds.length
  const z = thresholds.map((bj) => a * (theta - bj)) // z_1 > z_2 > … > z_m
  const out = new Array<number>(m + 1)
  out[0] = logLogistic(-z[0]!) // 1 − σ(z_1)
  for (let j = 1; j < m; j++) {
    // σ(z_j) − σ(z_{j+1}); the gap z_j − z_{j+1} = a(b_{j+1} − b_j) > 0.
    const gap = a * (thresholds[j]! - thresholds[j - 1]!)
    out[j] = logLogistic(z[j - 1]!) + logLogistic(-z[j]!) + Math.log(-Math.expm1(-gap))
  }
  out[m] = logLogistic(z[m - 1]!) // σ(z_m)
  return out
}

/** P(y = j | θ) for j = 0..m; sums to 1. */
export function grmProbs(theta: number, a: number, thresholds: readonly number[]): number[] {
  return grmLogProbs(theta, a, thresholds).map(Math.exp)
}

function checkCategory(y: number, m: number): void {
  if (!Number.isInteger(y) || y < 0 || y > m) throw new RangeError(`GRM category ${y} outside 0..${m}`)
}

/** log P(y | θ) under the GRM. */
export function loglikGrm(theta: number, a: number, thresholds: readonly number[], y: number): number {
  checkCategory(y, thresholds.length)
  return grmLogProbs(theta, a, thresholds)[y]!
}

/** Category scores d log P(y = j | θ)/dθ = a(1 − P*_j − P*_{j+1}) for j = 0..m. */
function grmCategoryScores(theta: number, a: number, thresholds: readonly number[]): number[] {
  const cum = grmCumulative(theta, a, thresholds)
  return thresholds.concat(0).map((_, j) => a * (1 - cum[j]! - cum[j + 1]!))
}

/** d log P(y | θ)/dθ = a(1 − P*(≥y) − P*(≥y+1)). */
export function scoreGrm(theta: number, a: number, thresholds: readonly number[], y: number): number {
  checkCategory(y, thresholds.length)
  return grmCategoryScores(theta, a, thresholds)[y]!
}

/** Samejima Fisher information Σ_j P_j·(d log P_j/dθ)². */
export function infoGrm(theta: number, a: number, thresholds: readonly number[]): number {
  const scores = grmCategoryScores(theta, a, thresholds)
  const probs = grmProbs(theta, a, thresholds)
  let s = 0
  for (let j = 0; j < probs.length; j++) s += probs[j]! * scores[j]! * scores[j]!
  return s
}

/**
 * Observed information −d² log P(y | θ)/dθ² = a²·(v_y + v_{y+1}) ≥ 0 under the GRM (bank
 * `observed_info_grm`), with v_j = σ(z_j)·σ(−z_j), z_j = a(θ − b_j) for the inner boundaries
 * j = 1..m and v_0 = v_{m+1} = 0 (the boundaries P*(≥0) = 1 and P*(≥m+1) = 0 are constant).
 */
export function observedInfoGrm(theta: number, a: number, thresholds: readonly number[], y: number): number {
  checkGrm(a, thresholds)
  const m = thresholds.length
  checkCategory(y, m)
  let total = 0
  for (let j = y; j <= y + 1; j++) {
    if (j < 1 || j > m) continue
    const z = a * (theta - thresholds[j - 1]!)
    total += logistic(z) * logistic(-z)
  }
  return a * a * total
}

// ----------------------------------------------------------------------------- Gaussian

/** Throws unless the Gaussian residual SD is positive and finite. */
export function checkGaussian(sigma: number): void {
  if (!(sigma > 0) || !Number.isFinite(sigma)) {
    throw new RangeError(`Gaussian sigma must be positive and finite, got ${sigma}`)
  }
}

/** log N(x; λθ + d, σ²), including the normalising constant. */
export function loglikGaussian(theta: number, lam: number, d: number, sigma: number, x: number): number {
  checkGaussian(sigma)
  const r = (x - lam * theta - d) / sigma
  return -0.5 * r * r - Math.log(sigma) - 0.5 * LOG_2PI
}

/** d log p(x | θ)/dθ = λ(x − λθ − d)/σ². */
export function scoreGaussian(theta: number, lam: number, d: number, sigma: number, x: number): number {
  checkGaussian(sigma)
  return (lam * (x - lam * theta - d)) / (sigma * sigma)
}

/** Fisher information λ²/σ² (constant in θ). */
export function infoGaussian(lam: number, sigma: number): number {
  checkGaussian(sigma)
  return (lam * lam) / (sigma * sigma)
}

// ------------------------------------------------------------------------------ testlet

/*
 * Testlet (passage / game-setup) block, DESIGN §7.1, ROADMAP M3.9. The n items of one testlet
 * share a random effect γ ~ N(0, τ²), τ = TESTLET_SD = 0.3, so given γ the items are independent
 * 2PL items on θ + γ, and the block's likelihood in θ is the marginal
 *
 *   L(θ) = ∫ Π_j p_j(y_j | θ + γ) N(γ; 0, τ²) dγ,   p_j(1 | t) = σ(a_j(t − b_j)).
 *
 * The integral is a fixed rule, part of the model and of the golden vectors (scoring_v2): the
 * equal-spacing rule with Gaussian weights on γ = τ·z_i, z_i = −8 + i/4 for i = 0..64 (z = 0 is a
 * node), w_i = exp(−z_i²/2)/Σ_k exp(−z_k²/2), so Σ w_i = 1 and L = Π p_j exactly when τ = 0. For
 * smooth integrands this rule converges geometrically in the spacing; with a ≤ 4 it agrees with
 * an adaptive integral to about 1e-6 in log L even for improbable response patterns.
 *
 * With π_i(θ) = w_i L_i / Σ_k w_k L_k the posterior weight of node i, S_i = Σ_j a_j (y_j − p_ij)
 * and O_i = Σ_j a_j² p_ij (1 − p_ij) the score and the 2PL information of the items at θ + τ·z_i:
 *
 *   score              d log L/dθ     = Σ_i π_i S_i                       (Fisher's identity: exact)
 *   observed info      −d² log L/dθ²  = Σ_i π_i O_i − (Σ_i π_i S_i² − (Σ_i π_i S_i)²)
 *   expected info      Σ_y P(y|θ)·score(y)², over the 2^n response patterns y, P(y|θ) = Σ_i w_i L_i(y),
 *                      = Σ_y (Σ_i w_i L_i(y) S_i(y))² / P(y|θ)
 *
 * The expected information is that of the marginal model, so it is smaller than the sum of the
 * items' 2PL information (the shared γ makes them partly redundant: about 1/(1 + τ²·I) of it for
 * items with total information I, i.e. a discount of roughly 10-25% for typical 3-4 item
 * testlets, DESIGN §7.1 "about 20%"). The marginal log-likelihood of 2PL items is concave in θ
 * (Prekopa), so the observed information is >= 0.
 */

/** The testlet effect SD τ, DESIGN §7.1: γ ~ N(0, 0.3²). */
export const TESTLET_SD = 0.3
/** Most items in one testlet observation (DESIGN §3: 3-4 questions per setup); the expected information sums 2^n patterns. */
export const MAX_TESTLET_ITEMS = 8
/** The γ quadrature: z_i = −TESTLET_Z_MAX + i·TESTLET_Z_STEP for i = 0..TESTLET_N_NODES − 1. */
export const TESTLET_Z_MAX = 8
export const TESTLET_Z_STEP = 0.25
export const TESTLET_N_NODES = 65

/** The nodes z_i (exact binary fractions) and their log weights, normalised to Σ exp = 1. */
const TESTLET_Z: readonly number[] = Object.freeze(Array.from({ length: TESTLET_N_NODES }, (_, i) => -TESTLET_Z_MAX + i * TESTLET_Z_STEP))
const TESTLET_LOG_W: readonly number[] = (() => {
  let total = 0
  for (const z of TESTLET_Z) total += Math.exp(-0.5 * z * z)
  const logTotal = Math.log(total)
  return Object.freeze(TESTLET_Z.map((z) => -0.5 * z * z - logTotal))
})()
const TESTLET_W: readonly number[] = Object.freeze(TESTLET_LOG_W.map(Math.exp))
/** The quadrature nodes z_i and weights w_i of the γ integral (γ_i = τ·z_i), for tests and ports. */
export const TESTLET_NODES: readonly number[] = TESTLET_Z
export const TESTLET_WEIGHTS: readonly number[] = TESTLET_W

/** Throws unless τ is finite and ≥ 0 and the items are 1 to {@link MAX_TESTLET_ITEMS} finite 2PL items with binary y. */
export function checkTestlet(tau: number, items: readonly TestletItem[]): void {
  if (typeof tau !== 'number' || !Number.isFinite(tau) || tau < 0) throw new RangeError(`testlet tau must be finite and ≥ 0, got ${String(tau)}`)
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_TESTLET_ITEMS) {
    throw new RangeError(`a testlet has 1 to ${MAX_TESTLET_ITEMS} items, got ${Array.isArray(items) ? items.length : String(items)}`)
  }
  for (const it of items) {
    if (typeof it !== 'object' || it === null) throw new RangeError('testlet item must be an object')
    if (typeof it.a !== 'number' || !Number.isFinite(it.a)) throw new RangeError(`testlet item a must be finite, got ${String(it.a)}`)
    if (typeof it.b !== 'number' || !Number.isFinite(it.b)) throw new RangeError(`testlet item b must be finite, got ${String(it.b)}`)
    checkBinary(it.y)
  }
}

/** Per node i: log w_i + Σ_j log p_j(y_j | θ + τ z_i). */
function testletNodeLogLik(theta: number, tau: number, items: readonly TestletItem[]): number[] {
  return TESTLET_Z.map((z, i) => {
    const t = theta + tau * z
    let l = 0
    for (const it of items) {
      const x = it.a * (t - it.b)
      l += it.y === 1 ? logLogistic(x) : logLogistic(-x)
    }
    return TESTLET_LOG_W[i]! + l
  })
}

function logSumExp(v: readonly number[]): number {
  let m = -Infinity
  for (const x of v) m = Math.max(m, x)
  let s = 0
  for (const x of v) s += Math.exp(x - m)
  return m + Math.log(s)
}

/** log L(θ) of a testlet: the log of the γ-marginal likelihood of its responses (module comment). */
export function loglikTestlet(theta: number, tau: number, items: readonly TestletItem[]): number {
  checkTestlet(tau, items)
  return logSumExp(testletNodeLogLik(theta, tau, items))
}

/** The score, observed information and (when asked) expected information of a testlet at θ. */
export interface TestletDerivatives {
  /** d log L/dθ = Σ_i π_i S_i. */
  score: number
  /** −d² log L/dθ² = E_π[O] − Var_π[S] (module comment); ≥ 0. */
  observed: number
  /** Expected (Fisher) information of the marginal model over the 2^n response patterns; NaN unless asked for. */
  info: number
}

/**
 * The three derivative quantities of a testlet in one pass over the nodes: each item's σ and 1 − σ
 * at each node come from one exp (stable for both signs of the logit), shared by the score, the
 * observed information and the pattern sum of the expected information. `withInfo` false skips
 * the 2^n pattern sum (info is NaN). This is what the MAP loop calls (scorer.ts), where the three
 * are needed together at every iteration.
 */
export function testletDerivatives(theta: number, tau: number, items: readonly TestletItem[], withInfo = true): TestletDerivatives {
  checkTestlet(tau, items)
  const n = items.length
  const N = TESTLET_N_NODES
  const p = new Float64Array(N * n) // p_ij = σ(a_j(θ + τ z_i − b_j))
  const q = new Float64Array(N * n) // 1 − p_ij, from the same exp (no cancellation)
  const pa = new Float64Array(N) // Σ_j a_j p_ij
  const lw = new Array<number>(N) // log w_i + Σ_j log p_j(y_j | θ + τ z_i)
  const s = new Array<number>(N) // S_i = Σ_j a_j (y_j − p_ij)
  const o = new Array<number>(N) // O_i = Σ_j a_j² p_ij q_ij
  for (let i = 0; i < N; i++) {
    const t = theta + tau * TESTLET_Z[i]!
    let l = 0
    let si = 0
    let oi = 0
    let pai = 0
    for (let j = 0; j < n; j++) {
      const it = items[j]!
      const x = it.a * (t - it.b)
      const e = Math.exp(-Math.abs(x))
      const inv = 1 / (1 + e)
      const pj = x >= 0 ? inv : e * inv
      const qj = x >= 0 ? e * inv : inv
      p[i * n + j] = pj
      q[i * n + j] = qj
      const l1 = Math.log1p(e) // log σ(x) = −l1 (x ≥ 0) or x − l1; log σ(−x) = −x − l1 (x ≥ 0) or −l1
      l += it.y === 1 ? (x >= 0 ? -l1 : x - l1) : x >= 0 ? -x - l1 : -l1
      si += it.a * (it.y - pj)
      oi += it.a * it.a * pj * qj
      pai += it.a * pj
    }
    lw[i] = TESTLET_LOG_W[i]! + l
    s[i] = si
    o[i] = oi
    pa[i] = pai
  }
  const ll = logSumExp(lw)
  let eS = 0
  let eSS = 0
  let eO = 0
  for (let i = 0; i < N; i++) {
    const pi = Math.exp(lw[i]! - ll)
    eS += pi * s[i]!
    eSS += pi * s[i]! * s[i]!
    eO += pi * o[i]!
  }
  let info = Number.NaN
  if (withInfo) {
    info = 0
    for (let m = 0; m < 1 << n; m++) {
      let ya = 0 // Σ_j a_j y_j
      for (let j = 0; j < n; j++) if (((m >> j) & 1) === 1) ya += items[j]!.a
      let prob = 0 // P(y | θ)
      let num = 0 // P(y | θ) · score(y | θ)
      for (let i = 0; i < N; i++) {
        let l = TESTLET_W[i]!
        for (let j = 0; j < n; j++) l *= ((m >> j) & 1) === 1 ? p[i * n + j]! : q[i * n + j]!
        prob += l
        num += l * (ya - pa[i]!)
      }
      if (prob > 0) info += (num * num) / prob
    }
  }
  return { score: eS, observed: eO - (eSS - eS * eS), info }
}

/** d log L/dθ = Σ_i π_i S_i. */
export function scoreTestlet(theta: number, tau: number, items: readonly TestletItem[]): number {
  return testletDerivatives(theta, tau, items, false).score
}

/** Observed information −d² log L/dθ² = E_π[O] − Var_π[S] (module comment); ≥ 0. */
export function observedInfoTestlet(theta: number, tau: number, items: readonly TestletItem[]): number {
  return testletDerivatives(theta, tau, items, false).observed
}

/** Expected (Fisher) information of the marginal testlet model, summed over the 2^n response patterns (module comment). */
export function infoTestlet(theta: number, tau: number, items: readonly TestletItem[]): number {
  return testletDerivatives(theta, tau, items, true).info
}

// ------------------------------------------------------------------- observation dispatch

/** Exhaustiveness guard: an observation whose kind is outside the union (e.g. '2pl_testlet'). */
function unknownKind(obs: never): never {
  throw new RangeError(`unknown observation kind ${JSON.stringify((obs as { kind?: unknown }).kind)}`)
}

/** log p(obs | θ_axis) for one scorer observation (§7.2). */
export function observationLoglik(obs: Observation, theta: number): number {
  switch (obs.kind) {
    case '2pl':
      return loglik2pl(theta, obs.a, obs.b, obs.y)
    case '3pl':
      return loglik3pl(theta, obs.a, obs.b, obs.c, obs.y)
    case 'grm':
      return loglikGrm(theta, obs.a, obs.b, obs.y)
    case 'gaussian':
      return loglikGaussian(theta, obs.lam, obs.d, obs.sigma, obs.x)
    case 'testlet':
      return loglikTestlet(theta, obs.tau, obs.items)
    default:
      return unknownKind(obs)
  }
}

/** d log p(obs | θ_axis)/dθ_axis for one observation. */
export function observationScore(obs: Observation, theta: number): number {
  switch (obs.kind) {
    case '2pl':
      return score2pl(theta, obs.a, obs.b, obs.y)
    case '3pl':
      return score3pl(theta, obs.a, obs.b, obs.c, obs.y)
    case 'grm':
      return scoreGrm(theta, obs.a, obs.b, obs.y)
    case 'gaussian':
      return scoreGaussian(theta, obs.lam, obs.d, obs.sigma, obs.x)
    case 'testlet':
      return scoreTestlet(theta, obs.tau, obs.items)
    default:
      return unknownKind(obs)
  }
}

/** Expected (Fisher) information of one observation at θ_axis. */
export function observationInfo(obs: Observation, theta: number): number {
  switch (obs.kind) {
    case '2pl':
      return info2pl(theta, obs.a, obs.b)
    case '3pl':
      return info3pl(theta, obs.a, obs.b, obs.c)
    case 'grm':
      return infoGrm(theta, obs.a, obs.b)
    case 'gaussian':
      return infoGaussian(obs.lam, obs.sigma)
    case 'testlet':
      return infoTestlet(theta, obs.tau, obs.items)
    default:
      return unknownKind(obs)
  }
}

/**
 * Observed information −d² log p(obs | θ_axis)/dθ_axis² of one observation, the MAP's Newton
 * curvature (ROADMAP A2). Equal to {@link observationInfo} for 2PL and Gaussian terms.
 */
export function observationObservedInfo(obs: Observation, theta: number): number {
  switch (obs.kind) {
    case '2pl':
      return info2pl(theta, obs.a, obs.b)
    case '3pl':
      return observedInfo3pl(theta, obs.a, obs.b, obs.c, obs.y)
    case 'grm':
      return observedInfoGrm(theta, obs.a, obs.b, obs.y)
    case 'gaussian':
      return infoGaussian(obs.lam, obs.sigma)
    case 'testlet':
      return observedInfoTestlet(theta, obs.tau, obs.items)
    default:
      return unknownKind(obs)
  }
}
