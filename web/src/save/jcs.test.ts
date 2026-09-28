import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../tasks/ids'
import { isIJsonString, jcs, jcsBytes } from './jcs'

/** IEEE-754 double from its 16-hex-digit bit pattern (RFC 8785 Appendix B notation). */
function fromBits(hex: string): number {
  const dv = new DataView(new ArrayBuffer(8))
  dv.setBigUint64(0, BigInt(`0x${hex}`))
  return dv.getFloat64(0)
}

/**
 * An independent RFC 8785 serialiser for cross-checking: explicit §3.2.2.2 string escaping (not
 * JSON.stringify), an explicit UTF-16 code-unit comparator (§3.2.3), and ECMAScript
 * Number::toString for numbers (§3.2.2.3, via String(); -0 → "0").
 */
function referenceJcs(v: unknown): string {
  if (v === null) return 'null'
  if (v === true) return 'true'
  if (v === false) return 'false'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new TypeError('non-finite')
    return Object.is(v, -0) ? '0' : String(v)
  }
  if (typeof v === 'string') {
    let out = '"'
    for (let i = 0; i < v.length; i++) {
      const c = v.charCodeAt(i)
      if (c === 0x22) out += '\\"'
      else if (c === 0x5c) out += '\\\\'
      else if (c === 0x08) out += '\\b'
      else if (c === 0x09) out += '\\t'
      else if (c === 0x0a) out += '\\n'
      else if (c === 0x0c) out += '\\f'
      else if (c === 0x0d) out += '\\r'
      else if (c < 0x20) out += `\\u${c.toString(16).padStart(4, '0')}`
      else out += v[i]
    }
    return `${out}"`
  }
  if (Array.isArray(v)) return `[${v.map(referenceJcs).join(',')}]`
  const keys = Object.keys(v as object)
  keys.sort((a, b) => {
    const n = Math.min(a.length, b.length)
    for (let i = 0; i < n; i++) {
      const d = a.charCodeAt(i) - b.charCodeAt(i)
      if (d !== 0) return d
    }
    return a.length - b.length
  })
  return `{${keys.map((k) => `${referenceJcs(k)}:${referenceJcs((v as Record<string, unknown>)[k])}`).join(',')}}`
}

