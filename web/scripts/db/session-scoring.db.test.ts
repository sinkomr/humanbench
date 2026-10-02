/**
 * M2.2 (ROADMAP M2.2; DESIGN §7.2, §11.2, §13, R-11.1): what a session keeps while it runs and computes when
 * it ends. submit adds each answer to the grid EAP in sessions.state (compared with engine/scorer.ts eapAxis);
 * finish computes the correlated MAP (mapTheta, to the 6 decimals it is stored with), the §13 evidence the
 * server can see (engine/integrity.ts personFitCheck, hardItemCheck, tooFastCheck, uniformRtCheck) and
 * calibration_eligible; and none of it reaches the client, because each is a function of which answers were
 * right (R-11.1; owner decision 2026-10-01).
 */

import fc from 'fast-check'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AXIS_CODES, initialSigma, type AxisCode } from '../../src/engine/axes'
import { hardItemCheck, lzStar, personFitCheck, poissonBinomialUpperTail, tooFastCheck, uniformRtCheck, type IntegrityResponse } from '../../src/engine/integrity'
import { eapAxis, mapTheta } from '../../src/engine/scorer'
import type { ItemParams, Observation } from '../../src/engine/types'
import { createRng } from '../../src/engine/prng'
import { customItem, loadFixtureBank, type FixtureItem } from './bank-fixture'
import type { TestDb } from './harness'
import { ageExposures, from, isServed, playSession, relaxSelection, startSession, type Next, type Served } from './rpc-support'
import { openTestDb } from './vitest'

let db: TestDb
let ipCounter = 0
const freshIp = (): string => {
  const n = ++ipCounter
  return `198.19.${Math.floor(n / 250)}.${(n % 250) + 1}`
}
const AXES = ['QR', 'MAT', 'KST', 'SPA', 'VOC'] as const

/** 5 axes x 40 items; 3PL (4 options) and 2PL (5 options) alternate; expected times 40 s and 10 s alternate in pairs. */
function bank(): FixtureItem[] {
  const items: FixtureItem[] = []
  let n = 0
  for (const axis of AXES) {
    for (let k = 0; k < 40; k++) {
      n++
      items.push(customItem(n, axis, { model: k % 2 === 0 ? '3pl' : '2pl', a: 0.8 + 0.03 * k, b: -2 + 0.1 * k, expectedTimeS: k % 4 < 2 ? 40 : 10 }))
    }
  }
  return items
}
const items = bank()
const byId = new Map(items.map((i) => [i.itemId, i]))

beforeAll(async () => {
  db = await openTestDb()
  await relaxSelection(db)
  await loadFixtureBank(db, items)
})
afterAll(async () => {
  await db.close()
})

// ------------------------------------------------------------------------------------------- helpers
interface Row {
  seq: number
  item_id: string
  axis: AxisCode
  status: string
  pretest: boolean
  correct: number | null
  model: '2pl' | '2pl_testlet' | '3pl'
  a: number
  b: number
  c: number | null
  elapsed_s: number
  expected: number
  fits: boolean
}

async function rowsOf(sessionId: string): Promise<Row[]> {
  const { rows } = await db.owner.query<Row>(
    `select r.seq, r.item_id, f.axis, i.status, r.pretest, r.correct, p.model, p.a, p.b, p.c,
            extract(epoch from r.created_at - e.served_at)::float8 as elapsed_s,
            hb.item_expected_time_s(p.extra, i.payload) as expected,
            hb.response_fits(ik.key, jsonb_array_length(i.payload -> 'options'), r.response) as fits
       from public.responses r
       join public.exposure_log e on e.session_id = r.session_id and e.seq = r.seq
       join public.items i on i.item_id = r.item_id
       join public.item_families f on f.family_id = i.family_id
       join public.item_parameters p on p.item_id = i.item_id
       left join public.item_keys ik on ik.item_id = r.item_id
      where r.session_id = $1 order by r.seq`,
    [sessionId],
  )
  return rows
}

const counted = (rows: readonly Row[]): Row[] => rows.filter((r) => !r.pretest && r.correct !== null && r.status !== 'quarantined' && r.fits)
const obsOf = (r: Row): Observation =>
  r.model === '3pl' ? { kind: '3pl', axis: r.axis, a: r.a, b: r.b, c: r.c!, y: r.correct === 1 ? 1 : 0 } : { kind: '2pl', axis: r.axis, a: r.a, b: r.b, y: r.correct === 1 ? 1 : 0 }
const paramsOf = (r: Row): ItemParams => (r.model === '3pl' ? { model: '3pl', a: r.a, b: r.b, c: r.c! } : { model: r.model, a: r.a, b: r.b })
const integrityRows = (rows: readonly Row[]): IntegrityResponse[] =>
  rows.map((r) => ({
    item_id: r.item_id,
    axis: r.axis,
    params: paramsOf(r),
    expected_time_s: r.expected,
    correct: r.correct === 1 ? 1 : r.correct === 0 ? 0 : null,
    rt_ms: r.elapsed_s * 1000,
    onset_ms: 0,
    end_ms: r.elapsed_s * 1000,
  }))

interface Played {
  sessionId: string
  token: string
  anonId: string
  ip: string
}

/** A session of `n` answers; `decide` says whether the answer is the key. Finished unless `finish` is false. */
async function play(n: number, decide: (it: FixtureItem, seq: number) => boolean, opts: { finish?: boolean; flags?: Record<string, unknown>; itemFlags?: (seq: number) => Record<string, unknown> | undefined; axes?: readonly string[] } = {}): Promise<Played> {
  const ip = freshIp()
  const s = await startSession(db, ip)
  await playSession(db, s, byId, { ip, n, decide, ...(opts.itemFlags === undefined ? {} : { clientFlags: opts.itemFlags }), ...(opts.axes === undefined ? {} : { axes: opts.axes }) })
  if (opts.finish !== false) await db.rpc(from(ip), 'finish', { p_token: s.token, ...(opts.flags === undefined ? {} : { p_flags: opts.flags }) })
  return { sessionId: s.session_id, token: s.token, anonId: s.anon_id, ip }
}

