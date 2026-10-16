/**
 * The cross-skill start of a part on the server (`supabase/migrations/20261016000100_cross_skill_aim.sql`; owner request
 * 2026-10-15; DESIGN §7.4 "Cross-skill aim", §7.8, §11.2, R-11.1; ROADMAP M2.2, A24-sec). The aim is the app's
 * (`src/engine/xskill.ts`, `selector.ts` selectionAim): this file plays answers on several skills against the real
 * database and holds `hb.session_aims` to the TypeScript aim on the same answers, for one session and for a returning
 * person whose save proves their earlier session.
 *
 * Every item here is made up at run time (`customItem`); the keys are positions the fixture chose. Each describe has a
 * database of its own.
 */

import fc from 'fast-check'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AXIS_CODES, initialSigma } from '../../src/engine/axes'
import { selectionAim, sessionPosterior } from '../../src/engine/selector'
import type { Observation } from '../../src/engine/types'
import { XSKILL_BORROW, sessionEvidence } from '../../src/engine/xskill'
import { EARLIER_SESSIONS_MAX } from '../../src/session/earlier'
import { customItem, loadFixtureBank, type FixtureItem } from './bank-fixture'
import type { TestDb } from './harness'
import { ageExposures, emptySave, from, isServed, startSession, type Next, type Served, type Started } from './rpc-support'
import { openTestDb } from './vitest'

let ipCounter = 0
const freshIp = (): string => {
  const n = ++ipCounter
  return `198.19.${Math.floor(n / 250)}.${(n % 250) + 1}`
}

type Session = Started & { ip: string }
type Skill = 'VOC' | 'KST' | 'KHU' | 'LR'
const SKILLS: readonly Skill[] = ['VOC', 'KST', 'KHU', 'LR']

interface Scenario {
  db: TestDb
  bank: Map<string, FixtureItem>
}

/** `per` items at each stratum centre b = −2 … 3 on each skill, a = 1, five options (2PL). */
function pools(per: number): FixtureItem[] {
  const out: FixtureItem[] = []
  SKILLS.forEach((axis, k) => {
    for (let s = 0; s < 6; s++) for (let i = 0; i < per; i++) out.push(customItem(10000 * (k + 1) + s * 100 + i, axis, { b: s - 2 }))
  })
  return out
}

async function scenario(config: Readonly<Record<string, unknown>> = {}): Promise<Scenario> {
  const db = await openTestDb()
  const items = pools(10)
  await loadFixtureBank(db, items)
  await setConfig(db, config)
  return { db, bank: new Map(items.map((i) => [i.itemId, i])) }
}

async function setConfig(db: TestDb, config: Readonly<Record<string, unknown>>): Promise<void> {
  for (const [key, value] of Object.entries(config)) await db.owner.query(`update public.app_config set value = $2::jsonb where key = $1`, [key, JSON.stringify(value)])
}

async function start(sc: Scenario, save?: unknown): Promise<Session> {
  const ip = freshIp()
  return { ...(await startSession(sc.db, ip, save)), ip }
}

const nextOf = (sc: Scenario, s: Session, axes: readonly string[]): Promise<Next> => sc.db.rpc<Next>(from(s.ip), 'next_item', { p_token: s.token, p_axes: [...axes] })
const itemOf = (sc: Scenario, served: Served): FixtureItem => sc.bank.get(served.item.item_id)!

/** Plays `answers` on `axis` (nothing is asked for after the last one); the observations the app would make of them. */
async function play(sc: Scenario, s: Session, axis: Skill, answers: readonly boolean[]): Promise<{ obs: Observation[]; bs: number[] }> {
  const obs: Observation[] = []
  const bs: number[] = []
  let next = await nextOf(sc, s, [axis])
  for (let i = 0; i < answers.length; i++) {
    if (!isServed(next)) break
    const item = itemOf(sc, next)
    const right = answers[i]!
    bs.push(item.b)
    obs.push({ kind: '2pl', axis, a: item.a, b: item.b, y: right ? 1 : 0 })
    await ageExposures(sc.db, s.session_id, 20)
    const out = await sc.db.rpc<{ next?: Next }>(from(s.ip), 'submit', {
      p_token: s.token,
      p_item_id: next.item.item_id,
      p_response: right ? (item.key.index as number) : ((item.key.index as number) + 1) % item.nOptions,
      p_rt_ms: 5000,
      p_axes: [axis],
      ...(i + 1 < answers.length ? {} : { p_next: false }),
    })
    next = out.next ?? { done: true, reason: 'not_asked' }
  }
  return { obs, bs }
}

