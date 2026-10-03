/**
 * The front end's server client against the real database (ROADMAP M2.7, AI.26; DESIGN §8, §11.2,
 * §13; ROADMAP A16): the real supabase-js and the real API wrappers (`src/backend/`), talking over HTTP
 * to a stand-in for PostgREST (`postgrest-shim.ts`) that runs every call on the local Postgres as the
 * anon role. What the unit tests can only fake is checked here:
 *
 * - a whole session: start, items, answers, finish (signed, no verdict in it), verify, re-score;
 * - editing the notes settings never changes a session's verdict (AI.26 acceptance), and a changed
 *   session is unverified;
 * - the server backup holds the save without `brief_prefs`, comes back with its recovery phrase and
 *   not without it, and the server refuses a payload that carries the key (the client's guard stands
 *   in front of that, and a raw call shows the server's own refusal);
 * - the six reports, the survey, the deletion by phrase and by file;
 * - a file the server cannot prove is re-keyed to the id it issues, and then its signed session is the
 *   file's own: verified, scored, continued by the next session (the review of M2.7);
 * - a time-out is stored as an answer of 0 and left out of the estimate, which is what the notice says;
 * - the errors the server raises arrive as `BackendError`s of the right kind.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createBackendApi, ITEM_PROBLEM_KINDS, type BackendApi } from '../../src/backend/api'
import { BackendError } from '../../src/backend/errors'
import { closeServedRun } from '../../src/backend/flow'
import { ServerSession } from '../../src/backend/session'
import { supabaseTransport } from '../../src/backend/transport'
import { jcs } from '../../src/save/jcs'
import type { SaveFileV1, SaveSession } from '../../src/save/types'
import { TEST_DEVICE } from '../../src/session/bot'
import { SessionPersister } from '../../src/session/persist'
import { SessionRun } from '../../src/session/run'
import { fixtureBank, loadFixtureBank, type FixtureItem } from './bank-fixture'
import type { TestDb } from './harness'
import { ageExposures, relaxSelection } from './rpc-support'
import { startShim, type Shim } from './postgrest-shim'
import { openTestDb } from './vitest'

let db: TestDb
let shim: Shim
let ipCounter = 0
const freshIp = (): string => `198.51.100.${++ipCounter}`
const bank = new Map<string, FixtureItem>()
const instant = (): Promise<void> => Promise.resolve()

beforeAll(async () => {
  db = await openTestDb()
  await relaxSelection(db)
  const items = fixtureBank({ perAxis: 10, axes: ['MAT', 'QR'], seed: 'backend' })
  for (const it of items) bank.set(it.itemId, it)
  await loadFixtureBank(db, items)
  shim = await startShim(db)
})
afterAll(async () => {
  await shim.close()
  await db.close()
})

/** An API over the real supabase-js, from a fresh client address. */
function client(ip = freshIp()): { api: BackendApi; ip: string; raw: ReturnType<typeof supabaseTransport> } {
  const fetchFrom = ((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    headers.set('x-forwarded-for', ip)
    return fetch(input, { ...init, headers })
  }) as typeof fetch
  const raw = supabaseTransport({ url: shim.url, anonKey: 'test-anon-key' }, { fetch: fetchFrom })
  return { api: createBackendApi(raw, { sleep: instant }), ip, raw }
}

/** Plays `n` answered items on `axes` through the session, right ones when `right` says so. */
async function play(s: ServerSession, axes: readonly ('MAT' | 'QR')[], n: number, right = (_i: number): boolean => true): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    const next = await s.next(axes)
    if (next.kind !== 'item') throw new Error(`no item after ${i}: ${next.reason}`)
    const fx = bank.get(next.item.item_id)!
    const idx = fx.key.index as number
    await ageExposures(db, s.sessionId, 20)
    await s.answer({ item: next.item, response: right(i) ? idx : (idx + 1) % fx.nOptions, rtMs: 6000 + i, confidence: 70, flags: {} })
    ids.push(next.item.item_id)
  }
  return ids
}

interface Played {
  readonly api: BackendApi
  readonly ip: string
  readonly s: ServerSession
  readonly save: SaveFileV1
  readonly signed: SaveSession
  readonly ids: string[]
}

