import { describe, expect, it } from 'vitest'
import {
  defineFamily,
  verdict,
  type BuiltItem,
  type FamilyDefinition,
  type ItemInstance,
  type JsonObject,
  type ProceduralFamily,
} from './family'
import type { Stratum } from './ids'
import {
  BANNED_SPEC_NAME_STEMS,
  BANNED_SPEC_NAME_TOKENS,
  FamilyPropertyError,
  KEY_ECHO_MIN_SEEN,
  KeyEchoTracker,
  MIN_CONTENT_RATIO,
  VERIFY_INSTANCES,
  isBannedSpecFieldName,
  onlySpecFields,
  runFamilyProperties,
  specKeyLeaks,
  specNameTokens,
  type FamilyPropertyOptions,
} from './testing'

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

/** Options for tests that probe one property: no family leak check of its own (waived). */
const W = { specLeaksKeyWaiver: 'contract test of one property' } as const

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
    const r = runFamilyProperties(fam, {
      n: 500,
      specLeaksKey: onlySpecFields('stem', 'operands'),
      correctResponse: (it) => it.key.value as number,
    })
    expect(r.n).toBe(500)
    expect(r.distinctItemIds).toBe(500)
    expect(r.distinctContents).toBe(500)
    expect(r.distinctFamilyIds).toBeGreaterThan(495)
    expect(r.bPrior.min).toBe(-1)
    expect(r.bPrior.max).toBe(1)
    const s = runFamilyProperties(fam, { ...W, n: 300, strata: [1, 3] })
    expect(s.strataCounts).toEqual({ 1: 150, 2: 0, 3: 150, 4: 0, 5: 0, 6: 0 })
    expect(VERIFY_INSTANCES).toBe(10_000)
    expect(MIN_CONTENT_RATIO).toBe(0.95)
  })

  it('requires a family leak check or a documented waiver, not both', () => {
    const fam = make({})
    const run = (opts: object) => () => runFamilyProperties(fam, { n: 3, ...opts } as FamilyPropertyOptions<Spec, Key, number>)
    expect(run({})).toThrow(/exactly one of specLeaksKey/)
    expect(run({ specLeaksKey: () => null, specLeaksKeyWaiver: 'x' })).toThrow(/exactly one of specLeaksKey/)
    expect(run({ specLeaksKeyWaiver: '  ' })).toThrow(/specLeaksKeyWaiver needs a documented reason/)
    expect(run({ specLeaksKey: () => null })).not.toThrow()
    // @ts-expect-error: the options type requires specLeaksKey or specLeaksKeyWaiver
    expect(() => runFamilyProperties(fam, { n: 3 })).toThrow(RangeError)
  })

  it('catches a verifier that rejects instances', () => {
    const fam = make({ verify: (it) => verdict({ small: (it.key.value as number) < 100_000 }) })
    expect(failuresOf(() => runFamilyProperties(fam, { ...W, n: 200 }))).toMatch(/verify failed: failed: small/)
  })

  it('catches non-determinism', () => {
    let calls = 0
    const fam = withBuild((b) => ({ ...b, spec: { ...b.spec, calls: calls++ } }))
    expect(failuresOf(() => runFamilyProperties(fam, { ...W, n: 5 }))).toMatch(/not deterministic/)
  })

  it('catches a key leaked into the spec', () => {
    const fam = withBuild((b) => ({ ...b, spec: { ...b.spec, hint: { ...b.key } } }))
    expect(failuresOf(() => runFamilyProperties(fam, { ...W, n: 5 }))).toMatch(/serialised key/)
    const named = withBuild((b) => ({ ...b, spec: { ...b.spec, options: [{ text: 'a', Correct: false }] } }))
    expect(failuresOf(() => runFamilyProperties(named, { ...W, n: 5 }))).toMatch(/field named "Correct"/)
  })

  it('catches a numeric-entry family that ships its answer in the spec (camelCase or any name)', () => {
    const camel = withBuild((b) => ({ ...b, spec: { ...b.spec, correctAnswer: b.key.value as number } }))
    const opts = { ...W, n: 50, correctResponse: (it: ItemInstance<Spec, Key>) => it.key.value as number }
    expect(failuresOf(() => runFamilyProperties(camel, opts))).toMatch(/field named "correctAnswer" at spec/)
    const plain = withBuild((b) => ({ ...b, spec: { ...b.spec, total: b.key.value as number } }))
    expect(failuresOf(() => runFamilyProperties(plain, opts))).toMatch(
      /spec\.total equals key\.value in all 50 instances \(a scalar copy of the key\)/,
    )
    expect(() => runFamilyProperties(plain, { ...opts, allowKeyInSpec: 'stimuli are the key by design' })).not.toThrow()
  })

  it('runs the family-provided leak predicate even when key values may appear in the spec', () => {
    const fam = make({})
    const msg = failuresOf(() =>
      runFamilyProperties(fam, { n: 5, allowKeyInSpec: 'test', specLeaksKey: (it) => ('stem' in it.spec ? 'stem shows the sum' : null) }),
    )
    expect(msg).toMatch(/specLeaksKey: stem shows the sum/)
    const extra = withBuild((b) => ({ ...b, spec: { ...b.spec, glow: 1 } }))
    expect(failuresOf(() => runFamilyProperties(extra, { n: 5, specLeaksKey: onlySpecFields('stem', 'operands') }))).toMatch(
      /specLeaksKey: unexpected spec fields: glow/,
    )
  })

  it('catches too few distinct family_ids unless a documented override is given', () => {
    const fam = withBuild((b) => ({ ...b, structural_params: { template: 'sum' } }))
    expect(failuresOf(() => runFamilyProperties(fam, { ...W, n: 100 }))).toMatch(/1\/100 distinct family_ids/)
    expect(runFamilyProperties(fam, { ...W, n: 100, familyIdRatio: { min: 0.01, reason: 'one template' } }).distinctFamilyIds).toBe(1)
    expect(() => runFamilyProperties(fam, { ...W, n: 100, familyIdRatio: { min: 0.01, reason: ' ' } })).toThrow(RangeError)
    expect(() => runFamilyProperties(fam, { ...W, n: 100, allowKeyInSpec: '' })).toThrow(RangeError)
  })

  it('catches seeds that give the same content (distinct ids are not enough)', () => {
    const constant = withBuild((b) => ({
      ...b,
      spec: { stem: '1 plus 2', operands: [1, 2] },
      key: { value: 3, tol: 0 },
      structural_params: { x: 1, y: 2 },
    }))
    const one = { min: 0.01, reason: 'one item' }
    const msg = failuresOf(() => runFamilyProperties(constant, { ...W, n: 50, familyIdRatio: one }))
    expect(msg).toMatch(/only 1\/50 distinct contents \(spec \+ key; need ≥ 95%\)/)
    const r = runFamilyProperties(constant, { ...W, n: 50, familyIdRatio: one, contentRatio: one })
    expect([r.distinctItemIds, r.distinctContents]).toEqual([50, 1])
    expect(() => runFamilyProperties(constant, { ...W, n: 50, familyIdRatio: one, contentRatio: { min: 0.01, reason: '' } })).toThrow(
      /contentRatio needs a documented reason/,
    )
  })

  it('catches out-of-range priors, times and JSON-unsafe instances', () => {
    const big = withBuild((b) => ({ ...b, difficulty: { ...b.difficulty, b_prior: 4.2 } }))
    expect(failuresOf(() => runFamilyProperties(big, { ...W, n: 3 }))).toMatch(/b_prior/)
    const slow = withBuild((b) => ({ ...b, expected_time_s: 0 }))
    expect(failuresOf(() => runFamilyProperties(slow, { ...W, n: 3 }))).toMatch(/expected_time_s/)
    const unsafe = withBuild((b) => ({ ...b, spec: { ...b.spec, when: undefined as never } }))
    expect(failuresOf(() => runFamilyProperties(unsafe, { ...W, n: 3 }))).toMatch(/plain JSON/)
    const holey = withBuild((b) => ({ ...b, spec: { ...b.spec, cells: new Array<number>(9) } }))
    expect(failuresOf(() => runFamilyProperties(holey, { ...W, n: 3 }))).toMatch(/plain JSON/)
  })

  it('catches an instance that does not survive the JSON round trip', () => {
    // A hidden (non-enumerable) toJSON passes the plain-JSON checks but changes JSON.stringify.
    const hidden = withBuild((b) => {
      const spec = { ...b.spec }
      Object.defineProperty(spec, 'toJSON', { value: () => ({ stem: 'swapped' }), enumerable: false })
      return { ...b, spec }
    })
    expect(failuresOf(() => runFamilyProperties(hidden, { ...W, n: 3 }))).toMatch(/JSON round trip changed the item/)
  })

  it('catches a scorer that rejects the correct response or returns a non-finite value', () => {
    const correct = (it: ItemInstance<Spec, Key>) => it.key.value as number
    const fam = make({ score: () => ({ correct: 0 }) })
    expect(failuresOf(() => runFamilyProperties(fam, { ...W, n: 3, correctResponse: correct }))).toMatch(/correct = 0/)
    const nan = make({ score: () => ({ correct: 1, value: Number.NaN }) })
    expect(failuresOf(() => runFamilyProperties(nan, { ...W, n: 3, correctResponse: correct }))).toMatch(
      /score value must be a finite number, got NaN/,
    )
    expect(() => runFamilyProperties(make({ score: () => ({ correct: 1, value: 2.5 }) }), { ...W, n: 3, correctResponse: correct })).not.toThrow()
  })

  it('catches a hand-written family whose ids ignore the seed or the stratum', () => {
    const good = make({})
    const sameId: ProceduralFamily<Spec, Key, number> = {
      ...good,
      generate: (seed, opts) => ({ ...good.generate(seed, opts), seed: 'fixed', item_id: 'i:toy:1.0.0:fixed' }),
    }
    const msg = failuresOf(() => runFamilyProperties(sameId, { ...W, n: 50 }))
    expect(msg).toMatch(/recorded seed "fixed" is not the resolved seed/)
    const ignoresStratum: ProceduralFamily<Spec, Key, number> = { ...good, generate: (seed) => good.generate(seed) }
    expect(failuresOf(() => runFamilyProperties(ignoresStratum, { ...W, n: 20, strata: [2] }))).toMatch(/resolved seed/)
  })

  it('catches a family that records the right seed but returns another stratum', () => {
    const good = make({})
    const wrongStratum: ProceduralFamily<Spec, Key, number> = {
      ...good,
      generate: (seed, opts) => {
        const item = good.generate(seed, opts)
        return opts?.stratum === undefined ? item : { ...item, stratum: ((opts.stratum % 3) + 1) as Stratum }
      },
    }
    const msg = failuresOf(() => runFamilyProperties(wrongStratum, { ...W, n: 5, strata: [2] }))
    expect(msg).toMatch(/requested stratum 2, got 3/)
    expect(msg).not.toMatch(/resolved seed/)
  })

  it('catches a stratum-targeted item that its item_id does not rebuild (A11)', () => {
    const good = make({})
    const drifts: ProceduralFamily<Spec, Key, number> = {
      ...good,
      generate: (seed, opts) => (opts?.stratum === undefined ? { ...good.generate(seed), time_limit_s: 99 } : good.generate(seed, opts)),
    }
    const msg = failuresOf(() => runFamilyProperties(drifts, { ...W, n: 5, strata: [1, 2] }))
    expect(msg).toMatch(/generate\(seed from item_id\) does not rebuild the item/)
    expect(msg).not.toMatch(/resolved seed|requested stratum|deterministic/)
  })

  it('reports thrown errors with the seed and stops after maxFailures', () => {
    const fam = make({
      build: () => {
        throw new Error('boom')
      },
    })
    const err = (() => {
      try {
        runFamilyProperties(fam, { ...W, n: 100, maxFailures: 3 })
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
  const item = (spec: JsonObject, key: JsonObject) => ({ ...make({}).generate('x'), spec, key })

  it('flags a verbatim non-trivial key value but not short scalars', () => {
    expect(specKeyLeaks(item({ seq: [7, 2, 9] }, { sequence: [7, 2, 9] }))).toEqual(['spec contains key.sequence verbatim'])
    expect(specKeyLeaks(item({ seq: [7, 2, 9] }, { sequence: [7, 2, 9] }), true)).toEqual([])
    expect(specKeyLeaks(item({ options: [1, 2, 3, 4] }, { index: 2 }))).toEqual([])
    expect(specKeyLeaks(item({ words: ['cheese', 'swiss'] }, { word: 'cheese' }))).toEqual(['spec contains key.word verbatim'])
  })

  it('flags banned field names at any depth and in any case style', () => {
    const leaky = [
      ...BANNED_SPEC_NAME_TOKENS,
      ...BANNED_SPEC_NAME_STEMS,
      'correctIndex',
      'CorrectIndex',
      'correct_index',
      'correct-index',
      'CORRECT_INDEX',
      'correctindex',
      'isCorrect',
      'is_correct',
      'iscorrect',
      'correctOption',
      'answerIndex',
      'correctAnswer',
      'answerValue',
      'rightanswer',
      'answerKey',
      'keyTable',
      'key2',
      'solutionIdx',
      'numAnswers',
    ]
    for (const name of leaky) {
      expect(specKeyLeaks(item({ a: [{ [name]: 0 }] }, { index: 1 }), true)).toEqual([`spec has a field named "${name}" at spec.a[0]`])
    }
    for (const name of ['options', 'stem', 'keypad', 'keyboard', 'monkey', 'turkey_count', 'legend', 'input_format', 'prompt']) {
      expect(isBannedSpecFieldName(name)).toBe(false)
    }
  })

  it('splits names into words at separators, digits and camelCase boundaries', () => {
    expect(specNameTokens('correctIndex')).toEqual(['correct', 'index'])
    expect(specNameTokens('XMLAnswer_value-2b')).toEqual(['xml', 'answer', 'value', '2', 'b'])
    expect(specNameTokens('__')).toEqual([])
  })
})

describe('KeyEchoTracker', () => {
  const base = make({}).generate('echo')
  const run = (n: number, f: (i: number) => { spec: JsonObject; key: JsonObject }): string[] => {
    const t = new KeyEchoTracker()
    for (let i = 0; i < n; i++) t.observe({ ...base, ...f(i) })
    return t.problems()
  }

  it('flags a spec leaf that always equals (or, for booleans, negates) a key leaf', () => {
    expect(run(40, (i) => ({ spec: { options: [3, 5, 7, 9], pick: i % 4 }, key: { index: i % 4 } }))).toEqual([
      'spec.pick equals key.index in all 40 instances (a scalar copy of the key)',
    ])
    expect(run(40, (i) => ({ spec: { shapes: [{ mirrored: i % 2 === 1 }] }, key: { same: i % 2 === 0 } }))).toEqual([
      'spec.shapes[0].mirrored is the negation of key.same in all 40 instances (a scalar copy of the key)',
    ])
    expect(run(40, (i) => ({ spec: { meta: { r: { num: i } } }, key: { value: { num: i, den: 7 } } }))).toEqual([
      'spec.meta.r.num equals key.value.num in all 40 instances (a scalar copy of the key)',
    ])
  })

  it('ignores coincidences, constant key leaves and paths seen too rarely', () => {
    // A series whose last term sometimes equals the answer: not every instance, so not a copy.
    expect(run(200, (i) => ({ spec: { terms: [1, 2, i % 5 === 0 ? i : 0] }, key: { value: i } }))).toEqual([])
    // tol is always 0 and so is spec.offset: agreement is chance (Σp² = 1).
    expect(run(200, (i) => ({ spec: { offset: 0, x: i }, key: { value: i + 1, tol: 0 } }))).toEqual([])
    // A path present in fewer than KEY_ECHO_MIN_SEEN instances is not judged.
    expect(run(200, (i) => ({ spec: (i < KEY_ECHO_MIN_SEEN - 1 ? { copy: i } : { x: 0 }) as JsonObject, key: { value: i } }))).toEqual([])
    // Blocks with many key leaves (per-trial keys) are skipped.
    expect(run(40, (i) => ({ spec: { trials: Array.from({ length: 20 }, (_, j) => i + j) }, key: { r: Array.from({ length: 20 }, (_, j) => i + j) } }))).toEqual([])
  })
})

describe('onlySpecFields', () => {
  it('flags top-level spec fields outside the allowlist', () => {
    const it = make({}).generate('only')
    expect(onlySpecFields('stem', 'operands')(it)).toBeNull()
    expect(onlySpecFields('stem')(it)).toBe('unexpected spec fields: operands')
  })
})

/** Any import, re-export, side-effect import or dynamic import of `…/testing` (with or without .ts/.js). */
const IMPORTS_TESTING = /(?:\bfrom|\bimport)\s*\(?\s*['"][^'"]*\/testing(?:\.[jt]s)?['"]/

describe('testing.ts stays out of the app bundle', () => {
  it('the import guard matches every import form', () => {
    for (const src of [
      "import { x } from './testing'",
      "import { x } from '../tasks/testing.ts'",
      "export { runFamilyProperties } from './tasks/testing.js'",
      "import './tasks/testing'",
      "const m = await import('./testing')",
      'import type { X } from "./testing"',
    ]) {
      expect(IMPORTS_TESTING.test(src), src).toBe(true)
    }
    for (const src of ["import { x } from './testing-utils'", "import { x } from './testing/more'", "const s = 'see testing'"]) {
      expect(IMPORTS_TESTING.test(src), src).toBe(false)
    }
  })

  it('no non-test module imports it', () => {
    const sources = import.meta.glob(['/src/**/*.ts', '/src/**/*.svelte', '!/src/**/*.test.ts'], {
      query: '?raw',
      import: 'default',
      eager: true,
    })
    const offenders = Object.entries(sources)
      .filter(([, src]) => IMPORTS_TESTING.test(src as string))
      .map(([path]) => path)
    expect(Object.keys(sources).length).toBeGreaterThan(10)
    expect(offenders).toEqual([])
  })
})
