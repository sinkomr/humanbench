/**
 * The start-up of the server's item selection and where its items are aimed
 * (`supabase/migrations/20261014000100_startup_step.sql`; owner feedback 2026-10-13; DESIGN §6.iii, §7.4, §11.2,
 * R-11.1; ROADMAP M2.2, A24-sec). The rule is the app's (`src/engine/startup.ts`): this file plays answer
 * sequences against the real database and holds `hb.startup_targets`, `hb.session_aims` and what `hb.rank_live`
 * lets compete to the TypeScript rule on the same sequences.
 *
 * Every item here is made up at run time (`customItem`, `passageItems`); the keys are positions the fixture
 * chose. Each describe has a database of its own.
 */

import fc from 'fast-check'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SELECTION_TIME_EXPONENT, selectionAim, sessionPosterior } from '../../src/engine/selector'
import { SELECTION_PRIOR_SD_FACTOR, STARTUP_MAX, STARTUP_MIN, STARTUP_STEP, STARTUP_WINDOW, startupCompetes, startupTarget, type StartupUnit } from '../../src/engine/startup'
import type { Observation } from '../../src/engine/types'
import { customItem, loadFixtureBank, passageItems, type FixtureItem } from './bank-fixture'
import type { TestDb } from './harness'
import { ageExposures, from, isServed, startSession, type Next, type Served, type Started } from './rpc-support'
import { openTestDb } from './vitest'

let ipCounter = 0
const freshIp = (): string => {
  const n = ++ipCounter
  return `198.18.${Math.floor(n / 250)}.${(n % 250) + 1}`
}

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

async function start(sc: Scenario): Promise<Session> {
  const ip = freshIp()
  return { ...(await startSession(sc.db, ip)), ip }
}

const nextOf = (sc: Scenario, s: Session, axes: readonly string[]): Promise<Next> => sc.db.rpc<Next>(from(s.ip), 'next_item', { p_token: s.token, p_axes: [...axes] })

async function submit(sc: Scenario, s: Session, served: Served, response: unknown, axes: readonly string[], next = true): Promise<Next> {
  await ageExposures(sc.db, s.session_id, 20)
  const out = await sc.db.rpc<{ ack: boolean; seq: number; next?: Next }>(from(s.ip), 'submit', { p_token: s.token, p_item_id: served.item.item_id, p_response: response, p_rt_ms: 5000, p_axes: [...axes], ...(next ? {} : { p_next: false }) })
  return out.next ?? { done: true, reason: 'not_asked' }
}

const itemOf = (sc: Scenario, served: Served): FixtureItem => sc.bank.get(served.item.item_id)!
const right = (sc: Scenario, served: Served): number => itemOf(sc, served).key.index as number
const wrong = (sc: Scenario, served: Served): number => (right(sc, served) + 1) % itemOf(sc, served).nOptions

/** What the server says the start-up target of each axis is. */
async function targets(sc: Scenario, sessionId: string): Promise<Record<string, number>> {
  const { rows } = await sc.db.owner.query<{ axis: string; target: number }>(`select * from hb.startup_targets((select s from public.sessions s where s.session_id = $1))`, [sessionId])
  return Object.fromEntries(rows.map((r) => [r.axis, Number(r.target)]))
}

/** Where the server aims each axis's items. */
async function aims(sc: Scenario, sessionId: string): Promise<Record<string, number>> {
  const { rows } = await sc.db.owner.query<{ axis: string; aim: number }>(`select a.* from hb.session_aims((select s.state from public.sessions s where s.session_id = $1)) a`, [sessionId])
  return Object.fromEntries(rows.map((r) => [r.axis, Number(r.aim)]))
}

/** The ranked pool of the session's next live slot, straight from hb.rank_live. */
async function pool(sc: Scenario, sessionId: string, axes: readonly string[]): Promise<{ id: string; b: number; score: number; info: number }[]> {
  const { rows } = await sc.db.owner.query<{ o_item_id: string; o_score: number; o_info: number }>(
    `select * from hb.rank_live((select s from public.sessions s where s.session_id = $1), $2::text[], null) order by o_rank`,
    [sessionId, [...axes]],
  )
  return rows.map((r) => ({ id: r.o_item_id, b: sc.bank.get(r.o_item_id)!.b, score: Number(r.o_score), info: Number(r.o_info) }))
}