const stateOf = async (sessionId: string): Promise<Record<string, any>> => (await db.owner.query<{ state: Record<string, any> }>(`select state from public.sessions where session_id = $1`, [sessionId])).rows[0]!.state
const eligibleOf = async (sessionId: string): Promise<boolean> => (await db.owner.query<{ e: boolean }>(`select calibration_eligible as e from public.sessions where session_id = $1`, [sessionId])).rows[0]!.e

/** A person at theta on every axis: right with the probability the model gives. */
const person = (theta: number, seed: string): ((it: FixtureItem) => boolean) => {
  const rng = createRng(seed)
  return (it) => {
    const p = (it.c ?? 0) + (1 - (it.c ?? 0)) / (1 + Math.exp(-it.a * (theta - it.b)))
    return rng.next() < p
  }
}


/**
 * A session built straight in the tables: the given items in order, each answered right or wrong, `elapsed[i]`
 * seconds after it was served (the server's clock), with client flags per answer if given. The session is
 * a real one (start_session), so finish works on it. The adaptive picker would only ever offer items near the
 * person's estimate, so the tests of the evidence, which need items of every difficulty and length, set the
 * rows by hand.
 */
async function synthetic(spec: { items: readonly FixtureItem[]; correct: readonly (0 | 1)[]; elapsed: readonly number[]; itemFlags?: readonly (Record<string, unknown> | undefined)[]; finish?: boolean; flags?: Record<string, unknown> }): Promise<Played> {
  const ip = freshIp()
  const s = await startSession(db, ip)
  const n = spec.items.length
  await db.owner.query(
    `insert into public.exposure_log (session_id, seq, item_id, family_id, sibling_group, pretest, served_at)
     select $1, t.seq, i.item_id, i.family_id, f.sibling_group, false, now() - interval '1 hour' + make_interval(secs => t.seq * 100)
       from unnest($2::text[]) with ordinality as t (item_id, seq)
       join public.items i on i.item_id = t.item_id join public.item_families f on f.family_id = i.family_id`,
    [s.session_id, spec.items.map((i) => i.itemId)],
  )
  await db.owner.query(
    `insert into public.responses (session_id, seq, item_id, response, correct, score, rt_ms, pretest, client_flags, created_at)
     select $1, t.seq, t.item_id, to_jsonb(case when t.c = 1 then 0 else 1 end), t.c::smallint, t.c::real, 5000, false, coalesce(t.fl, '{}'::jsonb),
            e.served_at + make_interval(secs => t.s)
       from unnest($2::text[], $3::int[], $4::float8[], $5::jsonb[]) with ordinality as t (item_id, c, s, fl, seq)
       join public.exposure_log e on e.session_id = $1 and e.seq = t.seq`,
    [s.session_id, spec.items.map((i) => i.itemId), spec.correct, spec.elapsed, spec.items.map((_, i) => (spec.itemFlags?.[i] === undefined ? null : JSON.stringify(spec.itemFlags[i])))],
  )
  await db.owner.query(`update public.sessions set n_served = $2, n_answered = $2 where session_id = $1`, [s.session_id, n])
  if (spec.finish !== false) await db.rpc(from(ip), 'finish', { p_token: s.token, ...(spec.flags === undefined ? {} : { p_flags: spec.flags }) })
  return { sessionId: s.session_id, token: s.token, anonId: s.anon_id, ip }
}

/** Items of the bank in a fixed spread over axes and difficulty: `n` of them, QR then MAT then KST... interleaved. */
const spread = (n: number): FixtureItem[] => {
  const perAxis = Math.ceil(n / 3)
  if (perAxis > 40) throw new Error('spread: at most 120 items')
  const out: FixtureItem[] = []
  for (let j = 0; j < perAxis; j++) {
    for (const axis of AXES.slice(0, 3)) {
      if (out.length < n) out.push(items.filter((i) => i.axis === axis)[(j * 7) % 40]!) // 7 is prime to 40: distinct, all difficulties, 40 s and 10 s items on every axis
    }
  }
  return out
}
const trueP = (it: FixtureItem, theta: number): number => (it.c ?? 0) + (1 - (it.c ?? 0)) / (1 + Math.exp(-it.a * (theta - it.b)))