/** The first item the server would serve on `axis` now: its b (asked, then let go, so nothing stays pending). */
async function firstB(sc: Scenario, s: Session, axis: Skill): Promise<number> {
  const { rows } = await sc.db.owner.query<{ o_item_id: string }>(
    `select o_item_id from hb.rank_live((select s from public.sessions s where s.session_id = $1), $2::text[], null) order by o_rank`,
    [s.session_id, [axis]],
  )
  const bs = rows.map((r) => sc.bank.get(r.o_item_id)!.b)
  // every one of the randomesque top five is at the same stratum here (one discrimination, one time per skill)
  expect(new Set(bs).size).toBe(1)
  return bs[0]!
}

async function aims(sc: Scenario, sessionId: string): Promise<Record<string, number>> {
  const { rows } = await sc.db.owner.query<{ axis: string; aim: number }>(`select a.* from hb.session_aims((select s.state from public.sessions s where s.session_id = $1)) a`, [sessionId])
  return Object.fromEntries(rows.map((r) => [r.axis, Number(r.aim)]))
}

function expectAims(got: Record<string, number>, want: Partial<Record<string, number>>, digits = 6): void {
  expect(Object.keys(got)).toEqual([...AXIS_CODES])
  for (const k of AXIS_CODES) expect(got[k], k).toBeCloseTo(want[k]!, digits)
}

// ----------------------------------------------------------------------------------------- one session
describe('a part starts where the session’s other skills say it is', () => {
  let sc: Scenario
  beforeAll(async () => {
    sc = await scenario()
  })
  afterAll(async () => {
    await sc.db.close()
  })

  it('has the app’s settings', async () => {
    const { rows } = await sc.db.owner.query<{ key: string; value: unknown }>(`select key, value from public.app_config where key in ('selection.borrow_strength', 'selection.prior_sessions') order by key`)
    expect(Object.fromEntries(rows.map((r) => [r.key, Number(r.value)]))).toEqual({ 'selection.borrow_strength': XSKILL_BORROW, 'selection.prior_sessions': EARLIER_SESSIONS_MAX })
  })

  it('after a strong first part the next part’s first item is harder (before: b = 0 for everybody)', async () => {
    const s = await start(sc)
    expect(await firstB(sc, s, 'KHU')).toBe(0)
    await play(sc, s, 'VOC', new Array<boolean>(6).fill(true))
    // VOC–KHU .60 (Σ_init v2): the first KHU item is at a stratum above the middle, and so is LR's (.35)
    expect(await firstB(sc, s, 'KHU')).toBeGreaterThanOrEqual(1)
    expect(await firstB(sc, s, 'LR')).toBeGreaterThanOrEqual(1)
    // and a weak one makes it easier
    const w = await start(sc)
    await play(sc, w, 'VOC', new Array<boolean>(6).fill(false))
    expect(await firstB(sc, w, 'KHU')).toBeLessThanOrEqual(-1)
  })

  it('does not touch the scores: the posterior of a skill is that of its own answers alone', async () => {
    const s = await start(sc)
    const { obs } = await play(sc, s, 'VOC', [true, true, true, false, true, true])
    const { rows } = await sc.db.owner.query<{ axis: string; mean: number; sd: number; n: number }>(`select p.* from hb.session_posteriors((select s.state from public.sessions s where s.session_id = $1)) p`, [s.session_id])
    const post = Object.fromEntries(rows.map((r) => [r.axis, r]))
    expect(Number(post.KHU!.mean)).toBe(0)
    expect(Number(post.KHU!.sd)).toBe(1)
    expect(Number(post.VOC!.mean)).toBeCloseTo(sessionPosterior(obs).VOC.mean, 6)
    // while its aim borrows
    expect((await aims(sc, s.session_id)).KHU).toBeGreaterThan(0.5)
  })

  it('agrees with the app’s aim on random records over four skills (fast-check)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.tuple(fc.constantFrom(...SKILLS), fc.array(fc.boolean(), { minLength: 1, maxLength: 3 })), { minLength: 1, maxLength: 4 }), async (parts) => {
        const s = await start(sc)
        const obs: Observation[] = []
        expectAims(await aims(sc, s.session_id), selectionAim(obs))
        for (const [axis, answers] of parts) {
          obs.push(...(await play(sc, s, axis, answers)).obs)
          expectAims(await aims(sc, s.session_id), selectionAim(obs))
        }
      }),
      { numRuns: 8 },
    )
  }, 180_000)
})

