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
import { BRIEF_FORMS, BRIEF_LENGTHS, BRIEF_MODES, BRIEF_PRESETS, BRIEF_SETTINGS, BRIEF_TIERS, BRIEF_VERDICTS } from './brief-prefs'
import {
  SCHEMA_URL,
  SCHEMA_VERSION,
  type BriefContextRemovedV1,
  type BriefContextV1,
  type BriefFitV1,
  type BriefPrefsV1,
  type DeviceInfo,
  type PosteriorCache,
  type SaveFileV1,
  type SaveSession,
  type SaveSig,
  type SessionFlags,
  type SessionSig,
} from './types'

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

/** An A16 session sig, bound to one of the pool's anon_ids. */
export const arbSessionSig: fc.Arbitrary<SessionSig> = fc.tuple(arbSig, arbAnonId).map(([sig, anon_id]) => ({ ...sig, anon_id }))

export const arbSession = (withSig = true): fc.Arbitrary<SaveSession> =>
  fc
    .record({
      session_id: arbSessionId,
      started_utc: arbUtc(),
      duration_s: fc.nat(7200),
      device: arbDevice,
      flags: arbFlags,
      responses: fc.array(arbResponse, { maxLength: 6 }),
      sig: withSig ? fc.option(arbSessionSig, { nil: undefined, freq: 4 }) : fc.constant(undefined),
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

// --- brief_prefs (AI.7) ---------------------------------------------------------------------------
// Small pools, so independently generated settings collide on slot, rev and fit id: that is what the
// merge properties need to bite. Ids are shaped like the app's (topics-v1, the builder's tick keys).

const BRIEF_TOPIC_POOL = ['quant/probability_counting', 'quant/linear', 'other/programming', 'other/statistics', 'kst/physics', 'lr/notation'] as const
const BRIEF_KEY_POOL = ['LANG', 'U3', 'U5', 'FMT1', 'FMT2', 'VOICE', 'W1', 'W3', 'AC1', 'K2'] as const
const BRIEF_TEMPLATE_POOL = ['DS', 'DA', 'DA.p', 'DB', 'U1', 'U1c', 'U2.b', 'U6c'] as const
const BRIEF_MONTH_POOL = ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02'] as const
const BRIEF_FIT_IDS = ['00a1b2c3', '01a1b2c3', '02ffee00', '0300aa11', '04deadbe', '05c0ffee', '06123456'] as const

export const arbBriefTopics: fc.Arbitrary<Record<string, (typeof BRIEF_SETTINGS)[number]>> = fc.dictionary(fc.constantFrom(...BRIEF_TOPIC_POOL), fc.constantFrom(...BRIEF_SETTINGS), { maxKeys: 4 })

export const arbBriefCopied = fc.record({
  templates: fc.constantFrom('2026.09', '2026.11'),
  month: fc.constantFrom(...BRIEF_MONTH_POOL),
  lines: fc.array(fc.record({ id: fc.constantFrom('F1', 'DS', 'U4', 'K2', 'U2.W3'), v: fc.constantFrom('0', '1', '2') }), { maxLength: 6 }),
})

export const arbBriefContext: fc.Arbitrary<BriefContextV1> = fc
  .record(
    {
      slot: fc.integer({ min: 1, max: 5 }),
      preset: fc.constantFrom(...BRIEF_PRESETS),
      destination: fc.constantFrom('chatgpt_instructions', 'claude_code_skill', 'just_me'),
      form: fc.constantFrom(...BRIEF_FORMS),
      tier: fc.constantFrom(...BRIEF_TIERS),
      mode: fc.constantFrom(...BRIEF_MODES),
      length: fc.constantFrom(...BRIEF_LENGTHS),
      topics: arbBriefTopics,
      topics_off: fc.uniqueArray(fc.constantFrom(...BRIEF_TOPIC_POOL), { maxLength: 3 }),
      lines_on: fc.uniqueArray(fc.constantFrom(...BRIEF_KEY_POOL), { maxLength: 5 }),
      lines_off: fc.uniqueArray(fc.constantFrom(...BRIEF_KEY_POOL), { maxLength: 4 }),
      phrasing: fc.dictionary(fc.constantFrom('U1', 'U2', 'U6', 'DA'), fc.constantFrom(...BRIEF_TEMPLATE_POOL), { maxKeys: 3 }),
      copied: arbBriefCopied,
      rev: fc.integer({ min: 0, max: 6 }),
    },
    { requiredKeys: ['slot', 'preset', 'destination', 'tier', 'mode', 'length', 'topics', 'lines_on', 'lines_off', 'rev'] },
  )
  .map((c) => c as BriefContextV1)

export const arbBriefRemoved: fc.Arbitrary<BriefContextRemovedV1> = fc.record({ slot: fc.integer({ min: 1, max: 5 }), rev: fc.integer({ min: 0, max: 6 }), removed: fc.constant(true as const) })

export const arbBriefFit: fc.Arbitrary<BriefFitV1> = fc.record({
  id: fc.constantFrom(...BRIEF_FIT_IDS),
  topic: fc.constantFrom(...BRIEF_TOPIC_POOL),
  verdict: fc.constantFrom(...BRIEF_VERDICTS),
  month: fc.constantFrom(...BRIEF_MONTH_POOL),
})

/** Valid notes settings (not necessarily in normal form: lists may be out of order, two sets may share a slot, a copied line may repeat). */
export const arbBriefPrefs: fc.Arbitrary<BriefPrefsV1> = fc
  .record(
    {
      topics: fc.constantFrom('topics-v1', 'topics-v2', 'topics-v10'),
      groups: fc.constantFrom('g1', 'g2', 'g10'),
      notes_as_of: fc.constantFrom(...BRIEF_MONTH_POOL),
      contexts: fc.array(fc.oneof({ arbitrary: arbBriefContext, weight: 4 }, { arbitrary: arbBriefRemoved, weight: 1 }), { maxLength: 5 }),
      fit_log: fc.array(arbBriefFit, { maxLength: 30 }),
      last_zones: arbBriefTopics,
    },
    { requiredKeys: ['topics', 'groups', 'notes_as_of', 'contexts', 'fit_log'] },
  )
  .map((p) => ({ v: 1 as const, ...p }))

export interface ArbSaveOptions {
  /** Sometimes include notes settings (`brief_prefs`). Off by default, so older properties are unchanged. */
  withPrefs?: boolean
  /** Sessions to draw from (default: fresh arbitrary sessions). */
  sessions?: fc.Arbitrary<SaveSession[]>
  /** Include `$schema` / the current schema_version always (a normalised-looking header). */
  currentHeader?: boolean
  /** Rebind every session sig to the file's own `anon_id`, as the server issues them (A16). */
  bindSigs?: boolean
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
      brief_prefs: opts.withPrefs ? fc.option(arbBriefPrefs, { nil: undefined }) : fc.constant(undefined),
      sig: fc.option(arbSig, { nil: undefined, freq: 3 }),
    })
    .map((r) => {
      const out: SaveFileV1 = {
        schema_version: r.schema_version,
        bank_version: r.bank_version,
        anon_id: r.anon_id,
        created_utc: r.created_utc,
        sessions: opts.bindSigs ? r.sessions.map((x) => (x.sig === undefined ? x : { ...x, sig: { ...x.sig, anon_id: r.anon_id } })) : r.sessions,
        seen_items: r.seen_items,
        seen_families: r.seen_families,
      }
      if (r.schema !== undefined) out.$schema = r.schema
      if (r.posterior_cache !== undefined) out.posterior_cache = r.posterior_cache
      if (r.brief_prefs !== undefined) out.brief_prefs = r.brief_prefs
      if (r.sig !== undefined) out.sig = r.sig
      return out
    })

/**
 * `n` saves drawn from one shared pool of sessions (with several copies per session id), so they
 * overlap the way two devices' saves of one person do.
 */
export const arbSaveFamily = (n: number, opts: Pick<ArbSaveOptions, 'bindSigs' | 'withPrefs'> = {}): fc.Arbitrary<SaveFileV1[]> =>
  fc.array(arbSession(), { minLength: 1, maxLength: 8 }).chain((pool) => fc.array(arbSave({ ...opts, sessions: fc.subarray(pool) }), { minLength: n, maxLength: n }))
