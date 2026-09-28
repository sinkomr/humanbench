/**
 * `npm run sim:cat -- …` (ROADMAP M1.4b; DESIGN §7.4, §14.3 M1 acceptance 2; A15, A17): the TS
 * θ-recovery simulations on the bank's M1.4a simulees (`src/engine/__fixtures__/sim_m14a_v1.json`,
 * copied from the bank's `golden/` by `npm run sync:golden`). Runs under tsx:
 *
 *   npm run sim:cat -- [--part a|b|all] [--n 2000] [--seed m14b] [--target-min 27.5]
 *                      [--fixed 20] [--json <file>] [--strict]
 *
 * - **(a)** the non-adaptive replication of M1.4a (`src/sim/m14a.ts`): the first n simulees'
 *   fixed-form responses scored by the TS engine; per-axis r must match the Python r of the
 *   fixture within 0.02 (n must be 300 or 2000, the sizes the fixture has Python results for).
 * - **(b)** the adaptive session (`src/sim/cat.ts`) for the same n people: the real selector,
 *   scorer and registered families (blocks included) under the A15 time rule with the session
 *   target `--target-min` (default 27.5 min, the midpoint of A15's 25–30; the time acceptance is
 *   every simulated session ≤ 30 min), then, unless `--fixed 0`, the same with a fixed length of
 *   `--fixed` items per CAT axis (DESIGN §14.3 "r ≥ .85 at 20 items/axis").
 *
 * Prints one table per run with its acceptance verdict (progress goes to stderr). `--json` writes
 * the numbers; a relative path resolves against the directory npm was run from. Exit codes: 0 (or
 * 1 with `--strict` when any acceptance fails), 2 on a usage error. The full n = 2,000 run takes
 * a few minutes (`scripts/sim-cat.slow.test.ts` runs it with `npm run test:slow`).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { A15_TARGET_S } from '../src/engine/selector'
import { runCat, type CatRun } from '../src/sim/cat'
import { m14aFixtureProblems, parity, runM14a, type M14aFixture } from '../src/sim/m14a'
import { axisTable, catAcceptanceFailures, formatCat, formatParity } from '../src/sim/report'
import { PUB_ROOT, UsageError } from './dump-lib'

export const SIM_CAT_USAGE = 'usage: npm run sim:cat -- [--part a|b|all] [--n 2000] [--seed m14b] [--target-min 27.5] [--fixed 20] [--json <file>] [--strict]'

/** The fixture the simulations read (A17 copy of the bank's golden/sim_m14a_v1.json). */
export const SIM_FIXTURE = join(PUB_ROOT, 'web', 'src', 'engine', '__fixtures__', 'sim_m14a_v1.json')

export interface SimCatArgs {
  readonly part: 'a' | 'b' | 'all'
  readonly n: number
  readonly seed: string
  readonly targetMin: number
  /** Items per CAT axis of the fixed-length run; 0 skips it. */
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
  let fixed = 20
  let json: string | undefined
  let strict = false
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
      if (v !== 'a' && v !== 'b' && v !== 'all') throw new UsageError('--part must be a, b or all')
      part = v
    } else if (a === '--n') n = Number(value(++i, a))
    else if (a === '--seed') seed = value(++i, a)
    else if (a === '--target-min') targetMin = Number(value(++i, a))
    else if (a === '--fixed') fixed = Number(value(++i, a))
    else if (a === '--json') json = resolve(cwd, value(++i, a))
    else throw new UsageError(`unexpected argument ${JSON.stringify(a)}`)
  }
  if (!(Number.isSafeInteger(n) && n >= 2)) throw new UsageError('--n must be an integer ≥ 2')
  if (!(Number.isFinite(targetMin) && targetMin > 0)) throw new UsageError('--target-min must be a positive number of minutes')
  if (!(Number.isSafeInteger(fixed) && fixed >= 0)) throw new UsageError('--fixed must be an integer ≥ 0 (0 skips the fixed-length run)')
  return { part, n, seed, targetMin, fixed, ...(json === undefined ? {} : { json }), strict }
}

/** Load and check the fixture; throws with every problem found. */
export function loadFixture(path: string = SIM_FIXTURE): M14aFixture {
  const f = JSON.parse(readFileSync(path, 'utf8')) as M14aFixture
  const problems = m14aFixtureProblems(f)
  if (problems.length > 0) throw new Error(`${path}: ${problems.slice(0, 5).join('; ')} (run npm run sync:golden)`)
  return f
}

function catJson(run: CatRun, fails: readonly string[]): object {
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
    acceptance_failures: fails,
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
    for (const { key, run } of runs) {
      const fails = catAcceptanceFailures(run)
      console.log(formatCat(run))
      console.log('')
      failed ||= fails.length > 0
      out[key] = catJson(run, fails)
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
