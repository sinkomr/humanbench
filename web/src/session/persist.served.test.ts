/**
 * Saving a run whose counted questions the server holds (ROADMAP M2.7; DESIGN §8; ROADMAP A16): the
 * save holds the timed tasks as a session of the device's own and the served part under the server's id,
 * unsigned until the server closes it and returns the signed copy, which then takes its place. The run is
 * a real `SessionRun` with a fake server.
 */

import { describe, expect, it } from 'vitest'
import type { CatAnswer, CatNext, CatSource } from '../backend/session'
import { toServedItem } from '../backend/items'
import { CANNED } from '../backend/testing'
import { restoreAutosaves, autosaveKey } from '../save/autosave'
import { jcs } from '../save/jcs'
import type { SaveSession } from '../save/types'
import { assertValidSave } from '../save/validate'
import { botSave } from '../reveal/test-support'
import type { SaveFileV1 } from '../save/types'
import { createRng } from '../engine/prng'
import { answerBlock } from '../sim/responders'
import { getFamily, resolveItem } from '../tasks/registry'
import { SpyStorage, TEST_DEVICE } from './bot'
import { SAVE_CTX } from './constants'
import { SessionPersister } from './persist'
import { SessionRun } from './run'

const WALL = 1_790_000_600_000
const SERVER_ID = 's_SERVERSESSION01'
const tick = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

class Cat implements CatSource {
  readonly sessionId = SERVER_ID
  answers: CatAnswer[] = []
  n = 0
  next(): Promise<CatNext> {
    this.n++
    return Promise.resolve({ kind: 'item', item: toServedItem(this.n, { itemId: `i:series:1.0.0:${this.n}`, itemType: 'series', timeLimitS: 120, stem: null, media: { renderer: 'series', input_format: 'integer', terms: [1, 2, 3] }, options: null }) })
  }
  answer(a: CatAnswer): Promise<void> {
    this.answers.push(a)
    return Promise.resolve()
  }
}

function setup(over: { anonId?: string; base?: SaveFileV1 | null } = {}): { run: SessionRun; p: SessionPersister; cat: Cat; s: SpyStorage; t: { ms: number }; fire: () => void } {
  const t = { ms: 0 }
  const cat = new Cat()
  const run = new SessionRun({ sessionId: 's_LOCALSESSION001', startedMs: WALL, now: () => t.ms, device: TEST_DEVICE, rtInput: 'keyboard', cat })
  const s = new SpyStorage()
  const q: (() => void)[] = []
  const p = new SessionPersister(run, { base: null, storage: s, wallClockMs: () => WALL, setTimer: (fn) => q.push(fn), clearTimer: () => q.splice(0, q.length), bindHide: false, ...over })
  return { run, p, cat, s, t, fire: () => q.splice(0, q.length).forEach((f) => f()) }
}

/** Skip the timed task of the first part, start the served one, answer an item. */
async function answerOne(h: ReturnType<typeof setup>): Promise<void> {
  h.run.skipAxis('RT')
  h.run.startSegment()
  await tick()
  h.run.itemShown(h.t.ms)
  h.t.ms += 5000
  h.run.itemResponded('4')
  h.run.confirmConfidence(60)
  h.p.schedule()
}

const signedCopy = (): SaveSession => ({ ...(CANNED.finish as { session: SaveSession }).session, session_id: SERVER_ID })

