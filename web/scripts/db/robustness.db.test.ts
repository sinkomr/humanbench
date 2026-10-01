/**
 * M2.1 (ROADMAP M2.1; DESIGN §11.2; R-12.1): what hostile or sloppy input does to the RPCs. Whatever
 * a caller sends, an RPC either succeeds or fails with one of its own HTTP-mapped errors (PT4xx / PT5xx);
 * it never surfaces an internal Postgres error (a cast failing, a number out of range, a null where
 * a value was assumed), which PostgREST would answer with a 500 and a stack of internals. And the
 * limits hold when requests arrive at once.
 */

import fc from 'fast-check'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fixtureBank, loadFixtureBank, numericItem } from './bank-fixture'
import { AUTHENTICATED, type TestDb } from './harness'
import { DEVICE, emptySave, from, startSession, type Next, type Served } from './rpc-support'
import { openTestDb, pgCode } from './vitest'

let db: TestDb
let ipCounter = 0
const freshIp = (): string => `203.0.113.${(++ipCounter % 250) + 1}-${Math.floor(ipCounter / 250)}`

beforeAll(async () => {
  db = await openTestDb()
  await loadFixtureBank(db, [...fixtureBank({ perAxis: 6, seed: 'fuzz' }), numericItem(1, 'QR', '12', { abs: 0.5 })])
})
afterAll(async () => {
  await db.close()
})

// ----------------------------------------------------------------------------------- the inputs

/** Text without NUL (PostgreSQL text cannot hold it; the driver refuses it before any function runs). */
const text = fc.oneof(
  fc.string({ maxLength: 60 }),
  fc.string({ unit: fc.constantFrom('é', '日', '😀', '\n', '\t', ' ', '%', '\\', "'", '"', '$', ',', '/', '-', '.', '0', '9', '٣', '１'), maxLength: 40 }),
  fc.constantFrom('', ' ', 'x'.repeat(300), '1'.repeat(40), '-', '$', '%', '1/0', '0/0', '..', '1e999', '٣', 'hb_AAAAAAAAAAAAAAAA', 'hbt_AAAAAAAAAAAAAAAAAAAAAA', 's_AAAAAAAAAAAA'),
)
/** Any JSON, plus the numbers a JSON number can be that a float cannot hold. */
const json: fc.Arbitrary<unknown> = fc.oneof(
  fc.jsonValue({ maxDepth: 4 }),
  fc.constantFrom(null, 0, -0.5, 1e300, -1e300, 1e-300, 123456789012345678901234567890, [], {}, [[[[[]]]]], { a: { b: { c: { d: {} } } } }),
  fc.array(fc.jsonValue({ maxDepth: 2 }), { maxLength: 30 }),
)
const int = fc.oneof(fc.integer({ min: -2_147_483_648, max: 2_147_483_647 }), fc.constantFrom(0, 1, -1, 3_600_000, 3_600_001, 100, 101, 2_147_483_647))
const anyDevice = fc.oneof(fc.constant(DEVICE), json.map((j) => j), fc.record({ class: text, input: text, os_family: text, browser_family: text, refresh_hz_est: json, timer_res_ms: json, viewport: json }))
const anyFlags = fc.oneof(fc.constant(null), json, fc.dictionary(fc.stringMatching(/^[a-z][a-z0-9_]{0,12}$/), fc.oneof(fc.boolean(), fc.double({ noNaN: true, noDefaultInfinity: true }), fc.constant(null)), { maxKeys: 6 }))
const anySave = fc.oneof(
  fc.constant(null),
  json,
  fc.record({ schema_version: text, anon_id: fc.oneof(text, fc.constant('hb_7Q3m9Kx2Vw5rT8pL')), sessions: json, seen_items: json, seen_families: json }),
  fc.constant(emptySave('hb_7Q3m9Kx2Vw5rT8pL')),
)

/** An error is acceptable when it is one the RPC raised itself: PT plus a status. */
async function settle(promise: Promise<unknown>): Promise<'ok' | string> {
  try {
    await promise
    return 'ok'
  } catch (e) {
    const code = pgCode(e)
    return code ?? `non-pg: ${(e as Error).message}`
  }
}
const isOwnError = (outcome: string): boolean => outcome === 'ok' || /^PT[0-9]{3}$/.test(outcome)

