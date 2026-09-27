/**
 * Every verification rule of the rt family with hand-built NEGATIVE instances (M1.10). Bad
 * schedules are re-derived (key, reference expectation, priors, time) wherever the rule allows,
 * so the rule under test is the only one that fails.
 */

import { describe, expect, it } from 'vitest'
import type { VerifyResult } from '../family'
import { expectedOf, generateRtBlock, rt, rtDifficulty, rtExpectedTimeS, rtStructure, scoreRtResponse, verifyRt, type RtItem, type RtMode, type RtResponse, type RtSpec } from '.'

/** Mutable JSON view of an item. */
type J = any

const base = (mode: RtMode, seed = 'neg'): J => JSON.parse(JSON.stringify(generateRtBlock(seed, mode))) as J

/** The boolean checks that failed. */
const failed = (r: VerifyResult): string[] => Object.entries(r.checks).filter(([, v]) => v === false).map(([k]) => k)

/** Re-derive key.positions, the reference responses/expectation, the prior and E[T] from x.spec. */
function rederive(x: J, opts: { keepKey?: boolean } = {}): J {
  const spec = x.spec as RtSpec
  const mode = spec.mode
  const ref = x.key.reference
  if (!opts.keepKey) x.key.positions = [...spec.positions]
  const n = spec.positions.length
  const rts: (number | null)[] = Array.from({ length: n }, (_, i) => (i < ref.rt_ms.length ? (ref.rt_ms[i] as number | null) : 300))
  ref.rt_ms = rts
  ref.choice = rts.map((v, i) => (v === null ? null : mode === 'simple' ? 0 : Math.min(3, Math.max(0, spec.positions[i] as number))))
  try {
    ref.expected = expectedOf(scoreRtResponse(mode, x.key.positions, ref as RtResponse, { device_class: ref.device_class }))
  } catch {
    // A schedule of the wrong length cannot be scored; leave the old expectation.
  }
  x.difficulty = rtDifficulty(spec)
  x.expected_time_s = rtExpectedTimeS(spec)
  return x
}

const check = (x: J): VerifyResult => verifyRt(x as RtItem)

/** A balanced 40-trial sequence with runs of 1: [0,1,2,3] × 10. */
const cyclic = (): number[] => Array.from({ length: 40 }, (_, i) => i % 4)

describe('verifyRt accepts generated blocks', () => {
  it('both modes pass with every check true', () => {
    for (const mode of ['simple', 'choice4'] as const) {
      const r = check(base(mode))
      expect(r.ok, r.reason).toBe(true)
      expect(failed(r)).toEqual([])
      expect(r.checks.max_run).toBeLessThanOrEqual(mode === 'simple' ? 33 : 3) // practice + scored
    }
  })

  it('a re-derived hand-built schedule passes (the helper does not break items)', () => {
    const x = base('choice4')
    x.spec.positions = cyclic()
    expect(check(rederive(x)).ok).toBe(true)
  })

  it('a run of exactly 3 is allowed', () => {
    const x = base('choice4')
    const seq = cyclic()
    // [0,0,0,1,2,3,1,2,3,…]: move two 0s to the front to make one run of three.
    seq.splice(0, 12, 0, 0, 0, 1, 2, 3, 1, 2, 3, 1, 2, 3)
    x.spec.practice_positions = [1, 2, 3]
    x.spec.positions = seq
    const r = check(rederive(x))
    expect(r.checks.max_run).toBe(3)
    expect(r.ok, r.reason).toBe(true)
    // Across the boundary: practice ending in 0, then two 0s, is a run of 3 too.
    const y = base('choice4')
    y.spec.practice_positions = [2, 1, 0]
    y.spec.positions = [0, 0, 1, 2, 3, 1, 2, 3, ...cyclic().slice(0, 32)]
    const ry = check(rederive(y))
    expect(ry.checks.max_run).toBe(3)
    expect(ry.ok, ry.reason).toBe(true)
  })
})

