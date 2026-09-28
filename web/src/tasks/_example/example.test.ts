import { describe, expect, it } from 'vitest'
import { runFamilyProperties } from '../testing'
import { example, exampleSpecLeaksKey, type ExampleItem } from '.'

/** 55 unordered digit pairs → at most 55 families, far below the default 50% ratio. */
const TINY_SPACE = { min: 0.005, reason: '55 unordered digit pairs (toy family)' }

/**
 * 23,496 possible (operands, options) layouts (24 + 2·96 + 97·240 over the 100 ordered digit
 * pairs), so 10,000 draws give only ~81% distinct contents, below the default 95%.
 */
const SMALL_CONTENT = { min: 0.75, reason: '23,496 possible (operands, options) layouts (toy family)' }

const OPTS = {
  familyIdRatio: TINY_SPACE,
  contentRatio: SMALL_CONTENT,
  specLeaksKey: exampleSpecLeaksKey,
  correctResponse: (item: ExampleItem) => item.key.index,
  incorrectResponse: (item: ExampleItem) => (item.key.index + 1) % 4,
  malformedResponses: () => [-1, 4, 0.5, '0'],
} as const

describe('toy family "example" (contract end to end)', () => {
  it('passes runFamilyProperties at n = 10,000', () => {
    const r = runFamilyProperties(example, OPTS)
    expect(r.n).toBe(10_000)
    expect(r.distinctItemIds).toBe(10_000)
    expect(r.distinctContents).toBeGreaterThan(7_500)
    expect(r.distinctFamilyIds).toBe(55)
    expect(r.strataCounts[1] + r.strataCounts[2]).toBe(10_000)
    expect(r.strataCounts[1]).toBeGreaterThan(4_000)
    expect(r.strataCounts[2]).toBeGreaterThan(4_000)
  }, 120_000)

  it('passes with requested strata', () => {
    const r = runFamilyProperties(example, { ...OPTS, n: 2_000, strata: example.strata })
    expect(r.strataCounts).toEqual({ 1: 1_000, 2: 1_000, 3: 0, 4: 0, 5: 0, 6: 0 })
  }, 60_000)

  it('targets strata through the seed and refuses the ones it cannot make', () => {
    const item = example.generate('demo', { stratum: 2 })
    expect(item.seed).toBe('demo@s2')
    expect(item.stratum).toBe(2)
    expect(item.difficulty.features.carry).toBe(true)
    expect(example.generate('demo@s2')).toEqual(item)
    expect(() => example.generate('demo', { stratum: 3 })).toThrow(RangeError)
  })

  it('uses 3PL with c = 1/4 (A9) and the toy prior', () => {
    const item = example.generate('params')
    expect(item.params).toEqual({ model: '3pl', a: 1, b: item.difficulty.b_prior, c: 0.25 })
    expect([-2.1, -1.1]).toContain(item.difficulty.b_prior)
  })

  it('verify catches tampered instances', () => {
    const item = example.generate('tamper')
    const tamper = (f: (x: { -readonly [K in keyof ExampleItem]: unknown }) => void): ExampleItem => {
      const x = JSON.parse(JSON.stringify(item)) as { -readonly [K in keyof ExampleItem]: unknown }
      f(x)
      return x as unknown as ExampleItem
    }
    expect(example.verify(item).ok).toBe(true)
    expect(example.verify(tamper((x) => (x.key = { index: (item.key.index + 1) % 4 }))).reason).toMatch(/key_is_sum/)
    expect(example.verify(tamper((x) => (x.spec = { ...item.spec, options: [1, 1, 2, 3] }))).ok).toBe(false)
    expect(example.verify(tamper((x) => (x.structural_params = { pair: [9, 9] }))).reason).toMatch(/structure_matches/)
    expect(example.verify(tamper((x) => (x.spec = { operands: [12, 3], options: item.spec.options }))).ok).toBe(false)
    expect(example.verify(tamper((x) => (x.spec = null))).reason).toMatch(/malformed/)
  })

  it('scores the chosen option index', () => {
    const item = example.generate('score')
    expect(example.score(item, item.key.index)).toEqual({ correct: 1 })
    expect(example.score(item, (item.key.index + 1) % 4)).toEqual({ correct: 0 })
  })
})
