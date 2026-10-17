/**
 * The 80% intervals of the Fermi answers on the server (ROADMAP M5.1; DESIGN §3 rows 11 and 12, §7.1, §14.3 M5 "Brier
 * computed server-side"; supabase/migrations/20261017000100_fermi_intervals.sql):
 *
 *   - hb.fermi_summary sums a list of answers exactly as the device does (`tasks/fermi/scoring.ts` summarise, the bank's
 *     `hb.fermi.scoring.summarise`): the golden summaries of `fermi_scoring_v1.json` and fuzzed lists, to 1e-9;
 *   - finish keeps the session's summary in `state.fermi_intervals` (hit rate, 0.8 − hit rate, the Brier score of the
 *     80% statements); a session without a Fermi answer keeps none;
 *   - nothing reads it to score and no reply carries it: rescore's Calibration stays the confidence ratings' (owner
 *     decision (11) open: whether hits enter θ_CAL), and the API roles cannot call either function (R-11.1).
 *
 * Every item is made up at run time (`families-fixture.ts`).
 */

import fc from 'fast-check'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fermiGolden from '../../src/engine/__fixtures__/fermi_scoring_v1.json'
import { parseFermiResponse, scoreFermi, summarise, type FermiResponse, type FermiSummary, type FermiTruth } from '../../src/tasks/fermi/scoring'
import { customItem, loadFixtureBank, type FixtureItem } from './bank-fixture'
import { fermiItems } from './families-fixture'
import { ANON, AUTHENTICATED, SERVICE_ROLE, type TestDb } from './harness'
import { ageExposures, emptySave, from, isServed, signedSession, startSession, type Next, type Started } from './rpc-support'
import { PERMISSION_DENIED, openTestDb, rejectedWith } from './vitest'

const TOL = 1e-9
const KEYS: readonly (keyof FermiSummary)[] = ['n', 'total_weight', 'mean_abs_error_dex', 'median_abs_error_dex', 'hit_rate', 'in_the_large', 'mean_interval_score_dex', 'interval_brier']

interface GoldenCase {
  id: string
  truth: FermiTruth
  response: FermiResponse
}
const golden = fermiGolden as unknown as { cases: GoldenCase[]; summaries: { id: string; cases: string[]; summary: FermiSummary }[] }
const byId = new Map(golden.cases.map((c) => [c.id, c]))

let db: TestDb
let bank: Map<string, FixtureItem>
let ipCounter = 0
const freshIp = (): string => {
  const n = ++ipCounter
  return `198.19.${Math.floor(n / 250)}.${(n % 250) + 1}`
}

const summaryOf = async (pairs: readonly { key: unknown; response: unknown }[]): Promise<(FermiSummary & { hits: number }) | null> =>
  (await db.owner.query<{ v: (FermiSummary & { hits: number }) | null }>(`select hb.fermi_summary($1::jsonb) as v`, [JSON.stringify(pairs)])).rows[0]!.v

function expectSummary(got: (FermiSummary & { hits: number }) | null, want: FermiSummary | null, label: string): void {
  if (want === null) {
    expect(got, label).toBeNull()
    return
  }
  expect(got, label).not.toBeNull()
  for (const k of KEYS) expect(Math.abs((got![k] as number) - (want[k] as number)), `${label} ${k}`).toBeLessThan(TOL)
}

beforeAll(async () => {
  db = await openTestDb()
  const items = [...fermiItems(12, 'intervals'), ...Array.from({ length: 8 }, (_, k) => customItem(700 + k, 'MAT', { b: -1 + 0.3 * k }))]
  await loadFixtureBank(db, items)
  for (const [key, value] of Object.entries({ 'selection.exposure_cap': 1000, 'selection.pretest_share': 0, 'rate.sessions_per_day': 1000, 'rate.rescores_per_anon_day': 1000 }))
    await db.owner.query(`update public.app_config set value = $2::jsonb where key = $1`, [key, JSON.stringify(value)])
  bank = new Map(items.map((i) => [i.itemId, i]))
})
afterAll(async () => {
  await db.close()
})

/** Plays `axis` for `n` answers with `respond`, then finishes; the session. */
async function played(axis: string, n: number, respond: (item: FixtureItem, i: number) => unknown): Promise<Started & { ip: string }> {
  const ip = freshIp()
  const s = { ...(await startSession(db, ip)), ip }
  let next = await db.rpc<Next>(from(ip), 'next_item', { p_token: s.token, p_axes: [axis] })
  for (let i = 0; i < n && isServed(next); i++) {
    await ageExposures(db, s.session_id, 30)
    const out = await db.rpc<{ next?: Next }>(from(ip), 'submit', { p_token: s.token, p_item_id: next.item.item_id, p_response: respond(bank.get(next.item.item_id)!, i), p_rt_ms: 9000, p_axes: [axis] })
    next = out.next ?? { done: true, reason: 'not_asked' }
  }
  const fin = await db.rpc<Record<string, unknown>>(from(ip), 'finish', { p_token: s.token })
  expect(JSON.stringify(fin)).not.toMatch(/fermi_intervals|hit_rate|interval_brier/)
  return s
}

