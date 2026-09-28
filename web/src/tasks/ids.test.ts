import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { cyrb128, type JsonValue } from '../engine'
import {
  FAMILY_ID_RE,
  PY_TWIN_BUILD,
  STRATA,
  canonicalJson,
  familyId,
  isPyTwinVersion,
  isStratum,
  itemId,
  parseItemId,
  resolveSeed,
  stratumSeed,
  structuralHash,
} from './ids'

/** Shuffle an object's own keys (deeply) with a fast-check-chosen permutation seed. */
function reorderKeys(v: unknown, rot: number): unknown {
  if (Array.isArray(v)) return v.map((x) => reorderKeys(x, rot))
  if (typeof v === 'object' && v !== null) {
    const entries = Object.entries(v)
    const k = entries.length === 0 ? 0 : rot % entries.length
    const rotated = [...entries.slice(k), ...entries.slice(0, k)].reverse()
    return Object.fromEntries(rotated.map(([key, x]) => [key, reorderKeys(x, rot + 1)]))
  }
  return v
}

describe('itemId / parseItemId (A11)', () => {
  it('formats i:<fam>:<genver>:<seed>', () => {
    expect(itemId('rot', '1.2.0', 'dump-7')).toBe('i:rot:1.2.0:dump-7')
  })

  it('round-trips any non-empty seed, including colons and the stratum suffix', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (seed) => {
        const id = itemId('mat', '2.0.1', seed)
        expect(parseItemId(id)).toEqual({ family: 'mat', generatorVersion: '2.0.1', seed })
      }),
    )
    expect(parseItemId('i:ser:1.0.0:a:b@s3')).toEqual({ family: 'ser', generatorVersion: '1.0.0', seed: 'a:b@s3' })
  })

  it('rejects bad names, versions and empty seeds', () => {
    expect(() => itemId('Rot', '1', 's')).toThrow(RangeError)
    expect(() => itemId('rot:x', '1', 's')).toThrow(RangeError)
    expect(() => itemId('rot', '1:0', 's')).toThrow(RangeError)
    expect(() => itemId('rot', '', 's')).toThrow(RangeError)
    expect(() => itemId('rot', '1', '')).toThrow(RangeError)
  })

  it('accepts the bank twin build tag `+py` (A11): one id per implementation', () => {
    expect(PY_TWIN_BUILD).toBe('+py')
    const twin = itemId('rotation', '1.0.0+py', 'a:b@s3')
    expect(twin).toBe('i:rotation:1.0.0+py:a:b@s3')
    expect(parseItemId(twin)).toEqual({ family: 'rotation', generatorVersion: '1.0.0+py', seed: 'a:b@s3' })
    expect(parseItemId('i:rotation:1.0.0:a:b@s3')?.generatorVersion).toBe('1.0.0')
    expect(isPyTwinVersion('1.0.0+py')).toBe(true)
    for (const v of ['1.0.0', '1.0.0+ts', '1.0.0+py+py', '+py', '1.0.0+PY', '1:0+py']) {
      expect(isPyTwinVersion(v)).toBe(false)
    }
  })

  it('parseItemId returns null for non-procedural ids', () => {
    for (const bad of ['', 'i:rot:1', 'f:rot:abc', 'i:Rot:1:s', 'i:rot::s', 'x:rot:1:s']) {
      expect(parseItemId(bad)).toBeNull()
    }
  })
})

describe('canonicalJson', () => {
  it('sorts keys recursively and drops whitespace', () => {
    expect(canonicalJson({ b: [3, { z: 1, a: 2 }], a: 'x' })).toBe('{"a":"x","b":[3,{"a":2,"z":1}]}')
  })

  it('is invariant to key order', () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.nat(), (v, rot) => {
        expect(canonicalJson(reorderKeys(v, rot))).toBe(canonicalJson(v))
      }),
    )
  })

  it('round-trips through JSON.parse', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        const s = canonicalJson(v)
        expect(canonicalJson(JSON.parse(s))).toBe(s)
      }),
    )
  })

  it('throws on anything that is not plain JSON', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError)
    expect(() => canonicalJson(Infinity)).toThrow(TypeError)
    expect(() => canonicalJson(undefined)).toThrow(TypeError)
    expect(() => canonicalJson({ a: undefined })).toThrow(TypeError)
    expect(() => canonicalJson(new Map())).toThrow(TypeError)
    expect(() => canonicalJson(() => 1)).toThrow(TypeError)
    const cyc: Record<string, unknown> = {}
    cyc.self = cyc
    expect(() => canonicalJson(cyc)).toThrow(TypeError)
    expect(canonicalJson(-0)).toBe('0')
  })

  it('throws on sparse arrays instead of writing invalid JSON such as "[,1]"', () => {
    const holey = [, 1]
    expect(() => canonicalJson(holey)).toThrow(/sparse array \(hole at index 0\)/)
    expect(() => canonicalJson({ cells: new Array(9) })).toThrow(TypeError)
    expect(() => familyId('mat', { cells: new Array<number>(2) as unknown as JsonValue })).toThrow(TypeError)
    expect(canonicalJson([null, 1])).toBe('[null,1]')
    expect(canonicalJson([])).toBe('[]')
  })
})

