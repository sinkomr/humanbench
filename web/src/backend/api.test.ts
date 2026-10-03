import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { TEST_DEVICE } from '../session/bot'
import { arbSave, arbSession } from '../save/testing'
import type { SaveFileV1 } from '../save/types'
import { createBackendApi, ITEM_PROBLEM_KINDS, MAX_PROBLEM_DETAIL, type BackendApi } from './api'
import { BackendError } from './errors'
import { ANON, CANNED, FakeTransport, SESSION_ID, TOKEN } from './testing'
import { hasBriefPrefs, hasUnstorable } from './upload'

const instant = (): Promise<void> => Promise.resolve()
const make = (): { t: FakeTransport; api: BackendApi; slept: number[] } => {
  const t = new FakeTransport()
  const slept: number[] = []
  return { t, slept, api: createBackendApi(t, { sleep: (ms) => ((slept.push(ms), instant())), retryDelaysMs: [500, 1500] }) }
}

describe('the arguments of each RPC (the names of the SQL functions)', () => {
  it('start_session', async () => {
    const { t, api } = make()
    const s = await api.startSession(TEST_DEVICE)
    expect(s).toEqual({ sessionId: SESSION_ID, token: TOKEN, anonId: ANON, anonIdAdopted: false, bankVersion: 'bank-test', paramVersion: 'p-test', maxItems: 200 })
    expect(t.args('start_session')).toEqual({ p_device: TEST_DEVICE })
  })

  it('next_item and submit', async () => {
    const { t, api } = make()
    await api.nextItem(TOKEN)
    await api.nextItem(TOKEN, ['MAT', 'SPA'])
    expect(t.args('next_item', 0)).toEqual({ p_token: TOKEN })
    expect(t.args('next_item', 1)).toEqual({ p_token: TOKEN, p_axes: ['MAT', 'SPA'] })
    const r = await api.submit(TOKEN, { itemId: 'i:series:1.0.0:1', response: '42', rtMs: 1234.6, confidence: 70.4, clientFlags: { paste: true }, next: false })
    expect(r).toEqual({ seq: 1, next: null })
    expect(t.args('submit')).toEqual({ p_token: TOKEN, p_item_id: 'i:series:1.0.0:1', p_response: '42', p_rt_ms: 1235, p_confidence: 70, p_next: false, p_client_flags: { paste: true } })
    await api.submit(TOKEN, { itemId: 'i:x', response: null, rtMs: 0, confidence: null, next: true, axes: ['QR'] })
    expect(t.args('submit', 1)).toEqual({ p_token: TOKEN, p_item_id: 'i:x', p_response: null, p_rt_ms: 0, p_confidence: null, p_next: true, p_axes: ['QR'] })
  })

  it('finish keeps the flags the server accepts, and no others', async () => {
    const { t, api } = make()
    const r = await api.finish(TOKEN, { visibility_hidden_s: 3, paste_events: 0, skipped_rt: true, 'Bad Name': 1, ok: null, text: 'x' as never, big: Infinity })
    expect(r.session.session_id).toBe(SESSION_ID)
    expect(r.session.sig?.mac).toBe('bWFj')
    expect(r.session.responses[0]![3]).toBeNull() // no verdict
    expect(t.args('finish')).toEqual({ p_token: TOKEN, p_flags: { visibility_hidden_s: 3, paste_events: 0, skipped_rt: true, ok: null } })
  })

  it('report_problem: five item kinds with the item, and the notes request with neither item nor text', async () => {
    const { t, api } = make()
    for (const kind of ITEM_PROBLEM_KINDS) await api.reportProblem(TOKEN, { kind, itemId: 'i:series:1.0.0:1', detail: kind === 'typo' ? '  a typo here ' : undefined })
    expect(t.args('report_problem', 0)).toEqual({ p_token: TOKEN, p_kind: 'wrong_key', p_item_id: 'i:series:1.0.0:1' })
    expect(t.args('report_problem', 2)).toEqual({ p_token: TOKEN, p_kind: 'typo', p_item_id: 'i:series:1.0.0:1', p_detail: 'a typo here' })
    await api.reportProblem(TOKEN, { kind: 'notes_requested' })
    expect(t.args('report_problem', 5)).toEqual({ p_token: TOKEN, p_kind: 'notes_requested' })
    await expect(api.reportProblem(TOKEN, { kind: 'typo', itemId: 'i:x', detail: 'x'.repeat(MAX_PROBLEM_DETAIL + 1) })).rejects.toMatchObject({ kind: 'local', code: 'detail_too_long' })
  })

  it('submit_survey sends only what was answered', async () => {
    const { t, api } = make()
    expect(await api.submitSurvey(TOKEN, { ageBand: '25-34', englishFirst: false })).toBe(true)
    await api.submitSurvey(TOKEN, { ageBand: null, englishFirst: true })
    await api.submitSurvey(TOKEN, { ageBand: null, englishFirst: null })
    expect(t.args('submit_survey', 0)).toEqual({ p_token: TOKEN, p_age_band: '25-34', p_english_first: false })
    expect(t.args('submit_survey', 1)).toEqual({ p_token: TOKEN, p_english_first: true })
    expect(t.args('submit_survey', 2)).toEqual({ p_token: TOKEN })
  })

  it('mirror_put, mirror_get and delete_my_data', async () => {
    const { t, api } = make()
    const save = baseSave()
    const put = await api.mirrorPut(TOKEN, save)
    expect(put).toMatchObject({ stored: true, recoveryPhrase: expect.stringMatching(/^(\w+ ){11}\w+$/u) })
    await api.mirrorPut(TOKEN, save, 'the phrase')
    expect(t.args('mirror_put', 0)).toEqual({ p_token: TOKEN, p_save: save })
    expect(t.args('mirror_put', 1)).toEqual({ p_token: TOKEN, p_save: save, p_phrase: 'the phrase' })
    expect(await api.mirrorGet(ANON, 'the phrase')).toEqual({ found: false })
    expect(t.args('mirror_get')).toEqual({ p_anon_id: ANON, p_phrase: 'the phrase' })
    expect(await api.deleteMyData(ANON, { phrase: 'p' })).toEqual({ deleted: false })
    expect(t.args('delete_my_data')).toEqual({ p_anon_id: ANON, p_phrase: 'p' })
  })
})

