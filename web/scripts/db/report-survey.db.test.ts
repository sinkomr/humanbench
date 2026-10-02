/**
 * M2.1 (ROADMAP M2.1; DESIGN §4.5, §13; ROADMAP AI.26): report_problem and submit_survey.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fixtureBank, loadFixtureBank } from './bank-fixture'
import type { TestDb } from './harness'
import { from, relaxSelection, startSession, type Next, type Served } from './rpc-support'
import { openTestDb, pgCode } from './vitest'

let db: TestDb
let ipCounter = 0
const freshIp = (): string => `198.51.100.${++ipCounter}`

beforeAll(async () => {
  db = await openTestDb()
  await relaxSelection(db)
  await loadFixtureBank(db, fixtureBank({ perAxis: 6, seed: 'report' }))
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

/** A started session that has been served one item. */
async function withItem(): Promise<{ ip: string; token: string; sessionId: string; itemId: string }> {
  const ip = freshIp()
  const s = await startSession(db, ip)
  const n = (await rpc<Next>(ip, 'next_item', { p_token: s.token })) as Served
  return { ip, token: s.token, sessionId: s.session_id, itemId: n.item.item_id }
}

const flagRows = async (sessionId: string): Promise<Record<string, unknown>[]> =>
  (await db.owner.query(`select item_id, kind, detail, source, resolved from public.flags where session_id = $1 order by flag_id`, [sessionId])).rows

describe('report_problem', () => {
  it.each(['wrong_key', 'ambiguous', 'typo', 'offensive', 'broken'])('records a %s report on an item the session was served', async (kind) => {
    const { ip, token, sessionId, itemId } = await withItem()
    await expect(rpc(ip, 'report_problem', { p_token: token, p_kind: kind, p_item_id: itemId, p_detail: '  the second option is also right ' })).resolves.toEqual({ recorded: true })
    expect(await flagRows(sessionId)).toEqual([{ item_id: itemId, kind, detail: 'the second option is also right', source: 'user', resolved: false }])
  })

  it('records "someone asked me for my notes" with no item and no text, apart from the item reports (AI.26)', async () => {
    const { ip, token, sessionId, itemId } = await withItem()
    await rpc(ip, 'report_problem', { p_token: token, p_kind: 'notes_requested' })
    await rpc(ip, 'report_problem', { p_token: token, p_kind: 'typo', p_item_id: itemId })
    expect(await flagRows(sessionId)).toEqual([
      { item_id: null, kind: 'notes_requested', detail: null, source: 'user', resolved: false },
      { item_id: itemId, kind: 'typo', detail: null, source: 'user', resolved: false },
    ])
    // The quarantine rule of DESIGN §4.5 counts item reports: this one is on no item, so it is on none.
    const perItem = await db.owner.query(`select item_id, count(*)::int as n from public.flags where source = 'user' and kind <> 'notes_requested' and item_id is not null group by item_id`)
    expect(perItem.rows.every((r) => r.item_id !== null)).toBe(true)
    expect((await db.owner.query(`select count(*)::int as n from public.flags where kind = 'notes_requested' and item_id is not null`)).rows[0].n).toBe(0)
  })

  it('refuses a notes report that names an item or carries text, and keeps it that way in the table', async () => {
    const { ip, token, sessionId, itemId } = await withItem()
    expect(await failure(rpc(ip, 'report_problem', { p_token: token, p_kind: 'notes_requested', p_item_id: itemId }))).toMatchObject({ code: 'PT400', message: 'invalid_report' })
    expect(await failure(rpc(ip, 'report_problem', { p_token: token, p_kind: 'notes_requested', p_detail: 'my teacher wanted them' }))).toMatchObject({ code: 'PT400', message: 'invalid_report' })
    expect(await flagRows(sessionId)).toEqual([])
    // the CHECK constraints hold even for a write around the RPC
    expect(pgCode(await db.owner.query(`insert into public.flags (session_id, kind, detail, source) values ($1, 'notes_requested', 'text', 'user')`, [sessionId]).catch((e: unknown) => e))).toBe('23514')
    expect(pgCode(await db.owner.query(`insert into public.flags (session_id, item_id, kind, source) values ($1, $2, 'notes_requested', 'user')`, [sessionId, itemId]).catch((e: unknown) => e))).toBe('23514')
  })

  it('refuses an unknown kind, an item report without an item, an item the session never saw, and long text', async () => {
    const { ip, token, itemId } = await withItem()
    const other = (await db.owner.query<{ item_id: string }>(`select item_id from public.items where item_id <> $1 limit 1`, [itemId])).rows[0]!.item_id
    expect(await failure(rpc(ip, 'report_problem', { p_token: token, p_kind: 'spam', p_item_id: itemId }))).toMatchObject({ code: 'PT400', message: 'invalid_kind' })
    expect(await failure(rpc(ip, 'report_problem', { p_token: token, p_kind: 'typo' }))).toMatchObject({ code: 'PT400', message: 'invalid_report' })
    expect(await failure(rpc(ip, 'report_problem', { p_token: token, p_kind: 'typo', p_item_id: other }))).toMatchObject({ code: 'PT404', message: 'item_not_served' })
    expect(await failure(rpc(ip, 'report_problem', { p_token: token, p_kind: 'typo', p_item_id: itemId, p_detail: 'x'.repeat(501) }))).toMatchObject({ code: 'PT413' })
    expect(await failure(rpc(ip, 'report_problem', { p_token: 'hbt_AAAAAAAAAAAAAAAAAAAAAA', p_kind: 'typo', p_item_id: itemId }))).toMatchObject({ code: 'PT401' })
  })

  it('counts a repeat of the same report once, and caps the reports of a session', async () => {
    const { ip, token, sessionId, itemId } = await withItem()
    for (let i = 0; i < 3; i++) await rpc(ip, 'report_problem', { p_token: token, p_kind: 'typo', p_item_id: itemId })
    await rpc(ip, 'report_problem', { p_token: token, p_kind: 'broken', p_item_id: itemId })
    await rpc(ip, 'report_problem', { p_token: token, p_kind: 'notes_requested' })
    await rpc(ip, 'report_problem', { p_token: token, p_kind: 'notes_requested' })
    expect((await flagRows(sessionId)).length).toBe(3)
    await db.owner.query(`update public.app_config set value = '3' where key = 'session.max_reports'`)
    try {
      expect(await failure(rpc(ip, 'report_problem', { p_token: token, p_kind: 'offensive', p_item_id: itemId }))).toMatchObject({ code: 'PT429', message: 'rate_limited' })
    } finally {
      await db.owner.query(`update public.app_config set value = '20' where key = 'session.max_reports'`)
    }
  })

  it('works after the session is finished', async () => {
    const { ip, token, itemId } = await withItem()
    await rpc(ip, 'finish', { p_token: token })
    await expect(rpc(ip, 'report_problem', { p_token: token, p_kind: 'ambiguous', p_item_id: itemId })).resolves.toEqual({ recorded: true })
  })

  it('is deleted with the session (no report outlives a deletion)', async () => {
    const { ip, token, sessionId, itemId } = await withItem()
    await rpc(ip, 'report_problem', { p_token: token, p_kind: 'typo', p_item_id: itemId })
    await db.owner.query(`delete from public.sessions where session_id = $1`, [sessionId])
    expect(await flagRows(sessionId)).toEqual([])
    expect(ip).toBeDefined()
  })
})

