import { describe, expect, it } from 'vitest'
import { defineFamily, verdict, type BuiltItem, type FamilyDefinition, type JsonObject, type ProceduralFamily } from './family'
import { BANNED_SPEC_FIELDS, FamilyPropertyError, VERIFY_INSTANCES, runFamilyProperties, specKeyLeaks } from './testing'

type Spec = JsonObject
type Key = JsonObject

/** A healthy numeric-entry toy: x + y with a big structural space. */
const healthy: FamilyDefinition<Spec, Key, number> = {
  name: 'toy',
  axis: 'QR',
  facet: 'toy',
  generatorVersion: '1.0.0',
  itemType: 'numeric_entry',
  strata: [1, 2, 3],
  build(rng, ctx) {
    const stratum = ctx.stratum ?? (rng.int(1, 3) as 1 | 2 | 3)
    const x = rng.int(100, 99_999)
    const y = rng.int(100, 99_999)
    return {
      stratum,
      spec: { stem: `${x} plus ${y}`, operands: [x, y] },
      key: { value: x + y, tol: 0 },
      structural_params: { x, y },
      difficulty: { features: { digits: String(x).length }, b_prior: stratum - 2, sd_prior: 1, provenance: 'test' },
      expected_time_s: 30,
    }
  },
  verify: (item) => verdict({ key_is_sum: item.key.value === (item.spec.operands as number[]).reduce((s, v) => s + v, 0) }),
  score: (item, r) => ({ correct: r === item.key.value ? 1 : 0 }),
}

const make = (over: Partial<FamilyDefinition<Spec, Key, number>>): ProceduralFamily<Spec, Key, number> =>
  defineFamily({ ...healthy, ...over })

const withBuild = (f: (b: BuiltItem<Spec, Key>) => BuiltItem<Spec, Key>): ProceduralFamily<Spec, Key, number> =>
  make({ build: (rng, ctx) => f(healthy.build(rng, ctx)) })

const failuresOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    if (e instanceof FamilyPropertyError) return e.failures.join('\n')
    throw e
  }
  throw new Error('expected a FamilyPropertyError')
}