function baseSave(extra: Partial<SaveFileV1> = {}): SaveFileV1 {
  return { schema_version: '1.0.0', bank_version: 'b', anon_id: ANON, created_utc: '2026-10-03T17:20:02Z', sessions: [], seen_items: [], seen_families: [], ...extra }
}

describe('retries', () => {
  const NET = (): BackendError => new BackendError('network', 'network_error')

  it('repeats a call that is safe to repeat after a network failure, with the waits', async () => {
    const { t, api, slept } = make()
    t.failures.set('submit', [NET(), NET()])
    await api.submit(TOKEN, { itemId: 'i:x', response: '1', rtMs: 1, confidence: null, next: false })
    expect(t.calls.filter((c) => c.fn === 'submit')).toHaveLength(3)
    expect(slept).toEqual([500, 1500])
  })

  it('gives up after the second retry and says what failed', async () => {
    const { t, api } = make()
    t.failures.set('next_item', [NET(), NET(), NET()])
    await expect(api.nextItem(TOKEN)).rejects.toMatchObject({ kind: 'network' })
    expect(t.calls.filter((c) => c.fn === 'next_item')).toHaveLength(3)
  })

  it('repeats a 503 but not a 400, a 401, a 409 or a 429', async () => {
    for (const [status, kind, repeated] of [[503, 'server', true], [400, 'rejected', false], [401, 'auth', false], [409, 'conflict', false], [429, 'limited', false]] as const) {
      const { t, api } = make()
      t.failures.set('finish', [new BackendError(kind, 'x_y', { status })])
      const p = api.finish(TOKEN)
      if (repeated) await expect(p).resolves.toBeDefined()
      else await expect(p).rejects.toMatchObject({ status })
      expect(t.calls.filter((c) => c.fn === 'finish')).toHaveLength(repeated ? 2 : 1)
    }
  })

  it('never repeats start_session, mirror_put or delete_my_data', async () => {
    const { t, api } = make()
    for (const fn of ['start_session', 'mirror_put', 'delete_my_data']) t.failures.set(fn, [NET()])
    await expect(api.startSession(TEST_DEVICE)).rejects.toMatchObject({ kind: 'network' })
    await expect(api.mirrorPut(TOKEN, baseSave())).rejects.toMatchObject({ kind: 'network' })
    await expect(api.deleteMyData(ANON, { phrase: 'p' })).rejects.toMatchObject({ kind: 'network' })
    expect(t.calls.map((c) => c.fn)).toEqual(['start_session', 'mirror_put', 'delete_my_data'])
  })
})

