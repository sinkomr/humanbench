/**
 * Served text multiple choice against the real database (ROADMAP M3.11 phase 1; DESIGN §3, §7.4, §11.2,
 * R-11.1): the session run of the app (`src/session/run.ts`) and the real server client, over the
 * PostgREST stand-in, with made-up text items in the shape the authored banks store (`textItems`:
 * 'mc_text', `{stem, options}`, an `{index}` key). No migration was needed for this: the tests show the
 * server as it is stores, selects, serves and scores such items, and what the client makes of it.
 *
 * - a pool WITHOUT the text skills: each text part asks once, the server says it has nothing, and the
 *   session is left with no trace of the part (the live project today);
 * - a pool with some of them: those parts run to five answers or more, the others are dropped, every
 *   answer is scored by the server against its key, no reply carries a key or a verdict, the session is
 *   signed, and `rescore` publishes exactly the skills that got their five answers.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createBackendApi, type BackendApi } from '../../src/backend/api'
import type { CatAnswer, CatNext, CatSource } from '../../src/backend/session'
import { ServerSession } from '../../src/backend/session'
import { supabaseTransport } from '../../src/backend/transport'
import type { AxisCode } from '../../src/engine/axes'
import { A15_TARGET_S, A15_TYPICAL_OVER_S, PUBLISH_MIN_ITEMS, TEXT_AXES } from '../../src/engine/plan-table'
import { TEXT_MC_RENDERER } from '../../src/render/text/spec'
import type { SaveFileV1 } from '../../src/save/types'
import { TEST_DEVICE } from '../../src/session/bot'
import { SessionRun } from '../../src/session/run'
import { fixtureBank, loadFixtureBank, textItems, type FixtureItem } from './bank-fixture'
import type { TestDb } from './harness'
import { startShim, type Shim } from './postgrest-shim'
import { ageExposures } from './rpc-support'
import { openTestDb } from './vitest'

let db: TestDb
let shim: Shim
let ipCounter = 0
const bank = new Map<string, FixtureItem>()
const instant = (): Promise<void> => Promise.resolve()
const PRESENT: readonly AxisCode[] = ['LR', 'VOC', 'KST']

beforeAll(async () => {
  db = await openTestDb()
  // The pool of the live project in kind: items of the three served A15 skills, and no text item yet.
  const items = fixtureBank({ perAxis: 12, axes: ['MAT', 'SPA', 'QR'], seed: 'text-mc' })
  for (const it of items) bank.set(it.itemId, it)
  await loadFixtureBank(db, items)
  shim = await startShim(db)
})
afterAll(async () => {
  await shim.close()
  await db.close()
})

function client(): BackendApi {
  const ip = `198.51.100.${++ipCounter}`
  const fetchFrom = ((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    headers.set('x-forwarded-for', ip)
    return fetch(input, { ...init, headers })
  }) as typeof fetch
  return createBackendApi(supabaseTransport({ url: shim.url, anonKey: 'test-anon-key' }, { fetch: fetchFrom }), { sleep: instant })
}

/** The server session as the run sees it, with every reply kept and the server's clock moved on before an answer (a person takes their time). */
class Watched implements CatSource {
  readonly replies: CatNext[] = []
  constructor(readonly inner: ServerSession) {}
  get sessionId(): string {
    return this.inner.sessionId
  }
  async next(axes: readonly AxisCode[]): Promise<CatNext> {
    const r = await this.inner.next(axes)
    this.replies.push(r)
    return r
  }
  async answer(a: CatAnswer): Promise<void> {
    await ageExposures(db, this.inner.sessionId, 20)
    await this.inner.answer(a)
  }
}

const wait = async (run: SessionRun, done: () => boolean): Promise<void> => {
  for (let i = 0; i < 2000 && !done(); i++) {
    if (run.view().problem !== null) throw new Error(`the wait failed: ${run.view().problem}`)
    await new Promise((r) => setTimeout(r, 2))
  }
  if (!done()) throw new Error(`timed out in phase ${run.phase}`)
}

