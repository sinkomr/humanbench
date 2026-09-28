import { describe, expect, it } from 'vitest'
import { createRng } from '../../engine'
import { ICAR_ANCHOR_B, stratumOfB } from '../priors'
import { VERIFY_INSTANCES, runFamilyProperties } from '../testing'
import { LAYOUT_RULES, MAX_COUNT, RULE_ATTRS, SCALAR_ATTRS, SCALAR_RULES, allRuleSets, parseRuleSet, popcount, type Cell } from './grammar'
import { sampleAccepted } from './gen'
import { modalHitProbability, modalPicksKeyUniquely, oneModeCertain, oneModeHitProbability } from './heuristic'
import { MATRIX_PRIOR, MATRIX_STRATA, RULE_SETS_BY_STRATUM, bPriorOf, expectedTimeOf, featuresOf } from './prior'
import { solve, violatedRules } from './solver'
import { parseSpec } from './verify'
import { EXAMPLE1_RULES } from './fixtures'
import { matrices, matricesSpecLeaksKey, type MatrixItem } from '.'

/** A11: the family is the rule set, so 10k items share at most 1,655 family ids (16 in stratum 1). */
const RULE_SET_FAMILIES = { min: 0.05, reason: 'family_id = the matrix rule set (A11): 1,655 rule sets, 16 in stratum 1' }

const OPTS = {
  specLeaksKey: matricesSpecLeaksKey,
  familyIdRatio: RULE_SET_FAMILIES,
  correctResponse: (item: MatrixItem) => item.key.index,
  incorrectResponse: (item: MatrixItem) => (item.key.index + 1) % 6,
  malformedResponses: () => [-1, 6, 2.5, '1', [1]],
} as const

/** Chance for the option-only picker (1 of 6) and the M1.6 ceiling of 1.5 × chance. */
const CHANCE = 1 / 6
const MAX_HIT_RATE = 1.5 * CHANCE

describe('matrices family (M1.6)', () => {
  it('passes runFamilyProperties at n = 10,000 across strata 1–4', () => {
    const r = runFamilyProperties(matrices, { ...OPTS, strata: matrices.strata })
    expect(r.n).toBe(VERIFY_INSTANCES)
    expect(r.distinctItemIds).toBe(VERIFY_INSTANCES)
    expect(r.distinctContents).toBe(VERIFY_INSTANCES)
    expect(r.strataCounts).toEqual({ 1: 2_500, 2: 2_500, 3: 2_500, 4: 2_500, 5: 0, 6: 0 })
    expect(r.distinctFamilyIds).toBeGreaterThan(900)
    expect(r.bPrior.min).toBeCloseTo(-1.88, 2)
    expect(r.bPrior.max).toBeCloseTo(0.97, 2)
  }, 300_000)

  it('passes runFamilyProperties when the family picks the strata', () => {
    const r = runFamilyProperties(matrices, { ...OPTS, n: 2_000, seedPrefix: 'free-' })
    for (const s of [1, 2, 3, 4] as const) expect(r.strataCounts[s]).toBeGreaterThan(400)
  }, 120_000)

  it('keeps the modal-attribute picker at ≤ 1.5 × chance over 10k items (both tie readings), the key position uniform', () => {
    let hits = 0
    let oneModeHits = 0
    let certain = 0
    let maxObjects = 0
    const keyPos = [0, 0, 0, 0, 0, 0]
    const ruleCounts = new Map<string, number>()
    const bump = (k: string): void => void ruleCounts.set(k, (ruleCounts.get(k) ?? 0) + 1)
    for (let i = 0; i < VERIFY_INSTANCES; i++) {
      const item = matrices.generate(`prop-${i}`, { stratum: matrices.strata[i % matrices.strata.length] as number })
      const parsed = parseSpec(item.spec)
      if (typeof parsed === 'string') throw new Error(parsed)
      hits += modalHitProbability(parsed.options, item.key.index)
      oneModeHits += oneModeHitProbability(parsed.options, item.key.index)
      if (oneModeCertain(parsed.options, item.key.index)) certain++
      for (const c of [...parsed.visible, ...parsed.options]) maxObjects = Math.max(maxObjects, popcount(c.positions))
      keyPos[item.key.index] = (keyPos[item.key.index] as number) + 1
      const rules = parseRuleSet(item.structural_params)
      if (!rules) throw new Error(`bad structural_params in ${item.item_id}`)
      for (const a of RULE_ATTRS) bump(`${a}:${rules[a]}`)
      bump(`layout:${rules.count}/${rules.position}`)
    }
    expect(hits / VERIFY_INSTANCES).toBeLessThanOrEqual(MAX_HIT_RATE)
    expect(oneModeHits / VERIFY_INSTANCES).toBeLessThanOrEqual(MAX_HIT_RATE)
    expect(certain).toBe(0) // the all-ties gate also rules out a one-mode picker certain of the key
    expect(maxObjects).toBe(MAX_COUNT) // DESIGN §4.2: count 1–4, in position mode too
    // Every generator rule comes out of generate(): a solver regression that makes a rule's grids
    // look ambiguous or inconsistent would silently drop that rule class (each is ≥ 700 here).
    const expected = [
      ...SCALAR_ATTRS.flatMap((a) => SCALAR_RULES.map((r) => `${a}:${r}`)),
      ...LAYOUT_RULES.flatMap((l) => [`count:${l.count}`, `position:${l.position}`, `layout:${l.count}/${l.position}`]),
    ]
    for (const k of new Set(expected)) expect(ruleCounts.get(k) ?? 0, k).toBeGreaterThanOrEqual(300)
    // Chi-square with 5 df: 20.5 is the 0.999 quantile.
    const e = VERIFY_INSTANCES / 6
    const chi2 = keyPos.reduce((s, o) => s + (o - e) ** 2 / e, 0)
    expect(chi2).toBeLessThan(20.5)
  }, 120_000)

  it('can generate every one of the 1,655 rule sets', () => {
    const rng = createRng('every-rule-set')
    for (const rules of allRuleSets()) {
      const s = sampleAccepted(rng, rules)
      expect(s, JSON.stringify(rules)).not.toBeNull()
      const { visible, tree } = s as { visible: Cell[]; tree: Cell[] }
      expect(violatedRules([...visible, tree[0] as Cell], rules)).toEqual([])
      expect(solve(visible).cell).toEqual(tree[0])
      expect(modalPicksKeyUniquely(tree, 0)).toBe(false)
    }
  }, 60_000)

  it('has the A9 item model, identity fields and targetable strata 1–4', () => {
    const item = matrices.generate('meta', { stratum: 3 })
    expect(item).toMatchObject({ family: 'matrices', axis: 'MAT', facet: 'matrix', item_type: 'mc_matrix_spec', options_count: 6 })
    expect(item.params).toEqual({ model: '2pl', a: 1, b: item.difficulty.b_prior })
    expect(item.seed).toBe('meta@s3')
    expect(matrices.generate('meta@s3')).toEqual(item)
    expect(matrices.strata).toEqual([1, 2, 3, 4])
    expect(() => matrices.generate('meta', { stratum: 5 })).toThrow(RangeError)
    expect(item.spec.grid.map((r) => r.length)).toEqual([3, 3, 2])
    expect(item.spec.options).toHaveLength(6)
  })
})

