/**
 * The six M1 quant topic groups (ROADMAP A23, AI.3; proposal §5.2). Every one of the 53 quant
 * families (a family is a template variant, A11) maps to exactly one group through its template
 * facet, each group has at least 6 families, and the taxonomy file lists the same six groups. The
 * bank's `tests/gen/test_quant_topics.py` tests its twin against its own copy of the
 * byte-identical taxonomy file (ROADMAP A17), so the two twins agree through that file.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { quant } from '.'
import { quantBPrior, quantFeatures } from './prior'
import { QUANT_TEMPLATES, VARIANTS } from './templates'
import {
  FLOOR_GROUP_IDS,
  QUANT_GROUPS,
  QUANT_GROUP_IDS,
  QUANT_GROUP_VERSION,
  quantGroupById,
  quantGroupOfItem,
  quantGroupOfTemplate,
} from './topics'
import { GROUP_VERSION, nodesOfKind } from '../topics'

/** Proposal §5.2's "Variants" column. AI.16 adds templates: it assigns each to a group and updates this table on purpose. */
const FAMILIES_PER_GROUP: Record<string, number> = {
  'quant/arith_fractions_percent': 10,
  'quant/ratios_rates_averages': 8,
  'quant/linear': 6,
  'quant/powers_quadratics': 7,
  'quant/probability_counting': 6,
  'quant/series_number': 16,
}

/** Proposal §5.2's "Mean b prior [SPEC v0]" column (rounded there). */
const MEAN_B_PRIOR: Record<string, number> = {
  'quant/arith_fractions_percent': -2.0,
  'quant/ratios_rates_averages': -1.0,
  'quant/linear': -0.55,
  'quant/powers_quadratics': 0.0,
  'quant/probability_counting': 0.6,
  'quant/series_number': 1.0,
}

const groupsOfVariant = (variantId: string): string[] => {
  const template = variantId.split('/')[0] as string
  return QUANT_GROUPS.filter((g) => g.templates.includes(template)).map((g) => g.id)
}

describe('quant topic groups', () => {
  it('group_version is g1, here and in the taxonomy', () => {
    expect(QUANT_GROUP_VERSION).toBe('g1')
    expect(GROUP_VERSION).toBe(QUANT_GROUP_VERSION)
  })

  it('there are 53 quant families (the acceptance number of AI.3)', () => {
    // a change here means the groups need a review
    expect(VARIANTS).toHaveLength(53)
  })

  it('every family maps to exactly one group', () => {
    for (const v of VARIANTS) {
      const id = `${v.template}/${v.variant}`
      expect(groupsOfVariant(id), id).toHaveLength(1)
    }
  })

  it('every template is in exactly one group, and every group template exists', () => {
    const listed = QUANT_GROUPS.flatMap((g) => g.templates)
    expect([...listed].sort()).toEqual([...QUANT_TEMPLATES].sort())
    expect(new Set(listed).size).toBe(listed.length)
    for (const template of QUANT_TEMPLATES) {
      const group = quantGroupOfTemplate(template)
      expect(group?.templates).toContain(template)
    }
    expect(quantGroupOfTemplate('nope')).toBeUndefined()
    expect(quantGroupOfTemplate('quant/linear')).toBeUndefined()
  })

  it('each group has at least 6 families, in the proposal counts', () => {
    const counts = Object.fromEntries(QUANT_GROUPS.map((g) => [g.id, VARIANTS.filter((v) => g.templates.includes(v.template)).length]))
    for (const [id, n] of Object.entries(counts)) expect(n, id).toBeGreaterThanOrEqual(6)
    expect(counts).toEqual(FAMILIES_PER_GROUP)
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(53)
  })

  it('is the proposal table, frozen, with the two floor groups first', () => {
    expect([...QUANT_GROUP_IDS]).toEqual(Object.keys(FAMILIES_PER_GROUP))
    expect(new Set(QUANT_GROUP_IDS).size).toBe(6)
    expect([...FLOOR_GROUP_IDS]).toEqual(['quant/arith_fractions_percent', 'quant/ratios_rates_averages'])
    expect(quantGroupById('quant/linear')).toBe(QUANT_GROUPS[2])
    expect(quantGroupById('quant/nope')).toBeUndefined()
    expect(Object.isFrozen(QUANT_GROUPS)).toBe(true)
    expect(QUANT_GROUPS.every((g) => Object.isFrozen(g) && Object.isFrozen(g.templates))).toBe(true)
  })

  it('has prior means (SPEC v0) that match the proposal table within 0.1', () => {
    for (const g of QUANT_GROUPS) {
      const bs = VARIANTS.filter((v) => g.templates.includes(v.template)).map((v) => quantBPrior(quantFeatures(v.template, v.variant, v.stratum, v.offset, v.format !== 'integer')))
      const mean = bs.reduce((a, b) => a + b, 0) / bs.length
      expect(Math.abs(mean - (MEAN_B_PRIOR[g.id] as number)), g.id).toBeLessThan(0.1)
    }
  })

  it('orders the groups by prior mean, so the floor groups are the two lowest', () => {
    const order = [...QUANT_GROUP_IDS].sort((a, b) => (MEAN_B_PRIOR[a] as number) - (MEAN_B_PRIOR[b] as number))
    expect(order.slice(0, 2)).toEqual([...FLOOR_GROUP_IDS])
    expect(order).toEqual([...QUANT_GROUP_IDS])
  })

  it('is the set of groups listed in the taxonomy file', () => {
    const nodes = nodesOfKind('group')
    expect(nodes.map((n) => [n.id, n.label, [...n.templates]])).toEqual(QUANT_GROUPS.map((g) => [g.id, g.label, [...g.templates]]))
    expect(nodes.every((n) => n.axis === 'QR')).toBe(true)
  })

  it('gives every generated item a group through its facet', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 12 }), fc.integer({ min: 1, max: 4 }), (seed, stratum) => {
        const item = quant.generate(seed, { stratum: stratum as 1 | 2 | 3 | 4 })
        const group = quantGroupOfItem(item)
        expect(group, item.facet).toBeDefined()
        expect(QUANT_GROUP_IDS).toContain(group?.id)
      }),
      { numRuns: 300 },
    )
  })
})
