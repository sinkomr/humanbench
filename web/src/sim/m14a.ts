/**
 * Non-adaptive replication of the bank's M1.4a θ-recovery run in TS (ROADMAP M1.4b (a), M1.4a;
 * DESIGN §7.2, §14.3 M1 acceptance 2; A2, A17).
 *
 * The bank exports its M1.4a simulees to `golden/sim_m14a_v1.json` (`uv run hb golden sim`),
 * copied here as `engine/__fixtures__/sim_m14a_v1.json` (`npm run sync:golden`, A17): the design,
 * the fixed form (10 item axes × 20 2PL items), and every simulee of the N = 2,000 run (true θ,
 * 2PL responses, WM GRM categories, Gaussian observations) exactly as numpy drew them, plus the
 * Python reference results (per-axis r, RMSE, mean SD, 90% coverage over the first 300 and all
 * 2,000 simulees; MAP θ̂ of the first 5). This module rebuilds each simulee's 214 observations in
 * the bank's order (`SimData.observations`) and scores them with the TS engine's
 * {@link mapTheta} against the TRUE generating prior N(0, Σ_init v2), as the bank does. The same
 * people and the same scorer (golden parity 1e-6, M1.3) must give the same per-axis r; the
 * acceptance is |r_TS − r_Python| ≤ {@link PARITY_R_TOL} on every axis.
 *
 * The caller loads the fixture (1.5 MB, so no app module imports it): the CLI
 * (`scripts/sim-cat.ts`) reads the file, the tests import it `?raw`, and both check it with
 * {@link m14aFixtureProblems}.
 */

import { AXIS_CODES, AXIS_INDEX, N_AXES, SIGMA_VERSION, initialSigma, isAxisCode, type AxisCode } from '../engine/axes'
import { mapTheta, type ReadonlyMatrix } from '../engine/scorer'
import type { Observation } from '../engine/types'
import { recoveryStats, Z_COVERAGE, type AxisRecovery } from './stats'

/** The fixture version this module reads. */
export const M14A_VERSION = 'sim_m14a_v1'
/** Acceptance of M1.4b (a): per-axis |r_TS − r_Python| ≤ 0.02 on the same simulees. */
export const PARITY_R_TOL = 0.02

/** One Gaussian observation column of the design (bank `GAUSSIAN_OBS`, flattened). */
export interface M14aGaussian {
  readonly axis: AxisCode
  readonly lam: number
  readonly d: number
  readonly sigma: number
}

/** The M1.4a design as the fixture states it (bank `hb.calib.simulate`). */
export interface M14aDesign {
  readonly item_axes: readonly AxisCode[]
  readonly n_items: number
  readonly a_log_mean: number
  readonly a_log_sd: number
  readonly b_sd: number
  readonly wm: { readonly axis: AxisCode; readonly n_items: number; readonly a: number; readonly thresholds: readonly number[] }
  readonly gaussian: readonly M14aGaussian[]
  readonly no_data_axes: readonly AxisCode[]
  readonly r_min: number
  readonly coverage_level: number
  readonly coverage_lo: number
  readonly coverage_hi: number
  readonly z_coverage: number
}

/** One simulee: `[theta (17), y_2pl ("0"/"1" × 200, row-major), y_wm (3), x_gauss (11)]`. */
export type M14aSimulee = readonly [theta: readonly number[], y2pl: string, yWm: readonly number[], xGauss: readonly number[]]

/** Python reference statistics of one axis. */
export interface M14aAxisResult extends AxisRecovery {
  /** Simulated model: '2pl', 'grm', 'gaussian' or 'none'. */
  readonly model: string
  readonly n_obs: number
}

/** The shape of `sim_m14a_v1.json` (snake_case, the bank's wire format, A17). */
export interface M14aFixture {
  readonly version: string
  readonly task: string
  readonly seed: number
  readonly n: number
  readonly sigma_version: string
  readonly axes: readonly string[]
  readonly design: M14aDesign
  readonly simulee_fields: readonly string[]
  /** 2PL discriminations, one row of n_items per item axis. */
  readonly a: readonly (readonly number[])[]
  readonly b: readonly (readonly number[])[]
  readonly simulees: readonly M14aSimulee[]
  readonly results: readonly { readonly n: number; readonly axes: readonly M14aAxisResult[] }[]
  readonly head: readonly { readonly i: number; readonly theta_hat: readonly number[]; readonly sd: readonly number[]; readonly n_iter: number }[]
}

/**
 * Every way `f` is not a usable M1.4a fixture for this engine (empty = usable): the version, the
 * Σ version and axis order of this build, and the shapes of the design, form and simulees.
 */
