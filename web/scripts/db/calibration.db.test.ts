/**
 * The server's Calibration (owner decision 2026-10-13: "yeah, lets add calibration to the live score if they submit
 * sufficient confidence data"; DESIGN §3 row 12, §7.1 "Calibration", §7.8, R-11.1; ROADMAP M2.1):
 * supabase/migrations/20261015000400_server_calibration.sql. rescore computes CAL from each session's rated answers
 * (valid scored answers with a confidence) with the app's observation model (tasks/calibration.ts
 * calibrationObservation, tasks/priors.ts CAL_NORMS), at least CAL_NORMS.min_responses of them a session, on the
 * own-axis grid with the practice model of every axis. The expected numbers come from the app's own engine
 * (engine/retest.ts rescoreRetest) on the same rows, compared to 1e-9 with the rounding off (EXACT), as
 * rescore.db.test.ts does for the item axes.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AXIS_CODES, type AxisCode } from '../../src/engine/axes'
import { createRng, type Rng } from '../../src/engine/prng'
import { rescoreRetest, type RetestSession } from '../../src/engine/retest'
import type { Observation } from '../../src/engine/types'
import { calibrationObservation, type RatedAnswer } from '../../src/tasks/calibration'
import { CAL_NORMS } from '../../src/tasks/priors'
import { fixtureBank, loadFixtureBank, type FixtureItem } from './bank-fixture'
import type { TestDb } from './harness'
import { emptySave, from, playSession, relaxSelection, signedSession, startSession, type Started } from './rpc-support'
import { MIGRATIONS_DIR, readMigrations } from './sql'
import { openTestDb } from './vitest'

let db: TestDb
let ipCounter = 0
const freshIp = (): string => `198.51.100.${++ipCounter}`
const items: FixtureItem[] = fixtureBank({ perAxis: 60, axes: ['QR', 'MAT'], seed: 'calibration', facets: 3 })
const bank = new Map(items.map((i) => [i.itemId, i]))
const TOL = 1e-9

const EXACT = { 'rescore.min_axis_items': 1, 'rescore.min_facet_items': 1, 'rescore.mean_step': 0, 'rescore.sd_step': 0 } as const
const PUBLISHED = { 'rescore.min_axis_items': 5, 'rescore.min_facet_items': 5, 'rescore.mean_step': 0.1, 'rescore.sd_step': 0.05 } as const

async function setConfig(values: Readonly<Record<string, number>>): Promise<void> {
  for (const [key, value] of Object.entries(values)) await db.owner.query(`update public.app_config set value = $2::jsonb where key = $1`, [key, JSON.stringify(value)])
}

beforeAll(async () => {
  db = await openTestDb()
  await relaxSelection(db)
  await loadFixtureBank(db, items)
  await setConfig(EXACT)
  await setConfig({ 'rate.rescores_per_anon_day': 1000, 'rate.rescores_per_day': 1000 })
})
afterAll(async () => {
  await db.close()
})

const issued = new Map<string, string[]>()

/**
 * One finished session of `anonId` with `n` answers of a person at `theta`; `conf(i)` is the confidence of answer i
 * (0-based), null for none (the scale left unset).
 */
async function takeSession(anonId: string | undefined, n: number, theta: number, rng: Rng, conf: (i: number) => number | null): Promise<{ sessionId: string; anonId: string }> {
  const ip = freshIp()
  const save = anonId === undefined ? undefined : await sign(emptySave(anonId, { sessions: (issued.get(anonId) ?? []).map((session_id) => ({ session_id })) }))
  const s: Started = await startSession(db, ip, save)
  issued.set(s.anon_id, [...(issued.get(s.anon_id) ?? []), s.session_id])
  let i = 0
  await playSession(db, s, bank, {
    ip,
    n,
    decide: (it) => {
      const p = (it.c ?? 0) + (1 - (it.c ?? 0)) / (1 + Math.exp(-it.a * (theta - it.b)))
      return rng.next() < p
    },
    confidence: () => conf(i++),
  })
  await db.rpc(from(ip), 'finish', { p_token: s.token })
  return { sessionId: s.session_id, anonId: s.anon_id }
}

async function schedule(sessionId: string, days: number): Promise<void> {
  await db.owner.query(
    `update public.sessions set started_at = timestamptz '2026-09-01 10:00:00+00' + make_interval(days => $2), finished_at = timestamptz '2026-09-01 10:30:00+00' + make_interval(days => $2) where session_id = $1`,
    [sessionId, days],
  )
}