describe('what leaves the device (AI.26, data minimisation)', () => {
  const sessions = (save: SaveFileV1): number => save.sessions.length

  it('1,000 random saves with notes settings: no body of any call holds brief_prefs', async () => {
    const saves = fc.sample(arbSave({ withPrefs: true }), { numRuns: 1000, seed: 26 })
    expect(saves.filter((s) => s.brief_prefs !== undefined).length).toBeGreaterThan(300)
    const { t, api } = make()
    for (const save of saves) {
      await api.startSession(TEST_DEVICE, save)
      await api.verifySave(save)
      await api.rescore(save)
      await api.mirrorPut(TOKEN, save, 'p')
      await api.deleteMyData(ANON, { save })
    }
    expect(t.calls).toHaveLength(5000)
    for (const c of t.calls) expect(c.body.includes('brief_prefs'), `${c.fn} sent brief_prefs`).toBe(false)
  })

  it('1,000 random saves, an answer and a report: no body of any call holds the character U+0000, which the database refuses', async () => {
    // the character planted in a top-level list and in a key, so that every call that sends a save has it to drop
    const saves = fc.sample(arbSave({ withPrefs: true }), { numRuns: 1000, seed: 26 }).map((s, i) =>
      i % 2 === 0 ? { ...s, seen_items: [...s.seen_items, `i:x\u0000${i}`] } : { ...s, [`extra\u0000${i}`]: { 'k\u0000': 'v\u0000' } },
    ) as SaveFileV1[]
    expect(saves.every((s) => hasUnstorable(s))).toBe(true) // so this is not vacuous
    const { t, api } = make()
    for (const save of saves) {
      await api.startSession(TEST_DEVICE, save)
      await api.verifySave(save)
      await api.rescore(save)
      await api.mirrorPut(TOKEN, save, 'p')
      await api.deleteMyData(ANON, { save })
    }
    await api.submit(TOKEN, { itemId: 'i:series:1.0.0:1', response: '4\u00002', rtMs: 10, confidence: null, next: false })
    await api.reportProblem(TOKEN, { kind: 'typo', itemId: 'i:series:1.0.0:1', detail: 'a\u0000b' })
    expect(t.calls).toHaveLength(5002)
    for (const c of t.calls) expect(hasUnstorable(JSON.parse(c.body)), `${c.fn} sent U+0000`).toBe(false)
    expect(t.args('submit').p_response).toBe('42')
    expect(t.args('report_problem').p_detail).toBe('ab')
  })

  it('a lone surrogate in a typed answer, the text of a report or an offline session of a save never reaches a body (the database refuses it with a 400)', async () => {
    const { t, api } = make()
    const offline = { ...fc.sample(arbSession(false), { numRuns: 1, seed: 7 })[0]!, session_id: 's_01OFFLINEX0002', responses: [['i:aut:1', 0, 'cut \ud83d', null, 4000, null]] }
    const save = baseSave({ sessions: [offline] as unknown as SaveFileV1['sessions'] })
    await api.mirrorPut(TOKEN, save, 'p')
    await api.submit(TOKEN, { itemId: 'i:series:1.0.0:1', response: 'a\ud800b', rtMs: 10, confidence: null, next: false })
    await api.reportProblem(TOKEN, { kind: 'typo', itemId: 'i:series:1.0.0:1', detail: 'x\udc00y' })
    for (const c of t.calls) expect(hasUnstorable(JSON.parse(c.body)), `${c.fn} sent a lone surrogate`).toBe(false)
    expect(t.args('submit').p_response).toBe('a\ufffdb')
    expect(t.args('report_problem').p_detail).toBe('x\ufffdy')
  })

  it('the guard refuses a call that carries the key from anywhere else', async () => {
    const { t, api } = make()
    const dirty = { ...baseSave(), sessions: [{ x: { brief_prefs: 1 } }] } as unknown as SaveFileV1
    await expect(api.mirrorPut(TOKEN, dirty)).rejects.toMatchObject({ kind: 'local', code: 'brief_prefs_in_payload' })
    await expect(api.submit(TOKEN, { itemId: 'i:x', response: { brief_prefs: 1 } as never, rtMs: 1, confidence: null, next: false })).rejects.toMatchObject({ kind: 'local' })
    await expect(api.finish(TOKEN, { brief_prefs: true })).rejects.toMatchObject({ kind: 'local' }) // a flag named like that is refused too
    expect(t.calls.filter((c) => c.fn !== 'finish')).toEqual([])
  })

  it('sends only the sessions the server signed to verify_save, rescore, start_session and delete_my_data', async () => {
    const save = fc.sample(arbSave({ withPrefs: true, sessions: fc.array(arbSessionMixed(), { minLength: 3, maxLength: 5 }) }), { numRuns: 20, seed: 3 }).find((s) => s.sessions.some((x) => x.sig === undefined) && s.sessions.some((x) => x.sig !== undefined))!
    const { t, api } = make()
    await api.verifySave(save)
    await api.rescore(save)
    await api.startSession(TEST_DEVICE, save)
    await api.deleteMyData(ANON, { save })
    for (const [fn, key] of [['verify_save', 'p_save'], ['rescore', 'p_save'], ['start_session', 'p_save'], ['delete_my_data', 'p_save']] as const) {
      const sent = t.args(fn)[key] as SaveFileV1
      expect(sent.sessions.every((s) => s.sig !== undefined)).toBe(true)
      expect(sent.sessions).toHaveLength(save.sessions.filter((s) => s.sig !== undefined).length)
    }
    expect(sessions(save)).toBeGreaterThan(0)
  })

  it('the server backup is the whole save, minus the notes settings', async () => {
    const save = fc.sample(arbSave({ withPrefs: true }), { numRuns: 30, seed: 4 }).find((s) => s.brief_prefs !== undefined && s.sessions.length > 0)!
    const { t, api } = make()
    await api.mirrorPut(TOKEN, save)
    const sent = t.args('mirror_put').p_save as SaveFileV1
    expect(sent.sessions).toEqual(save.sessions)
    expect(sent.seen_items).toEqual(save.seen_items)
    expect(hasBriefPrefs(sent)).toBe(false)
  })
})

