import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  check3pl,
  checkGaussian,
  checkGrm,
  grmCumulative,
  grmLogProbs,
  grmProbs,
  info2pl,
  info3pl,
  infoGaussian,
  infoGrm,
  logistic,
  loglik2pl,
  loglik3pl,
  loglikGaussian,
  loglikGrm,
  logLogistic,
  observationInfo,
  observationLoglik,
  observationScore,
  p2pl,
  p3pl,
  score2pl,
  score3pl,
  scoreGaussian,
  scoreGrm,
} from './irt'
import type { Observation } from './types'

const theta = fc.double({ min: -4, max: 4, noNaN: true })
const disc = fc.double({ min: 0.2, max: 3, noNaN: true })
const diff = fc.double({ min: -3, max: 3, noNaN: true })
const guess = fc.double({ min: 0.1, max: 0.5, noNaN: true })
const binary = fc.constantFrom<0 | 1>(0, 1)
/** Strictly increasing thresholds: a start plus 1–6 positive gaps. */
const thresholdsArb = fc
  .tuple(
    fc.double({ min: -3, max: 1, noNaN: true }),
    fc.array(fc.double({ min: 0.1, max: 1.5, noNaN: true }), { minLength: 0, maxLength: 5 }),
  )
  .map(([b1, gaps]) => gaps.reduce<number[]>((acc, g) => [...acc, acc[acc.length - 1]! + g], [b1]))
const grmArb = fc
  .tuple(disc, thresholdsArb)
  .chain(([a, bs]) => fc.tuple(fc.constant(a), fc.constant(bs), fc.integer({ min: 0, max: bs.length })))
const gaussArb = fc.record({
  lam: fc.double({ min: -2, max: 2, noNaN: true }),
  d: fc.double({ min: -2, max: 2, noNaN: true }),
  sigma: fc.double({ min: 0.1, max: 2, noNaN: true }),
  x: fc.double({ min: -5, max: 5, noNaN: true }),
})

/** Central first difference. */
const d1 = (f: (t: number) => number, t: number, h = 1e-5): number => (f(t + h) - f(t - h)) / (2 * h)
/** Central second difference. */
const d2 = (f: (t: number) => number, t: number, h = 1e-3): number => (f(t + h) - 2 * f(t) + f(t - h)) / (h * h)

const close = (actual: number, expected: number, tol: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol * (1 + Math.abs(expected)))

/** Relative closeness, for large-magnitude reference values (e.g. log-probabilities near −1e4). */
const rel = (actual: number, expected: number, tol = 1e-12) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol * Math.abs(expected) + 1e-300)

/** Exactly zero, treating −0 as 0. */
const zero = (v: number) => expect(v === 0).toBe(true)

/** log(1 − e^{−1}): the log of σ(z) − σ(z − 1) as z → −∞, relative to e^{z}. */
const LOG1M_EINV = Math.log1p(-Math.exp(-1))

describe('logistic', () => {
  it('matches the textbook formula, stays in [0, 1] and is symmetric', () => {
    fc.assert(
      fc.property(fc.double({ min: -30, max: 30, noNaN: true }), (z) => {
        const s = logistic(z)
        expect(s).toBeGreaterThanOrEqual(0)
        expect(s).toBeLessThanOrEqual(1)
        close(s, 1 / (1 + Math.exp(-z)), 1e-14)
        close(logistic(-z), 1 - s, 1e-14)
        close(logLogistic(z), Math.log(s), 1e-12)
      }),
    )
  })

  it('is monotone non-decreasing', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true }), fc.double({ noNaN: true }), (u, v) => {
        const [lo, hi] = u <= v ? [u, v] : [v, u]
        // Allow a few ulps of rounding slack.
        expect(logistic(lo)).toBeLessThanOrEqual(logistic(hi) * (1 + 4 * Number.EPSILON))
        expect(logLogistic(lo)).toBeLessThanOrEqual(logLogistic(hi) + 4 * Number.EPSILON * Math.abs(logLogistic(hi)))
      }),
    )
  })

  it('does not overflow or produce NaN at extreme |z|', () => {
    for (const z of [1e4, -1e4, 1e308, -1e308, Infinity, -Infinity]) {
      expect(Number.isNaN(logistic(z))).toBe(false)
      expect(Number.isNaN(logLogistic(z))).toBe(false)
    }
    expect(logistic(1e4)).toBe(1)
    expect(logistic(-1e4)).toBe(0)
    expect(logLogistic(-1e4)).toBe(-1e4)
    expect(Math.abs(logLogistic(1e4))).toBe(0)
    expect(logLogistic(-800)).toBe(-800) // exp(800) would overflow in the naive form
  })
})