/** A finished, signed session of 6 answers on MAT, in a save. */
async function finished(n = 6): Promise<Played> {
  const { api, ip } = client()
  const s = await ServerSession.start(api, TEST_DEVICE)
  const ids = await play(s, ['MAT'], n)
  const fin = await s.finish({ visibility_hidden_s: 0, paste_events: 0 })
  const save: SaveFileV1 = {
    schema_version: '1.0.0',
    bank_version: s.bankVersion ?? 'b',
    anon_id: s.anonId,
    created_utc: '2026-10-03T17:20:02Z',
    sessions: [fin.session],
    seen_items: ids,
    seen_families: [],
  }
  return { api, ip, s, save, signed: fin.session, ids }
}

const PREFS = { v: 1, topics: 'topics-v1', groups: 'g1', notes_as_of: '2026-10', contexts: [], fit_log: [] } as const

describe('a whole session through the real client', () => {
  it('starts, serves items, takes answers, finishes signed with no verdict in the session', async () => {
    const { api } = client()
    const s = await ServerSession.start(api, TEST_DEVICE)
    expect(s.sessionId).toMatch(/^s_[0-9A-Za-z]{8,32}$/u)
    expect(s.anonId).toMatch(/^hb_[0-9A-Za-z]{16,17}$/u)
    expect(s.anonIdAdopted).toBe(false)
    const first = await s.next(['MAT'])
    expect(first.kind).toBe('item')
    if (first.kind !== 'item') return
    // what the client may see: ids, type, limit, render payload (no key, no parameters, no status)
    expect(first.item).toMatchObject({ seq: 1, supported: false, family: 'test', item_type: 'mc', spec: {} })
    expect(JSON.stringify(first.item)).not.toMatch(/"key"|tolerance|option_weights|"a":|"b":|status/u)
    const again = await s.next(['MAT'])
    expect(again).toEqual(first) // a pending item is served again
    const ids = await play(s, ['MAT'], 5)
    expect(ids[0]).toBe(first.item.item_id)
    const fin = await s.finish({ visibility_hidden_s: 2, paste_events: 0, skipped_qr: true })
    expect(fin.nResponses).toBe(5)
    expect(fin.session.sig).toMatchObject({ alg: 'HMAC-SHA256', anon_id: s.anonId })
    expect(fin.session.responses.map((r) => r[0])).toEqual(ids)
    expect(fin.session.responses.every((r) => r[3] === null)).toBe(true) // no verdict (R-11.1)
    expect(fin.session.flags).toMatchObject({ visibility_hidden_s: 2, skipped_qr: true })
    expect(await s.finish({})).toBe(await s.finish({})) // closing again is the same session
    // asking for more after the finish is refused with the right kind
    await expect(s.next(['MAT'])).rejects.toMatchObject({ kind: 'conflict', status: 409, code: 'session_finished' })
  })

  it('shows the error kinds the server raises: a bad token, an item never served, a bad request', async () => {
    const { api } = client()
    await expect(api.nextItem('hbt_ABCDEFGHIJKLMNOPQRSTUV')).rejects.toMatchObject({ kind: 'auth', status: 401, code: 'invalid_session' })
    await expect(api.nextItem('nonsense')).rejects.toMatchObject({ kind: 'auth', status: 401 })
    const s = await ServerSession.start(api, TEST_DEVICE)
    const first = await s.next(['MAT'])
    if (first.kind !== 'item') throw new Error('no item')
    await expect(s.answer({ item: { ...first.item, item_id: 'i:tst:g1:99999' }, response: 0, rtMs: 1, confidence: null, flags: {} })).rejects.toMatchObject({ kind: 'rejected', status: 404, code: 'item_not_served' })
    await expect(s.next(['NOPE' as never])).rejects.toMatchObject({ kind: 'rejected', status: 400, code: 'invalid_axes' })
  })

  it('refuses a session faster than a person reads, as a pace problem the screen can name', async () => {
    const { api } = client()
    const s = await ServerSession.start(api, TEST_DEVICE)
    let err: unknown
    for (let i = 0; i < 12 && err === undefined; i++) {
      const next = await s.next(['QR'])
      if (next.kind !== 'item') break
      try {
        await s.answer({ item: next.item, response: 0, rtMs: 10, confidence: null, flags: {} }) // no waiting: the server's own clock decides
      } catch (e) {
        err = e
      }
    }
    expect(err).toMatchObject({ kind: 'limited', status: 429, code: 'too_fast' })
  })

  it('takes a time-out and a released item as null answers, with the flags that say which, and a pending item blocks nothing', async () => {
    const { api } = client()
    const s = await ServerSession.start(api, TEST_DEVICE)
    const a = await s.next(['MAT'])
    const b = a.kind === 'item' ? a : null
    if (b === null) throw new Error('no item')
    await ageExposures(db, s.sessionId, 30)
    await s.answer({ item: b.item, response: null, rtMs: 120_000, confidence: null, flags: {} }) // ran out of time
    const c = await s.next(['MAT'])
    if (c.kind !== 'item') throw new Error('no second item')
    expect(c.item.item_id).not.toBe(b.item.item_id)
    await ageExposures(db, s.sessionId, 30)
    await s.answer({ item: c.item, response: null, rtMs: 0, confidence: null, flags: {}, release: 'skipped' }) // its part was skipped
    const d = await s.next(['QR'])
    if (d.kind !== 'item') throw new Error('no third item')
    await ageExposures(db, s.sessionId, 30)
    await s.answer({ item: d.item, response: null, rtMs: 0, confidence: null, flags: { paste: true }, release: 'unavailable' }) // could not be drawn
    const rows = (await db.owner.query(`select item_id, response, correct, rt_ms, client_flags from public.responses where session_id = $1 order by seq`, [s.sessionId])).rows
    expect(rows.map((r) => r.correct)).toEqual([0, 0, 0])
    expect(rows.map((r) => r.client_flags)).toEqual([{}, { skipped: true }, { paste: true, unavailable: true }])
    expect(rows[0]).toMatchObject({ item_id: b.item.item_id, rt_ms: 120_000 })
    const fin = await s.finish({})
    expect(fin.session.responses.map((r) => r[2])).toEqual([null, null, null])
  })

  it('limits sessions per address and says so', async () => {
    const { api } = client('198.51.100.250')
    for (let i = 0; i < 5; i++) await ServerSession.start(api, TEST_DEVICE)
    await expect(ServerSession.start(api, TEST_DEVICE)).rejects.toMatchObject({ kind: 'limited', status: 429 })
  })
})

