import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { AUT_PARAMS_V0, PROMPT_NORMS_V0, type AutParams } from './params'
import { AUT_FLAGS, AUT_STATUS_PRECEDENCE, scoreAut, type AutScore, type AutScoreInput, type AutStatus } from './scoring'
import { REDACTED } from './text'
import { normalise } from './vec'

/* ---------------------------------------------------------------- hand-built vectors */

const DIM = 32

function e(k: number): Float32Array {
  const v = new Float32Array(DIM)
  v[k] = 1
  return v
}

function mix(...parts: readonly (readonly [number, number])[]): Float32Array {
  const v = new Float32Array(DIM)
  for (const [k, w] of parts) v[k] = (v[k] as number) + w
  return normalise(v)
}

/** The object points along e0. */
const OBJ = e(0)
/** The template points evenly along e1..e31, so any vector built on those has positive plausibility. */
const TPL = normalise(Float32Array.from({ length: DIM }, (_, i) => (i === 0 ? 0 : 1)))

/** A unit vector at distance d from the object (cosine 1 − d), off in its own direction e_k (k ≥ 1). */
function at(d: number, k: number): Float32Array {
  const c = 1 - d
  const s = Math.sqrt(Math.max(0, 1 - c * c))
  return mix([0, c], [k, s])
}

/** Distinct, harmless response texts (no digits, so the personal-information check stays quiet). */
const WORDS = [
  'doorstop', 'paperweight', 'hammer', 'bookend', 'step stool', 'garden border', 'weapon', 'coaster', 'pillow',
  'pigment for paint', 'boat anchor', 'nutcracker', 'dumbbell', 'chess piece', 'bed warmer', 'skateboard ramp',
  'flower press', 'knife sharpener', 'pet rock', 'tombstone', 'percussion', 'sound dampener', 'heat sink', 'pestle',
  'time capsule', 'archery target', 'podium', 'car wedge', 'pan scrubber', 'film prop',
] as const

function word(i: number): string {
  return WORDS[i % WORDS.length] as string
}

function input(object: string, responses: readonly (readonly [string, Float32Array])[]): AutScoreInput {
  return { object, objectVec: OBJ, templateVec: TPL, responses: responses.map(([text, vec]) => ({ text, vec })) }
}

function statuses(s: AutScore): AutStatus[] {
  return s.perResponse.map((r) => r.status)
}

/* ---------------------------------------------------------------- unit tests */

describe('scoreAut: originality, top-k (M6.4; DESIGN §5.4)', () => {
  it('is the mean of the 3 largest distances among scored responses', () => {
    const ds = [0.5, 0.9, 0.7, 1.2, 0.6]
    const s = scoreAut(input('shoe', ds.map((d, i) => [word(i), at(d, i + 1)])))
    expect(statuses(s)).toEqual(['scored', 'scored', 'scored', 'scored', 'scored'])
    expect(s.fluency).toBe(5)
    expect(s.originality).toBeCloseTo((1.2 + 0.9 + 0.7) / 3, 6)
    s.perResponse.forEach((r, i) => expect(r.distance).toBeCloseTo(ds[i] as number, 6))
    expect(s.flags).toEqual(['no_prompt_norm'])
    expect(s.version).toBe('aut-v0')
  })

  it('with fewer than 3 scored, is the mean of those and flags fewer_than_top_k', () => {
    const s = scoreAut(input('brick', [['doorstop', at(0.6, 1)], ['hammer', at(1.0, 2)]]))
    expect(s.fluency).toBe(2)
    expect(s.originality).toBeCloseTo(0.8, 6)
    expect(s.flags).toEqual(['fewer_than_top_k'])
  })

  it('a low-distance response can lower originality while fewer than 3 are scored', () => {
    const one = scoreAut(input('shoe', [['doorstop', at(1.2, 1)]]))
    const two = scoreAut(input('shoe', [['doorstop', at(1.2, 1)], ['hammer', at(0.4, 2)]]))
    expect(two.originality as number).toBeLessThan(one.originality as number)
  })

  it('topK comes from params', () => {
    const params: AutParams = { ...AUT_PARAMS_V0, version: 'aut-test', topK: 1 }
    const s = scoreAut(input('shoe', [['doorstop', at(0.6, 1)], ['hammer', at(1.1, 2)]]), params)
    expect(s.originality).toBeCloseTo(1.1, 6)
    expect(s.version).toBe('aut-test')
    expect(s.flags).not.toContain('fewer_than_top_k')
  })

  it('distance covers the full [0, 2] range', () => {
    const s = scoreAut(input('shoe', [['doorstop', mix([0, 1], [1, 0.0001])], ['hammer', mix([0, -1], [2, 0.0001])]]), {
      ...AUT_PARAMS_V0,
      plausibilityFloor: -1,
    })
    expect(s.perResponse[0]?.distance).toBeCloseTo(0, 6)
    expect(s.perResponse[1]?.distance).toBeCloseTo(2, 6)
  })
})