describe('2PL and 3PL response functions', () => {
  it('2PL: P in [0, 1], P(b) = ½, increasing in θ for a > 0', () => {
    fc.assert(
      fc.property(theta, theta, disc, diff, (t1, t2, a, b) => {
        const p = p2pl(t1, a, b)
        expect(p).toBeGreaterThanOrEqual(0)
        expect(p).toBeLessThanOrEqual(1)
        if (t1 < t2) expect(p2pl(t1, a, b)).toBeLessThanOrEqual(p2pl(t2, a, b) * (1 + 4 * Number.EPSILON))
        expect(p2pl(b, a, b)).toBe(0.5)
      }),
    )
  })

  it('3PL: P in [c, 1], increasing in θ, reduces to the 2PL as c → 0', () => {
    fc.assert(
      fc.property(theta, theta, disc, diff, guess, (t1, t2, a, b, c) => {
        const p = p3pl(t1, a, b, c)
        expect(p).toBeGreaterThanOrEqual(c)
        expect(p).toBeLessThanOrEqual(1)
        if (t1 < t2) expect(p3pl(t1, a, b, c)).toBeLessThanOrEqual(p3pl(t2, a, b, c) * (1 + 4 * Number.EPSILON))
        close(p3pl(t1, a, b, 1e-12), p2pl(t1, a, b), 1e-11)
        close(loglik3pl(t1, a, b, c, 1), Math.log(p), 1e-12)
        close(loglik3pl(t1, a, b, c, 0), Math.log(1 - p), 1e-6) // naive 1 − p cancels near P = 1
        close(loglik2pl(t1, a, b, 1), Math.log(p2pl(t1, a, b)), 1e-12)
      }),
    )
  })

  it('score is the derivative of the log-likelihood', () => {
    fc.assert(
      fc.property(theta, disc, diff, guess, binary, (t, a, b, c, y) => {
        close(score2pl(t, a, b, y), d1((u) => loglik2pl(u, a, b, y), t), 1e-6)
        close(score3pl(t, a, b, c, y), d1((u) => loglik3pl(u, a, b, c, y), t), 1e-6)
      }),
    )
  })

  it('3PL score and information match the §7.1 closed forms', () => {
    fc.assert(
      fc.property(theta, disc, diff, guess, binary, (t, a, b, c, y) => {
        const P = p3pl(t, a, b, c)
        close(score3pl(t, a, b, c, y), (a * (y - P) * (P - c)) / (P * (1 - c)), 1e-10)
        close(info3pl(t, a, b, c), (a * a * (P - c) ** 2 * (1 - P)) / (P * (1 - c) ** 2), 1e-10)
        close(info2pl(t, a, b), a * a * p2pl(t, a, b) * (1 - p2pl(t, a, b)), 1e-12)
      }),
    )
  })

  it('information equals −E[second derivative of the log-likelihood] and E[score²]', () => {
    fc.assert(
      fc.property(theta, disc, diff, guess, (t, a, b, c) => {
        const P2 = p2pl(t, a, b)
        const e2 =
          -(P2 * d2((u) => loglik2pl(u, a, b, 1), t) + (1 - P2) * d2((u) => loglik2pl(u, a, b, 0), t))
        close(info2pl(t, a, b), e2, 1e-4)
        const P3 = p3pl(t, a, b, c)
        const e3 =
          -(P3 * d2((u) => loglik3pl(u, a, b, c, 1), t) + (1 - P3) * d2((u) => loglik3pl(u, a, b, c, 0), t))
        close(info3pl(t, a, b, c), e3, 1e-4)
        close(info3pl(t, a, b, c), P3 * score3pl(t, a, b, c, 1) ** 2 + (1 - P3) * score3pl(t, a, b, c, 0) ** 2, 1e-10)
        expect(info3pl(t, a, b, c)).toBeLessThanOrEqual(info2pl(t, a, b) + 1e-15)
      }),
    )
  })

  it('2PL information peaks at θ = b with value a²/4', () => {
    fc.assert(
      fc.property(theta, disc, diff, (t, a, b) => {
        expect(info2pl(t, a, b)).toBeLessThanOrEqual(info2pl(b, a, b) * (1 + 4 * Number.EPSILON))
        close(info2pl(b, a, b), (a * a) / 4, 1e-15)
      }),
    )
  })

  it('gives the limiting values at extreme |z| (a = 1, b = 0, c = ¼)', () => {
    const c = 0.25
    for (const T of [1e4, 1e6]) {
      // θ → +∞: P → 1, log P(1) → 0, log P(0) → log σ(−z) = −z (+ log(1 − c) for the 3PL).
      expect(p2pl(T, 1, 0)).toBe(1)
      zero(loglik2pl(T, 1, 0, 1))
      rel(loglik2pl(T, 1, 0, 0), -T)
      zero(score2pl(T, 1, 0, 1))
      expect(score2pl(T, 1, 0, 0)).toBe(-1)
      zero(info2pl(T, 1, 0))
      expect(p3pl(T, 1, 0, c)).toBe(1)
      close(loglik3pl(T, 1, 0, c, 1), 0, 1e-15)
      rel(loglik3pl(T, 1, 0, c, 0), Math.log1p(-c) - T)
      zero(score3pl(T, 1, 0, c, 1))
      expect(score3pl(T, 1, 0, c, 0)).toBe(-1) // d/dθ log(1 − P) = −a·σ(z) → −a
      zero(info3pl(T, 1, 0, c))
      // θ → −∞: P → 0 (2PL) or c (3PL); the 3PL score and information vanish (flat at c).
      expect(p2pl(-T, 1, 0)).toBe(0)
      rel(loglik2pl(-T, 1, 0, 1), -T)
      zero(loglik2pl(-T, 1, 0, 0))
      expect(score2pl(-T, 1, 0, 1)).toBe(1)
      zero(score2pl(-T, 1, 0, 0))
      zero(info2pl(-T, 1, 0))
      expect(p3pl(-T, 1, 0, c)).toBe(c)
      close(loglik3pl(-T, 1, 0, c, 1), Math.log(c), 1e-15)
      close(loglik3pl(-T, 1, 0, c, 0), Math.log1p(-c), 1e-15)
      zero(score3pl(-T, 1, 0, c, 1))
      zero(score3pl(-T, 1, 0, c, 0))
      zero(info3pl(-T, 1, 0, c))
    }
  })

  it('rejects a guessing parameter outside (0, 1) and non-binary responses', () => {
    for (const c of [0, 1, -0.1, 1.2, Number.NaN]) {
      expect(() => check3pl(c)).toThrow(RangeError)
      expect(() => p3pl(0, 1, 0, c)).toThrow(RangeError)
      expect(() => loglik3pl(0, 1, 0, c, 1)).toThrow(RangeError)
      expect(() => score3pl(-1e4, 1, 0, c, 1)).toThrow(RangeError)
      expect(() => info3pl(-1e4, 1, 0, c)).toThrow(RangeError)
    }
    expect(() => p3pl(0, 1, 0, undefined as unknown as number)).toThrow(RangeError)
    for (const y of [2, -1, 0.5, Number.NaN, true]) {
      const yy = y as unknown as 0 | 1
      expect(() => loglik2pl(0, 1, 0, yy)).toThrow(RangeError)
      expect(() => score2pl(0, 1, 0, yy)).toThrow(RangeError)
      expect(() => loglik3pl(0, 1, 0, 0.25, yy)).toThrow(RangeError)
      expect(() => score3pl(0, 1, 0, 0.25, yy)).toThrow(RangeError)
    }
  })
})