/** A pool in the shape of a live text bank: `per` items at each stratum centre b = −2 … 3, a = 1, five options (2PL). */
function strataPool(axis: 'VOC' | 'KST', per: number, base: number): FixtureItem[] {
  const out: FixtureItem[] = []
  for (let s = 0; s < 6; s++) for (let i = 0; i < per; i++) out.push(customItem(base + s * 100 + i, axis, { b: s - 2 }))
  return out
}

/**
 * Plays `answers` (true: right, false: wrong, null: left to run out of time) on `axis`; the items served and the b
 * of each. Nothing is asked for after the last answer, so no item is left pending for the next part.
 */
async function play(sc: Scenario, s: Session, axis: string, answers: readonly (boolean | null)[]): Promise<{ served: Served[]; bs: number[] }> {
  const served: Served[] = []
  let next = await nextOf(sc, s, [axis])
  for (let i = 0; i < answers.length; i++) {
    if (!isServed(next)) break
    served.push(next)
    const a = answers[i]!
    next = await submit(sc, s, next, a === null ? null : a ? right(sc, next) : wrong(sc, next), [axis], i + 1 < answers.length)
  }
  return { served, bs: served.map((q) => itemOf(sc, q).b) }
}

const KEYISH = /(key|answer|correct|solution|rationale|toler|option_weights|verdict|target|aim|param)/i
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