describe('a run with a server in the save library', () => {
  it('writes nothing until there is an answer, then the served part under the server id', async () => {
    const h = setup()
    h.p.schedule()
    h.fire()
    expect(h.s.writes).toEqual([])
    await answerOne(h)
    h.fire()
    expect(h.s.writes).toEqual([`set:${autosaveKey('s_LOCALSESSION001')}`])
    const save = restoreAutosaves(SAVE_CTX, h.s).save!
    expect(save.sessions.map((s) => s.session_id)).toEqual([SERVER_ID]) // the timed task part had no answer
    expect(save.sessions[0]!.sig).toBeUndefined()
    expect(save.sessions[0]!.responses).toEqual([['i:series:1.0.0:1', 0, '4', null, 5000, 60]])
    expect(save.seen_items).toEqual(['i:series:1.0.0:1'])
    assertValidSave(save)
  })

  it('a new save starts with the server’s anon_id', async () => {
    const h = setup({ anonId: 'hb_ServerIssuedId1X' })
    await answerOne(h)
    expect(h.p.anonId).toBe('hb_ServerIssuedId1X')
    expect(h.p.currentSave().anon_id).toBe('hb_ServerIssuedId1X')
  })

  it('a base under another id is re-keyed to the server’s, with its sessions and what it has seen (start_session did not continue it)', async () => {
    const earlier = botSave('s_EARLIERSESSION01', { level: 0.3 }).save
    expect(earlier.anon_id).not.toBe('hb_ServerIssuedId1X')
    const h = setup({ base: earlier, anonId: 'hb_ServerIssuedId1X' })
    await answerOne(h)
    expect(h.p.anonId).toBe('hb_ServerIssuedId1X')
    const save = h.p.currentSave()
    expect(save.anon_id).toBe('hb_ServerIssuedId1X')
    expect(save.sessions.map((s) => s.session_id).sort()).toEqual(['s_EARLIERSESSION01', SERVER_ID])
    expect(jcs(save.sessions.find((s) => s.session_id === 's_EARLIERSESSION01')!)).toBe(jcs(earlier.sessions[0]!))
    expect(save.seen_items).toEqual(expect.arrayContaining(earlier.seen_items))
    // the autosave, which is what a reload restores, carries the new id as well
    h.fire()
    expect(restoreAutosaves(SAVE_CTX, h.s).save!.anon_id).toBe('hb_ServerIssuedId1X')
    // and so does the save once the signed session is in it: the id the session is bound to
    h.p.attachSigned({ ...signedCopy(), sig: { alg: 'HMAC-SHA256', kid: 'k2026a', mac: 'bWFj', anon_id: 'hb_ServerIssuedId1X' } })
    expect(h.p.currentSave().anon_id).toBe(h.p.currentSave().sessions.find((s) => s.sig !== undefined)!.sig!.anon_id)
    assertValidSave(h.p.currentSave())
  })

  it('a base keeps its own id when the server continued it (the ids are the same), and with no server id', async () => {
    const earlier = botSave('s_EARLIERSESSION02', { level: 0.3 }).save
    const same = setup({ base: earlier, anonId: earlier.anon_id })
    await answerOne(same)
    expect(same.p.currentSave().anon_id).toBe(earlier.anon_id)
    const none = setup({ base: earlier })
    await answerOne(none)
    expect(none.p.anonId).toBe(earlier.anon_id)
    expect(none.p.currentSave().anon_id).toBe(earlier.anon_id)
  })

  it('the signed copy replaces the unsigned one, and stays when the save is made again', async () => {
    const h = setup()
    await answerOne(h)
    const before = h.p.currentSave()
    expect(before.sessions[0]!.sig).toBeUndefined()
    h.p.attachSigned(signedCopy())
    const after = h.p.currentSave()
    expect(after.sessions).toHaveLength(1)
    expect(after.sessions[0]!.sig).toBeDefined()
    expect(jcs(after.sessions[0]!)).toBe(jcs(signedCopy())) // the server’s bytes, not ours
    expect(jcs(h.p.currentSave())).toBe(jcs(after)) // and again
    // later changes to the run do not bring the unsigned copy back
    h.p.addSeenFamilies(['f:series:abc'])
    expect(h.p.currentSave().sessions.find((s) => s.session_id === SERVER_ID)!.sig).toBeDefined()
  })

  it('keeps the timed tasks as a session of the device’s own next to the served one', async () => {
    const h = setup()
    // the reaction-time part runs on the device: its blocks are answered and scored here
    h.run.startSegment()
    for (let i = 0; i < 2; i++) {
      const blk = h.run.view().block!
      const item = resolveItem(blk.item_id)!
      const a = answerBlock(getFamily(blk.family)!, item, 0, createRng(`persist:${blk.family}`))
      h.t.ms += a.timeS * 1000
      h.run.blockInputType('keyboard')
      h.run.blockResponded(a.response)
    }
    expect(h.run.view().segment?.id).toBe('matrix_series')
    h.run.startSegment()
    await tick()
    h.run.itemShown(h.t.ms)
    h.t.ms += 4000
    h.run.itemResponded('9')
    h.run.confirmConfidence(50)
    const save = h.p.currentSave()
    const [device, served] = [save.sessions.find((s) => s.session_id === 's_LOCALSESSION001')!, save.sessions.find((s) => s.session_id === SERVER_ID)!]
    expect(device.responses.map((t) => t[0].split(':')[1])).toEqual(['rt_simple', 'rt_choice4']) // the timed tasks, with their scorer records
    expect(device.responses.every((t) => t[3] === null)).toBe(true)
    expect(device.flags.timed_tasks_only).toBe(true) // marks the device half of an online sitting (a count of sittings reads it)
    expect(served.flags.timed_tasks_only).toBeUndefined()
    expect(h.run.serverFlags().timed_tasks_only).toBeUndefined() // the server is not told
    expect(served.responses.map((t) => t[0].split(':')[1])).toEqual(['series'])
    expect(device.sig).toBeUndefined()
    expect(save.seen_items).toEqual(expect.arrayContaining(['i:series:1.0.0:1', ...device.responses.map((t) => t[0])]))
    // the signed copy of the served part joins them without touching the device’s session
    h.p.attachSigned(signedCopy())
    const after = h.p.currentSave()
    expect(after.sessions.map((s) => [s.session_id, s.sig !== undefined]).sort()).toEqual([['s_LOCALSESSION001', false], [SERVER_ID, true]])
    expect(jcs(after.sessions.find((s) => s.session_id === 's_LOCALSESSION001')!)).toBe(jcs(device))
  })

  it('a save made before the server answers is valid, and merging it with the finished one is idempotent', async () => {
    const h = setup()
    await answerOne(h)
    const early = h.p.currentSave()
    h.p.attachSigned(signedCopy())
    const late = h.p.currentSave()
    const merged = h.p.currentSave()
    expect(jcs(merged)).toBe(jcs(late))
    expect(early.sessions[0]!.session_id).toBe(late.sessions[0]!.session_id)
  })
})
