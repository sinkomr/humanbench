/**
 * M3.11 phase 2 (ROADMAP M3.11; DESIGN §3 rows 3 and 4, §6.iii, §7.1, §7.4, §11.2, R-11.1): item sets on the
 * server (`supabase/migrations/20261013000100_item_sets.sql`). The questions of one passage share a family and
 * are served together: all of them, one after the other, in the order of their ids; the passage competes for a
 * slot as one unit; exposure is counted per passage; every answer is scored and counted as a question; and no
 * reply gains anything about a key.
 *
 * Every passage here is made up at run time and says so (`passageItems`); the keys are positions drawn by the
 * fixture's PRNG. Each describe has a database of its own.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRng } from '../../src/engine/prng'
import { itemInformation, TESTLET_INFO_FACTOR } from '../../src/engine/selector'
import { customItem, loadFixtureBank, madeUpPassage, passageItems, type FixtureItem } from './bank-fixture'
import type { TestDb } from './harness'
import { ageExposures, emptySave, from, isServed, startSession, type Next, type Served, type Started } from './rpc-support'
import { openTestDb } from './vitest'

let ipCounter = 0
const freshIp = (): string => {
  const n = ++ipCounter
  return `198.19.${Math.floor(n / 250)}.${(n % 250) + 1}`
}

type SetInfo = { position: number; of: number }
type ServedSet = Served & { set?: SetInfo }
type Session = Started & { ip: string }

interface Scenario {
  db: TestDb
  bank: Map<string, FixtureItem>
}

async function scenario(items: readonly FixtureItem[], config: Readonly<Record<string, unknown>> = {}): Promise<Scenario> {
  const db = await openTestDb()
  await loadFixtureBank(db, items)
  for (const [key, value] of Object.entries(config)) await db.owner.query(`update public.app_config set value = $2::jsonb where key = $1`, [key, JSON.stringify(value)])
  return { db, bank: new Map(items.map((i) => [i.itemId, i])) }
}

async function start(sc: Scenario, save?: unknown): Promise<Session> {
  const ip = freshIp()
  return { ...(await startSession(sc.db, ip, save)), ip }
}

const axesArg = (axes?: readonly string[]): { p_axes?: string[] } => (axes === undefined ? {} : { p_axes: [...axes] })

const nextOf = (sc: Scenario, s: Session, axes?: readonly string[]): Promise<Next> => sc.db.rpc<Next>(from(s.ip), 'next_item', { p_token: s.token, ...axesArg(axes) })

/** Hands `response` over for the served item (the exposures aged, so the server's clock is not the issue) and returns the next item. */
async function submit(sc: Scenario, s: Session, served: Served, response: unknown, axes?: readonly string[], flags?: Record<string, unknown>, next = true): Promise<Next> {
  await ageExposures(sc.db, s.session_id, 20)
  const out = await sc.db.rpc<{ ack: boolean; seq: number; next?: Next }>(from(s.ip), 'submit', {
    p_token: s.token,
    p_item_id: served.item.item_id,
    p_response: response,
    p_rt_ms: 5000,
    ...(flags === undefined ? {} : { p_client_flags: flags }),
    ...(next ? {} : { p_next: false }),
    ...axesArg(axes),
  })
  return out.next ?? { done: true, reason: 'not_asked' }
}

const keyOf = (sc: Scenario, served: Served): number => sc.bank.get(served.item.item_id)!.key.index as number

/** Plays the session on `axes` until the server says it is done, or `max` items have been answered (nothing is asked for after the last): the items served, in order. */
async function playAll(sc: Scenario, s: Session, axes: readonly string[], max = 200, respond: (served: ServedSet, i: number) => unknown = (served) => keyOf(sc, served)): Promise<{ served: ServedSet[]; end: Next }> {
  const served: ServedSet[] = []
  let next = await nextOf(sc, s, axes)
  while (isServed(next) && served.length < max) {
    served.push(next)
    next = await submit(sc, s, next, respond(next, served.length - 1), axes, undefined, served.length < max)
  }
  return { served, end: next }
}

/** The questions of the fixture's passage with this family, in id order (the order the server must serve them in). */
const questionsOf = (sc: Scenario, familyId: string): string[] => [...sc.bank.values()].filter((i) => i.familyId === familyId).map((i) => i.itemId).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

function keysIn(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) for (const x of v) keysIn(x, out)
  else if (v !== null && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.push(k)
      keysIn(x, out)
    }
  }
  return out
}
const KEYISH = /(key|answer|correct|solution|rationale|toler|option_weights|verdict)/i

/** The ranked pool of the session's next live slot, straight from hb.rank_live. */
async function pool(sc: Scenario, sessionId: string, axes: readonly string[] | null = null, exclude: readonly string[] | null = null): Promise<{ id: string; family: string; score: number; info: number }[]> {
  const { rows } = await sc.db.owner.query<{ o_item_id: string; o_family_id: string; o_score: number; o_info: number }>(
    `select * from hb.rank_live((select s from public.sessions s where s.session_id = $1), $2::text[], $3::text[]) order by o_rank`,
    [sessionId, axes, exclude],
  )
  return rows.map((r) => ({ id: r.o_item_id, family: r.o_family_id, score: r.o_score, info: r.o_info }))
}

