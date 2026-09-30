import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  check3pl,
  checkGaussian,
  checkGrm,
  checkTestlet,
  grmCumulative,
  grmLogProbs,
  grmProbs,
  info2pl,
  info3pl,
  infoGaussian,
  infoGrm,
  infoTestlet,
  logistic,
  loglik2pl,
  loglik3pl,
  loglikGaussian,
  loglikGrm,
  loglikTestlet,
  logLogistic,
  MAX_TESTLET_ITEMS,
  observationInfo,
  observationLoglik,
  observationObservedInfo,
  observationScore,
  observedInfo3pl,
  observedInfoGrm,
  observedInfoTestlet,
  p2pl,
  p3pl,
  score2pl,
  score3pl,
  scoreGaussian,
  scoreGrm,
  scoreTestlet,
  TESTLET_AT_MAX,
  TESTLET_N_NODES,
  TESTLET_NODES,
  TESTLET_SD,
  TESTLET_WEIGHTS,
  TESTLET_Z_MAX,
  TESTLET_Z_STEP,
} from './irt'
import type { Observation, TestletItem } from './types'

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
        { kind: '3pl', axis: 'SPA', a: 1.1, b: -0.2, c: 0.25, y: 0 },
        loglik3pl(t, 1.1, -0.2, 0.25, 0),
        score3pl(t, 1.1, -0.2, 0.25, 0),
        info3pl(t, 1.1, -0.2, 0.25),
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
      {"kind": "3pl", "axis": "SPA", "a": 1.2, "b": -1.0, "c": 0.25, "y": 1},
      {"kind": "grm", "axis": "WM", "a": 1.5, "b": [-1.0, 0.0], "y": 2},
      {"kind": "gaussian", "axis": "RT", "lam": -1.0, "d": 0.0, "sigma": 0.5, "x": -0.641}
    ]`) as Observation[]
    const t = 0.4
    const direct = [
      [loglik2pl(t, 1, -1.5, 1), score2pl(t, 1, -1.5, 1), info2pl(t, 1, -1.5)],
      [loglik3pl(t, 1.2, -1, 0.25, 1), score3pl(t, 1.2, -1, 0.25, 1), info3pl(t, 1.2, -1, 0.25)],
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

describe('observed information (the MAP Newton curvature, ROADMAP A2)', () => {
  it('is −d² log-likelihood/dθ² for the 3PL (both responses) and the GRM (every category)', () => {
    fc.assert(
      fc.property(theta, disc, diff, guess, binary, (t, a, b, c, y) => {
        close(observedInfo3pl(t, a, b, c, y), -d2((u) => loglik3pl(u, a, b, c, y), t), 1e-4)
      }),
    )
    fc.assert(
      fc.property(theta, grmArb, (t, [a, bs, y]) => {
        close(observedInfoGrm(t, a, bs, y), -d2((u) => loglikGrm(u, a, bs, y), t), 1e-4)
      }),
    )
  })

  it('averages to the expected information: Σ_y P(y)·observed(y) = info', () => {
    fc.assert(
      fc.property(theta, disc, diff, guess, (t, a, b, c) => {
        const P = p3pl(t, a, b, c)
        close(P * observedInfo3pl(t, a, b, c, 1) + (1 - P) * observedInfo3pl(t, a, b, c, 0), info3pl(t, a, b, c), 1e-10)
      }),
    )
    fc.assert(
      fc.property(theta, grmArb, (t, [a, bs]) => {
        const probs = grmProbs(t, a, bs)
        const e = probs.reduce((s, p, j) => s + p * observedInfoGrm(t, a, bs, j), 0)
        close(e, infoGrm(t, a, bs), 1e-10)
      }),
    )
  })

  it('3PL: y = 0 gives the 2PL value; y = 1 is negative exactly where σ(z)·(u + 2c) < c', () => {
    fc.assert(
      fc.property(theta, disc, diff, guess, (t, a, b, c) => {
        expect(observedInfo3pl(t, a, b, c, 0)).toBe(info2pl(t, a, b))
        const s = logistic(a * (t - b))
        const margin = s * ((1 - c) * s + 2 * c) - c
        const o = observedInfo3pl(t, a, b, c, 1)
        if (margin < -1e-12) expect(o).toBeLessThan(0)
        if (margin > 1e-12) expect(o).toBeGreaterThan(0)
      }),
    )
    // A correct answer far below b: the 3PL likelihood is not concave there.
    expect(observedInfo3pl(-2.5, 2, 0.5, 1 / 3, 1)).toBeLessThan(0)
  })

  it('GRM: never negative, and with one threshold it is the 2PL information', () => {
    fc.assert(
      fc.property(theta, grmArb, (t, [a, bs, y]) => {
        expect(observedInfoGrm(t, a, bs, y)).toBeGreaterThanOrEqual(0)
      }),
    )
    fc.assert(
      fc.property(theta, disc, diff, fc.constantFrom(0, 1), (t, a, b, y) => {
        close(observedInfoGrm(t, a, [b], y), info2pl(t, a, b), 1e-15)
      }),
    )
  })

  it('matches bank hb.calib.irt observed_info_3pl / observed_info_grm spot values', () => {
    // Values printed by the Python reference (repr), ROADMAP A2.
    const threePl: [number, number, number, number, 0 | 1, number][] = [
      [0.3, 1.2, -0.4, 0.25, 1, 0.17666937825765616],
      [0.3, 1.2, -0.4, 0.25, 0, 0.3032806435733745],
      [-2.5, 2.0, 0.5, 1 / 3, 1, -0.019441491703567227],
      [-1.0, 0.8, 0.2, 0.5, 1, -0.029046388720791586],
      [1.7, 1.5, 0.3, 0.25, 1, 0.15383779181810878],
    ]
    for (const [t, a, b, c, y, want] of threePl) close(observedInfo3pl(t, a, b, c, y), want, 1e-14)
    const grm: [number, number, number[], number, number][] = [
      [0.3, 1.5, [-1, 0, 1.2], 0, 0.24533959309122047],
      [0.3, 1.5, [-1, 0, 1.2], 1, 0.7802972528912615],
      [0.3, 1.5, [-1, 0, 1.2], 2, 0.9028051238848869],
      [0.3, 1.5, [-1, 0, 1.2], 3, 0.36784746408484587],
      [-0.7, 2.1, [0.9], 1, 0.14307067763624373],
      [-0.7, 2.1, [0.9], 0, 0.14307067763624373],
    ]
    for (const [t, a, bs, y, want] of grm) close(observedInfoGrm(t, a, bs, y), want, 1e-14)
  })

  it('stays finite (0 in the limit) at extreme |z|', () => {
    zero(observedInfo3pl(-3000, 100, 50, 0.25, 1))
    zero(observedInfo3pl(3000, 100, -50, 0.25, 0))
    zero(observedInfoGrm(5000, 100, [-60, 0, 60], 1))
    for (const T of [1e4, -1e4, 1e6, -1e6]) {
      for (const y of [0, 1] as const) expect(Number.isFinite(observedInfo3pl(T, 1, 0, 0.25, y))).toBe(true)
      for (const y of [0, 1, 2]) expect(Number.isFinite(observedInfoGrm(T, 1.5, [-1, 1], y))).toBe(true)
    }
  })

  it('rejects invalid parameters', () => {
    expect(() => observedInfo3pl(0, 1, 0, 1, 1)).toThrow(RangeError)
    expect(() => observedInfo3pl(0, 1, 0, 0.25, 2 as unknown as 0 | 1)).toThrow(RangeError)
    expect(() => observedInfoGrm(0, 1, [0.5, 0.2], 0)).toThrow(RangeError)
    expect(() => observedInfoGrm(0, -1, [0.5], 0)).toThrow(RangeError)
    expect(() => observedInfoGrm(0, 1, [0.5], 2)).toThrow(RangeError)
    expect(() => observedInfoGrm(0, 1, [0.5], 0.5)).toThrow(RangeError)
  })

  it('dispatches by kind: 2PL and Gaussian equal the expected information', () => {
    const t = -0.4
    const o2: Observation = { kind: '2pl', axis: 'MAT', a: 1.3, b: 0.2, y: 1 }
    const o3: Observation = { kind: '3pl', axis: 'SPA', a: 1.1, b: 0.4, c: 0.25, y: 1 }
    const og: Observation = { kind: 'grm', axis: 'WM', a: 1.5, b: [-1, 0, 1.2], y: 2 }
    const on: Observation = { kind: 'gaussian', axis: 'RT', lam: -1.3, d: 0.1, sigma: 0.4, x: -0.2 }
    expect(observationObservedInfo(o2, t)).toBe(observationInfo(o2, t))
    expect(observationObservedInfo(on, t)).toBe(observationInfo(on, t))
    expect(observationObservedInfo(o3, t)).toBe(observedInfo3pl(t, 1.1, 0.4, 0.25, 1))
    expect(observationObservedInfo(og, t)).toBe(observedInfoGrm(t, 1.5, [-1, 0, 1.2], 2))
    const bad = { kind: '2pl_testlet', axis: 'LG', a: 1, b: 0, y: 1 } as unknown as Observation
    expect(() => observationObservedInfo(bad, t)).toThrow(RangeError)
  })
})

describe('testlet: 2PL items sharing an effect γ ~ N(0, 0.3²) (§7.1, M3.9)', () => {
  const item = fc.record({ a: fc.double({ min: 0.5, max: 2.5, noNaN: true }), b: fc.double({ min: -2.5, max: 2.5, noNaN: true }), y: binary })
  const itemsArb = (maxLength = MAX_TESTLET_ITEMS): fc.Arbitrary<TestletItem[]> => fc.array(item, { minLength: 1, maxLength })
  const tauArb = fc.constantFrom(0.1, 0.3, 0.6)
  const thetaArb = fc.double({ min: -2.5, max: 2.5, noNaN: true })
  /** Every response pattern of n items. */
  const patterns = (items: readonly TestletItem[]): TestletItem[][] =>
    Array.from({ length: 2 ** items.length }, (_, m) => items.map((it, j) => ({ ...it, y: ((m >> j) & 1) as 0 | 1 })))
  /** log ∫ Π p_j N(γ; 0, τ²) dγ on a dense trapezoid over ±10τ (a different rule from the 65-node one). */
  const refLoglik = (t: number, tau: number, items: readonly TestletItem[]): number => {
    const n = 8001
    const h = (20 * tau) / (n - 1)
    const terms = Array.from({ length: n }, (_, i) => {
      const g = -10 * tau + i * h
      let l = -0.5 * (g / tau) ** 2 - Math.log(tau * Math.sqrt(2 * Math.PI))
      for (const it of items) l += loglik2pl(t + g, it.a, it.b, it.y)
      return l
    })
    const m = Math.max(...terms)
    return m + Math.log(terms.reduce((acc, v) => acc + Math.exp(v - m), 0) * h)
  }

  it('records the grid rule: 65 nodes z = −8 + i/4, Gaussian weights summing to 1, τ = 0.3', () => {
    expect([TESTLET_SD, MAX_TESTLET_ITEMS, TESTLET_N_NODES, TESTLET_Z_MAX, TESTLET_Z_STEP]).toEqual([0.3, 8, 65, 8, 0.25])
    expect(TESTLET_NODES).toHaveLength(65)
    expect(TESTLET_NODES.map((z, i) => z - (-8 + i * 0.25))).toEqual(new Array(65).fill(0)) // exact
    expect([TESTLET_NODES[0], TESTLET_NODES[32], TESTLET_NODES[64]]).toEqual([-8, 0, 8])
    close(TESTLET_WEIGHTS.reduce((s, w) => s + w, 0), 1, 1e-15)
    const raw = TESTLET_NODES.map((z) => Math.exp(-0.5 * z * z))
    const total = raw.reduce((s, v) => s + v, 0)
    TESTLET_WEIGHTS.forEach((w, i) => close(w, raw[i]! / total, 1e-14))
    TESTLET_WEIGHTS.forEach((w, i) => expect(w).toBe(TESTLET_WEIGHTS[64 - i]))
    close(TESTLET_WEIGHTS.reduce((s, w, i) => s + w * TESTLET_NODES[i]! ** 2, 0), 1, 1e-12) // Var(z) = 1
    close(TESTLET_WEIGHTS.reduce((s, w, i) => s + w * TESTLET_NODES[i]! ** 4, 0), 3, 1e-10) // E z⁴ = 3
    expect(Object.isFrozen(TESTLET_NODES)).toBe(true)
    expect(Object.isFrozen(TESTLET_WEIGHTS)).toBe(true)
  })

  it('log-likelihood equals an independent dense integral of the γ mixture', () => {
    fc.assert(
      fc.property(itemsArb(), thetaArb, tauArb, (items, t, tau) => {
        const want = refLoglik(t, tau, items)
        fc.pre(want > -15) // beyond that the pattern's mass is inside the ±8σ truncation tail
        expect(Math.abs(loglikTestlet(t, tau, items) - want)).toBeLessThan(1e-6)
      }),
      { numRuns: 60 },
    )
    const items: TestletItem[] = [
      { a: 1.2, b: -0.5, y: 1 },
      { a: 0.9, b: 0.2, y: 1 },
      { a: 1.5, b: 0.6, y: 0 },
      { a: 1.1, b: 1.0, y: 1 },
    ]
    for (const t of [-2, -0.5, 0, 0.7, 2]) expect(Math.abs(loglikTestlet(t, 0.3, items) - refLoglik(t, 0.3, items))).toBeLessThan(1e-9)
  })

  it('with τ = 0 is the independent 2PL likelihood: log-likelihood, score, information', () => {
    fc.assert(
      fc.property(itemsArb(), thetaArb, (items, t) => {
        const ll = items.reduce((s, it) => s + loglik2pl(t, it.a, it.b, it.y), 0)
        const sc = items.reduce((s, it) => s + score2pl(t, it.a, it.b, it.y), 0)
        const inf = items.reduce((s, it) => s + info2pl(t, it.a, it.b), 0)
        expect(Math.abs(loglikTestlet(t, 0, items) - ll)).toBeLessThan(1e-12)
        expect(Math.abs(scoreTestlet(t, 0, items) - sc)).toBeLessThan(1e-12)
        expect(Math.abs(observedInfoTestlet(t, 0, items) - inf)).toBeLessThan(1e-12)
        expect(Math.abs(infoTestlet(t, 0, items) - inf)).toBeLessThan(1e-12)
      }),
    )
  })

  it('the probabilities of the 2^n response patterns sum to 1', () => {
    fc.assert(
      fc.property(itemsArb(6), thetaArb, tauArb, (items, t, tau) => {
        const total = patterns(items).reduce((s, y) => s + Math.exp(loglikTestlet(t, tau, y)), 0)
        expect(Math.abs(total - 1)).toBeLessThan(1e-12)
      }),
      { numRuns: 40 },
    )
  })

  it('score is d log L/dθ; observed information is −d² log L/dθ² and is not negative in the supported range', () => {
    fc.assert(
      fc.property(itemsArb(), thetaArb, tauArb, (items, t, tau) => {
        close(scoreTestlet(t, tau, items), d1((u) => loglikTestlet(u, tau, items), t), 1e-6)
        const obs = observedInfoTestlet(t, tau, items)
        close(obs, -d1((u) => scoreTestlet(u, tau, items), t), 1e-6)
        expect(obs).toBeGreaterThanOrEqual(-1e-12) // the exact marginal log-likelihood is concave (Prékopa); the grid keeps it in range (irt.ts module comment)
      }),
      { numRuns: 60 },
    )
  })

  it('expected information is the pattern average of score² and of the observed information', () => {
    fc.assert(
      fc.property(itemsArb(6), thetaArb, tauArb, (items, t, tau) => {
        let bySquare = 0
        let byObserved = 0
        for (const y of patterns(items)) {
          const p = Math.exp(loglikTestlet(t, tau, y))
          bySquare += p * scoreTestlet(t, tau, y) ** 2
          byObserved += p * observedInfoTestlet(t, tau, y)
        }
        const info = infoTestlet(t, tau, items)
        expect(Math.abs(info - bySquare)).toBeLessThanOrEqual(1e-9 * info + 1e-12)
        expect(Math.abs(info - byObserved)).toBeLessThanOrEqual(1e-8 * info + 1e-10) // the information identity
      }),
      { numRuns: 40 },
    )
  })

  it('discounts the information of its items by about 20% (§7.1) and more with a larger τ', () => {
    const b = [-0.6, -0.2, 0.2, 0.6]
    for (const a of [1, 1.4, 1.8, 2.2]) {
      const items = b.map((bj): TestletItem => ({ a, b: bj, y: 1 }))
      const ind = items.reduce((s, it) => s + info2pl(0, it.a, it.b), 0)
      const ratio = infoTestlet(0, TESTLET_SD, items) / ind
      expect(ratio).toBeGreaterThan(0.65)
      expect(ratio).toBeLessThan(0.95)
      close(ratio, 1 / (1 + TESTLET_SD ** 2 * ind), 0.04) // ≈ 1/(1 + τ² I)
    }
    const items: TestletItem[] = [1.3, 1.1, 1.6].map((a, j) => ({ a, b: [-0.4, 0.1, 0.5][j]!, y: 1 }))
    const infos = [0, 0.15, 0.3, 0.6, 1].map((tau) => infoTestlet(0.1, tau, items))
    for (let i = 1; i < infos.length; i++) expect(infos[i]!).toBeLessThan(infos[i - 1]!)
  })

  it('does not overflow or lose finiteness for steep items and improbable patterns', () => {
    // logits up to 500 at the largest supported a (|a|·τ ≤ 3)
    const items: TestletItem[] = [
      { a: 10, b: -50, y: 1 },
      { a: 10, b: 50, y: 0 },
      { a: 5, b: 0, y: 1 },
    ]
    for (const y of [items, items.map((it) => ({ ...it, y: (1 - it.y) as 0 | 1 }))]) {
      for (const f of [loglikTestlet, scoreTestlet, observedInfoTestlet]) expect(Number.isFinite(f(0, 0.3, y)), f.name).toBe(true)
    }
    expect(Number.isFinite(infoTestlet(0, 0.3, items))).toBe(true)
    expect(infoTestlet(0, 0.3, [{ a: 1, b: 400, y: 0 }])).toBeGreaterThanOrEqual(0)
    // τ = 0 is the independent 2PL, exact at any a (no limit on |a|·τ there)
    const steep: TestletItem[] = [
      { a: 100, b: -50, y: 1 },
      { a: 100, b: 50, y: 0 },
      { a: 50, b: 0, y: 1 },
    ]
    for (const f of [loglikTestlet, scoreTestlet, observedInfoTestlet]) expect(Number.isFinite(f(0, 0, steep)), f.name).toBe(true)
  })

  it('validates τ, the item count and each item', () => {
    const ok: TestletItem[] = [{ a: 1, b: 0, y: 1 }]
    for (const tau of [-0.1, Number.NaN, Infinity]) expect(() => loglikTestlet(0, tau, ok)).toThrow(/tau/)
    expect(() => checkTestlet(0, [])).toThrow(/1 to 8 items/)
    expect(() => infoTestlet(0, 0.3, new Array<TestletItem>(9).fill(ok[0]!))).toThrow(/1 to 8 items/)
    expect(() => checkTestlet(0.3, undefined as unknown as TestletItem[])).toThrow(RangeError)
    expect(() => checkTestlet(0.3, [{ a: Infinity, b: 0, y: 1 }])).toThrow(/finite/)
    expect(() => checkTestlet(0.3, [{ a: 1, b: Number.NaN, y: 1 }])).toThrow(/finite/)
    expect(() => checkTestlet(0.3, [{ a: 1, b: 0, y: 2 as 1 }])).toThrow(/0 or 1/)
    expect(() => checkTestlet(0.3, [null as unknown as TestletItem])).toThrow(RangeError)
    expect(() => checkTestlet(0, ok)).not.toThrow()
    expect(() => checkTestlet(0.3, new Array<TestletItem>(8).fill(ok[0]!))).not.toThrow()
  })

  describe('the range of the grid rule (|a|·τ ≤ 3, i.e. |a| ≤ 10 at τ = 0.3)', () => {
    const steepItems = fc
      .integer({ min: 1, max: MAX_TESTLET_ITEMS })
      .chain((n) =>
        fc.tuple(
          fc.array(fc.double({ min: 0.5, max: 10, noNaN: true }), { minLength: n, maxLength: n }),
          fc.array(fc.double({ min: -4, max: 4, noNaN: true }), { minLength: n, maxLength: n }),
          fc.array(binary, { minLength: n, maxLength: n }),
        ),
      )
      .map(([a, b, y]) => a.map((aj, j): TestletItem => ({ a: j === 0 ? 10 : aj, b: b[j]!, y: y[j]! }))) // the first at the largest a

    it('is the bank item schema cap at the model τ, and is checked on the product', () => {
      expect(TESTLET_AT_MAX).toBe(3)
      expect(TESTLET_AT_MAX).toBeCloseTo(10 * TESTLET_SD, 12)
      for (const sign of [1, -1]) {
        expect(() => checkTestlet(0.3, [{ a: 10 * sign, b: 0, y: 1 }])).not.toThrow()
        expect(() => checkTestlet(0.3, [{ a: 10.5 * sign, b: 0, y: 1 }])).toThrow(/\|a\|·tau/)
      }
      expect(() => loglikTestlet(0, 0.3, [{ a: 1, b: 0, y: 1 }, { a: 50, b: 0, y: 0 }])).toThrow(RangeError)
      expect(() => infoTestlet(0, 0.3, [{ a: 50, b: 0, y: 1 }])).toThrow(/\|a\|·tau/)
      expect(() => checkTestlet(1, [{ a: 3, b: 0, y: 1 }])).not.toThrow() // |a| ≤ 3 at τ = 1
      expect(() => checkTestlet(1, [{ a: 3.5, b: 0, y: 1 }])).toThrow(/\|a\|·tau/)
      expect(() => checkTestlet(0, [{ a: 1000, b: 0, y: 1 }])).not.toThrow() // τ = 0: exact, no limit
    })

    it('log-likelihood is within 1e-6 of a dense integral up to the largest a, wherever log L ≥ −20', () => {
      fc.assert(
        fc.property(steepItems, fc.double({ min: -4, max: 4, noNaN: true }), (items, t) => {
          const want = refLoglik(t, TESTLET_SD, items)
          fc.pre(want >= -20) // the documented envelope (irt.ts module comment)
          expect(Math.abs(loglikTestlet(t, TESTLET_SD, items) - want)).toBeLessThan(1e-6)
        }),
        { numRuns: 60 },
      )
    })

    it('observed information is not negative up to the largest a (over θ ∈ [−5, 5])', () => {
      fc.assert(
        fc.property(steepItems, (items) => {
          for (let i = 0; i <= 200; i++) {
            const t = -5 + i * 0.05
            expect(observedInfoTestlet(t, TESTLET_SD, items), `θ = ${t}`).toBeGreaterThanOrEqual(-1e-9)
          }
        }),
        { numRuns: 40 },
      )
    })

    it('the error is small where the pattern is plausible and larger for extreme patterns', () => {
      const items: TestletItem[] = [{ a: 10, b: 0, y: 1 }, { a: 1, b: 0, y: 1 }]
      let worstOk = 0
      for (let i = 0; i <= 80; i++) {
        const t = -4 + i * 0.1
        const want = refLoglik(t, TESTLET_SD, items)
        if (want >= -20) worstOk = Math.max(worstOk, Math.abs(loglikTestlet(t, TESTLET_SD, items) - want))
      }
      expect(worstOk).toBeGreaterThan(0)
      expect(worstOk).toBeLessThan(1e-6)
      const far: TestletItem[] = [{ a: 10, b: 2, y: 1 }, { a: 10, b: 2.5, y: 1 }, { a: 10, b: 3, y: 1 }]
      const want = refLoglik(-4, TESTLET_SD, far)
      expect(want).toBeLessThan(-100)
      expect(Math.abs(loglikTestlet(-4, TESTLET_SD, far) - want)).toBeGreaterThan(1e-6)
    })
  })

  it('dispatches by kind: observationLoglik / Score / Info / ObservedInfo', () => {
    const items: TestletItem[] = [
      { a: 1.2, b: 0, y: 1 },
      { a: 1, b: 0.5, y: 0 },
      { a: 0.9, b: -0.5, y: 1 },
    ]
    const o: Observation = { kind: 'testlet', axis: 'RC', tau: 0.3, items }
    const t = 0.2
    expect(observationLoglik(o, t)).toBe(loglikTestlet(t, 0.3, items))
    expect(observationScore(o, t)).toBe(scoreTestlet(t, 0.3, items))
    expect(observationInfo(o, t)).toBe(infoTestlet(t, 0.3, items))
    expect(observationObservedInfo(o, t)).toBe(observedInfoTestlet(t, 0.3, items))
    // the same numbers as the bank reference (hb.calib.irt), printed by the Python implementation
    close(observationLoglik(o, t), -1.5879781401467614, 1e-12)
    close(observationScore(o, t), 0.39121693114076733, 1e-12)
    close(observationInfo(o, t), 0.7159513496185569, 1e-12)
    close(observationObservedInfo(o, t), 0.7148696646003072, 1e-12)
  })
})
