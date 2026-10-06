import { describe, expect, it } from 'vitest'
import { autosaveKey } from '../save/autosave'
import { saveWithSession } from '../save/create'
import type { BriefContextV1, BriefPrefsV1, SaveFileV1 } from '../save/types'
import { Bot, SpyStorage } from './bot'
import { CONSENT_KEY, SAVE_CTX, TERMS_VERSION, TERMS_VERSION_SERVER } from './constants'
import { holdsResults, readReturning } from './returning'

const ANON = 'hb_' + 'f'.repeat(17)

/** A save with one answered question (a result to look at). */
function answered(id = 's_RETURNING0000001', anonId = ANON): SaveFileV1 {
  const bot = new Bot({ sessionId: id, skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
  bot.until((v) => v.phase === 'confidence')
  bot.run.confirmConfidence(bot.view().confidence!.startPct)
  bot.run.finishEarly()
  return saveWithSession(null, bot.run.sessionState(), { ctx: SAVE_CTX, createdMs: 1_790_000_100_000, anonId })
}

/** A session that was started and ended with no answer. */
function empty(id = 's_RETURNING0000002'): SaveFileV1 {
  const bot = new Bot({ sessionId: id })
  bot.run.finishEarly()
  return saveWithSession(null, bot.run.sessionState(), { ctx: SAVE_CTX, createdMs: 1_790_000_100_000, anonId: ANON })
}

const context: BriefContextV1 = { slot: 1, preset: 'reading', destination: 'chatgpt_instructions', tier: 'T1', mode: 'do', length: 'standard', topics: {}, lines_on: [], lines_off: [], rev: 1 }
const prefs = (contexts: BriefPrefsV1['contexts']): BriefPrefsV1 => ({ v: 1, topics: 'topics-v1', groups: 'g1', notes_as_of: '2026-11', contexts, fit_log: [] })

function holding(consent: string | null, saves: SaveFileV1[] = []): SpyStorage {
  const s = new SpyStorage()
  if (consent !== null) s.data.set(CONSENT_KEY, JSON.stringify({ v: 1, terms: consent, adult: true }))
  for (const save of saves) s.data.set(autosaveKey(save.sessions[0]?.session_id ?? 'prefs'), JSON.stringify(save))
  return s
}

describe('what the welcome screen shows a returning visitor (UX-REVIEW D22, provisional default)', () => {
  it('without an adult record it is nothing, and the only thing read is the consent key', () => {
    const s = holding(null, [answered()])
    expect(readReturning(s)).toBeNull()
    expect(s.calls).toEqual([`get:${CONSENT_KEY}`])
    expect(readReturning(null)).toBeNull()
  })

  it('with a record and an answered session: results', () => {
    expect(readReturning(holding(TERMS_VERSION, [answered()]))).toEqual({ results: true, notes: false })
    expect(holdsResults(answered())).toBe(true)
  })

  it('a record of the online terms, or of terms this build does not know, opens the row too: it is a door, not a consent', () => {
    for (const terms of [TERMS_VERSION_SERVER, 'terms-2026-09-draft']) {
      expect(readReturning(holding(terms, [answered()])), terms).toEqual({ results: true, notes: false })
    }
  })

  it('with a record, no session with an answer and no notes: nothing', () => {
    expect(readReturning(holding(TERMS_VERSION))).toBeNull()
    expect(readReturning(holding(TERMS_VERSION, [empty()]))).toBeNull()
  })

  it('notes settings that are kept: the notes link, with or without results', () => {
    const withNotes = { ...answered(), brief_prefs: prefs([context]) }
    expect(readReturning(holding(TERMS_VERSION, [withNotes]))).toEqual({ results: true, notes: true })
    const prefsOnly = { ...empty(), sessions: [], brief_prefs: prefs([context]) }
    expect(readReturning(holding(TERMS_VERSION, [prefsOnly]))).toEqual({ results: false, notes: true })
  })

  it('notes that were all removed are not kept', () => {
    const removed = { ...empty(), sessions: [], brief_prefs: prefs([{ slot: 1, rev: 2, removed: true }]) }
    expect(readReturning(holding(TERMS_VERSION, [removed]))).toBeNull()
    const mixed = { ...empty(), sessions: [], brief_prefs: prefs([{ slot: 1, rev: 2, removed: true }, { ...context, slot: 2 }]) }
    expect(readReturning(holding(TERMS_VERSION, [mixed]))).toEqual({ results: false, notes: true })
  })

  it('with a server the results are not offered (the server scores them), the notes still are', () => {
    const withNotes = { ...answered(), brief_prefs: prefs([context]) }
    expect(readReturning(holding(TERMS_VERSION, [withNotes]), false)).toEqual({ results: false, notes: true })
    expect(readReturning(holding(TERMS_VERSION, [answered()]), false)).toBeNull()
  })

  it('autosaves of two identifiers are the person\'s choice on the ready screen, so no results button here', () => {
    const two = [answered('s_RETURNING0000001', ANON), answered('s_RETURNING0000003', 'hb_' + 'e'.repeat(17))]
    expect(readReturning(holding(TERMS_VERSION, two))).toBeNull()
  })

  it('a save that cannot be read is nothing, and a record in storage that throws is nothing', () => {
    const s = holding(TERMS_VERSION)
    s.data.set(autosaveKey('s_BROKEN00000000001'), '{not json')
    expect(readReturning(s)).toBeNull()
    const throwing = {
      length: 0,
      key: () => null,
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    }
    expect(readReturning(throwing)).toBeNull()
  })

  it('writes nothing, ever', () => {
    const s = holding(TERMS_VERSION, [{ ...answered(), brief_prefs: prefs([context]) }])
    readReturning(s)
    expect(s.writes).toEqual([])
  })

  it('holdsResults is false for a save with no scorable answer, and does not throw on one that cannot be scored', () => {
    expect(holdsResults(empty())).toBe(false)
    const twice = answered()
    expect(holdsResults({ ...twice, sessions: [twice.sessions[0]!, twice.sessions[0]!] })).toBe(false)
  })
})
