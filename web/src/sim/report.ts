/**
 * Acceptance checks and plain-text tables of the M1.4b simulations (ROADMAP M1.4b; DESIGN §14.3
 * M1 acceptance 2; A15). SIMULATION SUPPORT ONLY: never imported by the app.
 *
 * What is accepted, per the user's decision of 2026-09-29 (ROADMAP M1.4b, option 1): r ≥ .85 on
 * MAT, SPA and QR **at 20 items/axis** (DESIGN §14.3), i.e. on the fixed-length run. The run under
 * the A15 time budget (about 25–30 min, 6–13 items per CAT axis) is accepted on time and 90%
 * coverage only; its r is reported next to the criterion but does not pass or fail it.
 */

import { AXIS_CODES, type AxisCode } from '../engine/axes'
import { COVERAGE_FLOOR } from '../engine/selector'
import { A15_MAX_S, CAT_AXES, M1_ITEMS_PER_AXIS, observedAxes, type CatRun } from './cat'
import { M14A_VERSION, PARITY_R_TOL, type M14aAxisResult, type M14aRun, type ParityRow } from './m14a'
import { COVERAGE_HI, COVERAGE_LO, R_MIN, Z_COVERAGE, type AxisRecovery } from './stats'

export interface CatAcceptanceOptions {
  /** Minimum r on the CAT axes (default {@link R_MIN}, .85). */
  readonly rMin?: number
  /** Axes the r criterion applies to (default {@link catRAxes}: MAT, SPA, QR on a run of ≥ 20 items/axis, none otherwise). */
  readonly rAxes?: readonly AxisCode[]
  /** Session time limit in seconds (default {@link A15_MAX_S}, A15's upper end; none for a fixed-length run). */
  readonly budgetS?: number
}

/**
 * The axes on which r ≥ .85 is an acceptance criterion for this run: MAT, SPA and QR when the run
 * has a fixed length of at least {@link M1_ITEMS_PER_AXIS} items per axis (DESIGN §14.3 "at 20
 * items/axis"; ROADMAP M1.4b, decided 2026-09-29), none otherwise. A run under the A15 time budget,
 * or a shorter fixed length, reports its r without holding it to the criterion.
 */
export function catRAxes(run: CatRun): readonly AxisCode[] {
  return run.fixedLength !== null && run.fixedLength >= M1_ITEMS_PER_AXIS ? CAT_AXES : []
}

/**
 * The M1.4b (b) checks a CAT run fails (empty = pass): r ≥ rMin on each axis of {@link catRAxes}
 * (only the run of ≥ 20 items/axis, DESIGN §14.3), and on a fixed-length run every session really
 * gave that axis the requested number of items (the selector can run dry, and r "at 20 items/axis"
 * must not be claimed for fewer); 90% coverage in [0.85, 0.95] on every axis with observations;
 * and, for an A15 run, every session's simulated time within the A15 budget (≤ 30 min, the upper
 * end of A15's "about 25–30 min"; the plan targets 27.5). A fixed-length run has no time
 * criterion.
 */
export function catAcceptanceFailures(run: CatRun, opts: CatAcceptanceOptions = {}): string[] {
  const rMin = opts.rMin ?? R_MIN
  const budget = opts.budgetS ?? (run.fixedLength === null ? A15_MAX_S : undefined)
  const by = new Map(run.axes.map((a) => [a.code, a]))
  const fails: string[] = []
  for (const k of opts.rAxes ?? catRAxes(run)) {
    const ax = by.get(k)!
    if (!(ax.r >= rMin)) fails.push(`${k}: r = ${ax.r.toFixed(3)} < ${rMin}`)
    const given = run.itemsPerAxis[k]?.min
    if (run.fixedLength !== null && !(given !== undefined && given >= run.fixedLength)) {
      fails.push(`${k}: only ${given ?? 0} items in the least-served session, fewer than the ${run.fixedLength} items/axis r is judged at`)
    }
  }
  for (const k of observedAxes(run)) {
    const c = by.get(k)!.coverage
    if (!(c >= COVERAGE_LO && c <= COVERAGE_HI)) fails.push(`${k}: 90% coverage ${c.toFixed(3)} outside [${COVERAGE_LO}, ${COVERAGE_HI}]`)
  }
  if (budget !== undefined && run.timeS.max > budget + 1e-9) fails.push(`time: max session ${(run.timeS.max / 60).toFixed(2)} min > budget ${(budget / 60).toFixed(2)} min`)
  return fails
}

