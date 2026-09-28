/**
 * Acceptance checks and plain-text tables of the M1.4b simulations (ROADMAP M1.4b; DESIGN §14.3
 * M1 acceptance 2; A15). SIMULATION SUPPORT ONLY: never imported by the app.
 */

import { AXIS_CODES, type AxisCode } from '../engine/axes'
import { CAT_AXES, observedAxes, type CatRun } from './cat'
import { M14A_VERSION, PARITY_R_TOL, type M14aRun, type ParityRow } from './m14a'
import { COVERAGE_HI, COVERAGE_LO, R_MIN, Z_COVERAGE, type AxisRecovery } from './stats'

export interface CatAcceptanceOptions {
  /** Minimum r on the CAT axes (default {@link R_MIN}, .85). */
  readonly rMin?: number
  /** Axes the r criterion applies to (default {@link CAT_AXES}: MAT, SPA, QR). */
  readonly rAxes?: readonly AxisCode[]
  /** Session time limit in seconds (default: the run's A15 target; none for a fixed-length run). */
  readonly budgetS?: number
}

/**
 * The M1.4b (b) checks a CAT run fails (empty = pass): r ≥ rMin on each CAT axis; 90% coverage in
 * [0.85, 0.95] on every axis observed in every session; and, for an A15 run, every session within
 * the time budget. A fixed-length run (DESIGN §14.3 "at 20 items/axis") has no time criterion.
 */
export function catAcceptanceFailures(run: CatRun, opts: CatAcceptanceOptions = {}): string[] {
  const rMin = opts.rMin ?? R_MIN
  const budget = opts.budgetS ?? (run.fixedLength === null ? run.targetS : undefined)
  const by = new Map(run.axes.map((a) => [a.code, a]))
  const fails: string[] = []
  for (const k of opts.rAxes ?? CAT_AXES) {
    const ax = by.get(k)!
    if (!(ax.r >= rMin)) fails.push(`${k}: r = ${ax.r.toFixed(3)} < ${rMin}`)
  }
  for (const k of observedAxes(run)) {
    const c = by.get(k)!.coverage
    if (!(c >= COVERAGE_LO && c <= COVERAGE_HI)) fails.push(`${k}: 90% coverage ${c.toFixed(3)} outside [${COVERAGE_LO}, ${COVERAGE_HI}]`)
  }
  if (budget !== undefined && run.timeS.max > budget + 1e-9) fails.push(`time: max session ${(run.timeS.max / 60).toFixed(2)} min > budget ${(budget / 60).toFixed(2)} min`)
  return fails
}

const f3 = (x: number): string => (Number.isFinite(x) ? x.toFixed(3) : String(x))
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

/** The M1.4b (b) table: recovery per axis, items per CAT axis, time, blocks, and the verdict. */
export function formatCat(run: CatRun, opts: CatAcceptanceOptions = {}): string {
  const observed = new Set(observedAxes(run))
  const rule = run.fixedLength === null ? `A15 time rule, target ${(run.targetS / 60).toFixed(1)} min` : `fixed length ${run.fixedLength} items per CAT axis (no time limit)`
  const lines = [
    `M1.4b (b) adaptive CAT simulation: N = ${run.n}, seed ${JSON.stringify(run.seed)}, ${rule}; finish = correlated MAP + Laplace`,
    ...axisLines(run.axes, (k) => (CAT_AXES.includes(k) ? '  CAT' : observed.has(k) ? '  block' : '  (no data: borrowing via Σ only)')),
    'CAT items per axis (min / mean / max): ' + CAT_AXES.map((k) => {
      const s = run.itemsPerAxis[k]!
      return `${k} ${s.min} / ${s.mean.toFixed(1)} / ${s.max}`
    }).join(', '),
    `session time, min (min / mean / max): ${(run.timeS.min / 60).toFixed(1)} / ${(run.timeS.mean / 60).toFixed(1)} / ${(run.timeS.max / 60).toFixed(1)}; CAT part ${(run.catTimeS.mean / 60).toFixed(1)} mean`,
    'blocks with an observation: ' + Object.entries(run.blockObserved).map(([f, p]) => `${f} ${(100 * p).toFixed(0)}%`).join(', '),
    'CAT segment ends: ' + Object.entries(run.segmentEnds).map(([k, v]) => `${k} ${v}`).join(', '),
  ]
  const fails = catAcceptanceFailures(run, opts)
  const rMin = opts.rMin ?? R_MIN
  const timeRule = run.fixedLength === null ? `, every session ≤ ${((opts.budgetS ?? run.targetS) / 60).toFixed(1)} min` : ''
  lines.push(`acceptance (r ≥ ${rMin} on ${(opts.rAxes ?? CAT_AXES).join('/')}; cov90 in [${COVERAGE_LO}, ${COVERAGE_HI}] where observed${timeRule}): ${fails.length === 0 ? 'PASS' : 'FAIL'}`)
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
