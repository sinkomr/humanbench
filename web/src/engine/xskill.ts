/**
 * The cross-skill start of a part (owner request 2026-10-15; DESIGN §7.4 "Cross-skill aim", §3 "Initial Σ",
 * §7.8; ROADMAP "Owner decisions 2026-10-15"). Pure. The app's selector (`selector.ts` {@link selectionAim}) and
 * the server's selection (`supabase/migrations/20261016000100_cross_skill_aim.sql`, `hb.session_aims`) compute
 * the same aim, and `scripts/db/xskill.db.test.ts` holds the SQL to this module on the same answers.
 *
 * ## Why
 *
 * The owner: "a user does very well on the quantitative series of questions, so when we shift over to science
 * or logic or other similar families of questions, we start at a higher difficulty level. if they get it wrong,
 * of course the adaptive nature drops the difficulty down from there." Before this, the first question of every
 * part was aimed at the skill's OWN estimate only: the per-skill EAP (`scorer.ts` eapAxis, the in-session
 * estimator of §11.2) ignores the other skills by design, so a skill with no answer yet sat at the population
 * mean, 0, whatever the session had shown. The owner, near-perfect on every part, began every part at
 * stratum 2 to 3 (the strata nearest 0, the criterion's division by time preferring the quicker, easier one).
 * The correlations of Σ (§3) were used nowhere in selection.
 *
 * ## The aim
 *
 * Selection only. Every skill's items are aimed at the EAP of its own answers under a prior that is the
 * CONDITIONAL distribution of the skill given the answers on every OTHER skill, through the selection prior
 * Σ_sel = f²·R(s): the scoring Σ with its correlations multiplied by the borrowing strength s ({@link XSKILL_BORROW})
 * and the whole widened by f ({@link SELECTION_PRIOR_SD_FACTOR}, the wider aim of 2026-10-13):
 *
 * 1. each other skill j with answers sends a Gaussian message ({@link message}): the grid posterior of its own
 *    answers under N(μ_j, Σsel_jj) has mean m_j and variance v_j, the prior alone on the same grid m⁰_j and v⁰_j;
 *    the prior is divided out, giving precision λ_j = 1/v_j − 1/v⁰_j and location x_j = (m_j/v_j − m⁰_j/v⁰_j)/λ_j
 *    (a skill whose answers say nothing, λ_j ≤ {@link MESSAGE_MIN_PRECISION}, sends none);
 * 2. the skill's conditional prior is the Gaussian regression on those messages,
 *    mean μ_k + Σsel_kJ (Σsel_JJ + diag(1/λ_J))⁻¹ (x_J − μ_J), variance Σsel_kk − Σsel_kJ (Σsel_JJ + diag(1/λ_J))⁻¹ Σsel_Jk;
 * 3. the aim is the grid EAP of the skill's own answers under that prior, or its mean when the skill has none.
 *
 * So a part's FIRST question is aimed where the rest of the session (and, for a returning person, earlier
 * sessions: {@link crossSkillAims} takes their answers too) says the skill is likely to be, and its own answers
 * take over as they come (the own grid likelihood sharpens while the borrowed prior stays as wide as it was).
 * With s = 0, or with no answer on any other skill, the conditional prior is N(μ_k, f²Σ_kk) and the aim is
 * exactly that of 2026-10-13. The start-up step (`startup.ts`) is unchanged: it steps from the first question's
 * difficulty, so a wrong first answer drops a stratum at once.
 *
 * ## What it does not change
 *
 * Every score. The posterior a session reports, the variance in the §7.4 criterion, the per-skill stop, the
 * results and the server's `rescore` keep the per-skill model of today: the borrowing moves where questions are
 * aimed, never what an answer counts for, so a profile with peaks and dips is not flattened toward its average.
 * Σ is the scoring Σ (Σ_init on the device, `app_config` `scoring.sigma` on the server), so when §3's nightly
 * re-estimate replaces it the selection follows without a change here.
 */

