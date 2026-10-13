/**
 * The start-up rule, simulated (`sim/startup.ts`, `engine/startup.ts`; owner feedback 2026-10-13;
 * DESIGN §7.4): what a taker meets with the rule and without it, and that the part's estimate is no
 * worse for it. Small samples here; `npm run sim:cat -- --part c` prints the full tables.
 */

import { describe, expect, it } from 'vitest'
import { formatStudy, simulatePoolPart, startupStudy, summarise, textPool } from './startup'

describe('a served text part over a pool shaped like the live banks (b = −2 … 3.25, a = 1)', () => {
  const study = startupStudy('TEXT', { perTheta: 120, population: 400, items: 10 })
  const at = (rows: typeof study.before, theta: number) => rows.find((r) => r.theta === theta)!

  it('without the rule a perfect record crawls, as in the owner’s session: stratum 3 for the first two questions, about +1 by the tenth', () => {
    const b = at(study.before, 2.5)
    expect(b.meanB[0]).toBe(0)
    expect(b.meanB[1]).toBe(0)
    expect(b.meanB[9]).toBeLessThan(1.8)
    expect(b.shareHardInFive).toBe(0) // nobody is shown a stratum 5 or 6 item in the first five
    // a taker who answers everything correctly: 0, 0, then stratum 4 at the earliest
    const perfect = simulatePoolPart(textPool(), 'VOC', 9, 'perfect', 10, false)
    expect(perfect.served.every((s) => s.y === 1)).toBe(true)
    expect(Math.max(...perfect.served.map((s) => s.b))).toBeLessThanOrEqual(2)
    expect(perfect.served.slice(0, 5).every((s) => s.b <= 1)).toBe(true)
  })

  it('with the rule a strong taker is shown stratum 5 or 6 within the first five questions, and the difficulty stays near them', () => {
    const a = at(study.after, 2.5)
    expect(a.shareHardInFive).toBeGreaterThan(0.6)
    expect(a.medianToWithin).not.toBeNull()
    expect(a.medianToWithin!).toBeLessThanOrEqual(4)
    expect(a.meanB[3]!).toBeGreaterThan(1.5)
    expect(a.meanB[9]!).toBeGreaterThan(at(study.before, 2.5).meanB[9]! + 0.3)
    expect(a.pCorrect).toBeLessThan(at(study.before, 2.5).pCorrect - 0.05)
    // a taker who answers everything correctly climbs a stratum a question to the top of the pool and stays
    const perfect = simulatePoolPart(textPool(), 'VOC', 9, 'perfect', 8, true)
    expect(perfect.served.map((s) => s.stratum)).toEqual([3, 4, 5, 6, 6, 6, 6, 6])
  })

  it('a weak taker steps down as quickly, and a middling one is where they were', () => {
    expect(at(study.after, -2).meanB[2]!).toBeLessThan(at(study.before, -2).meanB[2]! - 0.3)
    expect(at(study.after, -2).medianToWithin!).toBeLessThanOrEqual(4)
    for (let i = 0; i < 10; i++) expect(Math.abs(at(study.after, 0).meanB[i]!)).toBeLessThan(0.25)
  })

  it('the part’s estimate is no worse: r and RMSE over a N(0, 1) population agree before and after within sampling error', () => {
    const { before, after } = study.recovery
    expect(Math.abs(after.r - before.r)).toBeLessThan(0.04)
    expect(Math.abs(after.rmse - before.rmse)).toBeLessThan(0.05)
    expect(after.r).toBeGreaterThan(0.78)
    // and at the top, where the old selection had the largest error, it is not larger
    expect(at(study.after, 3).rmse).toBeLessThan(at(study.before, 3).rmse + 0.05)
  })

  it('prints as a table', () => {
    const text = formatStudy(study)
    expect(text).toContain('a served text part')
    expect(text.split('\n')).toHaveLength(2 + 2 * study.before.length + 1)
  })
})

describe('a device part through the real selector (Spatial)', () => {
  const study = startupStudy('SPA', { perTheta: 30, population: 60, items: 6, thetas: [0, 2.5] })

  it('with the rule a strong taker is shown a stratum 5 or 6 item in the first five; without it almost never', () => {
    expect(study.after[1]!.shareHardInFive).toBeGreaterThan(0.6)
    expect(study.before[1]!.shareHardInFive).toBeLessThan(0.2)
    expect(study.after[1]!.meanB[3]!).toBeGreaterThan(study.before[1]!.meanB[3]! + 0.8)
  })

  it('summarise reads a run: the first question within half a stratum, and the share correct', () => {
    const s = summarise(1, [{ theta: 1, served: [{ b: 0, stratum: 3, y: 1 }, { b: 1.2, stratum: 4, y: 0 }], estimate: [0.3, 0.2] }])
    expect(s).toMatchObject({ medianToWithin: 2, shareWithin: 1, shareHardInFive: 0, pCorrect: 0.5 })
    expect(s.bias).toBeCloseTo(-0.8, 12)
  })
})