// ----------------------------------------------------------------------------------------- the EAP
describe('the grid EAP in sessions.state (DESIGN §11.2)', () => {
  it('holds, per axis, the answers given so far: the posterior is the grid EAP of the app on the same answers (1e-9)', async () => {
    const p = await play(60, person(0.4, 'eap-a'), { finish: false })
    const rows = counted(await rowsOf(p.sessionId))
    expect(rows.length).toBe(60)
    const st = await stateOf(p.sessionId)
    expect(Object.keys(st.eap).sort()).toEqual([...new Set(rows.map((r) => r.axis))].sort())
    for (const axis of Object.keys(st.eap)) {
      const mine = rows.filter((r) => r.axis === axis)
      expect(st.eap[axis].n).toBe(mine.length)
      expect(st.eap[axis].ll.length).toBe(61)
      const want = eapAxis(mine.map(obsOf), 0, 1)
      const { rows: got } = await db.owner.query<{ mean: number; sd: number; n: number }>(`select * from hb.session_posteriors($1::jsonb) where axis = $2`, [JSON.stringify(st), axis])
      expect(Math.abs(got[0]!.mean - want.mean), axis).toBeLessThan(1e-9)
      expect(Math.abs(got[0]!.sd - want.sd), axis).toBeLessThan(1e-9)
      expect(got[0]!.n).toBe(mine.length)
    }
    // an axis without an answer is its prior, exactly
    const prior = await db.owner.query<{ mean: number; sd: number; n: number }>(`select * from hb.session_posteriors($1::jsonb) where axis = 'WM'`, [JSON.stringify(st)])
    expect(prior.rows[0]).toEqual({ axis: 'WM', mean: 0, sd: 1, n: 0 })
  })

  it('keeps the state free of anything but the seen lists and the EAP while the session runs', async () => {
    const p = await play(8, () => true, { finish: false })
    const st = await stateOf(p.sessionId)
    expect(Object.keys(st).sort()).toEqual(['eap', 'seen_families', 'seen_items', 'v'])
    for (const k of Object.keys(st.eap)) expect(Object.keys(st.eap[k]).sort()).toEqual(['ll', 'n'])
  })

  it('leaves out a pretest answer, an unscored one, an item quarantined meanwhile and an answer outside the answer space', async () => {
    const ip = freshIp()
    const s = await startSession(db, ip)
    const ctx = from(ip)
    const submit = async (n: Next, response: unknown): Promise<Next> => {
      await ageExposures(db, s.session_id, 20)
      return (await db.rpc<{ next: Next }>(ctx, 'submit', { p_token: s.token, p_item_id: (n as Served).item.item_id, p_response: response, p_rt_ms: 4000 })).next
    }
    let n = await db.rpc<Next>(ctx, 'next_item', { p_token: s.token, p_axes: ['QR'] })
    const n0 = async (): Promise<number> => Object.values(((await stateOf(s.session_id)).eap ?? {}) as Record<string, { n: number }>).reduce((t, e) => t + e.n, 0)
    n = await submit(n, 0) // counted
    expect(await n0()).toBe(1)
    n = await submit(n, -1) // outside the answer space: no answer
    expect(await n0()).toBe(1)
    n = await submit(n, 'x')
    expect(await n0()).toBe(1)
    // quarantined between the serve and the answer
    await db.owner.query(`update public.items set status = 'quarantined' where item_id = $1`, [(n as Served).item.item_id])
    n = await submit(n, 0)
    expect(await n0()).toBe(1)
    await db.owner.query(`update public.items set status = 'live' where status = 'quarantined'`) // the other tests share the bank
    // pretest: mark the exposure of the item being served
    await db.owner.query(`update public.exposure_log set pretest = true where session_id = $1 and item_id = $2`, [s.session_id, (n as Served).item.item_id])
    n = await submit(n, 0)
    expect(await n0()).toBe(1)
    // an item without a key row is not scored (a block): its answer cannot enter
    const bare = (n as Served).item.item_id
    await db.owner.query(`delete from public.item_keys where item_id = $1`, [bare])
    n = await submit(n, 0)
    expect(await n0()).toBe(1)
    await db.owner.query(`insert into public.item_keys (item_id, key) values ($1, '{"index": 0}')`, [bare])
    expect(isServed(n)).toBe(true)
    // and counted ones go on counting
    n = await submit(n, 0)
    expect(await n0()).toBe(2)
  })

  it('does not add a repeated answer twice (a retry after a lost reply)', async () => {
    const ip = freshIp()
    const s = await startSession(db, ip)
    const ctx = from(ip)
    const n = (await db.rpc<Next>(ctx, 'next_item', { p_token: s.token })) as Served
    await ageExposures(db, s.session_id, 20)
    for (let i = 0; i < 3; i++) await db.rpc(ctx, 'submit', { p_token: s.token, p_item_id: n.item.item_id, p_response: 0, p_rt_ms: 4000, p_next: false })
    const st = await stateOf(s.session_id)
    expect(Object.values(st.eap as Record<string, { n: number }>).reduce((t, e) => t + e.n, 0)).toBe(1)
  })
})

