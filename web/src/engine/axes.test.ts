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
  NEAREST_PD_TOL,
  nearestPD,
  R_LITERATURE,
  rawInitialSigma,
  SIGMA_EIGEN_FLOOR,
  SIGMA_NEAREST_PD_CHANGED,
  SIGMA_VERSION,
  TIER_GLYPH,
  type AxisCode,
} from './axes'
import { isPositiveDefinite, isSymmetric, maxAbsDiff, symmetricEigen, tryCholesky } from './linalg'
// Bank golden files, copied by scripts/sync-golden.sh (ROADMAP A17).
import scoringV1Text from './__fixtures__/scoring_v1.json?raw'
import sigmaV2Text from './__fixtures__/sigma_v2.json?raw'

interface SigmaDoc {
  sigma_version: string
  axes: string[]
  sigma: number[][]
}
interface NearestPDCase {
  id: string
  floor: number
  input: number[][]
  output: number[][]
}
const sigmaV2 = JSON.parse(sigmaV2Text) as SigmaDoc
const scoringV1 = JSON.parse(scoringV1Text) as SigmaDoc & { version: string; nearest_pd: NearestPDCase[] }

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
      'LR | Logical Reasoning | Reasoning | Gf-verbal | a | 2pl | active',
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

  it('models LR as 2PL (A9: k ≤ 4 options → 3PL c = 1/k; k ≥ 5 or numeric entry → 2PL)', () => {
    expect(axis('LR').modelKind).toBe('2pl')
    expect(AXES.filter((a) => a.modelKind === '3pl')).toEqual([])
  })

  it('is frozen', () => {
    expect(Object.isFrozen(AXES)).toBe(true)
    expect(Object.isFrozen(AXES[0])).toBe(true)
    // The Σ rule table too, tuples included: the pinned Σ cannot drift under one SIGMA_VERSION.
    expect(Object.isFrozen(R_LITERATURE)).toBe(true)
    for (const pair of R_LITERATURE) expect(Object.isFrozen(pair)).toBe(true)
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

  it('is pinned as sigma-v2-2026-09-26', () => {
    expect(SIGMA_VERSION).toBe('sigma-v2-2026-09-26')
  })

  // Rule (1) of Σ_init v2 (ROADMAP A8): every pair of the §3 expected-r table, at its midpoint.
  // Written out from A8, not derived from R_LITERATURE.
  const literaturePairs: [AxisCode, AxisCode, number][] = [
    ['MAT', 'QR', 0.6],
    ['MAT', 'LG', 0.6], // beats same cluster (.55)
    ['MAT', 'SPA', 0.5],
    ['RC', 'VOC', 0.6], // beats same cluster (.55)
    ['RC', 'KHU', 0.6],
    ['VOC', 'KHU', 0.6],
    ['LR', 'RC', 0.6],
    ['WM', 'MAT', 0.4],
    ['WM', 'LR', 0.4],
    ['WM', 'LG', 0.4],
    ['RT', 'MAT', 0.28], // beats Speed (.20)
    ['RT', 'LR', 0.28],
    ['RT', 'LG', 0.28],
    ['PS', 'RC', 0.3], // beats Speed (.20)
    ['FER', 'QR', 0.4],
    ['FER', 'KST', 0.4],
    ['EMO', 'VOC', 0.4], // beats Social-Creative (.30)
    ['EMO', 'KHU', 0.4],
    ['CRE', 'MAT', 0.23], // beats Social-Creative (.30)
    ['CRE', 'LR', 0.23],
    ['CRE', 'LG', 0.23],
    ['CRE', 'RC', 0.23],
    ['CRE', 'VOC', 0.23],
    ['CRE', 'QR', 0.23],
    ['CRE', 'SPA', 0.23],
    ['CRE', 'WM', 0.23],
    ['CRE', 'FER', 0.23],
    ['CRE', 'KST', 0.23],
    ['CRE', 'KHU', 0.23],
    ['CRE', 'KAP', 0.23],
  ]

  // One pair per branch of rules (2) and (3), plus the precedence between them (same as bank).
  const rulePairs: [AxisCode, AxisCode, number, string][] = [
    ['CAL', 'FER', 0.2, '(2) CAL, beats same cluster'],
    ['CAL', 'RT', 0.2, '(2) CAL before Speed'],
    ['CAL', 'CRE', 0.2, '(2) CAL before Social-Creative'],
    ['PS', 'MAT', 0.2, '(2) exactly one in Speed'],
    ['RT', 'EMO', 0.2, '(2) Speed before Social-Creative'],
    ['RT', 'CRE', 0.2, '(2) Speed before Social-Creative'],
    ['EMO', 'MAT', 0.3, '(2) exactly one in Social-Creative'],
    ['CRE', 'EMO', 0.55, '(2) same cluster, Social-Creative'],
    ['RT', 'PS', 0.55, '(2) same cluster, Speed'],
    ['SPA', 'WM', 0.55, '(2) same cluster'],
    ['KST', 'KAP', 0.55, '(2) same cluster'],
    ['LR', 'LG', 0.55, '(2) same cluster'],
    ['MAT', 'KST', 0.45, '(2) Reasoning ↔ Knowledge'],
    ['KHU', 'LG', 0.45, '(2) Reasoning ↔ Knowledge'],
    ['SPA', 'RC', 0.35, '(3) otherwise'],
    ['QR', 'KHU', 0.35, '(3) otherwise'],
    ['FER', 'KAP', 0.35, '(3) otherwise'],
  ]

  it.each(literaturePairs)('rule (1): %s ↔ %s = %s', (a, b, want) => {
    expect(r(a, b)).toBe(want)
    expect(r(b, a)).toBe(want)
    expect(initialCorrelation(a, b)).toBe(want)
    expect(initialCorrelation(b, a)).toBe(want)
  })

  it.each(rulePairs)('rules (2)/(3): %s ↔ %s = %s %s', (a, b, want) => {
    expect(r(a, b)).toBe(want)
    expect(r(b, a)).toBe(want)
    expect(initialCorrelation(a, b)).toBe(want)
    expect(initialCorrelation(b, a)).toBe(want)
  })

  it('lists exactly the 30 A8 literature pairs, none with CAL', () => {
    const key = (a: string, b: string): string => [a, b].sort().join('|')
    const got = new Map(R_LITERATURE.map(([a, b, v]) => [key(a, b), v]))
    const want = new Map(literaturePairs.map(([a, b, v]) => [key(a, b), v]))
    expect(R_LITERATURE).toHaveLength(30)
    expect(got).toEqual(want)
    expect(R_LITERATURE.some(([a, b]) => a === 'CAL' || b === 'CAL')).toBe(false)
  })

  it('uses only the A8 values off the diagonal, with CAL at .20 to every axis', () => {
    const S = initialSigma()
    const off = new Set(S.flatMap((row, i) => row.filter((_, j) => j !== i)))
    expect([...off].sort((x, y) => x - y)).toEqual([0.2, 0.23, 0.28, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6])
    expect(new Set(S[AXIS_INDEX.CAL])).toEqual(new Set([0.2, 1]))
  })

  it('equals bank golden/sigma_v2.json on all 289 entries (to 1e-12, and exactly)', () => {
    expect(sigmaV2.sigma_version).toBe(SIGMA_VERSION)
    expect(sigmaV2.axes).toEqual([...AXIS_CODES])
    const S = initialSigma()
    expect(sigmaV2.sigma).toHaveLength(17)
    for (const row of sigmaV2.sigma) expect(row).toHaveLength(17)
    expect(maxAbsDiff(S, sigmaV2.sigma)).toBeLessThanOrEqual(1e-12)
    // Σ v2 is not repaired by nearestPD, so both repos hold the very same doubles.
    expect(S).toEqual(sigmaV2.sigma)
  })

  it('equals the Σ and sigma_version pinned in bank golden/scoring_v1.json', () => {
    expect(scoringV1.version).toBe('scoring_v1')
    expect(scoringV1.sigma_version).toBe(SIGMA_VERSION)
    expect(scoringV1.axes).toEqual([...AXIS_CODES])
    expect(maxAbsDiff(initialSigma(), scoringV1.sigma)).toBeLessThanOrEqual(1e-12)
    expect(scoringV1.sigma).toEqual(sigmaV2.sigma)
  })

  it('is positive definite with every eigenvalue above the floor', () => {
    const S = initialSigma()
    expect(tryCholesky(S)).not.toBeNull()
    expect(isPositiveDefinite(S)).toBe(true)
    expect(symmetricEigen(S).values[0]).toBeGreaterThan(SIGMA_EIGEN_FLOOR)
  })

  it('nearestPD leaves it unchanged (bit for bit), as SIGMA_NEAREST_PD_CHANGED records', () => {
    const raw = rawInitialSigma()
    expect(symmetricEigen(raw).values[0]).toBeGreaterThan(SIGMA_EIGEN_FLOOR)
    const changed = maxAbsDiff(nearestPD(raw), raw) !== 0
    expect(changed).toBe(SIGMA_NEAREST_PD_CHANGED)
    expect(SIGMA_NEAREST_PD_CHANGED).toBe(false)
    expect(initialSigma()).toEqual(raw)
  })

  it('returns a fresh copy on every call', () => {
    const S = initialSigma()
    S[0]![1] = 99
    expect(initialSigma()[0]![1]).toBe(0.55)
  })
})

