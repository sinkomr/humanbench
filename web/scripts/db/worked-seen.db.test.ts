/**
 * M2.2 / M2.7 (ROADMAP M2.2, M2.7, M1.R; DESIGN §7.7, §10, D3; ROADMAP A11): the reveal's worked examples and a later
 * served session, through the real client and the real database.
 *
 * The reveal shows a person a matrix, a series and a quantitative item WITH their solutions, and writes the families of
 * those examples, and of their near-isomorph siblings, to the save's `seen_families` (`pickWorkedItems`,
 * `SessionPersister.addSeenFamilies`). A person who has seen a worked solution must not meet that question type, or a
 * near-isomorph of it, as a counted item later (§7.7): the server serves the counted Matrix & Series and Quantitative parts,
 * so its `start_session` has to honour those ids, although it ignores a save's finite-bank lists (the audit that closed the
 * client's choice of the item, supabase/README.md "What the next item tells"). The bank is synthetic and the families are the
 * real ones, as `family_id` is one function in both repos (A11), so the ids the reveal writes are the ids of the server's rows.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createBackendApi, type BackendApi } from '../../src/backend/api'
import { ServerSession } from '../../src/backend/session'
import { supabaseTransport } from '../../src/backend/transport'
import { pickWorkedItems } from '../../src/reveal/worked'
import type { SaveFileV1 } from '../../src/save/types'
import { TEST_DEVICE } from '../../src/session/bot'
import { customItem, loadFixtureBank, type FixtureItem } from './bank-fixture'
import type { TestDb } from './harness'
import { ageExposures, relaxSelection } from './rpc-support'
import { startShim, type Shim } from './postgrest-shim'
import { openTestDb } from './vitest'

let db: TestDb
let shim: Shim
let ipCounter = 0
const freshIp = (): string => `198.51.101.${++ipCounter}`
const bank = new Map<string, FixtureItem>()
const instant = (): Promise<void> => Promise.resolve()

/** The worked examples of a session, as the reveal picks them, and the families it records (all of them, siblings included). */
const worked = pickWorkedItems('s_01WORKEDEXAMPLES', [])
const workedFamilies = worked.flatMap((w) => w.families)
/** The server's items of those families: one item per family, a grouped quant variant sharing its group with its siblings. */
let workedItems: FixtureItem[] = []
let otherItems: FixtureItem[] = []

beforeAll(async () => {
  expect(worked.map((w) => w.kind)).toEqual(['matrix', 'series', 'quant']) // so the rest is not vacuous
  db = await openTestDb()
  await relaxSelection(db)
  let n = 900
  workedItems = worked.flatMap((w) =>
    w.families.map((familyId) =>
      customItem(++n, w.kind === 'quant' ? 'QR' : 'MAT', { familyId, siblingGroup: w.item.sibling_group, procedural: true, generator: w.item.family }),
    ),
  )
  // a few more of the same axes and kinds, in families the person has not been shown, and finite items
  otherItems = [
    ...[1, 2, 3].map((k) => customItem(k, 'MAT', { procedural: true, generator: 'matrices' })),
    ...[4, 5, 6].map((k) => customItem(k, 'QR', { procedural: true, generator: 'quant' })),
    ...[7, 8, 9].map((k) => customItem(k, 'QR', {})),
  ]
  for (const it of [...workedItems, ...otherItems]) bank.set(it.itemId, it)
  await loadFixtureBank(db, [...workedItems, ...otherItems])
  shim = await startShim(db)
})
afterAll(async () => {
  await shim?.close()
  await db?.close()
})

/** An API over the real supabase-js, from a client address of its own. */
function client(): { api: BackendApi; ip: string } {
  const ip = freshIp()
  const fetchFrom = ((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    headers.set('x-forwarded-for', ip)
    return fetch(input, { ...init, headers })
  }) as typeof fetch
  return { api: createBackendApi(supabaseTransport({ url: shim.url, anonKey: 'test-anon-key' }, { fetch: fetchFrom }), { sleep: instant }), ip }
}

/** Serves and answers up to `max` items of a session, through the client. */
async function play(s: ServerSession, max = 999): Promise<string[]> {
  const ids: string[] = []
  while (ids.length < max) {
    const next = await s.next(['MAT', 'QR'])
    if (next.kind !== 'item') break
    ids.push(next.item.item_id)
    await ageExposures(db, s.sessionId, 20)
    await s.answer({ item: next.item, response: bank.get(next.item.item_id)!.key.index as number, rtMs: 6000, confidence: null, flags: {} })
  }
  return ids
}

const saveWith = (anonId: string, extra: Partial<SaveFileV1>): SaveFileV1 => ({
  schema_version: '1.0.0',
  bank_version: 'test',
  anon_id: anonId,
  created_utc: '2026-10-03T17:20:02Z',
  sessions: [],
  seen_items: [],
  seen_families: [],
  ...extra,
})

describe('the examples the reveal shows stay out of the next served session', () => {
  it('(the premise) the reveal records the families of three examples, siblings included, and each has an item in the server\'s bank', () => {
    expect(workedFamilies.length).toBeGreaterThanOrEqual(3)
    expect(new Set(workedFamilies).size).toBe(workedFamilies.length)
    expect(workedItems.length).toBe(workedFamilies.length)
  })

  it('without them, a served session meets those families (the control)', async () => {
    const s = await ServerSession.start(client().api, TEST_DEVICE)
    const got = await play(s)
    for (const it of workedItems) expect(got, it.itemId).toContain(it.itemId)
  })

  it('keeps them out of a session that follows an offline or static-fallback session (a save of the device\'s own, nothing signed)', async () => {
    const save = saveWith('hb_7Q3m9Kx2Vw5rT8pL', { seen_families: workedFamilies })
    const s = await ServerSession.start(client().api, TEST_DEVICE, save)
    expect(s.anonIdAdopted).toBe(false) // an id the server never issued: the families still count
    const got = await play(s)
    for (const it of workedItems) expect(got, it.itemId).not.toContain(it.itemId)
    expect(got.sort()).toEqual(otherItems.map((i) => i.itemId).sort()) // and nothing else is lost
  })

  it('keeps them out of the next session of a person with a signed file, next to what the server served them', async () => {
    // a first served session that ends before the worked examples are shown (they come with the results), then the reveal
    const first = await ServerSession.start(client().api, TEST_DEVICE)
    const firstIds = await play(first, 2)
    const fin = await first.finish({ visibility_hidden_s: 0, paste_events: 0 })
    const save = saveWith(first.anonId, { sessions: [fin.session], seen_items: [], seen_families: workedFamilies })
    const s = await ServerSession.start(client().api, TEST_DEVICE, save)
    expect(s.anonIdAdopted).toBe(true)
    const got = await play(s)
    for (const it of workedItems) expect(got, it.itemId).not.toContain(it.itemId)
    for (const id of firstIds) expect(got, id).not.toContain(id)
  })

  it('does not let the same file name a finite item: the finite items a save lists are still served', async () => {
    const finite = otherItems.filter((i) => i.axis === 'QR' && i.generator === undefined)
    expect(finite.length).toBe(3)
    const save = saveWith('hb_7Q3m9Kx2Vw5rT8pL', { seen_families: [...workedFamilies, ...finite.map((i) => i.familyId)], seen_items: finite.map((i) => i.itemId) })
    const got = await play(await ServerSession.start(client().api, TEST_DEVICE, save))
    for (const it of finite) expect(got, it.itemId).toContain(it.itemId)
    for (const it of workedItems) expect(got, it.itemId).not.toContain(it.itemId)
  })
})
