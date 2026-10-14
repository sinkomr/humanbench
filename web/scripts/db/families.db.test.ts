/**
 * The remaining families on the server (ROADMAP M3.11; owner decisions 2026-10-13: "work on the fermi estimation scoring,
 * and the logic games screen, the remaining families", "i don't want to use a model for any scoring"):
 *
 *   - 20261015000100_rat_answers.sql: a word-links answer is scored against the item's accept list, folded as the app
 *     and the bank fold it (the shared golden vectors, `m6_scoring_v1.json`);
 *   - 20261015000200_continuous_items.sql: Fermi estimates (Gaussian) and situational judgments (GRM) are selected,
 *     served, scored, enter the session's EAP, its MAP at finish and rescore(); the device scorer
 *     (`tasks/fermi/scoring.ts`, `tasks/sjt/scoring.ts`) and the server agree to 1e-6 on the golden vectors and on
 *     fuzzed ones; on EMO the selector alternates vignettes and situational judgments;
 *   - 20261015000300_live_axes.sql: `live_axes` names the skills a session can be served, and nothing else;
 *   - key secrecy: no truth, unit of the truth, uncertainty, accept list, rating profile, tolerance, rationale or
 *     parameter is in any reply (fuzzed, with the canary words of the made-up keys).
 *
 * Every item here is made up at run time and says so (`families-fixture.ts`). Each describe has a database of its own.
 */

import fc from 'fast-check'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fermiGolden from '../../src/engine/__fixtures__/fermi_scoring_v1.json'
import m6Golden from '../../src/engine/__fixtures__/m6_scoring_v1.json'
import { observationLoglik } from '../../src/engine/irt'
import { EAP_HI, EAP_LO, EAP_N_GRID } from '../../src/engine/scorer'
import type { Observation } from '../../src/engine/types'
import { fermiParams } from '../../src/tasks/priors'
import { answerKey, matches } from '../../src/tasks/rat/answers'
import { fermiObservation, parseFermiResponse, scoreFermi, type FermiResponse, type FermiTruth } from '../../src/tasks/fermi/scoring'
import { UNITS } from '../../src/tasks/fermi/units'
import { ratingScore, scoreCategory } from '../../src/tasks/sjt/scoring'
import { customItem, loadFixtureBank, type FixtureItem } from './bank-fixture'
import { fermiItems, logicGameItems, ratItems, sjtItems, vignetteItems } from './families-fixture'
import type { TestDb } from './harness'
import { ageExposures, emptySave, from, isServed, signedSession, startSession, type Next, type Served, type Started } from './rpc-support'
import { openTestDb } from './vitest'

const TOL = 1e-6

let ipCounter = 0
const freshIp = (): string => {
  const n = ++ipCounter
  return `198.18.${Math.floor(n / 250)}.${(n % 250) + 1}`
}

interface Scenario {
  db: TestDb
  bank: Map<string, FixtureItem>
}
type Session = Started & { ip: string }

async function scenario(items: readonly FixtureItem[], config: Readonly<Record<string, unknown>> = {}): Promise<Scenario> {
  const db = await openTestDb()
  await loadFixtureBank(db, items)
  const settings = { 'selection.exposure_cap': 1000, 'selection.pretest_share': 0, 'rate.rescores_per_anon_day': 1000, 'rate.sessions_per_day': 1000, ...config }
  for (const [key, value] of Object.entries(settings)) await db.owner.query(`update public.app_config set value = $2::jsonb where key = $1`, [key, JSON.stringify(value)])
  return { db, bank: new Map(items.map((i) => [i.itemId, i])) }
}

async function start(sc: Scenario, save?: unknown): Promise<Session> {
  const ip = freshIp()
  return { ...(await startSession(sc.db, ip, save)), ip }
}

const axesArg = (axes?: readonly string[]): { p_axes?: string[] } => (axes === undefined ? {} : { p_axes: [...axes] })
const nextOf = (sc: Scenario, s: Session, axes?: readonly string[]): Promise<Next> => sc.db.rpc<Next>(from(s.ip), 'next_item', { p_token: s.token, ...axesArg(axes) })

/** Every reply a test saw, as JSON text, for the secrecy checks. */
const replies: string[] = []

async function submit(sc: Scenario, s: Session, served: Served, response: unknown, axes?: readonly string[]): Promise<Next> {
  await ageExposures(sc.db, s.session_id, 30)
  const out = await sc.db.rpc<{ ack: boolean; seq: number; next?: Next }>(from(s.ip), 'submit', { p_token: s.token, p_item_id: served.item.item_id, p_response: response, p_rt_ms: 9000, ...axesArg(axes) })
  replies.push(JSON.stringify(out))
  return out.next ?? { done: true, reason: 'not_asked' }
}