describe('scoreAut: duplicates', () => {
  it('a near-identical idea counts once; the first is kept even when the repeat is more distant', () => {
    const v = at(0.8, 1)
    const near = mix([0, 0.2], [1, 0.98], [2, 0.3]) // cosine with v well above 0.85
    const s = scoreAut(input('shoe', [['use as a doorstop', v], ['a doorstop', near], ['hammer', at(0.7, 3)]]))
    expect(statuses(s)).toEqual(['scored', 'duplicate', 'scored'])
    expect(s.fluency).toBe(2)
    expect(s.originality).toBeCloseTo((0.8 + 0.7) / 2, 6)
  })

  it('the cut is inclusive at duplicateCosine and exclusive below it', () => {
    const a = e(1)
    const cut = AUT_PARAMS_V0.duplicateCosine
    const atCut = mix([1, cut], [2, Math.sqrt(1 - cut * cut)])
    const below = mix([1, cut - 0.01], [2, Math.sqrt(1 - (cut - 0.01) ** 2)])
    expect(statuses(scoreAut(input('shoe', [['doorstop', a], ['hammer', atCut]]), { ...AUT_PARAMS_V0, duplicateCosine: cut - 1e-6 }))).toEqual([
      'scored',
      'duplicate',
    ])
    expect(statuses(scoreAut(input('shoe', [['doorstop', a], ['hammer', below]])))).toEqual(['scored', 'scored'])
  })

  it('the same text (ignoring case, punctuation and spacing) is a duplicate whatever the vectors', () => {
    const s = scoreAut(input('shoe', [['Use as a doorstop!', at(0.8, 1)], ['use  as a DOORSTOP', at(1.1, 2)]]))
    expect(statuses(s)).toEqual(['scored', 'duplicate'])
  })

  it('only scored responses count as originals: a repeat of a too-long response is scored', () => {
    const long = 'use it as a very heavy and rather large doorstop for the big front door'
    const v = at(0.8, 1)
    const s = scoreAut(input('shoe', [[long, v], ['doorstop', v]]))
    expect(statuses(s)).toEqual(['too_long', 'scored'])
  })
})