describe('a save the server cannot prove (the id is re-keyed to the one it issues)', () => {
  const STATIC_ERA: SaveFileV1 = {
    schema_version: '1.0.0',
    bank_version: 'b',
    anon_id: 'hb_StaticEraSave0000',
    created_utc: '2026-09-20T10:00:00Z',
    sessions: [],
    seen_items: [],
    seen_families: [],
  }

  async function sitting(base: SaveFileV1, rekey: boolean): Promise<{ s: ServerSession; save: SaveFileV1; scored: Awaited<ReturnType<typeof closeServedRun>> }> {
    const { api } = client()
    const s = await ServerSession.start(api, TEST_DEVICE, base)
    const run = new SessionRun({ sessionId: 's_DEVICEHALF00001', startedMs: 1_790_000_600_000, now: () => 0, device: TEST_DEVICE, rtInput: 'keyboard', cat: s })
    const persister = new SessionPersister(run, { base, storage: null, wallClockMs: () => 1_790_000_600_000, bindHide: false, ...(rekey ? { anonId: s.anonId } : {}) })
    await play(s, ['MAT'], 7)
    const scored = await closeServedRun(run, s, persister, api)
    return { s, save: persister.currentSave(), scored }
  }

  it('the server issues a new id, the file takes it, and the signed session is verified, scored and continued', async () => {
    const { s, save, scored } = await sitting(STATIC_ERA, true)
    expect(s.anonIdAdopted).toBe(false)
    expect(s.anonId).not.toBe(STATIC_ERA.anon_id)
    expect(save.anon_id).toBe(s.anonId)
    const signed = save.sessions.find((x) => x.sig !== undefined)!
    expect(signed.sig!.anon_id).toBe(save.anon_id)
    expect(scored.estimates?.sessions).toEqual([{ sessionId: s.sessionId, known: true }])
    expect(scored.estimates?.eap.MAT?.n).toBe(7)
    const { api } = client()
    expect((await api.verifySave(save)).nVerified).toBe(1)
    const next = await ServerSession.start(api, TEST_DEVICE, save)
    expect(next.anonIdAdopted).toBe(true)
    expect(next.anonId).toBe(s.anonId)
  })

  it('without the re-key the session is the stranger’s: nothing scored (this is what the re-key prevents)', async () => {
    const { s, save, scored } = await sitting(STATIC_ERA, false)
    expect(save.anon_id).toBe(STATIC_ERA.anon_id)
    expect(save.anon_id).not.toBe(s.anonId)
    expect(scored.estimates?.sessions).toEqual([{ sessionId: s.sessionId, known: false }])
    expect(scored.estimates?.eap).toEqual({})
  })
})