describe('hb.fermi_summary: the device summary, to 1e-9', () => {
  it('equals every golden summary and the app engine on its cases', async () => {
    expect(golden.summaries.length).toBeGreaterThanOrEqual(5)
    for (const g of golden.summaries) {
      const cases = g.cases.map((id) => byId.get(id)!)
      const got = await summaryOf(cases.map((c) => ({ key: c.truth, response: c.response })))
      expectSummary(got, g.summary, g.id)
      expectSummary(got, summarise(cases.map((c) => scoreFermi(c.response, c.truth))), `${g.id} (app)`)
      expect(got!.hits, g.id).toBe(cases.filter((c) => scoreFermi(c.response, c.truth).hit).length)
    }
  })

  it('agrees with the app on fuzzed lists of golden answers mixed with malformed ones (left out on both sides), and is null with no valid answer', async () => {
    const malformed = [{ key: golden.cases[0]!.truth, response: { value: 5, unit: 's', low: 10, high: 1 } }, { key: golden.cases[0]!.truth, response: 'no' }, { key: { true_value: 'x' }, response: golden.cases[0]!.response }]
    const lists = fc.sample(fc.array(fc.oneof(fc.constantFrom(...golden.cases).map((c) => ({ key: c.truth as unknown, response: c.response as unknown })), fc.constantFrom(...malformed)), { maxLength: 14 }), 60)
    for (const list of lists) {
      const scores = list.flatMap((p) => {
        try {
          return [scoreFermi(parseFermiResponse(p.response), p.key as FermiTruth)]
        } catch {
          return []
        }
      })
      expectSummary(await summaryOf(list), summarise(scores), JSON.stringify(list).slice(0, 200))
    }
    expect(await summaryOf([])).toBeNull()
    expect(await summaryOf(malformed)).toBeNull()
  })
})

describe('finish records the session’s intervals; nothing scores with them', () => {
  it('keeps state.fermi_intervals for a session with Fermi answers, equal to the app’s summary of what the session answered', async () => {
    const s = await played('FER', 7, (it, i) => {
      const t = Number((it.key as { true_value: string }).true_value)
      const value = t * 10 ** (((i % 4) - 1.5) * 0.5)
      return { value, unit: 'count', low: value / (i % 2 === 0 ? 1.5 : 20), high: value * (i % 3 === 0 ? 1.2 : 15) }
    })
    const { rows } = await db.owner.query<{ item_id: string; response: FermiResponse }>(`select item_id, response from public.responses where session_id = $1 order by seq`, [s.session_id])
    expect(rows.length).toBe(7)
    const want = summarise(rows.map((r) => scoreFermi(r.response, bank.get(r.item_id)!.key as unknown as FermiTruth)))
    const stored = (await db.owner.query<{ v: (FermiSummary & { hits: number; v: number }) | null }>(`select state -> 'fermi_intervals' as v from public.sessions where session_id = $1`, [s.session_id])).rows[0]!.v
    expectSummary(stored, want, 'stored')
    expect(stored!.v).toBe(1)
    expect(stored!.hits).toBeGreaterThan(0)
    expect(stored!.hits).toBeLessThan(7)
    // the same function on demand
    expectSummary((await db.owner.query<{ v: FermiSummary }>(`select hb.fermi_session_summary($1) as v`, [s.session_id])).rows[0]!.v, want, 'on demand')
  })

  it('keeps none for a session without a Fermi answer', async () => {
    const s = await played('MAT', 6, (_it, i) => i % 4)
    const v = (await db.owner.query<{ v: unknown }>(`select state -> 'fermi_intervals' as v from public.sessions where session_id = $1`, [s.session_id])).rows[0]!.v
    expect(v).toBeNull()
    expect((await db.owner.query<{ v: unknown }>(`select state ? 'posterior' as v from public.sessions where session_id = $1`, [s.session_id])).rows[0]!.v).toBe(true)
  })

  it('changes no reply: rescore of a session is the same with the summary removed from its state', async () => {
    const s = await played('FER', 6, (it) => {
      const t = Number((it.key as { true_value: string }).true_value)
      return { value: t * 2, unit: 'count', low: t / 2, high: t * 4 }
    })
    const save = emptySave(s.anon_id, { sessions: [await signedSession(db, s.session_id)] })
    const before = await db.rpc(from(freshIp()), 'rescore', { p_save: save })
    expect(JSON.stringify(before)).not.toMatch(/fermi_intervals|hit_rate|interval_brier/)
    await db.owner.query(`update public.sessions set state = state - 'fermi_intervals' where session_id = $1`, [s.session_id])
    expect(await db.rpc(from(freshIp()), 'rescore', { p_save: save })).toEqual(before)
  })

  it('lets no API role call either function (R-11.1)', async () => {
    for (const ctx of [ANON, AUTHENTICATED, SERVICE_ROLE]) {
      expect(await rejectedWith(db.query(ctx, `select hb.fermi_summary('[]'::jsonb)`))).toBe(PERMISSION_DENIED)
      expect(await rejectedWith(db.query(ctx, `select hb.fermi_session_summary('s_x')`))).toBe(PERMISSION_DENIED)
    }
  })
})
