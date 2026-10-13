/**
 * `npm run sim:cat -- …` (ROADMAP M1.4b; DESIGN §7.4, §14.3 M1 acceptance 2; A15, A17): the TS
 * θ-recovery simulations on the bank's M1.4a simulees (`src/engine/__fixtures__/sim_m14a_v1.json`,
 * copied from the bank's `golden/` by `npm run sync:golden`). Runs under tsx:
 *
 *   npm run sim:cat -- [--part a|b|all|c] [--n 2000] [--seed m14b] [--target-min 27.5]
 *                      [--fixed 20] [--json <file>] [--strict]
 *
 * - **(a)** the non-adaptive replication of M1.4a (`src/sim/m14a.ts`): the first n simulees'
 *   fixed-form responses scored by the TS engine; per-axis r must match the Python r of the
 *   fixture within 0.02 (n must be 300 or 2000, the sizes the fixture has Python results for).
 * - **(b)** the adaptive session (`src/sim/cat.ts`) for the same n people: the real selector,
 *   scorer and registered families (blocks included) under the A15 time rule with the session
 *   target `--target-min` (default 27.5 min, the midpoint of A15's 25–30; the acceptance is
 *   every simulated session ≤ 30 min and 90% coverage in range; its r is REPORTED, not judged),
 *   then, unless `--fixed 0`, the same with a fixed length of `--fixed` items per CAT axis
 *   (default 20; acceptance: r ≥ .85 on MAT/SPA/QR and coverage in range). The r criterion is
 *   DESIGN §14.3's "r ≥ .85 at 20 items/axis" (user decision 2026-09-29, ROADMAP M1.4b), so it is
 *   judged only on a fixed-length run of ≥ 20 items/axis; `--fixed 0` (or under 20) leaves it
 *   unchecked and says so, and `--strict` refuses those values (usage error) rather than exit 0
 *   with the criterion unchecked. When the fixture has Python results for n, each table also shows the
 *   Python M1.4a r per axis and the gap: M1.4a is a fixed 2PL form, so this is a comparison of
 *   two designs, not the 0.02 parity of (a).
 *
 * - **(c)** the start-up rule of item selection (`src/sim/startup.ts`, `engine/startup.ts`; owner
 *   feedback 2026-10-13), not part of `all`: for takers at θ = −2 … +3, each question part with the
 *   rule and without it (`--per-theta` takers per θ, default 200; `--items` questions, default 8):
 *   the mean difficulty at each position, the questions until one is within 0.5 of θ, the share
 *   shown a stratum 5 or 6 item in the first five, and the recovery (r, RMSE) of the part's
 *   estimate before and after. It needs no fixture.
 *
 * Prints one table per run with its acceptance verdict (progress goes to stderr). `--json` writes
 * the numbers; a relative path resolves against the directory npm was run from. Exit codes: 0 (or
 * 1 with `--strict` when any acceptance fails, as above), 2 on a usage error (including `--strict`
 * on part b with `--fixed` under 20). The full n = 2,000
 * run takes a few minutes (`scripts/sim-cat.slow.test.ts` runs it with `npm run test:slow`).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { A15_TARGET_S } from '../src/engine/selector'
import { M1_ITEMS_PER_AXIS, runCat, type CatRun } from '../src/sim/cat'
import { m14aFixtureProblems, parity, pythonResults, runM14a, type M14aFixture } from '../src/sim/m14a'
import { axisTable, catAcceptanceFailures, catRAxes, catVsPython, formatCat, formatParity, type CatPythonRow } from '../src/sim/report'
import { formatStudy, startupStudy } from '../src/sim/startup'
import { PUB_ROOT, UsageError } from './dump-lib'

export const SIM_CAT_USAGE = 'usage: npm run sim:cat -- [--part a|b|all|c] [--n 2000] [--seed m14b] [--target-min 27.5] [--fixed 20] [--json <file>] [--strict]'

/** The fixture the simulations read (A17 copy of the bank's golden/sim_m14a_v1.json). */
export const SIM_FIXTURE = join(PUB_ROOT, 'web', 'src', 'engine', '__fixtures__', 'sim_m14a_v1.json')

