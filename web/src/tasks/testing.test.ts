import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { Rng } from '../engine'
import {
  MalformedResponseError,
  blockScore,
  defineFamily,
  mcResponseIndex,
  verdict,
  type BlockFamily,
  type BlockFamilyDefinition,
  type BlockScore,
  type BuiltItem,
  type ItemFamily,
  type ItemFamilyDefinition,
  type ItemInstance,
  type JsonObject,
} from './family'
import type { Stratum } from './ids'
import {
  BANNED_SPEC_NAME_STEMS,
  BANNED_SPEC_NAME_TOKENS,
  FamilyPropertyError,
  GENERIC_MALFORMED_RESPONSES,
  KEY_ECHO_MIN_SEEN,
  KeyEchoTracker,
  MALFORMED_CHECK_INSTANCES,
  MIN_CONTENT_RATIO,
  VERIFY_INSTANCES,
  isBannedSpecFieldName,
  keyPositionProblems,
  numericValueOf,
  onlySpecFields,
  runFamilyProperties,
  sameScalar,
  specKeyLeaks,
  specNameTokens,
  type FamilyPropertyOptions,
} from './testing'

type Spec = JsonObject
type Key = JsonObject

/** The toy's response check: a finite number, else a MalformedResponseError (M1.F2). */
const numberResponse = (r: unknown): number => {
  if (typeof r !== 'number' || !Number.isFinite(r)) throw new MalformedResponseError(`toy: a response is a finite number, got ${String(r)}`)
  return r
}

/** A healthy numeric-entry toy: x + y with a big structural space. */
const healthy: ItemFamilyDefinition<Spec, Key, number> = {
  name: 'toy',
  kind: 'item',
  axis: 'QR',
  facets: ['toy'],
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
  score: (item, r) => ({ correct: numberResponse(r) === item.key.value ? 1 : 0 }),
}

const RIGHT = (it: ItemInstance<Spec, Key>): number => it.key.value as number
const WRONG = (it: ItemInstance<Spec, Key>): number => (it.key.value as number) + 1

/** Options for tests that probe one property: no family leak check of its own (waived), the toy's responses. */
const W = { specLeaksKeyWaiver: 'contract test of one property', correctResponse: RIGHT, incorrectResponse: WRONG } as const

const make = (over: Partial<ItemFamilyDefinition<Spec, Key, number>>): ItemFamily<Spec, Key, number> => defineFamily({ ...healthy, ...over })

