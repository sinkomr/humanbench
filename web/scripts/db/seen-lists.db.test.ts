/**
 * M2.2 (ROADMAP M2.2; DESIGN §7.7, §8, §10, §11.2, R-11.1; ROADMAP A11, A16, A24-sec): what keeps an item away from a
 * new session (`hb.seen_for_session`, supabase/README.md "What the next item tells").
 *
 * - what the SERVER served to the anon_ids the person's file proves (a file merged from two devices proves both);
 * - what the file says it has seen counts for PROCEDURAL families only (the reveal's worked examples, DESIGN §10, and what
 *   an offline session served), never for the finite bank: a client that could name finite items would choose which one it
 *   is served (the audit that closed that hole is the other half of this file).
 *
 * The bank is synthetic: QR items stand for the finite bank, MAT items for procedural families (`source.type`
 * 'procedural'), KST items for a procedural family of authored content (the reading bank, `provenance.finite_content`).
 * relaxSelection makes a session serve its whole pool (no cap, floor or pretest slots), so the items a session is served
 * are the pool the file left it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fixtureBank, loadFixtureBank, type FixtureItem } from './bank-fixture'
import type { TestDb } from './harness'
import { ageExposures, emptySave, from, isServed, relaxSelection, startSession, type Next, type Started } from './rpc-support'
import { openTestDb } from './vitest'

let db: TestDb
let ipCounter = 0
const freshIp = (): string => {
  const n = ++ipCounter
  return `198.19.${Math.floor(n / 250)}.${(n % 250) + 1}`
}

const bank = new Map<string, FixtureItem>()
let finite: FixtureItem[] = []
let procedural: FixtureItem[] = []
let authored: FixtureItem[] = []

beforeAll(async () => {
  db = await openTestDb()
  await relaxSelection(db)
  const all = fixtureBank({ perAxis: 6, axes: ['QR', 'MAT', 'KST'], seed: 'seen-lists' })
  const items = all.map((it) => (it.axis === 'MAT' ? { ...it, procedural: true } : it.axis === 'KST' ? { ...it, procedural: true, finiteContent: true } : it))
  for (const it of items) bank.set(it.itemId, it)
  finite = items.filter((i) => i.axis === 'QR')
  procedural = items.filter((i) => i.axis === 'MAT')
  authored = items.filter((i) => i.axis === 'KST')
  await loadFixtureBank(db, items)
})
afterAll(async () => {
  await db.close()
})

interface Played {
  readonly s: Started
  readonly ip: string
  /** The items served and answered, in order. */
  readonly ids: string[]
}

/** Starts a session with `save` and has it served and answers up to `max` items (all it will be served by default). */
async function play(save?: unknown, max = 999): Promise<Played> {
  const ip = freshIp()
  const s = await startSession(db, ip, save)
  const ids: string[] = []
  while (ids.length < max) {
    const n = await db.rpc<Next>(from(ip), 'next_item', { p_token: s.token })
    if (!isServed(n)) break
    ids.push(n.item.item_id)
    await ageExposures(db, s.session_id, 20)
    await db.rpc(from(ip), 'submit', { p_token: s.token, p_item_id: n.item.item_id, p_response: bank.get(n.item.item_id)!.key.index, p_rt_ms: 5000, p_next: false })
  }
  return { s, ip, ids }
}

/** A person with a finished, signed session of `k` served items: the session object and the anon_id it was issued to. */
async function person(k: number): Promise<{ session: Record<string, unknown>; anonId: string; ids: string[] }> {
  const p = await play(undefined, k)
  const fin = await db.rpc<{ session: Record<string, unknown> }>(from(p.ip), 'finish', { p_token: p.s.token })
  return { session: fin.session, anonId: p.s.anon_id, ids: p.ids }
}

/** The seen lists a session was started with (the rest of `state` is what its answers add). */
const stateOf = async (sessionId: string): Promise<{ v: number; seen_items: string[]; seen_families: string[] }> => {
  const { rows } = await db.owner.query<{ state: { v: number; seen_items: string[]; seen_families: string[] } }>(`select state from public.sessions where session_id = $1`, [sessionId])
  const { v, seen_items, seen_families } = rows[0]!.state
  return { v, seen_items, seen_families }
}
const sorted = (xs: readonly string[]): string[] => [...new Set(xs)].sort()
const idsOf = (items: readonly FixtureItem[]): string[] => items.map((i) => i.itemId)
const familiesOf = (items: readonly FixtureItem[]): string[] => sorted([...new Set(items.map((i) => i.familyId))])
/** The whole bank, as a sorted list of item ids. */
const everything = (): string[] => sorted([...bank.keys()])
const STRANGER = 'hb_7Q3m9Kx2Vw5rT8pL'