// ------------------------------------------------------------------------------------ the steps
describe('the start-up: one stratum up after each correct answer, down after each miss, until the first reversal', () => {
  let sc: Scenario
  beforeAll(async () => {
    sc = await scenario([...strataPool('VOC', 12, 1000), ...strataPool('KST', 12, 5000)])
  })
  afterAll(async () => {
    await sc.db.close()
  })

  it('has the settings of the app’s rule', async () => {
    const { rows } = await sc.db.owner.query<{ key: string; value: unknown }>(`select key, value from public.app_config where key like 'selection.startup%' or key = 'selection.aim_prior_sd_factor' order by key`)
    expect(Object.fromEntries(rows.map((r) => [r.key, Number(r.value)]))).toEqual({
      'selection.aim_prior_sd_factor': SELECTION_PRIOR_SD_FACTOR,
      'selection.startup_max': STARTUP_MAX,
      'selection.startup_min': STARTUP_MIN,
      'selection.startup_step': STARTUP_STEP,
      'selection.startup_window': STARTUP_WINDOW,
    })
  })

  it('a perfect record climbs a stratum a question to the top of the pool and stays there (before: 0, 0, then +1 at the earliest)', async () => {
    const s = await start(sc)
    expect(await targets(sc, s.session_id)).toEqual({})
    const { bs } = await play(sc, s, 'VOC', new Array<boolean>(8).fill(true))
    expect(bs).toEqual([0, 1, 2, 3, 3, 3, 3, 3])
    // the target is clamped; with nothing there the nearest items compete
    expect((await targets(sc, s.session_id)).VOC).toBe(STARTUP_MAX)
  })

  it('a record of misses steps down as quickly', async () => {
    const s = await start(sc)
    const { bs } = await play(sc, s, 'VOC', new Array<boolean>(5).fill(false))
    expect(bs).toEqual([0, -1, -2, -2, -2])
    expect((await targets(sc, s.session_id)).VOC).toBe(-3)
  })

  it('is over at the first reversal, for good: no target, and the criterion decides at the aim', async () => {
    const s = await start(sc)
    const { bs } = await play(sc, s, 'VOC', [true, true, false])
    expect(bs).toEqual([0, 1, 2])
    expect(await targets(sc, s.session_id)).toEqual({})
    // more correct answers do not bring it back
    await play(sc, s, 'VOC', [true, true, true])
    expect(await targets(sc, s.session_id)).toEqual({})
  })

  it('a question that ran out of time is not an answer: it neither steps nor reverses', async () => {
    const s = await start(sc)
    const { bs } = await play(sc, s, 'VOC', [true, null, null, true])
    // 0 right → aimed at 1; the two that ran out of time leave the target where it was; then right at 1 → 2
    expect(bs).toEqual([0, 1, 1, 1])
    expect((await targets(sc, s.session_id)).VOC).toBe(2)
  })

  it('each skill has its own start-up: answers on another skill neither start nor end it', async () => {
    const s = await start(sc)
    await play(sc, s, 'VOC', [true, true])
    expect(await targets(sc, s.session_id)).toEqual({ VOC: 2 })
    const kst = await play(sc, s, 'KST', [false])
    // the first question of a part is chosen by the criterion at the aim, which since 2026-10-15 borrows from the other
    // skills (xskill.ts): after two right on VOC, a stratum up; it is not a start-up step (no KST answer yet)
    expect(kst.bs).toEqual([Math.round(selectionAim([0, 1].map((b): Observation => ({ kind: '2pl', axis: 'VOC', a: 1, b, y: 1 }))).KST!)])
    expect(kst.bs).toEqual([1])
    expect(await targets(sc, s.session_id)).toEqual({ KST: kst.bs[0]! - 1, VOC: 2 })
    const voc = await play(sc, s, 'VOC', [true])
    expect(voc.bs).toEqual([2])
  })

  it('puts nothing new in a reply: an item and its sequence number, and no key, verdict, target or parameter', async () => {
    const s = await start(sc)
    let next = await nextOf(sc, s, ['VOC'])
    for (let i = 0; i < 4; i++) {
      expect(isServed(next)).toBe(true)
      expect(Object.keys(next).sort()).toEqual(['item', 'seq'])
      expect(keysIn(next).filter((k) => KEYISH.test(k))).toEqual([])
      next = await submit(sc, s, next as Served, right(sc, next as Served), ['VOC'])
    }
  })

  it('agrees with the app’s rule on random records: the target, the aim, and what competes (fast-check)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom(true, false, null), { minLength: 1, maxLength: 7 }), async (answers) => {
        const s = await start(sc)
        const units: StartupUnit[] = []
        const obs: Observation[] = []
        const seen = new Set<string>()
        let next = await nextOf(sc, s, ['VOC'])
        for (const a of answers) {
          if (!isServed(next)) throw new Error('the pool ran out')
          const item = itemOf(sc, next)
          // what competed for this slot is what the app's rule lets compete, of the items the session has not seen
          const target = startupTarget(units)
          expect((await targets(sc, s.session_id)).VOC ?? null).toBe(target)
          const open = [...sc.bank.values()].filter((i) => i.axis === 'VOC' && !seen.has(i.itemId))
          if (target !== null) {
            const keep = startupCompetes(open.map((i) => i.b), target)
            const allowed = new Set(open.filter((_, k) => keep[k]).map((i) => i.b))
            expect(allowed.has(item.b), `b ${item.b} served for target ${target}`).toBe(true)
          }
          expect((await aims(sc, s.session_id)).VOC).toBeCloseTo(selectionAim(obs).VOC!, 6)
          seen.add(item.itemId)
          if (a !== null) {
            units.push({ b: item.b, correct: a ? 1 : 0, scored: 1 })
            obs.push({ kind: '2pl', axis: 'VOC', a: item.a, b: item.b, y: a ? 1 : 0 })
          }
          next = await submit(sc, s, next, a === null ? null : a ? right(sc, next) : wrong(sc, next), ['VOC'])
        }
        expect((await targets(sc, s.session_id)).VOC ?? null).toBe(startupTarget(units))
        expect((await aims(sc, s.session_id)).VOC).toBeCloseTo(selectionAim(obs).VOC!, 6)
      }),
      { numRuns: 12 },
    )
  }, 120_000)
})

