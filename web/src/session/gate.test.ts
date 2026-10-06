import { describe, expect, it } from 'vitest'
import { AUTOSAVE_PREFIX } from '../save/autosave'
import { CONSENT_KEY, TERMS_VERSION, TERMS_VERSION_SERVER } from './constants'
import { forgetLocalData, hasAdultRecord, readAdultConsent, readConsent, recordConsent } from './gate'
import { SpyStorage } from './bot'

describe('the consent record (DESIGN §13)', () => {
  it('is nothing until the person consents, and reading writes nothing', () => {
    const s = new SpyStorage()
    expect(readConsent(s)).toBeNull()
    expect(s.writes).toEqual([])
    expect(readConsent(null)).toBeNull()
  })

  it('records exactly { v, terms, adult } and reads it back', () => {
    const s = new SpyStorage()
    expect(recordConsent(s)).toBe(true)
    expect(s.writes).toEqual([`set:${CONSENT_KEY}`])
    expect(JSON.parse(s.data.get(CONSENT_KEY)!)).toEqual({ v: 1, terms: TERMS_VERSION, adult: true })
    expect(readConsent(s)).toEqual({ v: 1, terms: TERMS_VERSION, adult: true })
  })

  it('does not honour another terms version, a malformed record or a non-adult one', () => {
    for (const bad of ['{', 'null', '[]', '{"v":2,"terms":"' + TERMS_VERSION + '","adult":true}', '{"v":1,"terms":"old","adult":true}', '{"v":1,"terms":"' + TERMS_VERSION + '","adult":false}']) {
      const s = new SpyStorage()
      s.data.set(CONSENT_KEY, bad)
      expect(readConsent(s), bad).toBeNull()
    }
  })

  it('survives a storage that throws (private mode)', () => {
    const throwing = {
      length: 0,
      key: () => null,
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readConsent(throwing)).toBeNull()
    expect(recordConsent(throwing)).toBe(false)
    expect(recordConsent(null)).toBe(false)
    expect(forgetLocalData(throwing)).toEqual([])
  })

  it('forgetLocalData removes the consent and every autosave, and nothing else', () => {
    const s = new SpyStorage()
    recordConsent(s)
    s.data.set(`${AUTOSAVE_PREFIX}s_A`, '{}')
    s.data.set(`${AUTOSAVE_PREFIX}s_B`, '{}')
    s.data.set('other-app:key', 'keep')
    const removed = forgetLocalData(s)
    expect(removed.sort()).toEqual([CONSENT_KEY, `${AUTOSAVE_PREFIX}s_A`, `${AUTOSAVE_PREFIX}s_B`].sort())
    expect([...s.data.keys()]).toEqual(['other-app:key'])
    expect(forgetLocalData(s)).toEqual([])
    expect(forgetLocalData(null)).toEqual([])
  })
})

describe('the 18+ confirmation under either notice (M2.7)', () => {
  it('is known under the static terms and the online ones, and under no others', () => {
    for (const terms of [TERMS_VERSION, TERMS_VERSION_SERVER]) {
      const s = new SpyStorage()
      recordConsent(s, terms)
      expect(readAdultConsent(s)).toEqual({ v: 1, terms, adult: true })
      expect(readConsent(s, terms === TERMS_VERSION ? TERMS_VERSION_SERVER : TERMS_VERSION)).toBeNull() // the session's own gate asks again for the other notice
    }
    const other = new SpyStorage()
    other.data.set(CONSENT_KEY, JSON.stringify({ v: 1, terms: 'older-terms', adult: true }))
    expect(readAdultConsent(other)).toBeNull()
    expect(readAdultConsent(new SpyStorage())).toBeNull()
    expect(readAdultConsent(null)).toBeNull()
  })
})

describe('an adult record under any terms (the welcome row, provisional default, UX-REVIEW D22)', () => {
  it('is true for the record of the current terms, of the online terms and of older ones; false for none', () => {
    expect(hasAdultRecord(new SpyStorage())).toBe(false)
    for (const terms of [TERMS_VERSION, TERMS_VERSION_SERVER, 'terms-2026-09-draft', 'anything-else']) {
      const s = new SpyStorage()
      s.data.set(CONSENT_KEY, JSON.stringify({ v: 1, terms, adult: true }))
      expect(hasAdultRecord(s), terms).toBe(true)
    }
  })

  it('is only a door: an older record is not honoured as consent for the current terms', () => {
    const s = new SpyStorage()
    s.data.set(CONSENT_KEY, JSON.stringify({ v: 1, terms: 'terms-2026-09-draft', adult: true }))
    expect(hasAdultRecord(s)).toBe(true)
    expect(readConsent(s)).toBeNull()
    expect(readAdultConsent(s)).toBeNull()
  })

  it('is false for a malformed record, another record version, a record that is not adult or has no terms', () => {
    for (const bad of ['{', 'null', '[]', '"x"', '{"v":2,"terms":"t","adult":true}', '{"v":1,"terms":"t","adult":false}', '{"v":1,"terms":"t"}', '{"v":1,"adult":true}', '{"v":1,"terms":7,"adult":true}']) {
      const s = new SpyStorage()
      s.data.set(CONSENT_KEY, bad)
      expect(hasAdultRecord(s), bad).toBe(false)
    }
  })

  it('reads one key and writes nothing; storage that is missing or throws is false', () => {
    const s = new SpyStorage()
    s.data.set(CONSENT_KEY, JSON.stringify({ v: 1, terms: 'old', adult: true }))
    hasAdultRecord(s)
    expect(s.calls).toEqual([`get:${CONSENT_KEY}`])
    expect(s.writes).toEqual([])
    expect(hasAdultRecord(null)).toBe(false)
    const throwing = { length: 0, key: () => null, getItem: () => { throw new Error('blocked') }, setItem: () => undefined, removeItem: () => undefined }
    expect(hasAdultRecord(throwing)).toBe(false)
  })
})