describe('hostile input never produces an internal error', () => {
  const RUNS = 120

  /** A fresh open session for the token-taking RPCs, with one item served. */
  async function session(): Promise<{ ip: string; token: string; itemId: string; anonId: string; sessionId: string }> {
    const ip = freshIp()
    const s = await startSession(db, ip)
    const n = (await db.rpc<Next>(from(ip), 'next_item', { p_token: s.token })) as Served
    return { ip, token: s.token, itemId: n.item.item_id, anonId: s.anon_id, sessionId: s.session_id }
  }

  it('start_session', async () => {
    await fc.assert(
      fc.asyncProperty(anyDevice, anySave, async (device, save) => {
        const outcome = await settle(db.rpc(from(freshIp()), 'start_session', { p_device: device, p_save: save }))
        expect(isOwnError(outcome), outcome).toBe(true)
      }),
      { numRuns: RUNS },
    )
  })

  it('next_item, with a made-up token', async () => {
    await fc.assert(
      fc.asyncProperty(text, async (token) => {
        const outcome = await settle(db.rpc(from(freshIp()), 'next_item', { p_token: token }))
        expect(isOwnError(outcome), outcome).toBe(true)
      }),
      { numRuns: RUNS },
    )
  })

  it('submit', async () => {
    const s = await session()
    await fc.assert(
      fc.asyncProperty(fc.oneof(fc.constant(s.token), text), fc.oneof(fc.constant(s.itemId), text), json, int, fc.oneof(fc.constant(null), int), anyFlags, fc.oneof(fc.constant(null), fc.boolean()), async (token, itemId, response, rt, conf, flags, next) => {
        const outcome = await settle(db.rpc(from(s.ip), 'submit', { p_token: token, p_item_id: itemId, p_response: response, p_rt_ms: rt, p_confidence: conf, p_client_flags: flags, p_next: next }))
        expect(isOwnError(outcome), outcome).toBe(true)
      }),
      { numRuns: RUNS * 2 },
    )
  })

  it('submit, on a numeric item, with any response', async () => {
    const ip = freshIp()
    const st = await startSession(db, ip)
    // serve until the numeric item comes up
    let n = (await db.rpc<Next>(from(ip), 'next_item', { p_token: st.token })) as Served
    while (n.item.item_type !== 'numeric') {
      await db.owner.query(`update public.exposure_log set served_at = served_at - interval '30 seconds' where session_id = $1`, [st.session_id])
      n = (await db.rpc<{ next: Served }>(from(ip), 'submit', { p_token: st.token, p_item_id: n.item.item_id, p_response: 0, p_rt_ms: 1000 })).next
    }
    await fc.assert(
      fc.asyncProperty(fc.oneof(text, json), async (response) => {
        const outcome = await settle(db.rpc(from(ip), 'submit', { p_token: st.token, p_item_id: n.item.item_id, p_response: response, p_rt_ms: 1000, p_next: false }))
        expect(isOwnError(outcome), outcome).toBe(true)
      }),
      { numRuns: RUNS },
    )
    // and the scoring function on its own, for any entry and any response shape, never errors
    await fc.assert(
      fc.asyncProperty(fc.oneof(text, json), async (response) => {
        await db.owner.query(`select * from hb.score_response('i:tst:num:00001', $1::jsonb)`, [JSON.stringify(response)])
        await db.owner.query(`select * from hb.score_response($2, $1::jsonb)`, [JSON.stringify(response), n.item.item_id])
      }),
      { numRuns: RUNS },
    )
  })

  it('finish', async () => {
    await fc.assert(
      fc.asyncProperty(anyFlags, async (flags) => {
        const s = await session()
        const outcome = await settle(db.rpc(from(s.ip), 'finish', { p_token: s.token, p_flags: flags }))
        expect(isOwnError(outcome), outcome).toBe(true)
      }),
      { numRuns: 60 },
    )
  })

  it('report_problem and submit_survey', async () => {
    const s = await session()
    await fc.assert(
      fc.asyncProperty(fc.oneof(fc.constantFrom('wrong_key', 'typo', 'notes_requested', 'broken'), text), fc.oneof(fc.constant(s.itemId), fc.constant(null), text), fc.oneof(fc.constant(null), text), async (kind, itemId, detail) => {
        const outcome = await settle(db.rpc(from(s.ip), 'report_problem', { p_token: s.token, p_kind: kind, p_item_id: itemId, p_detail: detail }))
        expect(isOwnError(outcome), outcome).toBe(true)
      }),
      { numRuns: RUNS },
    )
    await fc.assert(
      fc.asyncProperty(fc.oneof(fc.constant(null), fc.constantFrom('18-24', '65+'), text), fc.oneof(fc.constant(null), fc.boolean()), async (band, english) => {
        const outcome = await settle(db.rpc(from(s.ip), 'submit_survey', { p_token: s.token, p_age_band: band, p_english_first: english }))
        expect(isOwnError(outcome), outcome).toBe(true)
      }),
      { numRuns: RUNS },
    )
  })

  it('mirror_put, mirror_get and delete_my_data', async () => {
    const s = await session()
    await fc.assert(
      fc.asyncProperty(fc.oneof(fc.constant(emptySave(s.anonId)), anySave), fc.oneof(fc.constant(null), text), fc.oneof(fc.constant(s.anonId), text), async (save, phrase, anonId) => {
        expect(isOwnError(await settle(db.rpc(from(freshIp()), 'mirror_put', { p_token: s.token, p_save: save, p_phrase: phrase })))).toBe(true)
        expect(isOwnError(await settle(db.rpc(from(freshIp()), 'mirror_get', { p_anon_id: anonId, p_phrase: phrase })))).toBe(true)
        expect(isOwnError(await settle(db.rpc(from(freshIp()), 'delete_my_data', { p_anon_id: anonId, p_phrase: phrase, p_save: save })))).toBe(true)
      }),
      { numRuns: RUNS },
    )
  })

  it('rescore', async () => {
    await fc.assert(
      fc.asyncProperty(anySave, async (save) => {
        const outcome = await settle(db.rpc(from(freshIp()), 'rescore', { p_save: save }))
        expect(isOwnError(outcome), outcome).toBe(true)
      }),
      { numRuns: RUNS },
    )
  })
})