describe('verifyRt rejects each failure reason (negative tests)', () => {
  it('mode_known: unknown mode, missing mode, or no spec at all', () => {
    const x = base('simple')
    x.spec.mode = 'choice2'
    expect(check(x).reason).toBe('failed: mode_known')
    const y = base('simple')
    delete y.spec.mode
    expect(check(y).reason).toBe('failed: mode_known')
    const z = base('simple')
    z.spec = null
    expect(check(z).reason).toBe('failed: mode_known')
    const w = base('simple')
    w.spec.mode = ['simple']
    expect(check(w).reason).toBe('failed: mode_known')
  })

  it('schedule_integer_arrays: a fractional foreperiod, a string position, a missing array', () => {
    const x = base('choice4')
    x.spec.foreperiods_ms[3] = 1000.5
    expect(check(x).reason).toBe('failed: schedule_integer_arrays')
    const y = base('choice4')
    y.spec.positions[0] = '1'
    expect(check(y).reason).toBe('failed: schedule_integer_arrays')
    const z = base('simple')
    delete z.spec.practice_positions
    expect(check(z).reason).toBe('failed: schedule_integer_arrays')
  })

  it('spec_fields_exact: an extra spec field (it would reach the DOM)', () => {
    const x = base('choice4')
    x.spec.hint = 'watch the left side'
    expect(failed(check(x))).toEqual(['spec_fields_exact'])
  })

  it('n_positions_matches_mode', () => {
    const x = base('simple')
    x.spec.n_positions = 4
    expect(failed(check(x))).toEqual(['n_positions_matches_mode'])
    const y = base('choice4')
    y.spec.n_positions = 1
    expect(failed(check(y))).toEqual(['n_positions_matches_mode'])
  })

  it('practice_count: 2 or 4 practice trials', () => {
    const x = base('simple')
    x.spec.practice_foreperiods_ms.pop()
    x.spec.practice_positions.pop()
    expect(failed(check(rederive(x)))).toEqual(['practice_count'])
    const y = base('choice4')
    y.spec.practice_foreperiods_ms.push(1000)
    y.spec.practice_positions = [0, 1, 2, 3]
    expect(failed(check(rederive(y)))).toEqual(['practice_count'])
  })

  it('trial_count: 29 simple or 41 choice trials', () => {
    const x = base('simple')
    x.spec.foreperiods_ms.pop()
    x.spec.positions.pop()
    expect(failed(check(rederive(x)))).toContain('trial_count')
    const y = base('choice4')
    y.spec.foreperiods_ms.push(900)
    y.spec.positions.push(0)
    expect(failed(check(rederive(y)))).toContain('trial_count')
    const z = base('choice4')
    z.spec.foreperiods_ms.pop() // the arrays disagree
    expect(failed(check(rederive(z)))).toContain('trial_count')
  })

  it('foreperiods_in_range: 799 or 2001 ms, scored or practice', () => {
    for (const [field, i, v] of [
      ['foreperiods_ms', 5, 799],
      ['foreperiods_ms', 0, 2001],
      ['practice_foreperiods_ms', 2, 2001],
      ['practice_foreperiods_ms', 0, 0],
    ] as const) {
      const x = base('choice4')
      x.spec[field][i] = v
      expect(failed(check(rederive(x))), `${field}[${i}] = ${v}`).toEqual(['foreperiods_in_range'])
    }
    const ok = base('simple')
    ok.spec.foreperiods_ms[0] = 800
    ok.spec.foreperiods_ms[1] = 2000
    expect(check(rederive(ok)).ok).toBe(true)
  })

  it('positions_in_range: a practice position 4 (choice), a scored position 1 (simple) or −1', () => {
    const x = base('choice4')
    x.spec.practice_positions = [0, 1, 4]
    expect(failed(check(rederive(x)))).toEqual(['positions_in_range'])
    const y = base('simple')
    y.spec.positions[7] = 1
    expect(failed(check(rederive(y)))).toEqual(['positions_in_range', 'positions_balanced'])
    const z = base('choice4')
    z.spec.positions = cyclic()
    z.spec.positions[0] = -1
    expect(failed(check(rederive(z)))).toEqual(['positions_in_range', 'positions_balanced'])
  })

  it('positions_balanced: 9 zeros and 11 ones', () => {
    const x = base('choice4')
    const seq = cyclic()
    seq[0] = 1 // [1,1,2,3,0,1,2,3,…]: runs ≤ 2
    x.spec.positions = seq
    expect(failed(check(rederive(x)))).toEqual(['positions_balanced'])
  })

  it('max_run_ok: a balanced sequence with a run of 4', () => {
    const x = base('choice4')
    const seq = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, ...cyclic().slice(0, 24)]
    x.spec.practice_positions = [1, 2, 3]
    x.spec.positions = seq
    const r = check(rederive(x))
    expect(r.checks.max_run).toBe(4)
    expect(failed(r)).toEqual(['max_run_ok'])
  })

  it('max_run_ok: a run of 4 across the practice → scored boundary (scored runs all ≤ 3)', () => {
    const x = base('choice4')
    x.spec.practice_positions = [1, 2, 0]
    x.spec.positions = [0, 0, 0, 1, 2, 3, 1, 2, 3, 1, 2, 3, ...cyclic().slice(0, 28)]
    const r = check(rederive(x))
    expect(r.checks.max_run).toBe(4)
    expect(failed(r)).toEqual(['max_run_ok'])
    x.spec.practice_positions = [0, 2, 1] // the same scored trials after a practice ending in 1
    expect(check(rederive(x)).ok).toBe(true)
  })

  it('practice_positions_distinct: choice practice at [2, 2, 1]', () => {
    const x = base('choice4')
    x.spec.practice_positions = [2, 2, 1]
    expect(failed(check(rederive(x)))).toEqual(['practice_positions_distinct'])
  })

  it('key_matches_stimuli: a key position that is not the stimulus, or no key positions', () => {
    const x = base('choice4')
    const k = [...x.spec.positions]
    ;[k[0], k[1]] = [(k[0] + 1) % 4, (k[1] + 3) % 4]
    x.key.positions = k
    expect(failed(check(rederive(x, { keepKey: true })))).toEqual(['key_matches_stimuli'])
    const y = base('simple')
    y.key.positions[3] = 1
    expect(failed(check(rederive(y, { keepKey: true })))).toEqual(['key_matches_stimuli'])
    const z = base('simple')
    delete z.key.positions
    expect(failed(check(z))).toEqual(['key_matches_stimuli', 'reference_scores_match'])
  })

  it('structure_matches: the other mode\'s structure', () => {
    const x = base('simple')
    x.structural_params = rtStructure('choice4')
    expect(failed(check(x))).toEqual(['structure_matches'])
    const y = base('choice4')
    y.structural_params = { ...rtStructure('choice4'), n_trials: 30 }
    expect(failed(check(y))).toEqual(['structure_matches'])
  })

  it('params_match_norms: wrong β, sign of lam, τ_res, or a non-Gaussian model', () => {
    const muts: ((p: J) => void)[] = [
      (p) => (p.d = Math.log(310)),
      (p) => (p.lam = 0.15),
      (p) => (p.sigma = 0.06),
      (p) => (p.d = Math.log(450)), // the choice norm on a simple block
    ]
    for (const m of muts) {
      const x = base('simple')
      m(x.params)
      expect(failed(check(x))).toEqual(['params_match_norms'])
    }
    const y = base('choice4')
    y.params = { model: '2pl', a: 1, b: 0 }
    expect(failed(check(y))).toEqual(['params_match_norms'])
  })

  it('stratum_matches', () => {
    const x = base('choice4')
    x.stratum = 2
    expect(failed(check(x))).toEqual(['stratum_matches'])
  })

  it('prior_matches: b_prior, sd_prior, a feature or the provenance changed', () => {
    const muts: ((d: J) => void)[] = [
      (d) => (d.provenance = 'calibrated from 10,000 users (M4.8)'),
      (d) => (d.provenance = `${d.provenance} `),
      (d) => (d.b_prior = 0.5),
      (d) => (d.sd_prior = 0.8),
      (d) => (d.features.mean_foreperiod_ms += 1),
      (d) => (d.features.choice = !d.features.choice),
      (d) => (d.features.extra = 1),
    ]
    for (const m of muts) {
      const x = base('simple')
      m(x.difficulty)
      expect(failed(check(x))).toEqual(['prior_matches'])
    }
  })

  it('expected_time_matches: E[T] off by more than 1e-9 s', () => {
    const x = base('choice4')
    x.expected_time_s += 1e-6
    expect(failed(check(x))).toEqual(['expected_time_matches'])
    const y = base('choice4')
    y.expected_time_s += 1e-12 // within tolerance
    expect(check(y).ok).toBe(true)
  })

  it('reference_well_formed: bad RT, unpaired null, choice out of range, no practice, no device class', () => {
    const muts: ((r: J) => void)[] = [
      (r) => (r.rt_ms[0] = 'fast'),
      (r) => (r.rt_ms[r.rt_ms.findIndex((v: number | null) => v !== null)] = null),
      (r) => (r.choice[2] = 7),
      (r) => delete r.practice_rt_ms,
      (r) => (r.device_class = ''),
      (r) => r.rt_ms.pop(),
      (r) => (r.expected = null),
    ]
    for (const m of muts) {
      const x = base('choice4')
      m(x.key.reference)
      expect(failed(check(x))).toEqual(['reference_well_formed', 'reference_scores_match'])
    }
  })

  it('reference_scores_match: tampered x, SE, sigma, a count, the status, the reason or an extra field', () => {
    const findItem = (status: 'ok' | 'no_observation'): J => {
      for (let i = 0; ; i++) {
        const x = base(i % 2 ? 'simple' : 'choice4', `find-${i}`)
        if (x.key.reference.expected.status === status) return x
      }
    }
    const okMuts: ((e: J) => void)[] = [
      (e) => (e.observation.x += 1e-9),
      (e) => (e.se += 1e-9),
      (e) => (e.observation.sigma *= 1.001),
      (e) => (e.observation.axis = 'PS'),
      (e) => (e.observation.lam = -0.2),
      (e) => (e.n_valid -= 1),
      (e) => (e.n_errors += 1),
      (e) => (e.status = 'no_observation'),
      (e) => (e.note = 'extra'),
      (e) => delete e.se,
    ]
    for (const m of okMuts) {
      const x = findItem('ok')
      m(x.key.reference.expected)
      expect(failed(check(x))).toEqual(['reference_scores_match'])
    }
    const noneMuts: ((e: J) => void)[] = [(e) => (e.reason = 'device_lag'), (e) => (e.status = 'ok'), (e) => (e.n_misses += 1)]
    for (const m of noneMuts) {
      const x = findItem('no_observation')
      m(x.key.reference.expected)
      expect(failed(check(x))).toEqual(['reference_scores_match'])
    }
    const y = findItem('ok')
    y.key.reference.expected.observation.x += 1e-13 // within the 1e-12 parity bound
    expect(check(y).ok).toBe(true)
  })

  it('a changed reference response changes the recomputed expectation', () => {
    const x = base('simple', 'resp')
    const i = x.key.reference.rt_ms.findIndex((v: number | null) => v !== null && v >= 150 && v <= 1500)
    x.key.reference.rt_ms[i] = -40 // valid → anticipation
    expect(failed(check(x))).toEqual(['reference_scores_match'])
  })

  it('never throws on malformed instances', () => {
    const muts: ((x: J) => void)[] = [
      (x) => (x.params = null),
      (x) => (x.difficulty = null),
      (x) => (x.key = null),
      (x) => (x.key.reference = []),
      (x) => (x.spec.foreperiods_ms = []),
    ]
    for (const m of muts) {
      const x = base('choice4')
      m(x)
      const r = check(x)
      expect(r.ok).toBe(false)
      expect(typeof r.reason).toBe('string')
    }
  })

  it('the family object uses this verifier', () => {
    const x = base('choice4')
    x.stratum = 2
    expect(rt.verify(x as RtItem).reason).toBe('failed: stratum_matches')
  })
})