import { AXIS_CODES, N_AXES, type AxisCode } from './axes'
import { observationLoglik } from './irt'
import { cholesky, choleskySolve, type Matrix } from './linalg'
import { checkObservation, EAP_HI, EAP_LO, EAP_N_GRID, type ReadonlyMatrix } from './scorer'
import { SELECTION_PRIOR_SD_FACTOR } from './startup'
import type { Observation } from './types'

/**
 * The borrowing strength s: the correlations of Σ used for the aim are s times the scoring ones (1: Σ as it is;
 * 0: no borrowing, the aim of 2026-10-13). Chosen by simulation (`npm run sim:cat -- --part d`; ROADMAP "Owner
 * decisions 2026-10-15"): 0.75 is the knee. Against 1 it reaches a Σ-shaped population's level a little sooner
 * (2.34 against 2.43 questions to one within 0.5 of θ, 2.51 without borrowing) and costs a dip or a peak less
 * (5.5 against 5.7 questions on that skill, 5.2 without), and it keeps most of the gain on the owner's profile
 * (3.5 questions a part against 3.1 at 1 and 5.4 without). The reported scores are as good or better at every s.
 */
export const XSKILL_BORROW = 0.75

/** A skill whose answers carry less precision than this (relative to the selection prior) sends no message. */
export const MESSAGE_MIN_PRECISION = 1e-9

/** The 61-point grid of the in-session EAP (scorer.ts eapAxis, `hb.eap_grid`): −4 … 4, the last point exactly 4. */
export const AIM_GRID: readonly number[] = Object.freeze(
  Array.from({ length: EAP_N_GRID }, (_, i) => (i === EAP_N_GRID - 1 ? EAP_HI : EAP_LO + (i * (EAP_HI - EAP_LO)) / (EAP_N_GRID - 1))),
)

/** The grid log-likelihood of each skill's observations, by axis index (a skill without one is absent). */
export function gridLoglik(obs: readonly Observation[]): Map<number, number[]> {
  const out = new Map<number, number[]>()
  for (const o of obs) {
    const k = checkObservation(o, N_AXES)
    let ll = out.get(k)
    if (ll === undefined) {
      ll = new Array<number>(AIM_GRID.length).fill(0)
      out.set(k, ll)
    }
    for (let i = 0; i < AIM_GRID.length; i++) ll[i]! += observationLoglik(o, AIM_GRID[i]!)
  }
  return out
}

/**
 * Mean and SD on the grid of a summed log-likelihood under N(mu, v) (scorer.ts eapAxis, `hb.eap_from_ll`:
 * weights exp(l − max l), normalised). A null log-likelihood is the prior alone, on the grid.
 */
export function gridPosterior(ll: readonly number[] | null, mu: number, v: number): { mean: number; sd: number } {
  if (!(v > 0) || !Number.isFinite(v) || !Number.isFinite(mu)) throw new RangeError(`gridPosterior(): need a finite mean and a positive variance, got ${mu}, ${v}`)
  const lw = AIM_GRID.map((t, i) => (-0.5 * (t - mu) * (t - mu)) / v + (ll?.[i] ?? 0))
  let mx = -Infinity
  for (const x of lw) mx = Math.max(mx, x)
  const w = lw.map((x) => Math.exp(Math.max(x - mx, -230)))
  let total = 0
  for (const x of w) total += x
  let mean = 0
  for (let i = 0; i < w.length; i++) {
    w[i] = w[i]! / total
    mean += w[i]! * AIM_GRID[i]!
  }
  let variance = 0
  for (let i = 0; i < w.length; i++) variance += w[i]! * (AIM_GRID[i]! - mean) * (AIM_GRID[i]! - mean)
  return { mean, sd: Math.sqrt(Math.max(variance, 0)) }
}

export interface CrossSkillOptions {
  /** Prior mean per axis (default 0). */
  readonly mu?: readonly number[]
  /** The scoring prior covariance (required: the caller's Σ, so a re-estimated one is used as it is). */
  readonly sigma: ReadonlyMatrix
  /** How many times wider than the scoring prior (default {@link SELECTION_PRIOR_SD_FACTOR}). */
  readonly factor?: number
  /** The borrowing strength s in [0, 1] (default {@link XSKILL_BORROW}). */
  readonly borrow?: number
}

