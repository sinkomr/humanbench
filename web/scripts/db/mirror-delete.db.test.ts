/**
 * M2.1 (ROADMAP M2.1; DESIGN §8 "Optional server mirror", §13; ROADMAP AI.26): mirror_put,
 * mirror_get and delete_my_data.
 */

import { createHash } from 'node:crypto'
import fc from 'fast-check'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fixtureBank, loadFixtureBank } from './bank-fixture'
import type { TestDb } from './harness'
import { ANON_ID_RE, emptySave, from, startSession, type Started } from './rpc-support'
import { openTestDb, pgCode } from './vitest'

let db: TestDb
let ipCounter = 0
const freshIp = (): string => `198.51.100.${++ipCounter}`
const words = new Set<string>()

beforeAll(async () => {
  db = await openTestDb()
  await loadFixtureBank(db, fixtureBank({ perAxis: 4, seed: 'mirror' }))
  for (const r of (await db.owner.query<{ word: string }>(`select word from public.recovery_words`)).rows) words.add(r.word)
})
afterAll(async () => {
  await db.close()
})

const rpc = <T = unknown>(ip: string, fn: string, args: Record<string, unknown> = {}): Promise<T> => db.rpc<T>(from(ip), fn, args)
async function failure(promise: Promise<unknown>): Promise<{ code: string | undefined; message: string }> {
  try {
    await promise
  } catch (e) {
    return { code: pgCode(e), message: (e as Error).message }
  }
  throw new Error('expected the call to fail, but it succeeded')
}
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')

interface Put {
  stored: boolean
  anon_id?: string
  size_bytes?: number
  recovery_phrase?: string
  error?: string
}

/** A person with a started session and a save for its anon_id. */
async function person(extraSave: Record<string, unknown> = {}): Promise<{ ip: string; s: Started; save: Record<string, unknown> }> {
  const ip = freshIp()
  const s = await startSession(db, ip)
  return { ip, s, save: emptySave(s.anon_id, extraSave) }
}

