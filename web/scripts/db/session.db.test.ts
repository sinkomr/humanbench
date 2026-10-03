/**
 * M2.1 (ROADMAP M2.1; DESIGN §11.2, §13, R-11.1, R-12.1; ROADMAP AI.26): start_session, next_item,
 * submit and finish, called the way the app calls them: as anon, through request(), with a client
 * address in the headers. The bank is synthetic (bank-fixture.ts).
 */

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import Ajv2020 from 'ajv/dist/2020'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { validateSave } from '../../src/save/validate'
import { fixtureBank, loadFixtureBank, numericItem, type FixtureItem } from './bank-fixture'
import type { TestDb } from './harness'
import {
  ANON_ID_RE,
  DEVICE,
  SESSION_ID_RE,
  TOKEN_RE,
  ageExposures,
  emptySave,
  from,
  isServed,
  playSession,
  relaxSelection,
  startSession,
  type Next,
  type Served,
  type Started,
} from './rpc-support'
import { openTestDb, pgCode, rejectedWith } from './vitest'

let db: TestDb
let ipCounter = 0
/** A client address nobody has used yet in this file (the rate limit is per address). */
const freshIp = (): string => `198.51.100.${++ipCounter}`

const bank = new Map<string, FixtureItem>()
const save = JSON.parse(readFileSync(new URL('../../../schema/save-v1.json', import.meta.url), 'utf8')) as Record<string, unknown>
const ajv = new Ajv2020({ strict: true, strictTuples: false, allowUnionTypes: true, allErrors: true })
const validateSchema = ajv.compile(save)

beforeAll(async () => {
  db = await openTestDb()
  await relaxSelection(db)
  const items = fixtureBank({ perAxis: 12, seed: 'session' })
  for (const it of items) bank.set(it.itemId, it)
  await loadFixtureBank(db, items)
})
afterAll(async () => {
  await db.close()
})

const rpc = <T = unknown>(ip: string, fn: string, args: Record<string, unknown> = {}): Promise<T> => db.rpc<T>(from(ip), fn, args)

/** The error code (SQLSTATE) and message an RPC fails with. */
async function failure(promise: Promise<unknown>): Promise<{ code: string | undefined; message: string }> {
  try {
    await promise
  } catch (e) {
    return { code: pgCode(e), message: (e as Error).message }
  }
  throw new Error('expected the call to fail, but it succeeded')
}

const sessionRow = async (id: string): Promise<Record<string, unknown>> => (await db.owner.query(`select * from public.sessions where session_id = $1`, [id])).rows[0] as Record<string, unknown>

