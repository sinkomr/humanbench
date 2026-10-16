import { describe, expect, it } from 'vitest'
import { PART_MIN_ITEMS } from '../engine/plan-table'
import { LR_ET_BY_STRATUM, budgetedPart, criterionStudy, formatCriterion } from './criterion'
import { simulatePoolPart, textPool } from './startup'

describe('a part under its time rule (budgetedPart)', () => {
  it('asks while the budget lasts, and at least the minimum of six', () => {
    expect(PART_MIN_ITEMS).toBe(6)
    // 40 s questions, 360 s: nine fit (the ninth starts at 320 s)
    expect(budgetedPart(Array(12).fill(40), 360, 1)).toEqual({ questions: 9, seconds: 360 })
    // 100 s questions: the minimum decides, past the budget
    expect(budgetedPart(Array(12).fill(100), 360, 1)).toEqual({ questions: 6, seconds: 600 })
    // a slower taker: fewer questions, each longer
    expect(budgetedPart(Array(12).fill(40), 360, 1.25)).toEqual({ questions: 8, seconds: 400 })
    // never more than the run has
    expect(budgetedPart([10, 10], 360, 1)).toEqual({ questions: 2, seconds: 20 })
  })
})

describe('the stand-in Logical Reasoning pool', () => {
  it('has the bank’s expected times by stratum, and the two criteria rank alike when every item takes the same time', () => {
    const pool = textPool(10, LR_ET_BY_STRATUM)
    expect(pool.filter((it) => it.b === 3).every((it) => it.et === 114)).toBe(true)
    expect(pool.filter((it) => it.b === -2).every((it) => it.et === 41)).toBe(true)
    const flat = textPool(40, 15)
    for (const theta of [0, 2.5]) {
      const a = simulatePoolPart(flat, 'LR', theta, 'flat', 8, true, 5, 0)
      const b = simulatePoolPart(flat, 'LR', theta, 'flat', 8, true, 5, 1)
      expect(a.served).toEqual(b.served)
    }
  })
})

describe('information alone against information per second (owner decision 2026-10-16)', () => {
  it('a strong taker gets harder questions with information alone, on a text part whose hard items take longer', () => {
    const s = criterionStudy('LR', { perTheta: 30, items: 8, population: 60, thetas: [2.5] })
    const [before] = s.before
    const [after] = s.after
    const late = (r: typeof before): number => r!.meanB.slice(4).reduce((t, b) => t + b, 0) / 4
    expect(late(after)).toBeGreaterThan(late(before) + 0.2)
    expect(after!.shareHard).toBeGreaterThan(before!.shareHard)
    expect(after!.minutes).toBeGreaterThan(before!.minutes) // and those questions take longer
    expect(s.length!.map((l) => l.pace)).toEqual([1, 1.25])
    expect(formatCriterion(s)).toContain('part length at θ  2.50, pace 1.25')
  })

  it('a device part (Matrix & Series) through the real selector: harder after the start-up', () => {
    const s = criterionStudy('MAT', { perTheta: 12, items: 8, population: 20, thetas: [2.5] })
    const late = (r: (typeof s.before)[number]): number => r.meanB.slice(4).reduce((t, b) => t + b, 0) / 4
    expect(late(s.after[0]!)).toBeGreaterThan(late(s.before[0]!))
    expect(s.length).toBeUndefined()
  })
})