// -------------------------------------------------------------------------------------- returning people
describe('a returning person starts each part from their earlier sessions', () => {
  let sc: Scenario
  beforeAll(async () => {
    sc = await scenario()
  })
  afterAll(async () => {
    await sc.db.close()
  })

  /** A finished first session with these answers, and the save that proves it. */
  async function first(answers: Partial<Record<Skill, boolean[]>>): Promise<{ save: Record<string, unknown>; obs: Observation[]; anonId: string }> {
    const s = await start(sc)
    const obs: Observation[] = []
    for (const [axis, a] of Object.entries(answers) as [Skill, boolean[]][]) obs.push(...(await play(sc, s, axis, a)).obs)
    const fin = await sc.db.rpc<{ session: Record<string, unknown> }>(from(s.ip), 'finish', { p_token: s.token })
    return { save: emptySave(s.anon_id, { sessions: [fin.session] }), obs, anonId: s.anon_id }
  }

  it('the new session holds the earlier grids; its aims are the app’s with those answers as `earlier`, and its scores are its own', async () => {
    const p = await first({ VOC: [true, true, true, true, false], KST: [false, true] })
    const s = await start(sc, p.save)
    expect(s.anon_id).toBe(p.anonId)
    const { rows } = await sc.db.owner.query<{ prior: Record<string, { n: number; lam: number; x: number }> }>(`select state -> 'prior' as prior from public.sessions where session_id = $1`, [s.session_id])
    expect(Object.keys(rows[0]!.prior).sort()).toEqual(['KST', 'VOC'])
    expect(rows[0]!.prior.VOC!.n).toBe(5)
    // the app reads an earlier session as one Gaussian term a skill (xskill.ts sessionEvidence); the server, from the
    // summary finish kept (six decimals), as {n, lam, x}
    const earlier = sessionEvidence(p.obs, { sigma: initialSigma() })
    expect(earlier.map((o) => o.axis)).toEqual(['VOC', 'KST'])
    for (const o of earlier) {
      if (o.kind !== 'gaussian') throw new Error('a Gaussian term')
      expect(rows[0]!.prior[o.axis]!.lam).toBeCloseTo(1 / o.sigma ** 2, 3)
      expect(rows[0]!.prior[o.axis]!.x).toBeCloseTo(o.x, 3)
    }
    expectAims(await aims(sc, s.session_id), selectionAim([], { earlier }), 4)
    // the first VOC item of the new session is where the person left it, not at the middle
    expect(await firstB(sc, s, 'VOC')).toBeGreaterThanOrEqual(1)
    // this session's answers come on top
    const now = await play(sc, s, 'KHU', [true, false])
    expectAims(await aims(sc, s.session_id), selectionAim(now.obs, { earlier }), 4)
    // and the session's posterior is its own: nothing on VOC yet
    const post = await sc.db.owner.query<{ mean: number; n: number }>(`select p.mean, p.n from hb.session_posteriors((select s.state from public.sessions s where s.session_id = $1)) p where p.axis = 'VOC'`, [s.session_id])
    expect(Number(post.rows[0]!.mean)).toBe(0)
    expect(Number(post.rows[0]!.n)).toBe(0)
  })

  it('a session that was never finished is read from its grid, as the app reads its answers; two sessions add up', async () => {
    const s = await start(sc)
    const { obs } = await play(sc, s, 'KHU', [true, true, false, true])
    type Prior = { prior?: Record<string, { n: number; lam: number; x: number }> }
    const read = async (): Promise<Prior> => (await sc.db.owner.query<{ p: Prior }>(`select hb.prior_state(array[$1]) as p`, [s.anon_id])).rows[0]!.p
    const one = await read()
    expect(Object.keys(one.prior!)).toEqual(['KHU'])
    expect(one.prior!.KHU!.n).toBe(4)
    const [e] = sessionEvidence(obs, { sigma: initialSigma() })
    if (e?.kind !== 'gaussian') throw new Error('a Gaussian term')
    expect(one.prior!.KHU!.lam).toBeCloseTo(1 / e.sigma ** 2, 9)
    expect(one.prior!.KHU!.x).toBeCloseTo(e.x, 9)
    // a second session of the same id: the terms add (precisions add, locations are precision-weighted)
    const t = await start(sc)
    await sc.db.owner.query(`update public.sessions set anon_id = $1 where session_id = $2`, [s.anon_id, t.session_id])
    const more = await play(sc, t, 'KHU', [false, false, true])
    const [f] = sessionEvidence(more.obs, { sigma: initialSigma() })
    if (f?.kind !== 'gaussian') throw new Error('a Gaussian term')
    const two = await read()
    const l1 = 1 / e.sigma ** 2
    const l2 = 1 / f.sigma ** 2
    expect(two.prior!.KHU!.n).toBe(7)
    expect(two.prior!.KHU!.lam).toBeCloseTo(l1 + l2, 9)
    expect(two.prior!.KHU!.x).toBeCloseTo((l1 * e.x + l2 * f.x) / (l1 + l2), 9)
    // nothing at all: no key
    expect((await sc.db.owner.query<{ p: unknown }>(`select hb.prior_state(array['hb_nobody00000000'::text]) as p`)).rows[0]!.p).toEqual({})
  })

  it('a file that proves nothing brings nothing: a stranger’s save, or no save', async () => {
    const p = await first({ VOC: [true, true, true] })
    const stranger = await start(sc, emptySave('hb_7Q3m9Kx2Vw5rT8pL', { sessions: [] }))
    expect((await aims(sc, stranger.session_id)).VOC).toBe(0)
    // a file proves the ids of the signed sessions it holds, whatever id it claims (as for the seen lists): the
    // history is that of the session in the file, never that of the id named
    const claimed = await start(sc, { ...p.save, anon_id: 'hb_7Q3m9Kx2Vw5rT8pL' })
    expect(claimed.anon_id).not.toBe('hb_7Q3m9Kx2Vw5rT8pL')
    expect((await aims(sc, claimed.session_id)).VOC).toBeGreaterThan(0.5)
    const none = await start(sc)
    const { rows } = await sc.db.owner.query<{ state: Record<string, unknown> }>(`select state from public.sessions where session_id = $1`, [none.session_id])
    expect(Object.keys(rows[0]!.state).sort()).toEqual(['seen_families', 'seen_items', 'v'])
  })

  it('selection.prior_sessions = 0 switches it off', async () => {
    const p = await first({ VOC: [true, true, true, true] })
    await setConfig(sc.db, { 'selection.prior_sessions': 0 })
    try {
      const s = await start(sc, p.save)
      expectAims(await aims(sc, s.session_id), selectionAim([]))
    } finally {
      await setConfig(sc.db, { 'selection.prior_sessions': EARLIER_SESSIONS_MAX })
    }
  })
})

