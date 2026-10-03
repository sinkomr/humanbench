/**
 * M2.5 (ROADMAP M2.5; DESIGN §11.3, §13; R-11.1, R-12.1): the archive and compaction, the database half.
 *
 * The bank's `hb db archive` exports a session's rows to Parquet and then calls `hb.archive_session`, which
 * moves the exposure-log and response rows of one dead session into one JSONB array (`response_archive`).
 * What this file proves, with the real RPCs and the real scoring:
 *   - rescore(save) and the eligibility of a session are the same before and after the compaction, whether
 *     none, some or all of a person's sessions are archived (the readers use hb.responses_of);
 *   - the rows come back exactly: a JSON null and a missing response, the unanswered item, the timestamps to
 *     the microsecond, the shortest-text scores;
 *   - the function refuses a session that is still live, one that changed since the export, one already
 *     archived, and a response that disagrees with its exposure row;
 *   - deleting a person (delete_my_data) deletes the archive with the session, and no API role can read or
 *     call any of it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AxisCode } from '../../src/engine/axes'
import { createRng, type Rng } from '../../src/engine/prng'
import { fixtureBank, loadFixtureBank, type FixtureItem } from './bank-fixture'
import { ANON, AUTHENTICATED, SERVICE_ROLE, type TestDb } from './harness'
import { emptySave, from, playSession, relaxSelection, signedSession, startSession, type Started } from './rpc-support'
import { PERMISSION_DENIED, openTestDb, rejectedWith } from './vitest'

let db: TestDb
let ipCounter = 0
const freshIp = (): string => `198.51.100.${++ipCounter}`
const items: FixtureItem[] = fixtureBank({ perAxis: 90, axes: ['QR', 'MAT', 'KST'], seed: 'archive', facets: 3 })
const bank = new Map(items.map((i) => [i.itemId, i]))

/** The algorithm without the protection (rescore.db.test.ts EXACT), so a changed answer shows in the reply. */
const EXACT = { 'rescore.min_axis_items': 1, 'rescore.min_facet_items': 1, 'rescore.mean_step': 0, 'rescore.sd_step': 0 } as const

beforeAll(async () => {
  db = await openTestDb()
  await relaxSelection(db)
  await loadFixtureBank(db, items)
  for (const [key, value] of Object.entries({ ...EXACT, 'rate.rescores_per_anon_day': 1000, 'rate.rescores_per_day': 1000, 'rate.deletes_per_day': 1000 })) {
    await db.owner.query(`update public.app_config set value = $2::jsonb where key = $1`, [key, JSON.stringify(value)])
  }
})
afterAll(async () => {
  await db.close()
})

interface Taken {
  sessionId: string
  anonId: string
  token: string
  ip: string
}

const issued = new Map<string, string[]>()

async function takeSession(anonId: string | undefined, n: number, theta: Partial<Record<AxisCode, number>>, rng: Rng, itemFlags?: (seq: number) => Record<string, unknown> | undefined): Promise<Taken> {
  const ip = freshIp()
  const save = anonId === undefined ? undefined : await sign(emptySave(anonId, { sessions: (issued.get(anonId) ?? []).map((session_id) => ({ session_id })) }))
  const s: Started = await startSession(db, ip, save)
  issued.set(s.anon_id, [...(issued.get(s.anon_id) ?? []), s.session_id])
  await playSession(db, s, bank, {
    ip,
    n,
    decide: (it) => {
      const z = it.a * ((theta[it.axis] ?? 0) - it.b)
      const p = (it.c ?? 0) + (1 - (it.c ?? 0)) / (1 + Math.exp(-z))
      return rng.next() < p
    },
    ...(itemFlags === undefined ? {} : { clientFlags: itemFlags }),
  })
  await db.rpc(from(ip), 'finish', { p_token: s.token })
  return { sessionId: s.session_id, anonId: s.anon_id, token: s.token, ip }
}

