/**
 * Item models vs the axis registry (ROADMAP A9, A10; audit: axis model semantics). The model
 * belongs to the item: A9 picks it per item by option count (k ≤ 4 → 3PL with c = 1/k; k ≥ 5 or
 * numeric entry → 2PL; enforced on every instance by `validateItemInstance`), blocks use A10's
 * GRM / Gaussian. The axis's `defaultModelKind` is informational, so the only link an item keeps
 * to its axis is the model family. The bank's `tests/gen/test_models.py` checks the same.
 */

import { describe, expect, it } from 'vitest'
import { axis, modelFamilyOf } from '../engine'
import type { AnyFamily } from './family'
import { FAMILIES } from './registry'

const N = 60

function problems(family: AnyFamily): string[] {
  const out: string[] = []
  for (let i = 0; i < N; i++) {
    const item = family.generate(`models-${i}`)
    const want = modelFamilyOf(axis(item.axis).defaultModelKind)
    if (modelFamilyOf(item.params.model) !== want) out.push(`${item.item_id}: ${item.params.model} is not in the ${want} family of axis ${item.axis}`)
  }
  return out
}

describe('item models vs axis defaults (A9, A10)', () => {
  it.each(Object.keys(FAMILIES))('%s: every item shares its axis default model family', (name) => {
    expect(problems(FAMILIES[name] as AnyFamily)).toEqual([])
  })

  it('SPA rotation items are 3PL with 4 options, the A9 default of the axis', () => {
    const item = (FAMILIES.rotation as AnyFamily).generate('models-rot')
    expect([item.axis, item.params.model, item.options_count]).toEqual(['SPA', '3pl', 4])
    expect(axis('SPA').defaultModelKind).toBe('3pl')
  })
})
