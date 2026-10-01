/**
 * M2.1 (ROADMAP M2.1 "Amended (Phase AI Part 2 ...)"; DESIGN §7.8; ROADMAP A12, A21, AI.8): rescore(save)
 * and its parity with the app. The expected values come from the TypeScript engine itself
 * (engine/retest.ts rescoreRetest, engine/scorer.ts eapAxis): the same observations, the same practice
 * model, the same grid, compared to 1e-9.
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

beforeAll(async () => {
  db = await openTestDb()
  await loadFixtureBank(db, items)
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

  it('honours the bound anon_id of a session (sig.anon_id) and refuses a save over the session limit', async () => {
    const rng = createRng('person-h')
    const mine = await takeSession(undefined, 10, { MAT: 0.2 }, rng)
    await schedule(mine.sessionId, 1)
    const merged = emptySave('hb_7Q3m9Kx2Vw5rT8pL', { sessions: [{ session_id: mine.sessionId, sig: { alg: 'HMAC-SHA256', kid: 'k', mac: 'x', anon_id: mine.anonId } }] })
    expect((await rescore(merged)).sessions[0]).toMatchObject({ known: true })
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
      await db.owner.query(`update public.app_config set value = '200' where key = 'rate.rescores_per_day'`)
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