export function m14aFixtureProblems(f: M14aFixture): string[] {
  const out: string[] = []
  if (f.version !== M14A_VERSION) out.push(`version ${f.version} is not ${M14A_VERSION}`)
  if (f.sigma_version !== SIGMA_VERSION) out.push(`sigma_version ${f.sigma_version} is not this engine's ${SIGMA_VERSION}`)
  if (f.axes.length !== N_AXES || f.axes.some((c, i) => c !== AXIS_CODES[i])) out.push('axes are not the canonical axis order')
  const d = f.design
  for (const k of [...d.item_axes, d.wm.axis, ...d.gaussian.map((g) => g.axis), ...d.no_data_axes]) if (!isAxisCode(k)) out.push(`unknown axis ${k}`)
  if (d.z_coverage !== Z_COVERAGE) out.push(`z_coverage ${d.z_coverage} is not ${Z_COVERAGE}`)
  if (f.a.length !== d.item_axes.length || f.b.length !== d.item_axes.length) out.push('a and b need one row per item axis')
  for (const row of [...f.a, ...f.b]) if (row.length !== d.n_items) out.push(`an item row has ${row.length} items, not ${d.n_items}`)
  if (f.simulees.length !== f.n) out.push(`${f.simulees.length} simulees, n = ${f.n}`)
  const nItems = d.item_axes.length * d.n_items
  f.simulees.forEach(([theta, y, wm, x], i) => {
    if (theta.length !== N_AXES) out.push(`simulee ${i}: theta has ${theta.length} axes`)
    if (y.length !== nItems || !/^[01]*$/.test(y)) out.push(`simulee ${i}: y_2pl is not ${nItems} binary digits`)
    if (wm.length !== d.wm.n_items) out.push(`simulee ${i}: ${wm.length} WM categories`)
    if (x.length !== d.gaussian.length) out.push(`simulee ${i}: ${x.length} Gaussian observations`)
  })
  return out
}

/**
 * Simulee `i`'s observations in the bank's order: the 2PL items (item axis by item), the WM GRM
 * items, then the Gaussian observations (bank `SimData.observations`, 214 of them).
 */
export function m14aObservations(f: M14aFixture, i: number): Observation[] {
  const s = f.simulees[i]
  if (s === undefined) throw new RangeError(`no simulee ${i} (n = ${f.simulees.length})`)
  const [, y2pl, yWm, xGauss] = s
  const d = f.design
  const obs: Observation[] = []
  d.item_axes.forEach((axis, g) => {
    for (let j = 0; j < d.n_items; j++) {
      obs.push({ kind: '2pl', axis, a: f.a[g]![j]!, b: f.b[g]![j]!, y: y2pl[g * d.n_items + j] === '1' ? 1 : 0 })
    }
  })
  for (const y of yWm) obs.push({ kind: 'grm', axis: d.wm.axis, a: d.wm.a, b: d.wm.thresholds, y })
  d.gaussian.forEach((g, k) => obs.push({ kind: 'gaussian', axis: g.axis, lam: g.lam, d: g.d, sigma: g.sigma, x: xGauss[k]! }))
  return obs
}

/** A scored non-adaptive run over the first n simulees. */
export interface M14aRun {
  readonly n: number
  readonly theta: number[][]
  readonly thetaHat: number[][]
  readonly sd: number[][]
  readonly nIter: number[]
  readonly axes: AxisRecovery[]
}

/**
 * Score the first `n` simulees of `f` with the TS engine's MAP + Laplace against N(0, Σ) (default
 * Σ_init v2, the generating prior) and compute the per-axis recovery statistics.
 */
export function runM14a(f: M14aFixture, n: number = f.n, sigma: ReadonlyMatrix = initialSigma()): M14aRun {
  if (!(Number.isInteger(n) && n >= 2 && n <= f.simulees.length)) throw new RangeError(`n must be an integer in 2..${f.simulees.length}, got ${n}`)
  const mu = new Array<number>(N_AXES).fill(0)
  const theta: number[][] = []
  const thetaHat: number[][] = []
  const sd: number[][] = []
  const nIter: number[] = []
  for (let i = 0; i < n; i++) {
    const r = mapTheta(m14aObservations(f, i), mu, sigma)
    theta.push([...f.simulees[i]![0]])
    thetaHat.push(r.theta)
    sd.push(r.cov.map((row, k) => Math.sqrt(row[k]!)))
    nIter.push(r.nIter)
  }
  return { n, theta, thetaHat, sd, nIter, axes: recoveryStats(theta, thetaHat, sd) }
}

/** The fixture's Python results over the first `n` simulees, or undefined if it has none for n. */
export function pythonResults(f: M14aFixture, n: number): readonly M14aAxisResult[] | undefined {
  return f.results.find((r) => r.n === n)?.axes
}

/** One axis of a TS-vs-Python comparison. */
export interface ParityRow {
  readonly code: AxisCode
  readonly r_ts: number
  readonly r_py: number
  /** |r_TS − r_Python|. */
  readonly diff: number
  readonly ok: boolean
}

/**
 * Per-axis parity of a TS run with the fixture's Python results for the same n (acceptance:
 * |Δr| ≤ `tol`, default {@link PARITY_R_TOL}, on every axis). Throws if the fixture has no
 * results for `run.n`.
 */
export function parity(f: M14aFixture, run: M14aRun, tol: number = PARITY_R_TOL): ParityRow[] {
  const py = pythonResults(f, run.n)
  if (py === undefined) throw new RangeError(`the fixture has Python results for n = ${f.results.map((r) => r.n).join(', ')}, not ${run.n}`)
  return run.axes.map((ax) => {
    const ref = py[AXIS_INDEX[ax.code]]
    if (ref === undefined || ref.code !== ax.code) throw new RangeError(`the fixture's results lack axis ${ax.code}`)
    const diff = Math.abs(ax.r - ref.r)
    return { code: ax.code, r_ts: ax.r, r_py: ref.r, diff, ok: diff <= tol }
  })
}
