/**
 * Fermi scoring (ROADMAP M5.1): parity with the bank (`golden/fermi_scoring_v1.json`, A17, 1e-9) and the
 * properties that do not depend on it. DESIGN §14.6 ex. 8–9 are the worked cases.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import golden from '../../engine/__fixtures__/fermi_scoring_v1.json'
import { MalformedResponseError, gaussianObservationSigma } from '../family'
import { calibrationObservation, calibrationSummary } from '../calibration'
import { CAL_NORMS, FERMI_NORMS, brierScore, brierStandardError, fermiParams, fermiX } from '../priors'
import {
  GOLDEN_TOLERANCE,
  HIT_TOL_DEX,
  INTERVAL_ALPHA,
  MAGNITUDE_MAX,
  MAGNITUDE_MIN,
  MAX_INTERVAL_DEX,
  UNCERTAINTY_FULL_WEIGHT_DEX,
  UNCERTAINTY_REJECT_DEX,
  estimateInUnit,
  fermiObservation,
  fermiSe,
  intervalScore,
  parseFermiResponse,
  parseTrueValue,
  scoreFermi,
  sigmaScale,
  summarise,
  truthWeight,
  weightZone,
  type FermiResponse,
  type FermiScore,
  type FermiTruth,
} from './scoring'
import { DIMENSIONS, log10Between, unitsOf } from './units'

type GoldenCase = (typeof golden.cases)[number]

const truthOf = (t: GoldenCase['truth']): FermiTruth => ({ true_value: t.true_value, unit: t.unit, true_value_uncertainty_log10: t.true_value_uncertainty_log10 })

/** Every number of `got` within the golden tolerance of `want`; other values equal. */
function expectClose(got: unknown, want: unknown, path = '$'): void {
  if (typeof want === 'number') {
    expect(typeof got, path).toBe('number')
    expect(Math.abs((got as number) - want), `${path}: ${String(got)} vs ${want}`).toBeLessThanOrEqual(GOLDEN_TOLERANCE)
  } else if (Array.isArray(want)) {
    expect(Array.isArray(got), path).toBe(true)
    expect((got as unknown[]).length, path).toBe(want.length)
    want.forEach((w, i) => expectClose((got as unknown[])[i], w, `${path}[${i}]`))
  } else if (want !== null && typeof want === 'object') {
    expect(Object.keys(got as object).sort(), path).toEqual(Object.keys(want).sort())
    for (const [k, w] of Object.entries(want)) expectClose((got as Record<string, unknown>)[k], w, `${path}.${k}`)
  } else {
    expect(got, path).toEqual(want)
  }
}

describe('constants', () => {
  it('are the DESIGN numbers and the golden file records them', () => {
    expect(UNCERTAINTY_FULL_WEIGHT_DEX).toBe(golden.bounds.full_weight_dex)
    expect(UNCERTAINTY_REJECT_DEX).toBe(golden.bounds.reject_dex)
    expect(INTERVAL_ALPHA).toBe(golden.bounds.interval_alpha)
    expect(HIT_TOL_DEX).toBe(golden.bounds.hit_tol_dex)
    expect(MAGNITUDE_MIN).toBe(golden.bounds.magnitude_min)
    expect(MAGNITUDE_MAX).toBe(golden.bounds.magnitude_max)
    expect(MAX_INTERVAL_DEX).toBe(golden.bounds.max_interval_dex)
    expect(GOLDEN_TOLERANCE).toBe(golden.tolerance)
    expect(FERMI_NORMS).toEqual(golden.norms)
    expect(CAL_NORMS).toEqual(golden.cal_norms)
  })
})