/** What the aim of one skill was made from (for tests and the simulation). */
export interface CrossSkillAim {
  readonly aim: number
  /** The conditional prior's mean and variance (before the skill's own answers). */
  readonly priorMean: number
  readonly priorVar: number
}

/**
 * The Gaussian message of a posterior (mean, sd) on the grid under the prior N(mu, v): the posterior's precision and
 * precision-weighted mean less the PRIOR's on the same grid (the grid truncates the prior at ±4, so its own moments
 * are divided out, not N(mu, v)'s: a skill without answers then sends exactly nothing). Null when it says nothing.
 */
export function message(post: { readonly mean: number; readonly sd: number }, mu: number, v: number): { lam: number; x: number } | null {
  const prior = gridPosterior(null, mu, v)
  const v0 = prior.sd * prior.sd
  const v1 = post.sd * post.sd
  if (!(v1 > 0) || !(v0 > 0) || !Number.isFinite(post.mean)) return null
  const lam = 1 / v1 - 1 / v0
  if (!(lam > MESSAGE_MIN_PRECISION)) return null
  return { lam, x: (post.mean / v1 - prior.mean / v0) / lam }
}

function checkOptions(opts: CrossSkillOptions): { mu: readonly number[]; S: Matrix; borrow: number } {
  const mu = opts.mu ?? new Array<number>(N_AXES).fill(0)
  const sigma = opts.sigma
  if (mu.length !== N_AXES || sigma.length !== N_AXES || sigma.some((r) => r.length !== N_AXES)) throw new RangeError(`crossSkillAims(): mu and sigma must be of ${N_AXES} axes`)
  const factor = opts.factor ?? SELECTION_PRIOR_SD_FACTOR
  const borrow = opts.borrow ?? XSKILL_BORROW
  if (!(Number.isFinite(factor) && factor > 0)) throw new RangeError(`factor must be > 0, got ${factor}`)
  if (!(Number.isFinite(borrow) && borrow >= 0 && borrow <= 1)) throw new RangeError(`borrow must be in [0, 1], got ${borrow}`)
  const f2 = factor * factor
  // Σsel = f²·R(s): the diagonal of Σ, its correlations times s (a convex blend of Σ and its diagonal: positive definite)
  const S = sigma.map((row, i) => row.map((x, j) => {
    if (!Number.isFinite(x)) throw new RangeError('sigma must be finite')
    return f2 * (i === j ? x : borrow * x)
  }))
  for (let i = 0; i < N_AXES; i++) if (!(S[i]![i]! > 0)) throw new RangeError('sigma must have a positive diagonal')
  return { mu, S, borrow }
}

/**
 * The aim of every skill, by axis index, from the observations `obs` (this session's, with any earlier
 * sessions' put first): the module comment's three steps. With `borrow` 0 it is the per-skill EAP under the
 * wider prior, the aim of 2026-10-13.
 */