// ------------------------------------------------------------------------------------------- the switches
describe('the settings: borrowing off gives the aim of before, and a new Σ is used as soon as it is written', () => {
  let sc: Scenario
  beforeAll(async () => {
    sc = await scenario()
  })
  afterAll(async () => {
    await sc.db.close()
  })

  it('selection.borrow_strength = 0: every skill on its own answers, the first item of a part at b = 0', async () => {
    await setConfig(sc.db, { 'selection.borrow_strength': 0 })
    const s = await start(sc)
    const { obs } = await play(sc, s, 'VOC', new Array<boolean>(5).fill(true))
    expectAims(await aims(sc, s.session_id), selectionAim(obs, { borrow: 0 }))
    expect(await firstB(sc, s, 'KHU')).toBe(0)
    await setConfig(sc.db, { 'selection.borrow_strength': 0.5 })
    expectAims(await aims(sc, s.session_id), selectionAim(obs, { borrow: 0.5 }))
    await setConfig(sc.db, { 'selection.borrow_strength': XSKILL_BORROW })
  })

  it('reads Σ from scoring.sigma at every call (the nightly re-estimate of §3 needs no change here)', async () => {
    const s = await start(sc)
    const { obs } = await play(sc, s, 'VOC', new Array<boolean>(5).fill(true))
    const before = await aims(sc, s.session_id)
    const sigma = initialSigma().map((r, i) => r.map((x, j) => (i === j ? 1 : Math.round(Math.min(0.8, x * 1.25) * 1000) / 1000)))
    await setConfig(sc.db, { 'scoring.sigma': sigma })
    const after = await aims(sc, s.session_id)
    expectAims(after, selectionAim(obs, { sigma }))
    expect(after.KHU!).toBeGreaterThan(before.KHU! + 0.05)
  })
})
