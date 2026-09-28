import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { jcs } from './jcs'
import { distinctAnonIds, isUsableCache, mergeAll, mergeSaves, mergeSessions, normalizeSave, sameSave, subsumes } from './merge'
import { parseSaveText } from './parse'
import { arbCache, arbSave, arbSaveFamily, arbSession, TEST_CTX } from './testing'
import { SCHEMA_URL, SCHEMA_VERSION, type SaveFileV1, type SaveSession } from './types'
import { validateSave } from './validate'

const ctx = TEST_CTX
const eq = (a: SaveFileV1, b: SaveFileV1): void => {
  expect(jcs(a)).toBe(jcs(b))
}

function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === 'object') {
    for (const x of Object.values(v)) deepFreeze(x)
    Object.freeze(v)
  }
  return v
}

const base = (over: Partial<SaveFileV1> = {}): SaveFileV1 => ({
  $schema: SCHEMA_URL,
  schema_version: SCHEMA_VERSION,
  bank_version: ctx.bank_version,
  anon_id: 'hb_7Q3m9Kx2Vw5rT8pL',
  created_utc: '2026-10-03T18:22:11Z',
  sessions: [],
  seen_items: [],
  seen_families: [],
  ...over,
})

const session = (id: string, started: string, nResponses: number, over: Partial<SaveSession> = {}): SaveSession => ({
  session_id: id,
  started_utc: started,
  duration_s: 60,
  device: { class: 'desktop', input: 'mouse', os_family: 'macOS', browser_family: 'Safari', refresh_hz_est: 120, timer_res_ms: 0.1, viewport: [1512, 861] },
  flags: {},
  responses: Array.from({ length: nResponses }, (_, i) => [`i:mat:1.0.0:s${i}`, 0, 'C', 1, 1000 + i, 80] as SaveSession['responses'][number]),
  ...over,
})

const RUNS = { numRuns: 400 }