/** Plays a session whose six A15 parts are skipped, so only the text parts are left; `answer` picks the option. */
async function playTextParts(api: BackendApi, answer: (itemId: string, options: number) => number): Promise<{ run: SessionRun; cat: Watched; server: ServerSession; parts: string[]; shown: string[] }> {
  const server = await ServerSession.start(api, TEST_DEVICE)
  const cat = new Watched(server)
  let t = 0
  const run = new SessionRun({ sessionId: 's_LOCALSESSION001', startedMs: 1_790_000_000_000, now: () => t, device: TEST_DEVICE, rtInput: 'keyboard', cat, textAxes: TEXT_AXES, skipped: ['RT', 'MAT', 'SPA', 'WM', 'QR', 'PS'] })
  const parts: string[] = []
  const shown: string[] = []
  for (let guard = 0; guard < 500; guard++) {
    await wait(run, () => run.phase !== 'loading')
    const v = run.view()
    if (v.phase === 'finished') break
    if (v.phase === 'interstitial') {
      parts.push(v.segment!.id)
      run.startSegment()
    } else if (v.phase === 'break_offer') run.declineBreak()
    else if (v.phase === 'item') {
      const item = v.item!
      expect(item.family).toBe(TEXT_MC_RENDERER)
      shown.push(item.item_id)
      run.itemShown(t)
      t += 15_000 + 2000 // the answer, and a tap on the optional confidence scale (one press sends both)
      run.itemResponded(answer(item.item_id, item.options_count!), 100)
    } else throw new Error(`unexpected phase ${v.phase}`)
  }
  expect(run.phase).toBe('finished')
  await run.flushAnswers()
  return { run, cat, server, parts, shown }
}

const saveOf = (server: ServerSession, session: SaveFileV1['sessions'][number], seen: string[]): SaveFileV1 => ({
  schema_version: '1.0.0',
  bank_version: server.bankVersion ?? 'b',
  anon_id: server.anonId,
  created_utc: '2026-10-12T10:00:00Z',
  sessions: [session],
  seen_items: seen,
  seen_families: [],
})

describe('a pool without the text skills (the live project today)', () => {
  it('each text part asks once, is told there is nothing, and leaves no part, no exposure and no answer behind', async () => {
    const api = client()
    const before = shim.requests.length
    const { run, cat, server, parts, shown } = await playTextParts(api, () => 0)
    expect(parts).toEqual([])
    expect(shown).toEqual([])
    expect(cat.replies).toEqual(TEXT_AXES.map(() => ({ kind: 'done', reason: 'no_items' })))
    const asked = shim.requests.slice(before).filter((r) => r.fn === 'next_item').map((r) => (JSON.parse(r.body) as { p_axes: string[] }).p_axes)
    expect(asked.map((a) => a.join()).sort()).toEqual([...TEXT_AXES].sort())
    expect(run.view().segments).toEqual([]) // the six A15 parts were skipped from the start (not planned); no text part is left
    expect(run.view().targetS).toBe(A15_TARGET_S + A15_TYPICAL_OVER_S) // the six parts' target: no text part is left in it
    expect(run.catSessionState()).toBeNull()
    const rows = await db.owner.query(`select (select count(*) from public.exposure_log where session_id = $1) as exposures, (select count(*) from public.responses where session_id = $1) as responses`, [server.sessionId])
    expect(rows.rows[0]).toEqual({ exposures: '0', responses: '0' })
  })
})

