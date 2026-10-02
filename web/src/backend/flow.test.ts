import { describe, expect, it } from 'vitest'
import type { SaveFileV1, SaveSession } from '../save/types'
import { createBackendApi } from './api'
import { BackendError } from './errors'
import { closeServedRun, servedSessionIds } from './flow'
import { ServerSession } from './session'
import { ANON, CANNED, FakeTransport, SESSION_ID } from './testing'
import { TEST_DEVICE } from '../session/bot'

const signed = (CANNED.finish as { session: SaveSession }).session
const save: SaveFileV1 = { schema_version: '1.0.0', bank_version: 'b', anon_id: ANON, created_utc: '2026-10-03T17:20:02Z', sessions: [signed], seen_items: [], seen_families: [] }

async function parts(): Promise<{ t: FakeTransport; server: ServerSession; log: string[]; run: { flushAnswers(): Promise<void>; serverFlags(): Record<string, number | boolean> }; holder: { attachSigned(s: SaveSession): void; currentSave(): SaveFileV1 } }> {
  const t = new FakeTransport()
  const api = createBackendApi(t, { sleep: () => Promise.resolve() })
  const server = await ServerSession.start(api, TEST_DEVICE)
  const log: string[] = []
  return {
    t,
    server,
    log,
    run: { flushAnswers: async () => void log.push('flush'), serverFlags: () => ({ paste_events: 0 }) },
    holder: { attachSigned: () => void log.push('attach'), currentSave: () => (log.push('save'), save) },
  }
}

describe('closeServedRun (M2.7)', () => {
  it('sends the last answers, closes the session, puts the signed copy in the save, then asks for the scores', async () => {
    const p = await parts()
    p.t.replies.rescore = { ...(CANNED.rescore as object), eap: { MAT: { mean: 0.5, sd: 0.4, n: 6 } }, sessions: [{ session_id: SESSION_ID, known: true }] }
    const out = await closeServedRun(p.run, p.server, p.holder, createBackendApi(p.t, { sleep: () => Promise.resolve() }))
    expect(p.log).toEqual(['flush', 'attach', 'save'])
    expect(p.t.calls.map((c) => c.fn)).toEqual(['start_session', 'finish', 'rescore'])
    expect(p.t.args('finish')).toEqual({ p_token: 'hbt_ABCDEFGHIJKLMNOPQRSTUV', p_flags: { paste_events: 0 } })
    expect(out.closed).toBe(true)
    expect(out.estimates?.eap.MAT).toEqual({ mean: 0.5, sd: 0.4, n: 6 })
  })

  it('does not close a session whose answers did not all arrive', async () => {
    const p = await parts()
    p.run.flushAnswers = () => Promise.reject(new BackendError('network', 'network_error'))
    await expect(closeServedRun(p.run, p.server, p.holder, createBackendApi(p.t))).rejects.toMatchObject({ kind: 'network' })
    expect(p.t.calls.map((c) => c.fn)).toEqual(['start_session'])
  })

  it('a failed finish is a failed close; trying again finishes, once, and does not send what was sent', async () => {
    const p = await parts()
    const api = createBackendApi(p.t, { sleep: () => Promise.resolve() })
    p.t.failures.set('finish', [new BackendError('network', 'network_error'), new BackendError('network', 'network_error'), new BackendError('network', 'network_error')])
    await expect(closeServedRun(p.run, p.server, p.holder, api)).rejects.toMatchObject({ kind: 'network' })
    expect(p.log).toEqual(['flush'])
    const out = await closeServedRun(p.run, p.server, p.holder, api)
    expect(out.closed).toBe(true)
    expect(p.t.calls.filter((c) => c.fn === 'finish')).toHaveLength(4)
    await closeServedRun(p.run, p.server, p.holder, api)
    expect(p.t.calls.filter((c) => c.fn === 'finish')).toHaveLength(4) // the closed session is kept: no call
  })

  it('a failed rescore is not a failed close: the scores are just missing', async () => {
    const p = await parts()
    const api = createBackendApi(p.t, { sleep: () => Promise.resolve() })
    p.t.failures.set('rescore', [new BackendError('limited', 'rate_limited', { status: 429 })])
    const out = await closeServedRun(p.run, p.server, p.holder, api)
    expect(out).toMatchObject({ closed: true, estimates: null })
  })
})

describe('servedSessionIds', () => {
  it('are the signed sessions and the run’s own', () => {
    const unsigned = (() => {
      const { sig: _s, ...rest } = signed
      return { ...rest, session_id: 's_LOCAL00001' }
    })()
    const s = { ...save, sessions: [signed, unsigned] }
    expect([...servedSessionIds(s)]).toEqual([SESSION_ID])
    expect([...servedSessionIds(s, 's_LOCAL00001')].sort()).toEqual(['s_LOCAL00001', SESSION_ID].sort())
  })
})