const exposureOf = async (sc: Scenario, itemId: string): Promise<number> =>
  Number((await sc.db.owner.query<{ n: string }>(`select coalesce((select n_sessions from public.item_exposure where item_id = $1), 0) as n`, [itemId])).rows[0]!.n)

// ------------------------------------------------------------------------------ together, in order
describe('a passage is served whole: every question, one after the other, in the order of the ids', () => {
  let sc: Scenario
  const passages = passageItems({ passages: 6, seed: 'whole' })
  const singles = Array.from({ length: 10 }, (_, k) => customItem(100 + k, 'MAT', { b: -1 + 0.2 * k }))
  beforeAll(async () => {
    sc = await scenario([...passages, ...singles])
  })
  afterAll(async () => {
    await sc.db.close()
  })

  it('serves the questions of each passage consecutively and in id order, says where each stands in its set, and ends with no_items when every passage has been read', async () => {
    const s = await start(sc)
    // right, wrong, an answer outside the options, and one left to run out of time: none of them changes what comes next inside a set
    const { served, end } = await playAll(sc, s, ['RC'], 200, (q, i) => (i % 4 === 0 ? keyOf(sc, q) : i % 4 === 1 ? (keyOf(sc, q) + 1) % 5 : i % 4 === 2 ? 'rubbish' : null))
    expect(served.length).toBe(passages.length)
    expect(end).toEqual({ done: true, reason: 'no_items' })
    const order: string[] = []
    for (const q of served) {
      const fam = sc.bank.get(q.item.item_id)!.familyId
      if (order[order.length - 1] !== fam) order.push(fam)
    }
    expect(new Set(order).size, 'no passage is come back to').toBe(order.length)
    expect(order.length).toBe(6)
    let at = 0
    for (const fam of order) {
      const qs = questionsOf(sc, fam)
      expect(served.slice(at, at + qs.length).map((q) => q.item.item_id)).toEqual(qs)
      expect(served.slice(at, at + qs.length).map((q) => q.set)).toEqual(qs.map((_, i) => ({ position: i + 1, of: qs.length })))
      at += qs.length
    }
    // the session's sequence numbers have no gap: nothing else was served in between
    expect(served.map((q) => q.seq)).toEqual(served.map((_, i) => i + 1))
  })

  it('hands the same pending question over again on a reload, with the same place in its set', async () => {
    const s = await start(sc)
    const first = (await nextOf(sc, s, ['RC'])) as ServedSet
    expect(first.set?.position).toBe(1)
    expect(await nextOf(sc, s, ['RC'])).toEqual(first)
    const second = (await submit(sc, s, first, 0, ['RC'])) as ServedSet
    expect(second.set).toEqual({ position: 2, of: first.set!.of })
    expect(await nextOf(sc, s, ['RC'])).toEqual(second)
    expect(await nextOf(sc, s, ['MAT'])).toEqual(second) // a pending item is the pending item, whatever is asked for
    const { rows } = await sc.db.owner.query<{ n: string }>(`select count(*) as n from public.exposure_log where session_id = $1`, [s.session_id])
    expect(rows[0]!.n).toBe('2')
  })

  it('goes on with the set after a question that was let go (a renderer that could not draw it), and after one that ran out of time', async () => {
    const s = await start(sc)
    const q1 = (await nextOf(sc, s, ['RC'])) as ServedSet
    const qs = questionsOf(sc, sc.bank.get(q1.item.item_id)!.familyId)
    const q2 = (await submit(sc, s, q1, null, ['RC'], { unavailable: true })) as ServedSet
    expect(q2.item.item_id).toBe(qs[1])
    const q3 = (await submit(sc, s, q2, null, ['RC'])) as ServedSet
    expect(q3.item.item_id).toBe(qs[2])
  })

  it('leaves every other item as it was: an item that is not a set question has no `set`, and its reply is the item view', async () => {
    const s = await start(sc)
    const n = await nextOf(sc, s, ['MAT'])
    expect(isServed(n)).toBe(true)
    expect(Object.keys(n).sort()).toEqual(['item', 'seq'])
    const view = (await sc.db.sudo.query<{ v: unknown }>(`select hb.item_view($1, 1) as v`, [(n as Served).item.item_id])).rows[0]!.v
    expect(n).toEqual(view)
  })

  it('a question of a passage has the passage in every reply, as text, and exactly the fields a client may see', async () => {
    const s = await start(sc)
    const { served } = await playAll(sc, s, ['RC'], 4)
    for (const q of served) {
      const fx = sc.bank.get(q.item.item_id)!
      expect(Object.keys(q).sort()).toEqual(['item', 'seq', 'set'])
      expect(Object.keys(q.item).sort()).toEqual(['item_id', 'item_type', 'media', 'options', 'stem', 'time_limit_s'])
      expect(q.item).toMatchObject({ item_type: 'mc_passage', stem: fx.payload!.stem, options: fx.payload!.options, time_limit_s: fx.timeLimitS })
      expect(q.item.media).toEqual(fx.payload!.media) // no source line in this bank: nothing is added
      expect(Object.keys(q.set!).sort()).toEqual(['of', 'position'])
    }
    // the first question's allowance covers the reading; the bank sets it, the server hands it over as stored
    expect(served[0]!.item.time_limit_s).toBe(300)
    expect(served[1]!.item.time_limit_s).toBe(180)
  })
})