describe('start_session', () => {
  it('returns the session id, a one-time token and an anon_id, and stores only the token hash', async () => {
    const s = await startSession(db, freshIp())
    expect(s.session_id).toMatch(SESSION_ID_RE)
    expect(s.token).toMatch(TOKEN_RE)
    expect(s.anon_id).toMatch(ANON_ID_RE)
    expect(s.limits).toEqual({ max_items: 200 })
    const row = await sessionRow(s.session_id)
    expect((row.token_hash as Buffer).toString('hex')).toBe(createHash('sha256').update(s.token).digest('hex'))
    expect(JSON.stringify(row)).not.toContain(s.token)
    expect(row.device).toEqual(DEVICE)
    expect(row.finished_at).toBeNull()
    expect(row.calibration_eligible).toBe(false)
  })

  it('gives each session its own id, token and (without a save) anon_id', async () => {
    const a = await startSession(db, freshIp())
    const b = await startSession(db, freshIp())
    expect(new Set([a.session_id, b.session_id, a.token, b.token, a.anon_id, b.anon_id]).size).toBe(6)
  })

  it('takes the finite-bank seen lists from the server\'s own rows, never from the save (the procedural ones it does take: seen-lists.db.test.ts); the anon_id continues only when the save proves it', async () => {
    const some = [...bank.keys()].slice(0, 3)
    // a save whose anon_id the server never issued (an offline file, a made-up id): its lists of finite-bank items decide nothing, the id is replaced
    const stranger = await startSession(db, freshIp(), emptySave('hb_7Q3m9Kx2Vw5rT8pL', { seen_items: some, seen_families: ['f:tst:000000000000'] }))
    expect(stranger.anon_id).toMatch(ANON_ID_RE)
    expect(stranger.anon_id).not.toBe('hb_7Q3m9Kx2Vw5rT8pL')
    expect(stranger.anon_id_adopted).toBe(false)
    const row = await sessionRow(stranger.session_id)
    expect(row.anon_id).toBe(stranger.anon_id)
    expect(row.state).toEqual({ v: 1, seen_items: [], seen_families: [] })
    // a save that lists a session this server issued to its anon_id: the same person, the id continues
    const ip = freshIp()
    const first = await startSession(db, ip)
    expect(first.anon_id_adopted).toBe(false)
    const served = await rpc<Served>(ip, 'next_item', { p_token: first.token })
    // the proof is a session the server finished and signed for that anon_id (M2.3): the bare id of an unfinished one is not
    const finished = await rpc<{ session: Record<string, unknown> }>(ip, 'finish', { p_token: first.token })
    const bare = await startSession(db, freshIp(), emptySave(first.anon_id, { sessions: [{ session_id: first.session_id }], seen_items: some }))
    expect(bare.anon_id_adopted).toBe(false)
    expect((await sessionRow(bare.session_id)).state).toEqual({ v: 1, seen_items: [], seen_families: [] })
    const again = await startSession(db, freshIp(), emptySave(first.anon_id, { sessions: [finished.session], seen_items: some, seen_families: ['f:tst:000000000000'] }))
    expect(again.anon_id).toBe(first.anon_id)
    expect(again.anon_id_adopted).toBe(true)
    const next = await sessionRow(again.session_id)
    expect(next.anon_id).toBe(first.anon_id)
    // what the person saw is what the server served them (the item that was never answered included), and not what the file claims
    expect(next.state).toEqual({ v: 1, seen_items: [served.item.item_id], seen_families: [bank.get(served.item.item_id)!.familyId] })
  })

  it('never gives a session to an anon_id on its name alone: not on an unproven save, a made-up session, a session of someone else, or a sig.anon_id', async () => {
    const victim = await startSession(db, freshIp())
    const other = await startSession(db, freshIp())
    const claims: Array<[string, Record<string, unknown>]> = [
      ['no session listed', emptySave(victim.anon_id)],
      ['a session id that was never issued', emptySave(victim.anon_id, { sessions: [{ session_id: 's_neverissuedxxxxx' }] })],
      ['a session issued to somebody else', emptySave(victim.anon_id, { sessions: [{ session_id: other.session_id }] })],
      ['somebody else\'s session with its own honest sig, in a file that names the victim', emptySave(victim.anon_id, { sessions: [{ session_id: other.session_id, sig: { alg: 'HMAC-SHA256', kid: 'k', mac: 'x', anon_id: other.anon_id } }] })],
      ['somebody else\'s session with a sig that names the victim', emptySave(victim.anon_id, { sessions: [{ session_id: other.session_id, sig: { alg: 'HMAC-SHA256', kid: 'k', mac: 'x', anon_id: victim.anon_id } }] })],
      ['the victim\'s session with a sig that names somebody else', emptySave(victim.anon_id, { sessions: [{ session_id: victim.session_id, sig: { alg: 'HMAC-SHA256', kid: 'k', mac: 'x', anon_id: other.anon_id } }] })],
      ['a session that is not an object', emptySave(victim.anon_id, { sessions: [victim.session_id, null, 7] })],
    ]
    for (const [what, save] of claims) {
      const s = await startSession(db, freshIp(), save)
      expect(s.anon_id, what).not.toBe(victim.anon_id)
      expect(s.anon_id_adopted, what).toBe(false)
    }
    const rows = await db.owner.query<{ n: number }>(`select count(*)::int as n from public.sessions where anon_id = $1`, [victim.anon_id])
    expect(rows.rows[0]!.n).toBe(1)
  })

  it.each([
    ['a missing key', (d: Record<string, unknown>) => delete d.viewport],
    ['an extra key', (d: Record<string, unknown>) => (d.user_agent = 'Mozilla/5.0 (precise)')],
    ['an unknown class', (d: Record<string, unknown>) => (d.class = 'toaster')],
    ['a precise browser version', (d: Record<string, unknown>) => (d.browser_family = 'Safari 17.2')],
    ['a viewport of three numbers', (d: Record<string, unknown>) => (d.viewport = [1, 2, 3])],
    ['a negative refresh rate', (d: Record<string, unknown>) => (d.refresh_hz_est = -1)],
  ])('refuses a device with %s', async (_name, mutate) => {
    const device = JSON.parse(JSON.stringify(DEVICE)) as Record<string, unknown>
    mutate(device)
    const f = await failure(rpc(freshIp(), 'start_session', { p_device: device }))
    expect(f.code).toBe('PT400')
    expect(f.message).toBe('invalid_device')
  })

  it('refuses a malformed save: not an object, no anon_id, oversized lists, non-string ids', async () => {
    const bad: unknown[] = [[], 'x', { ...emptySave('hb_7Q3m9Kx2Vw5rT8pL'), anon_id: 'nobody' }, { ...emptySave('hb_7Q3m9Kx2Vw5rT8pL'), seen_items: 'all' }, { ...emptySave('hb_7Q3m9Kx2Vw5rT8pL'), seen_items: [1, 2] }, { ...emptySave('hb_7Q3m9Kx2Vw5rT8pL'), sessions: 3 }]
    for (const b of bad) {
      const f = await failure(rpc(freshIp(), 'start_session', { p_device: DEVICE, p_save: b }))
      expect(f.code, JSON.stringify(b)).toBe('PT400')
      expect(f.message).toBe('invalid_save')
    }
  })

  it('refuses a save over the size limit', async () => {
    await db.owner.query(`update public.app_config set value = '4096' where key = 'save.max_bytes'`)
    try {
      const f = await failure(rpc(freshIp(), 'start_session', { p_device: DEVICE, p_save: emptySave('hb_7Q3m9Kx2Vw5rT8pL', { seen_items: Array.from({ length: 400 }, (_, i) => `i:tst:g1:${i}`) }) }))
      expect(f).toMatchObject({ code: 'PT413', message: 'save_too_large' })
    } finally {
      await db.owner.query(`update public.app_config set value = '2097152' where key = 'save.max_bytes'`)
    }
  })

  it('rejects a brief_prefs key anywhere in the device or the save (AI.26), and creates nothing', async () => {
    const before = (await db.owner.query(`select count(*)::int as n from public.sessions`)).rows[0].n as number
    const withPrefs = { v: 1, topics: 'topics-v1', groups: 'g1', notes_as_of: '2026-10', contexts: [], fit_log: [] }
    const payloads: Array<Record<string, unknown>> = [
      { p_device: { ...DEVICE, brief_prefs: withPrefs } },
      { p_device: DEVICE, p_save: emptySave('hb_7Q3m9Kx2Vw5rT8pL', { brief_prefs: withPrefs }) },
      { p_device: DEVICE, p_save: emptySave('hb_7Q3m9Kx2Vw5rT8pL', { sessions: [{ session_id: 's_x', nested: [{ deeper: { Brief_Prefs: 1 } }] }] }) },
    ]
    const ip = freshIp()
    for (const p of payloads) {
      const f = await failure(rpc(ip, 'start_session', p))
      expect(f, JSON.stringify(p).slice(0, 80)).toMatchObject({ code: 'PT400', message: 'brief_prefs_not_accepted' })
    }
    expect((await db.owner.query(`select count(*)::int as n from public.sessions`)).rows[0].n).toBe(before)
    // none of the rejected calls used up this address's five sessions
    for (let i = 0; i < 5; i++) await startSession(db, ip)
  })

  it('allows 5 sessions a day per client address and refuses the 6th, others unaffected', async () => {
    const ip = freshIp()
    for (let i = 0; i < 5; i++) await startSession(db, ip)
    expect(await failure(startSession(db, ip))).toMatchObject({ code: 'PT429', message: 'rate_limited' })
    await expect(startSession(db, freshIp())).resolves.toBeDefined()
  })

  it('counts by hashed address: no address, in any form, is stored in any table', async () => {
    const ip = '203.0.113.77'
    await startSession(db, ip)
    const dump = await db.owner.query<{ t: string }>(
      `select r::text as t from public.rate_limits r union all select r::text from public.rate_salts r
       union all select r::text from public.sessions r union all select r::text from public.flags r union all select r::text from public.mirror r`,
    )
    for (const r of dump.rows) expect(r.t).not.toContain(ip)
    const { rows } = await db.owner.query<{ key_hash: string }>(`select key_hash from public.rate_limits where kind = 'start_session'`)
    for (const r of rows) expect(r.key_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('takes the last entry of x-forwarded-for as the client: the ones before it are the caller\'s own words', async () => {
    const real = `192.0.2.${++ipCounter}`
    // a script that writes a different first entry on every call is still one client: the gateway's entry is the last
    for (let i = 0; i < 5; i++) await startSession(db, `10.9.${i}.1, ${real}`)
    expect(await failure(startSession(db, `10.9.99.1, ${real}`))).toMatchObject({ code: 'PT429' })
    // a different client behind the same chain of proxies is another bucket, and a single-entry header is that entry
    await expect(startSession(db, `10.9.0.1, 192.0.2.${++ipCounter}`)).resolves.toBeDefined()
    await expect(startSession(db, `192.0.2.${++ipCounter}`)).resolves.toBeDefined()
  })

  it('counts from the left or from further right when rate.ip_hop says so', async () => {
    const a = `192.0.2.${++ipCounter}`
    const set = (hop: string): Promise<unknown> => db.owner.query(`update public.app_config set value = $1::jsonb where key = 'rate.ip_hop'`, [hop])
    try {
      // 1 = the first entry (a gateway that overwrites the header): five calls fill the bucket of `a`, wherever the proxies are
      await set('1')
      for (let i = 0; i < 5; i++) await startSession(db, `${a}, 10.0.0.${i}`)
      expect(await failure(startSession(db, `${a}, 10.9.9.9`))).toMatchObject({ code: 'PT429' })
      // -2 = the entry before the last (a CDN appends its own address after the client's)
      await set('-2')
      const b = `192.0.2.${++ipCounter}`
      for (let i = 0; i < 5; i++) await startSession(db, `10.7.${i}.1, ${b}, 10.8.0.${i}`)
      expect(await failure(startSession(db, `10.7.99.1, ${b}, 10.8.9.9`))).toMatchObject({ code: 'PT429' })
      // 0 is read as the last entry, a position beyond the start as the first
      await set('0')
      const c = `192.0.2.${++ipCounter}`
      for (let i = 0; i < 5; i++) await startSession(db, `10.7.${i}.1, ${c}`)
      expect(await failure(startSession(db, `10.7.99.1, ${c}`))).toMatchObject({ code: 'PT429' })
      await set('-9')
      await expect(startSession(db, `192.0.2.${++ipCounter}`)).resolves.toBeDefined()
    } finally {
      await set('-1')
    }
  })

  it('puts a request without the header in one shared bucket (fails closed)', async () => {
    const noHeader = { role: 'anon' as const }
    let refused = false
    for (let i = 0; i < 6 && !refused; i++) {
      try {
        await db.rpc(noHeader, 'start_session', { p_device: DEVICE })
      } catch (e) {
        expect(pgCode(e)).toBe('PT429')
        refused = true
      }
    }
    expect(refused).toBe(true)
  })

  it('rotates the salt daily and purges counts and salts after 48 hours', async () => {
    const ip = freshIp()
    await startSession(db, ip)
    const first = (await db.owner.query<{ key_hash: string }>(`select key_hash from public.rate_limits where kind = 'start_session' order by key_hash`)).rows.map((r) => r.key_hash)
    // pretend everything so far happened three days ago
    await db.owner.query(`update public.rate_limits set day = day - 3`)
    await db.owner.query(`update public.rate_salts set day = day - 3`)
    await startSession(db, ip)
    const after = await db.owner.query<{ key_hash: string; day: string }>(`select key_hash, day::text from public.rate_limits where kind = 'start_session'`)
    // the old rows are gone and today's hash for the same address is a different string
    expect(after.rows.length).toBe(1)
    expect(first).not.toContain(after.rows[0]!.key_hash)
    expect((await db.owner.query(`select count(*)::int as n from public.rate_salts`)).rows[0].n).toBe(1)
  })
})

describe('next_item', () => {
  it.each([['not a token', 'abc'], ['a token-shaped unknown value', 'hbt_AAAAAAAAAAAAAAAAAAAAAA'], ['null', null]])('refuses %s with one answer (401 invalid_session)', async (_n, token) => {
    const f = await failure(rpc(freshIp(), 'next_item', { p_token: token }))
    expect(f).toMatchObject({ code: 'PT401', message: 'invalid_session' })
  })

  it('serves an item with the render payload only, and the same item again until it is answered', async () => {
    const ip = freshIp()
    const s = await startSession(db, ip)
    const a = await rpc<Next>(ip, 'next_item', { p_token: s.token })
    const b = await rpc<Next>(ip, 'next_item', { p_token: s.token })
    expect(a).toEqual(b)
    expect(isServed(a)).toBe(true)
    const served = a as Served
    expect(served.seq).toBe(1)
    expect(Object.keys(served).sort()).toEqual(['item', 'seq'])
    expect(Object.keys(served.item).sort()).toEqual(['item_id', 'item_type', 'media', 'options', 'stem', 'time_limit_s'])
    expect(served.item.item_type).toBe('mc')
    expect(served.item.time_limit_s).toBe(180)
    expect((await sessionRow(s.session_id)).n_served).toBe(1)
  })

  it('never serves a draft, review, pretest, quarantined or retired item, or a practice-only one', async () => {
    const db2 = await openTestDb()
    try {
      const live = fixtureBank({ perAxis: 3, axes: ['QR'], seed: 'status-live' })
      const others = (['draft', 'review', 'pretest', 'quarantined', 'retired'] as const).flatMap((status, i) => fixtureBank({ perAxis: 2, axes: ['MAT'], seed: `status-${status}`, status }).map((it, j) => ({ ...it, itemId: `i:tst:s${i}:${j}`, familyId: `f:tst:${String(i).repeat(6)}${String(j).repeat(6)}`, siblingGroup: `f:tst:${String(i).repeat(6)}${String(j).repeat(6)}` })))
      const practice = fixtureBank({ perAxis: 2, axes: ['QR'], seed: 'practice' }).map((it, j) => ({ ...it, itemId: `i:tst:p:${j}`, familyId: `f:tst:ffffffffff0${j}`, siblingGroup: `f:tst:ffffffffff0${j}`, practiceOnly: true }))
      await loadFixtureBank(db2, [...live, ...others, ...practice])
      const ip = freshIp()
      const s = await db2.rpc<Started>(from(ip), 'start_session', { p_device: DEVICE })
      const served: string[] = []
      for (;;) {
        const n = await db2.rpc<Next>(from(ip), 'next_item', { p_token: s.token })
        if (!isServed(n)) {
          expect(n).toEqual({ done: true, reason: 'no_items' })
          break
        }
        served.push(n.item.item_id)
        await ageExposures(db2, s.session_id, 20)
        await db2.rpc(from(ip), 'submit', { p_token: s.token, p_item_id: n.item.item_id, p_response: 0, p_rt_ms: 4000, p_next: false })
      }
      expect(served.sort()).toEqual(live.map((i) => i.itemId).sort())
    } finally {
      await db2.close()
    }
  })

  it('never serves two items of one sibling group, nor the group of a family the server served this person before; the save\'s own lists decide nothing', async () => {
    const db2 = await openTestDb()
    try {
      // 12 QR items in 4 groups of 3
      const items = fixtureBank({ perAxis: 12, axes: ['QR'], seed: 'groups', groupSize: 3 })
      await loadFixtureBank(db2, items)
      const play = async (saveDoc?: unknown, max = 99): Promise<{ got: FixtureItem[]; ip: string; s: Started }> => {
        const ip = freshIp()
        const s = await db2.rpc<Started>(from(ip), 'start_session', saveDoc === undefined ? { p_device: DEVICE } : { p_device: DEVICE, p_save: saveDoc })
        const got: FixtureItem[] = []
        while (got.length < max) {
          const n = await db2.rpc<Next>(from(ip), 'next_item', { p_token: s.token })
          if (!isServed(n)) break
          got.push(items.find((i) => i.itemId === n.item.item_id)!)
          await ageExposures(db2, s.session_id, 20)
          await db2.rpc(from(ip), 'submit', { p_token: s.token, p_item_id: n.item.item_id, p_response: 0, p_rt_ms: 4000, p_next: false })
        }
        return { got, ip, s }
      }
      const all = (await play()).got
      expect(all.length).toBe(4)
      expect(new Set(all.map((i) => i.siblingGroup)).size).toBe(4)
      // a person who was served one item: the whole group of its family is out of their next session
      const person = async (): Promise<{ first: Awaited<ReturnType<typeof play>>; finished: { session: Record<string, unknown> } }> => {
        const first = await play(undefined, 1)
        return { first, finished: await db2.rpc<{ session: Record<string, unknown> }>(from(first.ip), 'finish', { p_token: first.s.token }) }
      }
      const { first, finished } = await person()
      const rest = await play(emptySave(first.s.anon_id, { sessions: [finished.session] }))
      expect(rest.s.anon_id_adopted).toBe(true)
      expect(rest.got.length).toBe(3)
      expect(rest.got.map((i) => i.siblingGroup)).not.toContain(first.got[0]!.siblingGroup)
      // what a file says it has seen decides nothing: not for a stranger's file, and not for the person's own
      const others = items.filter((i) => i.siblingGroup !== first.got[0]!.siblingGroup)
      const claim = { seen_families: [others[0]!.familyId], seen_items: [others.at(-1)!.itemId] }
      expect((await play(emptySave('hb_7Q3m9Kx2Vw5rT8pL', claim))).got.length).toBe(4)
      const other = await person() // (the first person's later session is in the server's rows now: all 4 groups)
      const othersGroups = items.filter((i) => i.siblingGroup !== other.first.got[0]!.siblingGroup)
      const own = await play(emptySave(other.first.s.anon_id, { sessions: [other.finished.session], seen_families: [othersGroups[0]!.familyId], seen_items: [othersGroups.at(-1)!.itemId] }))
      expect(own.got.map((i) => i.siblingGroup)).not.toContain(other.first.got[0]!.siblingGroup)
      expect(own.got.length).toBe(3)
    } finally {
      await db2.close()
    }
  })

  it('ends a session at max_items with done / item_limit', async () => {
    await db.owner.query(`update public.app_config set value = '2' where key = 'session.max_items'`)
    try {
      const ip = freshIp()
      const s = await startSession(db, ip)
      let n = await rpc<Next>(ip, 'next_item', { p_token: s.token })
      for (let i = 0; i < 2; i++) {
        expect(isServed(n)).toBe(true)
        await ageExposures(db, s.session_id, 20)
        const out = await rpc<{ next: Next }>(ip, 'submit', { p_token: s.token, p_item_id: (n as Served).item.item_id, p_response: 0, p_rt_ms: 3000 })
        n = out.next
      }
      expect(n).toEqual({ done: true, reason: 'item_limit' })
    } finally {
      await db.owner.query(`update public.app_config set value = '200' where key = 'session.max_items'`)
    }
  })

  it('stops working when the token expires or the session is finished', async () => {
    const ip = freshIp()
    const s = await startSession(db, ip)
    await db.owner.query(`update public.sessions set started_at = started_at - interval '13 hours' where session_id = $1`, [s.session_id])
    expect(await failure(rpc(ip, 'next_item', { p_token: s.token }))).toMatchObject({ code: 'PT401', message: 'invalid_session' })
    const t = await startSession(db, ip)
    await rpc(ip, 'finish', { p_token: t.token })
    expect(await failure(rpc(ip, 'next_item', { p_token: t.token }))).toMatchObject({ code: 'PT409', message: 'session_finished' })
  })
})

describe('what a client can learn (R-11.1)', () => {
  it('never sees a key, a tolerance, a rationale, a parameter, a status or a verdict, in any reply of a whole session', async () => {
    const ip = freshIp()
    const s = await startSession(db, ip)
    const replies: unknown[] = [s]
    let n = await rpc<Next>(ip, 'next_item', { p_token: s.token })
    replies.push(n)
    for (let i = 0; i < 25 && isServed(n); i++) {
      await ageExposures(db, s.session_id, 20)
      const out = await rpc<{ next: Next }>(ip, 'submit', { p_token: s.token, p_item_id: n.item.item_id, p_response: i % 4, p_rt_ms: 4000 })
      replies.push(out)
      n = out.next
    }
    replies.push(await rpc(ip, 'finish', { p_token: s.token }))
    const keyed = /"(key|keys|ans|answer|answers|solution|solutions|rationale|tolerance|option_weights|a|b|c|se_b|status|verification|provenance|server_tags)"\s*:/i
    for (const r of replies) expect(JSON.stringify(r)).not.toMatch(keyed)
    // and nothing in a served item or an acknowledgement says whether an answer was right
    // (the finish reply too: it carries the person's own answers, but no verdict on them unless the owner turned that on)
    for (const r of replies.slice(1)) expect(JSON.stringify(r)).not.toMatch(/correct|right|wrong|score|verdict/i)
  })
})

describe('submit', () => {
  it('scores in SQL, stores the answer, and acknowledges without a verdict', async () => {
    const ip = freshIp()
    const s = await startSession(db, ip)
    const n = (await rpc<Next>(ip, 'next_item', { p_token: s.token })) as Served
    const it = bank.get(n.item.item_id)!
    await ageExposures(db, s.session_id, 20)
    const out = await rpc<Record<string, unknown>>(ip, 'submit', {
      p_token: s.token,
      p_item_id: it.itemId,
      p_response: it.key.index,
      p_rt_ms: 7123,
      p_confidence: 80,
      p_client_flags: { paste: true },
      p_next: false,
    })
    expect(out).toEqual({ ack: true, seq: 1 })
    const row = (await db.owner.query(`select * from public.responses where session_id = $1`, [s.session_id])).rows[0]
    expect(row).toMatchObject({ seq: 1, item_id: it.itemId, response: it.key.index, correct: 1, score: 1, rt_ms: 7123, confidence: 80, pretest: false, client_flags: { paste: true } })
    expect((await sessionRow(s.session_id)).n_answered).toBe(1)
  })

  it('scores a wrong, out-of-range or malformed answer as 0', async () => {
    const ip = freshIp()
    const s = await startSession(db, ip)
    for (const response of [null, 'B', 99, -1, 1.5, { index: 1 }]) {
      const n = await rpc<Next>(ip, 'next_item', { p_token: s.token })
      const it = bank.get((n as Served).item.item_id)!
      await ageExposures(db, s.session_id, 20)
      await rpc(ip, 'submit', { p_token: s.token, p_item_id: it.itemId, p_response: response, p_rt_ms: 1000, p_next: false })
    }
    const { rows } = await db.owner.query(`select correct from public.responses where session_id = $1 order by seq`, [s.session_id])
    expect(rows.map((r) => r.correct)).toEqual([0, 0, 0, 0, 0, 0])
  })

  it('acknowledges a repeated answer without changing anything (a retry after a lost reply)', async () => {
    const ip = freshIp()
    const s = await startSession(db, ip)
    const n = (await rpc<Next>(ip, 'next_item', { p_token: s.token })) as Served
    await ageExposures(db, s.session_id, 20)
    const args = { p_token: s.token, p_item_id: n.item.item_id, p_response: 0, p_rt_ms: 2000 }
    const first = await rpc<{ ack: boolean; next: Next }>(ip, 'submit', args)
    const again = await rpc<{ ack: boolean; next: Next }>(ip, 'submit', { ...args, p_response: 3 })
    expect(again.ack).toBe(true)
    // the same next item comes back (it is pending), nothing was stored twice or overwritten
    expect(again.next).toEqual(first.next)
    const { rows } = await db.owner.query(`select response from public.responses where session_id = $1`, [s.session_id])
    expect(rows).toEqual([{ response: 0 }])
    expect((await sessionRow(s.session_id)).n_answered).toBe(1)
  })

  it('refuses an item the session was not served, bad numbers and bad flags', async () => {
    const ip = freshIp()
    const s = await startSession(db, ip)
    const n = (await rpc<Next>(ip, 'next_item', { p_token: s.token })) as Served
    const other = [...bank.keys()].find((k) => k !== n.item.item_id)!
    const ok = { p_token: s.token, p_item_id: n.item.item_id, p_response: 0, p_rt_ms: 2000 }
    expect(await failure(rpc(ip, 'submit', { ...ok, p_item_id: other }))).toMatchObject({ code: 'PT404', message: 'item_not_served' })
    expect(await failure(rpc(ip, 'submit', { ...ok, p_rt_ms: -5 }))).toMatchObject({ code: 'PT400', message: 'invalid_rt' })
    expect(await failure(rpc(ip, 'submit', { ...ok, p_rt_ms: 4_000_000 }))).toMatchObject({ code: 'PT400', message: 'invalid_rt' })
    expect(await failure(rpc(ip, 'submit', { ...ok, p_confidence: 101 }))).toMatchObject({ code: 'PT400', message: 'invalid_confidence' })
    expect(await failure(rpc(ip, 'submit', { ...ok, p_client_flags: { Paste: true } }))).toMatchObject({ code: 'PT400', message: 'invalid_flags' })
    expect(await failure(rpc(ip, 'submit', { ...ok, p_client_flags: { nested: { a: 1 } } }))).toMatchObject({ code: 'PT400', message: 'invalid_flags' })
    expect(await failure(rpc(ip, 'submit', { ...ok, p_response: 'x'.repeat(70_000) }))).toMatchObject({ code: 'PT413', message: 'response_too_large' })
    expect((await db.owner.query(`select count(*)::int as n from public.responses where session_id = $1`, [s.session_id])).rows[0].n).toBe(0)
  })

  it('rejects a brief_prefs key in a response or in the flags, and stores nothing', async () => {
    const ip = freshIp()
    const s = await startSession(db, ip)
    const n = (await rpc<Next>(ip, 'next_item', { p_token: s.token })) as Served
    await ageExposures(db, s.session_id, 20)
    const ok = { p_token: s.token, p_item_id: n.item.item_id, p_rt_ms: 2000 }
    expect(await failure(rpc(ip, 'submit', { ...ok, p_response: { a: [{ brief_prefs: {} }] } }))).toMatchObject({ code: 'PT400', message: 'brief_prefs_not_accepted' })
    expect(await failure(rpc(ip, 'submit', { ...ok, p_response: 0, p_client_flags: { brief_prefs: true } }))).toMatchObject({ code: 'PT400', message: 'brief_prefs_not_accepted' })
    expect((await db.owner.query(`select count(*)::int as n from public.responses where session_id = $1`, [s.session_id])).rows[0].n).toBe(0)
  })

  it('blocks a session that answers faster than 2 s an item on average, by the server clock', async () => {
    const ip = freshIp()
    const s = await startSession(db, ip)
    let n = (await rpc<Next>(ip, 'next_item', { p_token: s.token })) as Next
    let failed: { code: string | undefined; message: string } | undefined
    let answered = 0
    for (let i = 0; i < 14 && isServed(n); i++) {
      try {
        // the client claims a long response time; the server does not take its word for it
        const out = await rpc<{ next: Next }>(ip, 'submit', { p_token: s.token, p_item_id: n.item.item_id, p_response: 0, p_rt_ms: 60_000 })
        answered++
        n = out.next
      } catch (e) {
        failed = { code: pgCode(e), message: (e as Error).message }
        break
      }
    }
    expect(failed).toMatchObject({ code: 'PT429', message: 'too_fast' })
    expect(answered).toBe(9)
    // a slow person is not blocked: age the exposures and the same answer goes through
    await ageExposures(db, s.session_id, 30)
    await expect(rpc(ip, 'submit', { p_token: s.token, p_item_id: (n as Served).item.item_id, p_response: 0, p_rt_ms: 60_000 })).resolves.toMatchObject({ ack: true })
  })
})

describe('scoring the other key shapes', () => {
  let db2: TestDb
  const items: FixtureItem[] = [
    numericItem(1, 'QR', '7/2', { abs: 0.05 }),
    numericItem(2, 'QR', '1500', { rel: 0.01 }),
    numericItem(3, 'QR', '-3', { abs: 0 }),
  ]
  const score = async (itemId: string, response: unknown): Promise<unknown> => {
    const { rows } = await db2.owner.query(`select o_correct, o_score from hb.score_response($1, $2::jsonb)`, [itemId, JSON.stringify(response)])
    return rows[0]
  }
  beforeAll(async () => {
    db2 = await openTestDb()
    await loadFixtureBank(db2, items)
    // an MC item with a letter key and one with option weights, written directly
    await db2.owner.query(`update public.item_keys set key = '{"letter":"c"}' where item_id = $1`, [items[2]!.itemId])
  })
  afterAll(async () => {
    await db2.close()
  })

  it('numeric entry: exact rationals, thousands commas, signs, currency and percent marks, tolerance abs and rel', async () => {
    const id = items[0]!.itemId
    for (const [entry, right] of [['3.5', 1], ['7/2', 1], ['3 1/2', 1], ['3.52', 1], ['3.56', 0], ['$3.50', 1], ['  3.5 ', 1], ['3,5', 0], ['x', 0], ['', 0], [null, 0], [3.5, 1], [{ v: 1 }, 0]] as const) {
      expect(await score(id, entry), String(entry)).toMatchObject({ o_correct: right })
    }
    const big = items[1]!.itemId
    for (const [entry, right] of [['1500', 1], ['1,512', 1], ['1,516', 0], ['1485', 1], ['1484', 0]] as const) expect(await score(big, entry), entry).toMatchObject({ o_correct: right })
  })

  it('letter keys compare the trimmed, case-folded letter', async () => {
    const id = items[2]!.itemId
    expect(await score(id, 'C')).toMatchObject({ o_correct: 1, o_score: 1 })
    expect(await score(id, ' c ')).toMatchObject({ o_correct: 1 })
    expect(await score(id, 'B')).toMatchObject({ o_correct: 0, o_score: 0 })
    expect(await score(id, 2)).toMatchObject({ o_correct: 0 })
  })

  it('an item with no key row (a block) is unscored; option_weights set the score', async () => {
    await db2.owner.query(`insert into public.item_families (family_id, axis, source, license, created_by) values ('f:tst:bbbbbbbbbbbb', 'RT', '{}', 'CC0', 'test')`)
    await db2.owner.query(`insert into public.items (item_id, family_id, item_type, payload, verification, provenance) values ('i:tst:blk:1', 'f:tst:bbbbbbbbbbbb', 'rt_simple', '{}', '{}', '{}')`)
    expect(await score('i:tst:blk:1', { trials: [] })).toMatchObject({ o_correct: null, o_score: null })
    await db2.owner.query(`insert into public.item_families (family_id, axis, source, license, created_by) values ('f:tst:cccccccccccc', 'EMO', '{}', 'CC0', 'test')`)
    await db2.owner.query(`insert into public.items (item_id, family_id, item_type, payload, verification, provenance) values ('i:tst:sjt:1', 'f:tst:cccccccccccc', 'mc', '{"options":["A","B","C"]}', '{}', '{}')`)
    await db2.owner.query(`insert into public.item_keys (item_id, key, option_weights) values ('i:tst:sjt:1', '{"index":1}', '[0.25, 1, 0.5]')`)
    expect(await score('i:tst:sjt:1', 2)).toMatchObject({ o_correct: 0, o_score: 0.5 })
    expect(await score('i:tst:sjt:1', 1)).toMatchObject({ o_correct: 1, o_score: 1 })
    expect(await score('i:tst:sjt:1', 7)).toMatchObject({ o_correct: 0, o_score: 0 })
  })
})

describe('finish', () => {
  const asSave = (sessionObject: unknown, anonId: string): Record<string, unknown> => emptySave(anonId, { sessions: [sessionObject] })

  it('returns the session as a save-v1 session, built from the rows the server holds', async () => {
    const ip = freshIp()
    const s = await startSession(db, ip)
    await playSession(db, s, bank, { ip, n: 6, decide: (_it, seq) => seq % 2 === 0 })
    const out = await rpc<{ session: Record<string, unknown>; anon_id: string; n_responses: number }>(ip, 'finish', { p_token: s.token, p_flags: { visibility_hidden_s: 3, paste_events: 0, fast_guess_n: 0 } })
    // M2.2: nothing in the reply is a function of which answers were right (no eligibility, no posterior; the scores come from rescore)
    expect(Object.keys(out).sort()).toEqual(['anon_id', 'n_responses', 'session'])
    expect(out.anon_id).toBe(s.anon_id)
    expect(out.n_responses).toBe(6)
    expect(out.session.session_id).toBe(s.session_id)
    expect(out.session.started_utc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    expect(out.session.device).toEqual(DEVICE)
    const responses = out.session.responses as unknown[][]
    expect(responses.length).toBe(6)
    for (const t of responses) {
      expect(t.length).toBe(6)
      expect(t[1]).toBe(0)
      expect(t[3], 'no verdict on an answer').toBeNull()
      expect(t[4]).toBe(5000)
      expect(t[5]).toBeNull()
    }
    expect(out.session.flags).toMatchObject({ visibility_hidden_s: 3, paste_events: 0, fast_guess_n: 0, server_too_fast: false })
    expect(Object.keys(out.session.flags as object).sort()).toEqual(['fast_guess_n', 'paste_events', 'server_avg_item_ms', 'server_too_fast', 'visibility_hidden_s'])
    // it is a valid save once merged into a file for that anon_id, by the schema and by the app's validator
    const doc = asSave(out.session, out.anon_id)
    expect(validateSchema(doc), JSON.stringify(validateSchema.errors)).toBe(true)
    expect(validateSave(doc).ok).toBe(true)
  })

  it('does not let a script read a key off a finished session: right answers and wrong answers come back alike', async () => {
    const run = async (pick: (it: FixtureItem) => number): Promise<unknown[][]> => {
      const ip = freshIp()
      const s = await startSession(db, ip)
      let n = await rpc<Next>(ip, 'next_item', { p_token: s.token })
      for (let i = 0; i < 8 && isServed(n); i++) {
        await ageExposures(db, s.session_id, 20)
        n = (await rpc<{ next: Next }>(ip, 'submit', { p_token: s.token, p_item_id: n.item.item_id, p_response: pick(bank.get(n.item.item_id)!), p_rt_ms: 4000 })).next
      }
      return (await rpc<{ session: { responses: unknown[][] } }>(ip, 'finish', { p_token: s.token })).session.responses
    }
    const right = await run((it) => it.key.index as number)
    const wrong = await run((it) => ((it.key.index as number) + 1) % it.nOptions)
    expect(right.length).toBe(8)
    expect(wrong.length).toBe(8)
    for (const t of [...right, ...wrong]) expect(t[3]).toBeNull()
    // the server keeps its verdicts for itself (rescore, calibration)
    expect((await db.owner.query<{ n: number }>(`select count(*)::int as n from public.responses where correct = 1`)).rows[0]!.n).toBeGreaterThan(0)
  })

  it('never puts the verdict of an answer into the session, whatever app_config holds (owner decision 2026-10-01; R-11.1, DESIGN §10)', async () => {
    const ip = freshIp()
    const s = await startSession(db, ip)
    await playSession(db, s, bank, { ip, n: 6, decide: (_it, seq) => seq % 2 === 0 })
    // the switch of the first M2.1 draft is gone: no seed row, and a row under the old name does nothing
    expect((await db.owner.query(`select 1 from public.app_config where key = 'finish.include_correct'`)).rowCount).toBe(0)
    await db.owner.query(`insert into public.app_config (key, value, description) values ('finish.include_correct', 'true', 'test: the retired switch')`)
    try {
      const out = await rpc<{ session: { responses: unknown[][] } }>(ip, 'finish', { p_token: s.token })
      expect(out.session.responses.length).toBe(6)
      for (const t of out.session.responses) expect(t[3]).toBeNull()
      expect(validateSchema(asSave(out.session, s.anon_id)), JSON.stringify(validateSchema.errors)).toBe(true)
    } finally {
      await db.owner.query(`delete from public.app_config where key = 'finish.include_correct'`)
    }
    // the rows keep the verdicts, for the server (rescore, calibration)
    expect((await db.owner.query<{ n: number }>(`select count(*)::int as n from public.responses where session_id = $1 and correct is not null`, [s.session_id])).rows[0]!.n).toBe(6)
  })

  it('is idempotent: a second finish returns the same session and changes nothing', async () => {
    const ip = freshIp()
    const s = await startSession(db, ip)
    await playSession(db, s, bank, { ip, n: 3, decide: () => true })
    const a = await rpc<Record<string, unknown>>(ip, 'finish', { p_token: s.token })
    const row = await sessionRow(s.session_id)
    const b = await rpc<Record<string, unknown>>(ip, 'finish', { p_token: s.token, p_flags: { paste_events: 99 } })
    const a2 = a.session as Record<string, unknown>
    const b2 = b.session as Record<string, unknown>
    expect({ ...b2, duration_s: 0 }).toEqual({ ...a2, duration_s: 0 })
    expect((await sessionRow(s.session_id)).finished_at).toEqual(row.finished_at)
  })

  it('refuses flags that are not snake_case numbers, booleans or null, and a brief_prefs key', async () => {
    const ip = freshIp()
    const s = await startSession(db, ip)
    expect(await failure(rpc(ip, 'finish', { p_token: s.token, p_flags: { Note: 'free text' } }))).toMatchObject({ code: 'PT400', message: 'invalid_flags' })
    expect(await failure(rpc(ip, 'finish', { p_token: s.token, p_flags: { ok: 1, text: 'x' } }))).toMatchObject({ code: 'PT400', message: 'invalid_flags' })
    expect(await failure(rpc(ip, 'finish', { p_token: s.token, p_flags: { brief_prefs: true } }))).toMatchObject({ code: 'PT400', message: 'brief_prefs_not_accepted' })
    expect((await sessionRow(s.session_id)).finished_at).toBeNull()
  })

  describe('calibration eligibility (DESIGN §13)', () => {
    const eligible = async (n: number, flags: Record<string, unknown> | undefined, itemFlags?: (seq: number) => Record<string, unknown> | undefined): Promise<boolean> => {
      const ip = freshIp()
      const s = await startSession(db, ip)
      await playSession(db, s, bank, { ip, n, decide: () => true, ...(itemFlags === undefined ? {} : { clientFlags: itemFlags }) })
      const out = await rpc<Record<string, unknown>>(ip, 'finish', { p_token: s.token, ...(flags === undefined ? {} : { p_flags: flags }) })
      // eligibility is a function of the answers' verdicts (M2.2), so it is kept and used, never returned
      expect(out).not.toHaveProperty('calibration_eligible')
      return (await sessionRow(s.session_id)).calibration_eligible as boolean
    }

    it('is true for a clean session and one flag, false for none answered, two flags, misfit', async () => {
      expect(await eligible(4, undefined)).toBe(true)
      expect(await eligible(4, undefined, (seq) => (seq === 2 ? { paste: true } : undefined))).toBe(true)
      expect(await eligible(0, undefined)).toBe(false)
      expect(await eligible(4, undefined, (seq) => (seq <= 2 ? { too_fast: true } : undefined))).toBe(false)
      expect(await eligible(4, undefined, (seq) => (seq === 1 ? { paste: true, visibility_hidden: 1 } : undefined))).toBe(false)
      expect(await eligible(4, { uniform_rt: true, hard_item_accuracy: true })).toBe(false)
      expect(await eligible(4, { uniform_rt: true })).toBe(true)
      expect(await eligible(4, { person_fit: true })).toBe(false)
      expect(await eligible(4, { calibration_eligible: true, person_fit: true })).toBe(false) // the client's own verdict is not taken
    })

    it('is false when the server timed the session under 2 s an item', async () => {
      await db.owner.query(`update public.app_config set value = '3' where key = 'session.min_avg_after'`)
      try {
        const ip = freshIp()
        const s = await startSession(db, ip)
        let n = (await rpc<Next>(ip, 'next_item', { p_token: s.token })) as Served
        for (let i = 0; i < 2; i++) {
          const out = await rpc<{ next: Next }>(ip, 'submit', { p_token: s.token, p_item_id: n.item.item_id, p_response: 0, p_rt_ms: 9000 })
          n = out.next as Served
        }
        await db.owner.query(`update public.app_config set value = '2' where key = 'session.min_avg_after'`)
        const out = await rpc<{ session: { flags: Record<string, unknown> } }>(ip, 'finish', { p_token: s.token })
        expect((await sessionRow(s.session_id)).calibration_eligible).toBe(false)
        expect(out.session.flags.server_too_fast).toBe(true)
        expect(typeof out.session.flags.server_avg_item_ms).toBe('number')
      } finally {
        await db.owner.query(`update public.app_config set value = '10' where key = 'session.min_avg_after'`)
      }
    })
  })

  it('keeps the token useful for a day for report, survey and mirror, then not', async () => {
    const ip = freshIp()
    const s = await startSession(db, ip)
    await rpc(ip, 'finish', { p_token: s.token })
    await expect(rpc(ip, 'submit_survey', { p_token: s.token, p_age_band: '25-34' })).resolves.toEqual({ recorded: true })
    await db.owner.query(`update public.sessions set finished_at = finished_at - interval '25 hours' where session_id = $1`, [s.session_id])
    expect(await failure(rpc(ip, 'submit_survey', { p_token: s.token, p_age_band: '25-34' }))).toMatchObject({ code: 'PT401' })
  })

  it('refuses a submit after finish', async () => {
    const ip = freshIp()
    const s = await startSession(db, ip)
    const n = (await rpc<Next>(ip, 'next_item', { p_token: s.token })) as Served
    await rpc(ip, 'finish', { p_token: s.token })
    expect(await failure(rpc(ip, 'submit', { p_token: s.token, p_item_id: n.item.item_id, p_response: 0, p_rt_ms: 1000 }))).toMatchObject({ code: 'PT409', message: 'session_finished' })
  })
})

describe('the tables hold what the RPCs wrote and nothing the client could not have sent', () => {
  it('keeps every client JSON column free of brief_prefs even when written around the RPCs (a CHECK on each)', async () => {
    const ip = freshIp()
    const s = await startSession(db, ip)
    const n = (await rpc<Next>(ip, 'next_item', { p_token: s.token })) as Served
    const bad = JSON.stringify({ x: [{ brief_prefs: {} }] })
    expect(pgCode(await db.owner.query(`update public.sessions set flags = $2::jsonb where session_id = $1`, [s.session_id, bad]).catch((e: unknown) => e))).toBe('23514')
    expect(pgCode(await db.owner.query(`update public.sessions set device = $2::jsonb where session_id = $1`, [s.session_id, bad]).catch((e: unknown) => e))).toBe('23514')
    expect(pgCode(await db.owner.query(`update public.sessions set state = $2::jsonb where session_id = $1`, [s.session_id, bad]).catch((e: unknown) => e))).toBe('23514')
    expect(pgCode(await db.owner.query(`insert into public.responses (session_id, seq, item_id, response) values ($1, 1, $2, $3::jsonb)`, [s.session_id, n.item.item_id, bad]).catch((e: unknown) => e))).toBe('23514')
    expect(pgCode(await db.owner.query(`insert into public.responses (session_id, seq, item_id, client_flags) values ($1, 1, $2, $3::jsonb)`, [s.session_id, n.item.item_id, bad]).catch((e: unknown) => e))).toBe('23514')
  })

  it('has no notes table and no brief column anywhere in the schema (AI.26)', async () => {
    const { rows } = await db.owner.query<{ name: string }>(
      `select c.relname || '.' || coalesce(a.attname, '') as name
         from pg_class c join pg_namespace n on n.oid = c.relnamespace left join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        where n.nspname in ('public', 'hb') and c.relkind in ('r', 'p', 'v', 'm') and (c.relname ~* '(brief|note|pref)' or a.attname ~* '(brief|note|pref)')`,
    )
    expect(rows).toEqual([])
  })

  it('does not let an anon-key client touch a table directly, only through the RPCs', async () => {
    expect(await rejectedWith(db.query(from(freshIp()), `select * from public.sessions`))).toBe('42501')
  })
})
