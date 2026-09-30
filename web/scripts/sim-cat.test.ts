/**
 * `npm run sim:cat` (ROADMAP M1.4b): argument parsing, exit codes, the tables and the JSON
 * output, on small runs (the full n = 2,000 run is `sim-cat.slow.test.ts`).
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { A15_TARGET_S } from '../src/engine/selector'
import type * as CatModule from '../src/sim/cat'
import type { M14aFixture } from '../src/sim/m14a'
import { fakeCatRun } from '../src/sim/testing'
import { UsageError } from './dump-lib'
import { SIM_CAT_USAGE, SIM_FIXTURE, loadFixture, main, parseSimCatArgs } from './sim-cat'

// A test can swap the simulation for synthetic runs (the --strict verdicts below); by default
// `runCat` is the real one.
const fake = vi.hoisted(() => ({ runCat: null as null | ((...args: never[]) => unknown) }))
vi.mock('../src/sim/cat', async (importOriginal) => {
  const actual = await importOriginal<typeof CatModule>()
  return { ...actual, runCat: (...args: Parameters<typeof actual.runCat>) => (fake.runCat === null ? actual.runCat(...args) : (fake.runCat as typeof actual.runCat)(...args)) }
})

describe('parseSimCatArgs', () => {
  it('has the documented defaults', () => {
    expect(parseSimCatArgs([], '/w')).toEqual({ part: 'all', n: 2000, seed: 'm14b', targetMin: A15_TARGET_S / 60, fixed: 20, strict: false })
  })

  it('reads every option; --json resolves against the given directory', () => {
    const a = parseSimCatArgs(['--', '--part', 'b', '--n', '300', '--seed', 's1', '--target-min', '30', '--fixed', '25', '--json', 'out.json', '--strict'], '/w')
    expect(a).toEqual({ part: 'b', n: 300, seed: 's1', targetMin: 30, fixed: 25, json: '/w/out.json', strict: true })
  })

  // --strict is the M1.4b certificate; its r criterion needs a run of >= 20 items/axis (DESIGN §14.3).
  it('--strict on part b (or all) needs --fixed of at least 20; part a has no r criterion and takes any', () => {
    for (const argv of [['--strict', '--fixed', '0'], ['--strict', '--part', 'b', '--fixed', '0'], ['--strict', '--part', 'all', '--fixed', '19']]) {
      expect(() => parseSimCatArgs(argv, '/w'), argv.join(' ')).toThrow(/--strict judges r ≥ \.85 at 20 items\/axis.*--fixed 20 or more/)
    }
    expect(parseSimCatArgs(['--strict', '--fixed', '20'], '/w').strict).toBe(true)
    expect(parseSimCatArgs(['--strict', '--part', 'a', '--fixed', '0'], '/w')).toMatchObject({ part: 'a', fixed: 0, strict: true })
    expect(parseSimCatArgs(['--part', 'b', '--fixed', '0'], '/w')).toMatchObject({ fixed: 0, strict: false }) // without --strict, r is simply reported
  })

  it.each([
    [['--part', 'c']],
    [['--n', '1']],
    [['--n', 'x']],
    [['--target-min', '0']],
    [['--fixed', '-1']],
    [['--fixed', '2.5']],
    [['--seed']],
    [['--json', '--strict']],
    [['--bogus']],
  ])('rejects %j', (argv) => {
    expect(() => parseSimCatArgs(argv, '/w')).toThrow(UsageError)
  })
})

describe('main', () => {
  let dir: string
  let out: string[]
  let err: string[]
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hb-simcat-'))
    out = []
    err = []
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void out.push(a.join(' ')))
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void err.push(a.join(' ')))
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    fake.runCat = null
    rmSync(dir, { recursive: true, force: true })
  })

  it('part a at n = 300 prints the parity table and passes, also with --strict', () => {
    expect(main(['--part', 'a', '--n', '300', '--strict'], dir)).toBe(0)
    const text = out.join('\n')
    expect(text).toContain('M1.4b (a) non-adaptive M1.4a replication in TS: N = 300')
    expect(text).toMatch(/parity \(\|r_TS − r_Python\| ≤ 0\.02 on all 17 axes\): PASS/)
  })

  it('part b runs the A15 session and the fixed-length session and writes JSON', () => {
    expect(main(['--part', 'b', '--n', '3', '--fixed', '2', '--json', 'res.json'], dir)).toBe(0)
    const text = out.join('\n')
    expect(text).toContain('A15 time rule, target 27.5 min')
    expect(text).toContain('fixed length 2 items per CAT axis (no time limit)')
    const res = JSON.parse(readFileSync(join(dir, 'res.json'), 'utf8')) as Record<string, { n: number; fixed_length: number | null; items_per_axis: Record<string, { mean: number }>; axes: Record<string, unknown> }>
    expect(res.b_a15!.n).toBe(3)
    expect(res.b_a15!.fixed_length).toBeNull()
    expect(res.b_fixed!.fixed_length).toBe(2)
    expect(res.b_fixed!.items_per_axis.SPA!.mean).toBe(2)
    expect(Object.keys(res.b_a15!.axes)).toHaveLength(17)
    expect(res.a).toBeUndefined()
  })

  it('--strict exits 1 when an acceptance fails (a fixture whose Python r is off by 0.1)', () => {
    const f = loadFixture()
    const doctored: M14aFixture = { ...f, results: f.results.map((r) => ({ ...r, axes: r.axes.map((a) => ({ ...a, r: a.r - 0.1 })) })) }
    const path = join(dir, 'fixture.json')
    writeFileSync(path, JSON.stringify(doctored))
    expect(main(['--part', 'a', '--n', '300'], dir, path)).toBe(0)
    expect(out.join('\n')).toContain('FAIL MAT')
    expect(main(['--part', 'a', '--n', '300', '--strict'], dir, path)).toBe(1)
  })

  // ROADMAP M1.4b, user decision 2026-09-29: the M1 criterion is r ≥ .85 at 20 items/axis (DESIGN
  // §14.3). --strict must fail on that fixed-length run only, never on the A15-budget run's r.
  describe('--strict and the r criterion (synthetic runs: MAT / SPA / QR r = .815 / .798 / .743, the A15-budget values)', () => {
    const lowR = { MAT: { r: 0.815 }, SPA: { r: 0.798 }, QR: { r: 0.743 } }
    const strictB = (fixed: string, ...more: string[]): number => main(['--part', 'b', '--n', '3', '--fixed', fixed, '--strict', ...more], dir)
    const givenFixedLength = (opts: unknown): number | null => (opts as { fixedLength?: number } | undefined)?.fixedLength ?? null

    it('an A15-budget run with r below .85 passes (time and coverage hold); r is printed as informational and not checked', () => {
      fake.runCat = (...args) => fakeCatRun(lowR, { fixedLength: givenFixedLength(args[1]) })
      expect(main(['--part', 'b', '--n', '3', '--fixed', '0'], dir)).toBe(0)
      const text = out.join('\n')
      expect(text).toContain('r within the A15 time budget is informational, not an acceptance criterion')
      expect(text).toContain('MAT 0.815, SPA 0.798, QR 0.743')
      expect(text).toContain('acceptance (cov90 in [0.85, 0.95] where observed; every session ≤ 30.0 min): PASS')
      expect(text).toContain('the r ≥ .85 criterion (DESIGN §14.3) was not checked') // no fixed-length run to judge
    })

    // A strict exit 0 must never certify a criterion nobody checked: without a run of >= 20
    // items/axis, --strict is a usage error (exit 2, before any simulation).
    it('--strict without a fixed length of 20 or more is a usage error, not an exit 0 with r unchecked', () => {
      let calls = 0
      fake.runCat = (...args) => (calls++, fakeCatRun(lowR, { fixedLength: givenFixedLength(args[1]) }))
      expect(strictB('0')).toBe(2)
      expect(strictB('4')).toBe(2)
      expect(calls).toBe(0)
      expect(err.filter((e) => e.includes('--strict judges r ≥ .85 at 20 items/axis') && e.includes(SIM_CAT_USAGE))).toHaveLength(2)
      expect(main(['--part', 'a', '--n', '300', '--fixed', '0', '--strict'], dir)).toBe(0) // part a has no r criterion
    })

    it('a fixed-length run of 20 items/axis with r below .85 fails --strict, and exits 0 without it', () => {
      fake.runCat = (...args) => fakeCatRun(lowR, { fixedLength: givenFixedLength(args[1]) })
      expect(strictB('20', '--json', 'res.json')).toBe(1)
      const text = out.join('\n')
      expect(text).toContain('FAIL MAT: r = 0.815 < 0.85')
      expect(text).toContain('FAIL QR: r = 0.743 < 0.85')
      expect(text).not.toContain('was not checked')
      const res = JSON.parse(readFileSync(join(dir, 'res.json'), 'utf8')) as Record<string, { r_criterion_axes: string[]; acceptance_failures: string[] }>
      expect(res.b_a15!.r_criterion_axes).toEqual([])
      expect(res.b_a15!.acceptance_failures).toEqual([])
      expect(res.b_fixed!.r_criterion_axes).toEqual(['MAT', 'SPA', 'QR'])
      expect(res.b_fixed!.acceptance_failures).toHaveLength(3)
      expect(main(['--part', 'b', '--n', '3', '--fixed', '20'], dir)).toBe(0)
    })

    it('a fixed-length run of 20 items/axis with r ≥ .85 passes --strict; a shorter fixed length (no --strict) is informational', () => {
      fake.runCat = (...args) => fakeCatRun({}, { fixedLength: givenFixedLength(args[1]) })
      expect(strictB('20')).toBe(0)
      expect(out.join('\n')).not.toContain('was not checked')
      fake.runCat = (...args) => fakeCatRun(lowR, { fixedLength: givenFixedLength(args[1]) })
      out.length = 0
      expect(main(['--part', 'b', '--n', '3', '--fixed', '4'], dir)).toBe(0)
      expect(out.join('\n')).toContain('r at 4 items per axis is informational')
      expect(out.join('\n')).toContain('was not checked')
    })

    it('a fixed-length run that did not reach 20 items on an axis fails --strict', () => {
      const short = { min: 17, mean: 19.9, max: 20 }
      fake.runCat = (...args) => fakeCatRun({}, { fixedLength: givenFixedLength(args[1]), ...(givenFixedLength(args[1]) === null ? {} : { itemsPerAxis: { MAT: short, SPA: short, QR: short } }) })
      expect(strictB('20')).toBe(1)
      expect(out.join('\n')).toContain('FAIL MAT: only 17 items in the least-served session, fewer than the 20 items/axis r is judged at')
    })

    it('time and coverage still fail --strict on the A15 run', () => {
      fake.runCat = (...args) => fakeCatRun({ MAT: { coverage: 0.7 } }, { fixedLength: givenFixedLength(args[1]) })
      expect(strictB('20')).toBe(1)
      expect(out.join('\n')).toContain('FAIL MAT: 90% coverage 0.700 outside [0.85, 0.95]')
      fake.runCat = (...args) => fakeCatRun({}, { fixedLength: givenFixedLength(args[1]), timeS: { min: 1600, mean: 1700, max: 1900 } })
      out.length = 0
      expect(strictB('20')).toBe(1) // the A15 run is 31.7 min at its slowest
      expect(out.join('\n')).toContain('FAIL time: max session 31.67 min > budget 30.00 min')
    })
  })

  it('usage errors exit 2 with the usage line', () => {
    expect(main(['--part', 'z'], dir)).toBe(2)
    expect(main(['--part', 'a', '--n', '500'], dir)).toBe(2) // no Python result for 500
    expect(main(['--n', '2001'], dir)).toBe(2)
    expect(err.filter((e) => e.includes(SIM_CAT_USAGE))).toHaveLength(3)
  })

  it('refuses a fixture this engine cannot use', () => {
    const path = join(dir, 'old.json')
    writeFileSync(path, JSON.stringify({ ...loadFixture(SIM_FIXTURE), version: 'sim_m14a_v0' }))
    expect(() => main(['--part', 'a', '--n', '300'], dir, path)).toThrow(/sim_m14a_v0.*sync:golden/)
  })
})
