import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  axis,
  AXES,
  AXIS_CODES,
  AXIS_INDEX,
  CLUSTERS,
  initialCorrelation,
  initialSigma,
  isAxisCode,
  N_AXES,
  nearestPD,
  rawInitialSigma,
  SIGMA_EIGEN_FLOOR,
  TIER_GLYPH,
  type AxisCode,
} from './axes'
import { isPositiveDefinite, isSymmetric, maxAbsDiff, symmetricEigen, tryCholesky } from './linalg'

const r = (a: AxisCode, b: AxisCode): number => {
  const S = initialSigma()
  return S[AXIS_INDEX[a]]![AXIS_INDEX[b]]!
}

describe('axis registry (DESIGN §3)', () => {
  it('has the 17 axes in the canonical order', () => {
    expect(N_AXES).toBe(17)
    expect(AXES.map((a) => a.code)).toEqual([
      'MAT', 'LR', 'LG', 'RC', 'VOC', 'QR', 'SPA', 'WM', 'RT', 'PS', 'FER', 'CAL', 'KST', 'KHU', 'KAP', 'EMO', 'CRE',
    ])
    expect(AXES.map((a) => a.code)).toEqual([...AXIS_CODES])
    AXES.forEach((a, i) => {
      expect(a.index).toBe(i)
      expect(AXIS_INDEX[a.code]).toBe(i)
      expect(axis(a.code)).toBe(a)
    })
  })

  it('matches the shared axis spec row by row', () => {
    const spec = AXES.map((a) => [a.code, a.name, a.cluster, a.chc, a.tier, a.modelKind, a.status].join(' | '))
    expect(spec).toEqual([
      'MAT | Matrix & Series | Reasoning | Gf | a | 2pl | active',
      'LR | Logical Reasoning | Reasoning | Gf-verbal | a | 3pl | active',
      'LG | Analytical/Logic Games | Reasoning | Gf-RQ | a | 2pl_testlet | active',
      'RC | Reading Comprehension | Verbal | Grw | a | 2pl_testlet | active',
      'VOC | Vocabulary & Verbal Analogies | Verbal | Gc | a | 2pl | active',
      'QR | Quantitative Reasoning | Quantitative | Gq/RQ | a | 2pl | active',
      'SPA | Spatial | Spatial/Memory | Gv | a | 2pl | active',
      'WM | Working Memory | Spatial/Memory | Gwm | b | grm | active',
      'RT | Reaction Time | Speed | Gt | b | gaussian | active',
      'PS | Processing & Reading Speed | Speed | Gs | b | gaussian | active',
      'FER | Fermi Estimation | Estimation | Gq×Gkn | b | gaussian | active',
      'CAL | Calibration/Metacognition | Estimation | metacognition | b | gaussian | active',
      'KST | STEM Knowledge | Knowledge | Gkn | a | 2pl | active',
      'KHU | Humanities Knowledge | Knowledge | Gkn | a | 2pl | active',
      'KAP | Arts & Practical Knowledge | Knowledge | Gkn | a | 2pl | active',
      'EMO | Emotion Reading (text scenarios) | Social-Creative | Gei | c | 2pl | v2',
      'CRE | Creative Thinking | Social-Creative | Gr/Gi | c | 2pl | v2',
    ])
  })

  it('assigns glyphs by tier and flags Calibration as embedded', () => {
    expect(TIER_GLYPH).toEqual({ a: '', b: '○', c: '◇' })
    for (const a of AXES) expect(a.glyph).toBe(TIER_GLYPH[a.tier])
    expect(axis('WM').glyph).toBe('○')
    expect(axis('EMO').glyph).toBe('◇')
    expect(axis('MAT').glyph).toBe('')
    expect(AXES.filter((a) => a.embedded).map((a) => a.code)).toEqual(['CAL'])
    expect(AXES.filter((a) => a.status === 'v2').map((a) => a.code)).toEqual(['EMO', 'CRE'])
  })

  it('lists clusters in first-appearance order and every axis uses one', () => {
    expect([...new Set(AXES.map((a) => a.cluster))]).toEqual([...CLUSTERS])
  })

  it('is frozen', () => {
    expect(Object.isFrozen(AXES)).toBe(true)
    expect(Object.isFrozen(AXES[0])).toBe(true)
  })

  it('isAxisCode accepts exactly the 17 codes', () => {
    for (const c of AXIS_CODES) expect(isAxisCode(c)).toBe(true)
    for (const bad of ['mat', 'SPATIAL', '', 'toString', '__proto__', 3, null, undefined]) {
      expect(isAxisCode(bad)).toBe(false)
    }
  })
})