describe('nearestPD', () => {
  // Bank golden nearest_pd pairs (clip, rescale, shrink toward I; ROADMAP A8, §7.2).
  it.each(scoringV1.nearest_pd.map((c) => [c.id, c] as const))('matches bank nearest_pd: %s', (_id, c) => {
    expect(c.floor).toBe(SIGMA_EIGEN_FLOOR)
    const out = nearestPD(c.input, c.floor)
    expect(maxAbsDiff(out, c.output)).toBeLessThanOrEqual(1e-12)
    out.forEach((row, i) => expect(row[i]).toBe(1))
    expect(isSymmetric(out)).toBe(true)
    expect(symmetricEigen(out).values[0]).toBeGreaterThanOrEqual(c.floor - NEAREST_PD_TOL)
  })

  it('is idempotent on every golden output, bit for bit (as bank nearest_pd)', () => {
    for (const c of scoringV1.nearest_pd) {
      const once = nearestPD(c.input, c.floor)
      expect(nearestPD(once, c.floor)).toEqual(once)
    }
  })

  it('shrinks toward I when the rescaling leaves the smallest eigenvalue below the floor', () => {
    // Clipping lifts the diagonal above 1; rescaling back to 1 pulls λ_min below the floor again.
    const chain = [
      [1, 0.99, 0],
      [0.99, 1, 0.99],
      [0, 0.99, 1],
    ]
    const out = nearestPD(chain)
    expect(symmetricEigen(out).values[0]).toBeCloseTo(SIGMA_EIGEN_FLOOR, 12)
    expect(out[0]![1]).toBeGreaterThan(0)
    expect(nearestPD(out)).toEqual(out) // idempotent
  })

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
          expect(symmetricEigen(out).values[0]).toBeGreaterThanOrEqual(SIGMA_EIGEN_FLOOR - 1e-11)
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
    expect(() => nearestPD([[1]], 1)).toThrow(RangeError)
  })
})
