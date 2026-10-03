/**
 * M2.2 (ROADMAP M2.2; DESIGN §6.iii, §7.4, §7.7, §11.2, R-7.4): the server's item selection. The
 * criterion is held to the app's selector (engine/selector.ts criterion), and the rest of §7.4 and §6.iii
 * is tested at its default settings: the randomesque top 5, the 0.25 exposure cap, the sibling-group
 * exclusion, the coverage floor, the per-axis stop, the content balancing over generator families, the
 * restriction to a segment's axes, and the pretest slots (at most 10%, Thompson sampling on b).
 *
 * Each describe has a database of its own: a session picks from the whole bank, so the scenarios must not
 * share one.
 */

import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eapAxis } from '../../src/engine/scorer'
import { criterion, itemInformation } from '../../src/engine/selector'
import type { Observation } from '../../src/engine/types'
import { customItem, loadFixtureBank, type FixtureItem } from './bank-fixture'
import { ageExposures, emptySave, from, isServed, startSession, type Next, type Served, type Started } from './rpc-support'
import type { TestDb } from './harness'
import { openTestDb, pgCode } from './vitest'

let ipCounter = 0
/** A client address nobody has used yet in this file (the rate limit is per address). */
const freshIp = (): string => {
  const n = ++ipCounter
  return `198.18.${Math.floor(n / 250)}.${(n % 250) + 1}`
}

interface Scenario {
  db: TestDb
  items: FixtureItem[]
  bank: Map<string, FixtureItem>
}

async function scenario(items: readonly FixtureItem[], config: Readonly<Record<string, unknown>> = {}): Promise<Scenario> {
  const db = await openTestDb()
  await loadFixtureBank(db, items)
  for (const [key, value] of Object.entries(config)) await db.owner.query(`update public.app_config set value = $2::jsonb where key = $1`, [key, JSON.stringify(value)])
  return { db, items: [...items], bank: new Map(items.map((i) => [i.itemId, i])) }
}

/** A new session with a client address of its own (5 sessions a day per address). */
async function start(sc: Scenario, save?: unknown): Promise<Started & { ip: string }> {
  const ip = freshIp()
  return { ...(await startSession(sc.db, ip, save)), ip }
}

const nextOf = (sc: Scenario, s: { ip: string; token: string }, axes?: readonly string[]): Promise<Next> =>
  sc.db.rpc<Next>(from(s.ip), 'next_item', { p_token: s.token, ...(axes === undefined ? {} : { p_axes: [...axes] }) })

/** Answers the item as the key says (or not), with the exposure aged so the server's clock is not the issue; returns the next item. */
async function answer(sc: Scenario, s: { ip: string; token: string; session_id: string }, served: Served, right: boolean, axes?: readonly string[]): Promise<Next> {
  const it = sc.bank.get(served.item.item_id)!
  await ageExposures(sc.db, s.session_id, 20)
  const out = await sc.db.rpc<{ next: Next }>(from(s.ip), 'submit', {
    p_token: s.token,
    p_item_id: served.item.item_id,
    p_response: right ? it.key.index : (it.key.index as number) + 1,
    p_rt_ms: 5000,
    ...(axes === undefined ? {} : { p_axes: [...axes] }),
  })
  return out.next
}

/** The ranked pool of the session's next live slot, straight from hb.rank_live. */
async function pool(sc: Scenario, sessionId: string, axes: readonly string[] | null = null): Promise<{ id: string; score: number; info: number; axis: string }[]> {
  const { rows } = await sc.db.owner.query<{ o_item_id: string; o_score: number; o_info: number; o_axis: string }>(
    `select * from hb.rank_live((select s from public.sessions s where s.session_id = $1), $2::text[], null) order by o_rank`,
    [sessionId, axes],
  )
  return rows.map((r) => ({ id: r.o_item_id, score: r.o_score, info: r.o_info, axis: r.o_axis }))
}

/**
 * A person with a finished, signed session in which the server served (and they answered) `k` items: the save that
 * proves their anon_id (it lists the signed session and nothing else), and the items they were served. A new session
 * started with that save continues the anon_id, so the server's own rows are what keep those items away from it.
 */
async function personWithHistory(sc: Scenario, k: number, axes?: readonly string[]): Promise<{ save: Record<string, unknown>; anonId: string; served: FixtureItem[] }> {
  const s = await start(sc)
  const served: FixtureItem[] = []
  for (let i = 0; i < k; i++) {
    const n = await nextOf(sc, s, axes)
    if (!isServed(n)) break
    const it = sc.bank.get(n.item.item_id)!
    served.push(it)
    await ageExposures(sc.db, s.session_id, 20)
    await sc.db.rpc(from(s.ip), 'submit', { p_token: s.token, p_item_id: it.itemId, p_response: it.key.index, p_rt_ms: 5000, p_next: false, ...(axes === undefined ? {} : { p_axes: [...axes] }) })
  }
  const fin = await sc.db.rpc<{ session: Record<string, unknown> }>(from(s.ip), 'finish', { p_token: s.token })
  return { save: emptySave(s.anon_id, { sessions: [fin.session] }), anonId: s.anon_id, served }
}

const paramsOf = (it: FixtureItem): Parameters<typeof itemInformation>[0] =>
  it.model === '3pl' ? { model: '3pl', a: it.a, b: it.b, c: it.c! } : it.model === '2pl_testlet' ? { model: '2pl_testlet', a: it.a, b: it.b } : { model: '2pl', a: it.a, b: it.b }