describe('matrices prior (M1.P, [SPEC] v0)', () => {
  it('is anchored at the ICAR matrix mean p = .52', () => {
    expect(MATRIX_PRIOR.anchorB).toBe(ICAR_ANCHOR_B.matrix)
    expect(MATRIX_PRIOR.anchorB).toBeCloseTo(-0.08, 2)
    const anchorMix = { n_rules: 3, n_progression: 1, n_distribution: 1, n_arithmetic: 0.5, n_logic: 0.5 }
    expect(bPriorOf(anchorMix)).toBeCloseTo(ICAR_ANCHOR_B.matrix, 12)
  })

  it('orders difficulty by number and type of rules', () => {
    const one = (rule: 'progression+1' | 'distribution') => bPriorOf(featuresOf({ ...EXAMPLE1_RULES, size: rule, count: 'constant' }))
    expect(one('progression+1')).toBeCloseTo(-1.88, 2)
    expect(one('distribution')).toBeCloseTo(-1.58, 2)
    expect(bPriorOf(featuresOf(EXAMPLE1_RULES))).toBeCloseTo(-1.43, 2) // §14.6 example 1: "easy"
    const xor = featuresOf({ ...EXAMPLE1_RULES, count: 'derived', position: 'xor' })
    const arith = featuresOf({ ...EXAMPLE1_RULES, count: 'arithmetic+' })
    expect(bPriorOf(xor)).toBeCloseTo(bPriorOf(arith), 12)
    expect(bPriorOf(arith)).toBeGreaterThan(bPriorOf(featuresOf(EXAMPLE1_RULES)))
    expect(stratumOfB(one('progression+1'))).toBe(1)
    expect(stratumOfB(bPriorOf(featuresOf(EXAMPLE1_RULES)))).toBe(2)
  })

  it('groups all 1,655 rule sets into strata 1–4', () => {
    expect(allRuleSets()).toHaveLength(1_655)
    expect(MATRIX_STRATA).toEqual([1, 2, 3, 4])
    const sizes = MATRIX_STRATA.map((s) => RULE_SETS_BY_STRATUM.get(s)?.length)
    expect(sizes).toEqual([16, 458, 1_060, 121])
  })

  it('expects 30–60 s', () => {
    expect([1, 2, 3, 4].map(expectedTimeOf)).toEqual([30, 40, 50, 60])
  })
})