describe('runFamilyProperties', () => {
  it('passes a healthy family, with and without requested strata', () => {
    const fam = make({})
    const r = runFamilyProperties(fam, { n: 500, correctResponse: (it) => it.key.value as number })
    expect(r.n).toBe(500)
    expect(r.distinctItemIds).toBe(500)
    expect(r.distinctFamilyIds).toBeGreaterThan(495)
    expect(r.bPrior.min).toBe(-1)
    expect(r.bPrior.max).toBe(1)
    const s = runFamilyProperties(fam, { n: 300, strata: [1, 3] })
    expect(s.strataCounts).toEqual({ 1: 150, 2: 0, 3: 150, 4: 0, 5: 0, 6: 0 })
    expect(VERIFY_INSTANCES).toBe(10_000)
  })

  it('catches a verifier that rejects instances', () => {
    const fam = make({ verify: (it) => verdict({ small: (it.key.value as number) < 100_000 }) })
    expect(failuresOf(() => runFamilyProperties(fam, { n: 200 }))).toMatch(/verify failed: failed: small/)
  })

  it('catches non-determinism', () => {
    let calls = 0
    const fam = withBuild((b) => ({ ...b, spec: { ...b.spec, calls: calls++ } }))
    expect(failuresOf(() => runFamilyProperties(fam, { n: 5 }))).toMatch(/not deterministic/)
  })

  it('catches a key leaked into the spec', () => {
    const fam = withBuild((b) => ({ ...b, spec: { ...b.spec, hint: { ...b.key } } }))
    expect(failuresOf(() => runFamilyProperties(fam, { n: 5 }))).toMatch(/serialised key/)
    const named = withBuild((b) => ({ ...b, spec: { ...b.spec, options: [{ text: 'a', Correct: false }] } }))
    expect(failuresOf(() => runFamilyProperties(named, { n: 5 }))).toMatch(/field named "Correct"/)
  })

  it('runs the family-provided leak predicate even when key values may appear in the spec', () => {
    const fam = make({})
    const msg = failuresOf(() =>
      runFamilyProperties(fam, { n: 5, allowKeyInSpec: 'test', specLeaksKey: (it) => ('stem' in it.spec ? 'stem shows the sum' : null) }),
    )
    expect(msg).toMatch(/specLeaksKey: stem shows the sum/)
  })

  it('catches too few distinct family_ids unless a documented override is given', () => {
    const fam = withBuild((b) => ({ ...b, structural_params: { template: 'sum' } }))
    expect(failuresOf(() => runFamilyProperties(fam, { n: 100 }))).toMatch(/1\/100 distinct family_ids/)
    expect(runFamilyProperties(fam, { n: 100, familyIdRatio: { min: 0.01, reason: 'one template' } }).distinctFamilyIds).toBe(1)
    expect(() => runFamilyProperties(fam, { n: 100, familyIdRatio: { min: 0.01, reason: ' ' } })).toThrow(RangeError)
    expect(() => runFamilyProperties(fam, { n: 100, allowKeyInSpec: '' })).toThrow(RangeError)
  })

  it('catches out-of-range priors, times and JSON-unsafe instances', () => {
    const big = withBuild((b) => ({ ...b, difficulty: { ...b.difficulty, b_prior: 4.2 } }))
    expect(failuresOf(() => runFamilyProperties(big, { n: 3 }))).toMatch(/b_prior/)
    const slow = withBuild((b) => ({ ...b, expected_time_s: 0 }))
    expect(failuresOf(() => runFamilyProperties(slow, { n: 3 }))).toMatch(/expected_time_s/)
    const unsafe = withBuild((b) => ({ ...b, spec: { ...b.spec, when: undefined as never } }))
    expect(failuresOf(() => runFamilyProperties(unsafe, { n: 3 }))).toMatch(/plain JSON/)
  })

  it('catches a scorer that rejects the correct response', () => {
    const fam = make({ score: () => ({ correct: 0 }) })
    expect(failuresOf(() => runFamilyProperties(fam, { n: 3, correctResponse: (it) => it.key.value as number }))).toMatch(
      /correct = 0/,
    )
  })

  it('catches a hand-written family whose ids ignore the seed or the stratum', () => {
    const good = make({})
    const sameId: ProceduralFamily<Spec, Key, number> = {
      ...good,
      generate: (seed, opts) => ({ ...good.generate(seed, opts), seed: 'fixed', item_id: 'i:toy:1.0.0:fixed' }),
    }
    const msg = failuresOf(() => runFamilyProperties(sameId, { n: 50 }))
    expect(msg).toMatch(/recorded seed "fixed" is not the resolved seed/)
    const ignoresStratum: ProceduralFamily<Spec, Key, number> = { ...good, generate: (seed) => good.generate(seed) }
    expect(failuresOf(() => runFamilyProperties(ignoresStratum, { n: 20, strata: [2] }))).toMatch(/resolved seed/)
  })

  it('reports thrown errors with the seed and stops after maxFailures', () => {
    const fam = make({
      build: () => {
        throw new Error('boom')
      },
    })
    const err = (() => {
      try {
        runFamilyProperties(fam, { n: 100, maxFailures: 3 })
      } catch (e) {
        return e as FamilyPropertyError
      }
      throw new Error('expected failure')
    })()
    expect(err.failures).toHaveLength(3)
    expect(err.failures[0]).toBe('prop-0: threw Error: boom')
    expect(err.message).toMatch(/family toy failed its properties/)
  })
})

describe('specKeyLeaks', () => {
  const item = (spec: JsonObject, key: JsonObject) => healthyItem(spec, key)
  const healthyItem = (spec: JsonObject, key: JsonObject) => ({ ...make({}).generate('x'), spec, key })

  it('flags a verbatim non-trivial key value but not short scalars', () => {
    expect(specKeyLeaks(item({ seq: [7, 2, 9] }, { sequence: [7, 2, 9] }))).toEqual(['spec contains key.sequence verbatim'])
    expect(specKeyLeaks(item({ seq: [7, 2, 9] }, { sequence: [7, 2, 9] }), true)).toEqual([])
    expect(specKeyLeaks(item({ options: [1, 2, 3, 4] }, { index: 2 }))).toEqual([])
    expect(specKeyLeaks(item({ words: ['cheese', 'swiss'] }, { word: 'cheese' }))).toEqual(['spec contains key.word verbatim'])
  })

  it('flags banned field names at any depth', () => {
    for (const name of BANNED_SPEC_FIELDS) {
      expect(specKeyLeaks(item({ a: [{ [name]: 0 }] }, { index: 1 }), true)).toEqual([`spec has a field named "${name}" at spec.a[0]`])
    }
  })
})

describe('testing.ts stays out of the app bundle', () => {
  it('no non-test module imports it', () => {
    const sources = import.meta.glob(['/src/**/*.ts', '/src/**/*.svelte', '!/src/**/*.test.ts'], {
      query: '?raw',
      import: 'default',
      eager: true,
    })
    const offenders = Object.entries(sources)
      .filter(([, src]) => /from\s+['"][^'"]*\/testing['"]|import\(\s*['"][^'"]*\/testing['"]/.test(src as string))
      .map(([path]) => path)
    expect(Object.keys(sources).length).toBeGreaterThan(10)
    expect(offenders).toEqual([])
  })
})
