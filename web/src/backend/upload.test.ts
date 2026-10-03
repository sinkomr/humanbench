import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { jcs } from '../save/jcs'
import { sessionMacInput } from '../save/mac-input'
import { arbSave, arbSession } from '../save/testing'
import type { SaveFileV1 } from '../save/types'
import { BackendError } from './errors'
import { BRIEF_PREFS_KEY, assertNoBriefPrefs, hasBriefPrefs, hasNul, signedSessionsOnly, toUploadPayload, withAnonId, withoutNul } from './upload'

const withPrefs = arbSave({ withPrefs: true })

describe('hasBriefPrefs', () => {
  it('finds the key at any depth, in arrays too', () => {
    expect(hasBriefPrefs({ brief_prefs: {} })).toBe(true)
    expect(hasBriefPrefs({ a: { b: [{ c: { brief_prefs: 1 } }] } })).toBe(true)
    expect(hasBriefPrefs([[{ brief_prefs: null }]])).toBe(true)
  })

  it('does not mistake a value or a similar key for it', () => {
    expect(hasBriefPrefs({ a: 'brief_prefs' })).toBe(false)
    expect(hasBriefPrefs({ brief_pref: 1, Brief_Prefs: 2, 'brief_prefs ': 3 })).toBe(false)
    expect(hasBriefPrefs(['brief_prefs'])).toBe(false)
    expect(hasBriefPrefs(null)).toBe(false)
    expect(hasBriefPrefs('x')).toBe(false)
  })

  it('survives a cycle and a deep structure', () => {
    const a: Record<string, unknown> = {}
    a.self = a
    expect(hasBriefPrefs(a)).toBe(false)
    let deep: unknown = { brief_prefs: 1 }
    for (let i = 0; i < 20_000; i++) deep = { next: deep }
    expect(hasBriefPrefs(deep)).toBe(true)
  })
})

describe('assertNoBriefPrefs', () => {
  it('refuses with a local error that names the call', () => {
    expect(() => assertNoBriefPrefs({ p_save: { brief_prefs: {} } }, 'mirror_put')).toThrowError(BackendError)
    try {
      assertNoBriefPrefs({ x: { brief_prefs: {} } }, 'rescore')
    } catch (e) {
      expect(e).toMatchObject({ kind: 'local', code: 'brief_prefs_in_payload' })
      expect(String((e as Error).message)).toContain('rescore')
    }
    expect(() => assertNoBriefPrefs({ p_save: {} }, 'rescore')).not.toThrow()
  })
})

describe('toUploadPayload (AI.26, R-17.1)', () => {
  it('removes the notes settings and leaves everything else as it was', () => {
    fc.assert(
      fc.property(withPrefs, (save) => {
        const before = jcs(save)
        const out = toUploadPayload(save)
        expect(Object.hasOwn(out, BRIEF_PREFS_KEY)).toBe(false)
        expect(hasBriefPrefs(out)).toBe(false)
        expect(jcs(save)).toBe(before) // the input is not changed
        const { brief_prefs: _p, ...rest } = save
        expect(jcs(out)).toBe(jcs(withoutNul(rest))) // (a random payload may hold the character U+0000, which goes too)
      }),
      { numRuns: 300 },
    )
  })

  it('is idempotent, and returns a save without the key as it is', () => {
    fc.assert(
      fc.property(withPrefs, (save) => {
        const once = toUploadPayload(save)
        expect(toUploadPayload(once)).toBe(once)
      }),
      { numRuns: 100 },
    )
  })

  it('never changes what a session signature covers: editing preferences keeps every session byte for byte (AI.26)', () => {
    fc.assert(
      fc.property(withPrefs, (save) => {
        fc.pre(!hasNul(save)) // (a session that holds the character U+0000 was never signed: the database cannot store one)
        const out = toUploadPayload(save)
        expect(out.sessions).toBe(save.sessions) // the same objects, so the same bytes
        for (const s of save.sessions) expect(sessionMacInput(s, save.anon_id)).toBe(sessionMacInput(out.sessions.find((x) => x.session_id === s.session_id && x === s)!, save.anon_id))
      }),
      { numRuns: 100 },
    )
  })

  it('a save with the settings edited or removed has the same upload as before (the session verdicts cannot change)', () => {
    fc.assert(
      fc.property(withPrefs, (save) => {
        const edited: SaveFileV1 = { ...save, brief_prefs: { v: 1, topics: 'topics-v1', groups: 'g1', notes_as_of: '2026-10', contexts: [], fit_log: [] } }
        expect(jcs(toUploadPayload(edited))).toBe(jcs(toUploadPayload(save)))
        const { brief_prefs: _p, ...removed } = save
        expect(jcs(toUploadPayload(removed))).toBe(jcs(toUploadPayload(save)))
      }),
      { numRuns: 100 },
    )
  })
})