describe('truth weight (DESIGN §4.2: down-weight above 0.15 dex, reject above 0.3)', () => {
  it('matches the bank at every golden uncertainty', () => {
    for (const row of golden.weights.rows) {
      expect(truthWeight(row.u)).toBeCloseTo(row.weight, 12)
      expect(sigmaScale(row.u)).toBeCloseTo(row.sigma_scale, 12)
      expect(fermiSe(row.u)).toBeCloseTo(row.se, 12)
    }
  })

  it('rejects what the bank rejects', () => {
    for (const u of golden.weights.rejected) expect(() => truthWeight(u)).toThrow(RangeError)
    for (const bad of [NaN, Infinity, '0.1' as unknown as number]) expect(() => truthWeight(bad)).toThrow(RangeError)
  })

  it('is 1 up to 0.15, continuous there, and a quarter at 0.3', () => {
    expect(truthWeight(0)).toBe(1)
    expect(truthWeight(0.15)).toBe(1)
    expect(truthWeight(0.15 + 1e-12)).toBeCloseTo(1, 8)
    expect(truthWeight(0.3)).toBeCloseTo(0.25, 12)
    expect(weightZone(0.15)).toBe('full')
    expect(weightZone(0.2)).toBe('down_weighted')
    expect(weightZone(0.3)).toBe('down_weighted')
    expect(weightZone(0.31)).toBe('rejected')
  })

  it('scales the sigma by max(1, u / 0.15) and lets the Gaussian block pipeline carry it (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 0.3, noNaN: true }), (u) => {
        expect(sigmaScale(u)).toBeCloseTo(Math.max(1, u / 0.15), 12)
        const sigma = gaussianObservationSigma(fermiSe(u), fermiParams(0))
        expect(sigma).toBeCloseTo(FERMI_NORMS.residual_sd_dex * Math.max(1, u / 0.15), 12)
      }),
    )
  })
})

describe('parity with the bank cases', () => {
  it('has the cases it needs', () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(100)
  })

  it.each(golden.cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const response = parseFermiResponse(c.response)
    const truth = truthOf(c.truth)
    const score = scoreFermi(response, truth)
    expectClose({ ...score }, c.score)
    expectClose(fermiSe(truth.true_value_uncertainty_log10), c.se)
    expectClose(fermiObservation(score, truth.true_value_uncertainty_log10, c.delta), c.observation)
  })

  it('reproduces every summary', () => {
    const byId = new Map(golden.cases.map((c) => [c.id, c] as const))
    for (const g of golden.summaries) {
      const scores = g.cases.map((id) => {
        const c = byId.get(id) as GoldenCase
        return scoreFermi(parseFermiResponse(c.response), truthOf(c.truth))
      })
      expectClose({ ...(summarise(scores) as object) }, g.summary, g.id)
    }
  })

  it('refuses every malformed response the bank refuses', () => {
    for (const m of golden.malformed) {
      expect(() => {
        const r = parseFermiResponse(m.response)
        if ('truth' in m) scoreFermi(r, truthOf(m.truth as GoldenCase['truth']))
      }, m.id).toThrow(MalformedResponseError)
    }
  })

  it('reproduces the Brier sets with the existing calibration code', () => {
    for (const b of golden.brier) {
      const answers = b.answers.map((a) => ({ pct: a.pct, correct: a.correct as 0 | 1 }))
      const c = answers.map((a) => a.pct / 100)
      const y = answers.map((a) => a.correct)
      expect(brierScore(c, y), b.id).toBeCloseTo(b.brier, 12)
      if ('standard_error' in b) expect(brierStandardError(c, y), b.id).toBeCloseTo(b.standard_error as number, 12)
      expectClose({ ...(calibrationSummary(answers) as object) }, b.summary, `${b.id}.summary`)
      const obs = calibrationObservation(answers)
      if (b.observation === null) expect(obs, b.id).toBeNull()
      else expectClose({ ...obs }, b.observation, `${b.id}.observation`)
    }
  })
})

const YEAR: FermiTruth = { true_value: '31557600', unit: 's', true_value_uncertainty_log10: 0 }
const resp = (value: number, unit = 's', low = value / 2, high = value * 2): FermiResponse => ({ value, unit, low, high })

