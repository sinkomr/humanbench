/**
 * One time-cap rule for power items (M1.F2; DESIGN §13 "no time limits on power items beyond a
 * generous cap"; `powerTimeLimit` in `priors.ts`): every item of every item family carries
 * `time_limit_s = powerTimeLimit(expected_time_s)` = max(180 s, ⌈2.5 · E[T]⌉), over every stratum;
 * blocks carry no power cap (coding keeps its own 90 s window). The bank's
 * `tests/gen/test_power_time.py` checks the same rule on its twins.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { AnyFamily } from './family'
import { POWER_TIME_LIMIT_MIN_RATIO, POWER_TIME_LIMIT_S, powerTimeLimit } from './priors'
import { FAMILIES } from './registry'

const PER_STRATUM = 40

function sampleItems(family: AnyFamily) {
  return family.strata.flatMap((k) => Array.from({ length: PER_STRATUM }, (_, i) => family.generate(`cap-${i}`, { stratum: k })))
}

const ITEMS = Object.entries(FAMILIES).filter(([, f]) => f.kind === 'item')
const BLOCKS = Object.entries(FAMILIES).filter(([, f]) => f.kind === 'block')

describe('power-item time caps (§13, M1.F2)', () => {
  it('powerTimeLimit is max(180, ⌈2.5 · E[T]⌉) whole seconds', () => {
    expect(POWER_TIME_LIMIT_S).toBe(180)
    expect(POWER_TIME_LIMIT_MIN_RATIO).toBe(2.5)
    expect(powerTimeLimit(20)).toBe(180)
    expect(powerTimeLimit(72)).toBe(180)
    expect(powerTimeLimit(72.4)).toBe(181)
    expect(powerTimeLimit(90)).toBe(225)
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => powerTimeLimit(bad)).toThrow(RangeError)
    fc.assert(
      fc.property(fc.double({ min: 0.001, max: 10_000, noNaN: true }), (e) => {
        const cap = powerTimeLimit(e)
        expect(Number.isInteger(cap)).toBe(true)
        expect(cap).toBeGreaterThanOrEqual(POWER_TIME_LIMIT_S)
        expect(cap).toBeGreaterThanOrEqual(POWER_TIME_LIMIT_MIN_RATIO * e)
        expect(cap - 1).toBeLessThan(Math.max(POWER_TIME_LIMIT_S, POWER_TIME_LIMIT_MIN_RATIO * e))
      }),
    )
  })

  it('finds the item families among the registered ones', () => {
    expect(ITEMS.map(([name]) => name)).toEqual(['rotation', 'matrices', 'series', 'quant'])
  })

  it.each(ITEMS)('%s: every item is capped by the one shared rule', (_, family) => {
    const bad: string[] = []
    for (const item of sampleItems(family)) {
      const cap = item.time_limit_s
      if (cap !== powerTimeLimit(item.expected_time_s)) bad.push(`${item.item_id}: time_limit_s ${String(cap)} is not powerTimeLimit(${item.expected_time_s})`)
    }
    expect(bad).toEqual([])
  })

  it('quant items above E[T] = 72 s get more than 180 s (the ratio part of the rule)', () => {
    const long = sampleItems(FAMILIES.quant as AnyFamily).filter((i) => i.expected_time_s > 72)
    expect(long.length).toBeGreaterThan(0)
    for (const item of long) expect(item.time_limit_s).toBe(Math.ceil(2.5 * item.expected_time_s))
  })

  it('blocks carry no power cap; coding keeps its own 90 s window', () => {
    for (const [name, family] of BLOCKS) {
      const caps = new Set(sampleItems(family).map((i) => i.time_limit_s))
      expect([...caps], name).toEqual([name === 'coding' ? 90 : undefined])
    }
  })
})