// ------------------------------------------------------------------------------------ the criterion
describe('the §7.4 criterion: information per second x posterior variance (parity with engine/selector.ts)', () => {
  let sc: Scenario
  beforeAll(async () => {
    const items: FixtureItem[] = []
    let n = 0
    for (const axis of ['QR', 'MAT'] as const) {
      for (let k = 0; k < 24; k++) {
        n++
        items.push(
          customItem(n, axis, {
            model: (['2pl', '3pl', '2pl_testlet'] as const)[k % 3]!,
            a: 0.6 + 0.07 * k,
            b: -2.2 + 0.19 * k,
            expectedTimeS: [20, 30, 45, 60][k % 4]!,
          }),
        )
      }
    }
    sc = await scenario(items, { 'selection.coverage_floor': 0 })
  })
  afterAll(async () => {
    await sc.db.close()
  })

  it('ranks the candidates by the app\'s criterion at the prior (theta 0, sd 1): the top 5 and their scores agree', async () => {
    const s = await start(sc)
    const got = await pool(sc, s.session_id)
    expect(got.length).toBe(5)
    const want = sc.items
      .map((it) => ({ id: it.itemId, score: criterion({ params: paramsOf(it), expected_time_s: it.expectedTimeS! }, { mean: 0, sd: 1 }, 1) }))
      .sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : 1))
      .slice(0, 5)
    expect(got.map((g) => g.id)).toEqual(want.map((w) => w.id))
    got.forEach((g, i) => expect(Math.abs(g.score - want[i]!.score)).toBeLessThan(1e-12))
    // the information alone is that of the item's own model (a 2PL-testlet counts for 0.8 of a 2PL)
    got.forEach((g) => expect(Math.abs(g.info - itemInformation(paramsOf(sc.bank.get(g.id)!), 0))).toBeLessThan(1e-12))
  })

  it('picks one of those five at random: over 300 first items, only the top 5, and each of them', async () => {
    const s = await start(sc)
    const top = (await pool(sc, s.session_id)).map((p) => p.id)
    const counts = new Map<string, number>()
    for (let i = 0; i < 300; i++) {
      const { rows } = await sc.db.owner.query<{ id: string }>(`select hb.pick_item((select s from public.sessions s where s.session_id = $1), null, false, null) as id`, [s.session_id])
      counts.set(rows[0]!.id, (counts.get(rows[0]!.id) ?? 0) + 1)
    }
    expect([...counts.keys()].sort()).toEqual([...top].sort())
    for (const n of counts.values()) expect(n).toBeGreaterThan(30) // 60 expected; a fifth of 300
  })

  it('uses the posterior of the session: after answers the scores are those of the app at the session\'s EAP', async () => {
    const s = await start(sc)
    let next = await nextOf(sc, s, ['QR'])
    const obs: Observation[] = []
    for (let i = 0; i < 6 && isServed(next); i++) {
      const it = sc.bank.get(next.item.item_id)!
      const right = i % 3 !== 1
      obs.push(it.model === '3pl' ? { kind: '3pl', axis: 'QR', a: it.a, b: it.b, c: it.c!, y: right ? 1 : 0 } : { kind: '2pl', axis: 'QR', a: it.a, b: it.b, y: right ? 1 : 0 })
      next = await answer(sc, s, next, right, ['QR'])
    }
    const post = eapAxis(obs, 0, 1)
    const got = await pool(sc, s.session_id, ['QR'])
    expect(got.length).toBe(5)
    const served = new Set((await sc.db.owner.query<{ item_id: string }>(`select item_id from public.exposure_log where session_id = $1`, [s.session_id])).rows.map((r) => r.item_id))
    const want = sc.items
      .filter((it) => it.axis === 'QR' && !served.has(it.itemId))
      .map((it) => ({ id: it.itemId, score: criterion({ params: paramsOf(it), expected_time_s: it.expectedTimeS! }, post, 1) }))
      .sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : 1))
      .slice(0, 5)
    expect(got.map((g) => g.id)).toEqual(want.map((w) => w.id))
    got.forEach((g, i) => expect(Math.abs(g.score - want[i]!.score) / want[i]!.score).toBeLessThan(1e-9))
    // and the posterior itself, from the state the session keeps
    const { rows } = await sc.db.owner.query<{ mean: number; sd: number; n: number }>(`select * from hb.session_posteriors((select state from public.sessions where session_id = $1)) where axis = 'QR'`, [s.session_id])
    expect(Math.abs(rows[0]!.mean - post.mean)).toBeLessThan(1e-9)
    expect(Math.abs(rows[0]!.sd - post.sd)).toBeLessThan(1e-9)
    expect(rows[0]!.n).toBe(6)
  })

  it('uses E[T]: the same item twice as long scores half as much; with no expected time the length of the stem sets it (25 s + 4 s per 50 words)', async () => {
    const db = await openTestDb()
    try {
      const a = customItem(1, 'QR', { expectedTimeS: 30 })
      const b = customItem(2, 'QR', { expectedTimeS: 60 })
      const c = customItem(3, 'QR', {})
      await loadFixtureBank(db, [a, b, c])
      const times = await db.owner.query<{ id: string; t: number }>(
        `select i.item_id as id, hb.item_median_time_s(p.extra, i.payload) as t from public.items i join public.item_parameters p using (item_id) order by 1`,
      )
      expect(times.rows.map((r) => r.t)).toEqual([30, 60, 25 + (4 * 3) / 50]) // "Test item i:tst:cus:000003" is three words
      const med = await db.owner.query<{ t: number }>(`select hb.item_median_time_s('{"median_time_s": 12, "expected_time_s": 30}'::jsonb, '{}'::jsonb) as t`)
      expect(med.rows[0]!.t).toBe(12)
      expect((await db.owner.query<{ t: number }>(`select hb.item_expected_time_s('{"expected_time_s": 30, "median_time_s": 12}'::jsonb, '{}'::jsonb) as t`)).rows[0]!.t).toBe(30)
      expect((await db.owner.query<{ t: number }>(`select hb.item_median_time_s('{"expected_time_s": "x"}'::jsonb, '{"stem": "one two"}'::jsonb) as t`)).rows[0]!.t).toBe(25 + (4 * 2) / 50)
    } finally {
      await db.close()
    }
  })
})