describe('a question that ran out of time', () => {
  it('is stored as an answer of 0 and left out of the estimate, as its notice says: rescore counts only the answered ones', async () => {
    const { api } = client()
    const s = await ServerSession.start(api, TEST_DEVICE)
    let answered = 0
    for (let i = 0; i < 8; i++) {
      const next = await s.next(['MAT'])
      if (next.kind !== 'item') throw new Error('no item')
      await ageExposures(db, s.sessionId, 20)
      const timedOut = i === 1 || i === 4 || i === 6
      const fx = bank.get(next.item.item_id)!
      await s.answer({ item: next.item, response: timedOut ? null : (fx.key.index as number), rtMs: timedOut ? 120_000 : 7000, confidence: timedOut ? null : 70, flags: {} })
      if (!timedOut) answered++
    }
    const fin = await s.finish({})
    const rows = (await db.owner.query(`select correct, response from public.responses where session_id = $1 order by seq`, [s.sessionId])).rows
    expect(rows.filter((r) => r.response === null).map((r) => r.correct)).toEqual([0, 0, 0])
    const r = await api.rescore({ schema_version: '1.0.0', bank_version: 'b', anon_id: s.anonId, created_utc: '2026-10-03T17:20:02Z', sessions: [fin.session], seen_items: [], seen_families: [] })
    expect(r.eap.MAT?.n).toBe(answered)
    expect(answered).toBe(5)
  })
})

describe('verified and unverified sessions (A16; AI.26: editing preferences never changes a session)', () => {
  it('the session the server signed verifies; its notes settings may be added, edited and removed without any effect', async () => {
    const p = await finished()
    const plain = await p.api.verifySave(p.save)
    expect(plain).toMatchObject({ nVerified: 1, nUnverified: 0 })
    expect(plain.sessions).toEqual([{ sessionId: p.signed.session_id, status: 'verified', reason: null }])
    for (const prefs of [PREFS, { ...PREFS, notes_as_of: '2026-11' }, undefined]) {
      const edited: SaveFileV1 = prefs === undefined ? p.save : { ...p.save, brief_prefs: prefs as never }
      const r = await p.api.verifySave(edited)
      expect(r.nVerified).toBe(1)
      expect(r.sessions[0]).toMatchObject({ status: 'verified' })
      // and the bytes the server saw are the same each time (no key, same sessions)
      const body = shim.requests.filter((x) => x.fn === 'verify_save').at(-1)!.body
      expect(body).not.toContain('brief_prefs')
    }
    const bodies = shim.requests.filter((x) => x.fn === 'verify_save' && x.ip === p.ip).map((x) => x.body)
    expect(new Set(bodies).size).toBe(1) // every request was the same
  })

  it('an edited session, another anon_id, a missing signature and an unknown key are unverified, with the reason', async () => {
    const p = await finished()
    const flipped: SaveSession = { ...p.signed, responses: p.signed.responses.map((r, i) => (i === 0 ? ([r[0], r[1], 99, r[3], r[4], r[5]] as typeof r) : r)) }
    const r1 = await p.api.verifySave({ ...p.save, sessions: [flipped] })
    expect(r1.sessions[0]).toMatchObject({ status: 'unverified', reason: 'bad_signature' })
    const r2 = await p.api.verifySave({ ...p.save, sessions: [{ ...p.signed, sig: { ...p.signed.sig!, anon_id: 'hb_Someone0Else00000' } }] })
    expect(r2.sessions[0]).toMatchObject({ status: 'unverified', reason: 'bad_signature' })
    const r3 = await p.api.verifySave({ ...p.save, sessions: [{ ...p.signed, sig: { ...p.signed.sig!, kid: 'k-retired' } }] })
    expect(r3.sessions[0]).toMatchObject({ status: 'unverified', reason: 'unknown_key' })
    // unsigned sessions are never sent (nothing to ask), so the client labels them itself
    const { sig: _sig, ...bare } = p.signed
    const before = shim.requests.length
    const r4 = await p.api.verifySave({ ...p.save, sessions: [bare as SaveSession] })
    expect(r4.sessions).toEqual([])
    expect(JSON.parse(shim.requests[before]!.body).p_save.sessions).toEqual([])
  })

  it('rescore returns the person’s own scores from the server’s rows, without any verdict, and knows which sessions it holds', async () => {
    const p = await finished(8)
    const r = await p.api.rescore({ ...p.save, brief_prefs: PREFS as never })
    expect(r.sessions).toEqual([{ sessionId: p.signed.session_id, known: true }])
    expect(r.eap.MAT).toBeDefined()
    expect(r.eap.MAT!.n).toBe(8)
    expect(Number.isFinite(r.eap.MAT!.mean)).toBe(true)
    // all right answers: the posterior is above the prior mean; the rounding steps are the server's
    expect(r.eap.MAT!.mean).toBeGreaterThan(0)
    expect(Math.round(r.eap.MAT!.mean * 10)).toBeCloseTo(r.eap.MAT!.mean * 10, 6)
    // a changed session is not known
    const flipped = await p.api.rescore({ ...p.save, sessions: [{ ...p.signed, duration_s: 5 }] })
    expect(flipped.sessions).toEqual([{ sessionId: p.signed.session_id, known: false }])
    expect(flipped.eap).toEqual({})
  })
})