/** Puts a session `days` after 2026-01-01: long past the token lifetimes, so it may be archived. */
async function schedule(sessionId: string, days: number): Promise<void> {
  await db.owner.query(
    `update public.sessions set started_at = timestamptz '2026-01-01 10:00:00+00' + make_interval(days => $2), finished_at = timestamptz '2026-01-01 10:30:00+00' + make_interval(days => $2) where session_id = $1`,
    [sessionId, days],
  )
}

/** A save with `{session_id}` stubs replaced by the sessions as the server signs them now: take it BEFORE archiving, as the person's file would be. */
async function sign(doc: Record<string, unknown>): Promise<Record<string, unknown>> {
  const sessions: unknown[] = []
  for (const entry of doc.sessions as unknown[]) {
    const stub = typeof entry === 'object' && entry !== null && Object.keys(entry).join() === 'session_id' ? (entry as { session_id: string }).session_id : undefined
    const signed = stub === undefined ? null : await signedSession(db, stub)
    sessions.push(signed ?? entry)
  }
  return { ...doc, sessions }
}

const saveOf = (anonId: string, ids: readonly string[]): Record<string, unknown> => emptySave(anonId, { sessions: ids.map((id) => ({ session_id: id })) })
const rescore = async (signedSave: Record<string, unknown>): Promise<unknown> => db.rpc(from(freshIp()), 'rescore', { p_save: signedSave })

/** What `hb db archive` does for one session: the digest of the array as it stands, then the compaction. */
async function archive(sessionId: string, ref = 'test-export'): Promise<string> {
  const { rows } = await db.owner.query<{ sha: string }>(`select hb.archive_sha(hb.archive_items($1)) as sha`, [sessionId])
  return (await db.owner.query<{ status: string }>(`select hb.archive_session($1, $2, $3) as status`, [sessionId, rows[0]!.sha, ref])).rows[0]!.status
}

/** The live answer rows of some sessions as JSON (timestamps to the microsecond, reals as stored). */
async function liveRows(ids: readonly string[]): Promise<unknown> {
  const { rows } = await db.owner.query<{ j: unknown }>(`select coalesce(jsonb_agg(to_jsonb(r) order by r.session_id, r.seq), '[]'::jsonb) as j from public.responses r where r.session_id = any($1)`, [ids])
  return rows[0]!.j
}
/** The same rows from the one reader (live or archived). */
async function readerRows(ids: readonly string[]): Promise<unknown> {
  const { rows } = await db.owner.query<{ j: unknown }>(
    `select coalesce(jsonb_agg(to_jsonb(r) order by r.session_id, r.seq), '[]'::jsonb) as j from unnest($1::text[]) as s(id) cross join lateral hb.responses_of(s.id) r`,
    [ids],
  )
  return rows[0]!.j
}
async function counts(ids: readonly string[]): Promise<{ responses: number; exposures: number; archived: number }> {
  const q = async (sql: string): Promise<number> => (await db.owner.query<{ n: number }>(sql, [ids])).rows[0]!.n
  return {
    responses: await q(`select count(*)::int as n from public.responses where session_id = any($1)`),
    exposures: await q(`select count(*)::int as n from public.exposure_log where session_id = any($1)`),
    archived: await q(`select count(*)::int as n from public.response_archive where session_id = any($1)`),
  }
}
async function eligibility(ids: readonly string[]): Promise<unknown> {
  const { rows } = await db.owner.query(`select session_id, hb.is_eligible(session_id) as full, hb.is_eligible(session_id, true) as blind from unnest($1::text[]) as s(session_id) order by 1`, [ids])
  return rows
}