/**
 * How far the CAT r may fall below the Python M1.4a r on a CAT axis at the fixed length of 20
 * items per axis before the slow test fails: a REGRESSION GUARD, not an acceptance criterion and
 * not the ROADMAP M1.4b "within 0.02" (that parity is part (a), the replication; the CAT is judged
 * by r ≥ .85, decided 2026-09-29). Measured at N = 2,000: MAT −.028, SPA −.050, QR +.015.
 */
export const CAT_PY_R_DROP_MAX = 0.06

/**
 * One axis of the adaptive run (b) next to the Python M1.4a r on the same simulees. ROADMAP M1.4b
 * says "parity with Python within 0.02 on r", but the Python side is M1.4a: a FIXED form of 20
 * 2PL stand-in items per item axis, stand-in Gaussian observations for WM / RT / PS, and no CAT.
 * The adaptive run serves the real families instead (SPA 3PL with c = 1/4, A9; provisional a =
 * 1.0 items; its own item counts; the real block observation models), so its r is a different
 * design's, not a twin's. The 0.02 parity is part (a), the replication (`m14a.ts`, identical to
 * rounding); the CAT (b) is accepted on r ≥ .85 at 20 items/axis (user decision 2026-09-29), and
 * this row only reports the gap.
 */
export interface CatPythonRow {
  readonly code: AxisCode
  readonly r_cat: number
  readonly r_py: number
  /** r_CAT − r_Python (negative: the CAT recovers less). */
  readonly delta: number
}

/** {@link CatPythonRow}s for every axis the CAT run observed, in canonical order. */
export function catVsPython(run: CatRun, py: readonly M14aAxisResult[]): CatPythonRow[] {
  const observed = new Set(observedAxes(run))
  const pyBy = new Map(py.map((a) => [a.code, a]))
  return run.axes
    .filter((a) => observed.has(a.code))
    .map((a) => {
      const ref = pyBy.get(a.code)
      if (ref === undefined) throw new RangeError(`the Python results lack axis ${a.code}`)
      return { code: a.code, r_cat: a.r, r_py: ref.r, delta: a.r - ref.r }
    })
}

const f3 = (x: number): string => (Number.isFinite(x) ? x.toFixed(3) : String(x))
const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : String(x))
const pct = (x: number): string => `${(100 * x).toFixed(1)}%`
const pad = (s: string, n: number): string => s.padStart(n)

function axisLines(axes: readonly AxisRecovery[], note: (code: AxisCode) => string = () => ''): string[] {
  const lines = [`${'axis'.padEnd(5)} ${pad('r', 6)} ${pad('RMSE', 6)} ${pad('mean SD', 7)} ${pad('cov90', 6)}`]
  for (const a of axes) lines.push(`${a.code.padEnd(5)} ${pad(f3(a.r), 6)} ${pad(f3(a.rmse), 6)} ${pad(f3(a.mean_sd), 7)} ${pad(f3(a.coverage), 6)}${note(a.code)}`)
  return lines
}

/** The M1.4b (a) table: TS vs Python r per axis on the same simulees, and the verdict. */
export function formatParity(run: M14aRun, rows: readonly ParityRow[], tol: number = PARITY_R_TOL): string {
  const byCode = new Map(rows.map((r) => [r.code, r]))
  const lines = [
    `M1.4b (a) non-adaptive M1.4a replication in TS: N = ${run.n} simulees of ${M14A_VERSION}, MAP + Laplace against the true Σ`,
    ...axisLines(run.axes, (k) => {
      const p = byCode.get(k)
      return p === undefined ? '' : `   python r ${f3(p.r_py)}  |Δr| ${p.diff.toExponential(1)}`
    }),
    `cov90 = share with θ in θ̂ ± ${Z_COVERAGE.toFixed(3)}·SD; map iterations max ${Math.max(...run.nIter)}`,
  ]
  const bad = rows.filter((r) => !r.ok)
  lines.push(`parity (|r_TS − r_Python| ≤ ${tol} on all ${rows.length} axes): ${bad.length === 0 ? 'PASS' : 'FAIL'}`)
  for (const r of bad) lines.push(`  FAIL ${r.code}: |Δr| = ${r.diff.toFixed(4)}`)
  return lines.join('\n')
}

/**
 * The M1.4b (b) table: recovery per axis, items per CAT axis, time, blocks, and the verdict. With
 * `python` ({@link catVsPython}), each observed axis also shows the Python M1.4a r and the gap.
 */