describe('mirror_put', () => {
  it('stores the save and returns a 12-word recovery phrase once; only its hash is kept', async () => {
    const { ip, s, save } = await person({ seen_items: ['i:tst:g1:00001'] })
    const out = await rpc<Put>(ip, 'mirror_put', { p_token: s.token, p_save: save })
    expect(out.stored).toBe(true)
    expect(out.anon_id).toBe(s.anon_id)
    const phrase = out.recovery_phrase!
    const parts = phrase.split(' ')
    expect(parts.length).toBe(12)
    for (const w of parts) expect(words.has(w), w).toBe(true)
    const row = (await db.owner.query(`select * from public.mirror where anon_id = $1`, [s.anon_id])).rows[0]
    expect(row.blob).toEqual(save)
    expect(row.size_bytes).toBe((await db.owner.query(`select octet_length(blob::text)::int as n from public.mirror where anon_id = $1`, [s.anon_id])).rows[0].n)
    expect((row.phrase_hash as Buffer).toString('hex')).toBe(sha256(phrase))
    // the phrase is in no table, in any form
    const dump = await db.owner.query<{ t: string }>(`select m::text as t from public.mirror m union all select s::text from public.sessions s`)
    for (const r of dump.rows) expect(r.t).not.toContain(phrase)
  })

  it('draws different phrases (120 random bits) and every word from the list', async () => {
    const seen = new Set<string>()
    for (let i = 0; i < 6; i++) {
      const { ip, s, save } = await person()
      const out = await rpc<Put>(ip, 'mirror_put', { p_token: s.token, p_save: save })
      seen.add(out.recovery_phrase!)
    }
    expect(seen.size).toBe(6)
  })

  it('needs the phrase to replace a save, ignoring case and spacing, and counts a wrong one', async () => {
    const { ip, s, save } = await person()
    const first = await rpc<Put>(ip, 'mirror_put', { p_token: s.token, p_save: save })
    const newer = { ...save, seen_items: ['i:tst:g1:00002'] }
    expect(await rpc(ip, 'mirror_put', { p_token: s.token, p_save: newer })).toEqual({ stored: false, error: 'wrong_phrase' })
    expect(await rpc(ip, 'mirror_put', { p_token: s.token, p_save: newer, p_phrase: 'wrong wrong' })).toEqual({ stored: false, error: 'wrong_phrase' })
    expect((await db.owner.query(`select blob from public.mirror where anon_id = $1`, [s.anon_id])).rows[0].blob).toEqual(save)
    const loud = `  ${first.recovery_phrase!.toUpperCase().replace(/ /g, '\n ')} `
    const ok = await rpc<Put>(ip, 'mirror_put', { p_token: s.token, p_save: newer, p_phrase: loud })
    expect(ok).toMatchObject({ stored: true, anon_id: s.anon_id })
    expect(ok.recovery_phrase).toBeUndefined()
    expect((await db.owner.query(`select blob from public.mirror where anon_id = $1`, [s.anon_id])).rows[0].blob).toEqual(newer)
  })

  it('stores only the save of the anon_id its session belongs to', async () => {
    const { ip, s } = await person()
    const f = await failure(rpc(ip, 'mirror_put', { p_token: s.token, p_save: emptySave('hb_AAAAAAAAAAAAAAAA') }))
    expect(f).toMatchObject({ code: 'PT403', message: 'anon_id_mismatch' })
    expect(await failure(rpc(ip, 'mirror_put', { p_token: 'hbt_AAAAAAAAAAAAAAAAAAAAAA', p_save: emptySave(s.anon_id) }))).toMatchObject({ code: 'PT401' })
  })

  it('refuses a save over mirror.max_bytes, and new mirrors once mirror.max_rows is reached', async () => {
    const { ip, s, save } = await person({ seen_items: Array.from({ length: 200 }, (_, i) => `i:tst:g1:${String(i).padStart(5, '0')}`) })
    await db.owner.query(`update public.app_config set value = '2000' where key = 'mirror.max_bytes'`)
    try {
      expect(await failure(rpc(ip, 'mirror_put', { p_token: s.token, p_save: save }))).toMatchObject({ code: 'PT413', message: 'save_too_large' })
    } finally {
      await db.owner.query(`update public.app_config set value = '524288' where key = 'mirror.max_bytes'`)
    }
    const n = (await db.owner.query(`select count(*)::int as n from public.mirror`)).rows[0].n as number
    await db.owner.query(`update public.app_config set value = $1 where key = 'mirror.max_rows'`, [String(n)])
    try {
      expect(await failure(rpc(ip, 'mirror_put', { p_token: s.token, p_save: emptySave(s.anon_id) }))).toMatchObject({ code: 'PT507', message: 'mirror_full' })
    } finally {
      await db.owner.query(`update public.app_config set value = '5000' where key = 'mirror.max_rows'`)
    }
  })

  it('limits puts per client address per day', async () => {
    const { ip, s, save } = await person()
    await db.owner.query(`update public.app_config set value = '2' where key = 'rate.mirror_puts_per_day'`)
    try {
      const first = await rpc<Put>(ip, 'mirror_put', { p_token: s.token, p_save: save })
      await rpc(ip, 'mirror_put', { p_token: s.token, p_save: save, p_phrase: first.recovery_phrase })
      expect(await failure(rpc(ip, 'mirror_put', { p_token: s.token, p_save: save, p_phrase: first.recovery_phrase }))).toMatchObject({ code: 'PT429' })
    } finally {
      await db.owner.query(`update public.app_config set value = '30' where key = 'rate.mirror_puts_per_day'`)
    }
  })
})