function arbSessionMixed(): fc.Arbitrary<SaveFileV1['sessions'][number]> {
  return fc.oneof(arbSession(true), arbSession(false))
}

describe('replies that break the contract', () => {
  it.each([
    ['start_session', { session_id: 1 }],
    ['next_item', { seq: 1, item: { item_id: 'x' } }],
    ['next_item', { done: true, reason: 'because' }],
    ['submit', { ack: false }],
    // everything else about these is well-formed: only the acknowledgement is wrong (a reply that does not say the answer was taken)
    ['submit', { ack: false, seq: 1 }],
    ['submit', { seq: 1 }],
    ['submit', { ack: 'true', seq: 1 }],
    ['finish', { session: { session_id: 's_x' }, anon_id: ANON, n_responses: 0 }],
    ['verify_save', { anon_id: ANON, sessions: [{ status: 'maybe' }], n_verified: 0, n_unverified: 0 }],
    ['rescore', { sessions: [], eap: { NOPE: { mean: 0, sd: 1, n: 1 } }, facets: {} }],
    ['mirror_put', { stored: true }],
    ['mirror_get', { found: true, save: {} }],
    ['delete_my_data', { deleted: true }],
    ['report_problem', {}],
    ['submit_survey', 'yes'],
  ] as const)('%s with %j is a reply error', async (fn, reply) => {
    const { t, api } = make()
    t.replies[fn] = reply
    const calls: Record<string, () => Promise<unknown>> = {
      start_session: () => api.startSession(TEST_DEVICE),
      next_item: () => api.nextItem(TOKEN),
      submit: () => api.submit(TOKEN, { itemId: 'i:x', response: '1', rtMs: 1, confidence: null, next: false }),
      finish: () => api.finish(TOKEN),
      verify_save: () => api.verifySave(baseSave()),
      rescore: () => api.rescore(baseSave()),
      mirror_put: () => api.mirrorPut(TOKEN, baseSave()),
      mirror_get: () => api.mirrorGet(ANON, 'p'),
      delete_my_data: () => api.deleteMyData(ANON, { phrase: 'p' }),
      report_problem: () => api.reportProblem(TOKEN, { kind: 'notes_requested' }),
      submit_survey: () => api.submitSurvey(TOKEN, { ageBand: null, englishFirst: true }),
    }
    await expect(calls[fn]!()).rejects.toMatchObject({ kind: 'reply', code: 'bad_reply' })
  })

  it('the canned replies themselves are valid (the tests above start from them)', async () => {
    const { api } = make()
    await expect(api.startSession(TEST_DEVICE)).resolves.toBeDefined()
    await expect(api.nextItem(TOKEN)).resolves.toEqual({ kind: 'done', reason: 'axes_done' })
    expect(Object.keys(CANNED).sort()).toContain('rescore')
  })
})

import { normalisePhrase } from './api'
describe('recovery phrases', () => {
  it('are tidied the way the server compares them, and the server gets only the tidy form', async () => {
    expect(normalisePhrase('  Acorn  ACROBAT\naction\tadvice \n')).toBe('acorn acrobat action advice')
    const { t, api } = make()
    await api.mirrorGet(` ${ANON} `, ' Acorn Acrobat\n')
    await api.mirrorPut(TOKEN, baseSave(), 'Acorn  Acrobat\r\n')
    await api.deleteMyData(` ${ANON}`, { phrase: ' Acorn\nAcrobat ' })
    expect(t.args('mirror_get')).toEqual({ p_anon_id: ANON, p_phrase: 'acorn acrobat' })
    expect(t.args('mirror_put').p_phrase).toBe('acorn acrobat')
    expect(t.args('delete_my_data')).toEqual({ p_anon_id: ANON, p_phrase: 'acorn acrobat' })
  })
})
