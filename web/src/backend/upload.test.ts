import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { jcs } from '../save/jcs'
import { sessionMacInput } from '../save/mac-input'
import { arbSave, arbSession } from '../save/testing'
import type { SaveFileV1 } from '../save/types'
import { BackendError } from './errors'
import { BRIEF_PREFS_KEY, assertNoBriefPrefs, hasBriefPrefs, signedSessionsOnly, toUploadPayload, withAnonId } from './upload'

const withPrefs = arbSave({ withPrefs: true })

describe('hasBriefPrefs', () => {
  it('finds the key at any depth, in arrays too', () => {
    expect(hasBriefPrefs({ brief_prefs: {} })).toBe(true)
    expect(hasBriefPrefs({ a: { b: [{ c: { brief_prefs: 1 } }] } })).toBe(true)
    expect(hasBriefPrefs([[{ brief_prefs: null }]])).toBe(true)
  })

  it('does not mistake a value or a similar key for it', () => {
    expect(hasBriefPrefs({ a: 'brief_prefs' })).toBe(false)
    expect(hasBriefPrefs({ brief_pref: 1, Brief_Prefs: 2, 'brief_prefs ': 3 })).toBe(false)
    expect(hasBriefPrefs(['brief_prefs'])).toBe(false)
    expect(hasBriefPrefs(null)).toBe(false)
    expect(hasBriefPrefs('x')).toBe(false)
  })

  it('survives a cycle and a deep structure', () => {
    const a: Record<string, unknown> = {}
    a.self = a
    expect(hasBriefPrefs(a)).toBe(false)
    let deep: unknown = { brief_prefs: 1 }
    for (let i = 0; i < 20_000; i++) deep = { next: deep }
    expect(hasBriefPrefs(deep)).toBe(true)
  })
})

describe('assertNoBriefPrefs', () => {
  it('refuses with a local error that names the call', () => {
    expect(() => assertNoBriefPrefs({ p_save: { brief_prefs: {} } }, 'mirror_put')).toThrowError(BackendError)
    try {
      assertNoBriefPrefs({ x: { brief_prefs: {} } }, 'rescore')
    } catch (e) {
      expect(e).toMatchObject({ kind: 'local', code: 'brief_prefs_in_payload' })
      expect(String((e as Error).message)).toContain('rescore')
    }
    expect(() => assertNoBriefPrefs({ p_save: {} }, 'rescore')).not.toThrow()
  })
})

describe('toUploadPayload (AI.26, R-17.1)', () => {
  it('removes the notes settings and leaves everything else as it was', () => {
    fc.assert(
      fc.property(withPrefs, (save) => {
        const before = jcs(save)
        const out = toUploadPayload(save)
        expect(Object.hasOwn(out, BRIEF_PREFS_KEY)).toBe(false)
        expect(hasBriefPrefs(out)).toBe(false)
        expect(jcs(save)).toBe(before) // the input is not changed
        const { brief_prefs: _p, ...rest } = save
        expect(jcs(out)).toBe(jcs(rest))
      }),
      { numRuns: 300 },
    )
  })

  it('is idempotent, and returns a save without the key as it is', () => {
    fc.assert(
      fc.property(withPrefs, (save) => {
        const once = toUploadPayload(save)
        expect(toUploadPayload(once)).toBe(once)
      }),
      { numRuns: 100 },
    )
  })

  it('never changes what a session signature covers: editing preferences keeps every session byte for byte (AI.26)', () => {
    fc.assert(
      fc.property(withPrefs, (save) => {
        const out = toUploadPayload(save)
        expect(out.sessions).toBe(save.sessions) // the same objects, so the same bytes
        for (const s of save.sessions) expect(sessionMacInput(s, save.anon_id)).toBe(sessionMacInput(out.sessions.find((x) => x.session_id === s.session_id && x === s)!, save.anon_id))
      }),
      { numRuns: 100 },
    )
  })

  it('a save with the settings edited or removed has the same upload as before (the session verdicts cannot change)', () => {
    fc.assert(
      fc.property(withPrefs, (save) => {
        const edited: SaveFileV1 = { ...save, brief_prefs: { v: 1, topics: 'topics-v1', groups: 'g1', notes_as_of: '2026-10', contexts: [], fit_log: [] } }
        expect(jcs(toUploadPayload(edited))).toBe(jcs(toUploadPayload(save)))
        const { brief_prefs: _p, ...removed } = save
        expect(jcs(toUploadPayload(removed))).toBe(jcs(toUploadPayload(save)))
      }),
      { numRuns: 100 },
    )
  })
})

describe('signedSessionsOnly (data minimisation)', () => {
  it('keeps the signed sessions and drops the rest, and the notes settings', () => {
    fc.assert(
      fc.property(arbSave({ withPrefs: true, sessions: fc.array(arbSession(), { maxLength: 6 }) }), (save) => {
        const out = signedSessionsOnly(save)
        expect(hasBriefPrefs(out)).toBe(false)
        expect(out.sessions.every((s) => s.sig !== undefined)).toBe(true)
        expect(out.sessions).toEqual(save.sessions.filter((s) => s.sig !== undefined))
        expect(out.seen_items).toEqual(save.seen_items)
        // the cache summarises the sessions that stay on the device too, so it stays on the device
        expect(Object.hasOwn(out, 'posterior_cache')).toBe(false)
        const { brief_prefs: _p, posterior_cache: _c, sessions: _s, ...rest } = save
        const { sessions: _o, ...kept } = out
        expect(jcs(kept)).toBe(jcs(rest))
      }),
      { numRuns: 200 },
    )
  })
})

describe('withAnonId', () => {
  it('re-keys a save, and leaves the sessions (which name their own anon_id in the sig) alone', () => {
    fc.assert(
      fc.property(arbSave(), (save) => {
        const out = withAnonId(save, 'hb_QQQQQQQQQQQQQQQQ')
        expect(out.anon_id).toBe('hb_QQQQQQQQQQQQQQQQ')
        expect(out.sessions).toBe(save.sessions)
        expect(withAnonId(out, 'hb_QQQQQQQQQQQQQQQQ')).toBe(out)
      }),
      { numRuns: 50 },
    )
  })
})