const withBuild = (f: (b: BuiltItem<Spec, Key>) => BuiltItem<Spec, Key>): ItemFamily<Spec, Key, number> =>
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
      correctResponse: RIGHT,
      incorrectResponse: WRONG,
    })
    expect(r.n).toBe(500)
    expect(r.kind).toBe('item')
    expect(r.distinctSiblingGroups).toBe(r.distinctFamilyIds)
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
    const run = (opts: object) => () =>
      runFamilyProperties(fam, { n: 3, correctResponse: RIGHT, incorrectResponse: WRONG, ...opts } as FamilyPropertyOptions<Spec, Key, number>)
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
    const opts = { ...W, n: 50 }
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
      runFamilyProperties(fam, { n: 5, allowKeyInSpec: 'test', correctResponse: RIGHT, incorrectResponse: WRONG, specLeaksKey: (it) => ('stem' in it.spec ? 'stem shows the sum' : null) }),
    )
    expect(msg).toMatch(/specLeaksKey: stem shows the sum/)
    const extra = withBuild((b) => ({ ...b, spec: { ...b.spec, glow: 1 } }))
    expect(failuresOf(() => runFamilyProperties(extra, { n: 5, correctResponse: RIGHT, incorrectResponse: WRONG, specLeaksKey: onlySpecFields('stem', 'operands') }))).toMatch(
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

  it('catches a scorer that rejects the correct response, accepts a wrong one or returns a non-finite value', () => {
    const checked = (f: (item: ItemInstance<Spec, Key>, r: number) => { correct: 0 | 1; value?: number }) =>
      make({ score: (item, r) => (numberResponse(r), f(item, r)) })
    expect(failuresOf(() => runFamilyProperties(checked(() => ({ correct: 0 })), { ...W, n: 3 }))).toMatch(/score\(correctResponse\) gave correct = 0, want 1/)
    expect(failuresOf(() => runFamilyProperties(checked(() => ({ correct: 1 })), { ...W, n: 3 }))).toMatch(/score\(incorrectResponse\) gave correct = 1, want 0/)
    const nan = checked((it, r) => ({ correct: r === it.key.value ? 1 : 0, value: Number.NaN }))
    expect(failuresOf(() => runFamilyProperties(nan, { ...W, n: 3 }))).toMatch(/score value must be a finite number, got NaN/)
    expect(() => runFamilyProperties(checked((it, r) => ({ correct: r === it.key.value ? 1 : 0, value: 2.5 })), { ...W, n: 3 })).not.toThrow()
  })

  it('requires the scoring responses of the family kind (M1.F2)', () => {
    const fam = make({})
    const run = (opts: object) => () => runFamilyProperties(fam, { specLeaksKeyWaiver: 'x', n: 3, ...opts } as FamilyPropertyOptions<Spec, Key, number>)
    expect(run({})).toThrow(/an item family gives correctResponse and incorrectResponse/)
    expect(run({ correctResponse: RIGHT })).toThrow(/an item family gives correctResponse and incorrectResponse/)
    expect(run({ correctResponse: RIGHT, incorrectResponse: WRONG, validResponse: RIGHT })).toThrow(/not validResponse/)
    expect(run({ correctResponse: RIGHT, incorrectResponse: WRONG })).not.toThrow()
  })

  it('catches a scorer that does not reject malformed responses with a MalformedResponseError (M1.F2)', () => {
    const lenient = make({ score: (item, r) => ({ correct: r === item.key.value ? 1 : 0 }) })
    const msg = failuresOf(() => runFamilyProperties(lenient, { ...W, n: 3 }))
    for (const shown of ['undefined', 'null', 'true', 'NaN', '{}']) expect(msg).toContain(`score(malformed ${shown}) did not throw a MalformedResponseError`)
    const wrongClass = make({
      score: (item, r) => {
        if (typeof r !== 'number') throw new TypeError('not a number')
        return { correct: r === item.key.value ? 1 : 0 }
      },
    })
    expect(failuresOf(() => runFamilyProperties(wrongClass, { ...W, n: 3 }))).toMatch(/threw TypeError, not MalformedResponseError/)
    // Family-specific malformed responses are scored too.
    const extra = { ...W, n: 3, malformedResponses: () => [Number.POSITIVE_INFINITY, 1e400, -1] }
    expect(failuresOf(() => runFamilyProperties(make({}), extra))).toMatch(/score\(malformed -1\) did not throw/)
    expect(GENERIC_MALFORMED_RESPONSES).toHaveLength(5)
    // Only the first MALFORMED_CHECK_INSTANCES instances pay for it.
    let calls = 0
    runFamilyProperties(make({}), { ...W, n: MALFORMED_CHECK_INSTANCES + 5, malformedResponses: () => (calls++, []) })
    expect(calls).toBe(MALFORMED_CHECK_INSTANCES)
  })

  it('catches items of one family_id in two sibling groups', () => {
    const split = make({ build: (rng, ctx) => ({ ...healthy.build(rng, ctx), structural_params: { t: 'one' }, sibling_group: `g:toy:len_${ctx.seed.length}` }) })
    const one = { min: 0.001, reason: 'one family' }
    expect(failuresOf(() => runFamilyProperties(split, { ...W, n: 12, familyIdRatio: one }))).toMatch(/prop-10: family_id \S+ is in sibling groups g:toy:len_6 and g:toy:len_7/)
    const grouped = withBuild((b) => ({ ...b, sibling_group: 'g:toy:sums' }))
    expect(runFamilyProperties(grouped, { ...W, n: 20 }).distinctSiblingGroups).toBe(1)
  })

  it('catches a hand-written family whose ids ignore the seed or the stratum', () => {
    const good = make({})
    const sameId: ItemFamily<Spec, Key, number> = {
      ...good,
      generate: (seed, opts) => ({ ...good.generate(seed, opts), seed: 'fixed', item_id: 'i:toy:1.0.0:fixed' }),
    }
    const msg = failuresOf(() => runFamilyProperties(sameId, { ...W, n: 50 }))
    expect(msg).toMatch(/recorded seed "fixed" is not the resolved seed/)
    const ignoresStratum: ItemFamily<Spec, Key, number> = { ...good, generate: (seed) => good.generate(seed) }
    expect(failuresOf(() => runFamilyProperties(ignoresStratum, { ...W, n: 20, strata: [2] }))).toMatch(/resolved seed/)
  })

  it('catches a family that records the right seed but returns another stratum', () => {
    const good = make({})
    const wrongStratum: ItemFamily<Spec, Key, number> = {
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
    const drifts: ItemFamily<Spec, Key, number> = {
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

/** A 4-option MC toy: which option is x + y (options in display order, M1.13). */
const mcToy = (keyAt?: number): ItemFamily<Spec, Key, number> =>
  defineFamily<Spec, Key, number>({
    ...healthy,
    name: 'mctoy',
    itemType: 'mc',
    build(rng, ctx) {
      const b = healthy.build(rng, ctx)
      const sum = b.key.value as number
      const options = rng.shuffle([sum, sum + 1, sum + 2, sum + 3])
      const order = keyAt === undefined ? options : [sum, sum + 1, sum + 2, sum + 3]
      return { ...b, spec: { stem: b.spec.stem as string, options: order }, key: { index: order.indexOf(sum) }, options_count: 4 }
    },
    verify: (item) => verdict({ keyed: (item.spec.options as number[])[item.key.index as number] === (item.structural_params as { x: number; y: number }).x + (item.structural_params as { x: number; y: number }).y }),
    score: (item, r) => ({ correct: mcResponseIndex(item, r) === item.key.index ? 1 : 0 }),
  })

describe('MC option display order (M1.13, M1.F2)', () => {
  const opts = {
    ...W,
    correctResponse: (it: ItemInstance<Spec, Key>) => it.key.index as number,
    incorrectResponse: (it: ItemInstance<Spec, Key>) => ((it.key.index as number) + 1) % 4,
  }

  it('passes shuffled options and catches a keyed display order', () => {
    expect(runFamilyProperties(mcToy(), { ...opts, n: 400 }).n).toBe(400)
    expect(failuresOf(() => runFamilyProperties(mcToy(0), { ...opts, n: 400 }))).toMatch(
      /option position 0 of 4 holds the key in 400\/400 MC items .*the display order is keyed/,
    )
  })

  it('keyPositionProblems judges each position within 5 binomial SDs, once there are enough items', () => {
    expect(keyPositionProblems(new Map([[4, [25, 25, 25, 25]]]))).toEqual([])
    expect(keyPositionProblems(new Map([[4, [79, 0, 0, 0]]]))).toEqual([]) // < 20 per option: not judged
    expect(keyPositionProblems(new Map([[4, [100, 100, 100, 100]]]))).toEqual([])
    expect(keyPositionProblems(new Map([[4, [150, 90, 80, 80]]]))).toHaveLength(1) // 150 > 100 + 5·8.66
    expect(keyPositionProblems(new Map([[6, [60, 20, 20, 20, 20, 0]]]))).toHaveLength(2)
  })
})

/** The toy block's response check: up to 4 trials of 0/1, else a MalformedResponseError. */
const toyTrials = (r: unknown): number[] => {
  if (!Array.isArray(r) || r.length > 4 || !r.every((x) => x === 0 || x === 1)) throw new MalformedResponseError('toy block: up to 4 trials of 0/1')
  return r as number[]
}

/** A GRM toy block: a stream of 0/1 trials; y = number correct, no observation until 4 trials. */
const blockToy: BlockFamilyDefinition<Spec, Key, number[]> = {
  name: 'blocktoy',
  kind: 'block',
  axis: 'WM',
  facets: ['toy_block'],
  generatorVersion: '1.0.0',
  itemType: 'toy_block',
  strata: [3],
  build(rng) {
    const trials = Array.from({ length: 4 }, () => rng.int(1, 9))
    return {
      stratum: 3,
      spec: { trials },
      key: { trials_total: trials.reduce((s, v) => s + v, 0) },
      structural_params: { n: 4 },
      difficulty: { features: {}, b_prior: 0, sd_prior: 1, provenance: 'test' },
      expected_time_s: 60,
      params: { model: 'grm', a: 1.5, b: [-1, 0, 1, 2] },
    }
  },
  verify: () => verdict({ ok: true }),
  score(item, r): BlockScore {
    toyTrials(r)
    const p = item.params as unknown as { a: number; b: number[] }
    return r.length < 4 ? blockScore(null, [], ['unfinished']) : blockScore({ kind: 'grm', axis: 'WM', a: p.a, b: [...p.b], y: r.reduce((s: number, v) => s + v, 0) })
  },
}
const blockOpts = {
  specLeaksKeyWaiver: 'toy',
  familyIdRatio: { min: 0.001, reason: 'one structure' },
  validResponse: (_it: ItemInstance<Spec, Key>, rng: Rng) => Array.from({ length: 4 }, () => rng.int(0, 1)),
  invalidResponse: (_it: ItemInstance<Spec, Key>, rng: Rng) => Array.from({ length: rng.int(0, 3) }, () => 1),
  malformedResponses: () => [[2], [0, 0, 0, 0, 0], 'x'],
} as const
const makeBlock = (score: BlockFamilyDefinition<Spec, Key, number[]>['score']): BlockFamily<Spec, Key, number[]> => defineFamily({ ...blockToy, score })

describe('block-aware scoring suite (M1.F2)', () => {
  const grmOf = (_item: ItemInstance<Spec, Key>, y: number) => ({ kind: 'grm' as const, axis: 'WM' as const, a: 1.5, b: [-1, 0, 1, 2], y })

  it('passes a healthy block family and requires validResponse + invalidResponse', () => {
    const fam = defineFamily(blockToy)
    const r = runFamilyProperties(fam, { ...blockOpts, n: 300 })
    expect(r.kind).toBe('block')
    const bad = (o: object) => () => runFamilyProperties(fam, { specLeaksKeyWaiver: 'x', n: 2, ...o } as FamilyPropertyOptions<Spec, Key, number[]>)
    expect(bad({ validResponse: blockOpts.validResponse })).toThrow(/a block family gives validResponse and invalidResponse/)
    expect(bad({ ...blockOpts, correctResponse: () => [1] })).toThrow(/not correctResponse/)
  })

  it('catches a valid response without an observation, or an invalid one with an observation', () => {
    const never = makeBlock((_it, r) => (toyTrials(r), blockScore(null, [], ['unfinished'])))
    expect(failuresOf(() => runFamilyProperties(never, { ...blockOpts, n: 3 }))).toMatch(/validResponse: a valid block response must yield an observation \(reasons: unfinished\)/)
    const always = makeBlock((it, r) => (toyTrials(r), blockScore(grmOf(it, 0))))
    expect(failuresOf(() => runFamilyProperties(always, { ...blockOpts, n: 3 }))).toMatch(/invalidResponse: an invalid block response must yield no observation/)
  })

  it('catches observations that do not match the item (axis, params, category) and bad tokens', () => {
    const cases: [string, (it: ItemInstance<Spec, Key>) => BlockScore, RegExp][] = [
      ['axis', (it) => ({ correct: null, observation: { ...grmOf(it, 1), axis: 'MAT' }, flags: [], reasons: [] }), /observation axis MAT is not the item's WM/],
      ['a', (it) => ({ correct: null, observation: { ...grmOf(it, 1), a: 2 }, flags: [], reasons: [] }), /GRM observation a\/b must be the item params/],
      ['y', (it) => ({ correct: null, observation: grmOf(it, 5), flags: [], reasons: [] }), /GRM category 5 is outside 0..4/],
      ['kind', () => ({ correct: null, observation: { kind: 'gaussian', axis: 'WM', lam: 1, d: 0, sigma: 1, x: 0 }, flags: [], reasons: [] }), /observation kind gaussian does not match params.model grm/],
      ['reasons with an observation', (it) => ({ correct: null, observation: grmOf(it, 1), flags: [], reasons: ['late'] }), /must give no reasons/],
      ['flag token', (it) => ({ correct: null, observation: grmOf(it, 1), flags: ['Too Fast'], reasons: [] }), /flags must be an array of/],
      ['correct', (it) => ({ correct: 1 as never, observation: grmOf(it, 1), flags: [], reasons: [] }), /correct must be null/],
    ]
    for (const [name, obs, re] of cases) {
      const fam = makeBlock((it, r) => {
        toyTrials(r)
        return r.length === 4 ? obs(it) : blockScore(null, [], ['unfinished'])
      })
      expect(failuresOf(() => runFamilyProperties(fam, { ...blockOpts, n: 2 })), name).toMatch(re)
    }
    const noReason = makeBlock((it, r) => (toyTrials(r), r.length === 4 ? blockScore(grmOf(it, 1)) : { correct: null, flags: [], reasons: [] }))
    expect(failuresOf(() => runFamilyProperties(noReason, { ...blockOpts, n: 2 }))).toMatch(/a block without an observation must give ≥ 1 reason/)
  })

  it('checks Gaussian observations against params: lam, d and sigma ≥ params.sigma (tau_res)', () => {
    const gauss: BlockFamilyDefinition<Spec, Key, number[]> = {
      ...blockToy,
      build: (rng, ctx) => ({ ...blockToy.build(rng, ctx), params: { model: 'gaussian', lam: 0.25, d: 3, sigma: 0.05 } }),
      score: (_it, r) => {
        toyTrials(r)
        return r.length < 4 ? blockScore(null, [], ['unfinished']) : blockScore({ kind: 'gaussian', axis: 'WM', lam: 0.25, d: 3, sigma: Math.sqrt(0.01 + 0.0025), x: 1 })
      },
    }
    expect(runFamilyProperties(defineFamily(gauss), { ...blockOpts, n: 50 }).n).toBe(50)
    const thin = { ...gauss, score: (it: ItemInstance<Spec, Key>, r: number[]) => (gauss.score(it, r).observation ? blockScore({ kind: 'gaussian', axis: 'WM', lam: 0.25, d: 3, sigma: 0.04, x: 1 }) : blockScore(null, [], ['unfinished'])) }
    expect(failuresOf(() => runFamilyProperties(defineFamily(thin), { ...blockOpts, n: 2 }))).toMatch(/observation sigma 0.04 < params.sigma \(tau_res\) 0.05/)
    const moved = { ...gauss, score: (it: ItemInstance<Spec, Key>, r: number[]) => (gauss.score(it, r).observation ? blockScore({ kind: 'gaussian', axis: 'WM', lam: 0.25, d: 3.5, sigma: 0.1, x: 1 }) : blockScore(null, [], ['unfinished'])) }
    expect(failuresOf(() => runFamilyProperties(defineFamily(moved), { ...blockOpts, n: 2 }))).toMatch(/lam\/d must be the item params/)
  })

  it('scores the family-specific malformed responses of blocks too', () => {
    const lenient = makeBlock((it, r) => (Array.isArray(r) && r.length > 4 ? blockScore(null, [], ['too_long']) : blockToy.score(it, r)))
    expect(failuresOf(() => runFamilyProperties(lenient, { ...blockOpts, n: 2 }))).toMatch(/score\(malformed \[0,0,0,0,0\]\) did not throw/)
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

  it('is numeric-aware: canonical rational key strings match numbers of the same value (M1.F2)', () => {
    expect(run(40, (i) => ({ spec: { total: i * 7 }, key: { value: String(i * 7), tol: { abs: 0 } } }))).toEqual([
      'spec.total equals key.value in all 40 instances (a scalar copy of the key)',
    ])
    expect(run(40, (i) => ({ spec: { ratio: (i + 1) / 8 }, key: { value: `${i + 1}/8`, tol: { abs: 0 } } }))).toEqual([
      'spec.ratio equals key.value in all 40 instances (a scalar copy of the key)',
    ])
    expect(run(40, (i) => ({ spec: { shown: String(-i) }, key: { value: -i } }))).toEqual(['spec.shown equals key.value in all 40 instances (a scalar copy of the key)'])
    // Not a canonical rational (a leading "+", a space, a decimal point): not the key's number.
    expect(run(40, (i) => ({ spec: { total: i }, key: { value: `+${i}` } }))).toEqual([])
    expect(run(40, (i) => ({ spec: { total: i + 0.5 }, key: { value: `${i}.5` } }))).toEqual([])
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

describe('numericValueOf / sameScalar (numeric-aware echo, M1.F2)', () => {
  it('reads numbers and canonical rational strings, nothing else', () => {
    expect(numericValueOf(42)).toBe(42)
    expect(numericValueOf('42')).toBe(42)
    expect(numericValueOf('-7')).toBe(-7)
    expect(numericValueOf('3/8')).toBe(0.375)
    expect(numericValueOf('-1/3')).toBe(-1 / 3)
    for (const v of ['+4', ' 4', '4.0', '1/0', '01', 'x', '', true, Number.NaN, Number.POSITIVE_INFINITY]) expect(numericValueOf(v), String(v)).toBeUndefined()
  })

  it('property: an integer and its canonical string are the same scalar; distinct integers are not', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e12, max: 1e12 }), fc.integer({ min: -1e12, max: 1e12 }), (a, b) => {
        expect(sameScalar(String(a), a)).toBe(true)
        expect(sameScalar(a, String(a))).toBe(true)
        expect(sameScalar(String(a), b)).toBe(a === b)
      }),
    )
  })

  it('property: p/q equals the double p / q, and booleans only equal themselves', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e6, max: 1e6 }), fc.integer({ min: 1, max: 1e6 }), fc.boolean(), (p, q, flag) => {
        expect(sameScalar(`${p}/${q}`, p / q)).toBe(true)
        expect(sameScalar(flag, flag)).toBe(true)
        expect(sameScalar(flag, Number(flag))).toBe(false)
      }),
    )
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