describe('initial Σ (DESIGN §3, §7.2)', () => {
  it('is 17×17, symmetric with unit diagonal', () => {
    const S = initialSigma()
    expect(S).toHaveLength(17)
    for (const row of S) expect(row).toHaveLength(17)
    expect(isSymmetric(S)).toBe(true)
    S.forEach((row, i) => expect(row[i]).toBe(1))
  })

  it('follows the precedence rules (spot checks)', () => {
    expect(r('MAT', 'LR')).toBe(0.55) // same cluster (Reasoning)
    expect(r('MAT', 'KST')).toBe(0.45) // Reasoning ↔ Knowledge
    expect(r('KHU', 'LG')).toBe(0.45)
    expect(r('RT', 'PS')).toBe(0.55) // Speed, same cluster
    expect(r('RT', 'MAT')).toBe(0.2) // Speed ↔ other
    expect(r('CAL', 'FER')).toBe(0.2) // CAL beats same cluster
    expect(r('CAL', 'RT')).toBe(0.2)
    expect(r('CAL', 'EMO')).toBe(0.2) // CAL beats Social-Creative
    expect(r('PS', 'EMO')).toBe(0.2) // Speed beats Social-Creative
    expect(r('EMO', 'CRE')).toBe(0.55) // Social-Creative, same cluster
    expect(r('EMO', 'MAT')).toBe(0.3) // Social-Creative ↔ other
    expect(r('SPA', 'RC')).toBe(0.4) // default [SPEC]
    expect(r('SPA', 'WM')).toBe(0.55)
    expect(r('KST', 'KAP')).toBe(0.55)
    expect(r('QR', 'FER')).toBe(0.4)
  })

  it('matches an independently written 17×17 matrix on all 289 pairs', () => {
    // Written out from the shared spec rules (×100), not generated from initialCorrelation.
    // prettier-ignore
    const expected100 = [
      //        MAT   LR   LG   RC  VOC   QR  SPA   WM   RT   PS  FER  CAL  KST  KHU  KAP  EMO  CRE
      /* MAT */ [100,  55,  55,  40,  40,  40,  40,  40,  20,  20,  40,  20,  45,  45,  45,  30,  30],
      /*  LR */ [ 55, 100,  55,  40,  40,  40,  40,  40,  20,  20,  40,  20,  45,  45,  45,  30,  30],
      /*  LG */ [ 55,  55, 100,  40,  40,  40,  40,  40,  20,  20,  40,  20,  45,  45,  45,  30,  30],
      /*  RC */ [ 40,  40,  40, 100,  55,  40,  40,  40,  20,  20,  40,  20,  40,  40,  40,  30,  30],
      /* VOC */ [ 40,  40,  40,  55, 100,  40,  40,  40,  20,  20,  40,  20,  40,  40,  40,  30,  30],
      /*  QR */ [ 40,  40,  40,  40,  40, 100,  40,  40,  20,  20,  40,  20,  40,  40,  40,  30,  30],
      /* SPA */ [ 40,  40,  40,  40,  40,  40, 100,  55,  20,  20,  40,  20,  40,  40,  40,  30,  30],
      /*  WM */ [ 40,  40,  40,  40,  40,  40,  55, 100,  20,  20,  40,  20,  40,  40,  40,  30,  30],
      /*  RT */ [ 20,  20,  20,  20,  20,  20,  20,  20, 100,  55,  20,  20,  20,  20,  20,  20,  20],
      /*  PS */ [ 20,  20,  20,  20,  20,  20,  20,  20,  55, 100,  20,  20,  20,  20,  20,  20,  20],
      /* FER */ [ 40,  40,  40,  40,  40,  40,  40,  40,  20,  20, 100,  20,  40,  40,  40,  30,  30],
      /* CAL */ [ 20,  20,  20,  20,  20,  20,  20,  20,  20,  20,  20, 100,  20,  20,  20,  20,  20],
      /* KST */ [ 45,  45,  45,  40,  40,  40,  40,  40,  20,  20,  40,  20, 100,  55,  55,  30,  30],
      /* KHU */ [ 45,  45,  45,  40,  40,  40,  40,  40,  20,  20,  40,  20,  55, 100,  55,  30,  30],
      /* KAP */ [ 45,  45,  45,  40,  40,  40,  40,  40,  20,  20,  40,  20,  55,  55, 100,  30,  30],
      /* EMO */ [ 30,  30,  30,  30,  30,  30,  30,  30,  20,  20,  30,  20,  30,  30,  30, 100,  55],
      /* CRE */ [ 30,  30,  30,  30,  30,  30,  30,  30,  20,  20,  30,  20,  30,  30,  30,  55, 100],
    ]
    const S = initialSigma()
    for (const [i, a] of AXIS_CODES.entries()) {
      for (const [j, b] of AXIS_CODES.entries()) {
        const want = expected100[i]![j]! / 100
        expect(initialCorrelation(a, b), `${a}↔${b}`).toBe(want)
        expect(initialCorrelation(b, a), `${b}↔${a}`).toBe(want)
        expect(S[i]![j], `Σ[${a}][${b}]`).toBe(want)
      }
    }
  })

  it('is positive definite with every eigenvalue above the floor', () => {
    const S = initialSigma()
    expect(tryCholesky(S)).not.toBeNull()
    expect(isPositiveDefinite(S)).toBe(true)
    expect(symmetricEigen(S).values[0]).toBeGreaterThan(SIGMA_EIGEN_FLOOR)
  })

  it('nearestPD leaves it unchanged (bit for bit)', () => {
    const raw = rawInitialSigma()
    expect(nearestPD(raw)).toEqual(raw)
    expect(initialSigma()).toEqual(raw)
  })

  it('returns a fresh copy on every call', () => {
    const S = initialSigma()
    S[0]![1] = 99
    expect(initialSigma()[0]![1]).toBe(0.55)
  })
})

