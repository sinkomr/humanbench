import { describe, expect, it } from 'vitest'
import type { RestoreResult } from '../save/autosave'
import { saveWithSession } from '../save/create'
import { sameSave } from '../save/merge'
import { SAVE_CTX } from './constants'
import { Bot } from './bot'
import { baseOf, defaultReadyState } from './ready-state'

function aSave(sessionId: string, anonId: string) {
  const bot = new Bot({ sessionId, skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
  bot.until((v) => v.phase === 'confidence')
  bot.run.confirmConfidence(bot.view().confidence!.startPct)
  bot.run.finishEarly()
  return saveWithSession(null, bot.run.sessionState(), { ctx: SAVE_CTX, createdMs: 1_790_000_100_000, anonId })
}

const restoredOf = (save: ReturnType<typeof aSave>, anonIds: string[]): RestoreResult => ({ save, keys: ['k'], failures: [], anonIds })

describe('the ready screen’s choices (R-8.1)', () => {
  it('include autosaves of one identifier by default, and leave out several identifiers until asked', () => {
    const a = aSave('s_READYSTATE00001', 'hb_' + 'a'.repeat(17))
    expect(defaultReadyState(null)).toEqual({ includeFound: false, loaded: null })
    expect(defaultReadyState({ save: null, keys: [], failures: [], anonIds: [] })).toEqual({ includeFound: false, loaded: null })
    expect(defaultReadyState(restoredOf(a, [a.anon_id])).includeFound).toBe(true)
    expect(defaultReadyState(restoredOf(a, ['hb_x', 'hb_y'])).includeFound).toBe(false)
  })

  it('the base is null with no choice, the autosaves when included, the loaded file when given, and their merge when both', () => {
    const a = aSave('s_READYSTATE00002', 'hb_' + 'a'.repeat(17))
    const b = aSave('s_READYSTATE00003', a.anon_id)
    const restored = restoredOf(a, [a.anon_id])
    expect(baseOf(null, { includeFound: false, loaded: null })).toBeNull()
    expect(baseOf(restored, { includeFound: false, loaded: null })).toBeNull()
    expect(sameSave(baseOf(restored, { includeFound: true, loaded: null })!, a)).toBe(true)
    expect(sameSave(baseOf(restored, { includeFound: false, loaded: b })!, b)).toBe(true)
    const both = baseOf(restored, { includeFound: true, loaded: b })!
    expect(both.sessions.map((s) => s.session_id).sort()).toEqual(['s_READYSTATE00002', 's_READYSTATE00003'])
    // The same session in both is one session (merge is idempotent).
    expect(baseOf(restored, { includeFound: true, loaded: a })!.sessions).toHaveLength(1)
  })
})