// ------------------------------------------------------------------------------- the unit's criterion
describe('a set competes for a slot as one unit (§7.4 for the unit, §7.1 for the shared text)', () => {
  let sc: Scenario
  // three passages on RC: one of 2PL-testlet questions, one of four-option 3PL questions, one of plain 2PL; and single RC items
  const testlet = passageItems({ passages: 1, seed: 'crit-t', questions: () => 4 })
  const three = passageItems({ passages: 1, seed: 'crit-3', questions: () => 3, model: '3pl' })
  const plain = passageItems({ passages: 1, seed: 'crit-2', questions: () => 2, model: '2pl' })
  // (the same generator name as the passages, so the content balancing of an axis is not what this describe is about)
  const single = (n: number, over: Partial<FixtureItem>): FixtureItem => customItem(n, 'RC', { generator: 'authored_test', ...over })
  const singles = [single(1, { a: 1.2, b: 0.1, expectedTimeS: 40 }), single(2, { a: 0.7, b: -0.4, expectedTimeS: 25 }), single(3, { model: '3pl', a: 1.5, b: 0.3, expectedTimeS: 60 })]
  beforeAll(async () => {
    sc = await scenario([...testlet, ...three, ...plain, ...singles], { 'selection.top_k': 50, 'selection.coverage_floor': 0 })
  })
  afterAll(async () => {
    await sc.db.close()
  })

  const info = (it: FixtureItem, theta = 0): number =>
    itemInformation(it.model === '3pl' ? { model: '3pl', a: it.a, b: it.b, c: it.c! } : it.model === '2pl_testlet' ? { model: '2pl_testlet', a: it.a, b: it.b } : { model: '2pl', a: it.a, b: it.b }, theta)

  it('ranks a set by the sum of its questions\' information over the sum of their times, each question by its own model, and names its first question', async () => {
    const s = await start(sc)
    const ranked = await pool(sc, s.session_id, ['RC'])
    expect(ranked.length).toBe(6) // three sets, three single items
    for (const set of [testlet, three, plain]) {
      const row = ranked.find((r) => r.family === set[0]!.familyId)!
      expect(row.id).toBe(set[0]!.itemId)
      const sumInfo = set.reduce((t, q) => t + info(q), 0)
      const sumT = set.reduce((t, q) => t + q.expectedTimeS!, 0)
      expect(row.info).toBeCloseTo(sumInfo, 12)
      expect(row.score).toBeCloseTo(sumInfo / sumT, 12) // Var = 1 at the prior
    }
    // the 2PL-testlet questions carry the 0.8 of §7.1, the others their own information in full
    expect(info(testlet[0]!)).toBeCloseTo(TESTLET_INFO_FACTOR * itemInformation({ model: '2pl', a: testlet[0]!.a, b: testlet[0]!.b }, 0), 12)
    for (const single of singles) {
      const row = ranked.find((r) => r.id === single.itemId)!
      expect(row.score).toBeCloseTo(info(single) / single.expectedTimeS!, 12)
    }
    // best first, ties by id, as before
    expect(ranked.map((r) => r.score)).toEqual([...ranked.map((r) => r.score)].sort((a, b) => b - a))
  })

  it('is a candidate only whole: a set with a question that lost a race, is at the cap, or is not live at its first question, is left out or entered at the first live one', async () => {
    const s = await start(sc)
    // a question that a concurrent session has just used up (p_exclude): the whole set is out, not entered at another question
    for (const q of [testlet[0]!, testlet[2]!]) {
      const ranked = await pool(sc, s.session_id, ['RC'], [q.itemId])
      expect(ranked.find((r) => r.family === testlet[0]!.familyId)).toBeUndefined()
      expect(ranked.length).toBe(5)
    }
    // a later question at the exposure cap: the same
    await sc.db.owner.query(`insert into public.item_exposure (item_id, n_sessions) values ($1, 1000)`, [three[1]!.itemId])
    expect((await pool(sc, s.session_id, ['RC'])).find((r) => r.family === three[0]!.familyId)).toBeUndefined()
    await sc.db.owner.query(`delete from public.item_exposure where item_id = $1`, [three[1]!.itemId])
    // the first question retired: the set is entered at the first live one, with what is left of it
    await sc.db.owner.query(`update public.items set status = 'retired' where item_id = $1`, [three[0]!.itemId])
    const row = (await pool(sc, s.session_id, ['RC'])).find((r) => r.family === three[0]!.familyId)!
    expect(row.id).toBe(three[1]!.itemId)
    expect(row.info).toBeCloseTo(info(three[1]!) + info(three[2]!), 12)
    await sc.db.owner.query(`update public.items set status = 'live' where item_id = $1`, [three[0]!.itemId])
  })

  it('uses the session\'s posterior for the unit, as for an item', async () => {
    const s = await start(sc)
    let n = await nextOf(sc, s, ['RC'])
    // answer single items or a whole set until something has been answered and no set is under way
    for (let i = 0; i < 12 && isServed(n); i++) {
      const cur = n as ServedSet
      const last = cur.set === undefined || cur.set.position === cur.set.of
      n = await submit(sc, s, cur, keyOf(sc, cur), ['RC'], undefined, !last)
      if (last) break
    }
    const { rows } = await sc.db.owner.query<{ mean: number; sd: number }>(`select mean, sd from hb.session_posteriors((select state from public.sessions where session_id = $1)) where axis = 'RC'`, [s.session_id])
    const { mean, sd } = rows[0]!
    expect(sd).toBeLessThan(1)
    const ranked = await pool(sc, s.session_id, ['RC'])
    let checked = 0
    for (const set of [testlet, three, plain]) {
      const row = ranked.find((r) => r.family === set[0]!.familyId)
      if (row === undefined) continue // the set this session has been served
      checked++
      const sumInfo = set.reduce((t, q) => t + info(q, mean), 0)
      const sumT = set.reduce((t, q) => t + q.expectedTimeS!, 0)
      expect(row.score / ((sumInfo * sd * sd) / sumT)).toBeCloseTo(1, 9)
    }
    expect(ranked.length).toBe(5)
    expect(checked).toBeGreaterThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------------- exposure
describe('exposure is counted per passage (§6.iii: at most 0.25 of sessions)', () => {
  let sc: Scenario
  const one = passageItems({ passages: 1, seed: 'cap', questions: () => 3 })
  beforeAll(async () => {
    sc = await scenario(one) // the defaults: cap 0.25 of max(sessions, 20) = 5 sessions
  })
  afterAll(async () => {
    await sc.db.close()
  })

  it('five sessions may read the passage, each of them all of it; the sixth is served none of its questions', async () => {
    const reached: number[] = []
    for (let k = 0; k < 5; k++) {
      const s = await start(sc)
      // two of the five leave after the first question (their part ended): the passage still counts as read by them
      const { served } = await playAll(sc, s, ['RC'], k < 2 ? 1 : 200)
      reached.push(served.length)
      expect(served.map((q) => q.item.item_id)).toEqual(one.slice(0, served.length).map((q) => q.itemId))
    }
    expect(reached).toEqual([1, 1, 3, 3, 3])
    const sixth = await start(sc)
    expect(await nextOf(sc, sixth, ['RC'])).toEqual({ done: true, reason: 'no_items' })
    // the first question's count is the passage's; the later ones say how many sessions reached them, with no limit of their own
    expect(await exposureOf(sc, one[0]!.itemId)).toBe(5)
    expect(await exposureOf(sc, one[1]!.itemId)).toBe(3)
    expect(await exposureOf(sc, one[2]!.itemId)).toBe(3)
  })

  it('a later question is served to a session that is inside the passage even when the cap is at its limit', async () => {
    await sc.db.owner.query(`update public.app_config set value = '1000'::jsonb where key = 'selection.exposure_cap'`)
    const s = await start(sc)
    const q1 = await nextOf(sc, s, ['RC'])
    expect(isServed(q1)).toBe(true)
    await sc.db.owner.query(`update public.app_config set value = '0.25'::jsonb where key = 'selection.exposure_cap'`)
    const q2 = await submit(sc, s, q1 as Served, 0, ['RC'])
    expect(isServed(q2) && q2.item.item_id).toBe(one[1]!.itemId)
    const q3 = await submit(sc, s, q2 as Served, 0, ['RC'])
    expect(isServed(q3) && q3.item.item_id).toBe(one[2]!.itemId)
    expect(await submit(sc, s, q3 as Served, 0, ['RC'])).toEqual({ done: true, reason: 'no_items' })
  })

  it('six sessions asking at once for the last place of a passage: one gets it', async () => {
    const fresh = passageItems({ passages: 1, seed: 'race', questions: () => 3 })
    for (const it of fresh) sc.bank.set(it.itemId, it)
    await loadFixtureBank(sc.db, fresh)
    const { rows } = await sc.db.owner.query<{ n: string }>(`select count(*) as n from public.sessions`)
    const limit = Math.floor(0.25 * Math.max(Number(rows[0]!.n) + 6, 20))
    await sc.db.owner.query(`insert into public.item_exposure (item_id, n_sessions) values ($1, $2)`, [fresh[0]!.itemId, limit - 1])
    // the old passage is used up for everyone
    await sc.db.owner.query(`update public.item_exposure set n_sessions = 1000 where item_id = $1`, [one[0]!.itemId])
    const sessions: Session[] = []
    for (let k = 0; k < 6; k++) sessions.push(await start(sc))
    const got = await Promise.all(sessions.map((s) => nextOf(sc, s, ['RC'])))
    expect(got.filter(isServed).length).toBe(1)
    expect(got.filter(isServed)[0]!.item.item_id).toBe(fresh[0]!.itemId)
    expect(await exposureOf(sc, fresh[0]!.itemId)).toBe(limit)
  })
})

// ------------------------------------------------------------------------------- leaving a set
describe('what can and cannot come between two questions of a passage', () => {
  let sc: Scenario
  const passages = passageItems({ passages: 4, seed: 'leave', questions: () => 4 })
  const singles = Array.from({ length: 8 }, (_, k) => customItem(200 + k, 'MAT', { b: -1 + 0.25 * k }))
  const pretest = Array.from({ length: 6 }, (_, k) => customItem(300 + k, 'RC', { status: 'pretest', seB: 1 }))
  const pretestPassage = passageItems({ passages: 1, seed: 'leave-pre', questions: () => 3, status: 'pretest' })
  beforeAll(async () => {
    sc = await scenario([...passages, ...singles, ...pretest, ...pretestPassage])
  })
  afterAll(async () => {
    await sc.db.close()
  })

  it('a call for another part leaves the passage: the rest is never served, in this session or in a later one of the person', async () => {
    const s = await start(sc)
    const q1 = (await nextOf(sc, s, ['RC'])) as ServedSet
    const fam = sc.bank.get(q1.item.item_id)!.familyId
    const q2 = (await submit(sc, s, q1, keyOf(sc, q1), ['RC'])) as ServedSet
    expect(sc.bank.get(q2.item.item_id)!.familyId).toBe(fam)
    // the part ended: the client asks for another skill
    const other = await submit(sc, s, q2, keyOf(sc, q2), ['MAT'])
    expect(isServed(other) && sc.bank.get(other.item.item_id)!.axis).toBe('MAT')
    // back on the skill: another passage, from its first question
    const back = (await submit(sc, s, other as Served, 0, ['RC'])) as ServedSet
    expect(sc.bank.get(back.item.item_id)!.familyId).not.toBe(fam)
    expect(back.set?.position).toBe(1)
    const rest = await playAll(sc, s, ['RC'])
    const all = [q1, q2, back, ...rest.served].map((q) => q.item.item_id)
    expect(all.filter((id) => sc.bank.get(id)!.familyId === fam)).toEqual(questionsOf(sc, fam).slice(0, 2))
    // a later session of the same person (the signed session proves the id): the passage stays out, whole
    const fin = await sc.db.rpc<{ session: Record<string, unknown> }>(from(s.ip), 'finish', { p_token: s.token })
    const again = await start(sc, emptySave(s.anon_id, { sessions: [fin.session] }))
    expect(again.anon_id_adopted).toBe(true)
    expect(await nextOf(sc, again, ['RC'])).toEqual({ done: true, reason: 'no_items' })
  })

  it('a call with no axes (every skill) keeps to the passage too', async () => {
    const s = await start(sc)
    const q1 = (await nextOf(sc, s, ['RC'])) as ServedSet
    const qs = questionsOf(sc, sc.bank.get(q1.item.item_id)!.familyId)
    let n: Next = q1
    const got: string[] = []
    for (let i = 0; i < qs.length && isServed(n); i++) {
      got.push(n.item.item_id)
      n = await submit(sc, s, n, 0)
    }
    expect(got).toEqual(qs)
  })

  it('the per-skill stop does not cut a passage: with the skill precise enough after two answers, the other two questions still come, and then the skill is done', async () => {
    await sc.db.owner.query(`update public.app_config set value = '0.95'::jsonb where key = 'selection.stop_sd'`)
    try {
      const s = await start(sc)
      const { served, end } = await playAll(sc, s, ['RC'])
      expect(served.map((q) => q.set)).toEqual([1, 2, 3, 4].map((position) => ({ position, of: 4 })))
      expect(end).toEqual({ done: true, reason: 'axes_done' })
    } finally {
      await sc.db.owner.query(`update public.app_config set value = '0.3'::jsonb where key = 'selection.stop_sd'`)
    }
  })

  it('no pretest slot opens inside a passage, a pretest slot never takes a question of a passage, and a passage that is not live is not served', async () => {
    for (const [key, value] of [['selection.pretest_share', 1], ['selection.pretest_prob', 1], ['selection.exposure_cap', 1000]] as const) {
      await sc.db.owner.query(`update public.app_config set value = $2::jsonb where key = $1`, [key, JSON.stringify(value)])
    }
    const s = await start(sc)
    const { served } = await playAll(sc, s, ['RC'], 60)
    const kinds = served.map((q) => (sc.bank.get(q.item.item_id)!.status === 'pretest' ? 'pre' : 'set'))
    expect(kinds).toContain('pre')
    expect(kinds).toContain('set')
    // every pretest item served is one of the single ones; inside a passage the questions are consecutive
    for (const q of served) if (sc.bank.get(q.item.item_id)!.status === 'pretest') expect(sc.bank.get(q.item.item_id)!.storedType).toBeUndefined()
    for (const [i, q] of served.entries()) {
      if (q.set !== undefined && q.set.position > 1) expect(served[i - 1]!.set).toEqual({ position: q.set.position - 1, of: q.set.of })
    }
    expect(served.some((q) => pretestPassage.some((p) => p.itemId === q.item.item_id))).toBe(false)
  })
})

// --------------------------------------------------------------------- scoring and what a reply holds
describe('every question is scored and counted; no reply gains anything about a key (R-11.1)', () => {
  let sc: Scenario
  const CANARY = 'CANARY'
  const CREDIT = (p: number): string => `Made-up source line ${p + 1}: adapted from “A Text That Does Not Exist”, by Nobody, licensed CC BY 4.0 (placeholder).`
  // passages 1 to 4 have a source line in the family's source; 5 and 6 have none; four options, so 3PL
  const sourced = passageItems({ passages: 4, seed: 'score', attribution: CREDIT })
  const unsourced = passageItems({ passages: 2, seed: 'score-plain', model: '3pl' })
  const own = passageItems({ passages: 1, seed: 'score-own', attribution: () => 'The family says this (made up).', attributionInMedia: true }).map((q) => ({
    ...q,
    payload: { ...q.payload, media: { ...(q.payload!.media as object), attribution: 'The payload says this (made up).' } },
  }))
  beforeAll(async () => {
    sc = await scenario([...sourced, ...unsourced, ...own], { 'selection.exposure_cap': 1000 })
    // canaries in everything a reply must not hold: the key table's other columns, the family's source beside its credit line,
    // the item's verification, provenance and server tags
    await sc.db.owner.query(`update public.item_keys set key = key || jsonb_build_object('canary', $1 || '-key'), tolerance = jsonb_build_object('canary', $1 || '-tol'), rationale = jsonb_build_object('why', $1 || '-why')`, [CANARY])
    await sc.db.owner.query(`update public.item_families set source = source || jsonb_build_object('title', $1 || '-title', 'url', 'https://example.invalid/' || $1, 'batch', $1 || '-batch')`, [CANARY])
    await sc.db.owner.query(`update public.items set verification = jsonb_build_object('evidence_span', $1 || '-span'), provenance = provenance || jsonb_build_object('notes', $1 || '-notes'), server_tags = jsonb_build_object('question_type', $1 || '-tag')`, [CANARY])
  })
  afterAll(async () => {
    await sc.db.close()
  })

  function expectClean(reply: unknown, what: string): void {
    expect(JSON.stringify(reply), `${what}: a canary`).not.toContain(CANARY)
    expect(keysIn(reply).filter((k) => KEYISH.test(k)), `${what}: a property named for a key, an answer or a score`).toEqual([])
    expect(JSON.stringify(reply), `${what}: a family id`).not.toMatch(/"f:tst:/u)
  }

  it('two passages are seven answers: each scored against its own key, the session signed with no verdict, and the skill published from them; one passage is too few', async () => {
    const s = await start(sc)
    const replies: unknown[] = []
    const given = new Map<string, unknown>()
    let n = await nextOf(sc, s, ['RC'])
    replies.push(n)
    let passagesDone = 0
    const shown: string[] = []
    while (isServed(n) && passagesDone < 2) {
      const cur = n as ServedSet
      shown.push(cur.item.item_id)
      const response = shown.length % 3 === 0 ? (keyOf(sc, cur) + 1) % sc.bank.get(cur.item.item_id)!.nOptions : keyOf(sc, cur)
      given.set(cur.item.item_id, response)
      if (cur.set!.position === cur.set!.of) passagesDone++
      await ageExposures(sc.db, s.session_id, 20)
      const out = await sc.db.rpc<{ next?: Next }>(from(s.ip), 'submit', { p_token: s.token, p_item_id: cur.item.item_id, p_response: response, p_rt_ms: 5000, p_next: passagesDone < 2, p_axes: ['RC'] })
      replies.push(out)
      n = out.next ?? { done: true, reason: 'stopped' }
    }
    expect(shown.length).toBeGreaterThanOrEqual(6)
    expect(shown.length).toBeLessThanOrEqual(8)
    const rows = (await sc.db.owner.query<{ item_id: string; response: number; correct: number }>(`select item_id, response, correct from public.responses where session_id = $1 order by seq`, [s.session_id])).rows
    expect(rows.map((r) => r.item_id)).toEqual(shown)
    for (const r of rows) expect(r.correct, r.item_id).toBe(r.response === sc.bank.get(r.item_id)!.key.index ? 1 : 0)
    expect(rows.some((r) => r.correct === 0) && rows.some((r) => r.correct === 1)).toBe(true)

    const fin = await sc.db.rpc<{ session: { responses: unknown[][]; sig?: unknown }; anon_id: string; n_responses: number }>(from(s.ip), 'finish', { p_token: s.token })
    replies.push(fin)
    expect(fin.n_responses).toBe(shown.length)
    expect(fin.session.responses.map((t) => t[0])).toEqual(shown)
    expect(fin.session.responses.every((t) => t[3] === null)).toBe(true)
    const save = emptySave(fin.anon_id, { sessions: [fin.session] })
    const verified = await sc.db.rpc<{ n_verified: number }>(from(freshIp()), 'verify_save', { p_save: save })
    replies.push(verified)
    expect(verified.n_verified).toBe(1)
    const scored = await sc.db.rpc<{ eap: Record<string, { n: number; sd: number }>; withheld: { eap: Record<string, unknown> } }>(from(freshIp()), 'rescore', { p_save: save })
    replies.push(scored)
    expect(Object.keys(scored.eap)).toEqual(['RC'])
    expect(scored.eap.RC!.n).toBe(shown.length) // questions, not passages

    // one passage (three or four answers) is under the five a skill is published from
    const t = await start(sc)
    const one = await playAll(sc, t, ['RC'], 3)
    expect(one.served.length).toBe(3)
    const fin2 = await sc.db.rpc<{ session: unknown; anon_id: string }>(from(t.ip), 'finish', { p_token: t.token })
    const few = await sc.db.rpc<{ eap: Record<string, unknown>; withheld: { eap: Record<string, unknown> } }>(from(freshIp()), 'rescore', { p_save: emptySave(fin2.anon_id, { sessions: [fin2.session] }) })
    replies.push(fin2, few)
    expect(few.eap).toEqual({})
    expect(Object.keys(few.withheld.eap)).toEqual(['RC'])
    for (const [i, r] of replies.entries()) expectClean(r, `reply ${i}`)
  })

  it('shows the source line of an adapted text with every question of it: the family\'s, unless the payload has its own; and nothing else of the source', async () => {
    const s = await start(sc)
    const { served } = await playAll(sc, s, ['RC'], 200, () => 0)
    expect(served.length).toBe(sourced.length + unsourced.length + own.length)
    for (const q of served) {
      const fx = sc.bank.get(q.item.item_id)!
      const media = q.item.media as Record<string, unknown>
      expect(Object.keys(media).filter((k) => !['renderer', 'passage', 'attribution'].includes(k))).toEqual([])
      expect(media.passage).toEqual((fx.payload!.media as { passage: string[] }).passage)
      if (sourced.includes(fx)) expect(media.attribution).toBe(fx.attribution)
      else if (unsourced.includes(fx)) expect('attribution' in media).toBe(false)
      else expect(media.attribution).toBe('The payload says this (made up).')
      expectClean(q, q.item.item_id)
    }
    // a source line of 5,000 characters is cut, and one of blanks is not a line
    await sc.db.owner.query(`update public.item_families set source = jsonb_set(source, '{attribution}', to_jsonb(repeat('x', 5000))) where family_id = $1`, [sourced[0]!.familyId])
    await sc.db.owner.query(`update public.item_families set source = jsonb_set(source, '{attribution}', '"   "') where family_id = $1`, [sourced[sourced.length - 1]!.familyId])
    const view = async (id: string): Promise<Record<string, unknown>> =>
      (await sc.db.sudo.query<{ v: { item: { media: Record<string, unknown> } } }>(`select hb.served_view((select s from public.sessions s where s.session_id = $1), $2, 1) as v`, [s.session_id, id])).rows[0]!.v.item.media
    expect(String((await view(sourced[0]!.itemId)).attribution).length).toBe(1000)
    expect('attribution' in (await view(sourced[sourced.length - 1]!.itemId))).toBe(false)
  })

  it('a fuzz over sessions that ask, switch skills, answer right, wrong and with rubbish, and let go: the set rule holds at every step and every reply is clean', async () => {
    const extra = [...passageItems({ passages: 30, seed: 'fuzz', questions: (p) => 1 + (p % 5), attribution: (p) => (p % 2 === 0 ? CREDIT(p) : undefined) }), ...Array.from({ length: 60 }, (_, k) => customItem(500 + k, 'MAT', { b: -2 + 0.07 * k }))]
    for (const it of extra) sc.bank.set(it.itemId, it)
    await loadFixtureBank(sc.db, extra)
    await sc.db.owner.query(`update public.item_keys set rationale = jsonb_build_object('why', $1 || '-why') where rationale is null`, [CANARY])
    const rng = createRng('item-sets-fuzz')
    const RUBBISH: unknown[] = [null, 'x', { a: 1 }, [1, 2], -1, 99999, true, 'A', '', 1.5]
    let steps = 0
    let insideSteps = 0
    let left = 0
    for (let k = 0; k < 8; k++) {
      const s = await start(sc)
      const seenFamilies = new Set<string>()
      /** The set under way: its family and the questions still to come, or null. */
      let open: { family: string; rest: string[] } | null = null
      let axes: string[] | undefined = ['RC']
      let n = await nextOf(sc, s, axes)
      expectClean(n, 'next')
      for (let i = 0; i < 45 && isServed(n); i++) {
        steps++
        const cur = n as ServedSet
        const fx = sc.bank.get(cur.item.item_id)!
        if (open !== null) {
          insideSteps++
          expect(cur.item.item_id, `session ${k} step ${i}: the next question of the passage`).toBe(open.rest[0])
          open.rest.shift()
        } else if (fx.storedType === 'mc_passage') {
          expect(seenFamilies.has(fx.familyId), `session ${k} step ${i}: a passage is entered once`).toBe(false)
          const qs = questionsOf(sc, fx.familyId)
          expect(cur.item.item_id).toBe(qs[0])
          open = { family: fx.familyId, rest: qs.slice(1) }
        }
        seenFamilies.add(fx.familyId)
        if (fx.storedType === 'mc_passage') {
          const total = questionsOf(sc, fx.familyId).length
          if (total >= 2) expect(cur.set).toEqual({ position: total - open!.rest.length, of: total })
          else expect(cur.set).toBeUndefined()
        } else expect(cur.set).toBeUndefined()
        if (open !== null && open.rest.length === 0) open = null
        // what the client does next: mostly stays on the skill, sometimes moves to another part or asks for everything
        const roll = rng.next()
        axes = roll < 0.7 ? ['RC'] : roll < 0.85 ? ['MAT'] : roll < 0.95 ? ['MAT', 'RC'] : undefined
        if (open !== null && axes !== undefined && !axes.includes('RC')) {
          open = null
          left++
        }
        const how = rng.int(0, 3)
        const response = how === 0 ? (fx.key.index as number) : how === 1 ? ((fx.key.index as number) + 1) % fx.nOptions : how === 2 ? rng.pick(RUBBISH) : null
        n = await submit(sc, s, cur, response, axes, how === 3 && rng.next() < 0.5 ? { skipped: true } : undefined)
        expectClean(n, `session ${k} step ${i}`)
      }
      const fin = await sc.db.rpc<{ session: { responses: unknown[][] } }>(from(s.ip), 'finish', { p_token: s.token })
      expectClean(fin, `finish ${k}`)
      expect(fin.session.responses.every((t) => t[3] === null)).toBe(true)
    }
    expect(steps).toBeGreaterThan(200)
    expect(insideSteps).toBeGreaterThan(60)
    expect(left).toBeGreaterThan(3)
  })
})

// ------------------------------------------------------------------------------------ the setting
describe('the setting that names the set types', () => {
  let sc: Scenario
  const passages = passageItems({ passages: 3, seed: 'types', questions: () => 3 })
  beforeAll(async () => {
    sc = await scenario(passages)
  })
  afterAll(async () => {
    await sc.db.close()
  })

  it('is mc_passage and mc_logic_game; with a type taken off the list its items are served as before the rule, one per family', async () => {
    const types = async (): Promise<string[]> => (await sc.db.sudo.query<{ t: string[] }>(`select hb.set_item_types() as t`)).rows[0]!.t
    expect(await types()).toEqual(['mc_passage', 'mc_logic_game'])
    await sc.db.owner.query(`update public.app_config set value = '["mc_logic_game"]'::jsonb where key = 'selection.set_item_types'`)
    const s = await start(sc)
    const { served, end } = await playAll(sc, s, ['RC'])
    expect(served.length).toBe(3) // one question of each passage, as before
    expect(new Set(served.map((q) => sc.bank.get(q.item.item_id)!.familyId)).size).toBe(3)
    expect(served.every((q) => q.set === undefined)).toBe(true)
    expect(end).toEqual({ done: true, reason: 'no_items' })
    // a setting that is not a list, or is missing, is the default
    await sc.db.owner.query(`update public.app_config set value = '"mc_passage"'::jsonb where key = 'selection.set_item_types'`)
    expect(await types()).toEqual(['mc_passage', 'mc_logic_game'])
    await sc.db.owner.query(`delete from public.app_config where key = 'selection.set_item_types'`)
    expect(await types()).toEqual(['mc_passage', 'mc_logic_game'])
  })

  it('a made-up passage of the fixture says what it is', () => {
    expect(madeUpPassage('x', 0).every((p) => /Made-up test passage/.test(p) && /placeholder/.test(p))).toBe(true)
  })
})