// ---------------------------------------------------------------------------------------- the MAP
describe('finish: the correlated MAP is kept, not returned', () => {
  it('stores the MAP and Laplace covariance of the counted answers under Σ_init: mapTheta to the 6 decimals stored', async () => {
    const p = await play(70, person(-0.3, 'map-a'))
    const rows = counted(await rowsOf(p.sessionId))
    const obs = rows.map(obsOf)
    const want = mapTheta(obs, new Array(17).fill(0), initialSigma())
    const post = (await stateOf(p.sessionId)).posterior
    expect(post.v).toBe(1)
    expect(post.sigma_version).toBe('sigma-v2-2026-09-26')
    expect(post.n_obs).toBe(70)
    expect(post.n_by_axis).toEqual(Object.fromEntries(AXES.map((a) => [a, rows.filter((r) => r.axis === a).length]).filter(([, n]) => (n as number) > 0)))
    expect(post.theta.length).toBe(17)
    expect(post.cov.length).toBe(289)
    post.theta.forEach((t: number, i: number) => expect(Math.abs(t - want.theta[i]!)).toBeLessThan(1e-6))
    post.cov.forEach((c: number, i: number) => expect(Math.abs(c - want.cov[Math.floor(i / 17)]![i % 17]!)).toBeLessThan(1e-6))
    expect(Math.abs(post.log_posterior - want.logPosterior)).toBeLessThan(1e-5)
    // axes the session never touched borrow strength through Σ: they moved off the prior mean
    expect(post.theta[AXIS_CODES.indexOf('LR')]).not.toBe(0)
  })

  it('counts only what a score counts: not a pretest answer, an unscored one, a quarantined item, an answer outside the answer space', async () => {
    const p = await play(40, person(0.2, 'map-b'), { finish: false })
    const before = await rowsOf(p.sessionId)
    await db.owner.query(`update public.responses set pretest = true where session_id = $1 and seq % 7 = 0`, [p.sessionId])
    await db.owner.query(`update public.responses set response = '-1'::jsonb where session_id = $1 and seq % 11 = 0`, [p.sessionId])
    await db.owner.query(`update public.responses set correct = null where session_id = $1 and seq % 13 = 0`, [p.sessionId])
    await db.owner.query(`update public.items set status = 'quarantined' where item_id in (select item_id from public.responses where session_id = $1 and seq in (5, 6))`, [p.sessionId])
    await db.rpc(from(p.ip), 'finish', { p_token: p.token })
    const rows = counted(await rowsOf(p.sessionId))
    await db.owner.query(`update public.items set status = 'live' where status = 'quarantined'`) // the other tests share the bank
    expect(rows.length).toBeLessThan(before.length - 8)
    const want = mapTheta(rows.map(obsOf), new Array(17).fill(0), initialSigma())
    const post = (await stateOf(p.sessionId)).posterior
    expect(post.n_obs).toBe(rows.length)
    post.theta.forEach((t: number, i: number) => expect(Math.abs(t - want.theta[i]!)).toBeLessThan(1e-6))
  })

  it('keeps a summary of the session\'s EAP in place of the grids, and the evidence, in the state', async () => {
    const p = await play(30, person(0, 'map-c'))
    const st = await stateOf(p.sessionId)
    expect(Object.keys(st).sort()).toEqual(['eap', 'integrity', 'posterior', 'seen_families', 'seen_items', 'v'])
    for (const e of Object.values(st.eap as Record<string, Record<string, unknown>>)) expect(Object.keys(e).sort()).toEqual(['mean', 'n', 'sd'])
    expect(JSON.stringify(st).length).toBeLessThan(6000)
  })

  it('reaches no client: not in finish, not in the session\'s flags, not in rescore', async () => {
    const p = await play(30, person(0.1, 'map-d'), { finish: false })
    const out = await db.rpc<Record<string, unknown>>(from(p.ip), 'finish', { p_token: p.token })
    expect(Object.keys(out).sort()).toEqual(['anon_id', 'n_responses', 'session'])
    const text = JSON.stringify(out)
    expect(text).not.toMatch(/theta|posterior|lz_star|person_fit|integrity|eligib|sigma_version|"cov"|log_posterior/)
    const again = await db.rpc<Record<string, unknown>>(from(p.ip), 'finish', { p_token: p.token })
    expect(Object.keys(again).sort()).toEqual(['anon_id', 'n_responses', 'session'])
  })

  it('records no counted answer as n_obs 0, and a failure as an error code, and finishes the session either way', async () => {
    const none = await play(0, () => true)
    expect((await stateOf(none.sessionId)).posterior).toEqual({ v: 1, n_obs: 0 })
    expect(await eligibleOf(none.sessionId)).toBe(false)
    // a parameter row the arithmetic cannot take (a = 1e308 overflows): the MAP and the evidence fail, the session still closes
    const p = await play(4, () => true, { finish: false })
    const first = (await rowsOf(p.sessionId))[0]!
    await db.owner.query(`update public.item_parameters set a = 1e308 where item_id = $1`, [first.item_id])
    try {
      const out = await db.rpc<{ n_responses: number }>(from(p.ip), 'finish', { p_token: p.token })
      expect(out.n_responses).toBe(4)
      const st = await stateOf(p.sessionId)
      expect(st.posterior).toEqual({ v: 1, error: expect.stringMatching(/^[0-9A-Z]{5}$/) })
      expect(st.integrity).toEqual({ v: 1, error: expect.stringMatching(/^[0-9A-Z]{5}$/) })
      expect(await eligibleOf(p.sessionId)).toBe(false) // evidence that cannot be computed is not a calibration
    } finally {
      await db.owner.query(`update public.item_parameters set a = $2 where item_id = $1`, [first.item_id, byId.get(first.item_id)!.a])
    }
  })

  it('is computed once: a second finish changes nothing', async () => {
    const p = await play(12, person(0, 'map-e'))
    const a = await stateOf(p.sessionId)
    await db.rpc(from(p.ip), 'finish', { p_token: p.token, p_flags: { paste_events: 5 } })
    expect(await stateOf(p.sessionId)).toEqual(a)
  })
})

