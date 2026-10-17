/**
 * Publishing a new parameter set (ROADMAP M4.10; DESIGN §6.iii step 5, §7.8, §12; supabase/migrations/
 * 20261017000200_param_publish.sql). The bank's nightly job writes the rows of a new param_version and sets app_config
 * param_version; then it re-scores the recent finished sessions with hb.rescore_session. Here:
 *
 *   - under the same parameter set, hb.rescore_session gives back exactly what finish kept (the grid EAP summary, the
 *     MAP, the §13 evidence, calibration_eligible): the same functions in the same order;
 *   - under a new set, the summary is the grid EAP of the app's engine with the new parameters, the session records the
 *     version, and rescore(save) (which reads app_config at every call) follows the new set by itself;
 *   - an unfinished session, a missing one and an archived one are left alone; no API role may call it;
 *   - the contract the job keeps: an item without a row of the published version is not served.
 *
 * Every item is made up at run time.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { observationLoglik } from '../../src/engine/irt'
import { EAP_HI, EAP_LO, EAP_N_GRID } from '../../src/engine/scorer'
import type { Observation } from '../../src/engine/types'
import { customItem, loadFixtureBank, type FixtureItem } from './bank-fixture'
import { ANON, AUTHENTICATED, SERVICE_ROLE, type TestDb } from './harness'
import { ageExposures, emptySave, from, isServed, signedSession, startSession, type Next, type Started } from './rpc-support'
import { PERMISSION_DENIED, openTestDb, rejectedWith } from './vitest'

let db: TestDb
let items: FixtureItem[]
let ipCounter = 0
const freshIp = (): string => {
  const n = ++ipCounter
  return `198.20.${Math.floor(n / 250)}.${(n % 250) + 1}`
}

type Session = Started & { ip: string }

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

const setParam = (v: string): Promise<unknown> =>
  db.owner.query(`insert into public.app_config (key, value) values ('param_version', to_jsonb($1::text)) on conflict (key) do update set value = excluded.value`, [v])

async function play(axis: string, n: number, finish = true): Promise<Session> {
  const ip = freshIp()
  const s = { ...(await startSession(db, ip)), ip }
  let next = await db.rpc<Next>(from(ip), 'next_item', { p_token: s.token, p_axes: [axis] })
  for (let i = 0; i < n && isServed(next); i++) {
    await ageExposures(db, s.session_id, 30)
    const out = await db.rpc<{ next?: Next }>(from(ip), 'submit', { p_token: s.token, p_item_id: next.item.item_id, p_response: i % 3 === 2 ? 1 : 0, p_rt_ms: 9000, p_axes: [axis] })
    next = out.next ?? { done: true, reason: 'not_asked' }
  }
  if (finish) await db.rpc(from(ip), 'finish', { p_token: s.token })
  return s
}

const rescoreSession = async (sid: string): Promise<string> => (await db.owner.query<{ v: string }>(`select hb.rescore_session($1) as v`, [sid])).rows[0]!.v
const row = async (sid: string): Promise<{ state: Record<string, any>; param_version: string | null; calibration_eligible: boolean }> =>
  (await db.owner.query(`select state, param_version, calibration_eligible from public.sessions where session_id = $1`, [sid])).rows[0] as never

beforeAll(async () => {
  db = await openTestDb()
  items = Array.from({ length: 14 }, (_, k) => customItem(900 + k, 'MAT', { b: -1.5 + 0.25 * k, a: 0.8 + 0.05 * k }))
  await loadFixtureBank(db, items, 'p-old')
  for (const [key, value] of Object.entries({ 'selection.exposure_cap': 1000, 'selection.pretest_share': 0, 'rate.sessions_per_day': 1000, 'rate.rescores_per_anon_day': 1000, 'rescore.mean_step': 0, 'rescore.sd_step': 0 }))
    await db.owner.query(`update public.app_config set value = $2::jsonb where key = $1`, [key, JSON.stringify(value)])
  await setParam('p-old')
})
afterAll(async () => {
  await db.close()
})

describe('hb.rescore_session', () => {
  it('gives back what finish kept under the same parameter set', async () => {
    const s = await play('MAT', 8)
    const before = await row(s.session_id)
    expect(before.param_version).toBe('p-old')
    expect(await rescoreSession(s.session_id)).toBe('rescored')
    const after = await row(s.session_id)
    const { rescored, ...rest } = after.state
    expect(rescored).toMatchObject({ param_version: 'p-old' })
    expect(rest).toEqual(before.state)
    expect(after.calibration_eligible).toBe(before.calibration_eligible)
    expect(after.param_version).toBe('p-old')
  })

  it('re-scores under a newly published set: the app engine’s grid EAP with the new b, the version recorded, and rescore follows by itself', async () => {
    const s = await play('MAT', 8)
    const save = emptySave(s.anon_id, { sessions: [await signedSession(db, s.session_id)] })
    const oldReply = await db.rpc<{ eap: Record<string, { mean: number }> }>(from(freshIp()), 'rescore', { p_save: save })
    // the new set: every item, b moved by +0.8 (as the nightly job writes a complete set)
    await db.owner.query(`insert into public.item_parameters (item_id, param_version, model, a, b, c, extra, n_resp, se_b)
      select item_id, 'p-new', model, a, b + 0.8, c, extra, 50, 0.3 from public.item_parameters where param_version = 'p-old'`)
    await setParam('p-new')
    const newReply = await db.rpc<{ eap: Record<string, { mean: number }> }>(from(freshIp()), 'rescore', { p_save: save })
    expect(newReply.eap.MAT!.mean).toBeGreaterThan(oldReply.eap.MAT!.mean)

    expect(await rescoreSession(s.session_id)).toBe('rescored')
    const after = await row(s.session_id)
    expect(after.param_version).toBe('p-new')
    expect(after.state.posterior.param_version).toBe('p-new')
    const { rows } = await db.owner.query<{ item_id: string; correct: number }>(`select item_id, correct from public.responses where session_id = $1 order by seq`, [s.session_id])
    const byId = new Map(items.map((i) => [i.itemId, i]))
    const obs: Observation[] = rows.map((r) => ({ kind: '2pl', axis: 'MAT', a: byId.get(r.item_id)!.a, b: byId.get(r.item_id)!.b + 0.8, y: r.correct as 0 | 1 }))
    const want = gridEap(obs)
    expect(after.state.eap.MAT.n).toBe(8)
    expect(Math.abs(after.state.eap.MAT.mean - want.mean)).toBeLessThan(1e-6)
    expect(Math.abs(after.state.eap.MAT.sd - want.sd)).toBeLessThan(1e-6)
    expect(Math.abs(newReply.eap.MAT!.mean - want.mean)).toBeLessThan(1e-6)
    await setParam('p-old')
  })

  it('leaves an unfinished, a missing and an archived session alone', async () => {
    const s = await play('MAT', 3, false)
    const before = await row(s.session_id)
    expect(await rescoreSession(s.session_id)).toBe('unfinished')
    expect(await row(s.session_id)).toEqual(before)
    expect(await rescoreSession('s_doesnotexist0')).toBe('missing')
    const f = await play('MAT', 4)
    await db.owner.query(`insert into public.response_archive (session_id, n_served, n_answered, items, items_sha256, export_ref) values ($1, 1, 0, '[]'::jsonb, repeat('0', 64), 'test')`, [f.session_id])
    const fb = await row(f.session_id)
    expect(await rescoreSession(f.session_id)).toBe('archived')
    expect(await row(f.session_id)).toEqual(fb)
  })

  it('lets no API role call it (R-12.1)', async () => {
    for (const ctx of [ANON, AUTHENTICATED, SERVICE_ROLE]) expect(await rejectedWith(db.query(ctx, `select hb.rescore_session('s_x')`))).toBe(PERMISSION_DENIED)
  })

  it('the contract the job keeps: an item with no row of the published version is not served', async () => {
    await db.owner.query(`insert into public.item_parameters (item_id, param_version, model, a, b, c, extra, n_resp, se_b)
      select item_id, 'p-part', model, a, b, c, extra, 0, se_b from public.item_parameters where param_version = 'p-old' and item_id <> $1`, [items[0]!.itemId])
    await setParam('p-part')
    const ip = freshIp()
    const s = await startSession(db, ip)
    const seen: string[] = []
    let next = await db.rpc<Next>(from(ip), 'next_item', { p_token: s.token, p_axes: ['MAT'] })
    while (isServed(next) && seen.length < 20) {
      seen.push(next.item.item_id)
      await ageExposures(db, s.session_id, 30)
      next = (await db.rpc<{ next?: Next }>(from(ip), 'submit', { p_token: s.token, p_item_id: next.item.item_id, p_response: 0, p_rt_ms: 9000, p_axes: ['MAT'] })).next ?? { done: true, reason: 'x' }
    }
    expect(seen.length).toBeGreaterThan(5)
    expect(seen).not.toContain(items[0]!.itemId)
    await setParam('p-old')
  })
})