describe('signedSessionsOnly (data minimisation)', () => {
  it('keeps the signed sessions and drops the rest, and the notes settings', () => {
    fc.assert(
      fc.property(arbSave({ withPrefs: true, sessions: fc.array(arbSession(), { maxLength: 6 }) }), (save) => {
        fc.pre(!hasNul(save))
        const out = signedSessionsOnly(save)
        expect(hasBriefPrefs(out)).toBe(false)
        expect(out.sessions.every((s) => s.sig !== undefined)).toBe(true)
        expect(out.sessions).toEqual(save.sessions.filter((s) => s.sig !== undefined))
        expect(out.seen_items).toEqual(save.seen_items)
        // the cache summarises the sessions that stay on the device too, so it stays on the device
        expect(Object.hasOwn(out, 'posterior_cache')).toBe(false)
        const { brief_prefs: _p, posterior_cache: _c, sessions: _s, ...rest } = save
        const { sessions: _o, ...kept } = out
        expect(jcs(kept)).toBe(jcs(rest))
      }),
      { numRuns: 200 },
    )
  })
})

describe('withAnonId', () => {
  it('re-keys a save, and leaves the sessions (which name their own anon_id in the sig) alone', () => {
    fc.assert(
      fc.property(arbSave(), (save) => {
        const out = withAnonId(save, 'hb_QQQQQQQQQQQQQQQQ')
        expect(out.anon_id).toBe('hb_QQQQQQQQQQQQQQQQ')
        expect(out.sessions).toBe(save.sessions)
        expect(withAnonId(out, 'hb_QQQQQQQQQQQQQQQQ')).toBe(out)
      }),
      { numRuns: 50 },
    )
  })
})

// ---------------------------------------------------------------------------- U+0000 (supabase/README.md, Errors)
// I-JSON and the save validator allow U+0000 in a string; PostgreSQL's jsonb and text do not, and the database
// refuses the whole call (22P05 / 22021, HTTP 400). The client drops it before any call.
const NUL = '\u0000'

/** Every string and key of `v` with U+0000 removed, by an independent route (a JSON round trip with a replacer for the strings). */
function reference(v: unknown): unknown {
  const text = JSON.stringify(v, (_k, x: unknown) => (typeof x === 'string' ? x.split(NUL).join('') : x))
  const parsed = JSON.parse(text) as unknown
  // keys: rename through the same route
  const rename = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(rename)
    if (typeof x === 'object' && x !== null) {
      const out: Record<string, unknown> = {}
      for (const [k, y] of Object.entries(x)) Object.defineProperty(out, k.split(NUL).join(''), { value: rename(y), enumerable: true, writable: true, configurable: true })
      return out
    }
    return x
  }
  return rename(parsed)
}

describe('hasNul and withoutNul', () => {
  it('find it in a string, a key, an array and any depth, and nowhere else', () => {
    expect(hasNul(`a${NUL}b`)).toBe(true)
    expect(hasNul({ [`k${NUL}`]: 1 })).toBe(true)
    expect(hasNul({ a: [[{ b: `x${NUL}` }]] })).toBe(true)
    expect(hasNul('\\u0000')).toBe(false) // a backslash and the text u0000 are not the character
    expect(hasNul({ a: 'u0000', b: 0, c: null, d: [true] })).toBe(false)
    expect(hasNul(null)).toBe(false)
    expect(hasNul(7)).toBe(false)
  })

  it('removes it from strings and keys, and leaves a clean value as the very same object', () => {
    const clean = { a: ['x', { b: 'y' }], c: 1 }
    expect(withoutNul(clean)).toBe(clean)
    expect(withoutNul(`a${NUL}b${NUL}`)).toBe('ab')
    expect(withoutNul({ [`k${NUL}`]: [`v${NUL}`, 2] })).toEqual({ k: ['v', 2] })
    const part = { same: { deep: [1, 2, { x: 'y' }] }, dirty: { s: `1${NUL}2` } }
    const out = withoutNul(part)
    expect(out).toEqual({ same: { deep: [1, 2, { x: 'y' }] }, dirty: { s: '12' } })
    expect(out.same).toBe(part.same) // only the branch that held it is copied
    expect(part.dirty.s).toBe(`1${NUL}2`) // the input is not changed
  })

  it('keeps a key called __proto__ a key, and merges two keys that differ only by the character (the later wins)', () => {
    const parsed = JSON.parse('{"__proto__": {"p": "x\\u0000"}, "a\\u0000": 1, "a": 2}') as Record<string, unknown>
    const out = withoutNul(parsed)
    expect(Object.keys(out)).toEqual(['__proto__', 'a'])
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(JSON.stringify(out)).toBe('{"__proto__":{"p":"x"},"a":2}')
  })

  it('agrees with an independent route on any JSON value, leaves none behind, and is idempotent', () => {
    // strings and keys that often hold the character, a backslash or the text u0000
    const text = fc.string({ unit: fc.constantFrom('a', 'b', NUL, NUL, '\\', 'u', '0', '"'), maxLength: 6 })
    const tree = fc.letrec<{ node: unknown }>((tie) => ({
      node: fc.oneof(
        { depthSize: 'small' },
        text,
        fc.integer(),
        fc.boolean(),
        fc.constant(null),
        fc.array(tie('node'), { maxLength: 3 }),
        fc.dictionary(text, tie('node'), { maxKeys: 3 }),
      ),
    })).node
    fc.assert(
      fc.property(tree, (planted) => {
        const out = withoutNul(planted)
        expect(hasNul(out)).toBe(false)
        expect(out).toEqual(reference(planted))
        expect(withoutNul(out)).toBe(out)
        if (!hasNul(planted)) expect(out).toBe(planted)
      }),
      { numRuns: 600 },
    )
  })

  it('refuses a value that holds it deeper than any real save (the walk is bounded), and passes a deep one that holds none', () => {
    let deep: unknown = { s: `x${NUL}` }
    for (let i = 0; i < 400; i++) deep = { next: deep }
    expect(() => withoutNul(deep)).toThrowError(BackendError)
    try {
      withoutNul(deep)
    } catch (e) {
      expect(e).toMatchObject({ kind: 'local', code: 'payload_too_deep' })
    }
    let clean: unknown = { s: 'x' }
    for (let i = 0; i < 20_000; i++) clean = { next: clean }
    expect(withoutNul(clean)).toBe(clean)
  })

  it('survives a cycle in a value that holds none', () => {
    const a: Record<string, unknown> = { s: 'x' }
    a.self = a
    expect(withoutNul(a)).toBe(a)
  })
})