describe('compaction keeps what reads old answers', () => {
  it('leaves rescore and the eligibility of every session as they were, with none, some, then all of a person’s sessions archived', async () => {
    const rng = createRng('archive-person')
    const a = await takeSession(undefined, 30, { QR: 0.8, MAT: -0.3, KST: 0.2 }, rng)
    const b = await takeSession(a.anonId, 24, { QR: 0.8, MAT: -0.3 }, rng)
    // two flagged answers: this one finishes ineligible, which the blind eligibility sees too
    const c = await takeSession(a.anonId, 24, { QR: 0.8, MAT: -0.3 }, rng, (seq) => (seq <= 2 ? { too_fast: true } : undefined))
    const d = await takeSession(a.anonId, 36, { QR: 0.8, MAT: -0.3, KST: 0.2 }, rng)
    const ids = [a.sessionId, b.sessionId, c.sessionId, d.sessionId]
    for (const [i, sid] of ids.entries()) await schedule(sid, [0, 9, 20, 40][i]!)

    // the file the person keeps: signed before anything is archived
    const file = await sign(saveOf(a.anonId, ids))
    const before = await rescore(file)
    const rowsBefore = await liveRows(ids)
    const eligibleBefore = await eligibility(ids)
    expect((eligibleBefore as { full: boolean }[]).map((r) => r.full)).toContain(false)
    expect((rowsBefore as unknown[]).length).toBeGreaterThan(100)
    expect((before as { eap: Record<string, unknown> }).eap).toHaveProperty('QR')

    // none archived: the reader is the table
    expect(await readerRows(ids)).toEqual(rowsBefore)

    // some archived (the oldest and the ineligible one)
    expect(await archive(a.sessionId)).toBe('archived')
    expect(await archive(c.sessionId)).toBe('archived')
    expect(await counts([a.sessionId, c.sessionId])).toEqual({ responses: 0, exposures: 0, archived: 2 })
    expect(await counts([b.sessionId, d.sessionId])).toMatchObject({ archived: 0 })
    expect(await rescore(file)).toEqual(before)
    expect(await eligibility(ids)).toEqual(eligibleBefore)
    expect(await readerRows(ids)).toEqual(rowsBefore)

    // all archived
    expect(await archive(b.sessionId)).toBe('archived')
    expect(await archive(d.sessionId)).toBe('archived')
    expect(await counts(ids)).toEqual({ responses: 0, exposures: 0, archived: 4 })
    expect(await rescore(file)).toEqual(before)
    expect(await eligibility(ids)).toEqual(eligibleBefore)
    expect(await readerRows(ids)).toEqual(rowsBefore)
  })

  it('keeps the items of an archived session out of the person’s next session: the seen lists are the server’s rows, live or compacted', async () => {
    const rng = createRng('archive-seen')
    const a = await takeSession(undefined, 20, { QR: 0.3, MAT: 0.1 }, rng)
    await schedule(a.sessionId, 2)
    const file = await sign(saveOf(a.anonId, [a.sessionId]))
    const col = async (sql: string): Promise<string[]> => (await db.owner.query<{ x: string }>(sql, [a.sessionId])).rows.map((r) => r.x)
    const served = await col(`select item_id as x from public.exposure_log where session_id = $1 order by item_id`)
    const families = await col(`select distinct family_id as x from public.exposure_log where session_id = $1 order by family_id`)
    expect(served.length).toBeGreaterThanOrEqual(20) // the unanswered item that was pending at the end counts too
    const stateOf = async (sid: string): Promise<{ seen_items: string[]; seen_families: string[] }> =>
      (await db.owner.query<{ state: { seen_items: string[]; seen_families: string[] } }>(`select state from public.sessions where session_id = $1`, [sid])).rows[0]!.state
    const live = await startSession(db, freshIp(), file)
    expect(live.anon_id).toBe(a.anonId)
    expect(await stateOf(live.session_id)).toMatchObject({ seen_items: served, seen_families: families })
    // compacted: the rows are gone, the array holds the item ids, and the next session still keeps them away
    expect(await archive(a.sessionId)).toBe('archived')
    expect(await col(`select item_id as x from public.exposure_log where session_id = $1`)).toEqual([])
    const later = await startSession(db, freshIp(), file)
    expect(await stateOf(later.session_id)).toMatchObject({ seen_items: served, seen_families: families })
    // and a stranger who sends the same file with an id the server did not issue is served the lot again
    const stranger = await startSession(db, freshIp(), { ...file, anon_id: 'hb_7Q3m9Kx2Vw5rT8pL', sessions: [], seen_items: served })
    expect(await stateOf(stranger.session_id)).toEqual({ v: 1, seen_items: [], seen_families: [] })
  })

  it('stores the session in a fraction of the live rows’ space', async () => {
    const rng = createRng('archive-size')
    const a = await takeSession(undefined, 60, { QR: 0.1, MAT: 0.1 }, rng)
    await schedule(a.sessionId, 3)
    const live = (await db.owner.query<{ n: number }>(`select (select coalesce(sum(pg_column_size(r.*)), 0) from public.responses r where session_id = $1) + (select coalesce(sum(pg_column_size(e.*)), 0) from public.exposure_log e where session_id = $1) as n`, [a.sessionId])).rows[0]!.n
    expect(await archive(a.sessionId)).toBe('archived')
    const archived = (await db.owner.query<{ n: number; sha: string; served: number; answered: number }>(`select pg_column_size(items) as n, items_sha256 as sha, n_served as served, n_answered as answered from public.response_archive where session_id = $1`, [a.sessionId])).rows[0]!
    expect(archived.sha).toMatch(/^[0-9a-f]{64}$/)
    expect(archived.answered).toBe(60)
    expect(archived.served).toBeGreaterThanOrEqual(60)
    // rows without their index entries are the smaller half of what the live tables hold; the array is still well under them
    expect(archived.n).toBeLessThan(Number(live) * 0.8)
  })
})