describe('a pool with made-up text items for three of the five skills', () => {
  it('runs those three parts to five answers or more, drops the other two, scores every answer on the server, and publishes the three skills', async () => {
    const items = PRESENT.flatMap((k) => textItems(k, 12))
    for (const it of items) bank.set(it.itemId, it)
    await loadFixtureBank(db, items)

    const api = client()
    const before = shim.requests.length
    // Two of three right, from the fixture's own keys (the test may see them; the page never does).
    let n = 0
    const given = new Map<string, number>()
    const { run, cat, server, parts, shown } = await playTextParts(api, (id, options) => {
      const key = bank.get(id)!.key.index as number
      const response = n++ % 3 === 2 ? (key + 1) % options : key
      given.set(id, response)
      return response
    })
    expect(parts).toEqual(['logical_reasoning', 'knowledge_stem', 'vocabulary'])
    const counts = run.result().itemsByAxis
    for (const k of PRESENT) expect(counts[k], k).toBeGreaterThanOrEqual(PUBLISH_MIN_ITEMS)
    expect(counts.KHU).toBeUndefined()
    expect(counts.KAP).toBeUndefined()
    // Each question came from the skill of the part that showed it.
    expect(shown.map((id) => bank.get(id)!.axis)).toEqual([...Array<AxisCode>(counts.LR!).fill('LR'), ...Array<AxisCode>(counts.KST!).fill('KST'), ...Array<AxisCode>(counts.VOC!).fill('VOC')])

    // What came over the wire: the item's text and nothing about its answer.
    const served = cat.replies.flatMap((r) => (r.kind === 'item' ? [r.item] : []))
    for (const item of served) {
      const fx = bank.get(item.item_id)!
      expect(item).toMatchObject({ family: TEXT_MC_RENDERER, supported: true, item_type: 'mc_text', options_count: fx.nOptions })
      expect(item.spec).toEqual({ stem: fx.payload!.stem, stimulus: [], options: fx.payload!.options })
    }
    const wire = shim.requests.slice(before)
    expect(wire.some((r) => r.fn === 'submit')).toBe(true)
    expect(JSON.stringify(cat.replies)).not.toMatch(/"key"|"index"|"correct"|rationale|tolerance|"a":|"b":|"c":/u)

    // The server scored each answer against its key (the rows are the server's; no reply shows them).
    const rows = (await db.owner.query<{ item_id: string; response: number; correct: number }>(`select item_id, response, correct from public.responses where session_id = $1 order by seq`, [server.sessionId])).rows
    expect(rows.map((r) => r.item_id)).toEqual(shown)
    for (const r of rows) {
      expect(r.response, r.item_id).toBe(given.get(r.item_id))
      expect(r.correct, r.item_id).toBe(r.response === bank.get(r.item_id)!.key.index ? 1 : 0)
    }

    // The close: signed, no verdict in it, and the three skills published from their five answers or more.
    const fin = await server.finish(run.serverFlags())
    expect(fin.session.sig).toMatchObject({ alg: 'HMAC-SHA256', anon_id: server.anonId })
    expect(fin.session.responses.map((r) => r[0])).toEqual(shown)
    expect(fin.session.responses.every((r) => r[3] === null)).toBe(true)
    expect(fin.session.responses.map((r) => r[2])).toEqual(shown.map((id) => given.get(id)))
    const save = saveOf(server, fin.session, shown)
    expect((await api.verifySave(save)).sessions).toEqual([{ sessionId: server.sessionId, status: 'verified', reason: null }])
    const est = await api.rescore(save)
    // every answer went with its confidence set (100%), and there are more than ten: the server publishes Calibration too
    // (owner decision 2026-10-13; migration 20261015000100_server_calibration.sql)
    expect(Object.keys(est.eap).sort()).toEqual([...PRESENT, 'CAL'].sort())
    expect(est.eap.CAL!.n).toBe(shown.length)
    for (const k of PRESENT) {
      expect(est.eap[k]!.n, k).toBe(counts[k])
      expect(est.eap[k]!.sd, k).toBeGreaterThan(0)
    }
  })

  it('a second session of the same person gets other questions of the skill (the server keeps what it served)', async () => {
    const api = client()
    const first = await playTextParts(api, () => 0)
    const fin = await first.server.finish(first.run.serverFlags())
    const save = saveOf(first.server, fin.session, first.shown)
    const second = await ServerSession.start(api, TEST_DEVICE, save)
    expect(second.anonIdAdopted).toBe(true)
    const next = await second.next(['VOC'])
    expect(next.kind).toBe('item')
    if (next.kind === 'item') expect(first.shown).not.toContain(next.item.item_id)
  })
})
