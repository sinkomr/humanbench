import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { axis, AXIS_CODES, type ModelKind } from './axes'
import {
  isJsonValue,
  isResponseTuple,
  type ItemBase,
  type ItemParams,
  type Observation,
  type ObservationKind,
  type ResponseTuple,
} from './types'

describe('ResponseTuple (DESIGN §8)', () => {
  // The two example rows of the §8 save file, typed as tuples (a compile-time check too).
  const examples: ResponseTuple[] = [
    ['i:mat:f0182:v3', 1, 'C', 1, 41250, 80],
    ['i:rt:simple', 0, 'trials', null, 18211, null, [243, 251, 238]],
  ]

  it('accepts the §8 examples, also after a JSON round trip', () => {
    for (const t of examples) {
      expect(isResponseTuple(t)).toBe(true)
      expect(isResponseTuple(JSON.parse(JSON.stringify(t)))).toBe(true)
    }
  })

  it('accepts any well-formed tuple', () => {
    const tuple = fc
      .tuple(
        fc.string({ minLength: 1 }),
        fc.constantFrom<0 | 1>(0, 1),
        fc.jsonValue(),
        fc.constantFrom<0 | 1 | null>(0, 1, null),
        fc.nat({ max: 10_000_000 }),
        fc.option(fc.integer({ min: 50, max: 100 }), { nil: null }),
      )
      .chain((base) =>
        fc.oneof(
          fc.constant<ResponseTuple>(base as ResponseTuple),
          fc.jsonValue().map((extra) => [...base, extra] as ResponseTuple),
        ),
      )
    fc.assert(
      fc.property(tuple, (t) => {
        expect(isResponseTuple(t)).toBe(true)
        expect(isResponseTuple(JSON.parse(JSON.stringify(t)))).toBe(true)
      }),
    )
  })

  it('rejects malformed tuples', () => {
    const bad: unknown[] = [
      null,
      {},
      [],
      ['i:x', 1, 'C', 1, 100], // too short
      ['i:x', 1, 'C', 1, 100, 80, null, 'more'], // too long
      ['', 1, 'C', 1, 100, 80], // empty id
      [42, 1, 'C', 1, 100, 80],
      ['i:x', 2, 'C', 1, 100, 80], // pretest not 0/1
      ['i:x', true, 'C', 1, 100, 80],
      ['i:x', 1, 'C', 0.5, 100, 80], // correct not 0/1/null
      ['i:x', 1, 'C', 1, -1, 80], // negative rt
      ['i:x', 1, 'C', 1, Number.NaN, 80],
      ['i:x', 1, 'C', 1, '100', 80],
      ['i:x', 1, 'C', 1, 100, 101], // confidence out of range
      ['i:x', 1, 'C', 1, 100, undefined],
      ['i:x', 1, undefined, 1, 100, 80], // response not JSON
      ['i:x', 1, new Date(0), 1, 100, 80],
      ['i:x', 1, 'C', 1, 100, 80, undefined],
      ['i:x', 1, 'C', 1, 100, 80, [Infinity]],
    ]
    for (const t of bad) expect(isResponseTuple(t)).toBe(false)
  })
})

describe('isJsonValue', () => {
  it('accepts JSON and rejects non-JSON values', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        expect(isJsonValue(v)).toBe(true)
      }),
    )
    for (const v of [undefined, Number.NaN, Infinity, () => 1, new Map(), Symbol('x'), 1n, [undefined]]) {
      expect(isJsonValue(v)).toBe(false)
    }
    let deep: unknown = 1
    for (let i = 0; i < 100; i++) deep = [deep]
    expect(isJsonValue(deep)).toBe(false)
  })
})

/** Compile-time type equality (both directions). */
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false
const assertType = <T extends true>(): T => true as T

describe('item and observation types', () => {
  it('ItemParams has one variant per ModelKind; Observation kinds are the scorer kinds', () => {
    // Checked by `tsc` (npm run check): a new ModelKind without an ItemParams variant fails here.
    expect(assertType<Equal<ItemParams['model'], ModelKind>>()).toBe(true)
    expect(assertType<Equal<ObservationKind, '2pl' | '3pl' | 'grm' | 'gaussian'>>()).toBe(true)
    expect(assertType<Equal<Extract<Observation, { kind: 'grm' }>['b'], readonly number[]>>()).toBe(true)
  })

  it('ItemParams requires each model’s own fields (compile-time)', () => {
    const ok: ItemParams[] = [
      { model: '2pl', a: 1.2, b: 0.6 },
      { model: '2pl_testlet', a: 1, b: 0 },
      { model: '3pl', a: 1, b: 0, c: 0.25 },
      { model: 'grm', a: 1.4, b: [-1, 0, 1] },
      { model: 'gaussian', lam: -1, d: 0, sigma: 0.3 },
    ]
    const bad: ItemParams[] = [
      // @ts-expect-error a 3PL item needs its guessing parameter c
      { model: '3pl', a: 1, b: 0 },
      // @ts-expect-error a GRM item's b is the threshold array, not a scalar
      { model: 'grm', a: 1, b: 0 },
      // @ts-expect-error a Gaussian item needs lam, d and sigma
      { model: 'gaussian', a: 1, b: 0 },
    ]
    expect(ok.map((p) => p.model)).toEqual(['2pl', '2pl_testlet', '3pl', 'grm', 'gaussian'])
    expect(bad).toHaveLength(3)
  })

  it('models the §12 item record, including a testlet id for 2pl_testlet items', () => {
    const rotation: ItemBase = {
      item_id: 'i:rot:f0042:v1',
      family_id: 'f:rot:0042',
      axis: 'SPA',
      facet: '3d_rotation',
      item_type: 'mc_image_spec',
      gold_tier: 'a',
      time_limit_s: 60,
      expected_time_s: 28,
      params: { model: '2pl', a: 1.2, b: 0.6 },
    }
    const passageQ: ItemBase = {
      item_id: 'i:rc:f0007:q2',
      family_id: 'f:rc:0007',
      axis: 'RC',
      item_type: 'mc',
      gold_tier: 'a',
      testlet_id: 'p:rc:0007',
      expected_time_s: 45,
      params: { model: '2pl_testlet', a: 1.1, b: -0.3 },
    }
    for (const item of [rotation, passageQ]) {
      expect(AXIS_CODES).toContain(item.axis)
      expect(axis(item.axis).modelKind).toBe(item.params.model)
    }
  })
})