async function sign(doc: Record<string, unknown>): Promise<Record<string, unknown>> {
  const sessions: unknown[] = []
  for (const entry of doc.sessions as { session_id: string }[]) sessions.push((await signedSession(db, entry.session_id)) ?? entry)
  return { ...doc, sessions }
}

interface Estimate {
  mean: number
  sd: number
  n: number
}
interface Reply {
  sessions: { session_id: string; known: boolean; ordinals: Record<string, number>; rho: Record<string, number>; n_scored: number }[]
  eap: Record<string, Estimate>
  facets: Record<string, Record<string, Estimate>>
  withheld: { eap: Record<string, number>; facets: Record<string, Record<string, number>> }
  limits: Record<string, number>
  skipped: Record<string, number>
}

const rescore = async (anonId: string, ids: readonly string[]): Promise<Reply> =>
  db.rpc<Reply>(from(freshIp()), 'rescore', { p_save: await sign(emptySave(anonId, { sessions: ids.map((session_id) => ({ session_id })) })) })

interface Row {
  session_id: string
  started_utc: string
  eligible: boolean
  pretest: boolean
  correct: number | null
  confidence: number | null
  status: string
  axis: AxisCode
  model: string
  a: number
  b: number
  c: number | null
}

/** What the app's engine says: the item observations and, from min_responses rated answers, the session's CAL observation. */
async function expectedFor(ids: readonly string[]): Promise<{ eap: Partial<Record<AxisCode, { mean: number; sd: number }>>; rated: number; rho: Map<string, Partial<Record<AxisCode, number>>> }> {
  const { rows } = await db.owner.query<Row>(
    `select s.session_id, to_char(s.started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as started_utc, s.calibration_eligible as eligible,
            r.pretest, r.correct, r.confidence, i.status, f.axis, p.model, p.a, p.b, p.c
       from public.sessions s join public.responses r using (session_id) join public.items i on i.item_id = r.item_id
       join public.item_families f on f.family_id = i.family_id join public.item_parameters p on p.item_id = r.item_id
      where s.session_id = any($1) order by s.session_id, r.seq`,
    [ids],
  )
  const sessions: RetestSession[] = []
  let rated = 0
  for (const sid of ids) {
    const mine = rows.filter((r) => r.session_id === sid)
    const observations: Observation[] = []
    const answers: RatedAnswer[] = []
    for (const r of mine) {
      const scorable = !r.pretest && r.status !== 'quarantined' && r.eligible && r.correct !== null && ['2pl', '2pl_testlet', '3pl'].includes(r.model)
      if (!scorable) continue
      observations.push(r.model === '3pl' ? { kind: '3pl', axis: r.axis, a: r.a, b: r.b, c: r.c!, y: r.correct as 0 | 1 } : { kind: '2pl', axis: r.axis, a: r.a, b: r.b, y: r.correct as 0 | 1 })
      if (r.confidence !== null) answers.push({ pct: r.confidence, correct: r.correct as 0 | 1 })
    }
    const cal = calibrationObservation(answers)
    if (cal !== null) {
      observations.push(cal)
      rated += answers.length
    }
    const exposed = new Set(mine.map((r) => r.axis))
    sessions.push({ session_id: sid, started_utc: mine[0]!.started_utc, observations, exposed_axes: AXIS_CODES.filter((k) => exposed.has(k)) })
  }
  const score = rescoreRetest(sessions)
  return { eap: score.eap, rated, rho: new Map(score.sessions.map((s) => [s.session_id, s.rho])) }
}

/** Confidences on the app's scale (five points of a four- or five-option item, and others), varied. */
const scale = [25, 44, 63, 81, 100, 20, 40, 60, 80, 50]
const rated = (i: number): number => scale[i % scale.length]!