export interface SimCatArgs {
  readonly part: 'a' | 'b' | 'all' | 'c'
  /** Part c: takers per θ and questions per part. */
  readonly perTheta: number
  readonly items: number
  readonly n: number
  readonly seed: string
  readonly targetMin: number
  /** Items per CAT axis of the fixed-length run (default {@link M1_ITEMS_PER_AXIS}); 0 skips it. */
  readonly fixed: number
  /** Absolute path of the JSON output, if any. */
  readonly json?: string
  readonly strict: boolean
}

/** Parse the CLI arguments (see the module comment). Throws a {@link UsageError}. */
export function parseSimCatArgs(argv: readonly string[], cwd: string): SimCatArgs {
  let part: SimCatArgs['part'] = 'all'
  let n = 2000
  let seed = 'm14b'
  let targetMin = A15_TARGET_S / 60
  let fixed: number = M1_ITEMS_PER_AXIS
  let json: string | undefined
  let strict = false
  let perTheta = 200
  let items = 8
  const value = (i: number, flag: string): string => {
    const v = argv[i]
    if (v === undefined || v.startsWith('--')) throw new UsageError(`${flag} needs a value`)
    return v
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') continue
    if (a === '--strict') strict = true
    else if (a === '--part') {
      const v = value(++i, a)
      if (v !== 'a' && v !== 'b' && v !== 'all' && v !== 'c') throw new UsageError('--part must be a, b, all or c')
      part = v
    } else if (a === '--n') n = Number(value(++i, a))
    else if (a === '--seed') seed = value(++i, a)
    else if (a === '--target-min') targetMin = Number(value(++i, a))
    else if (a === '--fixed') fixed = Number(value(++i, a))
    else if (a === '--per-theta') perTheta = Number(value(++i, a))
    else if (a === '--items') items = Number(value(++i, a))
    else if (a === '--json') json = resolve(cwd, value(++i, a))
    else throw new UsageError(`unexpected argument ${JSON.stringify(a)}`)
  }
  if (!(Number.isSafeInteger(n) && n >= 2)) throw new UsageError('--n must be an integer ≥ 2')
  if (!(Number.isFinite(targetMin) && targetMin > 0)) throw new UsageError('--target-min must be a positive number of minutes')
  if (!(Number.isSafeInteger(fixed) && fixed >= 0)) throw new UsageError('--fixed must be an integer ≥ 0 (0 skips the fixed-length run)')
  // --strict is the M1.4b certificate, and its r criterion (DESIGN §14.3) is judged only at ≥ 20
  // items/axis: without such a run a strict exit 0 would certify a criterion nobody checked.
  if (!(Number.isSafeInteger(perTheta) && perTheta >= 2) || !(Number.isSafeInteger(items) && items >= 2 && items <= 40)) throw new UsageError('--per-theta is an integer ≥ 2 and --items an integer from 2 to 40')
  if (strict && part === 'c') throw new UsageError('--strict judges parts a and b; part c reports a comparison and has no acceptance')
  if (strict && part !== 'a' && fixed < M1_ITEMS_PER_AXIS) {
    throw new UsageError(`--strict judges r ≥ .85 at ${M1_ITEMS_PER_AXIS} items/axis (DESIGN §14.3), so it needs --fixed ${M1_ITEMS_PER_AXIS} or more (got ${fixed}); drop --strict to run without that check`)
  }
  return { part, perTheta, items, n, seed, targetMin, fixed, ...(json === undefined ? {} : { json }), strict }
}

/** Load and check the fixture; throws with every problem found. */
export function loadFixture(path: string = SIM_FIXTURE): M14aFixture {
  const f = JSON.parse(readFileSync(path, 'utf8')) as M14aFixture
  const problems = m14aFixtureProblems(f)
  if (problems.length > 0) throw new Error(`${path}: ${problems.slice(0, 5).join('; ')} (run npm run sync:golden)`)
  return f
}

function catJson(run: CatRun, fails: readonly string[], python: readonly CatPythonRow[] | undefined): object {
  return {
    n: run.n,
    seed: run.seed,
    target_s: run.targetS,
    fixed_length: run.fixedLength,
    axes: axisTable(run.axes),
    items_per_axis: run.itemsPerAxis,
    time_s: run.timeS,
    cat_time_s: run.catTimeS,
    over_target: run.overTarget,
    targeting: run.targeting,
    floor_short: run.floorShort,
    block_observed: run.blockObserved,
    segment_ends: run.segmentEnds,
    // The axes r ≥ .85 was judged on: MAT/SPA/QR on a run of ≥ 20 items/axis (DESIGN §14.3), [] when r is only reported.
    r_criterion_axes: catRAxes(run),
    acceptance_failures: fails,
    ...(python === undefined ? {} : { vs_python_m14a: python }),
  }
}

