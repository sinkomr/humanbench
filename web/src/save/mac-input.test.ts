import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { jcs } from './jcs'
import { SESSION_MAC_KIND, sessionMacInput } from './mac-input'
import { arbAnonId, arbSession } from './testing'
import type { SaveSession } from './types'

const session: SaveSession = {
  session_id: 's_01J9ZK3Q',
  started_utc: '2026-10-03T17:20:02Z',
  duration_s: 3411.123,
  device: { class: 'desktop', input: 'mouse', os_family: 'macOS', browser_family: 'Safari', refresh_hz_est: 120, timer_res_ms: 0.1, viewport: [1512, 861] },
  flags: { visibility_hidden_s: 14, paste_events: 0, fast_guess_n: 1 },
  responses: [['i:mat:f0182:v3', 0, 'C', null, 41250, 80]],
}

describe('the input of the session MAC (A16, M2.3)', () => {
  it('is the canonical JSON of the anon_id, the kind and the session without its sig', () => {
    expect(sessionMacInput(session, 'hb_7Q3m9Kx2Vw5rT8pL')).toBe(
      '{"anon_id":"hb_7Q3m9Kx2Vw5rT8pL","kind":"hb.session.v1","session":{"device":{"browser_family":"Safari","class":"desktop","input":"mouse","os_family":"macOS","refresh_hz_est":120,"timer_res_ms":0.1,"viewport":[1512,861]},"duration_s":3411.123,"flags":{"fast_guess_n":1,"paste_events":0,"visibility_hidden_s":14},"responses":[["i:mat:f0182:v3",0,"C",null,41250,80]],"session_id":"s_01J9ZK3Q","started_utc":"2026-10-03T17:20:02Z"}}',
    )
    expect(SESSION_MAC_KIND).toBe('hb.session.v1')
  })

  it('does not depend on the sig the session carries, nor on the order its keys are written in (property)', () => {
    fc.assert(
      fc.property(arbSession(), arbAnonId, (s, anon) => {
        const { sig: _sig, ...bare } = s
        expect(sessionMacInput(s, anon)).toBe(sessionMacInput(bare, anon))
        const shuffled = Object.fromEntries(Object.entries(bare).reverse()) as unknown as SaveSession
        expect(sessionMacInput(shuffled, anon)).toBe(sessionMacInput(bare, anon))
      }),
      { numRuns: 300 },
    )
  })

  it('binds the anon_id and every part of the session: any change gives another input (property)', () => {
    fc.assert(
      fc.property(arbSession(), arbAnonId, (s, anon) => {
        const base = sessionMacInput(s, anon)
        expect(sessionMacInput(s, anon === 'hb_zzzzzzzzzzzzzzzz' ? 'hb_0000000000000000a' : 'hb_zzzzzzzzzzzzzzzz')).not.toBe(base)
        expect(sessionMacInput({ ...s, duration_s: s.duration_s + 1 }, anon)).not.toBe(base)
        expect(sessionMacInput({ ...s, session_id: `${s.session_id}x` }, anon)).not.toBe(base)
        expect(sessionMacInput({ ...s, flags: { ...s.flags, extra: 1 } }, anon)).not.toBe(base)
        expect(sessionMacInput({ ...s, responses: [...s.responses, ['i:mat:f0182:v3', 0, 'C', null, 1, null]] }, anon)).not.toBe(base)
      }),
      { numRuns: 200 },
    )
  })

  it('is plain RFC 8785 of that object (the same function the database is held to)', () => {
    expect(sessionMacInput(session, 'hb_7Q3m9Kx2Vw5rT8pL')).toBe(jcs({ anon_id: 'hb_7Q3m9Kx2Vw5rT8pL', kind: 'hb.session.v1', session }))
  })
})
