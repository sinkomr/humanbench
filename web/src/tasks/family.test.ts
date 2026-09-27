import { describe, expect, it } from 'vitest'
import { example } from './_example'
import {
  DEFAULT_A,
  defineFamily,
  itemParamsFor,
  parseItemInstance,
  toItemBase,
  validateItemInstance,
  verdict,
  type BuiltItem,
  type JsonObject,
} from './family'
import type { Stratum } from './ids'

/** A fresh mutable JSON copy of a valid instance. */
const sample = (seed = 'family-test'): Record<string, unknown> => JSON.parse(JSON.stringify(example.generate(seed))) as Record<string, unknown>

const mutate = (f: (x: Record<string, unknown>) => void): Record<string, unknown> => {
  const x = sample()
  f(x)
  return x
}

describe('itemParamsFor (A9)', () => {
  it('k ≤ 4 options → 3PL with c = 1/k', () => {
    for (const k of [2, 3, 4]) expect(itemParamsFor(k, 1.2, 0.3)).toEqual({ model: '3pl', a: 1.2, b: 0.3, c: 1 / k })
  })

  it('k ≥ 5 options or numeric entry → 2PL', () => {
    expect(itemParamsFor(5, 1, -1)).toEqual({ model: '2pl', a: 1, b: -1 })
    expect(itemParamsFor(6, 1, -1)).toEqual({ model: '2pl', a: 1, b: -1 })
    expect(itemParamsFor(undefined, 0.8, 2)).toEqual({ model: '2pl', a: 0.8, b: 2 })
  })

  it('rejects invalid inputs', () => {
    expect(() => itemParamsFor(1, 1, 0)).toThrow(RangeError)
    expect(() => itemParamsFor(3.5, 1, 0)).toThrow(RangeError)
    expect(() => itemParamsFor(5.5, 1, 0)).toThrow(RangeError)
    expect(() => itemParamsFor(4, 0, 0)).toThrow(RangeError)
    expect(() => itemParamsFor(4, 1, Number.NaN)).toThrow(RangeError)
  })

  it('the family default a is 1.0', () => {
    expect(DEFAULT_A).toBe(1)
  })
})

describe('verdict', () => {
  it('is ok iff every boolean check passes', () => {
    expect(verdict({ unique: true, n_models: 3 })).toEqual({ ok: true, reason: 'ok', checks: { unique: true, n_models: 3 } })
    const v = verdict({ unique: false, chiral: true, distinct: false })
    expect(v.ok).toBe(false)
    expect(v.reason).toBe('failed: unique, distinct')
  })

  it('refuses a vacuous verdict', () => {
    expect(verdict({}).ok).toBe(false)
    expect(verdict({ note: 'x' }).ok).toBe(false)
  })
})