// ---------------------------------------------------------------------------------------- the aim
describe('after the start-up the information of a candidate is evaluated at the aim, not at the posterior mean', () => {
  let sc: Scenario
  beforeAll(async () => {
    sc = await scenario(strataPool('VOC', 12, 1000))
  })
  afterAll(async () => {
    await sc.db.close()
  })

  it('a strong record after its reversal is served above its posterior mean, and the scores are those of the criterion at the aim', async () => {
    const s = await start(sc)
    await play(sc, s, 'VOC', [true, true, true, false, true, true])
    expect(await targets(sc, s.session_id)).toEqual({})
    const { rows } = await sc.db.owner.query<{ mean: number; sd: number }>(`select p.mean, p.sd from hb.session_posteriors((select s.state from public.sessions s where s.session_id = $1)) p where p.axis = 'VOC'`, [s.session_id])
    const mean = Number(rows[0]!.mean)
    const sd = Number(rows[0]!.sd)
    const aim = (await aims(sc, s.session_id)).VOC!
    expect(aim).toBeGreaterThan(mean + 0.3)
    const ranked = await pool(sc, s.session_id, ['VOC'])
    expect(ranked.length).toBeGreaterThan(0)
    // information a²PQ at the aim; score = information × posterior variance / E[T]^p (the variance is the scoring posterior's)
    const pq = (b: number): number => {
      const p = 1 / (1 + Math.exp(-(aim - b)))
      return p * (1 - p)
    }
    for (const r of ranked) expect(r.info).toBeCloseTo(pq(r.b), 9)
    const ratio = ranked[0]!.score / ranked[0]!.info
    for (const r of ranked) expect(r.score / r.info).toBeCloseTo(ratio, 9)
    // ... and that variance is the scoring posterior's: the ratio is sd² / E[T]^p (p = selection.time_exponent, 0: information alone)
    const et = Number((await sc.db.owner.query<{ t: number }>(`select hb.item_expected_time_s(p.extra, i.payload) as t from public.items i join public.item_parameters p using (item_id) where i.item_id = $1`, [ranked[0]!.id])).rows[0]!.t)
    expect(ratio).toBeCloseTo((sd * sd) / et ** SELECTION_TIME_EXPONENT, 9)
    // the best candidates are at the stratum nearest the aim
    const nearest = [...new Set([...sc.bank.values()].map((i) => i.b))].sort((x, y) => Math.abs(x - aim) - Math.abs(y - aim))[0]
    expect(ranked[0]!.b).toBe(nearest)
  })

  it('an axis without a scored answer is aimed at its prior mean', async () => {
    const s = await start(sc)
    const a = await aims(sc, s.session_id)
    expect(a.VOC).toBe(0)
    expect(a.MAT).toBe(0)
    expect(Object.keys(a)).toHaveLength(17)
  })
})

// ------------------------------------------------------------------ exposure and exclusions still hold
describe('the start-up works on the candidates the session may be served: the exposure cap and the exclusions come first', () => {
  let sc: Scenario
  const items = strataPool('VOC', 6, 1000)
  beforeAll(async () => {
    sc = await scenario(items)
    // every item of stratum b = 1 is at the exposure cap
    const capped = items.filter((i) => i.b === 1).map((i) => i.itemId)
    await sc.db.owner.query(`insert into public.item_exposure (item_id, n_sessions) select x, 1000000 from unnest($1::text[]) x on conflict (item_id) do update set n_sessions = 1000000`, [capped])
  })
  afterAll(async () => {
    await sc.db.close()
  })

  it('never serves an item at the cap to reach the target: with the stratum aimed at closed, the nearest open ones compete', async () => {
    const s = await start(sc)
    const { bs } = await play(sc, s, 'VOC', [true, true, true])
    // 0 right → aimed at 1, which is closed: the nearest open strata are 0 and 2; then on up
    expect(bs[0]).toBe(0)
    expect([0, 2]).toContain(bs[1])
    expect(bs).not.toContain(1)
    expect(bs[2]).toBeGreaterThanOrEqual(bs[1]!)
  })

  it('never serves an item twice in a session, however long the record', async () => {
    const s = await start(sc)
    const { served } = await play(sc, s, 'VOC', new Array<boolean>(14).fill(true))
    expect(new Set(served.map((q) => q.item.item_id)).size).toBe(served.length)
    expect(served.length).toBe(14)
  })
})