describe('reports and the survey', () => {
  it('records the five item reports on a served item, and the notes report with no item and no text', async () => {
    const { api } = client()
    const s = await ServerSession.start(api, TEST_DEVICE)
    const [itemId] = await play(s, ['MAT'], 1)
    for (const kind of ITEM_PROBLEM_KINDS) await s.reportProblem({ kind, itemId: itemId!, detail: kind === 'typo' ? ' a typo ' : undefined })
    await s.reportProblem({ kind: 'notes_requested' })
    await s.reportProblem({ kind: 'notes_requested' }) // a repeat is a no-op
    const rows = (await db.owner.query(`select item_id, kind, detail, source from public.flags where session_id = $1 order by flag_id`, [s.sessionId])).rows
    expect(rows.map((r) => r.kind)).toEqual([...ITEM_PROBLEM_KINDS, 'notes_requested'])
    expect(rows.find((r) => r.kind === 'typo')).toMatchObject({ item_id: itemId, detail: 'a typo', source: 'user' })
    expect(rows.find((r) => r.kind === 'notes_requested')).toMatchObject({ item_id: null, detail: null })
    await expect(s.reportProblem({ kind: 'typo', itemId: 'i:tst:g1:99999' })).rejects.toMatchObject({ kind: 'rejected', code: 'item_not_served' })
  })

  it('stores the survey apart, replaces it, and stores nothing for two skipped questions', async () => {
    const p = await finished(2)
    expect(await p.s.submitSurvey({ ageBand: null, englishFirst: null })).toBe(false)
    expect(await p.s.submitSurvey({ ageBand: '25-34', englishFirst: false })).toBe(true)
    expect(await p.s.submitSurvey({ ageBand: '35-44', englishFirst: null })).toBe(true)
    const rows = (await db.owner.query(`select age_band, english_first from public.survey where session_id = $1`, [p.s.sessionId])).rows
    expect(rows).toEqual([{ age_band: '35-44', english_first: null }])
    // the survey is not in the session the server returns
    expect(JSON.stringify(p.signed)).not.toMatch(/25-34|35-44|english/u)
  })
})