export function crossSkillAims(obs: readonly Observation[], opts: CrossSkillOptions): CrossSkillAim[] {
  const { mu, S, borrow } = checkOptions(opts)
  const ll = gridLoglik(obs)
  // 1. the messages of the skills with answers
  const lambda = new Array<number>(N_AXES).fill(0)
  const x = new Array<number>(N_AXES).fill(0)
  for (const [j, l] of ll) {
    const m = message(gridPosterior(l, mu[j]!, S[j]![j]!), mu[j]!, S[j]![j]!)
    if (m === null) continue
    lambda[j] = m.lam
    x[j] = m.x
  }
  const out: CrossSkillAim[] = []
  for (let k = 0; k < N_AXES; k++) {
    // 2. the conditional prior given the other skills' messages
    const J = borrow > 0 ? AXIS_CODES.map((_, j) => j).filter((j) => j !== k && lambda[j]! > 0) : []
    let priorMean = mu[k]!
    let priorVar = S[k]![k]!
    if (J.length > 0) {
      const A: Matrix = J.map((a) => J.map((b) => S[a]![b]! + (a === b ? 1 / lambda[a]! : 0)))
      const L = cholesky(A)
      const w = choleskySolve(L, J.map((j) => x[j]! - mu[j]!))
      const u = choleskySolve(L, J.map((j) => S[j]![k]!))
      let shift = 0
      let explained = 0
      J.forEach((j, i) => {
        shift += S[k]![j]! * w[i]!
        explained += S[k]![j]! * u[i]!
      })
      priorMean = mu[k]! + shift
      // never below a sliver of the prior: rounding must not make it 0 or negative
      priorVar = Math.max(S[k]![k]! - explained, 1e-9 * S[k]![k]!)
    }
    // 3. the skill's own answers under it
    const own = ll.get(k)
    const aim = own === undefined ? priorMean : gridPosterior(own, priorMean, priorVar).mean
    out.push({ aim, priorMean, priorVar })
  }
  return out
}

/**
 * What one earlier session says about each skill, for a returning person's aim: per skill it measured, ONE Gaussian
 * observation x ~ N(θ, σ²) that carries what the session's own posterior carries beyond the population prior (the
 * per-skill EAP under N(μ_k, Σ_kk), mean m and sd s; its {@link message}: precision λ, location x, σ = 1/√λ).
 * The server keeps exactly that summary of a finished session (its `state.eap` {n, mean, sd}; `hb.prior_state`), so the
 * app and the server read an earlier session alike. A skill whose answers say nothing (λ ≤ {@link MESSAGE_MIN_PRECISION})
 * gives none. Evidence for the aim only: never a score.
 */
export function sessionEvidence(obs: readonly Observation[], opts: Pick<CrossSkillOptions, 'mu' | 'sigma'>): Observation[] {
  const mu = opts.mu ?? new Array<number>(N_AXES).fill(0)
  const out: Observation[] = []
  for (const [k, ll] of [...gridLoglik(obs)].sort((a, b) => a[0] - b[0])) {
    const V = opts.sigma[k]![k]!
    const post = gridPosterior(ll, mu[k]!, V)
    out.push(...summaryEvidence(AXIS_CODES[k]!, post.mean, post.sd, mu[k]!, V))
  }
  return out
}

/** The Gaussian observation of {@link sessionEvidence} from a posterior summary (mean, sd) under N(mu, v); none when it says nothing. */
export function summaryEvidence(axis: AxisCode, mean: number, sd: number, mu: number, v: number): Observation[] {
  const m = message({ mean, sd }, mu, v)
  return m === null ? [] : [{ kind: 'gaussian', axis, lam: 1, d: 0, sigma: 1 / Math.sqrt(m.lam), x: m.x }]
}

/** {@link crossSkillAims} keyed by axis code: the aim alone. */
export function crossSkillAimByAxis(obs: readonly Observation[], opts: CrossSkillOptions): Record<AxisCode, number> {
  const a = crossSkillAims(obs, opts)
  const out = {} as Record<AxisCode, number>
  AXIS_CODES.forEach((k, i) => {
    out[k] = a[i]!.aim
  })
  return out
}

// ------------------------------------------------------------------------------------- device estimates

/**
 * The skills the device scores and the server never serves (the timed blocks: reaction time, the memory spans,
 * coding and reading). In the online version their estimates are sent to the server for the aim of the served
 * parts (`public.device_estimates`, `supabase/migrations/20261017000300_device_estimates.sql`, `app_config`
 * `selection.device_axes`): selection only, never a score (DESIGN §7.4 "Cross-skill aim", amended 2026-10-17).
 */
export const DEVICE_AXES: readonly AxisCode[] = Object.freeze(['WM', 'RT', 'PS'] as AxisCode[])

/** A device estimate's sd is raised to this (`selection.device_sd_min`): no estimate claims more precision than a block gives. */
export const DEVICE_SD_MIN = 0.3

