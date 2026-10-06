import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { AXES, AXIS_CODES, N_AXES } from '../engine/axes'
import { scoreAll } from '../engine/scorer'
import { Z90 } from './geometry'
import { axisEstimates, COMPACT_LABELS, interval90, measuredFields, stubLabel } from './profile'
import { notMeasuredText } from './copy'
import { spokeOrder } from './seriation'
import { syntheticProfile } from './synthetic'

const m1 = syntheticProfile('m1')!
const full = syntheticProfile('full')!

describe('axisEstimates (§9, A12, A15)', () => {
  it('always returns all 17 spokes, in the pinned spoke order', () => {
    for (const p of [m1, full, syntheticProfile('sparse')!]) {
      const est = axisEstimates(p.input)
      expect(est.map((e) => e.code)).toEqual([...spokeOrder()])
      expect(est).toHaveLength(N_AXES)
    }
    // Even with no observations at all: 17 "not measured" stubs.
    const none = axisEstimates({ score: scoreAll([]) })
    expect(none).toHaveLength(17)
    expect(none.every((e) => !e.measured && e.theta === undefined)).toBe(true)
  })

  it('marks an axis measured iff it has observations and was not skipped, with the stub reason', () => {
    const est = axisEstimates(m1.input)
    const observed = new Set(Object.keys(m1.input.score.eap))
    for (const e of est) {
      expect(e.measured).toBe(observed.has(e.code))
      if (!e.measured) {
        expect(e.reason).toBe(AXES.find((a) => a.code === e.code)!.status === 'v2' ? 'not_yet_available' : 'no_data')
        expect(e.theta).toBeUndefined()
      }
    }
    const skipped = axisEstimates(syntheticProfile('skipped')!.input).find((e) => e.code === 'SPA')!
    expect(skipped).toMatchObject({ measured: false, reason: 'skipped' })
    expect(stubLabel('skipped')).toBe('not measured')
    expect(stubLabel('insufficient_data')).toBe('insufficient data')
  })

  it('takes θ and SD from the correlated MAP and Laplace covariance', () => {
    for (const e of axisEstimates(full.input)) {
      const k = AXIS_CODES.indexOf(e.code)
      expect(e.theta).toBe(full.input.score.theta[k])
      expect(e.sd).toBe(Math.sqrt(full.input.score.cov[k]![k]!))
      expect(e.lo90).toBeCloseTo(e.theta! - Z90 * e.sd!, 12)
      expect(e.hi90).toBeCloseTo(e.theta! + Z90 * e.sd!, 12)
    }
  })

  it('mutes exactly the spokes whose 90% interval contains θ = 0 (§9.5, A12)', () => {
    fc.assert(
      fc.property(fc.double({ min: -4, max: 4, noNaN: true }), fc.double({ min: 0, max: 3, noNaN: true }), (theta, sd) => {
        const { lo90, hi90, relation } = interval90(theta, sd)
        const excludesZero = lo90 > 0 || hi90 < 0
        expect(relation === 'overlaps').toBe(!excludesZero)
        if (relation === 'above') expect(lo90).toBeGreaterThan(0)
        if (relation === 'below') expect(hi90).toBeLessThan(0)
      }),
    )
    for (const e of axisEstimates(full.input)) if (e.measured) expect(e.muted).toBe(e.lo90! <= 0 && e.hi90! >= 0)
    expect(() => interval90(Number.NaN, 1)).toThrow(RangeError)
  })

  it('validates the scorer output', () => {
    const s = m1.input.score
    expect(() => axisEstimates({ score: { ...s, theta: s.theta.slice(1) } })).toThrow(RangeError)
    expect(() => axisEstimates({ score: { ...s, eap: { ...s.eap, XYZ: { mean: 0, sd: 1 } } as typeof s.eap } })).toThrow(RangeError)
  })
})


describe('axes this build never offers (UX-048a)', () => {
  const input = m1.input
  const offered = new Set(['RT', 'MAT', 'SPA', 'WM', 'QR', 'PS', 'CAL'] as const)
  const byCode = (est: ReturnType<typeof axisEstimates>, code: string) => est.find((e) => e.code === code)!

  it('without `offered` nothing changes: only a v2 axis is "not offered yet"', () => {
    const est = axisEstimates(input)
    expect(byCode(est, 'LR')).toMatchObject({ measured: false, reason: 'no_data' })
    expect(byCode(est, 'EMO')).toMatchObject({ measured: false, reason: 'not_yet_available' })
    expect(axisEstimates({ ...input, offered: undefined })).toEqual(est)
  })

  it('an axis outside `offered` that has no data is "not offered yet"; one inside it with none stays "no data"', () => {
    const est = axisEstimates({ ...input, offered })
    for (const code of ['LR', 'LG', 'RC', 'VOC', 'FER', 'KST', 'KHU', 'KAP', 'EMO', 'CRE']) {
      expect(byCode(est, code), code).toMatchObject({ measured: false, reason: 'not_yet_available' })
      expect(notMeasuredText(byCode(est, code).reason)).toBe('Not measured (not offered yet)')
    }
    // An offered axis that simply has no observations keeps "no data": give the m1 profile one it lacks.
    const sparse = axisEstimates({ score: syntheticProfile('sparse')!.input.score, offered })
    expect(byCode(sparse, 'WM')).toMatchObject({ measured: false, reason: 'no_data' })
    expect(notMeasuredText(byCode(sparse, 'WM').reason)).toBe('Not measured')
  })

  it('a skipped axis stays skipped and a measured axis stays measured, offered or not', () => {
    const skipped = axisEstimates({ ...syntheticProfile('skipped')!.input, offered })
    expect(byCode(skipped, 'SPA')).toMatchObject({ measured: false, reason: 'skipped' })
    const notOffered = axisEstimates({ ...syntheticProfile('skipped')!.input, skipped: ['LR'], offered: new Set(['MAT']) })
    expect(byCode(notOffered, 'LR')).toMatchObject({ reason: 'skipped' })
    // Observed axes outside `offered` are still drawn: the score is what the person did.
    expect(byCode(axisEstimates({ ...input, offered: new Set(['MAT']) }), 'QR').measured).toBe(true)
  })
})

describe('compact chart labels (UX-042)', () => {
  it('are the exact short names, each a cut of its table name', () => {
    expect(COMPACT_LABELS).toEqual({
      MAT: 'Matrix & Series',
      LR: 'Logical',
      LG: 'Logic games',
      RC: 'Reading comp.',
      VOC: 'Vocabulary',
      QR: 'Quantitative',
      SPA: 'Spatial',
      WM: 'Working mem.',
      RT: 'Reaction',
      PS: 'Processing',
      FER: 'Fermi',
      CAL: 'Calibration',
      KST: 'STEM',
      KHU: 'Humanities',
      KAP: 'Arts & practical',
      EMO: 'Emotion',
      CRE: 'Creative',
    })
  })
})

describe('where an estimate lies against the drawn scale (UX-037)', () => {
  it('every measured estimate records it; a stub has none', () => {
    for (const e of axisEstimates(full.input)) expect(e.offScale).toBe(e.measured ? (e.theta! < -2.76 ? 'low' : e.theta! > 3 ? 'high' : 'none') : undefined)
    expect(measuredFields(-3.5, 0.2).offScale).toBe('low')
  })
})