/** Plays `axes` until done or `max` answers, answering with `respond`; the items served, in order. */
async function play(sc: Scenario, s: Session, axes: readonly string[], respond: (item: FixtureItem, i: number) => unknown, max = 200): Promise<Served[]> {
  const served: Served[] = []
  let next = await nextOf(sc, s, axes)
  replies.push(JSON.stringify(next))
  while (isServed(next) && served.length < max) {
    served.push(next)
    next = await submit(sc, s, next, respond(sc.bank.get(next.item.item_id)!, served.length - 1), axes)
    replies.push(JSON.stringify(next))
  }
  return served
}

const one = async <T>(db: TestDb, sql: string, params: unknown[] = []): Promise<T> => (await db.owner.query<{ v: T }>(`select ${sql} as v`, params)).rows[0]!.v

/** The finish replies: the session as a save holds it, with the answers the client itself sent (so not scanned for canaries). */
const finished: { session: { responses: unknown[][] } }[] = []

async function finish(sc: Scenario, s: Session): Promise<void> {
  finished.push(await sc.db.rpc(from(s.ip), 'finish', { p_token: s.token }))
}

async function rescoreOf(sc: Scenario, sessions: readonly Session[]): Promise<{ eap: Record<string, { mean: number; sd: number; n: number }>; withheld: { eap: Record<string, number> }; skipped: Record<string, number> }> {
  const save = emptySave(sessions[0]!.anon_id, { sessions: await Promise.all(sessions.map((s) => signedSession(sc.db, s.session_id))) })
  const out = await sc.db.rpc<{ eap: Record<string, { mean: number; sd: number; n: number }>; withheld: { eap: Record<string, number> }; skipped: Record<string, number> }>(from(freshIp()), 'rescore', { p_save: save })
  replies.push(JSON.stringify(out))
  return out
}

/** The grid EAP of the app's engine (engine/scorer.ts's grid and prior N(0, 1)) over some observations. */
function gridEap(obs: readonly Observation[]): { mean: number; sd: number } {
  const step = (EAP_HI - EAP_LO) / (EAP_N_GRID - 1)
  const grid = Array.from({ length: EAP_N_GRID }, (_, i) => (i === EAP_N_GRID - 1 ? EAP_HI : EAP_LO + i * step))
  const logw = grid.map((t) => -0.5 * t * t + obs.reduce((sum, o) => sum + observationLoglik(o, t), 0))
  const mx = Math.max(...logw)
  const w = logw.map((v) => Math.exp(v - mx))
  const total = w.reduce((x, y) => x + y, 0)
  const mean = grid.reduce((sum, t, i) => sum + (w[i]! / total) * t, 0)
  const variance = grid.reduce((sum, t, i) => sum + (w[i]! / total) * (t - mean) * (t - mean), 0)
  return { mean, sd: Math.sqrt(Math.max(variance, 0)) }
}

const EXACT = { 'rescore.min_axis_items': 5, 'rescore.min_facet_items': 5, 'rescore.mean_step': 0, 'rescore.sd_step': 0 } as const

