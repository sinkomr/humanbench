/**
 * `npm run sim:cat` (ROADMAP M1.4b): argument parsing, exit codes, the tables and the JSON
 * output, on small runs (the full n = 2,000 run is `sim-cat.slow.test.ts`).
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { A15_TARGET_S } from '../src/engine/selector'
import type { M14aFixture } from '../src/sim/m14a'
import { UsageError } from './dump-lib'
import { SIM_CAT_USAGE, SIM_FIXTURE, loadFixture, main, parseSimCatArgs } from './sim-cat'

describe('parseSimCatArgs', () => {
  it('has the documented defaults', () => {
    expect(parseSimCatArgs([], '/w')).toEqual({ part: 'all', n: 2000, seed: 'm14b', targetMin: A15_TARGET_S / 60, fixed: 20, strict: false })
  })

  it('reads every option; --json resolves against the given directory', () => {
    const a = parseSimCatArgs(['--', '--part', 'b', '--n', '300', '--seed', 's1', '--target-min', '30', '--fixed', '0', '--json', 'out.json', '--strict'], '/w')
    expect(a).toEqual({ part: 'b', n: 300, seed: 's1', targetMin: 30, fixed: 0, json: '/w/out.json', strict: true })
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
