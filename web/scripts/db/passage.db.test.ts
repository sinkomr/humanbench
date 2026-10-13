/**
 * Served passages against the real database (ROADMAP M3.11 phase 2; DESIGN §3 row 4, §7.1, §7.4, §11.2,
 * R-11.1): the session run of the app (`src/session/run.ts`) and the real server client, over the PostgREST
 * stand-in, with made-up passages in the shape the reading bank stores (`passageItems`: 'mc_passage', the
 * passage in `media`, one family per passage, an `{index}` key). The server's set rule
 * (`supabase/migrations/20261013000100_item_sets.sql`) is tested by itself in `item-sets.db.test.ts`; this is
 * what the client makes of it:
 *
 * - the Reading Comprehension part reads two passages, every question of each, in the server's order, with
 *   the passage on screen from its first question to its last;
 * - every answer is scored by the server against its key, no reply carries a key or a verdict, the session is
 *   signed, and `rescore` publishes the skill from the six to eight answers;
 * - a pool without passages leaves the session with no trace of the part.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createBackendApi, type BackendApi } from '../../src/backend/api'
import type { CatAnswer, CatNext, CatSource } from '../../src/backend/session'
import { ServerSession } from '../../src/backend/session'
import { supabaseTransport } from '../../src/backend/transport'
import type { AxisCode } from '../../src/engine/axes'
import { PUBLISH_MIN_ITEMS, RC_PASSAGES } from '../../src/engine/plan-table'
import { TEXT_PASSAGE_RENDERER, isPassageSpec } from '../../src/render/text/passage'
import type { SaveFileV1 } from '../../src/save/types'
import { TEST_DEVICE } from '../../src/session/bot'
import { SessionRun } from '../../src/session/run'
import { fixtureBank, loadFixtureBank, passageItems, type FixtureItem } from './bank-fixture'
import type { TestDb } from './harness'
import { startShim, type Shim } from './postgrest-shim'
import { ageExposures } from './rpc-support'
import { openTestDb } from './vitest'

let db: TestDb
let shim: Shim
let ipCounter = 0
const bank = new Map<string, FixtureItem>()
const instant = (): Promise<void> => Promise.resolve()
const CREDIT = (p: number): string => `Made-up source line ${p + 1}: adapted from a text that does not exist (placeholder), CC BY 4.0.`

beforeAll(async () => {
  db = await openTestDb()
  // The pool of the live project in kind: items of the three served A15 skills, and no passage yet.
  const items = fixtureBank({ perAxis: 12, axes: ['MAT', 'SPA', 'QR'], seed: 'passage' })
  for (const it of items) bank.set(it.itemId, it)
  await loadFixtureBank(db, items)
  shim = await startShim(db)
})
afterAll(async () => {
  await shim.close()
  await db.close()
})

function client(): BackendApi {
  const ip = `198.51.101.${++ipCounter}`
  const fetchFrom = ((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    headers.set('x-forwarded-for', ip)
    return fetch(input, { ...init, headers })
  }) as typeof fetch
  return createBackendApi(supabaseTransport({ url: shim.url, anonKey: 'test-anon-key' }, { fetch: fetchFrom }), { sleep: instant })
}

/** The server session as the run sees it, with every reply kept and the server's clock moved on before an answer. */
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

interface Shown {
  readonly id: string
  readonly passageKey: string
  readonly position: { index: number; of: number } | null
  readonly attribution: string | null
}

/** Plays a session whose six A15 parts are skipped and that asks for Reading Comprehension alone; `answer` picks the option. */
async function playReading(api: BackendApi, answer: (itemId: string, options: number) => number, save?: SaveFileV1): Promise<{ run: SessionRun; cat: Watched; server: ServerSession; parts: string[]; shown: Shown[] }> {
  const server = await ServerSession.start(api, TEST_DEVICE, save)
  const cat = new Watched(server)
  let t = 0
  const run = new SessionRun({ sessionId: 's_LOCALSESSION001', startedMs: 1_790_000_000_000, now: () => t, device: TEST_DEVICE, rtInput: 'keyboard', cat, textAxes: ['RC'], skipped: ['RT', 'MAT', 'SPA', 'WM', 'QR', 'PS'] })
  const parts: string[] = []
  const shown: Shown[] = []
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
      expect(item.family).toBe(TEXT_PASSAGE_RENDERER)
      expect(v.passage).not.toBeNull()
      shown.push({ id: item.item_id, passageKey: v.passage!.passageKey, position: v.passage!.position, attribution: v.passage!.attribution })
      run.itemShown(t)
      t += 40_000
      run.itemResponded(answer(item.item_id, item.options_count!))
      t += 2000
      run.confirmConfidence(run.view().confidence!.startPct)
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
  created_utc: '2026-10-13T10:00:00Z',
  sessions: [session],
  seen_items: seen,
  seen_families: [],
})

describe('a pool without passages (the live project today)', () => {
  it('the part asks once, is told there is nothing, and leaves no part, no exposure and no answer behind', async () => {
    const { run, cat, server, parts, shown } = await playReading(client(), () => 0)
    expect(parts).toEqual([])
    expect(shown).toEqual([])
    expect(cat.replies).toEqual([{ kind: 'done', reason: 'no_items' }])
    expect(run.view().segments).toEqual([])
    expect(run.catSessionState()).toBeNull()
    const rows = await db.owner.query(`select (select count(*) from public.exposure_log where session_id = $1) as exposures, (select count(*) from public.responses where session_id = $1) as responses`, [server.sessionId])
    expect(rows.rows[0]).toEqual({ exposures: '0', responses: '0' })
  })
})