// ------------------------------------------------------------------------------------------- word links
describe('word links: a typed answer is scored against the accept list, folded as the app folds it', () => {
  let sc: Scenario
  const golden = m6Golden as unknown as { rat: { answer_key: { id: string; text: string; key: string }[]; matches: { id: string; response: string; accept: string[]; expected: boolean }[] } }
  // one made-up item per golden match case, whose key is that case's accept list (the answer first)
  const caseItems: FixtureItem[] = golden.rat.matches.map((c, k) =>
    customItem(9000 + k, 'CRE', { itemId: `i:rat:v1:golden-${String(k).padStart(3, '0')}`, status: 'draft', storedType: 'rat_triad', nOptions: 0, key: { answer: c.accept[0] ?? '', accept: c.accept }, payload: { stem: 'golden case', media: { renderer: 'rat_triad_v1', cues: ['aaa', 'bbb', 'ccc'] } } }),
  )
  const triads = ratItems(12)
  beforeAll(async () => {
    sc = await scenario([...caseItems, ...triads])
  })
  afterAll(async () => {
    await sc.db.close()
  })

  it('folds every golden text as the app and the bank do (NFKD, letters a to z, lower case)', async () => {
    expect(golden.rat.answer_key.length).toBeGreaterThan(200)
    for (const c of golden.rat.answer_key) {
      // a NUL is no character of a PostgreSQL text, and jsonb refuses \u0000: no answer can hold one
      if (c.text.includes('\u0000')) continue
      expect(await one<string>(sc.db, 'hb.rat_answer_key($1)', [c.text]), c.id).toBe(c.key)
      expect(answerKey(c.text)).toBe(c.key)
    }
  })

  it('folds any text the same way as the app (fuzzed, with letters, marks, wide forms, ligatures and astral characters)', async () => {
    const texts = fc.sample(fc.string({ unit: fc.constantFrom('a', 'Z', 'é', 'Ö', 'ﬁ', 'Ａ', 'ｑ', ' ', '-', "'", '1', '́', ' ', 'ß', 'İ', '𝐀', '😀', 'K'), maxLength: 24 }), 300)
    for (const t of texts) expect(await one<string>(sc.db, 'hb.rat_answer_key($1)', [t]), JSON.stringify(t)).toBe(answerKey(t))
  })

  it('scores every golden match case as matches() does, within the 40 characters the entry takes; correct is 1 or 0, never a score of its own', async () => {
    for (const [k, c] of golden.rat.matches.entries()) {
      const r = (await sc.db.owner.query<{ o_correct: number; o_score: number }>(`select * from hb.score_response($1, $2::jsonb)`, [caseItems[k]!.itemId, JSON.stringify(c.response)])).rows[0]!
      const inEntry = c.response.trim().length <= 40
      expect(r.o_correct, c.id).toBe(c.expected && inEntry ? 1 : 0)
      expect(matches(c.response, c.accept)).toBe(c.expected)
      expect(r.o_score).toBe(r.o_correct)
    }
  })

  it('takes the answer space of a typed word: text of 1 to 40 characters with a letter; everything else is no answer', async () => {
    const fits = (response: unknown): Promise<boolean> => one<boolean>(sc.db, 'hb.response_fits($1::jsonb, 0, $2::jsonb)', [JSON.stringify({ answer: 'zqx', accept: ['zqx'] }), response === undefined ? null : JSON.stringify(response)])
    for (const [response, want] of [['word', true], [' Word ', true], ['x', true], ['a'.repeat(40), true], ['a'.repeat(41), false], ['', false], ['   ', false], ['123', false], ['--', false], [7, false], [null, false], [['word'], false], [{ w: 'word' }, false], [undefined, false]] as const) {
      expect(await fits(response), JSON.stringify(response)).toBe(want)
    }
  })

  it('serves triads on CRE and scores them: the answer, a listed spelling, case and spaces are right; a plural, a near miss and an empty answer are not', async () => {
    const s = await start(sc)
    const served = await play(sc, s, ['CRE'], (it, i) => {
      const key = it.key as { answer: string; accept: string[] }
      return [key.answer, ` ${key.answer.toUpperCase()} `, key.accept[1]!, `${key.answer}s`, key.answer.slice(1), '!!'][i % 6]
    }, 12)
    expect(served.length).toBe(12)
    const { rows } = await sc.db.owner.query<{ correct: number }>(`select correct from public.responses where session_id = $1 order by seq`, [s.session_id])
    expect(rows.map((r) => r.correct)).toEqual(Array.from({ length: 12 }, (_, i) => (i % 6 < 3 ? 1 : 0)))
    // the session's grid EAP counts the eleven answers in the answer space (not '!!', which is no answer)
    const n = await one<number>(sc.db, `(select (state #>> '{eap,CRE,n}')::int from public.sessions where session_id = $1)`, [s.session_id])
    expect(n).toBe(10)
    for (const q of served) expect(Object.keys(q.item).sort()).toEqual(['item_id', 'item_type', 'media', 'stem', 'time_limit_s'])
  })
})

// ---------------------------------------------------------------------------------------------- Fermi
interface FermiCase {
  id: string
  truth: FermiTruth
  response: FermiResponse
  delta: number
  score: { x: number; hit: boolean; weight: number; interval_score_dex: number; error_dex: number }
  observation: { kind: 'gaussian'; axis: 'FER'; lam: number; d: number; sigma: number; x: number }
}

async function fermiEval(db: TestDb, key: unknown, response: unknown): Promise<{ o_valid: boolean; o_x: number | null; o_hit: boolean | null; o_weight: number | null; o_error: number | null; o_interval_score: number | null }> {
  return (await db.owner.query(`select * from hb.fermi_eval($1::jsonb, $2::jsonb)`, [JSON.stringify(key), JSON.stringify(response)])).rows[0] as never
}

/** The server's observation of a stored answer (hb.response_obs) for a Fermi row of difficulty `delta`. */
async function fermiObs(db: TestDb, key: unknown, response: unknown, delta: number): Promise<FermiCase['observation'] | null> {
  const p = fermiParams(delta)
  return one(db, `hb.response_obs('FER', 'gaussian', null, null, null, $1::jsonb, $2::jsonb, 0, $3::jsonb, null)`, [JSON.stringify({ lam: p.lam, d: p.d, sigma: p.sigma }), JSON.stringify(key), JSON.stringify(response)])
}