/** CLI entry: returns the process exit code (0 ok, 1 strict failure, 2 usage error). */
export function main(argv: readonly string[], cwd = process.env.INIT_CWD ?? process.cwd(), fixturePath: string = SIM_FIXTURE): number {
  let args: SimCatArgs
  try {
    args = parseSimCatArgs(argv, cwd)
  } catch (e) {
    if (!(e instanceof UsageError)) throw e
    console.error(`${e.message}\n${SIM_CAT_USAGE}`)
    return 2
  }
  if (args.part === 'c') {
    const studies = (['MAT', 'SPA', 'QR', 'TEXT'] as const).map((kind) => {
      process.stderr.write(`start-up study: ${kind}\n`)
      const study = startupStudy(kind, { perTheta: args.perTheta, items: args.items, population: Math.max(args.perTheta, 300) })
      console.log(formatStudy(study))
      console.log('')
      return study
    })
    if (args.json !== undefined) {
      writeFileSync(args.json, `${JSON.stringify({ c: studies }, null, 2)}\n`)
      console.log(`wrote ${args.json}`)
    }
    return 0
  }
  const f = loadFixture(fixturePath)
  if (args.n > f.simulees.length) {
    console.error(`--n ${args.n} exceeds the fixture's ${f.simulees.length} simulees\n${SIM_CAT_USAGE}`)
    return 2
  }
  const out: Record<string, unknown> = { fixture: f.version, n: args.n }
  let failed = false
  if (args.part !== 'b') {
    if (!f.results.some((r) => r.n === args.n)) {
      console.error(`part a needs --n ${f.results.map((r) => r.n).join(' or ')} (the fixture's Python result sizes)\n${SIM_CAT_USAGE}`)
      return 2
    }
    const run = runM14a(f, args.n)
    const rows = parity(f, run)
    console.log(formatParity(run, rows))
    console.log('')
    failed ||= rows.some((r) => !r.ok)
    out.a = { axes: axisTable(run.axes), parity: rows }
  }
  if (args.part !== 'a') {
    const thetas = f.simulees.slice(0, args.n).map((s) => s[0])
    const progress = (label: string) => (i: number): void => {
      if ((i + 1) % 100 === 0 || i + 1 === args.n) process.stderr.write(`\r${label}: ${i + 1}/${args.n}`)
    }
    const runs: { key: string; run: CatRun }[] = []
    const t0 = performance.now()
    runs.push({ key: 'b_a15', run: runCat(thetas, { seed: args.seed, targetS: args.targetMin * 60, onSession: progress('A15 run') }) })
    process.stderr.write(` (${((performance.now() - t0) / 1000).toFixed(0)} s)\n`)
    if (args.fixed > 0) {
      const t1 = performance.now()
      runs.push({ key: 'b_fixed', run: runCat(thetas, { seed: args.seed, fixedLength: args.fixed, onSession: progress('fixed-length run') }) })
      process.stderr.write(` (${((performance.now() - t1) / 1000).toFixed(0)} s)\n`)
    }
    // The Python M1.4a r for the same n, when the fixture has it: reported next to the CAT r (a
    // different design, not parity; report.ts catVsPython).
    const py = pythonResults(f, args.n)
    for (const { key, run } of runs) {
      const fails = catAcceptanceFailures(run)
      const python = py === undefined ? undefined : catVsPython(run, py)
      console.log(formatCat(run, {}, python))
      console.log('')
      failed ||= fails.length > 0
      out[key] = catJson(run, fails, python)
    }
    if (!runs.some(({ run }) => catRAxes(run).length > 0)) {
      console.log(`note: no fixed-length run of ≥ ${M1_ITEMS_PER_AXIS} items/axis, so the r ≥ .85 criterion (DESIGN §14.3) was not checked (time and coverage only; --strict needs --fixed ${M1_ITEMS_PER_AXIS} or more)\n`)
    }
  }
  if (args.json !== undefined) {
    writeFileSync(args.json, `${JSON.stringify(out, null, 2)}\n`)
    console.log(`wrote ${args.json}`)
  }
  return args.strict && failed ? 1 : 0
}

// Run only as the CLI entry, so the test can import the parser without running anything.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2))
}