describe('validateItemInstance', () => {
  it('accepts a generated instance, with and without the family', () => {
    expect(validateItemInstance(sample())).toEqual([])
    expect(validateItemInstance(sample(), example)).toEqual([])
    expect(parseItemInstance(sample(), example).family).toBe('example')
  })

  const cases: [string, (x: Record<string, unknown>) => void, RegExp][] = [
    ['unknown field', (x) => (x.answer = 1), /unknown field answer/],
    ['missing field', (x) => delete x.params, /missing field params/],
    ['undefined optional field', (x) => (x.time_limit_s = undefined), /plain JSON/],
    ['NaN', (x) => (x.expected_time_s = Number.NaN), /plain JSON/],
    ['item_id not from seed', (x) => (x.item_id = 'i:example:1.0.0:other'), /item_id/],
    ['bad family name', (x) => (x.family = 'Ex'), /family must match/],
    ['family_id format', (x) => (x.family_id = 'f:example:XYZ'), /family_id must match/],
    ['family_id prefix', (x) => (x.family_id = 'f:other:0123456789ab'), /prefix/],
    ['family_id not from structure', (x) => (x.structural_params = { pair: [0, 0] }), /familyIdOf/],
    ['axis', (x) => (x.axis = 'IQ'), /unknown axis/],
    ['stratum', (x) => (x.stratum = 7), /stratum must be/],
    ['stratum outside family strata', (x) => (x.stratum = 5), /family's strata/],
    ['spec not object', (x) => (x.spec = [1, 2]), /spec must be a JSON object/],
    ['key not object', (x) => (x.key = 2), /key must be a JSON object/],
    ['options_count', (x) => (x.options_count = 1), /options_count must be/],
    ['expected_time_s', (x) => (x.expected_time_s = 0), /expected_time_s/],
    ['time_limit_s', (x) => (x.time_limit_s = -5), /time_limit_s/],
    ['b_prior too large', (x) => ((x.difficulty as JsonObject).b_prior = 4.5), /b_prior/],
    ['sd_prior', (x) => ((x.difficulty as JsonObject).sd_prior = 0), /sd_prior/],
    ['provenance', (x) => ((x.difficulty as JsonObject).provenance = ''), /provenance/],
    ['feature type', (x) => (((x.difficulty as JsonObject).features as JsonObject).v = [1]), /features\.v/],
    ['difficulty extra', (x) => ((x.difficulty as JsonObject).se = 1), /difficulty\.se/],
    ['params.b ≠ b_prior', (x) => ((x.params as JsonObject).b = 0), /must equal difficulty.b_prior/],
    ['3pl c ≠ 1/k', (x) => ((x.params as JsonObject).c = 0.2), /1\/options_count/],
    ['2pl with k ≤ 4', (x) => (x.params = { model: '2pl', a: 1, b: (x.difficulty as JsonObject).b_prior as number }), /must use 3pl/],
    ['3pl with k ≥ 5', (x) => (x.options_count = 5), /must use 2pl/],
    ['3pl without k', (x) => delete x.options_count, /needs options_count/],
    ['unknown model', (x) => (x.params = { model: 'rasch', b: 0 }), /unknown params.model/],
    ['extra param field', (x) => ((x.params as JsonObject).d = 1), /exactly the fields/],
    ['generator_version', (x) => {
      x.generator_version = '9.9.9'
      x.item_id = `i:example:9.9.9:${String(x.seed)}`
    }, /generator_version 9\.9\.9 is not/],
  ]
  it.each(cases)('rejects: %s', (_name, f, re) => {
    const problems = validateItemInstance(mutate(f), example)
    expect(problems.join('\n')).toMatch(re)
    expect(() => parseItemInstance(mutate(f), example)).toThrow(/invalid item instance/)
  })

  it('accepts block models (GRM, Gaussian) without options_count', () => {
    const base = mutate((x) => delete x.options_count)
    expect(validateItemInstance({ ...base, params: { model: 'grm', a: 1.2, b: [-1, 0, 1.5] } })).toEqual([])
    expect(validateItemInstance({ ...base, params: { model: 'gaussian', lam: -0.8, d: 6.2, sigma: 0.3 } })).toEqual([])
    expect(validateItemInstance({ ...base, params: { model: 'grm', a: 1, b: [0, 0] } }).join()).toMatch(/strictly increasing/)
    expect(validateItemInstance({ ...base, params: { model: 'gaussian', lam: 1, d: 0, sigma: 0 } }).join()).toMatch(/sigma/)
    expect(validateItemInstance({ ...sample(), params: { model: 'grm', a: 1, b: [0] } }).join()).toMatch(/omit options_count/)
  })

  it('rejects non-objects', () => {
    for (const bad of [null, 1, 'x', [], undefined]) expect(validateItemInstance(bad)).not.toEqual([])
  })
})

describe('toItemBase', () => {
  it('maps an instance to the engine item metadata with the axis gold tier', () => {
    const item = example.generate('base')
    expect(toItemBase(item)).toEqual({
      item_id: item.item_id,
      family_id: item.family_id,
      axis: 'QR',
      facet: 'toy_sum',
      item_type: 'mc',
      gold_tier: 'a',
      expected_time_s: item.expected_time_s,
      time_limit_s: 60,
      params: item.params,
    })
  })
})

describe('defineFamily', () => {
  const built = (stratum: Stratum = 1): BuiltItem<JsonObject, JsonObject> => ({
    stratum,
    spec: { stem: 'x' },
    key: { value: 1 },
    structural_params: { t: 'const' },
    difficulty: { features: {}, b_prior: 0.5, sd_prior: 1, provenance: 'test' },
    expected_time_s: 30,
  })
  const base = {
    name: 'toy',
    axis: 'QR' as const,
    facet: 'toy',
    generatorVersion: '1.0.0',
    itemType: 'numeric_entry',
    strata: [1] as const,
    build: () => built(),
    verify: () => verdict({ ok: true }),
    score: () => ({ correct: 1 as const }),
  }

  it('fills ids, identity fields and A9 params (numeric entry → 2PL, default a)', () => {
    const fam = defineFamily({ ...base, defaultA: 1.3 })
    const item = fam.generate('s1')
    expect(item.item_id).toBe('i:toy:1.0.0:s1')
    expect(item.family_id).toBe(fam.familyIdOf({ t: 'const' }))
    expect(item.params).toEqual({ model: '2pl', a: 1.3, b: 0.5 })
    expect('options_count' in item).toBe(false)
    expect('time_limit_s' in item).toBe(false)
    expect(validateItemInstance(item, fam)).toEqual([])
  })

  it('keeps params returned by build (blocks, A10)', () => {
    const fam = defineFamily({ ...base, build: () => ({ ...built(), params: { model: 'gaussian', lam: 1, d: 0, sigma: 0.2 } }) })
    expect(fam.generate('s').params).toEqual({ model: 'gaussian', lam: 1, d: 0, sigma: 0.2 })
  })

  it('passes the resolved seed and requested stratum to build, seeded from that seed', () => {
    const seen: unknown[] = []
    const fam = defineFamily({
      ...base,
      strata: [1, 2],
      build: (rng, ctx) => {
        seen.push({ ...ctx, draw: rng.uint32() })
        return built(ctx.stratum ?? 1)
      },
    })
    const item = fam.generate('abc', { stratum: 2 })
    expect(item.seed).toBe('abc@s2')
    expect(item.item_id).toBe('i:toy:1.0.0:abc@s2')
    expect(fam.generate('abc@s2')).toEqual(item)
    expect(seen[0]).toEqual(seen[1])
    expect((seen[0] as { seed: string }).seed).toBe('abc@s2')
  })

  it('throws for an unsupported stratum or a build that ignores the requested one', () => {
    const fam = defineFamily(base)
    expect(() => fam.generate('s', { stratum: 3 })).toThrow(RangeError)
    const liar = defineFamily({ ...base, strata: [1, 2], build: () => built(1) })
    expect(() => liar.generate('s', { stratum: 2 })).toThrow(/returned stratum 1/)
  })

  it('validates the definition', () => {
    expect(() => defineFamily({ ...base, name: 'Bad Name' })).toThrow(RangeError)
    expect(() => defineFamily({ ...base, generatorVersion: 'v:1' })).toThrow(RangeError)
    expect(() => defineFamily({ ...base, axis: 'IQ' as never })).toThrow(RangeError)
    expect(() => defineFamily({ ...base, strata: [] })).toThrow(RangeError)
    expect(() => defineFamily({ ...base, strata: [7 as never] })).toThrow(RangeError)
  })
})