describe('the server\'s Calibration: the app\'s model on the database\'s rows', () => {
  it('keeps CAL_NORMS and the minimum of ten rated answers as settings, the app\'s numbers exactly', async () => {
    const { rows } = await db.owner.query<{ key: string; value: unknown }>(`select key, value from public.app_config where key in ('cal.norms', 'rescore.min_cal_items')`)
    const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    expect(cfg['cal.norms']).toEqual({ version: CAL_NORMS.version, brier_mean: CAL_NORMS.brier_mean, brier_sd: CAL_NORMS.brier_sd, reliability: CAL_NORMS.reliability, residual_sd: CAL_NORMS.residual_sd })
    expect(cfg['rescore.min_cal_items']).toBe(CAL_NORMS.min_responses)
    expect(CAL_NORMS.min_responses).toBe(10)
  })

  it('gives the CAL posterior of the app\'s engine to 1e-9 on two sessions, the second credited with practice, the item axes unchanged', async () => {
    const rng = createRng('cal-a')
    const first = await takeSession(undefined, 16, 0.4, rng, (i) => rated(i))
    const second = await takeSession(first.anonId, 14, 0.4, rng, (i) => rated(i + 3))
    await schedule(first.sessionId, 0)
    await schedule(second.sessionId, 10)
    const ids = [first.sessionId, second.sessionId]
    const got = await rescore(first.anonId, ids)
    const want = await expectedFor(ids)
    expect(want.eap.CAL).toBeDefined()
    expect(Object.keys(got.eap).sort()).toEqual(Object.keys(want.eap).sort())
    for (const [axis, w] of Object.entries(want.eap)) {
      expect(Math.abs(got.eap[axis]!.mean - w.mean), `${axis} mean`).toBeLessThan(TOL)
      expect(Math.abs(got.eap[axis]!.sd - w.sd), `${axis} sd`).toBeLessThan(TOL)
    }
    expect(got.eap.CAL!.n).toBe(want.rated)
    expect(got.eap.CAL!.n).toBe(30)
    // CAL is a skill the practice model counts: the second session is its second test
    expect(got.sessions.map((s) => s.ordinals.CAL)).toEqual([1, 2])
    expect(got.sessions[1]!.rho.CAL!).toBeCloseTo(want.rho.get(second.sessionId)!.CAL!, 12)
    expect(got.sessions[1]!.rho.CAL!).toBeGreaterThan(0)
    expect(got.withheld.eap.CAL).toBeUndefined()
    expect(got.limits.min_cal_items).toBe(10)
  })

  it('needs ten rated answers in one session: nine give no CAL (their count is withheld), and two sessions of nine are not ten', async () => {
    const rng = createRng('cal-b')
    const nine = await takeSession(undefined, 15, 0, rng, (i) => (i < 9 ? rated(i) : null))
    let got = await rescore(nine.anonId, [nine.sessionId])
    expect(got.eap.CAL).toBeUndefined()
    expect(got.withheld.eap.CAL).toBe(9)
    expect(got.sessions[0]!.ordinals.CAL).toBeUndefined()
    expect((await expectedFor([nine.sessionId])).eap.CAL).toBeUndefined()
    const again = await takeSession(nine.anonId, 15, 0, rng, (i) => (i < 9 ? rated(i) : null))
    got = await rescore(nine.anonId, [nine.sessionId, again.sessionId])
    expect(got.eap.CAL).toBeUndefined()
    expect(got.withheld.eap.CAL).toBe(18)
    // the tenth makes it
    const ten = await takeSession(nine.anonId, 15, 0, rng, (i) => (i < 10 ? rated(i) : null))
    got = await rescore(nine.anonId, [ten.sessionId])
    expect(got.eap.CAL?.n).toBe(10)
  })

  it('ignores answers with no confidence: a session\'s unrated answers change nothing about its CAL', async () => {
    const rng = createRng('cal-c')
    const mixed = await takeSession(undefined, 20, -0.2, rng, (i) => (i % 2 === 0 ? rated(i) : null))
    const got = await rescore(mixed.anonId, [mixed.sessionId])
    const want = await expectedFor([mixed.sessionId])
    expect(got.eap.CAL!.n).toBe(10)
    expect(Math.abs(got.eap.CAL!.mean - want.eap.CAL!.mean)).toBeLessThan(TOL)
    expect(Math.abs(got.eap.CAL!.sd - want.eap.CAL!.sd)).toBeLessThan(TOL)
    // no confidence anywhere: no CAL and nothing withheld for it
    const none = await takeSession(mixed.anonId, 12, 0, rng, () => null)
    const bare = await rescore(mixed.anonId, [none.sessionId])
    expect(bare.eap.CAL).toBeUndefined()
    expect(bare.withheld.eap.CAL).toBeUndefined()
  })

  it('tells no verdict: the reply has the shape it had, with CAL as one more rounded axis and no per-answer data', async () => {
    await setConfig(PUBLISHED)
    try {
      const rng = createRng('cal-d')
      const s = await takeSession(undefined, 14, 0.5, rng, (i) => rated(i))
      const got = await rescore(s.anonId, [s.sessionId])
      expect(Object.keys(got).sort()).toEqual(['eap', 'facets', 'limits', 'param_version', 'retest_version', 'sessions', 'skipped', 'withheld'])
      expect(Object.keys(got.sessions[0]!).sort()).toEqual(['known', 'n_scored', 'ordinals', 'rho', 'session_id'])
      expect(Object.keys(got.eap.CAL!).sort()).toEqual(['mean', 'n', 'sd'])
      expect(got.facets.CAL).toBeUndefined()
      const onGrid = (x: number, step: number): boolean => Math.abs(x / step - Math.round(x / step)) < 1e-9
      expect(onGrid(got.eap.CAL!.mean, 0.1)).toBe(true)
      expect(onGrid(got.eap.CAL!.sd, 0.05)).toBe(true)
      const text = JSON.stringify(got)
      expect(text).not.toMatch(/"(correct|brier|confidence|verdict|y)"/)
    } finally {
      await setConfig(EXACT)
    }
  })

  it('returns no CAL when the norms are removed (the switch)', async () => {
    const rng = createRng('cal-e')
    const s = await takeSession(undefined, 12, 0, rng, (i) => rated(i))
    const saved = await db.owner.query<{ value: unknown }>(`select value from public.app_config where key = 'cal.norms'`)
    await db.owner.query(`delete from public.app_config where key = 'cal.norms'`)
    try {
      const got = await rescore(s.anonId, [s.sessionId])
      expect(got.eap.CAL).toBeUndefined()
      expect(got.withheld.eap.CAL).toBeUndefined()
      expect(got.sessions[0]!.ordinals.CAL).toBeUndefined()
      expect(got.eap.QR ?? got.eap.MAT).toBeDefined()
    } finally {
      await db.owner.query(`insert into public.app_config (key, value) values ('cal.norms', $1::jsonb)`, [JSON.stringify(saved.rows[0]!.value)])
    }
  })
})