describe('the rows come back exactly', () => {
  it('keeps a JSON null and a missing response apart, the unanswered item, microsecond timestamps and the reals', async () => {
    const rng = createRng('archive-exact')
    const a = await takeSession(undefined, 24, { QR: 0.2, MAT: 0.2 }, rng)
    await schedule(a.sessionId, 5)
    // an unanswered item: the last one served when the session ended is pending, and one more is added by hand
    const pending = (await db.owner.query(`select count(*)::int as n from public.exposure_log e where session_id = $1 and not exists (select 1 from public.responses r where r.session_id = e.session_id and r.seq = e.seq)`, [a.sessionId])).rows[0]!.n
    expect(pending).toBeGreaterThanOrEqual(1)
    // the awkward values, on four different answers
    await db.owner.query(`update public.responses set response = null where session_id = $1 and seq = 1`, [a.sessionId])
    await db.owner.query(`update public.responses set response = 'null'::jsonb where session_id = $1 and seq = 2`, [a.sessionId])
    await db.owner.query(`update public.responses set score = 0.1, confidence = 0, correct = null, rt_ms = 0 where session_id = $1 and seq = 3`, [a.sessionId])
    await db.owner.query(`update public.responses set score = 0.33333334, confidence = 100, client_flags = '{"paste":true,"too_fast":false,"x":null,"n":12.5}'::jsonb where session_id = $1 and seq = 4`, [a.sessionId])
    await db.owner.query(`update public.responses set score = null, confidence = null, rt_ms = null where session_id = $1 and seq = 5`, [a.sessionId])
    await db.owner.query(`update public.responses set response = '{"text":"naïve café ✓ \\\\ \\" quote","n":[1,2.50,{"a":null}]}'::jsonb where session_id = $1 and seq = 6`, [a.sessionId])
    await db.owner.query(`update public.responses set created_at = started + interval '3 seconds 123457 microseconds' from (select started_at as started from public.sessions where session_id = $1) s where responses.session_id = $1 and responses.seq = 7`, [a.sessionId])
    await db.owner.query(`update public.exposure_log set served_at = started + interval '1 second 7 microseconds', pretest = true from (select started_at as started from public.sessions where session_id = $1) s where exposure_log.session_id = $1 and exposure_log.seq = 7`, [a.sessionId])
    await db.owner.query(`update public.responses set pretest = true where session_id = $1 and seq = 7`, [a.sessionId])
    // a time before the start of the session (clock steps happen) is a negative offset
    await db.owner.query(`update public.exposure_log set served_at = started - interval '2 seconds 5 microseconds' from (select started_at as started from public.sessions where session_id = $1) s where exposure_log.session_id = $1 and exposure_log.seq = 8`, [a.sessionId])
    const before = await liveRows([a.sessionId])
    const exposures = (await db.owner.query(`select to_jsonb(e) as j from public.exposure_log e where session_id = $1 order by seq`, [a.sessionId])).rows.map((r) => r.j)

    expect(await archive(a.sessionId)).toBe('archived')
    expect(await readerRows([a.sessionId])).toEqual(before)
    // the missing and the JSON-null responses stay different
    const back = (await db.owner.query<{ seq: number; sql_null: boolean; json_null: boolean }>(`select seq, response is null as sql_null, response = 'null'::jsonb as json_null from hb.responses_of($1) where seq in (1, 2) order by seq`, [a.sessionId])).rows
    expect(back).toEqual([
      { seq: 1, sql_null: true, json_null: null },
      { seq: 2, sql_null: false, json_null: true },
    ])
    // the unanswered items are in the archive (and in nothing that reads answers)
    const kept = (await db.owner.query<{ served: number; answered: number; items: unknown[][] }>(`select n_served as served, n_answered as answered, items from public.response_archive where session_id = $1`, [a.sessionId])).rows[0]!
    expect(kept.served).toBe(exposures.length)
    expect(kept.served - kept.answered).toBe(pending)
    expect(kept.items.map((el) => el[0])).toEqual(exposures.map((e) => (e as { seq: number }).seq))
    expect(kept.items.every((el) => el.length === 12)).toBe(true)
  })
})

