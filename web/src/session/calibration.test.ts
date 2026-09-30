import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { brierOfAnswer, confidenceFloorPct, confidenceStartPct, isConfidencePct } from './calibration'

describe('the confidence slider range (DESIGN §3 row 12, §14.6 ex. 9)', () => {
  it('floors at the chance level 1/k for multiple choice and at 0 for typed entry', () => {
    expect(confidenceFloorPct(undefined)).toBe(0)
    expect(confidenceFloorPct(2)).toBe(50)
    expect(confidenceFloorPct(4)).toBe(25)
    expect(confidenceFloorPct(5)).toBe(20)
    expect(confidenceFloorPct(6)).toBe(17) // 16.67 rounded up: never below chance
    expect(() => confidenceFloorPct(1)).toThrow(RangeError)
    expect(() => confidenceFloorPct(2.5)).toThrow(RangeError)
  })

  it('never offers a confidence below 1/k (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 9 }), (k) => {
        expect(confidenceFloorPct(k) / 100).toBeGreaterThanOrEqual(1 / k)
      }),
    )
  })

  it('starts in the middle of the range, on the step', () => {
    expect(confidenceStartPct(0)).toBe(50)
    expect(confidenceStartPct(25)).toBe(63)
    for (const f of [0, 17, 20, 25, 50]) {
      const s = confidenceStartPct(f)
      expect(s).toBeGreaterThanOrEqual(f)
      expect(s).toBeLessThanOrEqual(100)
      expect(Number.isInteger(s)).toBe(true)
    }
  })

  it('accepts only whole percents from the floor to 100', () => {
    expect(isConfidencePct(25, 25)).toBe(true)
    expect(isConfidencePct(100, 25)).toBe(true)
    for (const bad of [24, 101, 50.5, Number.NaN, '50', null, undefined]) expect(isConfidencePct(bad, 25), String(bad)).toBe(false)
    expect(isConfidencePct(0, 0)).toBe(true)
  })
})

describe('Brier score of an answer', () => {
  it('matches the DESIGN §14.6 ex. 9 worked cases: c = 0.9, y = 0 → 0.81; c = 0.6, y = 1 → 0.16', () => {
    expect(brierOfAnswer(90, 0)).toBeCloseTo(0.81, 12)
    expect(brierOfAnswer(60, 1)).toBeCloseTo(0.16, 12)
    expect(brierOfAnswer(100, 1)).toBe(0)
    expect(brierOfAnswer(0, 1)).toBe(1)
  })

  it('the Brier of any answer is in [0, 1] (property)', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 100 }), fc.constantFrom<0 | 1>(0, 1), (pct, y) => {
      const b = brierOfAnswer(pct, y)
      expect(b).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThanOrEqual(1)
    }))
  })
})
