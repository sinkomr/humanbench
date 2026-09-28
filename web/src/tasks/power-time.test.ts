/**
 * One time-cap policy for power items (DESIGN §13 "no time limits on power items beyond a
 * generous cap"; `POWER_TIME_LIMIT_S` in `priors.ts`). Power items are the keyed (dichotomous)
 * items of every registered family: each is untimed or capped at exactly the shared cap, and a
 * cap is at least `POWER_TIME_LIMIT_MIN_RATIO` × the item's E[T], over every stratum.
 */

import { describe, expect, it } from 'vitest'
import { modelFamilyOf } from '../engine'
import type { AnyFamily } from './family'
import { POWER_TIME_LIMIT_MIN_RATIO, POWER_TIME_LIMIT_S } from './priors'
import { FAMILIES } from './registry'

const PER_STRATUM = 40

function powerItems(family: AnyFamily) {
  return family.strata.flatMap((k) => Array.from({ length: PER_STRATUM }, (_, i) => family.generate(`cap-${i}`, { stratum: k })))
}

const POWER = Object.entries(FAMILIES).filter(([, f]) => modelFamilyOf(f.generate('cap-probe').params.model) === 'dichotomous')

describe('power-item time caps (§13)', () => {
  it('finds the power families among the registered ones', () => {
    expect(POWER.map(([name]) => name)).toEqual(expect.arrayContaining(['rotation', 'matrices', 'series']))
  })

  it.each(POWER)('%s: untimed, or capped at the shared generous cap', (_, family) => {
    const bad: string[] = []
    for (const item of powerItems(family)) {
      const cap = item.time_limit_s
      if (cap === undefined) continue
      if (cap !== POWER_TIME_LIMIT_S) bad.push(`${item.item_id}: time_limit_s ${cap} is not the shared ${POWER_TIME_LIMIT_S}`)
      if (cap < POWER_TIME_LIMIT_MIN_RATIO * item.expected_time_s) bad.push(`${item.item_id}: cap ${cap} < ${POWER_TIME_LIMIT_MIN_RATIO} × E[T] ${item.expected_time_s}`)
    }
    expect(bad).toEqual([])
  })

  it('caps rotation and matrices items (a family is either always or never capped)', () => {
    for (const [name, family] of POWER) {
      const caps = new Set(powerItems(family).map((i) => i.time_limit_s))
      expect(caps.size, name).toBe(1)
    }
    expect((FAMILIES.rotation as AnyFamily).generate('cap-rot').time_limit_s).toBe(POWER_TIME_LIMIT_S)
    expect((FAMILIES.matrices as AnyFamily).generate('cap-mat').time_limit_s).toBe(POWER_TIME_LIMIT_S)
  })
})