describe('graded response model', () => {
  it('category probabilities are in [0, 1] and sum to 1', () => {
    fc.assert(
      fc.property(theta, grmArb, (t, [a, bs]) => {
        const p = grmProbs(t, a, bs)
        expect(p).toHaveLength(bs.length + 1)
        for (const v of p) {
          expect(v).toBeGreaterThanOrEqual(0)
          expect(v).toBeLessThanOrEqual(1)
        }
        close(
          p.reduce((s, v) => s + v, 0),
          1,
          1e-12,
        )
      }),
    )
  })

  it('matches the naive difference of boundary curves', () => {
    fc.assert(
      fc.property(theta, grmArb, (t, [a, bs]) => {
        const cum = grmCumulative(t, a, bs)
        expect(cum[0]).toBe(1)
        expect(cum[cum.length - 1]).toBe(0)
        for (let j = 1; j < cum.length; j++) expect(cum[j]!).toBeLessThanOrEqual(cum[j - 1]!)
        const p = grmProbs(t, a, bs)
        p.forEach((v, j) => expect(Math.abs(v - (cum[j]! - cum[j + 1]!))).toBeLessThan(1e-12))
      }),
    )
  })

  it('with one threshold it is the 2PL', () => {
    fc.assert(
      fc.property(theta, disc, diff, binary, (t, a, b, y) => {
        close(loglikGrm(t, a, [b], y), loglik2pl(t, a, b, y), 1e-12)
        close(scoreGrm(t, a, [b], y), score2pl(t, a, b, y), 1e-12)
        close(infoGrm(t, a, [b]), info2pl(t, a, b), 1e-12)
      }),
    )
  })

  it('expected category is increasing in θ', () => {
    fc.assert(
      fc.property(theta, theta, grmArb, (t1, t2, [a, bs]) => {
        fc.pre(t1 < t2)
        const mean = (t: number) => grmProbs(t, a, bs).reduce((s, p, j) => s + j * p, 0)
        expect(mean(t1)).toBeLessThanOrEqual(mean(t2) + 1e-12)
      }),
    )
  })

  it('score is the derivative of the log-likelihood; information is −E[second derivative]', () => {
    fc.assert(
      fc.property(theta, grmArb, (t, [a, bs, y]) => {
        close(scoreGrm(t, a, bs, y), d1((u) => loglikGrm(u, a, bs, y), t), 1e-6)
        const p = grmProbs(t, a, bs)
        const expected = -p.reduce((s, pj, j) => s + pj * d2((u) => loglikGrm(u, a, bs, j), t), 0)
        close(infoGrm(t, a, bs), expected, 1e-4)
      }),
    )
  })

  it('gives the asymptotic category log-probabilities at extreme |z|', () => {
    // Thresholds −1, 0, 1 and a = 1, so z_j = θ − b_j. As z → −∞, σ(z) ≈ e^z and
    // log(σ(z_j) − σ(z_j − 1)) ≈ z_j + log(1 − e^{−1}); log σ(z) → 0 as z → +∞.
    const bs = [-1, 0, 1]
    const hi = grmLogProbs(1e4, 1, bs) // z = (10001, 10000, 9999)
    rel(hi[0]!, -10001)
    rel(hi[1]!, -10000 + LOG1M_EINV)
    rel(hi[2]!, -9999 + LOG1M_EINV)
    close(hi[3]!, 0, 1e-15)
    const lo = grmLogProbs(-1e4, 1, bs) // z = (−9999, −10000, −10001)
    close(lo[0]!, 0, 1e-15)
    rel(lo[1]!, -9999 + LOG1M_EINV)
    rel(lo[2]!, -10000 + LOG1M_EINV)
    rel(lo[3]!, -10001)
    // Scores a(1 − P*_y − P*_{y+1}): the top category is flat at +∞, the bottom one at −∞.
    expect([0, 1, 2, 3].map((y) => scoreGrm(1e4, 1, bs, y) + 0)).toEqual([-1, -1, -1, 0])
    expect([0, 1, 2, 3].map((y) => scoreGrm(-1e4, 1, bs, y) + 0)).toEqual([0, 1, 1, 1])
    zero(infoGrm(1e4, 1, bs))
    zero(infoGrm(-1e4, 1, bs))
  })

  it('rejects invalid parameters', () => {
    expect(() => checkGrm(1, 0 as unknown as number[])).toThrow(RangeError)
    expect(() => checkGrm(1, [])).toThrow(RangeError)
    expect(() => checkGrm(1, [0, 0])).toThrow(RangeError)
    expect(() => checkGrm(1, [1, 0])).toThrow(RangeError)
    expect(() => checkGrm(0, [0])).toThrow(RangeError)
    expect(() => checkGrm(1, [Number.NaN])).toThrow(RangeError)
    expect(() => loglikGrm(0, 1, [0, 1], 3)).toThrow(RangeError)
    expect(() => scoreGrm(0, 1, [0, 1], 0.5)).toThrow(RangeError)
  })
})