describe('nearestPD', () => {
  it('repairs a non-PD correlation matrix', () => {
    // Pairwise-plausible but jointly impossible correlations: eigenvalues 1.9, 1.9, −0.8.
    const bad = [
      [1, 0.9, -0.9],
      [0.9, 1, 0.9],
      [-0.9, 0.9, 1],
    ]
    expect(tryCholesky(bad)).toBeNull()
    const fixed = nearestPD(bad)
    expect(isSymmetric(fixed)).toBe(true)
    fixed.forEach((row, i) => expect(row[i]).toBe(1))
    expect(tryCholesky(fixed)).not.toBeNull()
    expect(symmetricEigen(fixed).values[0]).toBeGreaterThan(0)
    for (const row of fixed) for (const v of row) expect(Math.abs(v)).toBeLessThanOrEqual(1)
    // The sign pattern survives.
    expect(fixed[0]![1]).toBeGreaterThan(0)
    expect(fixed[0]![2]).toBeLessThan(0)
  })

  it('symmetrises an asymmetric input and rescales a covariance to a correlation', () => {
    const cov = [
      [4, 1.2],
      [0.8, 1],
    ]
    const out = nearestPD(cov)
    expect(maxAbsDiff(out, [
      [1, 0.5],
      [0.5, 1],
    ])).toBeLessThan(1e-15)
  })

  it('produces a PD unit-diagonal matrix from any random symmetric matrix', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 17 }).chain((n) =>
          fc.array(fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: n, maxLength: n }), {
            minLength: n,
            maxLength: n,
          }),
        ),
        (B) => {
          const out = nearestPD(B)
          expect(isSymmetric(out)).toBe(true)
          out.forEach((row, i) => expect(row[i]).toBe(1))
          expect(tryCholesky(out)).not.toBeNull()
          expect(symmetricEigen(out).values[0]).toBeGreaterThan(0)
          for (const row of out) for (const v of row) expect(Math.abs(v)).toBeLessThanOrEqual(1)
        },
      ),
      { numRuns: 200 },
    )
  })

  it('rejects bad input', () => {
    expect(() => nearestPD([])).toThrow(RangeError)
    expect(() => nearestPD([[1, 0]])).toThrow(RangeError)
    expect(() => nearestPD([[Number.NaN]])).toThrow(RangeError)
    expect(() => nearestPD([[1]], 0)).toThrow(RangeError)
  })
})
