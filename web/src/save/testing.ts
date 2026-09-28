/**
 * fast-check arbitraries for save files (DESIGN §8), shared by the `save/*.test.ts` property tests.
 *
 * TEST-ONLY: import from `*.test.ts` files and scripts, never from app code (the barrel does not
 * re-export it), so fast-check stays out of the app bundle.
 *
 * Ids, timestamps and seen ids are drawn from small pools, so independently generated saves
 * collide on `session_id`, `anon_id` and seen ids: that is what merge properties need to bite.
 */

import fc from 'fast-check'
import { AXIS_CODES } from '../engine/axes'
import type { JsonValue, ResponseTuple } from '../engine/types'
import { utcSeconds } from './clock'
import { SCHEMA_URL, SCHEMA_VERSION, type DeviceInfo, type PosteriorCache, type SaveFileV1, type SaveSession, type SaveSig, type SessionFlags } from './types'

/** Context the arbitraries' caches are built for. */
export const TEST_CTX = { bank_version: 'm1-static', param_version: 'p-test-1' } as const

const T0 = Date.UTC(2026, 9, 1)

export const arbUtc = (spreadS = 86_400 * 30): fc.Arbitrary<string> => fc.integer({ min: 0, max: spreadS }).map((s) => utcSeconds(T0 + s * 1000))

export const arbSessionId = fc.integer({ min: 0, max: 5 }).map((n) => `s_01J9ZK3Q${'ABCDEF'[n] ?? 'A'}`)
export const arbAnonId = fc.constantFrom('hb_7Q3m9Kx2Vw5rT8pL', 'hb_0000000000000000a', 'hb_zzzzzzzzzzzzzzzz')
export const arbItemId = fc.constantFrom('i:mat:f0182:v3', 'i:rt:simple', 'i:rotation:1.0.0:s1', 'i:series:1.0.0:x@s3', 'i:quant:1.0.0:q:7')
export const arbFamilyId = fc.constantFrom('f:mat:0182', 'f:rotation:0123456789ab', 'f:series:ffffffffffff', 'f:quant:000000000001')

export const arbPayload: fc.Arbitrary<JsonValue> = fc.jsonValue({ maxDepth: 2, stringUnit: 'binary' }) as fc.Arbitrary<JsonValue>

export const arbDevice: fc.Arbitrary<DeviceInfo> = fc.record({
  class: fc.constantFrom('desktop', 'tablet', 'phone', 'other'),
  input: fc.constantFrom('mouse', 'touch', 'keyboard', 'pen', 'other'),
  os_family: fc.constantFrom('macOS', 'iOS', 'Windows', 'Android', 'Linux', 'Chrome OS'),
  browser_family: fc.constantFrom('Safari', 'Chrome', 'Firefox', 'Edge', 'Samsung Internet'),
  refresh_hz_est: fc.option(fc.constantFrom(60, 90, 120, 144, 59.94), { nil: null }),
  timer_res_ms: fc.option(fc.constantFrom(0, 0.005, 0.1, 1), { nil: null }),
  viewport: fc.tuple(fc.integer({ min: 0, max: 4000 }), fc.integer({ min: 0, max: 4000 })),
})

export const arbFlags: fc.Arbitrary<SessionFlags> = fc.record(
  {
    visibility_hidden_s: fc.double({ min: 0, max: 1e4, noNaN: true, noDefaultInfinity: true }),
    paste_events: fc.nat(20),
    fast_guess_n: fc.nat(20),
    uniform_rt: fc.boolean(),
    lz_star: fc.option(fc.double({ min: -10, max: 10, noNaN: true, noDefaultInfinity: true }), { nil: null }),
  },
  { requiredKeys: [] },
)

export const arbResponse: fc.Arbitrary<ResponseTuple> = fc
  .tuple(
    arbItemId,
    fc.constantFrom<0 | 1>(0, 1),
    arbPayload,
    fc.constantFrom<0 | 1 | null>(0, 1, null),
    fc.double({ min: 0, max: 600_000, noNaN: true, noDefaultInfinity: true }),
    fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
    fc.option(fc.array(fc.integer({ min: 150, max: 2000 }), { maxLength: 5 }), { nil: undefined }),
  )
  .map(([id, pre, resp, cor, rt, conf, extra]) => (extra === undefined ? [id, pre, resp, cor, rt, conf] : [id, pre, resp, cor, rt, conf, extra]))