describe('scoreAut: plausibility and length exclusions', () => {
  it('a response pointing away from the template is implausible and not scored', () => {
    const away = normalise(Float32Array.from(TPL, (x) => -x))
    const s = scoreAut(input('shoe', [['doorstop', at(0.8, 1)], ['banana phone sky', away]]))
    expect(statuses(s)).toEqual(['scored', 'implausible'])
    expect(s.perResponse[1]?.plausibility).toBeCloseTo(-1, 6)
    expect(s.fluency).toBe(1)
  })

  it('plausibility must exceed the floor: equal to it is implausible', () => {
    const v = at(0.8, 1)
    const p = scoreAut(input('shoe', [['doorstop', v]])).perResponse[0]?.plausibility as number
    expect(statuses(scoreAut(input('shoe', [['doorstop', v]]), { ...AUT_PARAMS_V0, plausibilityFloor: p }))).toEqual(['implausible'])
    expect(statuses(scoreAut(input('shoe', [['doorstop', v]]), { ...AUT_PARAMS_V0, plausibilityFloor: p - 1e-6 }))).toEqual(['scored'])
  })

  it('a zero or non-finite vector is implausible even with the floor at -1', () => {
    const params = { ...AUT_PARAMS_V0, plausibilityFloor: -1 }
    const nan = new Float32Array(DIM).fill(Number.NaN)
    const s = scoreAut(input('shoe', [['doorstop', new Float32Array(DIM)], ['hammer', nan]]), params)
    expect(statuses(s)).toEqual(['implausible', 'implausible'])
    for (const r of s.perResponse) {
      expect(Number.isFinite(r.distance)).toBe(true)
      expect(Number.isFinite(r.plausibility)).toBe(true)
    }
  })

  it('more than 12 words is too long; 12 is fine', () => {
    const twelve = 'one two three four five six seven eight nine ten eleven twelve'
    const thirteen = `${twelve} thirteen`
    const s = scoreAut(input('shoe', [[twelve, at(0.8, 1)], [thirteen, at(0.9, 2)]]))
    expect(statuses(s)).toEqual(['scored', 'too_long'])
  })

  it('blank or punctuation-only responses are empty; their vectors are ignored', () => {
    const s = scoreAut(
      input('shoe', [
        ['', new Float32Array(0)],
        ['   \n ', at(0.9, 1)],
        ['...', at(0.9, 2)],
      ]),
    )
    expect(statuses(s)).toEqual(['empty', 'empty', 'empty'])
    for (const r of s.perResponse) {
      expect(r.distance).toBe(0)
      expect(r.plausibility).toBe(0)
      expect(r.cluster).toBeNull()
    }
  })
})

describe('scoreAut: personal information (DESIGN §8)', () => {
  it('a response with an email is personal_info, redacted, and never counts', () => {
    const s = scoreAut(input('brick', [['doorstop', at(0.6, 1)], ['email me at jane@example.com', at(1.9, 2)]]))
    expect(statuses(s)).toEqual(['scored', 'personal_info'])
    expect(s.perResponse[1]?.text).toBe(`email me at ${REDACTED}`)
    expect(s.perResponse[1]?.text).not.toContain('jane')
    expect(s.perResponse[1]?.cluster).toBeNull()
    expect(s.fluency).toBe(1)
    expect(s.originality).toBeCloseTo(0.6, 6)
    expect(s.flags).toContain('personal_info')
  })

  it.each([
    ['call me on 555-123-4567'],
    ['my site is example.com'],
    ['follow @janedoe'],
    ['account 98765'],
    ['I live at 12 High Street'],
    ['near SW1A 1AA'],
  ])('%j is excluded as personal_info', (text) => {
    const s = scoreAut(input('shoe', [[text, at(0.9, 1)]]))
    expect(statuses(s)).toEqual(['personal_info'])
    expect(s.fluency).toBe(0)
  })

  it('personal information outranks too_long and implausible', () => {
    const long = 'please send all of the very best brick ideas to jane@example.com right now today'
    const away = normalise(Float32Array.from(TPL, (x) => -x))
    const s = scoreAut(input('shoe', [[long, away]]))
    expect(statuses(s)).toEqual(['personal_info'])
  })
})