// --------------------------------------------------------------------------------- the exposure cap
describe('the exposure cap (DESIGN §6.iii: at most 0.25 of sessions)', () => {
  it('serves an item to at most cap x max(sessions, 20) sessions, and ends the session when nothing is left', async () => {
    // 3 items on one axis; the limit is 5 per item while there are at most 20 sessions
    const sc = await scenario([1, 2, 3].map((n) => customItem(n, 'QR', { b: n - 2 })), { 'selection.coverage_floor': 0, 'selection.pretest_share': 0 })
    try {
      const served: string[] = []
      const reasons: string[] = []
      for (let k = 1; k <= 20; k++) {
        const s = await start(sc)
        const n = await nextOf(sc, s)
        if (isServed(n)) served.push(n.item.item_id)
        else reasons.push(n.reason)
        const { rows } = await sc.db.owner.query<{ m: string | null }>(`select max(n_sessions)::text as m from public.item_exposure`)
        expect(Number(rows[0]!.m ?? 0), `after session ${k}`).toBeLessThanOrEqual(5)
      }
      expect(served.length).toBe(15) // 3 items x 5
      expect(reasons).toEqual(Array(5).fill('no_items'))
      const counts = await sc.db.owner.query<{ item_id: string; n_sessions: string }>(`select item_id, n_sessions::text from public.item_exposure order by 1`)
      expect(counts.rows.map((r) => Number(r.n_sessions))).toEqual([5, 5, 5])
      // more sessions raise the limit: at 24 sessions 0.25 x 24 = 6, so each item may be seen by a sixth
      for (let k = 21; k <= 24; k++) await start(sc)
      const s = await start(sc)
      expect(isServed(await nextOf(sc, s))).toBe(true)
      expect(Number((await sc.db.owner.query<{ m: string }>(`select max(n_sessions)::text as m from public.item_exposure`)).rows[0]!.m)).toBe(6)
    } finally {
      await sc.db.close()
    }
  })

  it('keeps an item at its limit out of the pool, and out of the pretest picks too', async () => {
    const live = [1, 2, 3, 4, 5, 6].map((n) => customItem(n, 'QR', { b: 0.1 * n }))
    const pre = [7, 8].map((n) => customItem(n, 'QR', { b: 0.1 * n, status: 'pretest', seB: 1 }))
    const sc = await scenario([...live, ...pre], { 'selection.coverage_floor': 0 })
    try {
      const s = await start(sc)
      await sc.db.owner.query(`insert into public.item_exposure (item_id, n_sessions) values ($1, 5), ($2, 4), ($3, 5)`, [live[0]!.itemId, live[1]!.itemId, pre[0]!.itemId])
      // one session exists, so the limit is 0.25 x 20 = 5: n + 1 <= 5 needs n <= 4
      const ids = (await pool(sc, s.session_id)).map((p) => p.id)
      expect(ids).not.toContain(live[0]!.itemId)
      expect(ids).toContain(live[1]!.itemId)
      const picks = new Set<string | null>()
      for (let i = 0; i < 40; i++) {
        const { rows } = await sc.db.owner.query<{ id: string | null }>(`select hb.pick_item((select s from public.sessions s where s.session_id = $1), null, true, null) as id`, [s.session_id])
        picks.add(rows[0]!.id)
      }
      expect([...picks]).toEqual([pre[1]!.itemId])
    } finally {
      await sc.db.close()
    }
  })

  it('is hard when two transactions reach the counter at the same moment: the second waits for the first, then finds no place (forced overlap)', async () => {
    // The six requests of the next test do not overlap where it matters: each does a query of its own first, and they are served one
    // after the other. Here the first transaction keeps the counter row (its uncommitted increment) while the second picks the same
    // item from its snapshot (n = 4: a place is left) and reaches the counter, where it must wait for the commit and then find the
    // place gone. Without the guard on the increment the second one is served too, and the counter passes the limit.
    const item = customItem(1, 'QR', {})
    const sc = await scenario([item], { 'selection.coverage_floor': 0, 'selection.pretest_share': 0 })
    try {
      await sc.db.owner.query(`insert into public.item_exposure (item_id, n_sessions) values ($1, 4)`, [item.itemId])
      const [a, b] = [await start(sc), await start(sc)]
      const serve = (c: pg.PoolClient, sessionId: string): Promise<pg.QueryResult<{ r: Next }>> =>
        c.query(`select hb.serve_next(s, null) as r from public.sessions s where s.session_id = $1`, [sessionId])
      // both connections of the owner pool are held from here on; the waiting is watched through the superuser's
      const c1 = await sc.db.owner.connect()
      const c2 = await sc.db.owner.connect()
      try {
        const pid2 = (await c2.query<{ pid: number }>(`select pg_backend_pid() as pid`)).rows[0]!.pid
        await c1.query('begin')
        await c2.query('begin')
        const first = (await serve(c1, a.session_id)).rows[0]!.r
        const secondQuery = serve(c2, b.session_id)
        secondQuery.catch(() => undefined) // a rejection is reported where it is awaited, not as an unhandled one
        const t0 = performance.now()
        for (;;) {
          const w = await sc.db.sudo.query<{ wait_event_type: string | null }>(`select wait_event_type from pg_stat_activity where pid = $1`, [pid2])
          if (w.rows[0]?.wait_event_type === 'Lock') break
          if (performance.now() - t0 > 20_000) throw new Error('the second transaction never waited for the counter row')
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        await c1.query('commit')
        const second = (await secondQuery).rows[0]!.r
        await c2.query('commit')
        expect(isServed(first)).toBe(true)
        expect(second).toEqual({ done: true, reason: 'no_items' })
        expect((await sc.db.sudo.query<{ n: string }>(`select n_sessions::text as n from public.item_exposure`)).rows[0]!.n).toBe('5')
      } finally {
        await c1.query('rollback').catch(() => undefined)
        await c2.query('rollback').catch(() => undefined)
        c1.release()
        c2.release()
      }
    } finally {
      await sc.db.close()
    }
  })

  it('is hard under concurrency: six sessions asking for the last place of the only item, one gets it', async () => {
    // the requests mostly run one after the other (each does a query of its own first), so this holds the end-to-end result and the
    // forced overlap above holds the guard: this test passes with the guard on the increment removed
    const item = customItem(1, 'QR', {})
    const sc = await scenario([item], { 'selection.coverage_floor': 0, 'selection.pretest_share': 0 })
    try {
      await sc.db.owner.query(`insert into public.item_exposure (item_id, n_sessions) values ($1, 4)`, [item.itemId])
      const sessions = []
      for (let i = 0; i < 6; i++) sessions.push(await start(sc))
      const results = await Promise.all(sessions.map((s) => nextOf(sc, s)))
      expect(results.filter(isServed).length).toBe(1)
      expect(results.filter((r) => !isServed(r))).toEqual(Array(5).fill({ done: true, reason: 'no_items' }))
      expect((await sc.db.owner.query<{ n: string }>(`select n_sessions::text as n from public.item_exposure`)).rows[0]!.n).toBe('5')
    } finally {
      await sc.db.close()
    }
  })

  it('does not count a pending item twice: a reload of next_item gets the same item and the counter stays', async () => {
    const sc = await scenario([1, 2, 3, 4].map((n) => customItem(n, 'QR', {})), { 'selection.coverage_floor': 0 })
    try {
      const s = await start(sc)
      const a = await nextOf(sc, s)
      const b = await nextOf(sc, s)
      expect(b).toEqual(a)
      expect((await sc.db.owner.query<{ s: string }>(`select sum(n_sessions)::text as s from public.item_exposure`)).rows[0]!.s).toBe('1')
    } finally {
      await sc.db.close()
    }
  })
})

// ------------------------------------------------------------------------------------- exclusions
describe('exclusion: items, families and sibling groups (A11, A18)', () => {
  it('never serves two items of one sibling group or one family in a session, nor anything of a group the server served this person before', async () => {
    // 36 QR items: 12 groups of 3 siblings (three families in a group)
    const items = Array.from({ length: 36 }, (_, k) => {
      const group = Math.floor(k / 3)
      const base = customItem(k + 1, 'QR', { b: -1.5 + 0.08 * k, a: 1 + 0.01 * k })
      return { ...base, siblingGroup: `g:tst:grp${group}` }
    })
    const sc = await scenario(items, { 'selection.coverage_floor': 0, 'selection.pretest_share': 0, 'selection.exposure_cap': 1000 })
    try {
      const run = async (save?: unknown): Promise<FixtureItem[]> => {
        const s = await start(sc, save)
        const got: FixtureItem[] = []
        let n = await nextOf(sc, s)
        while (isServed(n)) {
          got.push(sc.bank.get(n.item.item_id)!)
          n = await answer(sc, s, n, true)
        }
        return got
      }
      const all = await run()
      expect(all.length).toBe(12)
      expect(new Set(all.map((i) => i.siblingGroup)).size).toBe(12)
      expect(new Set(all.map((i) => i.familyId)).size).toBe(12)
      // the pool after one item holds nothing of its group
      const s = await start(sc)
      const first = (await nextOf(sc, s)) as Served
      const group = sc.bank.get(first.item.item_id)!.siblingGroup
      const ids = (await pool(sc, s.session_id)).map((p) => sc.bank.get(p.id)!.siblingGroup)
      expect(ids).not.toContain(group)
      // a person the server served two items before (the proof is their signed session): those items, the other items of
      // their families and the groups of those families are out of every later session
      const person = await personWithHistory(sc, 2)
      expect(person.served.length).toBe(2)
      const rest = await run(person.save)
      expect(rest.length).toBe(10)
      const groups = new Set(rest.map((i) => i.siblingGroup))
      for (const seen of person.served) expect(groups.has(seen.siblingGroup)).toBe(false)
      // what a file claims it has seen decides nothing: not a stranger's, not the person's own (the server's rows are the only list)
      const claim = { seen_items: [items[20]!.itemId], seen_families: [items[30]!.familyId] }
      expect((await run(emptySave('hb_7Q3m9Kx2Vw5rT8pL', claim))).length).toBe(12)
      const second = await personWithHistory(sc, 2) // (the first person's later session is in the server's rows now: all 12 groups)
      expect((await run({ ...second.save, ...claim })).length).toBe(10)
    } finally {
      await sc.db.close()
    }
  })

  it('also excludes the other items of the family of an item the server served this person', async () => {
    const a = customItem(1, 'QR', {})
    const sibling = { ...customItem(2, 'QR', {}), familyId: a.familyId, siblingGroup: a.siblingGroup } // a second item of the same family
    const other = customItem(3, 'QR', {})
    const sc = await scenario([a, other], { 'selection.coverage_floor': 0 })
    try {
      await sc.db.owner.query(
        `insert into public.items (item_id, family_id, item_type, payload, time_limit_s, status, verification, provenance) values ($1, $2, 'mc', '{"stem": "x y z", "options": ["A","B","C","D","E"]}', 180, 'live', '{}', '{}')`,
        [sibling.itemId, a.familyId],
      )
      await sc.db.owner.query(`insert into public.item_keys (item_id, key) values ($1, '{"index": 0}')`, [sibling.itemId])
      await sc.db.owner.query(`insert into public.item_parameters (item_id, param_version, model, a, b, extra) values ($1, 'p-test', '2pl', 1, 0, '{}')`, [sibling.itemId])
      const person = await personWithHistory(sc, 1)
      const seenFamily = person.served[0]!.familyId
      const s = await start(sc, person.save)
      const ids = (await pool(sc, s.session_id)).map((p) => p.id)
      // three items in two families; the family of what they were served is out, whichever of its items that was, and one item of the other is left
      expect(ids.length).toBe(1)
      const { rows } = await sc.db.owner.query<{ family_id: string }>(`select family_id from public.items where item_id = $1`, [ids[0]])
      expect(rows[0]!.family_id).not.toBe(seenFamily)
    } finally {
      await sc.db.close()
    }
  })
})

// ----------------------------------------------------------------------- coverage floor, stop, axes
describe('coverage floor, per-axis stop and the segment\'s axes (§7.4, A15)', () => {
  const bank = (): FixtureItem[] => {
    const items: FixtureItem[] = []
    let n = 0
    for (const [axis, t] of [['QR', 10], ['MAT', 60], ['KST', 60]] as const) {
      for (let k = 0; k < 30; k++) {
        n++
        items.push(customItem(n, axis, { b: -1.2 + 0.08 * k, a: 1.2, expectedTimeS: t }))
      }
    }
    return items
  }

  it('gives every axis its first 3 items before the criterion alone decides (the cheap axis would take them all)', async () => {
    const run = async (floor: number): Promise<Map<string, number>> => {
      const sc = await scenario(bank(), { 'selection.coverage_floor': floor, 'selection.pretest_share': 0 })
      try {
        const s = await start(sc)
        const counts = new Map<string, number>()
        let n = await nextOf(sc, s)
        for (let i = 0; i < 9 && isServed(n); i++) {
          const axis = sc.bank.get(n.item.item_id)!.axis
          counts.set(axis, (counts.get(axis) ?? 0) + 1)
          n = await answer(sc, s, n, i % 2 === 0)
        }
        return counts
      } finally {
        await sc.db.close()
      }
    }
    const withFloor = await run(3)
    expect([...withFloor.entries()].sort()).toEqual([['KST', 3], ['MAT', 3], ['QR', 3]])
    const without = await run(0)
    expect(without.get('QR')).toBeGreaterThanOrEqual(7) // E[T] 10 s against 60 s: the criterion alone serves QR
  })

  it('counts the items the server served in the person\'s earlier sessions toward the floor, and not what a file says', async () => {
    const sc = await scenario(bank(), { 'selection.coverage_floor': 3, 'selection.pretest_share': 0, 'selection.top_k': 200 })
    try {
      const person = await personWithHistory(sc, 3, ['MAT'])
      expect(person.served.map((i) => i.axis)).toEqual(['MAT', 'MAT', 'MAT'])
      // MAT has its 3: the floor applies to KST and QR only
      const s = await start(sc, person.save)
      const axes = new Set((await pool(sc, s.session_id)).map((p) => p.axis))
      expect([...axes].sort()).toEqual(['KST', 'QR'])
      // a file that lists three MAT items it never had from this server does not move the floor
      const seenMat = sc.items.filter((i) => i.axis === 'MAT').slice(0, 3).map((i) => i.itemId)
      const claimed = await start(sc, emptySave('hb_7Q3m9Kx2Vw5rT8pL', { seen_items: seenMat }))
      expect([...new Set((await pool(sc, claimed.session_id)).map((p) => p.axis))].sort()).toEqual(['KST', 'MAT', 'QR'])
    } finally {
      await sc.db.close()
    }
  })

  it('stops an axis once its posterior sd is below selection.stop_sd, and says axes_done when every allowed axis is', async () => {
    const sc = await scenario(bank(), { 'selection.coverage_floor': 0, 'selection.pretest_share': 0, 'selection.stop_sd': 0.7 })
    try {
      const s = await start(sc)
      const obs: Observation[] = []
      let n = await nextOf(sc, s, ['QR'])
      let sdAfter = 1
      while (isServed(n)) {
        const it = sc.bank.get(n.item.item_id)!
        expect(sdAfter, 'an item is served only while the axis is open').toBeGreaterThanOrEqual(0.7)
        const right = obs.length % 2 === 0
        obs.push({ kind: '2pl', axis: 'QR', a: it.a, b: it.b, y: right ? 1 : 0 })
        sdAfter = eapAxis(obs, 0, 1).sd
        n = await answer(sc, s, n, right, ['QR'])
      }
      expect(n).toEqual({ done: true, reason: 'axes_done' })
      expect(sdAfter).toBeLessThan(0.7)
      expect(obs.length).toBeGreaterThan(2)
      // another axis is still open
      expect(isServed(await nextOf(sc, s, ['MAT']))).toBe(true)
      // with no restriction, MAT and KST are open too
      expect(isServed(await nextOf(sc, s))).toBe(true)
    } finally {
      await sc.db.close()
    }
  })

  it('restricts to the axes of the call (the client\'s current segment), sorted and without repeats; nothing else is accepted', async () => {
    const sc = await scenario(bank(), { 'selection.coverage_floor': 0, 'selection.pretest_share': 0 })
    try {
      const s = await start(sc)
      let n = await nextOf(sc, s, ['KST', 'MAT', 'MAT'])
      const axes: string[] = []
      for (let i = 0; i < 12 && isServed(n); i++) {
        axes.push(sc.bank.get(n.item.item_id)!.axis)
        n = await answer(sc, s, n, i % 2 === 0, ['MAT', 'KST'])
      }
      expect(new Set(axes)).toEqual(new Set(['MAT', 'KST']))
      const bad = async (value: unknown): Promise<string | undefined> => {
        try {
          await sc.db.rpc(from(s.ip), 'next_item', { p_token: s.token, p_axes: value })
        } catch (e) {
          return `${pgCode(e)} ${(e as Error).message}`
        }
        return undefined
      }
      expect(await bad([])).toBe('PT400 invalid_axes')
      expect(await bad(['QR', 'XYZ'])).toBe('PT400 invalid_axes')
      expect(await bad(['qr'])).toBe('PT400 invalid_axes')
      // an axis with no item left in the bank for the session: the bank has nothing for it
      const sc2 = await scenario([customItem(1, 'QR', {})], { 'selection.coverage_floor': 0 })
      try {
        const t = await start(sc2)
        expect(await nextOf(sc2, t, ['MAT'])).toEqual({ done: true, reason: 'no_items' })
      } finally {
        await sc2.db.close()
      }
    } finally {
      await sc.db.close()
    }
  })
})

// ------------------------------------------------------------------------------ content balancing
describe('content balancing over the generator families of an axis (the app\'s balanceFamilies)', () => {
  it('alternates the families of MAT although the criterion prefers the cheaper one, and does not let a missing family block the other', async () => {
    const items: FixtureItem[] = []
    let n = 0
    for (let k = 0; k < 30; k++) items.push(customItem(++n, 'MAT', { generator: 'matrices', expectedTimeS: 60, b: -1 + 0.07 * k }))
    for (let k = 0; k < 30; k++) items.push(customItem(++n, 'MAT', { generator: 'series', expectedTimeS: 25, b: -1 + 0.07 * k }))
    const sc = await scenario(items, { 'selection.coverage_floor': 0, 'selection.pretest_share': 0 })
    try {
      const s = await start(sc)
      const seq: string[] = []
      let next = await nextOf(sc, s)
      for (let i = 0; i < 20 && isServed(next); i++) {
        seq.push(sc.bank.get(next.item.item_id)!.generator!)
        next = await answer(sc, s, next, i % 2 === 0)
        const m = seq.filter((g) => g === 'matrices').length
        expect(Math.abs(m - (seq.length - m)), `after ${seq.length} items: ${seq.join(',')}`).toBeLessThanOrEqual(1)
      }
      expect(seq.length).toBe(20)
    } finally {
      await sc.db.close()
    }
    // matrices run out: series carry on
    const few = [...items.filter((i) => i.generator === 'matrices').slice(0, 2), ...items.filter((i) => i.generator === 'series')]
    const sc2 = await scenario(few, { 'selection.coverage_floor': 0, 'selection.pretest_share': 0 })
    try {
      const s = await start(sc2)
      const seq: string[] = []
      let next = await nextOf(sc2, s)
      for (let i = 0; i < 12 && isServed(next); i++) {
        seq.push(sc2.bank.get(next.item.item_id)!.generator!)
        next = await answer(sc2, s, next, i % 2 === 0)
      }
      expect(seq.length).toBe(12)
      expect(seq.filter((g) => g === 'matrices').length).toBe(2)
    } finally {
      await sc2.db.close()
    }
  })

  it('balances per axis: each axis has its own count', async () => {
    const items: FixtureItem[] = []
    let n = 0
    for (const axis of ['MAT', 'QR'] as const) {
      for (let k = 0; k < 20; k++) items.push(customItem(++n, axis, { generator: `${axis}-a`, expectedTimeS: 20, b: -0.8 + 0.08 * k }))
      for (let k = 0; k < 20; k++) items.push(customItem(++n, axis, { generator: `${axis}-b`, expectedTimeS: 50, b: -0.8 + 0.08 * k }))
    }
    const sc = await scenario(items, { 'selection.coverage_floor': 0, 'selection.pretest_share': 0 })
    try {
      const s = await start(sc)
      const seen = new Map<string, number>()
      let next = await nextOf(sc, s)
      for (let i = 0; i < 24 && isServed(next); i++) {
        const it = sc.bank.get(next.item.item_id)!
        seen.set(it.generator!, (seen.get(it.generator!) ?? 0) + 1)
        next = await answer(sc, s, next, i % 2 === 0)
      }
      for (const axis of ['MAT', 'QR']) expect(Math.abs((seen.get(`${axis}-a`) ?? 0) - (seen.get(`${axis}-b`) ?? 0)), axis).toBeLessThanOrEqual(1)
    } finally {
      await sc.db.close()
    }
  })
})

// ------------------------------------------------------------------------------------ pretest slots
describe('pretest slots (DESIGN §6.iii: at most 10% of a session, Thompson sampling on b)', () => {
  const bank = (): FixtureItem[] => {
    const items: FixtureItem[] = []
    let n = 0
    for (let k = 0; k < 120; k++) items.push(customItem(++n, k % 2 === 0 ? 'QR' : 'MAT', { b: -1.6 + 0.027 * k, a: 1.1, expectedTimeS: 30 }))
    for (let k = 0; k < 40; k++) items.push(customItem(++n, k % 2 === 0 ? 'QR' : 'MAT', { b: -1 + 0.05 * k, a: 1, expectedTimeS: 30, status: 'pretest', seB: 0.6 }))
    return items
  }

  /** The kinds of the items a session was served, in order. */
  const kinds = async (sc: Scenario, sessionId: string): Promise<boolean[]> =>
    (await sc.db.owner.query<{ pretest: boolean }>(`select pretest from public.exposure_log where session_id = $1 order by seq`, [sessionId])).rows.map((r) => r.pretest)

  it('reserves at most a tenth of the slots, never one of the first nine, at the default settings', async () => {
    const sc = await scenario(bank(), { 'selection.coverage_floor': 0, 'selection.exposure_cap': 1000, 'selection.stop_sd': 0 })
    try {
      let total = 0
      let pre = 0
      for (let r = 0; r < 4; r++) {
        const s = await start(sc)
        let next = await nextOf(sc, s)
        for (let i = 0; i < 100 && isServed(next); i++) next = await answer(sc, s, next, i % 3 !== 0)
        const k = await kinds(sc, s.session_id)
        expect(k.length).toBeGreaterThanOrEqual(100)
        for (let n = 1; n <= k.length; n++) {
          const so = k.slice(0, n).filter(Boolean).length
          expect(so, `session ${r}, after ${n} items`).toBeLessThanOrEqual(0.1 * n + 1e-9)
        }
        expect(k.slice(0, 9).some(Boolean)).toBe(false)
        total += k.length
        pre += k.filter(Boolean).length
      }
      // close to the cap, not far under it (a slot opens every ten items and is taken half the time)
      expect(pre / total).toBeGreaterThan(0.05)
      expect(pre / total).toBeLessThanOrEqual(0.1 + 1e-9)
    } finally {
      await sc.db.close()
    }
  })

  it('with the slot taken whenever it opens, the pretest items sit exactly at slots 10, 20, 30...', async () => {
    const sc = await scenario(bank(), { 'selection.coverage_floor': 0, 'selection.exposure_cap': 1000, 'selection.pretest_prob': 1 })
    try {
      const s = await start(sc)
      let next = await nextOf(sc, s)
      for (let i = 0; i < 59 && isServed(next); i++) next = await answer(sc, s, next, i % 3 !== 0)
      const k = await kinds(sc, s.session_id)
      const slots = k.map((p, i) => (p ? i + 1 : 0)).filter((x) => x > 0)
      expect(slots).toEqual([10, 20, 30, 40, 50, 60])
    } finally {
      await sc.db.close()
    }
  })

  it('serves no pretest item when the share is 0, and never a pretest item as a live one', async () => {
    const sc = await scenario(bank(), { 'selection.coverage_floor': 0, 'selection.exposure_cap': 1000, 'selection.pretest_share': 0 })
    try {
      const s = await start(sc)
      let next = await nextOf(sc, s)
      for (let i = 0; i < 40 && isServed(next); i++) next = await answer(sc, s, next, true)
      expect((await kinds(sc, s.session_id)).some(Boolean)).toBe(false)
      const live = await sc.db.owner.query<{ n: number }>(`select count(*)::int n from public.exposure_log e join public.items i using (item_id) where e.session_id = $1 and i.status <> 'live'`, [s.session_id])
      expect(live.rows[0]!.n).toBe(0)
    } finally {
      await sc.db.close()
    }
  })

  it('stores a pretest answer as pretest, keeps it out of the session\'s EAP, and shows the client nothing that tells it apart', async () => {
    const sc = await scenario(bank(), { 'selection.coverage_floor': 0, 'selection.exposure_cap': 1000, 'selection.pretest_prob': 1 })
    try {
      const s = await start(sc)
      const shapes = new Set<string>()
      let next = await nextOf(sc, s)
      for (let i = 0; i < 30 && isServed(next); i++) {
        shapes.add(Object.keys(next.item).sort().join(','))
        next = await answer(sc, s, next, i % 2 === 0)
      }
      expect(shapes.size).toBe(1)
      const { rows } = await sc.db.owner.query<{ pretest: boolean; n: number }>(`select pretest, count(*)::int n from public.responses where session_id = $1 group by 1 order by 1`, [s.session_id])
      expect(rows).toEqual([{ pretest: false, n: 27 }, { pretest: true, n: 3 }])
      const st = await sc.db.owner.query<{ n: number }>(`select coalesce(sum((e.value ->> 'n')::int), 0)::int as n from public.sessions s, jsonb_each(s.state -> 'eap') e where s.session_id = $1`, [s.session_id])
      expect(st.rows[0]!.n).toBe(27)
    } finally {
      await sc.db.close()
    }
  })

  it('chooses by Thompson sampling on the information about b: uncertain items near the session\'s theta win, certain or far ones almost never', async () => {
    const mk = (n: number, b: number, seB: number | null): FixtureItem => customItem(n, 'QR', { b, a: 1.2, status: 'pretest', seB })
    const items = [mk(1, 0, 0.05), mk(2, 0, 1), mk(3, 3.5, 0.05), mk(4, 1, 1), mk(5, 0.5, 0.3), mk(6, 0.5, 1)]
    const sc = await scenario(items, { 'selection.coverage_floor': 0 })
    try {
      const s = await start(sc)
      const counts = new Map<string, number>()
      const draws = 800
      for (let i = 0; i < draws; i++) {
        const { rows } = await sc.db.owner.query<{ id: string }>(`select hb.thompson_pick((select s from public.sessions s where s.session_id = $1), null, null) as id`, [s.session_id])
        counts.set(rows[0]!.id, (counts.get(rows[0]!.id) ?? 0) + 1)
      }
      const c = (n: number): number => counts.get(items[n - 1]!.itemId) ?? 0
      // the item that is far from theta with a firm b is hardly ever worth a slot; the sure one at theta neither
      expect(c(3)).toBeLessThan(draws * 0.02)
      expect(c(1)).toBeLessThan(draws * 0.05)
      // at the same b, the less certain wins more often than the more certain
      expect(c(6)).toBeGreaterThan(c(5))
      // and it is a sample, not an argmax: the second-best is chosen sometimes
      expect(c(2)).toBeGreaterThan(draws * 0.1)
      expect(c(4)).toBeGreaterThan(draws * 0.1)
      expect(c(2) + c(4) + c(6)).toBeGreaterThan(draws * 0.85)
    } finally {
      await sc.db.close()
    }
  })

  it('uses the selection.pretest_default_se_b (1) for an item without an se_b', async () => {
    const items = [customItem(1, 'QR', { status: 'pretest', seB: null, b: 0 }), customItem(2, 'QR', { status: 'pretest', seB: 0.02, b: 0 })]
    const sc = await scenario(items, { 'selection.coverage_floor': 0 })
    try {
      const s = await start(sc)
      let n1 = 0
      for (let i = 0; i < 200; i++) {
        const { rows } = await sc.db.owner.query<{ id: string }>(`select hb.thompson_pick((select s from public.sessions s where s.session_id = $1), null, null) as id`, [s.session_id])
        if (rows[0]!.id === items[0]!.itemId) n1++
      }
      expect(n1).toBeGreaterThan(190)
    } finally {
      await sc.db.close()
    }
  })

  it('keeps pretest items out of an axis that is not allowed or is done', async () => {
    const sc = await scenario(bank(), { 'selection.coverage_floor': 0, 'selection.exposure_cap': 1000, 'selection.pretest_prob': 1 })
    try {
      const s = await start(sc)
      let next = await nextOf(sc, s, ['QR'])
      for (let i = 0; i < 40 && isServed(next); i++) next = await answer(sc, s, next, i % 2 === 0, ['QR'])
      const rows = await sc.db.owner.query<{ axis: string; pretest: boolean }>(`select f.axis, e.pretest from public.exposure_log e join public.item_families f using (family_id) where e.session_id = $1`, [s.session_id])
      expect(new Set(rows.rows.map((r) => r.axis))).toEqual(new Set(['QR']))
      expect(rows.rows.some((r) => r.pretest)).toBe(true)
    } finally {
      await sc.db.close()
    }
  })
})

// ------------------------------------------------------------------------------------------ misc
describe('the reasons a session is done', () => {
  it('item_limit at max_items, no_items when the bank has nothing for the session, axes_done when every allowed axis is done', async () => {
    const items = Array.from({ length: 6 }, (_, k) => customItem(k + 1, 'QR', { b: 0.1 * k }))
    const sc = await scenario(items, { 'selection.coverage_floor': 0, 'selection.pretest_share': 0, 'selection.exposure_cap': 1000, 'session.max_items': 3 })
    try {
      const s = await start(sc)
      let n = await nextOf(sc, s)
      for (let i = 0; i < 3; i++) n = await answer(sc, s, n as Served, true)
      expect(n).toEqual({ done: true, reason: 'item_limit' })
      await sc.db.owner.query(`update public.app_config set value = '200' where key = 'session.max_items'`)
      const t = await start(sc)
      let m = await nextOf(sc, t)
      let served = 0
      while (isServed(m)) {
        served++
        m = await answer(sc, t, m, true)
      }
      expect(served).toBe(6)
      expect(m).toEqual({ done: true, reason: 'no_items' })
    } finally {
      await sc.db.close()
    }
  })
})

describe('speed', () => {
  it('picks from a bank of 5,000 live items in well under a second', async () => {
    const db = await openTestDb()
    try {
      // 5,000 procedural-looking items over 5 axes, written by SQL (a fixture of this size through the loader is slow)
      await db.owner.query(`
        insert into public.item_families (family_id, sibling_group, axis, facet, generator, gold_tier, source, license, created_by)
        select 'f:tst:' || lpad(to_hex(g), 12, '0'), 'f:tst:' || lpad(to_hex(g), 12, '0'),
               (array['MAT','QR','SPA','VOC','KST'])[1 + g % 5], 'f' || (g % 3), (array['gen_a','gen_b'])[1 + g % 2], 'a', '{"type":"procedural","family":"t"}'::jsonb, 'CC0', 'test'
          from generate_series(1, 5000) g`)
      await db.owner.query(`
        insert into public.items (item_id, family_id, item_type, payload, time_limit_s, status, verification, provenance)
        select 'i:tst:big:' || lpad(g::text, 6, '0'), 'f:tst:' || lpad(to_hex(g), 12, '0'), 'mc',
               jsonb_build_object('stem', 'Test item ' || g, 'options', jsonb_build_array('A','B','C','D','E')), 180, 'live', '{}', '{}'
          from generate_series(1, 5000) g`)
      await db.owner.query(`insert into public.item_keys (item_id, key) select item_id, '{"index": 1}' from public.items`)
      await db.owner.query(`
        insert into public.item_parameters (item_id, param_version, model, a, b, c, extra, n_resp)
        select 'i:tst:big:' || lpad(g::text, 6, '0'), 'p-test', case when g % 3 = 0 then '3pl' else '2pl' end, 0.7 + (g % 17) * 0.06, -2.5 + (g % 101) * 0.05,
               case when g % 3 = 0 then 0.25 end, jsonb_build_object('expected_time_s', 20 + g % 40), 0
          from generate_series(1, 5000) g`)
      const ip = freshIp()
      const s = await startSession(db, ip)
      const times: number[] = []
      let next = (await db.rpc<Next>(from(ip), 'next_item', { p_token: s.token })) as Served
      for (let i = 0; i < 8; i++) {
        await ageExposures(db, s.session_id, 20)
        const t0 = performance.now()
        const out = await db.rpc<{ next: Next }>(from(ip), 'submit', { p_token: s.token, p_item_id: next.item.item_id, p_response: i % 5, p_rt_ms: 5000 })
        times.push(performance.now() - t0)
        next = out.next as Served
      }
      times.sort((x, y) => x - y)
      expect(times[Math.floor(times.length / 2)]).toBeLessThan(1000)
      expect(isServed(next)).toBe(true)
    } finally {
      await db.close()
    }
  })
})
