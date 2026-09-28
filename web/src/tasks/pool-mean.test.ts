/**
 * Pool anchoring of the difficulty priors (ROADMAP M1.P, DESIGN §6.ii step 5): an ICAR mean p
 * anchors the POOL of its family, so each ICAR-anchored family's natural pool (`generate(seed)`
 * without a requested stratum) has mean b within 0.1 of −logit(p) at n = 2,000 (rotation
 * p = .19, matrix p = .52, series p = .59). Quant has no ICAR anchor (ICAR has no quantitative
 * items) and keeps the default band centres; blocks keep their A10 norms. Every family's items
 * sit in the default band of their b (the M1.P contract rule), and every family has an E[T] model
 * (§7.4). The bank's `tests/gen/test_pool_mean.py` runs the same checks on the Python twins.
 */

import { describe, expect, it } from 'vitest'
import type { AnyFamily } from './family'
import { ICAR_ANCHORED_FAMILIES, ICAR_ANCHOR_B, POOL_MEAN_N, POOL_MEAN_TOL, STRATUM_B_CUTS, stratumOfB } from './priors'
import { FAMILIES } from './registry'

function pool(family: AnyFamily, n = POOL_MEAN_N): { meanB: number; meanT: number; strata: Set<number>; bad: string[] } {
  let sumB = 0
  let sumT = 0
  const strata = new Set<number>()
  const bad: string[] = []
  for (let i = 0; i < n; i++) {
    const item = family.generate(`pool-${i}`)
    sumB += item.difficulty.b_prior
    sumT += item.expected_time_s
    strata.add(item.stratum)
    if (stratumOfB(item.difficulty.b_prior) !== item.stratum) bad.push(item.item_id)
  }
  return { meanB: sumB / n, meanT: sumT / n, strata, bad }
}

describe('pool anchoring of the v0 priors (M1.P)', () => {
  it('anchors exactly the three ICAR item types', () => {
    expect(ICAR_ANCHORED_FAMILIES).toEqual({ rotation: 'rotation', matrices: 'matrix', series: 'series' })
    expect(POOL_MEAN_N).toBe(2_000)
    expect(POOL_MEAN_TOL).toBe(0.1)
    expect(ICAR_ANCHOR_B.rotation).toBeCloseTo(1.45, 2)
    expect(ICAR_ANCHOR_B.matrix).toBeCloseTo(-0.08, 2)
    expect(ICAR_ANCHOR_B.series).toBeCloseTo(-0.364, 3)
  })

  it.each(Object.entries(ICAR_ANCHORED_FAMILIES))('%s: the pool mean b is the ICAR %s anchor within 0.1 at n = 2,000', (name, type) => {
    const r = pool(FAMILIES[name] as AnyFamily)
    expect(Math.abs(r.meanB - ICAR_ANCHOR_B[type]), `${name} pool mean ${r.meanB}`).toBeLessThan(POOL_MEAN_TOL)
    expect(r.bad).toEqual([])
    expect(r.strata.size).toBeGreaterThanOrEqual(4) // the slopes keep the spread
  }, 120_000)

  it('quant has no ICAR anchor and keeps the band centres −2 … 1 of strata 1–4 (pool mean −0.5 ± offsets)', () => {
    const r = pool(FAMILIES.quant as AnyFamily)
    // Strata uniform over 1–4 with centres −2, −1, 0, 1 (the midpoints of STRATUM_B_CUTS'
    // bands) and small template offsets: the pool mean is near −0.5, the mean band centre.
    expect(STRATUM_B_CUTS.slice(0, 3).map((c) => c + 0.5)).toEqual([-1, 0, 1])
    expect(Math.abs(r.meanB + 0.5)).toBeLessThan(0.1)
    expect(r.bad).toEqual([])
    expect(Object.keys(ICAR_ANCHORED_FAMILIES)).not.toContain('quant')
  }, 120_000)

  it.each(Object.keys(FAMILIES))('%s: every item is in the default band of its b, and E[T] (§7.4) is its own model', (name) => {
    const r = pool(FAMILIES[name] as AnyFamily, 300)
    expect(r.bad).toEqual([])
    expect(r.meanT).toBeGreaterThan(15)
    expect(r.meanT).toBeLessThan(180)
  }, 120_000)
})
