/**
 * The consent and 18+ gate's storage (ROADMAP M1.15; DESIGN §13 "Consent and age gate"): "Under-18s
 * are blocked with no data stored."
 *
 * Nothing is written before the person confirms they are 18 or older and agrees to the terms:
 * the welcome and gate screens keep their state in memory only, and the under-18 path never calls
 * any function of this module (`SessionApp.dom.test.ts` and `e2e/session.spec.ts` check that
 * localStorage, sessionStorage, cookies and IndexedDB stay empty). After the person passes, one
 * record is kept so the next visit does not ask again: `hb:consent:v1` = `{ v: 1, terms, adult }`
 * (no time, no id). The record is honoured only for the terms version it was given for.
 * {@link forgetLocalData} removes it together with every autosave (the privacy page's button).
 */

import { autosaveKeys, browserStorage, type StorageLike } from '../save/autosave'
import { CONSENT_KEY, TERMS_VERSION } from './constants'

export interface Consent {
  readonly v: 1
  readonly terms: string
  readonly adult: true
}

/** The stored consent for this terms version, or null (none, unreadable, another version). */
export function readConsent(storage: StorageLike | null = browserStorage()): Consent | null {
  if (storage === null) return null
  try {
    const text = storage.getItem(CONSENT_KEY)
    if (text === null) return null
    const c = JSON.parse(text) as Partial<Consent> | null
    return c !== null && typeof c === 'object' && c.v === 1 && c.adult === true && c.terms === TERMS_VERSION ? { v: 1, terms: c.terms, adult: true } : null
  } catch {
    return null
  }
}

/** Keep the consent (call only after the person confirmed the gate). False when storage refused it. */
export function recordConsent(storage: StorageLike | null = browserStorage()): boolean {
  if (storage === null) return false
  try {
    storage.setItem(CONSENT_KEY, JSON.stringify({ v: 1, terms: TERMS_VERSION, adult: true } satisfies Consent))
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