describe('toUploadPayload and U+0000', () => {
  const sampleSession = (signed: boolean, seed: number): SaveFileV1['sessions'][number] => fc.sample(arbSession(signed), { numRuns: 1, seed })[0]!
  /** The session with one typed answer (an AUT-style text) in place of its responses. */
  const answering = (s: SaveFileV1['sessions'][number], text: string): SaveFileV1['sessions'][number] => ({ ...s, responses: [['i:aut:1', 0, text, null, 4000, null]] })
  const sampleSave = (seed: number, sessions?: SaveFileV1['sessions']): SaveFileV1 => {
    const base = fc.sample(arbSave(), { numRuns: 1, seed })[0]!
    return sessions === undefined ? base : { ...base, sessions }
  }

  it('drops it from a typed answer of an unsigned session, leaves the other sessions as the same objects, and does not change the input', () => {
    const signed = [{ ...sampleSession(true, 1), session_id: 's_01J9ZK3QA' }, { ...sampleSession(true, 2), session_id: 's_01J9ZK3QB' }]
    const dirty = answering({ ...sampleSession(false, 3), session_id: 's_01J9ZK3QC' }, `hello${NUL}world`)
    const save = sampleSave(3, [...signed, dirty])
    const before = jcs(save)
    const out = toUploadPayload(save)
    expect(jcs(save)).toBe(before)
    expect(hasNul(out)).toBe(false)
    expect(out.sessions[0]).toBe(save.sessions[0]) // a signed session is untouched, byte for byte
    expect(out.sessions[1]).toBe(save.sessions[1])
    expect(out.sessions[2]!.responses[0]![2]).toBe('helloworld')
  })

  it('gives a save that holds none back as it is (the same sessions array), with or without notes settings', () => {
    fc.assert(
      fc.property(withPrefs, (save) => {
        fc.pre(!hasNul(save))
        const out = toUploadPayload(save)
        expect(out.sessions).toBe(save.sessions)
        expect(toUploadPayload(out)).toBe(out)
      }),
      { numRuns: 100 },
    )
  })

  it('treats a notes key spelled with the character as the notes key: it goes too, and nothing reaches the guard', () => {
    const sneaky = { ...sampleSave(5), [`brief${NUL}_prefs`]: { v: 1 } } as unknown as SaveFileV1
    const out = toUploadPayload(sneaky)
    expect(hasBriefPrefs(out)).toBe(false)
    expect(hasNul(out)).toBe(false)
    expect(() => assertNoBriefPrefs({ p_save: out }, 'mirror_put')).not.toThrow()
  })

  it('is what signedSessionsOnly sends too', () => {
    const dirty = answering({ ...sampleSession(true, 4), session_id: 's_01J9ZK3QD', sig: { alg: 'HMAC-SHA256', kid: 'k2026a', mac: 'AAAA', anon_id: 'hb_7Q3m9Kx2Vw5rT8pL' } }, `a${NUL}b`)
    const out = signedSessionsOnly(sampleSave(6, [dirty]))
    expect(out.sessions).toHaveLength(1)
    expect(hasNul(out)).toBe(false)
  })
})