describe('scoreAut: status precedence', () => {
  it('is empty > personal_info > too_long > implausible > duplicate > scored', () => {
    expect(AUT_STATUS_PRECEDENCE).toEqual(['empty', 'personal_info', 'too_long', 'implausible', 'duplicate', 'scored'])
    const away = normalise(Float32Array.from(TPL, (x) => -x))
    const long = 'one two three four five six seven eight nine ten eleven twelve thirteen'
    const v = at(0.8, 1)
    const s = scoreAut(
      input('shoe', [
        ['doorstop', v], // scored
        [long, away], // too long and implausible -> too_long
        ['hammer', away], // implausible
        ['door stop', v], // duplicate of the first (same vector)
        ['  ', away], // empty
      ]),
    )
    expect(statuses(s)).toEqual(['scored', 'too_long', 'implausible', 'duplicate', 'empty'])
  })

  it('an implausible repeat is implausible, not duplicate', () => {
    const v = at(0.8, 1)
    const s = scoreAut(input('shoe', [['doorstop', v], ['doorstop', v]]), AUT_PARAMS_V0)
    expect(statuses(s)).toEqual(['scored', 'duplicate'])
    const strict = { ...AUT_PARAMS_V0, plausibilityFloor: 0.99 }
    expect(statuses(scoreAut(input('shoe', [['doorstop', v], ['doorstop', v]]), strict))).toEqual(['implausible', 'implausible'])
  })
})

describe('scoreAut: z-scores (§14.6 example 17)', () => {
  const resp = [0.95, 0.9, 0.85, 0.5].map((d, i) => [word(i), at(d, i + 1)] as const)

  it('standardises originality with the prompt norm for brick and paperclip', () => {
    const brick = scoreAut(input('brick', resp))
    const n = PROMPT_NORMS_V0.brick as { mean: number; sd: number }
    expect(brick.originality).toBeCloseTo(0.9, 6)
    expect(brick.originalityZ).toBeCloseTo((0.9 - n.mean) / n.sd, 5)
    expect(brick.flags).toEqual([])
    const clip = scoreAut(input('Paperclip ', resp))
    const m = PROMPT_NORMS_V0.paperclip as { mean: number; sd: number }
    expect(clip.originalityZ).toBeCloseTo((0.9 - m.mean) / m.sd, 5)
  })

  it('other objects get a null z and the no_prompt_norm flag', () => {
    const s = scoreAut(input('shoe', resp))
    expect(s.originality).toBeCloseTo(0.9, 6)
    expect(s.originalityZ).toBeNull()
    expect(s.flags).toEqual(['no_prompt_norm'])
  })

  it('no scored responses: z is null too', () => {
    const s = scoreAut(input('brick', []))
    expect(s.originality).toBeNull()
    expect(s.originalityZ).toBeNull()
  })

  it('takes another norm table', () => {
    const s = scoreAut(input('shoe', resp), AUT_PARAMS_V0, { shoe: { mean: 0.8, sd: 0.1 } })
    expect(s.originalityZ).toBeCloseTo(1, 5)
    const zeroSd = scoreAut(input('shoe', resp), AUT_PARAMS_V0, { shoe: { mean: 0.8, sd: 0 } })
    expect(zeroSd.originalityZ).toBeNull()
  })
})

describe('scoreAut: flexibility', () => {
  it('counts clusters among scored responses only, numbered by first appearance', () => {
    // three families around e1, e2, e3; each member adds its own direction (within-family cosine 0.5)
    const fam = (f: number, k: number): Float32Array => mix([f, 1], [k, 1])
    const s = scoreAut(
      input('shoe', [
        ['doorstop', fam(2, 10)],
        ['hammer', fam(1, 11)],
        ['bookend', fam(2, 12)],
        ['weapon', fam(3, 13)],
        ['email jane@example.com', fam(4, 14)], // a fourth family, but excluded
        ['coaster', fam(1, 15)],
      ]),
    )
    expect(s.flexibility).toBe(3)
    expect(s.perResponse.map((r) => r.cluster)).toEqual([0, 1, 0, 2, null, 1])
  })

  it('one idea, one cluster; nothing scored, zero clusters', () => {
    expect(scoreAut(input('shoe', [['doorstop', at(0.8, 1)]])).flexibility).toBe(1)
    expect(scoreAut(input('shoe', [])).flexibility).toBe(0)
  })
})

