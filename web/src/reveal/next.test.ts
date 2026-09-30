import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { axisEstimates } from '../viz/profile'
import { syntheticProfile } from '../viz/synthetic'
import { AXIS_CODES, type AxisCode } from '../engine/axes'
import { FOCUS_TARGET_S, SPACING_DAYS, focusAxes, focusOptions, focusOptionsKey, fuzziestAxes, predictedShrinkage, projectedSe, shrinkagePercent, typicalSessions } from './next'

describe('predicted shrinkage (§7.6)', () => {
  it('reproduces the §7.6 SE table: 0.57, 0.44, 0.37, 0.33, 0.29, 0.25, 0.21 for 1, 2, 3, 4, 5, 7, 10 sessions', () => {
    const table: [number, number][] = [
      [1, 0.57],
      [2, 0.44],
      [3, 0.37],
      [4, 0.33],
      [5, 0.29],
      [7, 0.25],
      [10, 0.21],
    ]
    for (const [s, se] of table) expect(projectedSe(s)).toBeCloseTo(se, 2)
  })

  it('after one session a second tightens the blob by about a quarter (§10: "~25%")', () => {
    expect(predictedShrinkage(1)).toBeCloseTo(0.228, 3)
    expect(shrinkagePercent(1)).toBe(25)
    expect(shrinkagePercent(2)).toBe(15)
    expect(shrinkagePercent(3)).toBe(10)
  })

  it('always falls with more sessions, stays in [5, 30] percent and rounds to 5', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 60 }), (s) => {
        expect(predictedShrinkage(s + 1)).toBeLessThan(predictedShrinkage(s))
        const pct = shrinkagePercent(s)
        expect(pct % 5).toBe(0)
        expect(pct).toBeGreaterThanOrEqual(5)
        expect(pct).toBeLessThanOrEqual(30)
      }),
    )
  })

  it('refuses a negative or non-finite session count', () => {
    expect(() => projectedSe(-1)).toThrow(RangeError)
    expect(() => projectedSe(Number.NaN)).toThrow(RangeError)
  })

  it('advises at least a week between sessions and a 20-minute focus session (§10)', () => {
    expect(SPACING_DAYS).toBe(7)
    expect(FOCUS_TARGET_S).toBe(20 * 60)
  })
})

describe('fuzziest skills and focus options', () => {
  const est = axisEstimates(syntheticProfile('full')!.input)

  it('lists the measured skills by descending SD, three by default', () => {
    const f = fuzziestAxes(est)
    expect(f).toHaveLength(3)
    expect(f[0]!.sd).toBeGreaterThanOrEqual(f[1]!.sd)
    expect(f[1]!.sd).toBeGreaterThanOrEqual(f[2]!.sd)
    const measured = est.filter((e) => e.measured)
    expect(f[0]!.sd).toBe(Math.max(...measured.map((e) => e.sd!)))
    for (const x of f) expect(x.lo90).toBeLessThan(x.hi90)
  })

  it('never lists a skill that was not measured', () => {
    const input = syntheticProfile('full')!.input
    const partial = axisEstimates({ ...input, skipped: ['MAT', 'QR', 'SPA'] })
    const listed = fuzziestAxes(partial, 99)
    expect(listed.length).toBe(partial.filter((e) => e.measured).length)
    for (const x of listed) expect(partial.find((e) => e.code === x.code)!.measured).toBe(true)
    expect(listed.map((x) => x.code)).not.toContain('MAT')
  })

  it('offers the six A15 parts in session order and suggests those of the fuzziest skills', () => {
    const o = focusOptions(est)
    expect(o.map((x) => x.segment)).toEqual(['rt', 'matrix_series', 'spatial', 'memory', 'quant', 'coding_reading'])
    const fuzzy = new Set(fuzziestAxes(est).map((f) => f.code))
    for (const x of o) expect(x.suggested).toBe(x.axes.some((k) => fuzzy.has(k)))
    expect(o.some((x) => x.suggested)).toBe(true)
  })

  it('turns chosen parts into skills, without repeats', () => {
    const o = focusOptions(est)
    expect(focusAxes(o, new Set(['spatial', 'quant']))).toEqual(['SPA', 'QR'])
    expect(focusAxes(o, new Set())).toEqual([])
  })
})

describe('typicalSessions (the shrinkage line speaks for the profile)', () => {
  const next = (over: Partial<Record<AxisCode, number>>, base = 1): Record<AxisCode, number> => Object.fromEntries(AXIS_CODES.map((k) => [k, over[k] ?? base])) as Record<AxisCode, number>

  it('is the lower median of the sessions that took each measured skill (next test number − 1)', () => {
    expect(typicalSessions(next({}, 2), ['MAT', 'QR', 'VOC'])).toBe(1)
    expect(typicalSessions(next({}, 3), ['MAT', 'QR', 'VOC'])).toBe(2)
    // A focus session on two of five skills: most have had one session.
    expect(typicalSessions(next({ MAT: 3, QR: 3 }, 2), ['MAT', 'QR', 'VOC', 'RC', 'LG'])).toBe(1)
    // On three of five: most have had two.
    expect(typicalSessions(next({ MAT: 3, QR: 3, VOC: 3 }, 2), ['MAT', 'QR', 'VOC', 'RC', 'LG'])).toBe(2)
    // An even count takes the lower middle.
    expect(typicalSessions(next({ MAT: 3, QR: 3 }, 2), ['MAT', 'QR', 'VOC', 'RC'])).toBe(1)
  })

  it('counts only the measured skills, is at least 1 for one of them and 0 for none', () => {
    expect(typicalSessions(next({ SPA: 9 }, 2), ['MAT', 'QR'])).toBe(1)
    expect(typicalSessions(next({}, 1), ['MAT'])).toBe(1)
    expect(typicalSessions(next({}, 2), [])).toBe(0)
  })

  it('never exceeds the most sessions any measured skill has had', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 2, max: 12 }), { minLength: 1, maxLength: 17 }), (ords) => {
        const measured = AXIS_CODES.slice(0, ords.length)
        const n = typicalSessions(next(Object.fromEntries(measured.map((k, i) => [k, ords[i]!]))), measured)
        expect(n).toBeGreaterThanOrEqual(Math.min(...ords) - 1)
        expect(n).toBeLessThanOrEqual(Math.max(...ords) - 1)
      }),
    )
  })
})

describe('focusOptionsKey', () => {
  it('changes with the suggested parts and stays put otherwise', () => {
    const a = axisEstimates(syntheticProfile('full')!.input)
    const b = axisEstimates(syntheticProfile('full')!.input)
    expect(focusOptionsKey(focusOptions(a))).toBe(focusOptionsKey(focusOptions(b)))
    const opts = focusOptions(a)
    const flipped = opts.map((o, i) => (i === 0 ? { ...o, suggested: !o.suggested } : o))
    expect(focusOptionsKey(flipped)).not.toBe(focusOptionsKey(opts))
  })
})