describe('the migration', () => {
  const migrations = readMigrations(MIGRATIONS_DIR)
  const body = (suffix: string): string => {
    const sql = migrations.find((m) => m.name.endsWith(suffix))!.sql
    const start = sql.search(/create\s+or\s+replace\s+function\s+public\.rescore\s*\(/)
    return sql.slice(start, sql.indexOf('\n$$;', start) + 4)
  }

  it('re-creates rescore as the remaining families\' migration did (20261015000200_continuous_items.sql), with the Calibration added and nothing else changed', () => {
    const before = body('_continuous_items.sql').split('\n')
    const now = body('_server_calibration.sql').split('\n')
    // the six lines of the earlier body that carry an edit: the confidence carried (two), the CAL ordinals, CAL's n, the
    // withheld union and the limit in the reply; every other line is kept, in order
    const edited = [
      '      select k.session_id, k.started_utc, k.counts, r.pretest, r.correct,',
      '      select c.session_id, c.started_utc, c.counts, c.correct, c.axis, c.facet, c.model, c.a, c.b, c.c, c.cobs,',
      '    -- test numbers (§7.8): every session that took the axis, scored or not, in time order',
      '             (select pg_catalog.count(*) from obs o where o.axis = m.axis) as n',
      "               group by c.axis) w), '{}'::jsonb),",
      "        'min_axis_items', v_min_axis, 'min_facet_items', v_min_facet, 'mean_step', v_mean_step, 'sd_step', v_sd_step),",
    ]
    let k = 0
    const missing: string[] = []
    for (const line of before) {
      const at = now.indexOf(line, k)
      if (at < 0) missing.push(line)
      else k = at + 1
    }
    expect(missing).toEqual(edited)
    const added = now.filter((l) => !before.includes(l))
    // what is added names Calibration's own CTEs and settings only
    expect(added.join('\n')).toMatch(/cal_sess/)
    expect(added.filter((l) => /\b(obs|fll|facet_raw|axis_w|axis_mean)\b as \(/.test(l))).toEqual([])
    expect(added.length).toBeLessThan(60)
  })
})