describe('submit_survey', () => {
  it('stores the two answers apart from the session, keyed by session only', async () => {
    const ip = freshIp()
    const s = await startSession(db, ip)
    await expect(rpc(ip, 'submit_survey', { p_token: s.token, p_age_band: '35-44', p_english_first: true })).resolves.toEqual({ recorded: true })
    expect((await db.owner.query(`select session_id, age_band, english_first from public.survey where session_id = $1`, [s.session_id])).rows).toEqual([{ session_id: s.session_id, age_band: '35-44', english_first: true }])
    const cols = (await db.owner.query<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'survey' order by ordinal_position`)).rows.map((r) => r.column_name)
    expect(cols).toEqual(['session_id', 'age_band', 'english_first', 'created_at'])
  })

  it('takes one answer or both, replaces an earlier answer, and stores nothing for neither', async () => {
    const ip = freshIp()
    const s = await startSession(db, ip)
    expect(await rpc(ip, 'submit_survey', { p_token: s.token })).toEqual({ recorded: false })
    expect((await db.owner.query(`select 1 from public.survey where session_id = $1`, [s.session_id])).rowCount).toBe(0)
    await rpc(ip, 'submit_survey', { p_token: s.token, p_english_first: false })
    await rpc(ip, 'submit_survey', { p_token: s.token, p_age_band: '65+' })
    expect((await db.owner.query(`select age_band, english_first from public.survey where session_id = $1`, [s.session_id])).rows).toEqual([{ age_band: '65+', english_first: null }])
  })

  it('refuses an age band outside the list (and under 18: the app blocks those before any data)', async () => {
    const ip = freshIp()
    const s = await startSession(db, ip)
    for (const band of ['0-17', '16-24', 'old', '']) expect(await failure(rpc(ip, 'submit_survey', { p_token: s.token, p_age_band: band })), band).toMatchObject({ code: 'PT400', message: 'invalid_age_band' })
  })

  it('goes with the session when it is deleted', async () => {
    const ip = freshIp()
    const s = await startSession(db, ip)
    await rpc(ip, 'submit_survey', { p_token: s.token, p_age_band: '25-34' })
    await db.owner.query(`delete from public.sessions where session_id = $1`, [s.session_id])
    expect((await db.owner.query(`select 1 from public.survey where session_id = $1`, [s.session_id])).rowCount).toBe(0)
  })
})