describe('what the function refuses', () => {
  it('leaves a session whose token is still valid alone', async () => {
    const rng = createRng('archive-fresh')
    const a = await takeSession(undefined, 6, { QR: 0 }, rng)
    const before = await counts([a.sessionId])
    expect(await archive(a.sessionId)).toBe('too_recent')
    expect(await counts([a.sessionId])).toEqual(before)
    // an unfinished session counts from its start, a finished one from its end
    await db.owner.query(`update public.sessions set started_at = now() - interval '2 hours', finished_at = null where session_id = $1`, [a.sessionId])
    expect(await archive(a.sessionId)).toBe('too_recent')
    await db.owner.query(`update public.sessions set started_at = now() - interval '13 hours' where session_id = $1`, [a.sessionId])
    expect(await archive(a.sessionId)).toBe('archived')
  })

  it('answers missing, empty, already and changed without deleting anything', async () => {
    const rng = createRng('archive-statuses')
    const a = await takeSession(undefined, 8, { QR: 0 }, rng)
    await schedule(a.sessionId, 11)
    expect(await db.owner.query(`select hb.archive_session('s_doesnotexist01', 'x', 'r') as status`).then((r) => r.rows[0]!.status)).toBe('missing')

    // changed: a row moved after the export, or no digest at all
    const stale = (await db.owner.query<{ sha: string }>(`select hb.archive_sha(hb.archive_items($1)) as sha`, [a.sessionId])).rows[0]!.sha
    await db.owner.query(`update public.responses set rt_ms = rt_ms + 1 where session_id = $1 and seq = 1`, [a.sessionId])
    const before = await counts([a.sessionId])
    for (const sha of [stale, null, 'not a digest']) {
      expect((await db.owner.query(`select hb.archive_session($1, $2, 'r') as status`, [a.sessionId, sha])).rows[0]!.status).toBe('changed')
    }
    expect(await counts([a.sessionId])).toEqual(before)

    expect(await archive(a.sessionId)).toBe('archived')
    // already: the second call changes nothing (not even when live rows come back)
    expect(await archive(a.sessionId)).toBe('already')
    expect(await counts([a.sessionId])).toEqual({ responses: 0, exposures: 0, archived: 1 })

    // empty: a session that was started and never served anything
    const e = await startSession(db, freshIp())
    await schedule(e.session_id, 12)
    expect((await db.owner.query(`select hb.archive_session($1, hb.archive_sha('[]'::jsonb), 'r') as status`, [e.session_id])).rows[0]!.status).toBe('empty')
    expect(await counts([e.session_id])).toEqual({ responses: 0, exposures: 0, archived: 0 })
  })

  it('refuses a response that disagrees with its exposure row (the archive keeps one item and one pretest flag per answer)', async () => {
    const rng = createRng('archive-inconsistent')
    const a = await takeSession(undefined, 8, { QR: 0 }, rng)
    await schedule(a.sessionId, 13)
    await db.owner.query(`update public.responses set pretest = not pretest where session_id = $1 and seq = 2`, [a.sessionId])
    const before = await counts([a.sessionId])
    expect(await archive(a.sessionId)).toBe('inconsistent')
    expect(await counts([a.sessionId])).toEqual(before)
  })
})