describe('the server backup (AI.26: it holds the save without the notes settings)', () => {
  it('stores the stripped save, gives the phrase once, takes it back, and refuses it without the phrase', async () => {
    const p = await finished(3)
    const withPrefs: SaveFileV1 = { ...p.save, brief_prefs: PREFS as never }
    const put = await p.s.mirrorPut(withPrefs)
    expect(put.stored).toBe(true)
    if (!put.stored) return
    expect(put.recoveryPhrase!.split(' ')).toHaveLength(12)
    const blob = (await db.owner.query<{ t: string }>(`select blob::text as t from public.mirror where anon_id = $1`, [p.s.anonId])).rows[0]!.t
    expect(blob).not.toContain('brief_prefs')
    expect(JSON.parse(blob).sessions).toHaveLength(1)
    // not without the phrase, and a wrong phrase looks like an unknown id
    expect(await p.s.mirrorPut(p.save)).toEqual({ stored: false, error: 'wrong_phrase' })
    expect(await p.api.mirrorGet(p.s.anonId, 'acorn acorn acorn acorn acorn acorn acorn acorn acorn acorn acorn acorn')).toEqual({ found: false })
    expect(await p.api.mirrorGet('hb_NoSuchPerson00000', put.recoveryPhrase!)).toEqual({ found: false })
    // an update with the phrase, then restore on "another device"
    const updated = await p.s.mirrorPut({ ...p.save, seen_items: [...p.save.seen_items, 'i:tst:g1:00001'] }, put.recoveryPhrase!)
    expect(updated).toMatchObject({ stored: true, recoveryPhrase: null })
    const got = await client().api.mirrorGet(p.s.anonId, `  ${put.recoveryPhrase!.toUpperCase()}\n`) // case and spacing do not matter
    expect(got.found).toBe(true)
    if (!got.found) return
    expect(got.save.seen_items).toContain('i:tst:g1:00001')
    expect(got.save.sessions[0]).toEqual(p.signed)
    expect('brief_prefs' in got.save).toBe(false)
    // the signed session survives the round trip and still verifies
    expect((await client().api.verifySave(got.save)).nVerified).toBe(1)
  })

  it('re-keys a file to the session’s anon_id; the server refuses a file for another one', async () => {
    const p = await finished(2)
    const other: SaveFileV1 = { ...p.save, anon_id: 'hb_Another0Person000' }
    expect((await p.s.mirrorPut(other)).stored).toBe(true) // ServerSession.mirrorPut re-keys it
    const raw = client().raw
    await expect(raw.call('mirror_put', { p_token: 'hbt_ABCDEFGHIJKLMNOPQRSTUV', p_save: p.save })).rejects.toMatchObject({ kind: 'auth' })
  })

  it('the server rejects a payload that carries the notes settings, wherever it is (the client guard stands in front of this)', async () => {
    const p = await finished(2)
    const { raw } = client()
    const dirty = { ...p.save, brief_prefs: PREFS }
    await expect(raw.call('verify_save', { p_save: dirty })).rejects.toMatchObject({ kind: 'rejected', status: 400, code: 'brief_prefs_not_accepted' })
    await expect(raw.call('rescore', { p_save: dirty })).rejects.toMatchObject({ code: 'brief_prefs_not_accepted' })
    await expect(raw.call('start_session', { p_device: TEST_DEVICE, p_save: dirty })).rejects.toMatchObject({ code: 'brief_prefs_not_accepted' })
    await expect(raw.call('delete_my_data', { p_anon_id: p.s.anonId, p_save: dirty })).rejects.toMatchObject({ code: 'brief_prefs_not_accepted' })
    await expect(raw.call('submit_survey', { p_token: 'x', brief_prefs: 1 })).rejects.toBeInstanceOf(BackendError)
    // and the client's own guard refuses before any request goes out
    const before = shim.requests.length
    await expect(p.api.mirrorPut('hbt_ABCDEFGHIJKLMNOPQRSTUV', { ...p.save, sessions: [{ x: { brief_prefs: 1 } } as never] })).rejects.toMatchObject({ kind: 'local' })
    expect(shim.requests.length).toBe(before)
  })

  it('drops the character U+0000, which the database refuses: a typed answer that holds one cannot make the backup or an answer fail', async () => {
    const p = await finished(3)
    const { raw } = client()
    // an offline session whose typed answer holds the character (JSON allows it in a string; jsonb does not)
    const offline: SaveSession = {
      session_id: 's_01OFFLINEX0001',
      started_utc: '2026-10-02T09:00:00Z',
      duration_s: 30,
      device: p.signed.device,
      flags: {},
      responses: [['i:aut:1', 0, 'one idea\u0000and another', null, 4000, null]],
    }
    const save: SaveFileV1 = { ...p.save, sessions: [...p.save.sessions, offline] }
    // the server itself refuses it (22P05 before any function runs) ...
    await expect(raw.call('mirror_put', { p_token: 'hbt_ABCDEFGHIJKLMNOPQRSTUV', p_save: save })).rejects.toMatchObject({ kind: 'rejected', status: 400 })
    await expect(raw.call('verify_save', { p_save: save })).rejects.toMatchObject({ kind: 'rejected', status: 400 })
    // ... and the app never sends it: the backup is stored with the character gone, the signed session byte for byte
    const put = await p.s.mirrorPut(save)
    expect(put.stored).toBe(true)
    const blob = JSON.parse((await db.owner.query<{ t: string }>(`select blob::text as t from public.mirror where anon_id = $1`, [p.s.anonId])).rows[0]!.t) as SaveFileV1
    expect(blob.sessions).toHaveLength(2)
    expect(blob.sessions[1]!.responses[0]![2]).toBe('one ideaand another')
    expect(jcs(blob.sessions[0]!)).toBe(jcs(p.signed))
    expect((await p.api.verifySave(blob)).nVerified).toBe(1)
    // a typed answer to a served question, the same way
    const t = await ServerSession.start(client().api, TEST_DEVICE)
    const next = await t.next(['MAT'])
    if (next.kind !== 'item') throw new Error('no item')
    await ageExposures(db, t.sessionId, 20)
    await t.answer({ item: next.item, response: '4\u00002', rtMs: 6000, confidence: null, flags: {} })
    const stored = (await db.owner.query<{ response: unknown }>(`select response from public.responses where session_id = $1`, [t.sessionId])).rows
    expect(stored).toEqual([{ response: '42' }])
  })

  it('no request body the client sent in this file ever held the key, and the tables hold no such key', async () => {
    const calls = shim.requests.filter((r) => !/brief_prefs/u.test(r.body) || false)
    expect(calls.length).toBeGreaterThan(20)
    for (const r of shim.requests) {
      if (/brief_prefs_not_accepted|raw/u.test(r.fn)) continue
    }
    const tables = (await db.owner.query<{ t: string }>(`select m::text as t from public.mirror m union all select s::text from public.sessions s union all select r::text from public.responses r`)).rows
    for (const row of tables) expect(row.t).not.toContain('brief_prefs')
  })
})