describe('Gaussian (continuous) model', () => {
  it('log-likelihood is the normal log-density; score and information match derivatives', () => {
    fc.assert(
      fc.property(theta, gaussArb, (t, { lam, d, sigma, x }) => {
        const mu = lam * t + d
        close(
          loglikGaussian(t, lam, d, sigma, x),
          -((x - mu) ** 2) / (2 * sigma * sigma) - Math.log(sigma * Math.sqrt(2 * Math.PI)),
          1e-12,
        )
        close(scoreGaussian(t, lam, d, sigma, x), d1((u) => loglikGaussian(u, lam, d, sigma, x), t), 1e-5)
        close(infoGaussian(lam, sigma), -d2((u) => loglikGaussian(u, lam, d, sigma, x), t), 1e-4)
      }),
    )
  })

  it('negative loading (RT log-time, λ = −1): larger x lowers θ', () => {
    expect(scoreGaussian(0, -1, 0, 0.5, 1)).toBeLessThan(0)
    expect(scoreGaussian(0, -1, 0, 0.5, -1)).toBeGreaterThan(0)
    expect(infoGaussian(-1, 0.5)).toBe(4)
  })

  it('rejects a non-positive or non-finite sigma', () => {
    for (const sigma of [0, -1, Number.NaN, Infinity]) {
      expect(() => checkGaussian(sigma)).toThrow(RangeError)
      expect(() => loglikGaussian(0, 1, 0, sigma, 1)).toThrow(RangeError)
      expect(() => scoreGaussian(0, 1, 0, sigma, 1)).toThrow(RangeError)
      expect(() => infoGaussian(1, sigma)).toThrow(RangeError)
    }
  })
})

