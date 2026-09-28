import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseUtcSeconds, utcSeconds } from './clock'
import { saveWithSession, sessionFromState, type SessionState } from './create'
import { ANON_ID_CHARS, newAnonId, newSessionId } from './ids'
import { jcs } from './jcs'
import { mergeAll, mergeSaves } from './merge'
import { arbDevice, arbFlags, arbResponse, TEST_CTX } from './testing'
import { SCHEMA_URL, SCHEMA_VERSION, type SaveFileV1 } from './types'
import { ANON_ID_RE, SESSION_ID_RE, UTC_SECONDS_RE, validateSave } from './validate'

const ctx = TEST_CTX
const T = Date.UTC(2026, 9, 3, 17, 20, 2, 750)

const state = (over: Partial<SessionState> = {}): SessionState => ({
  sessionId: 's_01J9ZK3QA',
  startedMs: T,
  durationS: 3411.4,
  device: { class: 'desktop', input: 'mouse', os_family: 'macOS', browser_family: 'Safari', refresh_hz_est: 120, timer_res_ms: 0.1, viewport: [1512, 861] },
  flags: { visibility_hidden_s: 14, paste_events: 0, fast_guess_n: 1 },
  responses: [
    ['i:mat:f0182:v3', 1, 'C', 1, 41250, 80],
    ['i:rt:simple', 0, 'trials', null, 18211, null, [243, 251, 238]],
  ],
  seenItems: ['i:mat:f0182:v3'],
  seenFamilies: ['f:mat:0182'],
  ...over,
})

const bytesOf = (b: number) => (n: number) => new Uint8Array(n).fill(b)

/** Decode base62 (test-side inverse of newAnonId). */
function base62ToBig(s: string): bigint {
  const A = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  let x = 0n
  for (const c of s) x = x * 62n + BigInt(A.indexOf(c))
  return x
}

describe('save ids (DESIGN §8 privacy)', () => {
  it('anon_id is hb_ + 96 random bits in 17 base62 characters', () => {
    expect(newAnonId(bytesOf(0))).toBe(`hb_${'0'.repeat(17)}`)
    const max = newAnonId(bytesOf(0xff))
    expect(base62ToBig(max.slice(3))).toBe(2n ** 96n - 1n)
    expect(max.length).toBe(3 + ANON_ID_CHARS)
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 12, maxLength: 12 }), (b) => {
        const id = newAnonId(() => b)
        expect(id).toMatch(ANON_ID_RE)
        expect(base62ToBig(id.slice(3))).toBe(b.reduce((x, v) => (x << 8n) | BigInt(v), 0n))
      }),
    )
    expect(newAnonId()).not.toBe(newAnonId())
    expect(() => newAnonId(() => new Uint8Array(3))).toThrow(TypeError)
  })

  it('session_id is s_ + a ULID whose time prefix sorts by start time', () => {
    expect(newSessionId(0, bytesOf(0))).toBe(`s_${'0'.repeat(26)}`)
    expect(newSessionId(T)).toMatch(SESSION_ID_RE)
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 48 - 2 }), fc.integer({ min: 1, max: 1e9 }), (t, dt) => {
        const a = newSessionId(t)
        const b = newSessionId(Math.min(2 ** 48 - 1, t + dt))
        expect(a.slice(0, 12) <= b.slice(0, 12)).toBe(true)
      }),
    )
    for (const bad of [-1, 1.5, 2 ** 48, Number.NaN]) expect(() => newSessionId(bad)).toThrow(RangeError)
  })

  it('utcSeconds writes fixed-width UTC to the second and round-trips', () => {
    expect(utcSeconds(T)).toBe('2026-10-03T17:20:02Z')
    expect(utcSeconds(0)).toBe('1970-01-01T00:00:00Z')
    expect(parseUtcSeconds('2026-10-03T17:20:02Z')).toBe(Date.UTC(2026, 9, 3, 17, 20, 2))
    expect(parseUtcSeconds('2026-10-03T17:20:02.5Z')).toBeNaN()
    for (const bad of [Number.NaN, Infinity, -1e15, 1e16, -1]) expect(() => utcSeconds(bad)).toThrow(RangeError)
    // Impossible calendar times are rejected, not rolled over into the next month (Date.parse does).
    for (const bad of ['2026-02-30T00:00:00Z', '2026-02-29T00:00:00Z', '2100-02-29T00:00:00Z', '2026-06-31T00:00:00Z', '0000-01-01T00:00:00Z', '1969-12-31T23:59:59Z']) {
      expect([bad, parseUtcSeconds(bad)]).toEqual([bad, Number.NaN])
    }
    expect(parseUtcSeconds('2028-02-29T00:00:00Z')).toBe(Date.UTC(2028, 1, 29))
    expect(parseUtcSeconds('2000-02-29T00:00:00Z')).toBe(Date.UTC(2000, 1, 29))
    fc.assert(
      fc.property(fc.integer({ min: 0, max: Date.UTC(9999, 11, 31) }), (ms) => {
        const s = utcSeconds(ms)
        expect(s).toMatch(UTC_SECONDS_RE)
        expect(parseUtcSeconds(s)).toBe(Math.floor(ms / 1000) * 1000)
      }),
    )
  })

  it('UTC_SECONDS_RE accepts exactly the real calendar days of 1970–9999 (every day of 1960–2500, sampled beyond)', () => {
    const p2 = (n: number): string => String(n).padStart(2, '0')
    const real = (y: number, m: number, d: number): boolean => {
      const t = new Date(Date.UTC(2000, m - 1, d)) // year set below: Date.UTC maps 0–99 to 1900s
      t.setUTCFullYear(y, m - 1, d)
      return y >= 1970 && t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
    }
    const agree = (y: number, m: number, d: number): void => {
      const s = `${String(y).padStart(4, '0')}-${p2(m)}-${p2(d)}T23:59:59Z`
      const ok = UTC_SECONDS_RE.test(s)
      if (ok !== real(y, m, d)) expect.fail(`${s}: pattern ${ok}, calendar ${real(y, m, d)}`)
      if (ok && parseUtcSeconds(s) !== Date.parse(s)) expect.fail(`${s} does not round-trip`)
    }
    let n = 0
    for (let y = 1960; y <= 2500; y++) {
      for (let m = 1; m <= 12; m++) {
        for (let d = 1; d <= 31; d++) {
          agree(y, m, d)
          n++
        }
      }
    }
    expect(n).toBe(541 * 12 * 31)
    for (const y of [0, 1, 999, 1969, 2800, 2900, 3000, 4000, 9600, 9700, 9996, 9999]) for (let m = 1; m <= 12; m++) for (let d = 1; d <= 31; d++) agree(y, m, d)
    fc.assert(fc.property(fc.integer({ min: 2501, max: 9999 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 28, max: 31 }), (y, m, d) => agree(y, m, d)))
  })
})