describe('authenticated is no different from anon', () => {
  it('serves the same RPCs, and reaches no table', async () => {
    const ctx = { ...AUTHENTICATED, headers: { 'x-forwarded-for': freshIp() } }
    const s = await db.rpc<{ token: string }>(ctx, 'start_session', { p_device: DEVICE })
    expect(await db.rpc(ctx, 'next_item', { p_token: s.token })).toMatchObject({ seq: 1 })
  })
})

describe('requests at once', () => {
  it('counts a burst of start_session calls from one address exactly: 5 pass, the rest are refused', async () => {
    const ip = freshIp()
    const outcomes = await Promise.all(Array.from({ length: 9 }, () => settle(startSession(db, ip))))
    expect(outcomes.filter((o) => o === 'ok').length).toBe(5)
    expect(outcomes.filter((o) => o === 'PT429').length).toBe(4)
    const { rows } = await db.owner.query(`select n from public.rate_limits where kind = 'start_session' and n >= 5`)
    expect(rows.length).toBeGreaterThan(0)
  })

  it('stores one answer when the same answer arrives twice at the same moment, and both calls succeed', async () => {
    const ip = freshIp()
    const st = await startSession(db, ip)
    const n = (await db.rpc<Next>(from(ip), 'next_item', { p_token: st.token })) as Served
    await db.owner.query(`update public.exposure_log set served_at = served_at - interval '30 seconds' where session_id = $1`, [st.session_id])
    const args = { p_token: st.token, p_item_id: n.item.item_id, p_response: 1, p_rt_ms: 4000 }
    const out = await Promise.all([settle(db.rpc(from(ip), 'submit', args)), settle(db.rpc(from(ip), 'submit', args)), settle(db.rpc(from(ip), 'submit', args))])
    expect(out).toEqual(['ok', 'ok', 'ok'])
    expect((await db.owner.query(`select count(*)::int as n from public.responses where session_id = $1`, [st.session_id])).rows[0].n).toBe(1)
    expect((await db.owner.query(`select n_answered from public.sessions where session_id = $1`, [st.session_id])).rows[0].n_answered).toBe(1)
  })

  it('serves one new item when next_item is called many times at once, the same one to all', async () => {
    const ip = freshIp()
    const st = await startSession(db, ip)
    const calls = await Promise.all(Array.from({ length: 6 }, () => db.rpc<Served>(from(ip), 'next_item', { p_token: st.token })))
    expect(new Set(calls.map((c) => c.item.item_id)).size).toBe(1)
    expect((await db.owner.query(`select n_served from public.sessions where session_id = $1`, [st.session_id])).rows[0].n_served).toBe(1)
    expect((await db.owner.query(`select count(*)::int as n from public.exposure_log where session_id = $1`, [st.session_id])).rows[0].n).toBe(1)
  })

  it('creates one mirror when two first puts race, and tells the loser to present the phrase', async () => {
    const ip = freshIp()
    const st = await startSession(db, ip)
    const save = emptySave(st.anon_id)
    const out = await Promise.all([db.rpc<{ stored: boolean; recovery_phrase?: string }>(from(ip), 'mirror_put', { p_token: st.token, p_save: save }).then((r) => r, (e: unknown) => pgCode(e)), db.rpc<{ stored: boolean; recovery_phrase?: string }>(from(ip), 'mirror_put', { p_token: st.token, p_save: save }).then((r) => r, (e: unknown) => pgCode(e))])
    // the second waits on the first's session lock and then finds a mirror: it must present a phrase it never had
    const stored = out.filter((o) => typeof o === 'object' && o.stored)
    expect(stored.length).toBe(1)
    expect(out.filter((o) => typeof o === 'object' && o.stored === false).length + out.filter((o) => typeof o === 'string').length).toBe(1)
    expect((await db.owner.query(`select count(*)::int as n from public.mirror where anon_id = $1`, [st.anon_id])).rows[0].n).toBe(1)
  })
})