describe('familyId (A11)', () => {
  it('is f:<fam>: + the first 12 hex digits of cyrb128(canonical JSON)', () => {
    const words = cyrb128('{"cells":[[0,0,0],[1,0,0]],"n":2}')
    const hex = words.map((w) => w.toString(16).padStart(8, '0')).join('')
    expect(familyId('rot', { n: 2, cells: [[0, 0, 0], [1, 0, 0]] })).toBe(`f:rot:${hex.slice(0, 12)}`)
  })

  it('pins a known value (a change here re-keys every family: bump generator versions)', () => {
    expect(familyId('example', { pair: [7, 9] })).toBe('f:example:d2b8aab8a215')
    expect(structuralHash({ pair: [7, 9] })).toBe('d2b8aab8a215')
  })

  // The bank pins the same vectors (tests/gen/test_gen_base.py TS_FAMILY_IDS): its Python port
  // must give one structure the same family_id (A11, §8 seen_families across repos).
  it('pins vectors shared with the bank', () => {
    expect(familyId('rot', { n: 2, cells: [[0, 0, 0], [1, 0, 0]] })).toBe('f:rot:e326cc4d9849')
    expect(familyId('rt', { mode: 'choice4', n: 60 })).toBe('f:rt:2e5e49799d33')
    const keys = { b: 1, a: [true, false, null, 'é'], é: 0.5, Z: -0, '\uffff': 1, '😀': 2, '\ue000': 3 }
    expect(canonicalJson(keys)).toBe('{"Z":0,"a":[true,false,null,"é"],"b":1,"é":0.5,"😀":2,"\ue000":3,"\uffff":1}')
    expect(familyId('x', keys)).toBe('f:x:8ce5a82b0deb')
    const odd = ['\ud800', 'a\u2028b', '\u0000\u001f\u007f', '"\\/', 1e-7, 1e21, 2.0]
    expect(canonicalJson(odd)).toBe('["\\ud800","a\u2028b","\\u0000\\u001f\u007f","\\"\\\\/",1e-7,1e+21,2]')
    expect(familyId('x', odd)).toBe('f:x:0c73f55e61ae')
  })

  it('is deterministic, key-order invariant and well-formed', () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.nat(), (v, rot) => {
        const id = familyId('mat', v as JsonValue)
        expect(id).toMatch(FAMILY_ID_RE)
        expect(familyId('mat', reorderKeys(v, rot) as JsonValue)).toBe(id)
      }),
    )
  })

  it('separates different structures (no collisions over 20k distinct inputs)', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 20_000; i++) ids.add(familyId('ser', { rule: 'arith', d: i }))
    expect(ids.size).toBe(20_000)
    expect(familyId('ser', [1, 2])).not.toBe(familyId('ser', [2, 1]))
  })
})

describe('stratum seeds', () => {
  it('isStratum accepts exactly the integers 1–6', () => {
    expect(STRATA).toEqual([1, 2, 3, 4, 5, 6])
    for (const k of STRATA) expect(isStratum(k)).toBe(true)
    for (const bad of [0, 7, 2.5, '3', null, Number.NaN]) expect(isStratum(bad)).toBe(false)
  })

  it('stratumSeed appends @s<k>', () => {
    expect(stratumSeed('abc', 4)).toBe('abc@s4')
    expect(() => stratumSeed('abc', 7 as never)).toThrow(RangeError)
    expect(() => stratumSeed('', 1)).toThrow(RangeError)
  })

  it('resolveSeed folds a requested stratum into the seed and reads it back', () => {
    expect(resolveSeed('x')).toEqual({ seed: 'x' })
    expect(resolveSeed('x', 3)).toEqual({ seed: 'x@s3', stratum: 3 })
    expect(resolveSeed('x@s3')).toEqual({ seed: 'x@s3', stratum: 3 })
    expect(resolveSeed('x@s3', 3)).toEqual({ seed: 'x@s3', stratum: 3 })
    expect(() => resolveSeed('x@s3', 4)).toThrow(RangeError)
    expect(() => resolveSeed('x', 0)).toThrow(RangeError)
    expect(() => resolveSeed('x', 1.5)).toThrow(RangeError)
    expect(() => resolveSeed('')).toThrow(RangeError)
  })

  it('treats out-of-range or bare suffixes as plain seeds', () => {
    expect(resolveSeed('x@s9')).toEqual({ seed: 'x@s9' })
    expect(resolveSeed('@s3')).toEqual({ seed: '@s3' })
    expect(resolveSeed('x@s3y')).toEqual({ seed: 'x@s3y' })
  })

  it('resolving is idempotent', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.option(fc.integer({ min: 1, max: 6 }), { nil: undefined }), (seed, k) => {
        let first: ReturnType<typeof resolveSeed>
        try {
          first = resolveSeed(seed, k)
        } catch {
          return // a seed with a conflicting @s<k> suffix
        }
        expect(resolveSeed(first.seed)).toEqual(first)
      }),
    )
  })
})