describe('worked examples', () => {
  it('DESIGN §14.6 ex. 8: 3e7 against 3.156e7 s is 0.022 dex', () => {
    const s = scoreFermi(resp(3e7, 's', 2e7, 5e7), YEAR)
    expect(s.abs_error_dex).toBeCloseTo(0.022, 3)
    expect(s.error_dex).toBeLessThan(0)
    expect(s.hit).toBe(true)
    expect(s.x).toBe(-s.abs_error_dex)
  })

  it('DESIGN §14.6 ex. 9: Brier of c = 0.9, y = 0 is 0.81 and of c = 0.6, y = 1 is 0.16', () => {
    expect(brierScore([0.9], [0])).toBeCloseTo(0.81, 12)
    expect(brierScore([0.6], [1])).toBeCloseTo(0.16, 12)
  })

  it('agrees with the shared fermiX', () => {
    for (const [est, truth] of [[3e7, 31557600], [1e9, 31557600], [31557600, 31557600]] as const) {
      expect(scoreFermi(resp(est), { ...YEAR, true_value: String(truth) }).x).toBeCloseTo(fermiX(est, truth), 12)
    }
  })

  it('the unit is not part of the error', () => {
    const base = scoreFermi(resp(3e7, 's', 2e7, 5e7), YEAR)
    for (const unit of ['min', 'h', 'day']) {
      const conv = (x: number): number => 10 ** log10Between(x, 's', unit)
      const other = scoreFermi({ value: conv(3e7), unit, low: conv(2e7), high: conv(5e7) }, YEAR)
      expect(other.error_dex).toBeCloseTo(base.error_dex, 9)
      expect(other.interval_score_dex).toBeCloseTo(base.interval_score_dex, 9)
      expect(other.hit).toBe(base.hit)
    }
  })

  it('a hit includes the ends, even through rounding', () => {
    const at = (value: string): boolean => scoreFermi({ value: 1.5, unit: 'km', low: 1, high: 2 }, { true_value: value, unit: 'm', true_value_uncertainty_log10: 0 }).hit
    expect(at('1000')).toBe(true)
    expect(at('2000')).toBe(true)
    expect(at('2001')).toBe(false)
    expect(at('999')).toBe(false)
  })

  it('a unit of another dimension is refused', () => {
    expect(() => scoreFermi(resp(10, 'm'), YEAR)).toThrow(MalformedResponseError)
  })

  it('a truth that is not valid is refused', () => {
    expect(() => scoreFermi(resp(10), { ...YEAR, true_value: '0' })).toThrow(RangeError)
    expect(() => scoreFermi(resp(10), { ...YEAR, unit: 'furlong' })).toThrow(RangeError)
    expect(() => scoreFermi(resp(10), { ...YEAR, true_value_uncertainty_log10: 0.31 })).toThrow(RangeError)
    expect(() => parseTrueValue('1,000')).toThrow(RangeError)
  })
})

describe('the interval score', () => {
  it('pays the width and ten times the miss', () => {
    expect(intervalScore(0.4, -0.2, 0.2)).toBeCloseTo(0.4, 12)
    expect(intervalScore(0.4, 0.3, 0.7)).toBeCloseTo(0.4 + 3, 12)
    expect(intervalScore(0.4, -0.7, -0.3)).toBeCloseTo(0.4 + 3, 12)
  })

  it('is proper: for a normal error the true 10% / 90% quantiles score best', () => {
    // a deterministic grid over truth ~ N(0, s) in dex, so the test is exact rather than sampled
    const s = 0.6
    const n = 4000
    const z = Array.from({ length: n }, (_v, i) => {
      // the (i + 0.5) / n quantile of the standard normal, by bisection on the cdf
      const p = (i + 0.5) / n
      let lo = -8
      let hi = 8
      for (let k = 0; k < 60; k++) {
        const mid = (lo + hi) / 2
        const cdf = 0.5 * (1 + erf(mid / Math.SQRT2))
        if (cdf < p) lo = mid
        else hi = mid
      }
      return (lo + hi) / 2
    })
    const mean = (half: number): number => z.reduce((a, q) => a + intervalScore(2 * half, -half - s * q, half - s * q), 0) / n
    const best = mean(1.2816 * s)
    for (const k of [0.3, 0.6, 0.9, 1.1, 1.5, 2, 3]) expect(mean(k * s)).toBeGreaterThan(best - 1e-3)
  })
})