describe('Fermi estimates: the score of §3 row 11 and its Gaussian observation, as the device scorer computes them', () => {
  let sc: Scenario
  const items = fermiItems(16)
  const golden = fermiGolden as unknown as { cases: FermiCase[]; malformed: { id: string; response: unknown }[]; units: { symbol: string; dimension: string; factor: number }[] }
  beforeAll(async () => {
    sc = await scenario([...items, ...Array.from({ length: 6 }, (_, k) => customItem(500 + k, 'MAT', { b: -1 + 0.4 * k }))], EXACT)
  })
  afterAll(async () => {
    await sc.db.close()
  })

  it('has the unit table of the app and the bank, exactly', async () => {
    expect(UNITS.length).toBe(golden.units.length)
    for (const u of UNITS) {
      const row = (await sc.db.owner.query<{ o_dimension: string; o_factor: number }>(`select * from hb.fermi_unit($1)`, [u.symbol])).rows[0]!
      expect(row, u.symbol).toEqual({ o_dimension: u.dimension, o_factor: u.factor })
    }
    expect((await sc.db.owner.query(`select * from hb.fermi_unit('furlong')`)).rows[0]).toEqual({ o_dimension: null, o_factor: null })
  })

  it('scores every golden case as the device scorer does, to 1e-6: x, the hit, the weight, the interval score, and the observation (lam, d, sigma, x)', async () => {
    expect(golden.cases.length).toBeGreaterThan(100)
    for (const c of golden.cases) {
      const r = await fermiEval(sc.db, c.truth, c.response)
      expect(r.o_valid, c.id).toBe(true)
      const ts = scoreFermi(c.response, c.truth)
      for (const [got, want] of [[r.o_x, c.score.x], [r.o_x, ts.x], [r.o_error, c.score.error_dex], [r.o_weight, c.score.weight], [r.o_interval_score, c.score.interval_score_dex]] as const) expect(Math.abs(got! - want), c.id).toBeLessThan(TOL)
      expect(r.o_hit, c.id).toBe(c.score.hit)
      const obs = await fermiObs(sc.db, c.truth, c.response, c.delta)
      const device = fermiObservation(ts, c.truth.true_value_uncertainty_log10, c.delta)
      for (const k of ['lam', 'd', 'sigma', 'x'] as const) {
        expect(Math.abs(obs![k] - c.observation[k]), `${c.id} ${k}`).toBeLessThan(TOL)
        expect(Math.abs(obs![k] - device[k]), `${c.id} ${k}`).toBeLessThan(TOL)
      }
      expect(obs).toMatchObject({ kind: 'gaussian', axis: 'FER' })
    }
  })

  it('refuses every golden malformed response, and a unit of another dimension, as the device parser does', async () => {
    const truth = { true_value: '31557600', unit: 's', true_value_uncertainty_log10: 0 }
    for (const m of golden.malformed as { id: string; response: unknown; truth?: unknown }[]) {
      if (m.truth !== undefined) {
        expect((await fermiEval(sc.db, m.truth, m.response)).o_valid, m.id).toBe(false)
        expect(await one<boolean>(sc.db, 'hb.response_fits($1::jsonb, 0, $2::jsonb)', [JSON.stringify(m.truth), JSON.stringify(m.response)]), m.id).toBe(false)
        continue
      }
      expect((await fermiEval(sc.db, truth, m.response)).o_valid, m.id).toBe(false)
      expect(await one<boolean>(sc.db, 'hb.response_fits($1::jsonb, 0, $2::jsonb)', [JSON.stringify(truth), JSON.stringify(m.response)]), m.id).toBe(false)
    }
    const metres = { value: 10, unit: 'm', low: 5, high: 20 }
    expect((await fermiEval(sc.db, truth, metres)).o_valid).toBe(false)
    expect(await one<boolean>(sc.db, 'hb.response_fits($1::jsonb, 0, $2::jsonb)', [JSON.stringify(truth), JSON.stringify(metres)])).toBe(false)
    // a truth above 0.3 dex is no item: nothing is scored against it
    expect((await fermiEval(sc.db, { ...truth, true_value_uncertainty_log10: 0.31 }, { value: 1e7, unit: 's', low: 1e6, high: 1e8 })).o_valid).toBe(false)
  })

  it('agrees with the device on fuzzed answers and truths: the same verdict on validity, and the same x, hit and observation', async () => {
    const units = UNITS.filter((u) => u.dimension === 'time' || u.dimension === 'count').map((u) => u.symbol)
    const magnitude = fc.oneof(fc.double({ min: 1e-31, max: 1e31, noNaN: true }), fc.integer({ min: 1, max: 1e9 }), fc.constantFrom(0, -1, 1e-30, 1e30, 1e30 * 1.0000001))
    const cases = fc.sample(
      fc.record({
        value: magnitude,
        low: magnitude,
        high: magnitude,
        unit: fc.constantFrom(...units, 'furlong'),
        truthUnit: fc.constantFrom('s', 'count', 'year', 'million'),
        mantissa: fc.integer({ min: 1, max: 99999 }),
        exp: fc.integer({ min: -20, max: 25 }),
        u: fc.constantFrom(0, 0.1, 0.15, 0.2, 0.25, 0.3),
        delta: fc.double({ min: -2, max: 2, noNaN: true }),
      }),
      250,
    )
    for (const c of cases) {
      const truth: FermiTruth = { true_value: `${c.mantissa}e${c.exp}`, unit: c.truthUnit, true_value_uncertainty_log10: c.u }
      const raw = { value: c.value, unit: c.unit, low: c.low, high: c.high }
      let device: ReturnType<typeof scoreFermi> | null = null
      try {
        device = scoreFermi(parseFermiResponse(raw), truth)
      } catch {
        device = null
      }
      const r = await fermiEval(sc.db, truth, raw)
      expect(r.o_valid, JSON.stringify({ raw, truth })).toBe(device !== null)
      if (device === null) continue
      expect(Math.abs(r.o_x! - device.x)).toBeLessThan(TOL)
      expect(r.o_hit).toBe(device.hit)
      const obs = await fermiObs(sc.db, truth, raw, c.delta)
      const want = fermiObservation(device, c.u, c.delta)
      for (const k of ['lam', 'd', 'sigma', 'x'] as const) expect(Math.abs(obs![k] - want[k]), k).toBeLessThan(TOL)
    }
  })

  it('selects Fermi items on FER, scores each answer as x (correct stays null), and adds it to the session EAP', async () => {
    const s = await start(sc)
    const served = await play(sc, s, ['FER'], (it, i) => {
      const t = Number((it.key as { true_value: string }).true_value)
      const value = t * 10 ** (((i % 5) - 2) * 0.4)
      return { value, unit: 'count', low: value / 3, high: value * 3 }
    }, 8)
    expect(served.length).toBe(8)
    for (const q of served) {
      expect(q.item.item_type).toBe('fermi_estimate')
      expect(Object.keys(q.item).sort()).toEqual(['item_id', 'item_type', 'media', 'stem', 'time_limit_s'])
    }
    const { rows } = await sc.db.owner.query<{ correct: number | null; score: number; item_id: string; response: FermiResponse }>(`select correct, score, item_id, response from public.responses where session_id = $1 order by seq`, [s.session_id])
    for (const r of rows) {
      expect(r.correct).toBeNull()
      const key = sc.bank.get(r.item_id)!.key as unknown as FermiTruth
      expect(Math.abs(r.score - scoreFermi(r.response, key).x)).toBeLessThan(1e-6)
    }
    expect(await one<number>(sc.db, `(select (state #>> '{eap,FER,n}')::int from public.sessions where session_id = $1)`, [s.session_id])).toBe(8)
  })

  it('publishes FER in rescore from five answers of a session, with the grid EAP of the device observations; and the MAP at finish holds them', async () => {
    const s = await start(sc)
    // typed in thousands: the server converts to the truth's unit (counts) in log space, as the device does
    await play(sc, s, ['FER'], (it, i) => {
      const t = Number((it.key as { true_value: string }).true_value) / 1000
      const value = t * 10 ** (i % 2 === 0 ? 0.3 : -0.6)
      return { value, unit: 'thousand', low: value / 10, high: value * 2 }
    }, 6)
    await finish(sc, s)
    const { rows } = await sc.db.owner.query<{ item_id: string; response: FermiResponse }>(`select item_id, response from public.responses where session_id = $1 order by seq`, [s.session_id])
    const obs: Observation[] = []
    for (const r of rows) {
      const fx = sc.bank.get(r.item_id)!
      const key = fx.key as unknown as FermiTruth
      const p = fx.extra as { lam: number; d: number; sigma: number }
      let sc0: ReturnType<typeof scoreFermi> | null = null
      try {
        sc0 = scoreFermi(parseFermiResponse(r.response), key)
      } catch {
        sc0 = null
      }
      if (sc0 === null) continue
      const o = fermiObservation(sc0, key.true_value_uncertainty_log10, 0)
      obs.push({ ...o, lam: p.lam, d: p.d })
    }
    expect(obs.length).toBeGreaterThanOrEqual(5)
    const want = gridEap(obs)
    const got = await rescoreOf(sc, [s])
    expect(got.eap.FER!.n).toBe(obs.length)
    expect(Math.abs(got.eap.FER!.mean - want.mean)).toBeLessThan(TOL)
    expect(Math.abs(got.eap.FER!.sd - want.sd)).toBeLessThan(TOL)
    const post = await one<{ n_by_axis: Record<string, number> }>(sc.db, `(select state -> 'posterior' from public.sessions where session_id = $1)`, [s.session_id])
    expect(post.n_by_axis.FER).toBe(obs.length)
  })

  it('withholds FER from a session with fewer than five answers, and counts an answer outside the answer space as none', async () => {
    const s = await start(sc)
    // (answers a dex or so off: one eight dex off puts the whole posterior on the edge of the grid, and the per-skill stop
    // of §7.4 then ends the part; a real effect of the grid, left as it is)
    await play(sc, s, ['FER'], (it, i) => {
      const t = Number((it.key as { true_value: string }).true_value)
      return i < 4 ? { value: t * 10, unit: 'count', low: t, high: t * 100 } : { value: 5, unit: 'count', low: 10, high: 1 }
    }, 6)
    await finish(sc, s)
    const got = await rescoreOf(sc, [s])
    expect(got.eap.FER, JSON.stringify(got)).toBeUndefined()
    expect(got.withheld.eap.FER, JSON.stringify(got)).toBe(4)
    expect(got.skipped.invalid, JSON.stringify(got)).toBe(2)
  })
})