describe('scoreAut: all excluded and input errors', () => {
  it('when every response is excluded: fluency 0, originality null, flexibility 0', () => {
    const away = normalise(Float32Array.from(TPL, (x) => -x))
    const s = scoreAut(
      input('brick', [
        ['', new Float32Array(0)],
        ['jane@example.com', at(0.9, 1)],
        ['one two three four five six seven eight nine ten eleven twelve thirteen', at(0.9, 2)],
        ['qwerty', away],
      ]),
    )
    expect(statuses(s)).toEqual(['empty', 'personal_info', 'too_long', 'implausible'])
    expect(s.fluency).toBe(0)
    expect(s.originality).toBeNull()
    expect(s.originalityZ).toBeNull()
    expect(s.flexibility).toBe(0)
    expect(s.flags).toEqual(['no_scored_responses', 'personal_info'])
    expect(s.perResponse.every((r) => r.cluster === null)).toBe(true)
  })

  it('throws for an empty object, mismatched vectors, or bad params', () => {
    expect(() => scoreAut({ ...input('brick', []), object: ' ' })).toThrow(RangeError)
    expect(() => scoreAut({ ...input('brick', []), objectVec: new Float32Array(0), templateVec: new Float32Array(0) })).toThrow(RangeError)
    expect(() => scoreAut({ ...input('brick', []), templateVec: new Float32Array(DIM + 1) })).toThrow(RangeError)
    expect(() => scoreAut(input('brick', [['doorstop', new Float32Array(DIM - 1)]]))).toThrow(/responses\[0\]/)
    expect(() => scoreAut(input('brick', []), { ...AUT_PARAMS_V0, topK: 0 })).toThrow(RangeError)
  })

  it('returns frozen results and never mutates the input', () => {
    const v = at(0.8, 1)
    const copy = Float32Array.from(v)
    const s = scoreAut(input('brick', [['doorstop', v]]))
    expect(Object.isFrozen(s)).toBe(true)
    expect(Object.isFrozen(s.perResponse)).toBe(true)
    expect(Object.isFrozen(s.perResponse[0])).toBe(true)
    expect([...v]).toEqual([...copy])
  })

  it('flags are drawn from AUT_FLAGS, in that order', () => {
    const s = scoreAut(input('shoe', [['jane@example.com', at(0.9, 1)]]))
    expect(s.flags).toEqual(['no_scored_responses', 'no_prompt_norm', 'personal_info'])
    expect([...s.flags].sort((a, b) => AUT_FLAGS.indexOf(a as never) - AUT_FLAGS.indexOf(b as never))).toEqual(s.flags)
  })
})

/* ---------------------------------------------------------------- properties */