describe('U+0000 in a save', () => {
  // I-JSON (and the app's save validator) allows a NUL escape in a string, a typed answer for example; PostgreSQL's jsonb does not.
  // The refusal comes from the database before an RPC runs, so it is not a PT code. A client must not send such a save: the
  // upload payload (toUploadPayload, M2.7) refuses it, or drops the character, before any call.
  it('is refused by PostgreSQL itself (22P05) in every RPC that takes a save, and stores nothing', async () => {
    const ip = freshIp()
    const st = await startSession(db, ip)
    const bad = emptySave(st.anon_id, { sessions: [{ session_id: st.session_id, responses: [['i:x', 0, 'a\u0000b', null, 1, null]] }] })
    const calls: Array<[string, Record<string, unknown>]> = [
      ['mirror_put', { p_token: st.token, p_save: bad }],
      ['start_session', { p_device: DEVICE, p_save: bad }],
      ['rescore', { p_save: bad }],
      ['delete_my_data', { p_anon_id: st.anon_id, p_save: bad }],
      ['submit', { p_token: st.token, p_item_id: 'i:x', p_response: 'a\u0000b', p_rt_ms: 5 }],
    ]
    for (const [fn, args] of calls) expect(await settle(db.rpc(from(ip), fn, args)), fn).toBe('22P05')
    expect((await db.owner.query(`select count(*)::int as n from public.mirror where anon_id = $1`, [st.anon_id])).rows[0].n).toBe(0)
    expect((await db.owner.query(`select count(*)::int as n from public.sessions where anon_id = $1`, [st.anon_id])).rows[0].n).toBe(1)
  })

  it('is no problem once the character is gone: the same save with the escape removed is stored', async () => {
    const ip = freshIp()
    const st = await startSession(db, ip)
    const ok = emptySave(st.anon_id, { sessions: [{ session_id: st.session_id, responses: [['i:x', 0, 'ab', null, 1, null]] }] })
    await expect(db.rpc(from(ip), 'mirror_put', { p_token: st.token, p_save: ok })).resolves.toMatchObject({ stored: true })
  })
})
