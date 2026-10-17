/**
 * The device's timed-block estimates in the server's aim (`supabase/migrations/20261017000300_device_estimates.sql`;
 * DESIGN §7.4 "Cross-skill aim", amended 2026-10-17; R-7.4, R-11.1; ROADMAP M2.2, A24-sec). The server never sees the
 * timed blocks; the app hands it each block skill's estimate (axis, mean, sd) through `public.device_estimates`, the
 * server bounds it as the app's `deviceEvidence` does and `hb.session_aims` reads it as one more skill's message. This
 * file holds the server to `engine/xskill.ts` on the same estimates and answers, checks every bound, and shows that
 * nothing that scores reads it.
 *
 * Every item here is made up at run time (`customItem`); the keys are positions the fixture chose.
 */

import fc from 'fast-check'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AXIS_CODES } from '../../src/engine/axes'
import { selectionAim } from '../../src/engine/selector'
import type { Observation } from '../../src/engine/types'
import { DEVICE_MAX_CALLS, DEVICE_SD_MIN, boundedDeviceTerm, deviceEvidence, type DeviceEstimate } from '../../src/engine/xskill'
import { customItem, loadFixtureBank, type FixtureItem } from './bank-fixture'
import type { TestDb } from './harness'
import { ageExposures, emptySave, from, isServed, startSession, type Next, type Started } from './rpc-support'
import { openTestDb, pgCode } from './vitest'

let ipCounter = 0
const freshIp = (): string => {
  const n = ++ipCounter
  return `198.20.${Math.floor(n / 250)}.${(n % 250) + 1}`
}

type Session = Started & { ip: string }
type Skill = 'VOC' | 'KST' | 'MAT'
const SKILLS: readonly Skill[] = ['VOC', 'KST', 'MAT']
type DeviceAxis = 'WM' | 'RT' | 'PS'
const DEV: readonly DeviceAxis[] = ['WM', 'RT', 'PS']

let db: TestDb
let bank: Map<string, FixtureItem>

beforeAll(async () => {
  db = await openTestDb()
  const items: FixtureItem[] = []
  SKILLS.forEach((axis, k) => {
    for (let s = 0; s < 6; s++) for (let i = 0; i < 8; i++) items.push(customItem(20000 * (k + 1) + s * 100 + i, axis, { b: s - 2 }))
  })
  await loadFixtureBank(db, items)
  bank = new Map(items.map((i) => [i.itemId, i]))
})
afterAll(async () => {
  await db.close()
})

async function start(): Promise<Session> {
  const ip = freshIp()
  return { ...(await startSession(db, ip)), ip }
}

const send = (s: Session, estimates: unknown): Promise<{ recorded: string[] }> => db.rpc<{ recorded: string[] }>(from(s.ip), 'device_estimates', { p_token: s.token, p_estimates: estimates })

async function failure(promise: Promise<unknown>): Promise<{ code: string | undefined; message: string }> {
  try {
    await promise
  } catch (e) {
    return { code: pgCode(e), message: (e as Error).message }
  }
  throw new Error('expected the call to fail, but it succeeded')
}

async function play(s: Session, axis: Skill, answers: readonly boolean[]): Promise<Observation[]> {
  const obs: Observation[] = []
  let next = await db.rpc<Next>(from(s.ip), 'next_item', { p_token: s.token, p_axes: [axis] })
  for (let i = 0; i < answers.length; i++) {
    if (!isServed(next)) break
    const item = bank.get(next.item.item_id)!
    const right = answers[i]!
    obs.push({ kind: '2pl', axis, a: item.a, b: item.b, y: right ? 1 : 0 })
    await ageExposures(db, s.session_id, 20)
    const out = await db.rpc<{ next?: Next }>(from(s.ip), 'submit', {
      p_token: s.token,
      p_item_id: next.item.item_id,
      p_response: right ? (item.key.index as number) : ((item.key.index as number) + 1) % item.nOptions,
      p_rt_ms: 5000,
      p_axes: [axis],
      ...(i + 1 < answers.length ? {} : { p_next: false }),
    })
    next = out.next ?? { done: true, reason: 'not_asked' }
  }
  return obs
}

async function aims(sessionId: string): Promise<Record<string, number>> {
  const { rows } = await db.owner.query<{ axis: string; aim: number }>(`select a.* from hb.session_aims((select s.state from public.sessions s where s.session_id = $1)) a`, [sessionId])
  return Object.fromEntries(rows.map((r) => [r.axis, Number(r.aim)]))
}

async function stateOf(sessionId: string): Promise<Record<string, any>> {
  return (await db.owner.query<{ state: Record<string, any> }>(`select state from public.sessions where session_id = $1`, [sessionId])).rows[0]!.state
}

