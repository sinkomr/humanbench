/**
 * M2.1 (ROADMAP M2.1 "Amended (Phase AI Part 2 ...)"; DESIGN §7.8; ROADMAP A12, A21, AI.8): rescore(save)
 * and its parity with the app. The expected values come from the TypeScript engine itself
 * (engine/retest.ts rescoreRetest, engine/scorer.ts eapAxis): the same observations, the same practice
 * model, the same grid, compared to 1e-9. The parity tests run with the minimum counts and the rounding
 * switched off (EXACT), because they compare the algorithm; the tests of what rescore withholds
 * (R-11.1, DESIGN §10, the owner decision of 2026-10-01 "rescore must not leak single-answer verdicts")
 * run with the published settings (PUBLISHED).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AXIS_CODES, type AxisCode } from '../../src/engine/axes'
import { rescoreRetest, type RetestSession } from '../../src/engine/retest'
import { eapAxis } from '../../src/engine/scorer'
import type { Observation } from '../../src/engine/types'
import { createRng, type Rng } from '../../src/engine/prng'
import { fixtureBank, loadFixtureBank, type FixtureItem } from './bank-fixture'
import type { TestDb } from './harness'
import { emptySave, from, playSession, startSession, type Started } from './rpc-support'
import { openTestDb, pgCode } from './vitest'

let db: TestDb
let ipCounter = 0
const freshIp = (): string => `198.51.100.${++ipCounter}`
const items: FixtureItem[] = fixtureBank({ perAxis: 90, axes: ['QR', 'MAT', 'KST'], seed: 'rescore', facets: 3 })
const bank = new Map(items.map((i) => [i.itemId, i]))
const TOL = 1e-9

/** What a person gets (the seed of app_config: schema.db.test.ts checks it): 5 items, 0.1 and 0.05 SD units. */
const PUBLISHED = { 'rescore.min_axis_items': 5, 'rescore.min_facet_items': 5, 'rescore.mean_step': 0.1, 'rescore.sd_step': 0.05 } as const
/** The algorithm without the protection, for the parity tests only. */
const EXACT = { 'rescore.min_axis_items': 1, 'rescore.min_facet_items': 1, 'rescore.mean_step': 0, 'rescore.sd_step': 0 } as const

async function setConfig(values: Readonly<Record<string, number>>): Promise<void> {
  for (const [key, value] of Object.entries(values)) {
    await db.owner.query(`update public.app_config set value = $2::jsonb where key = $1`, [key, JSON.stringify(value)])
  }
}