describe('unsigned MVP save from session state (DESIGN §8, §14.3 M1, A16)', () => {
  it('builds the §8 session record', () => {
    expect(sessionFromState(state())).toEqual({
      session_id: 's_01J9ZK3QA',
      started_utc: '2026-10-03T17:20:02Z',
      duration_s: 3411,
      device: state().device,
      flags: state().flags,
      responses: state().responses,
    })
  })

  it('writes a valid, normalised v1 save with no signature anywhere (unverified)', () => {
    const s = saveWithSession(null, state(), { ctx, createdMs: T + 3_600_000, anonId: 'hb_7Q3m9Kx2Vw5rT8pL' })
    expect(validateSave(s).ok).toBe(true)
    expect(s).toMatchObject({ $schema: SCHEMA_URL, schema_version: SCHEMA_VERSION, bank_version: ctx.bank_version, anon_id: 'hb_7Q3m9Kx2Vw5rT8pL', created_utc: '2026-10-03T18:20:02Z' })
    expect(jcs(s)).not.toContain('"sig"')
    expect(jcs(mergeAll([s], ctx))).toBe(jcs(s))
  })

  it('needs an anon_id when there is no base save', () => {
    expect(() => saveWithSession(null, state(), { ctx, createdMs: T })).toThrow(TypeError)
  })

  it('keeps the base save and its anon_id, replacing an earlier snapshot of the same session', () => {
    const other = saveWithSession(null, state({ sessionId: 's_01J9ZK3QB', startedMs: T - 86_400_000 }), { ctx, createdMs: T, anonId: 'hb_zzzzzzzzzzzzzzzz' })
    const early = saveWithSession(other, state({ responses: state().responses.slice(0, 1) }), { ctx, createdMs: T + 1000, anonId: 'hb_0000000000000000a' })
    expect(early.anon_id).toBe('hb_zzzzzzzzzzzzzzzz')
    expect(early.sessions.map((x) => [x.session_id, x.responses.length])).toEqual([
      ['s_01J9ZK3QB', 2],
      ['s_01J9ZK3QA', 1],
    ])
    // A later snapshot with fewer responses still replaces it: the running state is authoritative.
    const later = saveWithSession(early, state({ responses: [] }), { ctx, createdMs: T + 2000 })
    expect(later.sessions.find((x) => x.session_id === 's_01J9ZK3QA')?.responses).toEqual([])
    expect(later.seen_items).toEqual(['i:mat:f0182:v3'])
  })

  it('stores a posterior cache only when it is usable under the context', () => {
    const cache = { param_version: ctx.param_version, axes: ['MAT'], mean: [0.4], cov_lower: [0.3] }
    const opts = { ctx, createdMs: T, anonId: 'hb_7Q3m9Kx2Vw5rT8pL' }
    expect(saveWithSession(null, state(), { ...opts, posteriorCache: cache }).posterior_cache).toEqual(cache)
    expect(saveWithSession(null, state(), { ...opts, posteriorCache: { ...cache, param_version: 'old' } }).posterior_cache).toBeUndefined()
    // A base save's cache is stale once this session is added.
    const base = saveWithSession(null, state({ sessionId: 's_01J9ZK3QB' }), { ...opts, posteriorCache: cache })
    expect(saveWithSession(base, state(), opts).posterior_cache).toBeUndefined()
  })

  it('rejects state that would make an invalid file (a caller bug), with a TypeError', () => {
    const opts = { ctx, createdMs: T, anonId: 'hb_7Q3m9Kx2Vw5rT8pL' }
    expect(() => saveWithSession(null, state({ sessionId: 'session 1' }), opts)).toThrow(TypeError)
    expect(() => saveWithSession(null, state({ responses: [['i:x', 0, 'A', 1, -5, null]] }), opts)).toThrow(TypeError)
    expect(() => saveWithSession(null, state({ device: { ...state().device, os_family: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' } }), opts)).toThrow(TypeError)
    expect(() => saveWithSession(null, state(), { ...opts, anonId: 'me@example.org' })).toThrow(TypeError)
  })

  it('rejects NaN / ±Infinity anywhere in the state instead of letting a JSON copy turn them into null (§7.8)', () => {
    const opts = { ctx, createdMs: T, anonId: 'hb_7Q3m9Kx2Vw5rT8pL' }
    const r0 = ['i:x', 0, 'A', 1, 1000, 80] as const
    const bad: [string, Partial<SessionState>][] = [
      ['confidence NaN', { responses: [['i:x', 0, 'A', 1, 1000, Number.NaN]] }],
      ['confidence Infinity', { responses: [['i:x', 0, 'A', 1, 1000, Number.POSITIVE_INFINITY]] }],
      ['rt NaN', { responses: [['i:x', 0, 'A', 1, Number.NaN, 80]] }],
      ['trial extra NaN', { responses: [[...r0, [243, Number.NaN, 238]]] }],
      ['payload NaN', { responses: [['i:x', 0, { x: Number.NaN }, 1, 1000, 80]] }],
      ['payload -Infinity', { responses: [['i:x', 0, [Number.NEGATIVE_INFINITY], 1, 1000, 80]] }],
      ['payload undefined', { responses: [['i:x', 0, undefined as never, 1, 1000, 80]] }],
      ['extra undefined element', { responses: [[...r0, [1, undefined as never]]] }],
      ['flag NaN', { flags: { lz_star: Number.NaN } }],
      ['flag Infinity', { flags: { visibility_hidden_s: Number.POSITIVE_INFINITY } }],
      ['refresh NaN', { device: { ...state().device, refresh_hz_est: Number.NaN } }],
      ['timer Infinity', { device: { ...state().device, timer_res_ms: Number.POSITIVE_INFINITY } }],
      ['duration NaN', { durationS: Number.NaN }],
    ]
    for (const [name, over] of bad) {
      expect(() => saveWithSession(null, state(over), opts), name).toThrow(TypeError)
      expect(() => sessionFromState(state(over)), name).toThrow(TypeError)
    }
  })

  it('a non-finite number at any response position always throws (property)', () => {
    const arbNonFinite = fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY)
    fc.assert(
      fc.property(fc.array(arbResponse, { minLength: 1, maxLength: 5 }), fc.nat(), fc.constantFrom(2, 4, 5, 6), arbNonFinite, (responses, at, slot, x) => {
        const rs = responses.map((r) => [...r]) as unknown[][]
        const r = rs[at % rs.length] as unknown[]
        if (slot === 6) r[6] = [1, x]
        else r[slot] = slot === 2 ? { v: x } : x
        const opts = { ctx, createdMs: T, anonId: 'hb_7Q3m9Kx2Vw5rT8pL' }
        expect(() => saveWithSession(null, state({ responses: rs as unknown as SessionState['responses'] }), opts)).toThrow(TypeError)
      }),
      { numRuns: 200 },
    )
  })

  it('per-item snapshots merge to the final snapshot, in any order (autosave idempotence; property)', () => {
    fc.assert(
      fc.property(fc.array(arbResponse, { minLength: 1, maxLength: 10 }), arbDevice, arbFlags, fc.integer({ min: 0, max: 10 }), (responses, device, flags, shift) => {
        const snaps: SaveFileV1[] = []
        for (let i = 0; i <= responses.length; i++) {
          snaps.push(saveWithSession(null, state({ responses: responses.slice(0, i), device, flags, durationS: i * 30 }), { ctx, createdMs: T + i * 1000, anonId: 'hb_7Q3m9Kx2Vw5rT8pL' }))
        }
        const last = snaps[snaps.length - 1] as SaveFileV1
        const rotated = [...snaps.slice(shift % snaps.length), ...snaps.slice(0, shift % snaps.length)]
        expect(jcs(mergeAll(rotated, ctx))).toBe(jcs(last))
        expect(jcs(mergeSaves(snaps[0] as SaveFileV1, last, ctx))).toBe(jcs(last))
      }),
      { numRuns: 150 },
    )
  })
})