function expectAims(got: Record<string, number>, want: Partial<Record<string, number>>, digits = 9): void {
  expect(Object.keys(got)).toEqual([...AXIS_CODES])
  for (const k of AXIS_CODES) expect(got[k], k).toBeCloseTo(want[k]!, digits)
}

const estimateArb = fc.record({
  axis: fc.constantFrom(...DEV),
  mean: fc.double({ min: -6, max: 6, noNaN: true }),
  sd: fc.double({ min: 0.01, max: 1.5, noNaN: true }),
})

describe('device_estimates: the bounded Gaussian term of the app, stored for the aim', () => {
  it('stores what deviceEvidence makes of an estimate, to 1e-12 (fuzzed: means past the grid, sds under the floor and over the prior)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uniqueArray(estimateArb, { minLength: 1, maxLength: 3, selector: (e) => e.axis }), async (list) => {
        const s = await start()
        expect(await send(s, list)).toEqual({ recorded: list.map((e) => e.axis) })
        const device = ((await stateOf(s.session_id)).device ?? {}) as Record<string, { mean: number; sd: number; lam: number; x: number }>
        for (const e of list) {
          const want = boundedDeviceTerm(e as DeviceEstimate)
          if (want === null) {
            expect(device[e.axis], e.axis).toBeUndefined()
            continue
          }
          const got = device[e.axis]!
          expect(got.mean).toBeCloseTo(want.mean, 12)
          expect(got.sd).toBeCloseTo(want.sd, 12)
          expect(got.lam).toBeCloseTo(want.lam, 9)
          expect(got.x).toBeCloseTo(want.x, 9)
          expect(Math.abs(got.x)).toBeLessThanOrEqual(4)
          expect(got.sd).toBeGreaterThanOrEqual(DEVICE_SD_MIN)
        }
      }),
      { numRuns: 25 },
    )
  }, 120_000)

  it('aims as the app does with the estimates as evidence, with and without served answers (fast-check, 1e-9)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(estimateArb, { minLength: 1, maxLength: 3, selector: (e) => e.axis }),
        fc.array(fc.tuple(fc.constantFrom(...SKILLS), fc.array(fc.boolean(), { minLength: 1, maxLength: 3 })), { maxLength: 2 }),
        async (list, parts) => {
          const s = await start()
          const obs: Observation[] = []
          for (const [axis, answers] of parts) obs.push(...(await play(s, axis, answers)))
          await send(s, list)
          const earlier = list.flatMap((e) => deviceEvidence(e as DeviceEstimate))
          expectAims(await aims(s.session_id), selectionAim(obs, { earlier }))
        },
      ),
      { numRuns: 10 },
    )
  }, 180_000)

  it('a strong memory estimate moves where a reasoning part starts (WM–MAT .40), a weak one the other way', async () => {
    const s = await start()
    expect((await aims(s.session_id)).MAT).toBe(0)
    await send(s, [{ axis: 'WM', mean: 2, sd: 0.4 }])
    expect((await aims(s.session_id)).MAT).toBeGreaterThan(0.3)
    await send(s, [{ axis: 'WM', mean: -2, sd: 0.4 }])
    expect((await aims(s.session_id)).MAT).toBeLessThan(-0.3)
  })

  it('a later call replaces the axis; an estimate that says nothing removes it', async () => {
    const s = await start()
    await send(s, [{ axis: 'RT', mean: 1, sd: 0.5 }, { axis: 'PS', mean: -1, sd: 0.5 }])
    await send(s, [{ axis: 'RT', mean: 0.5, sd: 0.7 }])
    let st = await stateOf(s.session_id)
    expect(Object.keys(st.device).sort()).toEqual(['PS', 'RT'])
    expect(st.device.RT.mean).toBe(0.5)
    await send(s, [{ axis: 'PS', mean: 0, sd: 5 }])
    st = await stateOf(s.session_id)
    expect(Object.keys(st.device)).toEqual(['RT'])
    expect(st.device_calls).toBe(3)
  })

  it('refuses what is not a list of 1 to 3 {axis, mean, sd} on a device skill, once each', async () => {
    const s = await start()
    const bad: unknown[] = [
      null,
      {},
      [],
      [{ axis: 'WM', mean: 0, sd: 0.5 }, { axis: 'RT', mean: 0, sd: 0.5 }, { axis: 'PS', mean: 0, sd: 0.5 }, { axis: 'WM', mean: 0, sd: 0.5 }],
      [{ axis: 'MAT', mean: 0, sd: 0.5 }],
      [{ axis: 'WM', mean: 0, sd: 0 }],
      [{ axis: 'WM', mean: 0, sd: -1 }],
      [{ axis: 'WM', mean: '1', sd: 0.5 }],
      [{ axis: 'WM', mean: 0 }],
      [{ axis: 'WM', mean: 0, sd: 0.5, trials: [1, 2] }],
      [{ axis: 'WM', mean: 0, sd: 0.5 }, { axis: 'WM', mean: 1, sd: 0.5 }],
      ['WM'],
    ]
    for (const b of bad) expect(await failure(send(s, b)), JSON.stringify(b)).toMatchObject({ code: 'PT400', message: 'invalid_estimates' })
    expect(await failure(send(s, [{ axis: 'WM', mean: 0, sd: 0.5, brief_prefs: {} }]))).toMatchObject({ code: 'PT400', message: 'brief_prefs_not_accepted' })
    // nothing was stored by a refused call
    expect((await stateOf(s.session_id)).device).toBeUndefined()
    // a number past a double's range is clamped, not an error
    await send(s, [{ axis: 'WM', mean: 1e300, sd: 1e-300 }])
    expect((await stateOf(s.session_id)).device.WM).toMatchObject({ mean: 4, sd: DEVICE_SD_MIN })
  })

  it('takes at most selection.device_max_calls calls a session, needs an open session of its own, and is off with no device axes', async () => {
    const s = await start()
    for (let i = 0; i < DEVICE_MAX_CALLS; i++) await send(s, [{ axis: 'WM', mean: 0.1, sd: 0.5 }])
    expect(await failure(send(s, [{ axis: 'WM', mean: 0.1, sd: 0.5 }]))).toMatchObject({ code: 'PT429', message: 'too_many_estimates' })
    expect(await failure(db.rpc(from(freshIp()), 'device_estimates', { p_token: 'hbt_AAAAAAAAAAAAAAAAAAAAAA', p_estimates: [{ axis: 'WM', mean: 0, sd: 0.5 }] }))).toMatchObject({ code: 'PT401' })
    const t = await start()
    await db.rpc(from(t.ip), 'finish', { p_token: t.token })
    expect(await failure(send(t, [{ axis: 'WM', mean: 0, sd: 0.5 }]))).toMatchObject({ code: 'PT409', message: 'session_finished' })
    await db.owner.query(`update public.app_config set value = '[]'::jsonb where key = 'selection.device_axes'`)
    try {
      const u = await start()
      expect(await failure(send(u, [{ axis: 'WM', mean: 0, sd: 0.5 }]))).toMatchObject({ code: 'PT400', message: 'invalid_estimates' })
    } finally {
      await db.owner.query(`update public.app_config set value = '["WM","RT","PS"]'::jsonb where key = 'selection.device_axes'`)
    }
  })
})