export const arbSig: fc.Arbitrary<SaveSig> = fc.record({
  alg: fc.constant('HMAC-SHA256' as const),
  kid: fc.constantFrom('k2026a', 'k2026b'),
  mac: fc.constantFrom('base64...', 'AAAA', 'q83vEjRWeJA='),
})

export const arbSession = (withSig = true): fc.Arbitrary<SaveSession> =>
  fc
    .record({
      session_id: arbSessionId,
      started_utc: arbUtc(),
      duration_s: fc.nat(7200),
      device: arbDevice,
      flags: arbFlags,
      responses: fc.array(arbResponse, { maxLength: 6 }),
      sig: withSig ? fc.option(arbSig, { nil: undefined, freq: 4 }) : fc.constant(undefined),
    })
    .map((s) => {
      const out: SaveSession = { session_id: s.session_id, started_utc: s.started_utc, duration_s: s.duration_s, device: s.device, flags: s.flags, responses: s.responses }
      if (s.sig !== undefined) out.sig = s.sig
      return out
    })

/** A posterior cache: consistent over 1–4 axes, under one of two parameter versions. */
export const arbCache: fc.Arbitrary<PosteriorCache> = fc
  .tuple(fc.subarray([...AXIS_CODES], { minLength: 1, maxLength: 4 }), fc.constantFrom(TEST_CTX.param_version, 'p-old'))
  .chain(([axes, pv]) =>
    fc.record({
      param_version: fc.constant(pv),
      axes: fc.constant(axes as string[]),
      mean: fc.array(fc.double({ min: -3, max: 3, noNaN: true, noDefaultInfinity: true }), { minLength: axes.length, maxLength: axes.length }),
      cov_lower: fc.array(fc.double({ min: 0, max: 2, noNaN: true, noDefaultInfinity: true }), {
        minLength: (axes.length * (axes.length + 1)) / 2,
        maxLength: (axes.length * (axes.length + 1)) / 2,
      }),
    }),
  )

export interface ArbSaveOptions {
  /** Sessions to draw from (default: fresh arbitrary sessions). */
  sessions?: fc.Arbitrary<SaveSession[]>
  /** Include `$schema` / the current schema_version always (a normalised-looking header). */
  currentHeader?: boolean
}

/** A valid v1 save (not necessarily normalised). */
export const arbSave = (opts: ArbSaveOptions = {}): fc.Arbitrary<SaveFileV1> =>
  fc
    .record({
      schema: opts.currentHeader ? fc.constant(SCHEMA_URL) : fc.option(fc.constantFrom(SCHEMA_URL, 'https://example.org/old.json'), { nil: undefined }),
      schema_version: opts.currentHeader ? fc.constant(SCHEMA_VERSION) : fc.constantFrom(SCHEMA_VERSION, '1.0.1', '1.2.0'),
      bank_version: opts.currentHeader ? fc.constant(TEST_CTX.bank_version) : fc.constantFrom(TEST_CTX.bank_version, '2026.10.03-b17'),
      anon_id: arbAnonId,
      created_utc: arbUtc(86_400 * 60),
      sessions: opts.sessions ?? fc.array(arbSession(), { maxLength: 4 }),
      seen_items: fc.array(arbItemId, { maxLength: 6 }),
      seen_families: fc.array(arbFamilyId, { maxLength: 4 }),
      posterior_cache: fc.option(arbCache, { nil: undefined }),
      sig: fc.option(arbSig, { nil: undefined, freq: 3 }),
    })
    .map((r) => {
      const out: SaveFileV1 = {
        schema_version: r.schema_version,
        bank_version: r.bank_version,
        anon_id: r.anon_id,
        created_utc: r.created_utc,
        sessions: r.sessions,
        seen_items: r.seen_items,
        seen_families: r.seen_families,
      }
      if (r.schema !== undefined) out.$schema = r.schema
      if (r.posterior_cache !== undefined) out.posterior_cache = r.posterior_cache
      if (r.sig !== undefined) out.sig = r.sig
      return out
    })

/**
 * `n` saves drawn from one shared pool of sessions (with several copies per session id), so they
 * overlap the way two devices' saves of one person do.
 */
export const arbSaveFamily = (n: number): fc.Arbitrary<SaveFileV1[]> =>
  fc.array(arbSession(), { minLength: 1, maxLength: 8 }).chain((pool) => fc.array(arbSave({ sessions: fc.subarray(pool) }), { minLength: n, maxLength: n }))