describe('a pool with made-up passages', () => {
  it('reads two passages whole and in order with the passage on screen throughout, scores every answer on the server, and publishes the skill', async () => {
    const items = passageItems({ passages: 8, seed: 'client', attribution: (p) => (p % 2 === 0 ? CREDIT(p) : undefined) })
    for (const it of items) bank.set(it.itemId, it)
    await loadFixtureBank(db, items)

    const api = client()
    const before = shim.requests.length
    let n = 0
    const given = new Map<string, number>()
    const { run, cat, server, parts, shown } = await playReading(api, (id, options) => {
      const key = bank.get(id)!.key.index as number
      const response = n++ % 3 === 2 ? (key + 1) % options : key
      given.set(id, response)
      return response
    })
    expect(parts).toEqual(['reading_comprehension'])

    // Two passages, every question of each, in the order of the ids, one passage after the other.
    const families = [...new Set(shown.map((s) => bank.get(s.id)!.familyId))]
    expect(families.length).toBe(RC_PASSAGES)
    for (const fam of families) {
      const all = items.filter((i) => i.familyId === fam).map((i) => i.itemId)
      const mine = shown.filter((s) => bank.get(s.id)!.familyId === fam)
      expect(mine.map((s) => s.id)).toEqual(all)
      expect(mine.map((s) => s.position)).toEqual(all.map((_, i) => ({ index: i + 1, of: all.length })))
      // one passage on screen for all of them, with the source line of its family (or none)
      expect(new Set(mine.map((s) => s.passageKey)).size).toBe(1)
      expect(new Set(mine.map((s) => s.attribution))).toEqual(new Set([bank.get(all[0]!)!.attribution ?? null]))
    }
    expect(shown.map((s) => bank.get(s.id)!.familyId)).toEqual(families.flatMap((fam) => items.filter((i) => i.familyId === fam).map(() => fam)))
    expect(shown.length).toBeGreaterThanOrEqual(6)
    expect(shown.length).toBeLessThanOrEqual(8)
    expect(run.result().itemsByAxis.RC).toBe(shown.length)

    // What came over the wire: the passage and the question as text, the place in the set, and nothing about an answer.
    const served = cat.replies.flatMap((r) => (r.kind === 'item' ? [r.item] : []))
    expect(served.map((s) => s.item_id)).toEqual(shown.map((s) => s.id))
    for (const item of served) {
      const fx = bank.get(item.item_id)!
      expect(item).toMatchObject({ family: TEXT_PASSAGE_RENDERER, supported: true, item_type: 'mc_passage', options_count: fx.nOptions, time_limit_s: fx.timeLimitS })
      expect(isPassageSpec(item.spec)).toBe(true)
      expect(item.spec).toMatchObject({ stem: fx.payload!.stem, options: fx.payload!.options, passage: (fx.payload!.media as { passage: string[] }).passage })
    }
    // the first question of each passage has the longer allowance the bank gave it
    expect(served.filter((s) => s.set?.index === 1).map((s) => s.time_limit_s)).toEqual([300, 300])
    const raw = shim.requests.slice(before)
    expect(raw.some((r) => r.fn === 'submit')).toBe(true)
    expect(JSON.stringify(cat.replies)).not.toMatch(/"key"|"correct"|rationale|tolerance|"a":|"b":|"c":|"f:tst:/u)
    // the client asked for the skill once per question and once more for nothing: it did not ask for a third passage
    const asked = raw.filter((r) => r.fn === 'next_item').map((r) => (JSON.parse(r.body) as { p_axes: string[] }).p_axes.join())
    expect(asked).toEqual(shown.map(() => 'RC'))

    // The server scored each answer against its key (the rows are the server's; no reply shows them).
    const rows = (await db.owner.query<{ item_id: string; response: number; correct: number }>(`select item_id, response, correct from public.responses where session_id = $1 order by seq`, [server.sessionId])).rows
    expect(rows.map((r) => r.item_id)).toEqual(shown.map((s) => s.id))
    for (const r of rows) {
      expect(r.response, r.item_id).toBe(given.get(r.item_id))
      expect(r.correct, r.item_id).toBe(r.response === bank.get(r.item_id)!.key.index ? 1 : 0)
    }

    // The close: signed, no verdict in it, and the skill published from its answers (questions, not passages).
    const fin = await server.finish(run.serverFlags())
    expect(fin.session.sig).toMatchObject({ alg: 'HMAC-SHA256', anon_id: server.anonId })
    expect(fin.session.responses.map((r) => r[0])).toEqual(shown.map((s) => s.id))
    expect(fin.session.responses.every((r) => r[3] === null)).toBe(true)
    const save = saveOf(server, fin.session, shown.map((s) => s.id))
    expect((await api.verifySave(save)).sessions).toEqual([{ sessionId: server.sessionId, status: 'verified', reason: null }])
    const est = await api.rescore(save)
    expect(Object.keys(est.eap)).toEqual(['RC'])
    expect(est.eap.RC!.n).toBe(shown.length)
    expect(est.eap.RC!.n).toBeGreaterThanOrEqual(PUBLISH_MIN_ITEMS)

    // A second session of the same person reads two other passages.
    const second = await playReading(client(), () => 0, save)
    expect(second.server.anonIdAdopted).toBe(true)
    const again = new Set(second.shown.map((s) => bank.get(s.id)!.familyId))
    expect(again.size).toBe(RC_PASSAGES)
    for (const fam of again) expect(families).not.toContain(fam)
  })
})