// ------------------------------------------------------------------------------------- the evidence
describe('finish: the §13 evidence the server can see (engine/integrity.ts parity)', () => {
  it('person fit, accuracy on hard items, too-fast and uniform times agree with the app on the same answers', async () => {
    const rng = createRng('ev')
    const chosen = spread(45)
    const cases: { name: string; correct: (it: FixtureItem, i: number) => 0 | 1; elapsed: (it: FixtureItem, i: number) => number; itemFlags?: undefined }[] = [
      { name: 'honest', correct: (it) => (rng.next() < trueP(it, 0.3) ? 1 : 0), elapsed: (_it, i) => 15 + (i % 9) * 3 },
      { name: 'right on the hard, wrong on the easy', correct: (it) => (it.b > 0 ? 1 : 0), elapsed: (_it, i) => 15 + (i % 9) * 3 },
      { name: 'right on the easy, wrong on the hard', correct: (it) => (it.b < 0 ? 1 : 0), elapsed: (_it, i) => 15 + (i % 9) * 3 },
      { name: 'fast', correct: (it) => (rng.next() < trueP(it, 0.8) ? 1 : 0), elapsed: (_it, i) => (i % 3 === 0 ? 2 : 6 + (i % 5) * 4) },
      { name: 'uniform', correct: (it) => (rng.next() < trueP(it, -0.4) ? 1 : 0), elapsed: () => 17.5 },
    ]
    const flagged = { fit: 0, hard: 0, fast: 0, uni: 0 }
    for (const c of cases) {
      const p = await synthetic({ items: chosen, correct: chosen.map((it, i) => c.correct(it, i)), elapsed: chosen.map((it, i) => c.elapsed(it, i)) })
      const all = await rowsOf(p.sessionId)
      const scored = integrityRows(counted(all))
      const ev = (await stateOf(p.sessionId)).integrity
      expect(ev.n_scored, c.name).toBe(scored.length)

      const fit = personFitCheck(scored)
      expect(ev.person_fit.flagged, c.name).toBe(fit.flagged)
      expect(ev.person_fit.n_items, c.name).toBe(fit.evidence.n_items)
      expect(Math.abs(ev.person_fit.lz_star - fit.evidence.lz_star!), `${c.name} lz*`).toBeLessThan(1e-6)
      expect(Math.abs(ev.person_fit.lz - fit.evidence.lz!), `${c.name} lz`).toBeLessThan(1e-6)

      const hard = hardItemCheck(scored, fit.evidence.theta)
      expect(ev.hard_item_accuracy.flagged, c.name).toBe(hard.flagged)
      expect(ev.hard_item_accuracy.n_hard, c.name).toBe(hard.evidence.n_hard)
      expect(ev.hard_item_accuracy.n_correct, c.name).toBe(hard.evidence.n_correct)
      expect(Math.abs(ev.hard_item_accuracy.p_value - hard.evidence.p_value), `${c.name} p`).toBeLessThan(1e-9)

      const fast = tooFastCheck(scored)
      expect(ev.too_fast.n, c.name).toBe(fast.evidence.count)
      expect([...ev.too_fast.items].sort(), c.name).toEqual(fast.evidence.items.map((i) => i.item_id).sort())

      const uni = uniformRtCheck(integrityRows(all.filter((r) => !r.pretest)))
      expect(ev.uniform_rt.applies, c.name).toBe(uni.evidence.applies)
      expect(ev.uniform_rt.flagged, c.name).toBe(uni.flagged)
      expect(ev.uniform_rt.n_items, c.name).toBe(uni.evidence.n_items)
      expect(Math.abs(ev.uniform_rt.sd_log_rt - uni.evidence.sd_log_rt!), `${c.name} sd`).toBeLessThan(1e-9)
      expect(Math.abs(ev.uniform_rt.time_ratio - uni.evidence.time_ratio!), `${c.name} ratio`).toBeLessThan(1e-9)
      flagged.fit += fit.flagged ? 1 : 0
      flagged.hard += hard.flagged ? 1 : 0
      flagged.fast += fast.flagged ? 1 : 0
      flagged.uni += uni.flagged ? 1 : 0
      expect(hard.evidence.n_hard + fit.evidence.n_items, `${c.name}: not vacuous`).toBeGreaterThan(40)
    }
    // the cases exercise both outcomes of each check: the parity above is not between two "false"
    expect(flagged.fit).toBeGreaterThanOrEqual(1)
    expect(flagged.fit).toBeLessThan(cases.length)
    expect(flagged.fast).toBeGreaterThanOrEqual(1)
    expect(flagged.uni).toBeGreaterThanOrEqual(1)
    expect(flagged.hard).toBeGreaterThanOrEqual(1)
  })

  it('flags a misfit session (right on the hard, wrong on the easy) and not an honest one', async () => {
    const rng = createRng('ev2')
    const chosen = spread(45)
    const honest = await synthetic({ items: chosen, correct: chosen.map((it) => (rng.next() < trueP(it, 0.3) ? 1 : 0)), elapsed: chosen.map(() => 25) })
    const misfit = await synthetic({ items: chosen, correct: chosen.map((it) => (it.b > 0 ? 1 : 0)), elapsed: chosen.map(() => 25) })
    expect((await stateOf(honest.sessionId)).integrity.person_fit.flagged).toBe(false)
    const e2 = (await stateOf(misfit.sessionId)).integrity
    expect(e2.person_fit.flagged).toBe(true)
    expect(e2.person_fit.lz_star).toBeLessThan(-2)
    expect(await eligibleOf(honest.sessionId)).toBe(true)
    expect(await eligibleOf(misfit.sessionId)).toBe(false)
  })

  it('needs 20 scored answers for person fit (below that, lz* is not a test)', async () => {
    const chosen = spread(15)
    const p = await synthetic({ items: chosen, correct: chosen.map((it) => (it.b > 0 ? 1 : 0)), elapsed: chosen.map(() => 25) })
    const e = (await stateOf(p.sessionId)).integrity
    expect(e.person_fit.n_items).toBe(15)
    expect(e.person_fit.flagged).toBe(false)
  })

  it('counts an answer outside the answer space as no answer, in the fit statistics as in the score', async () => {
    const chosen = spread(40)
    const p = await synthetic({ items: chosen, correct: chosen.map((it) => (it.b > 0 ? 1 : 0)), elapsed: chosen.map(() => 25), finish: false })
    await db.owner.query(`update public.responses set response = '-1'::jsonb where session_id = $1 and seq > 10`, [p.sessionId])
    await db.rpc(from(p.ip), 'finish', { p_token: p.token })
    expect((await stateOf(p.sessionId)).integrity.n_scored).toBe(10)
    expect((await stateOf(p.sessionId)).posterior.n_obs).toBe(10)
  })

  it('lz* and the Poisson-binomial tail agree with the app on generated inputs (hb.lz_star, hb.pb_upper_tail)', async () => {
    const term = fc.record({
      axis: fc.integer({ min: 1, max: 5 }),
      three: fc.boolean(),
      a: fc.double({ min: 0.4, max: 3, noNaN: true }).map((x) => Math.round(x * 1000) / 1000),
      b: fc.double({ min: -3, max: 3, noNaN: true }).map((x) => Math.round(x * 1000) / 1000),
      y: fc.constantFrom(0, 1),
    })
    const sets = fc.sample(fc.array(term, { minLength: 8, maxLength: 40 }), 25)
    for (const set of sets) {
      const obs = set.map((t) => (t.three ? { kind: '3pl' as const, axis: AXIS_CODES[t.axis - 1]!, a: t.a, b: t.b, c: 0.25, y: t.y as 0 | 1 } : { kind: '2pl' as const, axis: AXIS_CODES[t.axis - 1]!, a: t.a, b: t.b, y: t.y as 0 | 1 }))
      const theta: Partial<Record<AxisCode, number>> = {}
      const r0: Partial<Record<AxisCode, number>> = {}
      const thetaArr = new Array<number>(17).fill(0)
      const r0Arr = new Array<number>(17).fill(0)
      for (const code of new Set(obs.map((o) => o.axis))) {
        const t = ((AXIS_CODES.indexOf(code) * 37) % 11) / 5 - 1
        theta[code] = t
        r0[code] = -t / 9
        thetaArr[AXIS_CODES.indexOf(code)] = t
        r0Arr[AXIS_CODES.indexOf(code)] = -t / 9
      }
      const want = lzStar(obs, theta, r0)
      const { rows } = await db.owner.query<{ o_lz_star: number | null; o_lz: number | null }>(`select * from hb.lz_star($1::int[], $2::int[], $3::float8[], $4::float8[], $5::float8[], $6::float8[], $7::float8[], $8::float8[])`, [
        set.map((t) => t.axis),
        set.map((t) => (t.three ? 2 : 1)),
        set.map((t) => t.a),
        set.map((t) => t.b),
        set.map(() => 0.25),
        set.map((t) => t.y),
        thetaArr,
        r0Arr,
      ])
      if (want.lz_star === null) expect(rows[0]!.o_lz_star).toBeNull()
      else expect(Math.abs(rows[0]!.o_lz_star! - want.lz_star)).toBeLessThan(1e-9)
      expect(Math.abs(rows[0]!.o_lz! - want.lz!)).toBeLessThan(1e-9)
    }
    for (const ps of fc.sample(fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { maxLength: 30 }), 30)) {
      for (const x of [0, 1, Math.floor(ps.length / 2), ps.length, ps.length + 1]) {
        const { rows } = await db.owner.query<{ t: number }>(`select hb.pb_upper_tail($1::float8[], $2::int) as t`, [ps, x])
        expect(Math.abs(rows[0]!.t - poissonBinomialUpperTail(ps, x)), `x=${x}`).toBeLessThan(1e-12)
      }
    }
    // probabilities the sigmoid clamps to 1e-304 (a hard item far above theta) do not underflow the convolution
    const { rows } = await db.owner.query<{ t: number }>(`select hb.pb_upper_tail(array[1e-304, 1e-304, 0.5, 1e-200, 1]::float8[], 2) as t`)
    expect(rows[0]!.t).toBeCloseTo(0.5, 12)
  })
})