// --------------------------------------------------------------------------------- situational judgment
describe('situational judgments: the rating score and its GRM category, as the device computes them', () => {
  let sc: Scenario
  const golden = m6Golden as unknown as { sjt: { rating: { id: string; user: number[]; key: number[]; score: number }[]; errors: { id: string; fn: string; user?: unknown; key: unknown }[] } }
  const sjt = sjtItems(14)
  const vignettes = vignetteItems(14)
  beforeAll(async () => {
    sc = await scenario([...sjt, ...vignettes], EXACT)
  })
  afterAll(async () => {
    await sc.db.close()
  })

  const sjtEval = async (key: unknown, user: unknown): Promise<{ o_score: number | null; o_category: number | null }> =>
    (await sc.db.owner.query(`select * from hb.sjt_eval($1::jsonb, $2::jsonb)`, [JSON.stringify({ ratings: key }), JSON.stringify(user)])).rows[0] as never

  it('scores every golden rating case as the bank and the app do, and bins it as the bank does', async () => {
    expect(golden.sjt.rating.length).toBeGreaterThan(200)
    for (const c of golden.sjt.rating) {
      const r = await sjtEval(c.key, c.user)
      expect(Math.abs(r.o_score! - c.score), c.id).toBeLessThan(1e-12)
      expect(Math.abs(r.o_score! - ratingScore(c.user, c.key))).toBeLessThan(1e-12)
      expect(r.o_category, c.id).toBe(scoreCategory(ratingScore(c.user, c.key)))
    }
  })

  it('refuses the golden error inputs of the rating score (no score, no category)', async () => {
    for (const e of golden.sjt.errors.filter((x) => x.fn === 'rating')) {
      const key = Array.isArray(e.key) ? e.key.map((k) => (k === null ? 9 : k)) : e.key
      const r = await sjtEval(key, e.user ?? null)
      expect(r.o_score, e.id).toBeNull()
    }
  })

  it('takes the answer space of four whole ratings 1 to 4', async () => {
    const fits = (response: unknown): Promise<boolean> => one<boolean>(sc.db, 'hb.response_fits($1::jsonb, 4, $2::jsonb)', [JSON.stringify({ ratings: [1, 2, 3, 4] }), JSON.stringify(response)])
    for (const [response, want] of [[[1, 2, 3, 4], true], [[4, 4, 4, 4], true], [[1, 2, 3], false], [[1, 2, 3, 5], false], [[0, 2, 3, 4], false], [[1.5, 2, 3, 4], false], [['1', 2, 3, 4], false], [2, false], [null, false], [{ most: 0, least: 1 }, false]] as const) {
      expect(await fits(response), JSON.stringify(response)).toBe(want)
    }
  })

  it('serves EMO as vignettes and situational judgments in turn (content balancing by item type on EMO), and scores both', async () => {
    const s = await start(sc)
    const served = await play(sc, s, ['EMO'], (it, i) => (it.storedType === 'sjt_rating' ? [1 + (i % 4), 2, 3, 4] : (it.key.index as number)), 10)
    expect(served.length).toBe(10)
    const types = served.map((q) => q.item.item_type)
    expect(types.filter((t) => t === 'sjt_rating').length).toBe(5)
    for (let i = 1; i < types.length; i += 2) expect(types[i]).not.toBe(types[i - 1])
    const { rows } = await sc.db.owner.query<{ correct: number | null; score: number | null; item_id: string; response: number[] }>(`select correct, score, item_id, response from public.responses where session_id = $1 order by seq`, [s.session_id])
    for (const r of rows) {
      const fx = sc.bank.get(r.item_id)!
      if (fx.storedType === 'sjt_rating') {
        expect(r.correct).toBeNull()
        expect(Math.abs(r.score! - ratingScore(r.response, (fx.key as { ratings: number[] }).ratings))).toBeLessThan(1e-6)
      } else expect(r.correct).toBe(1)
    }
    expect(await one<number>(sc.db, `(select (state #>> '{eap,EMO,n}')::int from public.sessions where session_id = $1)`, [s.session_id])).toBe(10)
  })

  it('publishes EMO from vignettes and judgments together, with the grid EAP of the 2PL and GRM observations the device would make', async () => {
    const s = await start(sc)
    await play(sc, s, ['EMO'], (it, i) => (it.storedType === 'sjt_rating' ? [1 + (i % 4), 4 - (i % 3), 2, 3] : i % 3 === 0 ? ((it.key.index as number) + 1) % 5 : (it.key.index as number)), 8)
    await finish(sc, s)
    const { rows } = await sc.db.owner.query<{ correct: number | null; item_id: string; response: unknown }>(`select correct, item_id, response from public.responses where session_id = $1 order by seq`, [s.session_id])
    const obs: Observation[] = rows.map((r) => {
      const fx = sc.bank.get(r.item_id)!
      if (fx.storedType !== 'sjt_rating') return { kind: '2pl', axis: 'EMO', a: fx.a, b: fx.b, y: r.correct as 0 | 1 }
      const t = (fx.extra as { thresholds: number[] }).thresholds
      return { kind: 'grm', axis: 'EMO', a: fx.a, b: t, y: scoreCategory(ratingScore(r.response as number[], (fx.key as { ratings: number[] }).ratings)) }
    })
    const want = gridEap(obs)
    const got = await rescoreOf(sc, [s])
    expect(got.eap.EMO!.n).toBe(8)
    expect(Math.abs(got.eap.EMO!.mean - want.mean)).toBeLessThan(TOL)
    expect(Math.abs(got.eap.EMO!.sd - want.sd)).toBeLessThan(TOL)
  })
})