// ------------------------------------------------------------------------------------------ sets
describe('a passage is one unit of the start-up: entered at its mean difficulty, never interrupted', () => {
  let sc: Scenario
  // 36 made-up passages of three questions, six at each level: the questions of passage p at b = (p mod 6) − 2
  const passages = passageItems({ passages: 36, seed: 'startup', questions: () => 3 }).map((q): FixtureItem => {
    const p = Number(/-p(\d+)-q/u.exec(q.itemId)![1]) - 1
    return { ...q, a: 1, b: (p % 6) - 2 }
  })
  beforeAll(async () => {
    sc = await scenario(passages)
  })
  afterAll(async () => {
    await sc.db.close()
  })

  const passageOf = (q: Served): number => Number(/-p(\d+)-q/u.exec(q.item.item_id)![1])

  it('a passage answered all correctly is followed by one a stratum harder; every passage is served whole and in order', async () => {
    const s = await start(sc)
    const { served, bs } = await play(sc, s, 'RC', new Array<boolean>(9).fill(true))
    expect(bs).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2])
    expect(served.map((q) => /-q(\d)$/u.exec(q.item.item_id)![1])).toEqual(['1', '2', '3', '1', '2', '3', '1', '2', '3'])
    expect(new Set(served.map(passageOf)).size).toBe(3)
    expect((await targets(sc, s.session_id)).RC).toBe(3)
  })

  it('inside a passage nothing moves: a miss on its first question does not change the questions that follow', async () => {
    const s = await start(sc)
    const { bs } = await play(sc, s, 'RC', [false, true, true])
    expect(bs).toEqual([0, 0, 0])
    // two of three: a mixed passage is a reversal, so there is no target for the next one
    expect(await targets(sc, s.session_id)).toEqual({})
  })

  it('a passage with every question missed is followed by an easier one', async () => {
    const s = await start(sc)
    const { bs } = await play(sc, s, 'RC', [false, false, false, false])
    expect(bs).toEqual([0, 0, 0, -1])
  })

  it('an unanswered question inside a passage is left out: two right and one out of time still steps up', async () => {
    const s = await start(sc)
    const { bs } = await play(sc, s, 'RC', [true, null, true, true])
    expect(bs).toEqual([0, 0, 0, 1])
  })
})

// --------------------------------------------------------------------------------------- the switch
describe('switched off (step 0, factor 1) the selection is the one of before', () => {
  let sc: Scenario
  beforeAll(async () => {
    sc = await scenario(strataPool('VOC', 12, 1000), { 'selection.startup_step': 0, 'selection.aim_prior_sd_factor': 1 })
  })
  afterAll(async () => {
    await sc.db.close()
  })

  it('no target, the aim is the posterior mean, and a perfect record crawls as it did in the owner’s session', async () => {
    const s = await start(sc)
    const { bs } = await play(sc, s, 'VOC', new Array<boolean>(8).fill(true))
    expect(await targets(sc, s.session_id)).toEqual({})
    // 0, 0, then stratum 4 at the earliest, and after eight correct answers still about a stratum above the start
    expect(bs.slice(0, 2)).toEqual([0, 0])
    // (with the rule the same record is 0, 1, 2, 3: stratum 5 at the third question, 6 at the fourth)
    expect(Math.max(...bs.slice(0, 5))).toBeLessThanOrEqual(1)
    expect(Math.max(...bs)).toBeLessThanOrEqual(2)
    const obs: Observation[] = bs.map((b) => ({ kind: '2pl', axis: 'VOC', a: 1, b, y: 1 }))
    expect((await aims(sc, s.session_id)).VOC).toBeCloseTo(sessionPosterior(obs).VOC.mean, 6)
  })
})