// -------------------------------------------------------------------------------------- eligibility
describe('calibration_eligible at finish (DESIGN §13)', () => {
  const chosen = spread(30)
  // medians of 40 s and 10 s alternate in pairs along each axis, so the chosen items have both
  const longIdx = chosen.map((it, i) => (it.expectedTimeS! > 20 ? i : -1)).filter((i) => i >= 0)
  const honest = (): (0 | 1)[] => {
    const rng = createRng('elig')
    return chosen.map((it) => (rng.next() < trueP(it, 0.2) ? 1 : 0))
  }
  const slow = chosen.map((_, i) => 20 + (i % 7) * 4)
  const timedSession = (over: { correct?: readonly (0 | 1)[]; elapsed?: readonly number[]; itemFlags?: readonly (Record<string, unknown> | undefined)[]; flags?: Record<string, unknown> } = {}): Promise<Played> =>
    synthetic({ items: chosen, correct: over.correct ?? honest(), elapsed: over.elapsed ?? slow, ...(over.itemFlags === undefined ? {} : { itemFlags: over.itemFlags }), ...(over.flags === undefined ? {} : { flags: over.flags }) })

  it('is true for a clean session', async () => {
    const p = await timedSession()
    expect(await eligibleOf(p.sessionId)).toBe(true)
    expect((await stateOf(p.sessionId)).integrity.too_fast.n).toBe(0)
  })

  it('counts a correct answer under a quarter of the median by the server\'s clock: one is a flag, two make the session ineligible', async () => {
    const correct = chosen.map(() => 1 as const)
    const fastAt = (idx: readonly number[]): number[] => slow.map((s, i) => (idx.includes(i) ? 3 : s))
    expect(longIdx.length).toBeGreaterThan(4)
    const one = await timedSession({ correct, elapsed: fastAt([longIdx[0]!]) })
    expect((await stateOf(one.sessionId)).integrity.too_fast.n).toBe(1)
    expect(await eligibleOf(one.sessionId)).toBe(true)
    // the same answer flagged by the client too counts once
    const sameItem = await timedSession({ correct, elapsed: fastAt([longIdx[0]!]), itemFlags: chosen.map((_, i) => (i === longIdx[0] ? { too_fast: true } : undefined)) })
    expect(await eligibleOf(sameItem.sessionId)).toBe(true)
    // another flag of the client on another answer makes two
    const plusPaste = await timedSession({ correct, elapsed: fastAt([longIdx[0]!]), itemFlags: chosen.map((_, i) => (i === longIdx[1] ? { paste: true } : undefined)) })
    expect(await eligibleOf(plusPaste.sessionId)).toBe(false)
    // two fast answers by the server's clock; the client reports nothing and cannot hide it
    const two = await timedSession({ correct, elapsed: fastAt([longIdx[0]!, longIdx[1]!]) })
    expect((await stateOf(two.sessionId)).integrity.too_fast.n).toBe(2)
    expect(await eligibleOf(two.sessionId)).toBe(false)
  })

  it('does not count a wrong answer, however fast, nor an item whose median is 20 s or less', async () => {
    const correct = chosen.map((_, i) => (i % 2 === 0 ? 1 : 0)) as (0 | 1)[]
    const elapsed = chosen.map((it, i) => (correct[i] === 0 ? 1 : it.expectedTimeS! > 20 ? 30 : 1))
    const p = await timedSession({ correct, elapsed })
    const shortRight = chosen.filter((it, i) => correct[i] === 1 && it.expectedTimeS! <= 20).length
    expect(shortRight).toBeGreaterThan(0) // right on a 10 s item in 1 s: not too fast
    expect((await stateOf(p.sessionId)).integrity.too_fast.n).toBe(0)
  })

  it('treats uniform times over items of very different lengths as one flag (the client\'s report counts once)', async () => {
    const same = chosen.map(() => 18)
    const p = await timedSession({ elapsed: same })
    const ev = (await stateOf(p.sessionId)).integrity
    expect(ev.uniform_rt).toMatchObject({ applies: true, flagged: true, n_items: 30 })
    expect(await eligibleOf(p.sessionId)).toBe(true) // one flag
    const both = await timedSession({ elapsed: same, flags: { uniform_rt: true } })
    expect(await eligibleOf(both.sessionId)).toBe(true) // the same flag from both sides is one
    const plusPaste = await timedSession({ elapsed: same, itemFlags: chosen.map((_, i) => (i === 2 ? { paste: true } : undefined)) })
    expect(await eligibleOf(plusPaste.sessionId)).toBe(false)
    const plusHard = await timedSession({ elapsed: same, flags: { hard_item_accuracy: true } })
    expect(await eligibleOf(plusHard.sessionId)).toBe(false)
  })

  it('takes the client\'s person-fit report and the server\'s own time check as before', async () => {
    const p = await timedSession({ flags: { person_fit: true } })
    expect(await eligibleOf(p.sessionId)).toBe(false)
    const q = await timedSession({ flags: { calibration_eligible: true, person_fit: true } })
    expect(await eligibleOf(q.sessionId)).toBe(false)
    const r = await timedSession({ flags: { calibration_eligible: false } })
    expect(await eligibleOf(r.sessionId)).toBe(true) // the client's own verdict is not taken, either way
  })

  it('is false for a session that has no answer, true again for one with evidence cleared (sessions written around the RPCs)', async () => {
    const p = await timedSession()
    await db.owner.query(`update public.sessions set state = state - 'integrity' where session_id = $1`, [p.sessionId])
    expect((await db.owner.query<{ e: boolean }>(`select hb.is_eligible($1) as e`, [p.sessionId])).rows[0]!.e).toBe(true)
    await db.owner.query(`update public.sessions set state = state || '{"integrity": {"v": 1, "error": "22003"}}'::jsonb where session_id = $1`, [p.sessionId])
    expect((await db.owner.query<{ e: boolean }>(`select hb.is_eligible($1) as e`, [p.sessionId])).rows[0]!.e).toBe(false)
  })
})