describe('a file that lists finite-bank items and families', () => {
  it('decides nothing: not every item but one, not every family but one, from a stranger or from a file that proves its anon_id', async () => {
    const all = await play()
    expect(sorted(all.ids)).toEqual(everything()) // the pool of an unconstrained session is the bank
    const [, ...rest] = finite
    const claim = { seen_items: idsOf(rest), seen_families: familiesOf(rest) }
    const stranger = await play(emptySave(STRANGER, claim))
    expect(sorted(stranger.ids)).toEqual(everything())
    expect(await stateOf(stranger.s.session_id)).toEqual({ v: 1, seen_items: [], seen_families: [] })
    const who = await person(1)
    const own = await play(emptySave(who.anonId, { sessions: [who.session], ...claim }))
    expect(own.s.anon_id_adopted).toBe(true)
    // only what the server served this person (one item, and the family of it) is kept out: the finite items the file listed are served
    expect(sorted(own.ids)).toEqual(everything().filter((id) => !who.ids.includes(id)))
    expect((await stateOf(own.s.session_id)).seen_items).toEqual(who.ids)
  })

  it('decides nothing for a family of authored content (the reading bank) either, though the bank calls it procedural', async () => {
    const claim = { seen_items: idsOf(authored), seen_families: familiesOf(authored) }
    const p = await play(emptySave(STRANGER, claim))
    expect(sorted(p.ids)).toEqual(everything())
    expect(await stateOf(p.s.session_id)).toEqual({ v: 1, seen_items: [], seen_families: [] })
  })

  it('and names nothing the bank does not know: unknown ids are dropped, so the state stays as small as the bank', async () => {
    const claim = { seen_items: ['i:zz:1.0.0:aaa', 'i:mat:1.0.0:s1'], seen_families: ['f:zz:000000000000', 'f:mat:abcdef012345', 'x', ''] }
    const p = await play(emptySave(STRANGER, claim), 0)
    expect(await stateOf(p.s.session_id)).toEqual({ v: 1, seen_items: [], seen_families: [] })
  })
})