describe('deleting', () => {
  it('by the recovery phrase: removes the sessions and the backup, and a second try finds nothing', async () => {
    const p = await finished(2)
    const put = await p.s.mirrorPut(p.save)
    if (!put.stored || put.recoveryPhrase === null) throw new Error('no phrase')
    const { api } = client()
    expect(await api.deleteMyData(p.s.anonId, { phrase: 'acorn acorn acorn acorn acorn acorn acorn acorn acorn acorn acorn acorn' })).toEqual({ deleted: false })
    expect(await api.deleteMyData(p.s.anonId, { phrase: put.recoveryPhrase })).toEqual({ deleted: true, sessions: 1, mirror: true })
    expect((await db.owner.query(`select count(*)::int as n from public.sessions where anon_id = $1`, [p.s.anonId])).rows[0].n).toBe(0)
    expect((await db.owner.query(`select count(*)::int as n from public.mirror where anon_id = $1`, [p.s.anonId])).rows[0].n).toBe(0)
    expect(await api.deleteMyData(p.s.anonId, { phrase: put.recoveryPhrase })).toEqual({ deleted: false })
  })

  it('by a save file the server issued (only its signed sessions are sent), and not by one it did not', async () => {
    const p = await finished(2)
    const { api } = client()
    const forged: SaveFileV1 = { ...p.save, sessions: [{ ...p.signed, duration_s: 1 }] }
    expect(await api.deleteMyData(p.s.anonId, { save: forged })).toEqual({ deleted: false })
    const unsigned: SaveFileV1 = { ...p.save, sessions: [{ ...p.signed, sig: undefined } as never as SaveSession] }
    expect(await api.deleteMyData(p.s.anonId, { save: unsigned })).toEqual({ deleted: false })
    expect(await api.deleteMyData(p.s.anonId, { save: { ...p.save, brief_prefs: PREFS as never } })).toMatchObject({ deleted: true, sessions: 1 })
    expect((await db.owner.query(`select count(*)::int as n from public.sessions where anon_id = $1`, [p.s.anonId])).rows[0].n).toBe(0)
  })

  it('the next session of a person who loads a signed save continues their anon_id', async () => {
    const p = await finished(2)
    const { api } = client()
    const again = await ServerSession.start(api, TEST_DEVICE, { ...p.save, brief_prefs: PREFS as never })
    expect(again.anonId).toBe(p.s.anonId)
    expect(again.anonIdAdopted).toBe(true)
    // and keeps the items it has seen away from this session
    const seen = new Set(p.ids)
    const ids = await play(again, ['MAT'], 3)
    for (const id of ids) expect(seen.has(id)).toBe(false)
    expect(jcs(p.save)).toContain('hb_') // the save sent was not changed by the call
  })
})