// ------------------------------------------------------------------------------- item parameters
describe('which item parameters a session uses', () => {
  it('scores a 2PL-testlet item as a 2PL, as the app does (the testlet effect waits for M3.9), in the EAP and the MAP', async () => {
    // 12 testlet items on RC, in status review except while this test plays them (no adaptive session is served them)
    const rc = Array.from({ length: 12 }, (_, k) => customItem(500 + k, 'RC', { model: '2pl_testlet', a: 1 + 0.05 * k, b: -1.2 + 0.2 * k, status: 'review' }))
    await loadFixtureBank(db, rc)
    await db.owner.query(`update public.items set status = 'live' where item_id = any($1)`, [rc.map((i) => i.itemId)])
    try {
      const rng = createRng('testlet-as-2pl')
      const ip = freshIp()
      const s = await startSession(db, ip)
      const answered = new Map<string, boolean>()
      await playSession(db, s, new Map(rc.map((i) => [i.itemId, i])), {
        ip,
        n: 12,
        decide: (it) => {
          const right = rng.next() < trueP(it, 0.2)
          answered.set(it.itemId, right)
          return right
        },
        axes: ['RC'],
      })
      expect(answered.size).toBe(12)
      const obs: Observation[] = rc.map((it) => ({ kind: '2pl', axis: 'RC', a: it.a, b: it.b, y: answered.get(it.itemId) ? 1 : 0 }))
      const w = eapAxis(obs, 0, 1)
      const { rows } = await db.owner.query<{ mean: number; sd: number; n: number }>(`select * from hb.session_posteriors((select state from public.sessions where session_id = $1)) where axis = 'RC'`, [s.session_id])
      expect(rows[0]!.n).toBe(12)
      expect(Math.abs(rows[0]!.mean - w.mean)).toBeLessThan(1e-9)
      expect(Math.abs(rows[0]!.sd - w.sd)).toBeLessThan(1e-9)
      await db.rpc(from(ip), 'finish', { p_token: s.token })
      const want = mapTheta(obs, new Array(17).fill(0), initialSigma())
      const post = (await stateOf(s.session_id)).posterior
      expect(post.n_obs).toBe(12)
      post.theta.forEach((t: number, i: number) => expect(Math.abs(t - want.theta[i]!)).toBeLessThan(1e-6))
    } finally {
      await db.owner.query(`update public.items set status = 'review' where item_id = any($1)`, [rc.map((i) => i.itemId)])
    }
  })

  it('uses the parameters of the session\'s param_version, not a newer row, once the project has one', async () => {
    await db.owner.query(`insert into public.app_config (key, value, description) values ('param_version', '"p-test"', 'test')`)
    try {
      const ip = freshIp()
      const s = await startSession(db, ip)
      expect(s.param_version).toBe('p-test')
      // a recalibration lands: every item has a newer row, a full logit harder
      await db.owner.query(`insert into public.item_parameters (item_id, param_version, model, a, b, c, extra, n_resp, created_at) select item_id, 'p-new', model, a, b + 3, c, extra, 0, now() + interval '1 hour' from public.item_parameters where param_version = 'p-test'`)
      await playSession(db, s, byId, { ip, n: 14, decide: person(0, 'pv'), axes: ['QR'] })
      const { rows } = await db.owner.query<{ item_id: string; correct: number }>(`select item_id, correct from public.responses where session_id = $1 order by seq`, [s.session_id])
      const obs: Observation[] = rows.map((r) => {
        const it = byId.get(r.item_id)!
        return it.model === '3pl' ? { kind: '3pl', axis: 'QR', a: it.a, b: it.b, c: it.c!, y: r.correct === 1 ? 1 : 0 } : { kind: '2pl', axis: 'QR', a: it.a, b: it.b, y: r.correct === 1 ? 1 : 0 }
      })
      const want = eapAxis(obs, 0, 1)
      const st = await stateOf(s.session_id)
      const { rows: got } = await db.owner.query<{ mean: number; sd: number }>(`select * from hb.session_posteriors($1::jsonb) where axis = 'QR'`, [JSON.stringify(st)])
      expect(Math.abs(got[0]!.mean - want.mean)).toBeLessThan(1e-9)
      expect(Math.abs(got[0]!.sd - want.sd)).toBeLessThan(1e-9)
      // and the pool is ranked on those parameters too
      const pool = await db.owner.query<{ o_item_id: string; o_info: number }>(`select * from hb.rank_live((select s from public.sessions s where s.session_id = $1), array['QR'], null)`, [s.session_id])
      for (const r of pool.rows) {
        const it = byId.get(r.o_item_id)!
        const z = it.a * (want.mean - it.b)
        const sg = 1 / (1 + Math.exp(-z))
        const info = it.model === '3pl' ? (it.a * it.a * sg * sg * (1 - it.c!) * (1 - sg)) / (it.c! + (1 - it.c!) * sg) : it.a * it.a * sg * (1 - sg)
        expect(Math.abs(r.o_info - info)).toBeLessThan(1e-9)
      }
    } finally {
      await db.owner.query(`delete from public.item_parameters where param_version = 'p-new'`)
      await db.owner.query(`delete from public.app_config where key = 'param_version'`)
    }
  })
})