beforeAll(async () => {
  db = await openTestDb()
  await loadFixtureBank(db, items)
  await setConfig(EXACT)
  // the many calls of these tests are not what the per-anon_id limit is about (a test of its own sets it)
  await setConfig({ 'rate.rescores_per_anon_day': 1000 })
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

/** The sessions the server has issued to each anon_id: what the person's save would list as proof of the id. */
const issued = new Map<string, string[]>()

/** One finished session of `anonId`, with `n` answers drawn from a person at theta (per axis). */
async function takeSession(anonId: string | undefined, n: number, theta: Partial<Record<AxisCode, number>>, rng: Rng, itemFlags?: (seq: number) => Record<string, unknown> | undefined): Promise<Taken> {
  const ip = freshIp()
  // a returning person sends their save, whose sessions prove the anon_id (an unproven id would be replaced by a new one)
  const save = anonId === undefined ? undefined : emptySave(anonId, { sessions: (issued.get(anonId) ?? []).map((session_id) => ({ session_id })) })
  const s: Started = await startSession(db, ip, save)
  if (anonId !== undefined && s.anon_id !== anonId) throw new Error(`the save did not carry the anon_id ${anonId} over`)
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

/** Puts a session `days` after 2026-09-01 (so the order of sessions is under the test's control). */
async function schedule(sessionId: string, days: number): Promise<void> {
  await db.owner.query(
    `update public.sessions set started_at = timestamptz '2026-09-01 10:00:00+00' + make_interval(days => $2), finished_at = timestamptz '2026-09-01 10:30:00+00' + make_interval(days => $2) where session_id = $1`,
    [sessionId, days],
  )
}

interface Row {
  session_id: string
  started_utc: string
  eligible: boolean
  pretest: boolean
  correct: number | null
  status: string
  axis: AxisCode
  facet: string | null
  model: string
  a: number
  b: number
  c: number | null
}

async function rowsOf(sessionIds: readonly string[]): Promise<Row[]> {
  const { rows } = await db.owner.query<Row>(
    `select s.session_id, to_char(s.started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as started_utc, s.calibration_eligible as eligible,
            r.pretest, r.correct, i.status, f.axis, f.facet, p.model, p.a, p.b, p.c
       from public.sessions s join public.responses r using (session_id) join public.items i on i.item_id = r.item_id
       join public.item_families f on f.family_id = i.family_id join public.item_parameters p on p.item_id = r.item_id
      where s.session_id = any($1) order by s.session_id, r.seq`,
    [sessionIds],
  )
  return rows
}

const observationOf = (r: Row): Observation => (r.model === '3pl' ? { kind: '3pl', axis: r.axis, a: r.a, b: r.b, c: r.c as number, y: r.correct as 0 | 1 } : { kind: '2pl', axis: r.axis, a: r.a, b: r.b, y: r.correct as 0 | 1 })

interface Expected {
  eap: Partial<Record<AxisCode, { mean: number; sd: number; n: number }>>
  facets: Partial<Record<AxisCode, Record<string, { mean: number; sd: number; n: number }>>>
  ordinals: Map<string, Partial<Record<AxisCode, number>>>
  rho: Map<string, Partial<Record<AxisCode, number>>>
}

/** What the app's own engine says about the same sessions. */
async function expectedFor(sessionIds: readonly string[]): Promise<Expected> {
  const rows = await rowsOf(sessionIds)
  const sessions: RetestSession[] = []
  const facetObs = new Map<string, Observation[]>()
  for (const sid of sessionIds) {
    const mine = rows.filter((r) => r.session_id === sid)
    const observations: Observation[] = []
    const exposed = new Set<AxisCode>()
    for (const r of mine) {
      exposed.add(r.axis)
      const scorable = !r.pretest && r.status !== 'quarantined' && r.eligible && r.correct !== null && ['2pl', '2pl_testlet', '3pl'].includes(r.model)
      if (scorable) observations.push(observationOf(r))
    }
    sessions.push({ session_id: sid, started_utc: mine[0]!.started_utc, observations, exposed_axes: AXIS_CODES.filter((k) => exposed.has(k)) })
  }
  const score = rescoreRetest(sessions)
  const eap: Expected['eap'] = {}
  const counts = new Map<AxisCode, number>()
  for (const s of sessions) for (const o of s.observations) counts.set(o.axis, (counts.get(o.axis) ?? 0) + 1)
  for (const [axis, e] of Object.entries(score.eap)) eap[axis as AxisCode] = { mean: e.mean, sd: e.sd, n: counts.get(axis as AxisCode) ?? 0 }
  // facets: the facet's observations, adjusted by the same practice gains, on the axis posterior
  const ord = new Map<string, Partial<Record<AxisCode, number>>>()
  const rho = new Map<string, Partial<Record<AxisCode, number>>>()
  for (const ss of score.sessions) {
    ord.set(ss.session_id, ss.ordinals)
    rho.set(ss.session_id, ss.rho)
  }
  for (const sid of sessionIds) {
    for (const r of rows.filter((x) => x.session_id === sid)) {
      const scorable = !r.pretest && r.status !== 'quarantined' && r.eligible && r.correct !== null && ['2pl', '2pl_testlet', '3pl'].includes(r.model)
      if (!scorable || r.facet === null) continue
      const g = rho.get(sid)![r.axis]!
      const o = observationOf(r)
      const adj: Observation = o.kind === '3pl' ? { ...o, b: o.b - g } : o.kind === '2pl' ? { ...o, b: o.b - g } : o
      const key = `${r.axis}|${r.facet}`
      facetObs.set(key, [...(facetObs.get(key) ?? []), adj])
    }
  }
  const facets: Expected['facets'] = {}
  for (const [key, obs] of facetObs) {
    const [axis, facet] = key.split('|') as [AxisCode, string]
    const a = score.eap[axis]!
    const e = eapAxis(obs, a.mean, a.sd * a.sd)
    ;(facets[axis] ??= {})[facet] = { mean: e.mean, sd: e.sd, n: obs.length }
  }
  return { eap, facets, ordinals: ord, rho }
}

interface Result {
  retest_version: string
  param_version: string | null
  sessions: { session_id: string; known: boolean; calibration_eligible: boolean | null; ordinals: Record<string, number>; rho: Record<string, number>; n_scored: number }[]
  eap: Record<string, { mean: number; sd: number; n: number }>
  facets: Record<string, Record<string, { mean: number; sd: number; n: number }>>
  /** Counts of scored items for the axes and facets that were held back. */
  withheld: { eap: Record<string, number>; facets: Record<string, Record<string, number>> }
  limits: { min_axis_items: number; min_facet_items: number; mean_step: number; sd_step: number }
  skipped: Record<string, number>
}

const rescore = (saveDoc: unknown, ip = freshIp()): Promise<Result> => db.rpc<Result>(from(ip), 'rescore', { p_save: saveDoc })
const saveOf = (anonId: string, ids: readonly string[]): Record<string, unknown> => emptySave(anonId, { sessions: ids.map((id) => ({ session_id: id })) })

function expectParity(got: Result, want: Expected, ids: readonly string[]): void {
  expect(Object.keys(got.eap).sort()).toEqual(Object.keys(want.eap).sort())
  for (const [axis, w] of Object.entries(want.eap)) {
    const g = got.eap[axis]!
    expect(Math.abs(g.mean - w.mean), `${axis} mean`).toBeLessThan(TOL)
    expect(Math.abs(g.sd - w.sd), `${axis} sd`).toBeLessThan(TOL)
    expect(g.n, `${axis} n`).toBe(w.n)
  }
  expect(Object.keys(got.facets).sort()).toEqual(Object.keys(want.facets).sort())
  for (const [axis, byFacet] of Object.entries(want.facets)) {
    expect(Object.keys(got.facets[axis]!).sort(), axis).toEqual(Object.keys(byFacet).sort())
    for (const [facet, w] of Object.entries(byFacet)) {
      const g = got.facets[axis]![facet]!
      expect(Math.abs(g.mean - w.mean), `${axis}/${facet} mean`).toBeLessThan(TOL)
      expect(Math.abs(g.sd - w.sd), `${axis}/${facet} sd`).toBeLessThan(TOL)
      expect(g.n, `${axis}/${facet} n`).toBe(w.n)
    }
  }
  for (const id of ids) {
    const s = got.sessions.find((x) => x.session_id === id)!
    expect(s.known).toBe(true)
    expect(s.ordinals, id).toEqual(want.ordinals.get(id))
    for (const [axis, r] of Object.entries(want.rho.get(id)!)) expect(Math.abs(s.rho[axis]! - (r as number)), `${id} rho ${axis}`).toBeLessThan(TOL)
  }
}

describe('rescore: parity with the app engine', () => {
  it('gives the own-axis, practice-adjusted EAP of a person with three sessions (ROADMAP M2.1)', async () => {
    const rng = createRng('person-a')
    const first = await takeSession(undefined, 30, { QR: 0.8, MAT: -0.3, KST: 0.2 }, rng)
    const second = await takeSession(first.anonId, 24, { QR: 0.8, MAT: -0.3 }, rng)
    const third = await takeSession(first.anonId, 36, { QR: 0.8, MAT: -0.3, KST: 0.2 }, rng)
    await schedule(first.sessionId, 0)
    await schedule(second.sessionId, 9)
    await schedule(third.sessionId, 30)
    const ids = [first.sessionId, second.sessionId, third.sessionId]
    const got = await rescore(saveOf(first.anonId, ids))
    expect(got.retest_version).toBe('retest_v1')
    expect(Object.keys(got.eap).sort()).toEqual(['KST', 'MAT', 'QR'])
    expectParity(got, await expectedFor(ids), ids)
    // a later session is credited with some practice: rho rises with the test number
    expect(got.sessions[0]!.rho.QR).toBe(0)
    expect(got.sessions[2]!.rho.QR!).toBeGreaterThan(got.sessions[1]!.rho.QR!)
    // the practice plateau of a fluid axis is 0.45 and 0.25 for knowledge (DESIGN §7.8)
    expect(got.sessions[2]!.rho.KST!).toBeLessThan(0.25)
    expect(got.skipped.unknown_sessions).toBe(0)
  })

  it('does not depend on the order the save lists the sessions in, nor on a repeated entry', async () => {
    const rng = createRng('person-b')
    const a = await takeSession(undefined, 20, { QR: 0.1 }, rng)
    const b = await takeSession(a.anonId, 20, { QR: 0.1 }, rng)
    const c = await takeSession(a.anonId, 20, { QR: 0.1 }, rng)
    await schedule(a.sessionId, 2)
    await schedule(b.sessionId, 4)
    await schedule(c.sessionId, 6)
    const forward = await rescore(saveOf(a.anonId, [a.sessionId, b.sessionId, c.sessionId]))
    const shuffled = await rescore(saveOf(a.anonId, [c.sessionId, a.sessionId, b.sessionId, a.sessionId]))
    expect(shuffled.eap).toEqual(forward.eap)
    expect(shuffled.facets).toEqual(forward.facets)
    expect(shuffled.sessions.length).toBe(3)
  })

  it('counts an ineligible session as practice but scores none of it (A21)', async () => {
    const rng = createRng('person-c')
    const a = await takeSession(undefined, 24, { QR: 0.4, MAT: 0.4 }, rng)
    // two flagged answers: the session finishes ineligible, "but the user still gets results"
    const b = await takeSession(a.anonId, 24, { QR: 0.4, MAT: 0.4 }, rng, (seq) => (seq <= 2 ? { too_fast: true } : undefined))
    const c = await takeSession(a.anonId, 24, { QR: 0.4, MAT: 0.4 }, rng)
    await schedule(a.sessionId, 1)
    await schedule(b.sessionId, 5)
    await schedule(c.sessionId, 9)
    const ids = [a.sessionId, b.sessionId, c.sessionId]
    expect((await rowsOf([b.sessionId]))[0]!.eligible).toBe(false)
    const got = await rescore(saveOf(a.anonId, ids))
    expectParity(got, await expectedFor(ids), ids)
    expect(got.sessions.find((s) => s.session_id === b.sessionId)).toMatchObject({ calibration_eligible: false, n_scored: 0 })
    // the third session is the third test of the axis although only two sessions are scored
    expect(got.sessions.find((s) => s.session_id === c.sessionId)!.ordinals.QR).toBe(3)
    expect(got.skipped.ineligible_session).toBe(24)
  })

  it('leaves out pretest responses and responses on quarantined items (DESIGN §4.5), keeping the exposure', async () => {
    const rng = createRng('person-d')
    const a = await takeSession(undefined, 30, { QR: -0.2, MAT: 0.9, KST: 0.1 }, rng)
    const b = await takeSession(a.anonId, 30, { QR: -0.2, MAT: 0.9, KST: 0.1 }, rng)
    await schedule(a.sessionId, 3)
    await schedule(b.sessionId, 8)
    const ids = [a.sessionId, b.sessionId]
    await db.owner.query(`update public.responses set pretest = true where session_id = $1 and seq % 5 = 0`, [a.sessionId])
    await db.owner.query(
      `update public.items set status = 'quarantined' where item_id in (select item_id from public.responses where session_id = $1 and seq % 7 = 0)`,
      [b.sessionId],
    )
    const got = await rescore(saveOf(a.anonId, ids))
    expectParity(got, await expectedFor(ids), ids)
    expect(got.skipped.pretest).toBeGreaterThan(0)
    expect(got.skipped.quarantined).toBeGreaterThan(0)
  })

  it('skips block observations (GRM, Gaussian), unscored responses and items without parameters, and reports them', async () => {
    const rng = createRng('person-e')
    const a = await takeSession(undefined, 20, { QR: 0.3 }, rng)
    await schedule(a.sessionId, 1)
    const ids = [a.sessionId]
    // one answered item becomes a Gaussian block item, one has no parameter row, one has no stored correctness
    const answered = (await db.owner.query<{ item_id: string }>(`select item_id from public.responses where session_id = $1 order by seq limit 3`, [a.sessionId])).rows.map((r) => r.item_id)
    const saved = (await db.owner.query(`select * from public.item_parameters where item_id = any($1)`, [answered])).rows
    await db.owner.query(`update public.item_parameters set model = 'gaussian', a = null, b = null, c = null, extra = '{"lam":-1,"d":5.4,"sigma":0.2}' where item_id = $1`, [answered[0]])
    await db.owner.query(`delete from public.item_parameters where item_id = $1`, [answered[1]])
    await db.owner.query(`update public.responses set correct = null where session_id = $1 and item_id = $2`, [a.sessionId, answered[2]])
    try {
      const got = await rescore(saveOf(a.anonId, ids))
      expect(got.skipped).toMatchObject({ block: 1, no_params: 1, unscored: 1, unknown_sessions: 0 })
      expect(got.sessions[0]!.n_scored).toBe(17)
    } finally {
      await db.owner.query(`delete from public.item_parameters where item_id = any($1)`, [answered])
      for (const p of saved) {
        await db.owner.query(
          `insert into public.item_parameters (item_id, param_version, model, a, b, c, extra, n_resp, se_b, prior_source) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [p.item_id, p.param_version, p.model, p.a, p.b, p.c, p.extra, p.n_resp, p.se_b, p.prior_source],
        )
      }
    }
  })

  it('uses the configured param_version when there is one', async () => {
    const rng = createRng('person-f')
    const a = await takeSession(undefined, 12, { MAT: 0.5 }, rng)
    await schedule(a.sessionId, 1)
    await db.owner.query(`insert into public.app_config (key, value) values ('param_version', '"p-other"') on conflict (key) do update set value = excluded.value`)
    try {
      const got = await rescore(saveOf(a.anonId, [a.sessionId]))
      expect(got.param_version).toBe('p-other')
      expect(got.skipped.no_params).toBe(12)
      expect(got.eap).toEqual({})
      await db.owner.query(`update public.app_config set value = '"p-test"' where key = 'param_version'`)
      const again = await rescore(saveOf(a.anonId, [a.sessionId]))
      expect(Object.keys(again.eap).length).toBeGreaterThan(0)
      expect(again.skipped.no_params).toBeUndefined()
    } finally {
      await db.owner.query(`delete from public.app_config where key = 'param_version'`)
    }
  })
})

describe('rescore: sessions it does not know', () => {
  it('counts a session it did not issue, one of another anon_id, an unfinished one and a malformed entry as unknown, and uses none of their data', async () => {
    const rng = createRng('person-g')
    const mine = await takeSession(undefined, 12, { QR: 0.2 }, rng)
    const theirs = await takeSession(undefined, 12, { QR: 0.2 }, rng)
    const open = await startSession(db, freshIp(), emptySave(mine.anonId))
    await schedule(mine.sessionId, 1)
    const doc = emptySave(mine.anonId, {
      sessions: [{ session_id: mine.sessionId }, { session_id: theirs.sessionId }, { session_id: open.session_id }, { session_id: 's_neverissuedxx' }, 'junk', { no_id: true }, null],
    })
    const got = await rescore(doc)
    expect(got.sessions.map((s) => [s.session_id, s.known])).toEqual([
      [mine.sessionId, true],
      [theirs.sessionId, false],
      [open.session_id, false],
      ['s_neverissuedxx', false],
    ])
    expect(got.skipped.unknown_sessions).toBe(3)
    expectParity(got, await expectedFor([mine.sessionId]), [mine.sessionId])
  })

  it('returns empty maps for a save with no sessions', async () => {
    const got = await rescore(emptySave('hb_7Q3m9Kx2Vw5rT8pL'))
    expect(got).toMatchObject({ eap: {}, facets: {}, sessions: [], skipped: { unknown_sessions: 0 } })
  })

  it('refuses a save over the session limit', async () => {
    const rng = createRng('person-h')
    const mine = await takeSession(undefined, 10, { MAT: 0.2 }, rng)
    await schedule(mine.sessionId, 1)
    const tooMany = emptySave(mine.anonId, { sessions: Array.from({ length: 41 }, (_, i) => ({ session_id: `s_sess${String(i).padStart(8, '0')}` })) })
    let code: string | undefined
    try {
      await rescore(tooMany)
    } catch (e) {
      code = pgCode(e)
    }
    expect(code).toBe('PT413')
  })

  it('limits rescore calls per client address', async () => {
    const ip = freshIp()
    await db.owner.query(`update public.app_config set value = '2' where key = 'rate.rescores_per_day'`)
    try {
      await rescore(emptySave('hb_7Q3m9Kx2Vw5rT8pL'), ip)
      await rescore(emptySave('hb_7Q3m9Kx2Vw5rT8pL'), ip)
      let code: string | undefined
      try {
        await rescore(emptySave('hb_7Q3m9Kx2Vw5rT8pL'), ip)
      } catch (e) {
        code = pgCode(e)
      }
      expect(code).toBe('PT429')
    } finally {
      await db.owner.query(`update public.app_config set value = '20' where key = 'rate.rescores_per_day'`)
    }
  })
})

describe('rescore: cost', () => {
  it('scores 40 sessions of 100 answers well inside the anon statement timeout (3 s)', async () => {
    const rng = createRng('person-i')
    const first = await takeSession(undefined, 100, { QR: 0.3, MAT: 0.1, KST: -0.4 }, rng)
    const ids = [first.sessionId]
    await schedule(first.sessionId, 0)
    // 39 more sessions of the same person: copy the first one's rows (same items; the fixture bank has 270 items)
    for (let k = 1; k < 40; k++) {
      const sid = `s_copy${String(k).padStart(8, '0')}`
      await db.owner.query(
        `insert into public.sessions (session_id, anon_id, token_hash, bank_version, param_version, device, state, n_served, n_answered, started_at, finished_at, calibration_eligible)
         select $2, anon_id, extensions.digest($2, 'sha256'), bank_version, param_version, device, state, n_served, n_answered, started_at + make_interval(days => $3), finished_at + make_interval(days => $3), true
           from public.sessions where session_id = $1`,
        [first.sessionId, sid, k],
      )
      await db.owner.query(`insert into public.exposure_log (session_id, seq, item_id, family_id, sibling_group, served_at) select $2, seq, item_id, family_id, sibling_group, served_at from public.exposure_log where session_id = $1`, [first.sessionId, sid])
      await db.owner.query(`insert into public.responses (session_id, seq, item_id, response, correct, score, rt_ms, pretest, client_flags) select $2, seq, item_id, response, correct, score, rt_ms, pretest, client_flags from public.responses where session_id = $1`, [first.sessionId, sid])
      ids.push(sid)
    }
    const t0 = performance.now()
    const got = await rescore(saveOf(first.anonId, ids))
    const ms = performance.now() - t0
    expect(Object.keys(got.eap).sort()).toEqual(['KST', 'MAT', 'QR'])
    expect(got.sessions.length).toBe(40)
    expect(ms).toBeLessThan(2500)
  })
})

// ------------------------------------------------------------------------------------------ withheld
// R-11.1 / DESIGN §10: no correctness feedback on finite-bank items. finish() no longer carries the
// server's verdict on an answer, so the score is the one place it still shows: a posterior mean of one
// answer IS that answer. rescore therefore returns an axis (a facet) only from rescore.min_axis_items
// (min_facet_items) scored items, rounds what it returns, and is limited per address and per anon_id.

/** A finished session of `n` answers, all right or all wrong: the script of the key-harvesting probe. */
async function answerAll(n: number, right: boolean): Promise<Taken> {
  const ip = freshIp()
  const s = await startSession(db, ip)
  issued.set(s.anon_id, [s.session_id])
  await playSession(db, s, bank, { ip, n, decide: () => right })
  await db.rpc(from(ip), 'finish', { p_token: s.token })
  return { sessionId: s.session_id, anonId: s.anon_id, token: s.token, ip }
}

/**
 * Leaves exactly `keep` of the session's responses on `axis` (and `facet`, when given) scoring, by marking
 * the later ones pretest (DESIGN §4.5: pretest responses are not scored). Any `keep` can be set again.
 */
async function keepScored(sessionId: string, axis: AxisCode, keep: number, facet?: string): Promise<void> {
  await db.owner.query(
    `update public.responses r set pretest = (x.rank > $3)
       from (select r2.session_id, r2.seq, row_number() over (order by r2.seq) as rank
               from public.responses r2 join public.items i on i.item_id = r2.item_id join public.item_families f on f.family_id = i.family_id
              where r2.session_id = $1 and f.axis = $2 and ($4::text is null or f.facet = $4)) x
      where r.session_id = x.session_id and r.seq = x.seq`,
    [sessionId, axis, keep, facet ?? null],
  )
}

/** How many responses the session has on the axis (and facet). */
async function countOn(sessionId: string, axis: AxisCode, facet?: string): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(
    `select count(*)::int as n from public.responses r join public.items i on i.item_id = r.item_id join public.item_families f on f.family_id = i.family_id
      where r.session_id = $1 and f.axis = $2 and ($3::text is null or f.facet = $3)`,
    [sessionId, axis, facet ?? null],
  )
  return rows[0]!.n
}

/** The calls of a script that answers `n` items one way and asks what the server thinks of them. */
const reads = (got: Result): { axes: string[]; facets: string[] } => ({ axes: Object.keys(got.eap), facets: Object.keys(got.facets) })

describe('rescore: what it withholds (R-11.1, DESIGN §10; owner decision 2026-10-01)', () => {
  beforeAll(() => setConfig(PUBLISHED))
  afterAll(() => setConfig(EXACT))

  it('says nothing about a session of one to four answers, right or wrong: the probe that read a verdict out of rescore', async () => {
    for (const n of [1, 2, 3, 4]) {
      for (const right of [true, false]) {
        const s = await answerAll(n, right)
        const got = await rescore(saveOf(s.anonId, [s.sessionId]))
        // no axis and no facet, so no mean and no sd for the script to read; only counts of items
        expect(reads(got), `${n} answers, right=${right}`).toEqual({ axes: [], facets: [] })
        expect(got.sessions[0]).toMatchObject({ known: true, n_scored: n })
        const text = JSON.stringify(got)
        expect(text).not.toMatch(/"mean"|"sd"|"correct"|i:tst/)
        // the counts held back are the answers given, however they were scored
        expect(Object.values(got.withheld.eap).reduce((a, b) => a + b, 0)).toBe(n)
      }
    }
  })

  it('returns an axis from the fifth scored item, not before, and counts the items of all the save\'s sessions together', async () => {
    const rng = createRng('withheld-axis')
    const a = await takeSession(undefined, 45, { QR: 0.3, MAT: 0.3, KST: 0.3 }, rng)
    const ids = [a.sessionId]
    await schedule(a.sessionId, 1)
    expect(await countOn(a.sessionId, 'QR')).toBeGreaterThanOrEqual(9)
    for (const keep of [0, 1, 2, 3, 4, 5, 6, 9]) {
      await keepScored(a.sessionId, 'QR', keep)
      const got = await rescore(saveOf(a.anonId, ids))
      if (keep >= 5) {
        expect(got.eap.QR, `keep ${keep}`).toMatchObject({ n: keep })
        expect(got.withheld.eap.QR).toBeUndefined()
      } else {
        expect(got.eap.QR, `keep ${keep}`).toBeUndefined()
        expect(got.facets.QR, `keep ${keep}`).toBeUndefined()
        if (keep > 0) expect(got.withheld.eap.QR).toBe(keep)
      }
      // the other axes are not held back by QR having too few
      expect(got.eap.MAT).toBeDefined()
    }
    // 3 + 2 items in two sessions make 5: the count is over the save, not per session
    const b = await takeSession(a.anonId, 45, { QR: 0.3, MAT: 0.3, KST: 0.3 }, rng)
    await schedule(b.sessionId, 8)
    await keepScored(a.sessionId, 'QR', 3)
    await keepScored(b.sessionId, 'QR', 2)
    expect((await rescore(saveOf(a.anonId, [a.sessionId, b.sessionId]))).eap.QR).toMatchObject({ n: 5 })
    await keepScored(b.sessionId, 'QR', 1)
    const four = await rescore(saveOf(a.anonId, [a.sessionId, b.sessionId]))
    expect(four.eap.QR).toBeUndefined()
    expect(four.withheld.eap.QR).toBe(4)
    // and a session the save does not list adds nothing
    await keepScored(b.sessionId, 'QR', 9)
    expect((await rescore(saveOf(a.anonId, [a.sessionId]))).eap.QR).toBeUndefined()
  })

  it('returns a facet only from five scored items, and only for an axis it returns (A12)', async () => {
    const rng = createRng('withheld-facet')
    const a = await takeSession(undefined, 120, { QR: 0.1, MAT: 0.1, KST: 0.1 }, rng)
    await schedule(a.sessionId, 1)
    const ids = [a.sessionId]
    expect(await countOn(a.sessionId, 'MAT', 'mat_f0')).toBeGreaterThanOrEqual(6)
    expect(await countOn(a.sessionId, 'MAT', 'mat_f1')).toBeGreaterThanOrEqual(6)
    for (const keep of [1, 4, 5, 6]) {
      await keepScored(a.sessionId, 'MAT', 6, 'mat_f0')
      await keepScored(a.sessionId, 'MAT', keep, 'mat_f1')
      const got = await rescore(saveOf(a.anonId, ids))
      expect(got.facets.MAT!.mat_f0, `f0 with 6, f1 with ${keep}`).toMatchObject({ n: 6 })
      if (keep >= 5) {
        expect(got.facets.MAT!.mat_f1).toMatchObject({ n: keep })
        expect(got.withheld.facets.MAT?.mat_f1).toBeUndefined()
      } else {
        expect(got.facets.MAT!.mat_f1).toBeUndefined()
        expect(got.withheld.facets.MAT!.mat_f1).toBe(keep)
      }
      expect(got.eap.MAT).toBeDefined()
    }
    // a facet with plenty of items under an axis that is held back is held back with it
    await db.owner.query(`update public.responses set pretest = true where session_id = $1`, [a.sessionId])
    await keepScored(a.sessionId, 'MAT', 4)
    await db.owner.query(
      `update public.responses r set pretest = false where r.session_id = $1 and r.seq in (
         select r2.seq from public.responses r2 join public.items i on i.item_id = r2.item_id join public.item_families f on f.family_id = i.family_id
          where r2.session_id = $1 and f.axis = 'MAT' order by r2.seq limit 4)`,
      [a.sessionId],
    )
    const small = await rescore(saveOf(a.anonId, ids))
    expect(small.eap.MAT).toBeUndefined()
    expect(small.facets.MAT).toBeUndefined()
  })

  it('rounds the mean to a tenth and the sd up to a twentieth, within half a step of the exact value', async () => {
    const rng = createRng('rounding')
    const checked: string[] = []
    for (const [name, theta] of [['p', { QR: 1.1, MAT: -0.7, KST: 0.2 }], ['q', { QR: -0.4, MAT: 0.05, KST: 1.6 }], ['r', { QR: 0, MAT: 0, KST: 0 }]] as const) {
      const a = await takeSession(undefined, 60, theta, rng)
      const b = await takeSession(a.anonId, 60, theta, rng)
      await schedule(a.sessionId, 2)
      await schedule(b.sessionId, 12)
      const save = saveOf(a.anonId, [a.sessionId, b.sessionId])
      await setConfig(EXACT)
      const exact = await rescore(save)
      await setConfig(PUBLISHED)
      const got = await rescore(save)
      expect(got.limits).toEqual({ min_axis_items: 5, min_facet_items: 5, mean_step: 0.1, sd_step: 0.05 })
      expect(Object.keys(got.eap).sort(), name).toEqual(Object.keys(exact.eap).sort())
      const onGrid = (x: number, step: number): boolean => Math.abs(x / step - Math.round(x / step)) < 1e-9
      const compare = (g: { mean: number; sd: number; n: number }, e: { mean: number; sd: number; n: number }, what: string): void => {
        expect(onGrid(g.mean, 0.1), `${what} mean ${g.mean}`).toBe(true)
        expect(onGrid(g.sd, 0.05), `${what} sd ${g.sd}`).toBe(true)
        expect(Math.abs(g.mean - e.mean), `${what} mean`).toBeLessThanOrEqual(0.05 + 1e-9)
        // the sd is rounded up: never smaller than the exact one, and by less than a step
        expect(g.sd - e.sd, `${what} sd`).toBeGreaterThanOrEqual(-1e-9)
        expect(g.sd - e.sd, `${what} sd`).toBeLessThan(0.05 + 1e-9)
        expect(g.n, `${what} n`).toBe(e.n)
        checked.push(what)
      }
      for (const [axis, e] of Object.entries(exact.eap)) compare(got.eap[axis]!, e, `${name}/${axis}`)
      for (const [axis, byFacet] of Object.entries(exact.facets)) {
        for (const [facet, e] of Object.entries(byFacet)) {
          if (e.n >= 5) compare(got.facets[axis]![facet]!, e, `${name}/${axis}/${facet}`)
          else expect(got.facets[axis]?.[facet]).toBeUndefined()
        }
      }
    }
    // not vacuous: 3 people x 3 axes, and their facets
    expect(checked.length).toBeGreaterThanOrEqual(18)
  })

  it('rounds to the steps in app_config', async () => {
    const rng = createRng('steps')
    const a = await takeSession(undefined, 60, { QR: 0.9, MAT: -0.8, KST: 0.1 }, rng)
    await schedule(a.sessionId, 3)
    const save = saveOf(a.anonId, [a.sessionId])
    await setConfig({ 'rescore.mean_step': 0.5, 'rescore.sd_step': 0.25 })
    try {
      const got = await rescore(save)
      expect(got.limits).toMatchObject({ mean_step: 0.5, sd_step: 0.25 })
      for (const e of Object.values(got.eap)) {
        expect(Math.abs(e.mean / 0.5 - Math.round(e.mean / 0.5))).toBeLessThan(1e-9)
        expect(Math.abs(e.sd / 0.25 - Math.round(e.sd / 0.25))).toBeLessThan(1e-9)
      }
    } finally {
      await setConfig(PUBLISHED)
    }
  })

  it('has the rounding functions behave: halves away from zero, no float noise, no negative zero, the sd up', async () => {
    const q = async (sql: string): Promise<number> => Number((await db.owner.query<{ v: number }>(`select ${sql} as v`)).rows[0]!.v)
    expect(await q('hb.quantise_round(0.3::float8, 0.1::float8)')).toBe(0.3)
    expect(await q('hb.quantise_round(0.349999::float8, 0.1::float8)')).toBe(0.3)
    expect(await q('hb.quantise_round(0.35::float8, 0.1::float8)')).toBe(0.4)
    expect(await q('hb.quantise_round(-0.35::float8, 0.1::float8)')).toBe(-0.4)
    expect(Object.is(await q('hb.quantise_round(-0.04::float8, 0.1::float8)'), 0)).toBe(true)
    expect(await q('hb.quantise_round(1.234::float8, 0::float8)')).toBe(1.234)
    expect(await q('hb.quantise_up(0.3::float8, 0.05::float8)')).toBe(0.3)
    expect(await q('hb.quantise_up(0.30000000000000004::float8, 0.05::float8)')).toBe(0.3)
    expect(await q('hb.quantise_up(0.301::float8, 0.05::float8)')).toBe(0.35)
    expect(await q('hb.quantise_up(0.0001::float8, 0.05::float8)')).toBe(0.05)
    expect(await q('hb.quantise_up(0.2::float8, 0::float8)')).toBe(0.2)
  })

  it('does not publish at a smaller minimum than one item, nor with a negative step', async () => {
    const s = await answerAll(2, true)
    await setConfig({ 'rescore.min_axis_items': 0, 'rescore.min_facet_items': -3, 'rescore.mean_step': -1, 'rescore.sd_step': -1 })
    try {
      const got = await rescore(saveOf(s.anonId, [s.sessionId]))
      expect(got.limits).toEqual({ min_axis_items: 1, min_facet_items: 1, mean_step: 0, sd_step: 0 })
    } finally {
      await setConfig(PUBLISHED)
    }
  })
})

describe('rescore: the anon_id is the caller\'s (a sig.anon_id may only repeat it)', () => {
  beforeAll(() => setConfig(EXACT))

  it('counts a session as unknown when it was issued to another anon_id than the save names, whatever its sig says', async () => {
    const rng = createRng('anon-binding')
    const victim = await takeSession(undefined, 30, { QR: 0.5, MAT: 0.5, KST: 0.5 }, rng)
    const stranger = await takeSession(undefined, 30, { QR: -0.5, MAT: -0.5, KST: -0.5 }, rng)
    await schedule(victim.sessionId, 1)
    await schedule(stranger.sessionId, 1)
    const sig = (anon: string): Record<string, unknown> => ({ alg: 'HMAC-SHA256', kid: 'k', mac: 'x', anon_id: anon })
    const knownOf = async (doc: Record<string, unknown>): Promise<boolean[]> => (await rescore(doc)).sessions.map((s) => s.known)

    // the honest cases: the save names the anon_id the session was issued to, with or without a sig repeating it
    expect(await knownOf(saveOf(victim.anonId, [victim.sessionId]))).toEqual([true])
    expect(await knownOf(emptySave(victim.anonId, { sessions: [{ session_id: victim.sessionId, sig: sig(victim.anonId) }] }))).toEqual([true])
    // a merged file names one anon_id; the session of another one is not that caller's, even with a sig that says whose it is
    // (before this fix the sig.anon_id replaced the save's: rescore would score a session of an id the caller never named)
    expect(await knownOf(emptySave(stranger.anonId, { sessions: [{ session_id: victim.sessionId, sig: sig(victim.anonId) }] }))).toEqual([false])
    // a sig naming another id than the save does not move the session to it
    expect(await knownOf(emptySave(victim.anonId, { sessions: [{ session_id: victim.sessionId, sig: sig(stranger.anonId) }] }))).toEqual([false])
    // a stranger's own session under the victim's id, with a sig repeating that id: it is not the victim's
    expect(await knownOf(emptySave(victim.anonId, { sessions: [{ session_id: stranger.sessionId, sig: sig(victim.anonId) }] }))).toEqual([false])
    // and the stranger's own session under the stranger's id is theirs
    expect(await knownOf(emptySave(stranger.anonId, { sessions: [{ session_id: stranger.sessionId }] }))).toEqual([true])

    // nothing of the victim's data comes out of a call that does not hold the victim's id
    const leak = await rescore(emptySave(stranger.anonId, { sessions: [{ session_id: victim.sessionId, sig: sig(victim.anonId) }] }))
    expect(leak.eap).toEqual({})
    expect(leak.facets).toEqual({})
    expect(leak.sessions[0]).toMatchObject({ known: false, calibration_eligible: null, n_scored: 0 })
    expect(leak.skipped.unknown_sessions).toBe(1)
  })

  it('takes the entry of a repeated session that the caller owns, whichever comes first', async () => {
    const rng = createRng('anon-duplicate')
    const mine = await takeSession(undefined, 20, { QR: 0.2, MAT: 0.2, KST: 0.2 }, rng)
    await schedule(mine.sessionId, 1)
    const bad = { session_id: mine.sessionId, sig: { alg: 'HMAC-SHA256', kid: 'k', mac: 'x', anon_id: 'hb_7Q3m9Kx2Vw5rT8pL' } }
    const good = { session_id: mine.sessionId }
    for (const order of [[bad, good], [good, bad]]) {
      const got = await rescore(emptySave(mine.anonId, { sessions: order }))
      expect(got.sessions.length).toBe(1)
      expect(got.sessions[0]).toMatchObject({ known: true })
      expect(Object.keys(got.eap).length).toBeGreaterThan(0)
    }
  })
})

describe('rescore: the call limits', () => {
  beforeAll(() => setConfig(EXACT))

  it('is limited per anon_id as well as per address, counting only calls that hold a session of that anon_id', async () => {
    const rng = createRng('anon-limit')
    const mine = await takeSession(undefined, 12, { QR: 0.2 }, rng)
    const other = await takeSession(undefined, 12, { QR: 0.2 }, rng)
    await schedule(mine.sessionId, 1)
    await schedule(other.sessionId, 1)
    await db.owner.query(`update public.app_config set value = '2' where key = 'rate.rescores_per_anon_day'`)
    try {
      const code = async (doc: Record<string, unknown>, ip?: string): Promise<string> => {
        try {
          await rescore(doc, ip)
          return 'ok'
        } catch (e) {
          return pgCode(e) ?? 'error'
        }
      }
      // a stranger who knows the id but holds none of its sessions (an empty save, or sessions of someone else's)
      // does not use its calls up
      for (let i = 0; i < 4; i++) expect(await code(emptySave(mine.anonId))).toBe('ok')
      expect(await code(saveOf(mine.anonId, [other.sessionId]))).toBe('ok')
      expect(await code(saveOf(mine.anonId, [other.sessionId]))).toBe('ok')
      // the person's own calls, each from a different address: the address limit is not what stops the third
      expect(await code(saveOf(mine.anonId, [mine.sessionId]))).toBe('ok')
      expect(await code(saveOf(mine.anonId, [mine.sessionId]))).toBe('ok')
      expect(await code(saveOf(mine.anonId, [mine.sessionId]))).toBe('PT429')
      // and the stranger is not stopped by the person's calls having run out
      expect(await code(emptySave(mine.anonId))).toBe('ok')
      // another anon_id has its own count
      expect(await code(saveOf(other.anonId, [other.sessionId]))).toBe('ok')
      // a call refused for the anon_id is not counted against the address either (the raise rolls it back)
      await db.owner.query(`update public.app_config set value = '1' where key = 'rate.rescores_per_day'`)
      const ip = freshIp()
      expect(await code(saveOf(mine.anonId, [mine.sessionId]), ip)).toBe('PT429')
      expect(await code(emptySave(other.anonId), ip)).toBe('ok')
      expect(await code(emptySave(other.anonId), ip)).toBe('PT429')
    } finally {
      await db.owner.query(`update public.app_config set value = '20' where key = 'rate.rescores_per_day'`)
      await db.owner.query(`update public.app_config set value = '1000' where key = 'rate.rescores_per_anon_day'`)
    }
  })
})