describe('a file that lists procedural families (the reveal\'s worked examples, an offline session)', () => {
  it('keeps them, and their items, out of the next session: by family id, and by the id of an item of the family', async () => {
    // the reveal writes the families of its three worked examples to seen_families (web/src/reveal/worked/index.ts)
    const [a, b, c, d, ...rest] = procedural
    const claim = { seen_families: [a!.familyId, b!.familyId], seen_items: [c!.itemId] }
    const p = await play(emptySave(STRANGER, claim))
    expect(p.s.anon_id_adopted).toBe(false)
    expect(sorted(p.ids)).toEqual(everything().filter((id) => ![a!.itemId, b!.itemId, c!.itemId].includes(id)))
    expect(p.ids).toContain(d!.itemId)
    expect(rest.every((i) => p.ids.includes(i.itemId))).toBe(true)
    // the state holds the families and the item the bank knows, sorted
    expect(await stateOf(p.s.session_id)).toMatchObject({ v: 1, seen_items: [c!.itemId], seen_families: familiesOf([a!, b!, c!]) })
  })

  it('does so with a file that proves its anon_id too, next to what the server served', async () => {
    const who = await person(2)
    const worked = procedural.filter((i) => !who.ids.includes(i.itemId)).slice(0, 2)
    const p = await play(emptySave(who.anonId, { sessions: [who.session], seen_families: familiesOf(worked) }), 0)
    expect(p.s.anon_id_adopted).toBe(true)
    const st = await stateOf(p.s.session_id)
    expect(st.seen_items).toEqual(sorted(who.ids))
    expect(st.seen_families).toEqual(familiesOf([...who.ids.map((id) => bank.get(id)!), ...worked]))
    const full = await play(emptySave(who.anonId, { sessions: [who.session], seen_families: familiesOf(worked) }))
    for (const it of worked) expect(full.ids).not.toContain(it.itemId)
  })

  it('leaves the finite bank alone: a file that names every procedural family and every finite item narrows only the procedural ones', async () => {
    // the most a client can do: leave one procedural item, and the finite bank is still the whole of it
    const [kept, ...rest] = procedural
    const claim = { seen_items: [...idsOf(finite), ...idsOf(rest)], seen_families: [...familiesOf(finite), ...familiesOf(rest)] }
    const p = await play(emptySave(STRANGER, claim))
    expect(sorted(p.ids)).toEqual(sorted([...idsOf(finite), ...idsOf(authored), kept!.itemId]))
  })

  it('names a sibling group by one of its families: the group is out of the session (A11, A18)', async () => {
    const db2 = await openTestDb()
    try {
      // 12 MAT items, 4 groups of 3 families that show the same givens; all procedural
      const items = fixtureBank({ perAxis: 12, axes: ['MAT'], seed: 'seen-groups', groupSize: 3 }).map((i) => ({ ...i, procedural: true }))
      await loadFixtureBank(db2, items)
      await relaxSelection(db2)
      const ip = freshIp()
      const s = await startSession(db2, ip, emptySave(STRANGER, { seen_families: [items[0]!.familyId] }))
      const got: string[] = []
      for (;;) {
        const n = await db2.rpc<Next>(from(ip), 'next_item', { p_token: s.token })
        if (!isServed(n)) break
        got.push(n.item.item_id)
        await ageExposures(db2, s.session_id, 20)
        await db2.rpc(from(ip), 'submit', { p_token: s.token, p_item_id: n.item.item_id, p_response: 0, p_rt_ms: 4000, p_next: false })
      }
      const group = items[0]!.siblingGroup
      expect(got.length).toBe(3) // one item of each of the three other groups
      expect(got.map((id) => items.find((i) => i.itemId === id)!.siblingGroup)).not.toContain(group)
    } finally {
      await db2.close()
    }
  })

  it('takes lists at the largest size a save may hold, and finds the ids of the bank among thousands of others', async () => {
    const noise = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i.toString(16).padStart(12, '0')}`)
    const claim = { seen_items: [...noise('i:zz:1.0.0:', 19_999), procedural[0]!.itemId], seen_families: [...noise('f:zz:', 19_999), procedural[1]!.familyId] }
    const started = Date.now()
    const p = await play(emptySave(STRANGER, claim), 0)
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(await stateOf(p.s.session_id)).toMatchObject({ seen_items: [procedural[0]!.itemId], seen_families: familiesOf(procedural.slice(0, 2)) })
  })
})

describe('a file padded with sessions of ids the server never issued', () => {
  it('proves nothing and costs one comparison a session and id: 200 sessions with 200 different ids are answered at once', async () => {
    const sessions = Array.from({ length: 200 }, (_, i) => ({
      session_id: `s_made${String(i).padStart(8, '0')}`,
      sig: { alg: 'HMAC-SHA256', kid: 'k2026a', mac: 'AAAA', anon_id: `hb_${String(i).padStart(16, 'Q')}` },
    }))
    const started = Date.now()
    const p = await play(emptySave(sessions[0]!.sig.anon_id, { sessions }), 0)
    expect(Date.now() - started).toBeLessThan(3_000)
    expect(p.s.anon_id_adopted).toBe(false)
    expect(await stateOf(p.s.session_id)).toEqual({ v: 1, seen_items: [], seen_families: [] })
  })
})

describe('a file merged from two devices (R-8.1)', () => {
  it('proves each id its sessions belong to: what the server served under either keeps the items out, and the file\'s own id is continued', async () => {
    const a = await person(2)
    const b = await person(3)
    const merged = (anonId: string): Record<string, unknown> => emptySave(anonId, { sessions: [a.session, b.session] })
    const own = await play(merged(a.anonId), 0)
    expect(own.s.anon_id_adopted).toBe(true)
    expect(own.s.anon_id).toBe(a.anonId)
    expect((await stateOf(own.s.session_id)).seen_items).toEqual(sorted([...a.ids, ...b.ids]))
    const other = await play(merged(b.anonId), 0)
    expect(other.s.anon_id).toBe(b.anonId)
    expect((await stateOf(other.s.session_id)).seen_items).toEqual(sorted([...a.ids, ...b.ids]))
    // the items served to either are kept out of everything the person is served next
    const next = await play(merged(a.anonId))
    const served = new Set([...a.ids, ...b.ids])
    expect(sorted(next.ids)).toEqual(everything().filter((id) => !served.has(id)))
  })

  it('does so when the id the file carries is proven by none of its sessions: the session gets a new id, and the items are still kept out', async () => {
    const a = await person(2)
    const b = await person(2)
    const p = await play(emptySave(STRANGER, { sessions: [a.session, b.session] }), 0)
    expect(p.s.anon_id_adopted).toBe(false)
    expect(p.s.anon_id).not.toBe(a.anonId)
    expect(p.s.anon_id).not.toBe(b.anonId)
    expect((await stateOf(p.s.session_id)).seen_items).toEqual(sorted([...a.ids, ...b.ids]))
  })

  it('counts only the ids that are proved: a session that was changed, or one the server never issued, proves nothing and keeps nothing out', async () => {
    const a = await person(2)
    const b = await person(2)
    const c = await person(2)
    // b's session with one field changed (the MAC no longer fits), and a made-up session that names c's id
    const changed = { ...b.session, duration_s: (b.session.duration_s as number) + 1 }
    const made = { ...c.session, session_id: 's_00000000madeup1' }
    const p = await play(emptySave(a.anonId, { sessions: [a.session, changed, made] }), 0)
    expect(p.s.anon_id_adopted).toBe(true)
    expect((await stateOf(p.s.session_id)).seen_items).toEqual(sorted(a.ids))
    // a file that holds only b's changed session, claiming b's id: not continued, nothing kept out
    const q = await play(emptySave(b.anonId, { sessions: [changed] }), 0)
    expect(q.s.anon_id_adopted).toBe(false)
    expect(await stateOf(q.s.session_id)).toEqual({ v: 1, seen_items: [], seen_families: [] })
  })
})
