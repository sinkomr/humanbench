import { describe, expect, it } from 'vitest'
import { AUTOSAVE_PREFIX } from '../save/autosave'
import { CONSENT_KEY, TERMS_VERSION } from './constants'
import { forgetLocalData, readConsent, recordConsent } from './gate'
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
