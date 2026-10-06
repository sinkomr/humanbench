/**
 * The consent and 18+ gate's storage (ROADMAP M1.15; DESIGN §13 "Consent and age gate"): "Under-18s
 * are blocked with no data stored."
 *
 * Nothing is written before the person confirms they are 18 or older and agrees to the terms:
 * the welcome and gate screens keep their state in memory only, and the under-18 path never calls
 * a function of this module that writes (`SessionApp.dom.test.ts` and `e2e/session.spec.ts` check that
 * localStorage, sessionStorage, cookies and IndexedDB stay empty). It reads one key, the consent record,
 * to know whether the gate was passed before ({@link readConsent}, {@link hasAdultRecord}); no autosave
 * is read until a record of an adult is found. After the person passes, one
 * record is kept so the next visit does not ask again: `hb:consent:v1` = `{ v: 1, terms, adult }`
 * (no time, no id). The record is honoured only for the terms version it was given for.
 * {@link forgetLocalData} removes it together with every autosave (the privacy page's button).
 */

import { autosaveKeys, browserStorage, type StorageLike } from '../save/autosave'
import { CONSENT_KEY, TERMS_VERSION, TERMS_VERSION_SERVER } from './constants'

export interface Consent {
  readonly v: 1
  readonly terms: string
  readonly adult: true
}

/** The stored consent for this terms version (default the static version's; the online version passes its own), or null (none, unreadable, another version). */
export function readConsent(storage: StorageLike | null = browserStorage(), terms: string = TERMS_VERSION): Consent | null {
  if (storage === null) return null
  try {
    const text = storage.getItem(CONSENT_KEY)
    if (text === null) return null
    const c = JSON.parse(text) as Partial<Consent> | null
    return c !== null && typeof c === 'object' && c.v === 1 && c.adult === true && c.terms === terms ? { v: 1, terms: c.terms, adult: true } : null
  } catch {
    return null
  }
}

/**
 * Whether the person has passed the 18+ gate on this device under ANY terms this app has had, the static
 * notice's or the online one's (the notes page asks it, ROADMAP AI.5, M2.7): the age confirmation is the
 * same under both, and a person who passed it for one is not asked again for the other there. A record for
 * terms this build does not know is not honoured, as {@link readConsent} does not.
 */
export function readAdultConsent(storage: StorageLike | null = browserStorage()): Consent | null {
  return readConsent(storage, TERMS_VERSION) ?? readConsent(storage, TERMS_VERSION_SERVER)
}

/**
 * Whether this browser holds an adult consent record under ANY terms version, honoured or not (provisional
 * default, UX-REVIEW D22). The welcome screen asks it to decide whether a returning visitor gets the row
 * "See my results" and "Notes for your AI": a record of older terms still proves that the 18+ gate was passed
 * here, and the row is only a door. It is not consent for the current terms: {@link readConsent} stays the
 * one that lets the flow skip the gate, and a person who goes through the door with an older record is shown
 * the gate first. Reads one key and writes nothing; no record (the under-18 path never stores one) is false.
 */
export function hasAdultRecord(storage: StorageLike | null = browserStorage()): boolean {
  if (storage === null) return false
  try {
    const text = storage.getItem(CONSENT_KEY)
    if (text === null) return false
    const c = JSON.parse(text) as Partial<Consent> | null
    return c !== null && typeof c === 'object' && c.v === 1 && c.adult === true && typeof c.terms === 'string'
  } catch {
    return false
  }
}

/** Keep the consent (call only after the person confirmed the gate). False when storage refused it. */
export function recordConsent(storage: StorageLike | null = browserStorage(), terms: string = TERMS_VERSION): boolean {
  if (storage === null) return false
  try {
    storage.setItem(CONSENT_KEY, JSON.stringify({ v: 1, terms, adult: true } satisfies Consent))
    return true
  } catch {
    return false
  }
}

/** Remove the consent and every autosave of this app from `storage`; returns the keys removed. */
export function forgetLocalData(storage: StorageLike | null = browserStorage()): string[] {
  if (storage === null) return []
  const removed: string[] = []
  for (const key of [CONSENT_KEY, ...autosaveKeys(storage)]) {
    try {
      if (storage.getItem(key) === null) continue
      storage.removeItem(key)
      removed.push(key)
    } catch {
      // Leave what cannot be removed; nothing else is touched.
    }
  }
  return removed
}