describe('access (R-12.1)', () => {
  it('lets no API role read the archive or call a function of it; service_role may read it', async () => {
    for (const ctx of [ANON, AUTHENTICATED]) {
      expect(await rejectedWith(db.query(ctx, `select * from public.response_archive limit 1`))).toBe(PERMISSION_DENIED)
      expect(await rejectedWith(db.query(ctx, `select * from hb.responses_of('s_x')`))).toBe(PERMISSION_DENIED)
      expect(await rejectedWith(db.query(ctx, `select hb.archive_session('s_x', 'x', 'r')`))).toBe(PERMISSION_DENIED)
      expect(await rejectedWith(db.query(ctx, `select hb.archive_items('s_x')`))).toBe(PERMISSION_DENIED)
    }
    await db.query(SERVICE_ROLE, `select count(*) from public.response_archive`)
    expect(await rejectedWith(db.query(SERVICE_ROLE, `delete from public.response_archive`))).toBe(PERMISSION_DENIED)
    expect(await rejectedWith(db.query(SERVICE_ROLE, `delete from public.exposure_log`))).toBe(PERMISSION_DENIED)
  })

  it('stores no brief_prefs key even if a response held one (AI.26)', async () => {
    expect(await rejectedWith(db.owner.query(`insert into public.response_archive (session_id, n_served, n_answered, items, items_sha256, export_ref) select session_id, 1, 0, '[[1,"i:x",0,0,{"brief_prefs":1},null,null,null,null,{},null,null]]'::jsonb, repeat('a', 64), 'r' from public.sessions s where not exists (select 1 from public.response_archive a where a.session_id = s.session_id) limit 1`))).toBe('23514')
  })
})

describe('deleting a person (DESIGN §13)', () => {
  it('delete_my_data deletes the archive with the session, on the file the person kept', async () => {
    const rng = createRng('archive-delete')
    const a = await takeSession(undefined, 12, { QR: 0.5 }, rng)
    const b = await takeSession(a.anonId, 12, { QR: 0.5 }, rng)
    const other = await takeSession(undefined, 12, { QR: 0.5 }, rng)
    for (const [i, sid] of [a.sessionId, b.sessionId, other.sessionId].entries()) await schedule(sid, 20 + i)
    const file = await sign(saveOf(a.anonId, [a.sessionId, b.sessionId]))
    for (const sid of [a.sessionId, other.sessionId]) expect(await archive(sid)).toBe('archived')
    expect(await counts([a.sessionId, b.sessionId, other.sessionId])).toMatchObject({ archived: 2 })

    const out = await db.rpc(from(freshIp()), 'delete_my_data', { p_anon_id: a.anonId, p_save: file })
    expect(out).toEqual({ deleted: true, sessions: 2, mirror: false })
    expect(await counts([a.sessionId, b.sessionId])).toEqual({ responses: 0, exposures: 0, archived: 0 })
    // another person's archive is untouched
    expect(await counts([other.sessionId])).toEqual({ responses: 0, exposures: 0, archived: 1 })
  })
})