export function formatCat(run: CatRun, opts: CatAcceptanceOptions = {}, python?: readonly CatPythonRow[]): string {
  const observed = new Set(observedAxes(run))
  const pyBy = new Map((python ?? []).map((p) => [p.code, p]))
  const vsPy = (k: AxisCode): string => {
    const p = pyBy.get(k)
    return p === undefined ? '' : `   python r ${f3(p.r_py)}  Δr ${p.delta >= 0 ? '+' : '−'}${Math.abs(p.delta).toFixed(3)}`
  }
  const rule = run.fixedLength === null ? `A15 time rule, target ${(run.targetS / 60).toFixed(1)} min` : `fixed length ${run.fixedLength} items per CAT axis (no time limit)`
  const lines = [
    `M1.4b (b) adaptive CAT simulation: N = ${run.n}, seed ${JSON.stringify(run.seed)}, ${rule}; finish = correlated MAP + Laplace`,
    ...axisLines(run.axes, (k) => (CAT_AXES.includes(k) ? `  CAT${vsPy(k)}` : observed.has(k) ? `  block${vsPy(k)}` : '  (no data: borrowing via Σ only)')),
    'CAT items per axis (min / mean / max): ' + CAT_AXES.map((k) => {
      const s = run.itemsPerAxis[k]!
      return `${k} ${s.min} / ${s.mean.toFixed(1)} / ${s.max}`
    }).join(', '),
    'selector targeting, r(mean administered b, θ): ' + CAT_AXES.map((k) => `${k} ${f2(run.targeting[k]!)}`).join(', '),
    `sessions under the ${COVERAGE_FLOOR}-item coverage floor: ` + CAT_AXES.map((k) => `${k} ${pct(run.floorShort[k]!)}`).join(', '),
    `session time (blocks as simulated, CAT items at E[T]), min (min / mean / max): ${(run.timeS.min / 60).toFixed(1)} / ${(run.timeS.mean / 60).toFixed(1)} / ${(run.timeS.max / 60).toFixed(1)}` +
      (run.fixedLength === null ? `; over the ${(run.targetS / 60).toFixed(1)}-min target ${pct(run.overTarget)}` : '') +
      `; CAT part ${(run.catTimeS.mean / 60).toFixed(1)} mean`,
    'blocks with an observation: ' + Object.entries(run.blockObserved).map(([f, p]) => `${f} ${(100 * p).toFixed(0)}%`).join(', '),
    'CAT segment ends: ' + Object.entries(run.segmentEnds).map(([k, v]) => `${k} ${v}`).join(', '),
  ]
  if (python !== undefined && python.length > 0) {
    lines.push(`python r: the ${M14A_VERSION} fixed 2PL form on the same simulees, a different design (not a twin; parity is part a); Δr = r_CAT − r_Python`)
  }
  const fails = catAcceptanceFailures(run, opts)
  const rMin = opts.rMin ?? R_MIN
  const rAxes = opts.rAxes ?? catRAxes(run)
  const timeRule = run.fixedLength === null ? `every session ≤ ${((opts.budgetS ?? A15_MAX_S) / 60).toFixed(1)} min` : ''
  const criteria = [
    ...(rAxes.length > 0 ? [`r ≥ ${rMin} on ${rAxes.join('/')}`] : []),
    `cov90 in [${COVERAGE_LO}, ${COVERAGE_HI}] where observed`,
    ...(timeRule === '' ? [] : [timeRule]),
  ]
  if (rAxes.length === 0) {
    // Reported, not judged (ROADMAP M1.4b, 2026-09-29): the r criterion belongs to the fixed-length run.
    const rs = CAT_AXES.map((k) => `${k} ${f3(run.axes.find((a) => a.code === k)!.r)}`).join(', ')
    if (catRAxes(run).length > 0) {
      lines.push(`r at ${run.fixedLength} items per axis is not judged here (the caller passed rAxes: []): ${rs}`)
    } else {
      const why = run.fixedLength === null ? 'within the A15 time budget' : `at ${run.fixedLength} items per axis`
      lines.push(`r ${why} is informational, not an acceptance criterion (r ≥ ${rMin} is required at ${M1_ITEMS_PER_AXIS} items/axis, DESIGN §14.3): ${rs}`)
    }
  }
  lines.push(`acceptance (${criteria.join('; ')}): ${fails.length === 0 ? 'PASS' : 'FAIL'}`)
  for (const f of fails) lines.push(`  FAIL ${f}`)
  return lines.join('\n')
}

/** Canonical-order codes of a run's axes (for JSON output). */
export function axisTable(axes: readonly AxisRecovery[]): Record<string, Omit<AxisRecovery, 'code'>> {
  const out: Record<string, Omit<AxisRecovery, 'code'>> = {}
  for (const k of AXIS_CODES) {
    const a = axes.find((x) => x.code === k)
    if (a !== undefined) out[k] = { r: a.r, rmse: a.rmse, mean_sd: a.mean_sd, coverage: a.coverage }
  }
  return out
}