/** Largest |mean| (and |x|) of a device estimate: the grid's edge. */
export const DEVICE_MEAN_BOUND = EAP_HI

/** Largest sd the server reads before raising nothing (it caps a sent sd here before anything else). */
export const DEVICE_SD_CAP = 1_000_000

/** `device_estimates` calls a session may make (`selection.device_max_calls`). */
export const DEVICE_MAX_CALLS = 20

/** What the app sends of one timed skill: its posterior mean and sd, nothing else (never a trial). */
export interface DeviceEstimate {
  readonly axis: AxisCode
  readonly mean: number
  readonly sd: number
}

/**
 * The estimate of one device skill from the session's observations of it (its blocks): the grid posterior of their
 * summed log-likelihood under the skill's scoring prior N(μ_k, Σ_kk), the summary the server keeps of its own skills
 * at finish. Null when the observations hold none of `axis`.
 */
export function deviceEstimate(axis: AxisCode, obs: readonly Observation[], opts: Pick<CrossSkillOptions, 'mu' | 'sigma'>): DeviceEstimate | null {
  const k = AXIS_CODES.indexOf(axis)
  if (k < 0) throw new RangeError(`deviceEstimate(): unknown axis ${axis}`)
  const ll = gridLoglik(obs.filter((o) => o.axis === axis)).get(k)
  if (ll === undefined) return null
  const mu = opts.mu?.[k] ?? 0
  const post = gridPosterior(ll, mu, opts.sigma[k]![k]!)
  return { axis, mean: post.mean, sd: post.sd }
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(Math.max(x, lo), hi)

/**
 * A device estimate as the server bounds and stores it (`public.device_estimates`): mean clamped to ±4, sd raised to
 * {@link DEVICE_SD_MIN}; the {@link message} of (mean, sd) under the skill's scoring prior with its grid moments
 * divided out; an sd at or above the prior's grid sd says nothing (null); λ at most 1/sd_min² − 1/v0, x clamped to ±4.
 */
export function boundedDeviceTerm(est: DeviceEstimate, opts: Pick<CrossSkillOptions, 'mu'> & { readonly v?: number } = {}): { mean: number; sd: number; lam: number; x: number } | null {
  const k = AXIS_CODES.indexOf(est.axis)
  if (k < 0) throw new RangeError(`unknown axis ${est.axis}`)
  if (!Number.isFinite(est.mean) || !Number.isFinite(est.sd) || !(est.sd > 0)) throw new RangeError('a device estimate needs a finite mean and a positive finite sd')
  const mu = opts.mu?.[k] ?? 0
  const v = opts.v ?? 1
  const mean = clamp(est.mean, -DEVICE_MEAN_BOUND, DEVICE_MEAN_BOUND)
  const sd = Math.max(Math.min(est.sd, DEVICE_SD_CAP), DEVICE_SD_MIN)
  const prior = gridPosterior(null, mu, v)
  const v0 = prior.sd * prior.sd
  if (!(v0 > 0)) return null
  const lam0 = 1 / (sd * sd) - 1 / v0
  if (!(lam0 > MESSAGE_MIN_PRECISION)) return null
  const x = clamp((mean / (sd * sd) - prior.mean / v0) / lam0, -DEVICE_MEAN_BOUND, DEVICE_MEAN_BOUND)
  const lam = Math.min(lam0, 1 / (DEVICE_SD_MIN * DEVICE_SD_MIN) - 1 / v0)
  return { mean, sd, lam, x }
}

/** {@link boundedDeviceTerm} as the Gaussian observation the aim takes (x ~ N(θ, 1/λ)): what the server adds to the skill's grid. */
export function deviceEvidence(est: DeviceEstimate, opts: Pick<CrossSkillOptions, 'mu'> & { readonly v?: number } = {}): Observation[] {
  const t = boundedDeviceTerm(est, opts)
  return t === null ? [] : [{ kind: 'gaussian', axis: est.axis, lam: 1, d: 0, sigma: 1 / Math.sqrt(t.lam), x: t.x }]
}