describe('device estimates change no score', () => {
  it('the session posteriors, the MAP at finish and rescore are the same with and without them', async () => {
    const s = await start()
    await play(s, 'MAT', [true, true, false, true, true, true])
    await play(s, 'VOC', [true, false, true, true, true])
    const posteriors = async (): Promise<unknown> => (await db.owner.query(`select p.* from hb.session_posteriors((select s.state from public.sessions s where s.session_id = $1)) p`, [s.session_id])).rows
    const map = async (): Promise<unknown> => (await db.owner.query(`select hb.session_posterior($1) as p`, [s.session_id])).rows[0]
    const before = { post: await posteriors(), map: await map(), aimMat: (await aims(s.session_id)).MAT! }
    await send(s, [{ axis: 'WM', mean: 3, sd: 0.3 }, { axis: 'RT', mean: -3, sd: 0.3 }])
    // the aim moved (the estimates are read) ...
    expect(Math.abs((await aims(s.session_id)).MAT! - before.aimMat)).toBeGreaterThan(1e-3)
    // ... and nothing that scores did
    expect(await posteriors()).toEqual(before.post)
    expect(await map()).toEqual(before.map)
    const fin = await db.rpc<{ session: Record<string, unknown> }>(from(s.ip), 'finish', { p_token: s.token })
    const st = await stateOf(s.session_id)
    expect(st.posterior).toEqual((before.map as { p: unknown }).p)
    const save = emptySave(s.anon_id, { sessions: [fin.session] })
    const withDevice = await db.rpc(from(freshIp()), 'rescore', { p_save: save })
    await db.owner.query(`update public.sessions set state = state - 'device' - 'device_calls' where session_id = $1`, [s.session_id])
    const without = await db.rpc(from(freshIp()), 'rescore', { p_save: save })
    expect(withDevice).toEqual(without)
  })
})