// ------------------------------------------------------------------------------------- live axes, secrecy
describe('live_axes names the skills a session can be served, and nothing else', () => {
  let sc: Scenario
  const fermi = fermiItems(3, 'live')
  const games = logicGameItems(2, 'live')
  // a draft RAT item, a practice-only vignette and a Fermi item whose key is not a truth: none of them is servable
  const draft = ratItems(1, 'draft').map((i) => ({ ...i, status: 'draft' as const }))
  const practice = vignetteItems(1, 'practice').map((i) => ({ ...i, practiceOnly: true }))
  const keyless = fermiItems(1, 'keyless').map((i) => ({ ...i, axis: 'KAP' as const, key: { value: '3' } }))
  beforeAll(async () => {
    sc = await scenario([...fermi, ...games, ...draft, ...practice, ...keyless, customItem(1, 'MAT')])
  })
  afterAll(async () => {
    await sc.db.close()
  })

  it('lists the axes with a live, servable item in canonical order, to anon, with no other field', async () => {
    const out = await sc.db.rpc<{ axes: string[] }>(from(freshIp()), 'live_axes', {})
    replies.push(JSON.stringify(out))
    expect(out).toEqual({ axes: ['MAT', 'LG', 'FER'] })
  })

  it('follows the bank: an item retired, or a parameter row of another param_version, leaves its axis out', async () => {
    await sc.db.owner.query(`update public.items set status = 'retired' where item_id = $1`, ['i:tst:cus:000001'])
    expect(await sc.db.rpc(from(freshIp()), 'live_axes', {})).toEqual({ axes: ['LG', 'FER'] })
    await sc.db.owner.query(`insert into public.app_config (key, value) values ('param_version', '"p-other"') on conflict (key) do update set value = excluded.value`)
    expect(await sc.db.rpc(from(freshIp()), 'live_axes', {})).toEqual({ axes: [] })
    await sc.db.owner.query(`delete from public.app_config where key = 'param_version'`)
  })

  it('serves a logic game whole, in order, with its setup in every reply and its place in the set', async () => {
    const s = await start(sc)
    const served = await play(sc, s, ['LG'], (it) => it.key.index as number)
    expect(served.length).toBe(games.length)
    let at = 0
    while (at < served.length) {
      const fam = sc.bank.get(served[at]!.item.item_id)!.familyId
      const ids = games.filter((g) => g.familyId === fam).map((g) => g.itemId).sort((a, b) => (a < b ? -1 : 1))
      expect(served.slice(at, at + ids.length).map((q) => q.item.item_id)).toEqual(ids)
      expect(served.slice(at, at + ids.length).map((q) => (q as Served & { set?: unknown }).set)).toEqual(ids.map((_, i) => ({ position: i + 1, of: ids.length })))
      const setups = new Set(served.slice(at, at + ids.length).map((q) => (q.item.media as { setup: string }).setup))
      expect(setups.size).toBe(1)
      expect([...setups][0]).toContain('Made-up game')
      at += ids.length
    }
  })
})