/** The error function (Abramowitz–Stegun 7.1.26 refined by a series for small x): only the proper-score test uses it. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const a = Math.abs(x)
  if (a < 3) {
    let term = a
    let sum = a
    for (let n = 1; n < 80; n++) {
      term *= (-a * a) / n
      sum += term / (2 * n + 1)
    }
    return (sign * 2 * sum) / Math.sqrt(Math.PI)
  }
  const t = 1 / (1 + 0.3275911 * a)
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a)
  return sign * y
}

describe('the observation on theta_FER', () => {
  it('uses the item difficulty and scales the sigma with the truth weight', () => {
    const score = scoreFermi(resp(3e7), YEAR)
    for (const delta of [-1, 0, 0.7]) {
      const obs = fermiObservation(score, 0, delta)
      const p = fermiParams(delta)
      expect([obs.lam, obs.d, obs.x, obs.kind, obs.axis]).toEqual([p.lam, p.d, score.x, 'gaussian', 'FER'])
      expect(obs.sigma).toBeCloseTo(FERMI_NORMS.residual_sd_dex, 12)
    }
    expect(fermiObservation(score, 0.3).sigma).toBeCloseTo(2 * FERMI_NORMS.residual_sd_dex, 12)
    const obs = fermiObservation(score, 0.225)
    const info = (obs.lam / obs.sigma) ** 2 / (obs.lam / FERMI_NORMS.residual_sd_dex) ** 2
    expect(info).toBeCloseTo(truthWeight(0.225), 12)
  })
})

describe('summarise', () => {
  const t1000: FermiTruth = { true_value: '1000', unit: 'm', true_value_uncertainty_log10: 0 }
  const hit = scoreFermi({ value: 900, unit: 'm', low: 500, high: 2000 }, t1000)
  const miss = scoreFermi({ value: 100, unit: 'm', low: 50, high: 200 }, t1000)

  it('is null with no answers', () => {
    expect(summarise([])).toBeNull()
  })

  it('reports the hit rate, calibration in the large and the Brier score of the 80% statements', () => {
    const s = summarise([hit, hit, hit, miss]) as NonNullable<ReturnType<typeof summarise>>
    expect(s.n).toBe(4)
    expect(s.hit_rate).toBeCloseTo(0.75, 12)
    expect(s.in_the_large).toBeCloseTo(-0.05, 12)
    expect(s.interval_brier).toBeCloseTo((3 * 0.04 + 0.64) / 4, 12)
    expect(s.median_abs_error_dex).toBeCloseTo(hit.abs_error_dex, 12)
    expect(s.mean_abs_error_dex).toBeCloseTo((3 * hit.abs_error_dex + miss.abs_error_dex) / 4, 12)
  })

  it('weights by the truth uncertainty', () => {
    const shaky = scoreFermi({ value: 100, unit: 'm', low: 50, high: 200 }, { ...t1000, true_value_uncertainty_log10: 0.3 })
    const s = summarise([hit, shaky]) as NonNullable<ReturnType<typeof summarise>>
    expect(s.total_weight).toBeCloseTo(1.25, 12)
    expect(s.hit_rate).toBeCloseTo(1 / 1.25, 12)
  })

  it('has the median of an even count between the middle two', () => {
    const mk = (abs: number): FermiScore => ({ ...hit, abs_error_dex: abs })
    expect((summarise([mk(0.4), mk(0.1), mk(0.3), mk(0.2)]) as NonNullable<ReturnType<typeof summarise>>).median_abs_error_dex).toBeCloseTo(0.25, 12)
    expect((summarise([mk(0.4), mk(0.1), mk(0.3)]) as NonNullable<ReturnType<typeof summarise>>).median_abs_error_dex).toBeCloseTo(0.3, 12)
  })

  const truthArb = fc.record({
    dim: fc.constantFrom(...DIMENSIONS),
    mant: fc.double({ min: 1, max: 9.99, noNaN: true }),
    exp: fc.integer({ min: -8, max: 14 }),
    u: fc.double({ min: 0, max: 0.3, noNaN: true }),
    pick: fc.nat(),
  })
  const respArb = fc.record({ logV: fc.double({ min: -10, max: 12, noNaN: true }), below: fc.double({ min: 0, max: 3.9, noNaN: true }), above: fc.double({ min: 0, max: 3.9, noNaN: true }), pick: fc.nat() })

  it('stays within its bounds, and converting the response between units never changes a score (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(truthArb, respArb), { minLength: 1, maxLength: 8 }), fc.nat(), (pairs, which) => {
        const scores: FermiScore[] = []
        for (const [t, r] of pairs) {
          const syms = unitsOf(t.dim).map((u) => u.symbol)
          const truth: FermiTruth = { true_value: `${t.mant.toFixed(3)}e${t.exp}`, unit: syms[t.pick % syms.length] as string, true_value_uncertainty_log10: t.u }
          const unit = syms[r.pick % syms.length] as string
          const v = 10 ** r.logV
          const response = parseFermiResponse({ value: v, unit, low: v * 10 ** -r.below, high: v * 10 ** r.above })
          const score = scoreFermi(response, truth)
          const target = syms[(which + r.pick) % syms.length] as string
          const converted = scoreFermi({ value: estimateInUnit(response, target), unit: target, low: 10 ** log10Between(response.low, unit, target), high: 10 ** log10Between(response.high, unit, target) }, truth)
          expect(converted.error_dex).toBeCloseTo(score.error_dex, 7)
          expect(converted.interval_score_dex).toBeCloseTo(score.interval_score_dex, 6)
          scores.push(score)
        }
        const s = summarise(scores) as NonNullable<ReturnType<typeof summarise>>
        expect(s.hit_rate).toBeGreaterThanOrEqual(0)
        expect(s.hit_rate).toBeLessThanOrEqual(1)
        expect(s.interval_brier).toBeLessThanOrEqual(0.64 + 1e-12)
        expect(s.total_weight).toBeGreaterThan(0)
        expect(s.total_weight).toBeLessThanOrEqual(scores.length)
      }),
      { numRuns: 200 },
    )
  })
})

describe('parseFermiResponse', () => {
  it.each([
    ['not an object', 5],
    ['null', null],
    ['an array', [1, 2, 3, 4]],
    ['missing low', { value: 10, unit: 's', high: 20 }],
    ['an extra field', { value: 10, unit: 's', low: 5, high: 20, note: 'x' }],
    ['a string value', { value: '10', unit: 's', low: 5, high: 20 }],
    ['a boolean value', { value: true, unit: 's', low: 5, high: 20 }],
    ['a zero', { value: 0, unit: 's', low: 0, high: 20 }],
    ['a negative', { value: -1, unit: 's', low: -2, high: 20 }],
    ['below range', { value: 1e-31, unit: 's', low: 1e-31, high: 1e-30 }],
    ['above range', { value: 1e31, unit: 's', low: 1e30, high: 1e31 }],
    ['an unknown unit', { value: 10, unit: 'furlong', low: 5, high: 20 }],
    ['low above the guess', { value: 10, unit: 's', low: 11, high: 20 }],
    ['high below the guess', { value: 10, unit: 's', low: 5, high: 9 }],
    ['too wide', { value: 1, unit: 's', low: 1e-5, high: 1e5 }],
    ['infinity', { value: Infinity, unit: 's', low: 5, high: 20 }],
    ['NaN', { value: NaN, unit: 's', low: 5, high: 20 }],
  ])('refuses %s', (_name, raw) => {
    expect(() => parseFermiResponse(raw)).toThrow(MalformedResponseError)
  })

  it('accepts the widest interval allowed and a point interval', () => {
    expect(parseFermiResponse({ value: 1, unit: 's', low: 1e-4, high: 1e4 }).high).toBe(1e4)
    expect(parseFermiResponse({ value: 5, unit: 's', low: 5, high: 5 }).low).toBe(5)
  })

  it('returns a frozen copy', () => {
    const raw = { value: 5, unit: 's', low: 1, high: 9 }
    const r = parseFermiResponse(raw)
    expect(Object.isFrozen(r)).toBe(true)
    expect(r).not.toBe(raw)
  })
})
