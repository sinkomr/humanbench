/**
 * The cross-skill start, simulated (`sim/xskill.ts`, `engine/xskill.ts`; owner request 2026-10-15; DESIGN §7.4):
 * small samples here; `npm run sim:cat -- --part d` prints the full tables.
 */

import { describe, expect, it } from 'vitest'
import { SESSION_AXES, formatXskill, groupRow, learnFirstOrder, simulateSession, toWithin, xPool, xskillStudy } from './xskill'

describe('the cross-skill study', () => {
  it('pools cover b −2.5 … 3.5 evenly, six strata', () => {
    const p = xPool('VOC', 10)
    expect(p).toHaveLength(60)
    expect(Math.min(...p.map((i) => i.b))).toBeCloseTo(-2.45, 9)
    expect(Math.max(...p.map((i) => i.b))).toBeCloseTo(3.45, 9)
  })

  it('a session serves each part its questions and counts the questions until one is within 0.5', () => {
    const s = simulateSession(new Array<number>(17).fill(0), 'unit', { borrow: 1 })
    expect(s.parts.map((p) => p.axis)).toEqual([...SESSION_AXES])
    for (const p of s.parts) expect(p.bs).toHaveLength(6)
    expect(s.obs).toHaveLength(60)
    expect(toWithin({ bs: [2, 1, 0.3], theta: 0 }, 6)).toBe(3)
    expect(toWithin({ bs: [2, 1], theta: -1 }, 6)).toBe(7)
  })

  it('the owner’s profile: later parts start near +2.5 with borrowing, at 0 without', () => {
    const before = groupRow('owner', 0, { n: 20 })
    const after = groupRow('owner', 1, { n: 20 })
    expect(before.firstGapLater).toBeCloseTo(2.5, 0)
    expect(after.firstGapLater).toBeLessThan(1.2)
    expect(after.toWithin).toBeLessThan(before.toWithin - 1)
  })

  it('the reported scores are no worse on the population, and a dip is not pulled toward the rest of the profile', () => {
    const p0 = groupRow('population', 0, { n: 60 })
    const p1 = groupRow('population', 1, { n: 60 })
    expect(p1.rmse).toBeLessThan(p0.rmse + 0.03)
    const d0 = groupRow('dip', 0, { n: 60 })
    const d1 = groupRow('dip', 1, { n: 60 })
    // the error on the dipped skill is the scoring model's own shrinkage, the same with and without borrowing
    expect(Math.abs(d1.spike!.bias - d0.spike!.bias)).toBeLessThan(0.1)
    expect(Math.abs(d1.spike!.rmse - d0.spike!.rmse)).toBeLessThan(0.1)
  })

  it('the order that learns most first is a fixed order of the same parts', () => {
    const o = learnFirstOrder()
    expect([...o].sort()).toEqual([...SESSION_AXES].sort())
    expect(learnFirstOrder()).toEqual(o)
  })

  it('formats a study', () => {
    const s = xskillStudy({ n: 3, borrows: [0, 1], groups: ['dip'] })
    const text = formatXskill(s)
    expect(text).toContain('dip')
    expect(text.split('\n')).toHaveLength(4)
  })
})