// ------------------------------------------------------------------------------ nothing says why
describe('rescore does not say why a session was dropped (R-11.1)', () => {
  it('a misfit session and a short one look alike in the reply, and neither carries an eligibility', async () => {
    // one person, two sessions: the second is a misfit
    const ip = freshIp()
    const a = await startSession(db, ip)
    await playSession(db, a, byId, { ip, n: 36, decide: person(0.3, 'rs-a') })
    await db.rpc(from(ip), 'finish', { p_token: a.token })
    const ip2 = freshIp()
    const b = await startSession(db, ip2, {
      schema_version: '1.0.0',
      bank_version: 'test',
      anon_id: a.anon_id,
      created_utc: '2026-10-01T12:00:00Z',
      sessions: [{ session_id: a.session_id }],
      seen_items: [],
      seen_families: [],
    })
    expect(b.anon_id).toBe(a.anon_id)
    const chosen = spread(45)
    await db.owner.query(
      `insert into public.exposure_log (session_id, seq, item_id, family_id, sibling_group, pretest, served_at)
       select $1, t.seq, i.item_id, i.family_id, f.sibling_group, false, now() - interval '1 hour' + make_interval(secs => t.seq * 100)
         from unnest($2::text[]) with ordinality as t (item_id, seq) join public.items i on i.item_id = t.item_id join public.item_families f on f.family_id = i.family_id`,
      [b.session_id, chosen.map((i) => i.itemId)],
    )
    await db.owner.query(
      `insert into public.responses (session_id, seq, item_id, response, correct, score, rt_ms, pretest, client_flags, created_at)
       select $1, t.seq, t.item_id, to_jsonb(case when t.c = 1 then 0 else 1 end), t.c::smallint, t.c::real, 5000, false, '{}', e.served_at + interval '25 seconds'
         from unnest($2::text[], $3::int[]) with ordinality as t (item_id, c, seq) join public.exposure_log e on e.session_id = $1 and e.seq = t.seq`,
      [b.session_id, chosen.map((i) => i.itemId), chosen.map((i) => (i.b > 0 ? 1 : 0))],
    )
    await db.owner.query(`update public.sessions set n_served = 45, n_answered = 45 where session_id = $1`, [b.session_id])
    await db.rpc(from(ip2), 'finish', { p_token: b.token })
    expect(await eligibleOf(b.session_id)).toBe(false)
    const save = { schema_version: '1.0.0', bank_version: 'test', anon_id: a.anon_id, created_utc: '2026-10-01T12:00:00Z', sessions: [{ session_id: a.session_id }, { session_id: b.session_id }], seen_items: [], seen_families: [] }
    const got = await db.rpc<{ sessions: { session_id: string; n_scored: number }[]; skipped: Record<string, number>; eap: Record<string, unknown> }>(from(freshIp()), 'rescore', { p_save: save })
    expect(got.sessions.find((s) => s.session_id === b.session_id)!.n_scored).toBe(0)
    expect(got.sessions.find((s) => s.session_id === a.session_id)!.n_scored).toBeGreaterThan(0)
    expect(got.skipped.not_counted).toBe(45)
    expect(JSON.stringify(got)).not.toMatch(/eligib|person_fit|lz/)
  })
})
