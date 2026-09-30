import { describe, expect, it } from 'vitest'
import { example } from './_example'
import {
  DEFAULT_A,
  MalformedResponseError,
  SIBLING_GROUP_RE,
  blockScore,
  defineFamily,
  entryResponse,
  gaussianObservationSigma,
  itemParamsFor,
  kindOfModel,
  mcResponseIndex,
  parseItemInstance,
  siblingGroupId,
  toItemBase,
  validateItemInstance,
  verdict,
  type BlockObservation,
  type BuiltItem,
  type JsonObject,
} from './family'
import type { Stratum } from './ids'
import { powerTimeLimit } from './priors'

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
    ['ladder_probe false (omit it instead)', (x) => (x.ladder_probe = false), /ladder_probe must be true, or omitted/],
    ['practice_only null', (x) => (x.practice_only = null), /practice_only must be true, or omitted/],
    ['both family flags', (x) => ((x.ladder_probe = true), (x.practice_only = true)), /not both ladder_probe and practice_only/],
    ['a family flag off QR', (x) => ((x.axis = 'SPA'), (x.practice_only = true)), /practice_only is for QR items, not axis SPA/],
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
    ['stratum not the band of b_prior (M1.P)', (x) => (x.stratum = x.stratum === 1 ? 2 : 1), /is not the default band of b_prior -?\d/],
    ['spec not object', (x) => (x.spec = [1, 2]), /spec must be a JSON object/],
    ['key not object', (x) => (x.key = 2), /key must be a JSON object/],
    ['options_count', (x) => (x.options_count = 1), /options_count must be/],
    ['expected_time_s', (x) => (x.expected_time_s = 0), /expected_time_s/],
    ['time_limit_s', (x) => (x.time_limit_s = -5), /time_limit_s/],
    ['item without the §13 cap', (x) => delete x.time_limit_s, /shared §13 cap/],
    ['item with another cap', (x) => (x.time_limit_s = 60), /shared §13 cap powerTimeLimit\(expected_time_s\) = 180, got 60/],
    ['missing sibling_group', (x) => delete x.sibling_group, /missing field sibling_group/],
    ['sibling_group of another family', (x) => (x.sibling_group = 'g:other:sums'), /sibling_group must be/],
    ['sibling_group not an id', (x) => (x.sibling_group = 'sums'), /sibling_group must be/],
    ['facet not declared', (x) => (x.facet = 'toy_product'), /facet toy_product is not one of toy_sum/],
    ['MC options not in spec.options', (x) => (x.spec = { operands: [1, 2], choices: [1, 2, 3, 4] }), /spec\.options \(display order\)/],
    ['MC options count mismatch', (x) => ((x.spec as JsonObject).options = [1, 2, 3]), /exactly options_count options/],
    ['MC key not a position', (x) => (x.key = { index: 4 }), /key\.index must be an integer 0 … options_count − 1/],
    ['block params on an item family', (x) => {
      delete x.options_count
      x.params = { model: 'gaussian', lam: 1, d: 0, sigma: 0.05 }
    }, /not a item model/],
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

  it('accepts a grouped sibling_group of its own family', () => {
    expect(validateItemInstance({ ...sample(), sibling_group: 'g:example:sums' }, example)).toEqual([])
  })

  it('accepts block models (GRM, Gaussian) without options_count, and no cap on blocks', () => {
    const base = mutate((x) => {
      delete x.options_count
      delete x.time_limit_s
    })
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

describe('family flags (A23, AI.2)', () => {
  it('a QR instance may carry ladder_probe or practice_only, each true', () => {
    expect(validateItemInstance({ ...sample(), ladder_probe: true }, example)).toEqual([])
    expect(validateItemInstance({ ...sample(), practice_only: true }, example)).toEqual([])
    expect(parseItemInstance({ ...sample(), practice_only: true }, example).practice_only).toBe(true)
  })

  it('survives a JSON round trip and is omitted when unset, never undefined', () => {
    const item = { ...example.generate('flags'), ladder_probe: true as const }
    expect(JSON.parse(JSON.stringify(item))).toEqual(item)
    expect(validateItemInstance(JSON.parse(JSON.stringify(item)), example)).toEqual([])
    expect('ladder_probe' in example.generate('flags')).toBe(false)
    expect('practice_only' in example.generate('flags')).toBe(false)
    expect(validateItemInstance({ ...sample(), ladder_probe: undefined })).toEqual(['an item instance must be plain JSON (finite numbers, no undefined, no class instances)'])
  })

  it('the flags are optional wire fields, so the golden dumps without them stay valid', () => {
    expect(Object.keys(sample())).not.toContain('ladder_probe')
    expect(validateItemInstance(sample(), example)).toEqual([])
  })
})

describe('toItemBase', () => {
  it('maps an instance to the engine item metadata with the axis gold tier', () => {
    const item = example.generate('base')
    expect(toItemBase(item)).toEqual({
      item_id: item.item_id,
      family_id: item.family_id,
      sibling_group: item.family_id,
      axis: 'QR',
      facet: 'toy_sum',
      item_type: 'mc',
      gold_tier: 'a',
      expected_time_s: item.expected_time_s,
      time_limit_s: 180,
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
    // b in the default band of the stratum (M1.P): −2 for stratum 1, −1 for stratum 2
    difficulty: { features: {}, b_prior: stratum - 3, sd_prior: 1, provenance: 'test' },
    expected_time_s: 30,
  })
  const base = {
    name: 'toy',
    kind: 'item' as const,
    axis: 'QR' as const,
    facets: ['toy'],
    generatorVersion: '1.0.0',
    itemType: 'numeric_entry',
    strata: [1] as const,
    build: () => built(),
    verify: () => verdict({ ok: true }),
    score: () => ({ correct: 1 as const }),
  }
  const gaussian = { model: 'gaussian' as const, lam: 1, d: 0, sigma: 0.2 }
  const blockBase = {
    ...base,
    kind: 'block' as const,
    build: () => ({ ...built(), params: gaussian }),
    score: () => blockScore(null, [], ['unfinished']),
  }

  it('fills ids, identity fields, A9 params (numeric entry → 2PL, default a) and the §13 cap', () => {
    const fam = defineFamily({ ...base, defaultA: 1.3 })
    const item = fam.generate('s1')
    expect(fam.kind).toBe('item')
    expect(fam.facets).toEqual(['toy'])
    expect(item.item_id).toBe('i:toy:1.0.0:s1')
    expect(item.family_id).toBe(fam.familyIdOf({ t: 'const' }))
    expect(item.sibling_group).toBe(item.family_id) // a family is its own sibling group by default
    expect(item.facet).toBe('toy') // the only facet
    expect(item.params).toEqual({ model: '2pl', a: 1.3, b: -2 })
    expect('options_count' in item).toBe(false)
    expect(item.time_limit_s).toBe(powerTimeLimit(30))
    expect(validateItemInstance(item, fam)).toEqual([])
  })

  it('copies the A23 family flags from build() and leaves them out otherwise', () => {
    expect('ladder_probe' in defineFamily(base).generate('s')).toBe(false)
    const probe = defineFamily({ ...base, build: () => ({ ...built(), ladder_probe: true as const }) }).generate('s')
    expect(probe.ladder_probe).toBe(true)
    expect('practice_only' in probe).toBe(false)
    expect(validateItemInstance(probe)).toEqual([])
    const practice = defineFamily({ ...base, build: () => ({ ...built(), practice_only: true as const }) }).generate('s')
    expect(practice.practice_only).toBe(true)
    expect(validateItemInstance(practice)).toEqual([])
    // a family whose axis is not QR builds a flagged item that its own validator rejects
    const off = defineFamily({ ...base, axis: 'SPA' as const, build: () => ({ ...built(), practice_only: true as const }) })
    expect(validateItemInstance(off.generate('s'), off).join()).toMatch(/practice_only is for QR items/)
  })

  it('keeps params and the time window returned by a block build (A10), with no §13 cap', () => {
    const fam = defineFamily(blockBase)
    expect(fam.kind).toBe('block')
    const item = fam.generate('s')
    expect(item.params).toEqual(gaussian)
    expect('time_limit_s' in item).toBe(false)
    expect(validateItemInstance(item, fam)).toEqual([])
    const timed = defineFamily({ ...blockBase, build: () => ({ ...built(), params: gaussian, time_limit_s: 90 }) })
    expect(timed.generate('s').time_limit_s).toBe(90)
  })

  it('enforces the kind rules on build (M1.F2)', () => {
    expect(() => defineFamily({ ...base, build: () => ({ ...built(), params: gaussian }) }).generate('s')).toThrow(/A9 params from defineFamily/)
    expect(() => defineFamily({ ...base, build: () => ({ ...built(), time_limit_s: 60 }) }).generate('s')).toThrow(/shared §13 cap/)
    expect(() => defineFamily({ ...blockBase, build: () => built() }).generate('s')).toThrow(/must return its A10 params/)
    expect(() => defineFamily({ ...base, kind: 'quiz' as never })).toThrow(RangeError)
  })

  it('takes facets per item and sibling groups from build (M1.F2)', () => {
    const fam = defineFamily({
      ...base,
      facets: ['sums', 'products'],
      build: (rng) => {
        const f = rng.next() < 0.5 ? 'sums' : 'products'
        return { ...built(), facet: f, sibling_group: siblingGroupId('toy', f) }
      },
    })
    const facets = new Set<string>()
    for (let i = 0; i < 40; i++) {
      const item = fam.generate(`f${i}`)
      facets.add(item.facet)
      expect(item.sibling_group).toBe(`g:toy:${item.facet}`)
      expect(validateItemInstance(item, fam)).toEqual([])
    }
    expect([...facets].sort()).toEqual(['products', 'sums'])
    expect(() => defineFamily({ ...base, facets: ['a', 'b'] }).generate('s')).toThrow(/facet undefined, not one of a, b/)
    expect(() => defineFamily({ ...base, build: () => ({ ...built(), facet: 'other' }) }).generate('s')).toThrow(/not one of toy/)
    expect(() => defineFamily({ ...base, facets: [] })).toThrow(RangeError)
    expect(() => defineFamily({ ...base, facets: ['a', 'a'] })).toThrow(RangeError)
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

describe('contract v2 helpers (M1.F2)', () => {
  it('kindOfModel: dichotomous models are items, GRM and Gaussian blocks', () => {
    expect(['2pl', '3pl', '2pl_testlet'].map((m) => kindOfModel(m as never))).toEqual(['item', 'item', 'item'])
    expect(kindOfModel('grm')).toBe('block')
    expect(kindOfModel('gaussian')).toBe('block')
  })

  it('siblingGroupId builds g:<family>:<label> and refuses bad labels', () => {
    expect(siblingGroupId('quant', 'percent')).toBe('g:quant:percent')
    expect(SIBLING_GROUP_RE.test('g:quant:percent')).toBe(true)
    for (const bad of [['quant', ''], ['quant', 'Percent'], ['quant', 'a:b'], ['Quant', 'x'], ['quant', 'x'.repeat(49)]] as const) {
      expect(() => siblingGroupId(bad[0], bad[1]), JSON.stringify(bad)).toThrow(RangeError)
    }
  })

  const grm: BlockObservation = { kind: 'grm', axis: 'WM', a: 1.7, b: [-1, 0, 1], y: 2 }

  it('blockScore: an observation xor ≥ 1 reason, snake_case tokens', () => {
    expect(blockScore(grm)).toEqual({ correct: null, observation: grm, flags: [], reasons: [] })
    expect(blockScore(grm, ['high_error_rate'])).toEqual({ correct: null, observation: grm, flags: ['high_error_rate'], reasons: [] })
    expect(blockScore(null, ['skimming'], ['gate_failed'])).toEqual({ correct: null, flags: ['skimming'], reasons: ['gate_failed'] })
    expect('observation' in blockScore(undefined, [], ['unfinished'])).toBe(false)
    expect(() => blockScore(null)).toThrow(RangeError)
    expect(() => blockScore(grm, [], ['x'])).toThrow(RangeError)
    expect(() => blockScore(null, [], ['Gate Failed'])).toThrow(RangeError)
    expect(() => blockScore(grm, ['2fast'])).toThrow(RangeError)
  })

  it('gaussianObservationSigma = sqrt(SE² + params.sigma²): params.sigma is tau_res', () => {
    const p = { model: 'gaussian' as const, lam: 0.25, d: 3, sigma: 0.05 }
    expect(gaussianObservationSigma(0, p)).toBe(0.05)
    expect(gaussianObservationSigma(0.15, p)).toBe(Math.sqrt(0.15 * 0.15 + 0.05 * 0.05))
    expect(() => gaussianObservationSigma(-0.1, p)).toThrow(RangeError)
    expect(() => gaussianObservationSigma(Number.NaN, p)).toThrow(RangeError)
    expect(() => gaussianObservationSigma(0.1, { model: '2pl', a: 1, b: 0 })).toThrow(RangeError)
  })

  it('MalformedResponseError is a RangeError with its own name', () => {
    const e = new MalformedResponseError('bad')
    expect(e).toBeInstanceOf(RangeError)
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('MalformedResponseError')
    expect(e.message).toBe('bad')
  })

  it('mcResponseIndex accepts exactly the option positions 0 … k − 1', () => {
    const item = example.generate('mc')
    for (let i = 0; i < 4; i++) expect(mcResponseIndex(item, i)).toBe(i)
    for (const bad of [-1, 4, 1.5, '1', null, undefined, true, Number.NaN, [1], {}]) {
      expect(() => mcResponseIndex(item, bad), String(bad)).toThrow(MalformedResponseError)
    }
  })

  it('entryResponse accepts typed text (and finite numbers when allowed)', () => {
    const item = example.generate('entry')
    expect(entryResponse(item, 'abc', false)).toBe('abc')
    expect(entryResponse(item, '', false)).toBe('')
    expect(entryResponse(item, 42, true)).toBe(42)
    expect(() => entryResponse(item, 42, false)).toThrow(MalformedResponseError)
    for (const bad of [null, undefined, true, Number.NaN, Number.POSITIVE_INFINITY, [], {}]) {
      expect(() => entryResponse(item, bad, true), String(bad)).toThrow(MalformedResponseError)
    }
  })
})