describe('no reply carries a key: no truth, unit of a truth, uncertainty, accept list, rating profile, tolerance, rationale or parameter (fuzzed)', () => {
  let sc: Scenario
  const items = [...fermiItems(8, 'sec'), ...ratItems(8, 'sec'), ...sjtItems(8, 'sec'), ...vignetteItems(8, 'sec'), ...logicGameItems(3, 'sec')]
  const KEYISH = /(key|answer|accept|correct|solution|rationale|toler|option_weights|verdict|true_value|uncertainty|ratings|thresholds|lam|sigma|best|worst)/i
  beforeAll(async () => {
    sc = await scenario(items)
    await sc.db.owner.query(`update public.item_keys set rationale = '{"why": "zqrationalecanary"}'::jsonb, tolerance = '{"note": "zqtolerancecanary"}'::jsonb`)
  })
  afterAll(async () => {
    await sc.db.close()
  })

  it('whatever is answered, on every axis, the replies hold none of the keys made up for these items', async () => {
    const rng = fc.sample(fc.oneof(fc.integer({ min: -2, max: 6 }), fc.string({ maxLength: 12 }), fc.constant(null), fc.array(fc.integer({ min: 0, max: 5 }), { maxLength: 5 }), fc.record({ value: fc.double({ min: 1, max: 1e9, noNaN: true }), unit: fc.constantFrom('count', 'million'), low: fc.constant(1), high: fc.constant(1e10) })), 400)
    let k = 0
    for (const axes of [['FER'], ['CRE'], ['EMO'], ['LG'], null] as const) {
      const s = await start(sc)
      await play(sc, s, axes ?? ['FER', 'CRE', 'EMO', 'LG'], (it) => (k++ % 3 === 0 ? (it.storedType === 'rat_triad' ? (it.key as { answer: string }).answer : it.storedType === 'sjt_rating' ? [1, 2, 3, 4] : it.key.index ?? null) : rng[k % rng.length]), 25)
      await finish(sc, s)
      await rescoreOf(sc, [s])
    }
    replies.push(JSON.stringify(await sc.db.rpc(from(freshIp()), 'live_axes', {})))
    const text = replies.join('\n')
    expect(text.length).toBeGreaterThan(1000)
    for (const it of items) {
      const key = it.key as Record<string, unknown>
      if (typeof key.true_value === 'string') expect(text).not.toContain(key.true_value)
      if (typeof key.answer === 'string') expect(text).not.toContain(key.answer)
      for (const a of (key.accept as string[] | undefined) ?? []) expect(text).not.toContain(a)
      for (const r of (key.ratings as number[] | undefined) ?? []) expect(text).not.toContain(String(r))
    }
    expect(text).not.toContain('zqrationalecanary')
    // a finished session carries the client's own answers and never a verdict on any of them (R-11.1)
    expect(finished.length).toBeGreaterThan(0)
    for (const f of finished) for (const tuple of f.session.responses) expect(tuple[3]).toBeNull()
    expect(text).not.toContain('zqtolerancecanary')
    const keysIn = (v: unknown, out: string[] = []): string[] => {
      if (Array.isArray(v)) for (const x of v) keysIn(x, out)
      else if (v !== null && typeof v === 'object') for (const [key, x] of Object.entries(v)) out.push(key), keysIn(x, out)
      return out
    }
    // the item views: no field named for a key, anywhere (a save's session object has `correct: null` by design and is not an item view)
    for (const r of replies) {
      const v = JSON.parse(r) as Record<string, unknown>
      const views = [v.item, (v.next as Record<string, unknown> | undefined)?.item].filter((x) => x !== undefined)
      for (const view of views) for (const key of keysIn(view)) expect(KEYISH.test(key), key).toBe(false)
    }
  })
})