/** Permute xs by sorting on fast-check-chosen keys (stable on ties). */
function permute<T>(xs: readonly T[], keys: readonly number[]): T[] {
  return xs
    .map((x, i) => ({ x, k: keys[i % Math.max(1, keys.length)] ?? 0, i }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((p) => p.x)
}

/** n distinct scored-to-be responses: distinct texts, own directions, distances in [0.3, 1.7]. */
const distinctResponses = (minLength: number, maxLength: number) =>
  fc.array(fc.double({ min: 0.3, max: 1.7, noNaN: true }), { minLength, maxLength }).map((ds) => ds.map((d, i) => [word(i), at(d, i + 1)] as const))

/** Responses that are excluded whatever their order (no duplicates among scored ones are created). */
const excluded = fc.array(
  fc.constantFrom<readonly [string, Float32Array]>(
    ['', new Float32Array(0)],
    ['write to jane@example.com', at(1.5, 30)],
    ['one two three four five six seven eight nine ten eleven twelve thirteen', at(1.6, 31)],
    ['qwerty', normalise(Float32Array.from(TPL, (x) => -x))],
  ),
  { maxLength: 4 },
)

describe('scoreAut: properties', () => {
  it('originality is in [0, 2] or null; fluency, flexibility and clusters agree with the statuses', () => {
    const vec = fc.array(fc.float({ min: -1, max: 1, noNaN: true }), { minLength: 6, maxLength: 6 }).map((a) => Float32Array.from(a))
    const text = fc.oneof(fc.constantFrom(...WORDS, '', 'jane@example.com', 'a b c d e f g h i j k l m n'), fc.string({ maxLength: 30 }))
    fc.assert(
      fc.property(
        fc.constantFrom('brick', 'paperclip', 'shoe'),
        vec,
        vec,
        fc.array(fc.tuple(text, vec), { maxLength: 15 }),
        (object, objectVec, templateVec, rs) => {
          const s = scoreAut({ object, objectVec, templateVec, responses: rs.map(([t, v]) => ({ text: t, vec: v })) })
          const scored = s.perResponse.filter((r) => r.status === 'scored')
          expect(s.fluency).toBe(scored.length)
          if (s.originality === null) expect(s.fluency).toBe(0)
          else {
            expect(s.originality).toBeGreaterThanOrEqual(0)
            expect(s.originality).toBeLessThanOrEqual(2)
          }
          expect(s.flexibility).toBeLessThanOrEqual(s.fluency)
          expect(s.flexibility === 0).toBe(s.fluency === 0)
          for (const r of s.perResponse) {
            expect(r.cluster === null).toBe(r.status !== 'scored')
            expect(r.distance).toBeGreaterThanOrEqual(0)
            expect(r.distance).toBeLessThanOrEqual(2)
            expect(Number.isNaN(r.plausibility)).toBe(false)
          }
          if (s.originalityZ !== null) expect(Number.isFinite(s.originalityZ)).toBe(true)
          for (const f of s.flags) expect(AUT_FLAGS as readonly string[]).toContain(f)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('fluency and originality do not depend on response order when there are no duplicates', () => {
    fc.assert(
      fc.property(distinctResponses(0, 12), excluded, fc.array(fc.integer(), { minLength: 1, maxLength: 20 }), (good, bad, keys) => {
        const all = [...good, ...bad]
        const a = scoreAut(input('brick', all))
        const b = scoreAut(input('brick', permute(all, keys)))
        expect(a.perResponse.some((r) => r.status === 'duplicate')).toBe(false)
        expect(b.fluency).toBe(a.fluency)
        expect(b.originality).toBe(a.originality)
        expect(b.originalityZ).toBe(a.originalityZ)
      }),
    )
  })

  it('flexibility does not depend on order for well-separated clusters', () => {
    const fams = fc.integer({ min: 1, max: 5 }).chain((m) =>
      fc
        .array(fc.record({ fam: fc.integer({ min: 0, max: m - 1 }), spread: fc.double({ min: 0.5, max: 1.2, noNaN: true }) }), {
          minLength: m,
          maxLength: 14,
        })
        .map((members) => ({ m, members: members.map((x, i) => (i < m ? { ...x, fam: i } : x)) })),
    )
    fc.assert(
      fc.property(fams, fc.array(fc.integer(), { minLength: 1, maxLength: 20 }), ({ m, members }, keys) => {
        // families around e1..e5; member i adds its own direction e_(8+i): within-family cosine in [0.41, 0.8]
        const rs = members.map((x, i) => [word(i), mix([1 + x.fam, 1], [8 + i, x.spread])] as const)
        const a = scoreAut(input('shoe', rs))
        const b = scoreAut(input('shoe', permute(rs, keys)))
        expect(a.fluency).toBe(members.length)
        expect(a.flexibility).toBe(m)
        expect(b.flexibility).toBe(m)
      }),
    )
  })

  it('once topK responses are scored, appending a scored response never lowers originality, and raises it exactly when it beats the k-th largest distance', () => {
    fc.assert(
      fc.property(distinctResponses(AUT_PARAMS_V0.topK, 12), fc.double({ min: 0.3, max: 1.7, noNaN: true }), (base, d) => {
        const before = scoreAut(input('brick', base))
        const extra = [word(base.length), at(d, base.length + 1)] as const
        const after = scoreAut(input('brick', [...base, extra]))
        expect(after.perResponse.at(-1)?.status).toBe('scored')
        expect(after.fluency).toBe(before.fluency + 1)
        const o0 = before.originality as number
        const o1 = after.originality as number
        expect(o1).toBeGreaterThanOrEqual(o0)
        const kth = before.perResponse
          .map((r) => r.distance)
          .sort((x, y) => y - x)[AUT_PARAMS_V0.topK - 1] as number
        const newDistance = after.perResponse.at(-1)?.distance as number
        if (newDistance > kth) expect(o1).toBeGreaterThan(o0)
        else expect(o1).toBe(o0)
      }),
    )
  })

  it('appending an excluded response changes no score', () => {
    fc.assert(
      fc.property(distinctResponses(0, 10), excluded, (good, bad) => {
        const a = scoreAut(input('brick', good))
        const b = scoreAut(input('brick', [...good, ...bad]))
        expect(b.fluency).toBe(a.fluency)
        expect(b.originality).toBe(a.originality)
        expect(b.flexibility).toBe(a.flexibility)
      }),
    )
  })

  it('is deterministic', () => {
    fc.assert(
      fc.property(distinctResponses(0, 10), (rs) => {
        expect(scoreAut(input('paperclip', rs))).toEqual(scoreAut(input('paperclip', rs)))
      }),
      { numRuns: 50 },
    )
  })
})

/* ---------------------------------------------------------------- purity (static check) */

describe('AUT scoring core stays pure (no embedder, Svelte or DOM)', () => {
  const sources = import.meta.glob(['./vec.ts', './text.ts', './params.ts', './cluster.ts', './scoring.ts'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>

  /** The source without block and line comments (comments may name what the code must not import). */
  function code(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\])\/\/.*$/gm, '$1')
  }

  /** Every module specifier in static imports, re-exports and dynamic imports. */
  function specifiers(src: string): string[] {
    const out: string[] = []
    for (const m of src.matchAll(/\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g)) out.push(m[1] as string)
    for (const m of src.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) out.push(m[1] as string)
    for (const m of src.matchAll(/\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) out.push(m[1] as string)
    for (const m of src.matchAll(/\brequire\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) out.push(m[1] as string)
    return out
  }

  it('reads all five modules', () => {
    expect(Object.keys(sources).sort()).toEqual(['./cluster.ts', './params.ts', './scoring.ts', './text.ts', './vec.ts'])
  })

  it('the specifier scan sees the forms it guards against', () => {
    expect(specifiers("import { pipeline } from '@huggingface/transformers'")).toEqual(['@huggingface/transformers'])
    expect(specifiers("export * from './embedder'")).toEqual(['./embedder'])
    expect(specifiers("const m = await import('./minilm')")).toEqual(['./minilm'])
    expect(specifiers("import './minilm'")).toEqual(['./minilm'])
    expect(specifiers("import type { Embedder } from './embedder'")).toEqual(['./embedder'])
  })

  it('comments are ignored but code is not', () => {
    expect(code("/* @huggingface/transformers */ const a = 1 // './embedder'")).not.toMatch(/huggingface|embedder/)
    expect(code("import { x } from './minilm' // fine")).toMatch(/minilm/)
  })

  it.each(Object.entries(sources))('%s imports only its sibling pure modules', (_path, raw) => {
    const src = code(raw)
    const specs = specifiers(src)
    for (const banned of ['@huggingface/transformers', './embedder', './minilm']) expect(specs).not.toContain(banned)
    for (const s of specs) expect(['./vec', './text', './params', './cluster']).toContain(s)
    expect(src).not.toMatch(/@huggingface|transformers\.js['"]|from\s+['"]svelte/)
  })

  it.each(Object.entries(sources))('%s uses no DOM, clock or randomness', (_path, raw) => {
    const src = code(raw)
    expect(src).not.toMatch(/\b(?:document|window|navigator|localStorage|sessionStorage|fetch)\s*[.(]/)
    expect(src).not.toMatch(/Math\.random|Date\.now|performance\.now|crypto\./)
  })
})