describe('RFC 8785 canonical JSON (DESIGN §8 MAC input)', () => {
  it('serialises the RFC Appendix B numbers exactly', () => {
    const vectors: [string, string][] = [
      ['0000000000000000', '0'],
      ['8000000000000000', '0'],
      ['0000000000000001', '5e-324'],
      ['8000000000000001', '-5e-324'],
      ['7fefffffffffffff', '1.7976931348623157e+308'],
      ['ffefffffffffffff', '-1.7976931348623157e+308'],
      ['4340000000000000', '9007199254740992'],
      ['c340000000000000', '-9007199254740992'],
      ['4430000000000000', '295147905179352830000'],
      ['44b52d02c7e14af5', '9.999999999999997e+22'],
      ['44b52d02c7e14af6', '1e+23'],
      ['44b52d02c7e14af7', '1.0000000000000001e+23'],
      ['444b1ae4d6e2ef4e', '999999999999999700000'],
      ['444b1ae4d6e2ef4f', '999999999999999900000'],
      ['444b1ae4d6e2ef50', '1e+21'],
      ['3eb0c6f7a0b5ed8c', '9.999999999999997e-7'],
      ['3eb0c6f7a0b5ed8d', '0.000001'],
      ['41b3de4355555553', '333333333.3333332'],
      ['41b3de4355555554', '333333333.33333325'],
      ['41b3de4355555555', '333333333.3333333'],
      ['41b3de4355555556', '333333333.3333334'],
      ['41b3de4355555557', '333333333.33333343'],
      ['becbf647612f3696', '-0.0000033333333333333333'],
      ['43143ff3c1cb0959', '1424953923781206.2'],
    ]
    for (const [bits, want] of vectors) expect(jcs(fromBits(bits)), bits).toBe(want)
  })

  it('rejects NaN and Infinity (RFC Appendix B: 7fffffffffffffff, 7ff0000000000000)', () => {
    expect(() => jcs(fromBits('7fffffffffffffff'))).toThrow(TypeError)
    expect(() => jcs(fromBits('7ff0000000000000'))).toThrow(TypeError)
    expect(() => jcs([-Infinity])).toThrow(TypeError)
  })

  it('matches the RFC §3.2.2 example (numbers, escapes, literals)', () => {
    const input = String.raw`{
      "numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],
      "string": "\u20ac$\u000F\u000aA'\u0042\u0022\u005c\\\"\/",
      "literals": [null, true, false]
    }`
    const want = String.raw`{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\u000f\nA'B\"\\\\\"/"}`
    expect(jcs(JSON.parse(input))).toBe(want)
  })

  it('sorts keys by UTF-16 code units (RFC §3.2.3 example: surrogate pair before U+FB33)', () => {
    const input = String.raw`{
      "\u20ac": "Euro Sign",
      "\r": "Carriage Return",
      "\ufb33": "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "\ud83d\ude00": "Emoji: Grinning Face",
      "\u0080": "Control",
      "\u00f6": "Latin Small Letter O With Diaeresis"
    }`
    const out = jcs(JSON.parse(input))
    const keys = Object.keys(JSON.parse(out) as object)
    // Object.keys lists integer-like keys first, so compare the serialised order instead.
    const order = [...out.matchAll(/"((?:[^"\\]|\\.)*)":"/g)].map((m) => JSON.parse(`"${m[1] ?? ''}"`) as string)
    expect(order).toEqual(['\r', '1', '\u0080', '\u00f6', '\u20ac', '\ud83d\ude00', '\ufb33'])
    expect(new Set(keys)).toEqual(new Set(order))
    expect(out).toBe(
      '{"\\r":"Carriage Return","1":"One","\u0080":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","\ufb33":"Hebrew Letter Dalet With Dagesh"}',
    )
  })

  it('UTF-8 bytes of the §3.2.3 output match the RFC hex dump prefix', () => {
    // RFC 8785 §3.2.4: 7b 22 5c 72 22 3a 22 43 61 72 ... ("{\"\\r\":\"Car").
    const bytes = jcsBytes({ '\r': 'Carriage Return' })
    expect([...bytes.subarray(0, 10)]).toEqual([0x7b, 0x22, 0x5c, 0x72, 0x22, 0x3a, 0x22, 0x43, 0x61, 0x72])
  })

  it('rejects strings and keys with an unpaired surrogate (I-JSON, RFC 8785 §3.1)', () => {
    for (const bad of ['\ud800', 'a\udc00', '\ude00\ud83d', 'x\ud83d']) {
      expect(isIJsonString(bad)).toBe(false)
      expect(() => jcs(bad)).toThrow(TypeError)
      expect(() => jcs({ [bad]: 1 })).toThrow(TypeError)
      expect(() => jcs([[{ a: bad }]])).toThrow(TypeError)
    }
    expect(isIJsonString('\ud83d\ude00')).toBe(true)
    expect(jcs('\ud83d\ude00')).toBe('"😀"')
  })

  it('rejects values that are not JSON', () => {
    for (const bad of [undefined, () => 1, new Date(0), new Map(), [1, , 3], Symbol('x'), 1n]) expect(() => jcs(bad)).toThrow(TypeError)
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => jcs(cyclic)).toThrow(TypeError)
  })

  it('agrees with the independent reference serialiser on arbitrary I-JSON (property)', () => {
    fc.assert(
      fc.property(fc.jsonValue({ stringUnit: 'binary', maxDepth: 4 }), (v) => {
        expect(jcs(v)).toBe(referenceJcs(v))
      }),
      { numRuns: 2000 },
    )
  })

  it('is key-order independent and a fixed point of parse ∘ jcs (property)', () => {
    fc.assert(
      fc.property(fc.jsonValue({ stringUnit: 'binary', maxDepth: 4 }), (v) => {
        const once = jcs(v)
        expect(jcs(JSON.parse(once))).toBe(once)
        const reversed = JSON.parse(JSON.stringify(v, (_k, x: unknown) => (x !== null && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).reverse()) : x)))
        expect(jcs(reversed)).toBe(once)
      }),
      { numRuns: 1000 },
    )
  })

  it('is the same function as tasks/ids canonicalJson on I-JSON (family_id hashing stays one implementation)', () => {
    fc.assert(
      fc.property(fc.jsonValue({ stringUnit: 'binary', maxDepth: 3 }), (v) => {
        expect(jcs(v)).toBe(canonicalJson(v))
      }),
      { numRuns: 500 },
    )
  })
})