describe('mirror_get', () => {
  it('returns the save for anon_id + phrase and nothing otherwise, the same answer for a wrong phrase and an unknown id', async () => {
    const { ip, s, save } = await person({ seen_families: ['f:tst:000000000000'] })
    const put = await rpc<Put>(ip, 'mirror_put', { p_token: s.token, p_save: save })
    const newDevice = freshIp()
    const got = await rpc<{ found: boolean; save?: unknown; updated_utc?: string }>(newDevice, 'mirror_get', { p_anon_id: s.anon_id, p_phrase: put.recovery_phrase })
    expect(got.found).toBe(true)
    expect(got.save).toEqual(save)
    expect(got.updated_utc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    const wrong = await rpc(newDevice, 'mirror_get', { p_anon_id: s.anon_id, p_phrase: 'wrong phrase' })
    const unknown = await rpc(newDevice, 'mirror_get', { p_anon_id: 'hb_ZZZZZZZZZZZZZZZZ', p_phrase: put.recovery_phrase })
    const malformed = await rpc(newDevice, 'mirror_get', { p_anon_id: 'nope', p_phrase: put.recovery_phrase })
    const nullPhrase = await rpc(newDevice, 'mirror_get', { p_anon_id: s.anon_id, p_phrase: null })
    for (const r of [wrong, unknown, malformed, nullPhrase]) expect(r).toEqual({ found: false })
  })

  it('locks an address out after too many wrong phrases in a day, keeping the count across the failures', async () => {
    const { ip, s, save } = await person()
    const put = await rpc<Put>(ip, 'mirror_put', { p_token: s.token, p_save: save })
    const attacker = freshIp()
    await db.owner.query(`update public.app_config set value = '4' where key = 'rate.phrase_failures_per_ip_day'`)
    try {
      for (let i = 0; i < 4; i++) expect(await rpc(attacker, 'mirror_get', { p_anon_id: s.anon_id, p_phrase: `guess ${i}` })).toEqual({ found: false })
      expect(await failure(rpc(attacker, 'mirror_get', { p_anon_id: s.anon_id, p_phrase: put.recovery_phrase }))).toMatchObject({ code: 'PT429', message: 'rate_limited' })
      // the owner, from another address, is not locked out (no per-anon_id lockout)
      await expect(rpc(freshIp(), 'mirror_get', { p_anon_id: s.anon_id, p_phrase: put.recovery_phrase })).resolves.toMatchObject({ found: true })
    } finally {
      await db.owner.query(`update public.app_config set value = '60' where key = 'rate.phrase_failures_per_ip_day'`)
    }
  })
})

describe('the notes settings never reach the mirror (AI.26, R-17.1, R-17.12)', () => {
  const prefs = { v: 1, topics: 'topics-v1', groups: 'g1', notes_as_of: '2026-10', contexts: [], fit_log: [] }

  it('rejects a save with brief_prefs, at the top or deep inside, and the mirror stays as it was', async () => {
    const { ip, s, save } = await person()
    const put = await rpc<Put>(ip, 'mirror_put', { p_token: s.token, p_save: save })
    for (const bad of [{ ...save, brief_prefs: prefs }, { ...save, sessions: [{ session_id: 's_abcdefgh', responses: [], x: { y: [{ brief_prefs: 1 }] } }] }, { ...save, BRIEF_PREFS: prefs }]) {
      expect(await failure(rpc(ip, 'mirror_put', { p_token: s.token, p_save: bad, p_phrase: put.recovery_phrase }))).toMatchObject({ code: 'PT400', message: 'brief_prefs_not_accepted' })
    }
    expect((await db.owner.query(`select blob from public.mirror where anon_id = $1`, [s.anon_id])).rows[0].blob).toEqual(save)
  })

  it('also refuses the key in mirror_get / delete_my_data / rescore payloads where a save is sent', async () => {
    const { ip, s, save } = await person()
    const bad = { ...save, brief_prefs: prefs }
    expect(await failure(rpc(ip, 'delete_my_data', { p_anon_id: s.anon_id, p_save: bad }))).toMatchObject({ code: 'PT400', message: 'brief_prefs_not_accepted' })
    expect(await failure(rpc(ip, 'rescore', { p_save: bad }))).toMatchObject({ code: 'PT400', message: 'brief_prefs_not_accepted' })
  })

  it('has a CHECK on the blob, so not even a write around the RPC can store the key', async () => {
    const { s, save } = await person()
    const code = pgCode(await db.owner.query(`insert into public.mirror (anon_id, phrase_hash, blob, size_bytes) values ($1, '\\x00', $2::jsonb, 10)`, [s.anon_id, JSON.stringify({ ...save, brief_prefs: prefs })]).catch((e: unknown) => e))
    expect(code).toBe('23514')
  })

  it('finds a brief_prefs key placed at any depth of any random JSON, and never one that is not there', async () => {
    const jsonDoc = fc.jsonValue({ maxDepth: 4 })
    await fc.assert(
      fc.asyncProperty(fc.array(jsonDoc, { minLength: 1, maxLength: 6 }), fc.integer({ min: 0, max: 5 }), fc.constantFrom('brief_prefs', 'Brief_Prefs', 'BRIEF_PREFS'), async (docs, at, spelling) => {
        // wrap the docs in objects and arrays, once clean and once with the key planted at some depth
        const clean = { sessions: docs, nested: { list: docs.map((d) => ({ v: d })) } }
        const planted = JSON.parse(JSON.stringify(clean)) as { nested: { list: Array<Record<string, unknown>> } }
        const target = planted.nested.list[at % planted.nested.list.length]!
        target[spelling] = 1
        const { rows } = await db.owner.query<{ clean: boolean; planted: boolean }>(`select hb.no_brief_prefs($1::jsonb) as clean, hb.no_brief_prefs($2::jsonb) as planted`, [JSON.stringify(clean), JSON.stringify(planted)])
        // a random key could itself be "brief_prefs" in some case (fast-check does not generate that); the planted copy always has one
        expect(rows[0]).toEqual({ clean: true, planted: false })
      }),
      { numRuns: 150 },
    )
  })

  it('has a mirror with no trace of the notes in its stored blobs after a run of random saves', async () => {
    const jsonDoc = fc.jsonValue({ maxDepth: 3 })
    const docs = fc.sample(jsonDoc, 30)
    for (const [i, extra] of docs.entries()) {
      const { ip, s } = await person()
      const save = emptySave(s.anon_id, { extra })
      const planted = i % 3 === 0
      const payload = planted ? { ...save, deep: { list: [{ brief_prefs: 1 }] } } : save
      if (planted) expect(await failure(rpc(ip, 'mirror_put', { p_token: s.token, p_save: payload }))).toMatchObject({ code: 'PT400' })
      else await rpc(ip, 'mirror_put', { p_token: s.token, p_save: payload })
    }
    const { rows } = await db.owner.query<{ n: number }>(`select count(*)::int as n from public.mirror where blob::text ilike '%brief_prefs%'`)
    expect(rows[0]!.n).toBe(0)
  })
})

describe('delete_my_data', () => {
  /** A person with a finished session, a report, a survey answer and a mirror. */
  async function populated(): Promise<{ ip: string; s: Started; phrase: string; save: Record<string, unknown> }> {
    const { ip, s, save } = await person()
    const n = await rpc<{ item: { item_id: string } }>(ip, 'next_item', { p_token: s.token })
    await db.owner.query(`update public.exposure_log set served_at = served_at - interval '20 seconds' where session_id = $1`, [s.session_id])
    await rpc(ip, 'submit', { p_token: s.token, p_item_id: n.item.item_id, p_response: 0, p_rt_ms: 5000, p_next: false })
    await rpc(ip, 'report_problem', { p_token: s.token, p_kind: 'typo', p_item_id: n.item.item_id })
    await rpc(ip, 'submit_survey', { p_token: s.token, p_age_band: '25-34', p_english_first: true })
    const fin = await rpc<{ session: unknown }>(ip, 'finish', { p_token: s.token })
    const full = { ...save, sessions: [fin.session] }
    const put = await rpc<Put>(ip, 'mirror_put', { p_token: s.token, p_save: full })
    return { ip, s, phrase: put.recovery_phrase!, save: full }
  }
  const counts = async (anonId: string): Promise<Record<string, number>> => {
    const q = async (sql: string): Promise<number> => (await db.owner.query<{ n: number }>(sql, [anonId])).rows[0]!.n
    return {
      sessions: await q(`select count(*)::int as n from public.sessions where anon_id = $1`),
      responses: await q(`select count(*)::int as n from public.responses r join public.sessions s using (session_id) where s.anon_id = $1`),
      exposures: await q(`select count(*)::int as n from public.exposure_log r join public.sessions s using (session_id) where s.anon_id = $1`),
      flags: await q(`select count(*)::int as n from public.flags r join public.sessions s using (session_id) where s.anon_id = $1`),
      survey: await q(`select count(*)::int as n from public.survey r join public.sessions s using (session_id) where s.anon_id = $1`),
      mirror: await q(`select count(*)::int as n from public.mirror where anon_id = $1`),
    }
  }

  it('deletes everything stored for an anon_id when the recovery phrase is right, and nothing of anyone else', async () => {
    const a = await populated()
    const b = await populated()
    expect(await counts(a.s.anon_id)).toEqual({ sessions: 1, responses: 1, exposures: 1, flags: 1, survey: 1, mirror: 1 })
    const out = await rpc(freshIp(), 'delete_my_data', { p_anon_id: a.s.anon_id, p_phrase: a.phrase })
    expect(out).toEqual({ deleted: true, sessions: 1, mirror: true })
    expect(await counts(a.s.anon_id)).toEqual({ sessions: 0, responses: 0, exposures: 0, flags: 0, survey: 0, mirror: 0 })
    expect(await counts(b.s.anon_id)).toEqual({ sessions: 1, responses: 1, exposures: 1, flags: 1, survey: 1, mirror: 1 })
    // the deleted person's token no longer opens anything
    expect(await failure(rpc(a.ip, 'next_item', { p_token: a.s.token }))).toMatchObject({ code: 'PT401' })
  })

  it('says only "not deleted" for a wrong phrase, an unknown anon_id or a phrase of another person', async () => {
    const a = await populated()
    const b = await populated()
    const ip = freshIp()
    for (const args of [{ p_anon_id: a.s.anon_id, p_phrase: 'wrong wrong wrong' }, { p_anon_id: a.s.anon_id, p_phrase: b.phrase }, { p_anon_id: 'hb_QQQQQQQQQQQQQQQQ', p_phrase: a.phrase }]) {
      expect(await rpc(ip, 'delete_my_data', args)).toEqual({ deleted: false })
    }
    expect((await counts(a.s.anon_id)).sessions).toBe(1)
  })

  it('deletes on a save file that lists a session the server issued to that anon_id', async () => {
    const a = await populated()
    const out = await rpc(freshIp(), 'delete_my_data', { p_anon_id: a.s.anon_id, p_save: a.save })
    expect(out).toEqual({ deleted: true, sessions: 1, mirror: true })
    expect(await counts(a.s.anon_id)).toEqual({ sessions: 0, responses: 0, exposures: 0, flags: 0, survey: 0, mirror: 0 })
  })

  it('does not delete on a save that lists no session of that anon_id, another anon_id, or an invented session', async () => {
    const a = await populated()
    const b = await populated()
    const ip = freshIp()
    const invented = { ...a.save, sessions: [{ session_id: 's_inventedinvented' }] }
    const others = { ...a.save, sessions: (b.save.sessions as unknown[]) } // b's sessions under a's anon_id
    const wrongId = { ...b.save } // a save of b sent for a's anon_id
    for (const save of [invented, others, wrongId, { ...a.save, sessions: [] }]) {
      expect(await rpc(ip, 'delete_my_data', { p_anon_id: a.s.anon_id, p_save: save }), JSON.stringify(save).slice(0, 60)).toEqual({ deleted: false })
    }
    expect((await counts(a.s.anon_id)).sessions).toBe(1)
    expect((await counts(b.s.anon_id)).sessions).toBe(1)
  })

  it('needs a proof, a well-formed anon_id, and is rate limited', async () => {
    const ip = freshIp()
    expect(await failure(rpc(ip, 'delete_my_data', { p_anon_id: 'hb_QQQQQQQQQQQQQQQQ' }))).toMatchObject({ code: 'PT400', message: 'invalid_request' })
    expect(await failure(rpc(ip, 'delete_my_data', { p_anon_id: 'nobody', p_phrase: 'x' }))).toMatchObject({ code: 'PT400', message: 'invalid_anon_id' })
    await db.owner.query(`update public.app_config set value = '2' where key = 'rate.deletes_per_day'`)
    try {
      const other = freshIp()
      await rpc(other, 'delete_my_data', { p_anon_id: 'hb_QQQQQQQQQQQQQQQQ', p_phrase: 'x' })
      await rpc(other, 'delete_my_data', { p_anon_id: 'hb_QQQQQQQQQQQQQQQQ', p_phrase: 'x' })
      expect(await failure(rpc(other, 'delete_my_data', { p_anon_id: 'hb_QQQQQQQQQQQQQQQQ', p_phrase: 'x' }))).toMatchObject({ code: 'PT429' })
    } finally {
      await db.owner.query(`update public.app_config set value = '10' where key = 'rate.deletes_per_day'`)
    }
  })

  it('leaves no trace of the person in the rate tables (they hold hashes and counts only)', async () => {
    const a = await populated()
    await rpc(freshIp(), 'delete_my_data', { p_anon_id: a.s.anon_id, p_phrase: a.phrase })
    const dump = await db.owner.query<{ t: string }>(`select r::text as t from public.rate_limits r union all select r::text from public.rate_salts r`)
    for (const r of dump.rows) {
      expect(r.t).not.toContain(a.s.anon_id)
      expect(r.t).not.toContain(a.s.session_id)
    }
    expect(ANON_ID_RE.test(a.s.anon_id)).toBe(true)
  })
})