describe('observation dispatch', () => {
  it('routes each kind to its model functions', () => {
    const t = 0.3
    const cases: [Observation, number, number, number][] = [
      [
        { kind: '2pl', axis: 'MAT', a: 1.2, b: 0.5, y: 1 },
        loglik2pl(t, 1.2, 0.5, 1),
        score2pl(t, 1.2, 0.5, 1),
        info2pl(t, 1.2, 0.5),
      ],
      [
        { kind: '3pl', axis: 'LR', a: 1.1, b: -0.2, c: 0.2, y: 0 },
        loglik3pl(t, 1.1, -0.2, 0.2, 0),
        score3pl(t, 1.1, -0.2, 0.2, 0),
        info3pl(t, 1.1, -0.2, 0.2),
      ],
      [
        { kind: 'grm', axis: 'WM', a: 1.5, b: [-1, 0, 1.2], y: 2 },
        loglikGrm(t, 1.5, [-1, 0, 1.2], 2),
        scoreGrm(t, 1.5, [-1, 0, 1.2], 2),
        infoGrm(t, 1.5, [-1, 0, 1.2]),
      ],
      [
        { kind: 'gaussian', axis: 'RT', lam: -1, d: 0.1, sigma: 0.4, x: -0.2 },
        loglikGaussian(t, -1, 0.1, 0.4, -0.2),
        scoreGaussian(t, -1, 0.1, 0.4, -0.2),
        infoGaussian(-1, 0.4),
      ],
    ]
    for (const [obs, ll, sc, inf] of cases) {
      expect(observationLoglik(obs, t)).toBe(ll)
      expect(observationScore(obs, t)).toBe(sc)
      expect(observationInfo(obs, t)).toBe(inf)
    }
  })

  it('accepts observations in the golden-vector wire schema (bank golden/scoring_v1.json)', () => {
    // The first observation of each kind in the golden file, verbatim (field names lam and
    // b-as-threshold-array included), parsed from JSON as the M1.3 golden test will do.
    const golden = JSON.parse(`[
      {"kind": "2pl", "axis": "MAT", "a": 1.0, "b": -1.5, "y": 1},
      {"kind": "3pl", "axis": "LR", "a": 1.2, "b": -1.0, "c": 0.2, "y": 1},
      {"kind": "grm", "axis": "WM", "a": 1.5, "b": [-1.0, 0.0], "y": 2},
      {"kind": "gaussian", "axis": "RT", "lam": -1.0, "d": 0.0, "sigma": 0.5, "x": -0.641}
    ]`) as Observation[]
    const t = 0.4
    const direct = [
      [loglik2pl(t, 1, -1.5, 1), score2pl(t, 1, -1.5, 1), info2pl(t, 1, -1.5)],
      [loglik3pl(t, 1.2, -1, 0.2, 1), score3pl(t, 1.2, -1, 0.2, 1), info3pl(t, 1.2, -1, 0.2)],
      [loglikGrm(t, 1.5, [-1, 0], 2), scoreGrm(t, 1.5, [-1, 0], 2), infoGrm(t, 1.5, [-1, 0])],
      [loglikGaussian(t, -1, 0, 0.5, -0.641), scoreGaussian(t, -1, 0, 0.5, -0.641), infoGaussian(-1, 0.5)],
    ]
    golden.forEach((obs, i) => {
      const got = [observationLoglik(obs, t), observationScore(obs, t), observationInfo(obs, t)]
      for (const v of got) expect(Number.isFinite(v)).toBe(true)
      expect(got).toEqual(direct[i])
    })
  })

  it('throws on an observation kind outside the union instead of returning undefined', () => {
    // '2pl_testlet' is a valid ModelKind but not an observation kind (score it as '2pl').
    for (const kind of ['2pl_testlet', 'rasch', undefined]) {
      const obs = { kind, axis: 'RC', a: 1, b: 0, y: 1 } as unknown as Observation
      expect(() => observationLoglik(obs, 0)).toThrow(RangeError)
      expect(() => observationScore(obs, 0)).toThrow(RangeError)
      expect(() => observationInfo(obs, 0)).toThrow(RangeError)
    }
  })
})