describe('merge (DESIGN §8 R-8.1)', () => {
  it('produces valid v1 saves (property)', () => {
    fc.assert(
      fc.property(arbSaveFamily(2), ([a, b]) => {
        const m = mergeSaves(a!, b!, ctx)
        const r = validateSave(m)
        expect(r.ok, r.ok ? '' : r.errors.join('\n')).toBe(true)
        expect(m.$schema).toBe(SCHEMA_URL)
        expect(m.schema_version).toBe(SCHEMA_VERSION)
        expect(m.bank_version).toBe(ctx.bank_version)
      }),
      RUNS,
    )
  })

  it('is idempotent: merge(a, a) = normalize(a), and merge(n, n) = n for normalised n (property)', () => {
    fc.assert(
      fc.property(arbSave(), (a) => {
        const n = normalizeSave(a, ctx)
        eq(mergeSaves(a, a, ctx), n)
        eq(mergeSaves(n, n, ctx), n)
        eq(normalizeSave(n, ctx), n)
      }),
      RUNS,
    )
  })

  it('is commutative (property)', () => {
    fc.assert(
      fc.property(arbSaveFamily(2), ([a, b]) => {
        eq(mergeSaves(a!, b!, ctx), mergeSaves(b!, a!, ctx))
      }),
      RUNS,
    )
  })

  it('is associative and order-free over three saves (property)', () => {
    fc.assert(
      fc.property(arbSaveFamily(3), ([a, b, c]) => {
        const all = mergeAll([a!, b!, c!], ctx)
        eq(mergeSaves(mergeSaves(a!, b!, ctx), c!, ctx), all)
        eq(mergeSaves(a!, mergeSaves(b!, c!, ctx), ctx), all)
        eq(mergeAll([c!, a!, b!], ctx), all)
        eq(mergeAll([b!, c!, a!, b!], ctx), all)
      }),
      RUNS,
    )
  })

  it('stays associative and commutative when one input is the signed, cached join of the others (property)', () => {
    // Exercises the keep paths of the posterior-cache and file-sig rules, which random saves rarely hit.
    fc.assert(
      fc.property(arbSaveFamily(2), arbCache, (ab, cache) => {
        // Without caches of their own, j's cache is the only candidate (two different caches over
        // the same sessions would be resolved by canonical order instead).
        const [a, b] = ab.map((s) => {
          const c = { ...s }
          delete c.posterior_cache
          return c
        }) as [SaveFileV1, SaveFileV1]
        const j: SaveFileV1 = { ...mergeSaves(a, b, ctx), posterior_cache: { ...cache, param_version: ctx.param_version } }
        j.sig = { alg: 'HMAC-SHA256', kid: 'k2026a', mac: 'AAAA' }
        const all = mergeAll([a, b, j], ctx)
        expect(all.sig).toEqual(j.sig)
        expect(jcs(all.posterior_cache)).toBe(jcs(j.posterior_cache))
        eq(mergeSaves(mergeSaves(a, j, ctx), b, ctx), all)
        eq(mergeSaves(b, mergeSaves(j, a, ctx), ctx), all)
        eq(mergeSaves(j, mergeSaves(a, b, ctx), ctx), all)
        eq(mergeSaves(j, j, ctx), j)
      }),
      RUNS,
    )
  })

  it('absorbs: merging a save that is already in is a no-op (property)', () => {
    fc.assert(
      fc.property(arbSaveFamily(2), ([a, b]) => {
        const m = mergeSaves(a!, b!, ctx)
        eq(mergeSaves(m, b!, ctx), m)
        eq(mergeSaves(m, a!, ctx), m)
        expect(subsumes(m, a!)).toBe(true)
        expect(subsumes(m, b!)).toBe(true)
      }),
      RUNS,
    )
  })

  it('unions sessions by session_id and seen ids as sets; keeps one input copy per id (property)', () => {
    fc.assert(
      fc.property(arbSaveFamily(2), ([a, b]) => {
        const m = mergeSaves(a!, b!, ctx)
        const ids = m.sessions.map((s) => s.session_id)
        expect(new Set(ids).size).toBe(ids.length)
        expect(new Set(ids)).toEqual(new Set([...a!.sessions, ...b!.sessions].map((s) => s.session_id)))
        const copies = new Set([...a!.sessions, ...b!.sessions].map((s) => jcs(s)))
        for (const s of m.sessions) expect(copies.has(jcs(s))).toBe(true)
        expect(m.seen_items).toEqual([...new Set([...a!.seen_items, ...b!.seen_items])].sort())
        expect(m.seen_families).toEqual([...new Set([...a!.seen_families, ...b!.seen_families])].sort())
        const order = m.sessions.map((s) => `${s.started_utc} ${s.session_id}`)
        expect(order).toEqual([...order].sort())
        expect(m.anon_id).toBe([a!.anon_id, b!.anon_id].sort()[0])
        expect(m.created_utc).toBe([a!.created_utc, b!.created_utc].sort()[1])
      }),
      RUNS,
    )
  })

  it('never mutates its inputs (property)', () => {
    fc.assert(
      fc.property(arbSaveFamily(2), ([a, b]) => {
        const before = [jcs(a!), jcs(b!)]
        deepFreeze(a)
        deepFreeze(b)
        const m = mergeSaves(a!, b!, ctx)
        m.sessions.push(session('s_ZZZZZZZZ', '2030-01-01T00:00:00Z', 0))
        expect([jcs(a!), jcs(b!)]).toEqual(before)
      }),
      { numRuns: 100 },
    )
  })

  it('save → serialise → reload → merge is idempotent (DESIGN §14.3 M1 acceptance 3; property)', async () => {
    await fc.assert(
      fc.asyncProperty(arbSave(), async (a) => {
        const n = normalizeSave(a, ctx)
        const reloaded = await parseSaveText(jcs(n))
        if (!reloaded.ok) throw new Error(reloaded.message)
        eq(reloaded.save, n)
        eq(mergeSaves(n, reloaded.save, ctx), n)
        const pretty = await parseSaveText(JSON.stringify(n, null, 2))
        if (!pretty.ok) throw new Error(pretty.message)
        eq(mergeSaves(pretty.save, n, ctx), n)
      }),
      { numRuns: 200 },
    )
  })

  describe('duplicate session copies (§8 step 1: "ignore duplicates")', () => {
    it('keeps the more complete copy of a session, whichever side it is on', () => {
      const partial = session('s_01J9ZK3QA', '2026-10-03T17:20:02Z', 3, { duration_s: 200 })
      const full = session('s_01J9ZK3QA', '2026-10-03T17:20:02Z', 5, { duration_s: 3411 })
      for (const [x, y] of [
        [partial, full],
        [full, partial],
      ] as const) {
        const m = mergeSaves(base({ sessions: [x] }), base({ sessions: [y] }), ctx)
        expect(m.sessions).toEqual([full])
      }
    })

    it('prefers a server-signed copy (A16), then more responses, then longer duration', () => {
      const sig = { alg: 'HMAC-SHA256' as const, kid: 'k2026a', mac: 'AAAA', anon_id: 'hb_7Q3m9Kx2Vw5rT8pL' }
      const signed = session('s_01J9ZK3QA', '2026-10-03T17:20:02Z', 2, { sig })
      const longer = session('s_01J9ZK3QA', '2026-10-03T17:20:02Z', 4)
      expect(mergeSessions([[longer], [signed]])).toEqual([signed])
      const slow = session('s_01J9ZK3QA', '2026-10-03T17:20:02Z', 4, { duration_s: 999 })
      expect(mergeSessions([[slow], [longer]])).toEqual([slow])
    })

    it('breaks exact ties by canonical JSON, so the pick is order-free', () => {
      const x = session('s_01J9ZK3QA', '2026-10-03T17:20:02Z', 1, { flags: { paste_events: 1 } })
      const y = session('s_01J9ZK3QA', '2026-10-03T17:20:02Z', 1, { flags: { paste_events: 2 } })
      expect(mergeSessions([[x], [y]])).toEqual(mergeSessions([[y], [x]]))
      expect(mergeSessions([[x, y]])).toEqual([y])
    })

    it('dedups duplicates inside one file too', () => {
      const s = session('s_01J9ZK3QA', '2026-10-03T17:20:02Z', 1)
      expect(normalizeSave(base({ sessions: [s, s, s] }), ctx).sessions).toEqual([s])
    })
  })

  describe('posterior cache (§8 step 4, §7.8)', () => {
    const s1 = session('s_01J9ZK3QA', '2026-10-03T17:20:02Z', 2)
    const s2 = session('s_01J9ZK3QB', '2026-10-04T17:20:02Z', 2)
    const cache = { param_version: ctx.param_version, axes: ['MAT', 'LR'], mean: [0.41, -0.12], cov_lower: [0.31, 0.08, 0.29] }

    it('is kept when the merge adds no session data', () => {
      const a = base({ sessions: [s1, s2], posterior_cache: cache })
      const b = base({ sessions: [s2] })
      expect(mergeSaves(a, b, ctx).posterior_cache).toEqual(cache)
      expect(mergeSaves(b, a, ctx).posterior_cache).toEqual(cache)
    })

    it('is dropped when the merge adds sessions (re-score from responses instead)', () => {
      const a = base({ sessions: [s1], posterior_cache: cache })
      const b = base({ sessions: [s2], posterior_cache: cache })
      expect(mergeSaves(a, b, ctx).posterior_cache).toBeUndefined()
    })

    it('is dropped when its param_version is not current, or its shapes disagree', () => {
      const old = base({ sessions: [s1], posterior_cache: { ...cache, param_version: 'p-old' } })
      expect(normalizeSave(old, ctx).posterior_cache).toBeUndefined()
      for (const bad of [
        { ...cache, mean: [0.4] },
        { ...cache, cov_lower: [1, 0] },
        { ...cache, axes: ['MAT', 'MAT'] },
        { ...cache, axes: ['MAT', '...'] },
        { ...cache, axes: [], mean: [], cov_lower: [] },
      ]) {
        expect(isUsableCache(bad, ctx.param_version)).toBe(false)
        expect(normalizeSave(base({ sessions: [s1], posterior_cache: bad }), ctx).posterior_cache).toBeUndefined()
      }
    })

    it('usable caches from the arbitrary are recognised (property)', () => {
      fc.assert(
        fc.property(arbCache, (c) => {
          expect(isUsableCache(c, ctx.param_version)).toBe(c.param_version === ctx.param_version)
        }),
      )
    })
  })

  describe('signatures (§8, A16)', () => {
    const sig = { alg: 'HMAC-SHA256' as const, kid: 'k2026a', mac: 'AAAA' }

    it('a file-level sig survives only while the body it covers is unchanged', () => {
      const n = normalizeSave(base({ sessions: [session('s_01J9ZK3QA', '2026-10-03T17:20:02Z', 1)] }), ctx)
      const signed = { ...n, sig }
      expect(mergeSaves(signed, signed, ctx).sig).toEqual(sig)
      expect(mergeSaves(signed, n, ctx).sig).toEqual(sig)
      const more = base({ sessions: [session('s_01J9ZK3QB', '2026-10-04T17:20:02Z', 1)] })
      expect(mergeSaves(signed, more, ctx).sig).toBeUndefined()
      expect(normalizeSave({ ...signed, bank_version: 'other' }, ctx).sig).toBeUndefined()
    })

    it('session sigs travel with their sessions (property)', () => {
      fc.assert(
        fc.property(fc.array(arbSession(), { maxLength: 5 }), (ss) => {
          const m = normalizeSave(base({ sessions: ss }), ctx)
          for (const s of m.sessions) {
            const copies = ss.filter((x) => x.session_id === s.session_id)
            if (copies.some((x) => x.sig !== undefined)) expect(s.sig).toBeDefined()
          }
        }),
        RUNS,
      )
    })

    it('a signed session keeps its (session, anon_id) binding through any merge, even when the file anon_id changes (A16, property)', () => {
      fc.assert(
        fc.property(arbSaveFamily(3, { bindSigs: true }), (saves) => {
          const m = mergeAll(saves, ctx)
          for (const s of m.sessions) {
            if (s.sig === undefined) continue
            // The kept copy, sig included, is one an input file carried, and the sig names the
            // anon_id of that file (the one the server bound it to), whatever the merged anon_id.
            const sources = saves.filter((f) => f.sessions.some((c) => jcs(c) === jcs(s)))
            expect(sources.length).toBeGreaterThan(0)
            expect(sources.map((f) => f.anon_id)).toContain(s.sig.anon_id)
          }
          const signedIn = new Set(saves.flatMap((f) => f.sessions.filter((c) => c.sig !== undefined).map((c) => c.session_id)))
          for (const id of signedIn) expect(m.sessions.find((s) => s.session_id === id)?.sig).toBeDefined()
        }),
        RUNS,
      )
    })

    it('a signed session from the file with the larger anon_id still names its own id after the merge', () => {
      const bSig = { ...sig, mac: 'MACoverSessionAndAnonB', anon_id: 'hb_zzzzzzzzzzzzzzzz' }
      const fa = base({ anon_id: 'hb_0000000000000000a', sessions: [session('s_01J9ZK3QA', '2026-10-03T17:20:02Z', 1)] })
      const fb = base({ anon_id: 'hb_zzzzzzzzzzzzzzzz', sessions: [session('s_01J9ZK3QB', '2026-10-04T17:20:02Z', 1, { sig: bSig })] })
      const m = mergeSaves(fa, fb, ctx)
      expect(m.anon_id).toBe('hb_0000000000000000a')
      expect(m.sessions.map((x) => [x.session_id, x.sig ?? null])).toEqual([
        ['s_01J9ZK3QA', null],
        ['s_01J9ZK3QB', bSig],
      ])
    })

    it('a session sig must name its anon_id; a file-level sig must not', () => {
      const s = session('s_01J9ZK3QA', '2026-10-03T17:20:02Z', 1)
      expect(validateSave(base({ sessions: [{ ...s, sig: { ...sig, anon_id: 'hb_zzzzzzzzzzzzzzzz' } }] })).ok).toBe(true)
      expect(validateSave(base({ sessions: [{ ...s, sig: sig as never }] })).ok).toBe(false)
      expect(validateSave(base({ sessions: [{ ...s, sig: { ...sig, anon_id: 'nope' } }] })).ok).toBe(false)
      expect(validateSave({ ...base(), sig: { ...sig, anon_id: 'hb_zzzzzzzzzzzzzzzz' } })).toMatchObject({ ok: false })
    })

    it('distinctAnonIds reports saves issued to different ids, so the UI can ask before merging', () => {
      const a = base({ anon_id: 'hb_zzzzzzzzzzzzzzzz' })
      const b = base({ anon_id: 'hb_0000000000000000a' })
      expect(distinctAnonIds([a, a])).toEqual(['hb_zzzzzzzzzzzzzzzz'])
      expect(distinctAnonIds([a, b, a])).toEqual(['hb_0000000000000000a', 'hb_zzzzzzzzzzzzzzzz'])
      expect(mergeSaves(a, b, ctx).anon_id).toBe('hb_0000000000000000a')
    })
  })

  it('mergeAll of nothing is an error; sameSave ignores key order', () => {
    expect(() => mergeAll([], ctx)).toThrow(RangeError)
    const a = base()
    const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(a).reverse()))) as SaveFileV1
    expect(sameSave(a, reordered)).toBe(true)
  })
})
