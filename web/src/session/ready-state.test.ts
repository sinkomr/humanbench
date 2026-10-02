import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { RestoreResult } from '../save/autosave'
import { mergeBriefPrefs, restoreBriefPrefs } from '../save/brief-prefs'
import { saveWithSession } from '../save/create'
import { jcs } from '../save/jcs'
import { sameSave } from '../save/merge'
import { arbBriefPrefs } from '../save/testing'
import type { BriefContextV1, BriefPrefsV1, SaveFileV1 } from '../save/types'
import { SAVE_CTX } from './constants'
import { Bot } from './bot'
import { baseOf, defaultReadyState, replacesDeviceSettings } from './ready-state'

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

// ----------------------------------------------------------------------------- the file’s notes settings win

const context = (slot: number, rev: number, over: Partial<BriefContextV1> = {}): BriefContextV1 => ({
  slot,
  preset: 'general',
  destination: 'chatgpt_instructions',
  tier: 'T1',
  mode: 'do',
  length: 'standard',
  topics: {},
  lines_on: [],
  lines_off: [],
  rev,
  ...over,
})
const prefs = (over: Partial<BriefPrefsV1> = {}): BriefPrefsV1 => ({ v: 1, topics: 'topics-v1', groups: 'g1', notes_as_of: '2026-11', contexts: [], fit_log: [], ...over })
const withPrefs = (s: SaveFileV1, p: BriefPrefsV1 | undefined): SaveFileV1 => {
  const { brief_prefs: _drop, ...rest } = s
  return p === undefined ? rest : { ...rest, brief_prefs: p }
}
const presetOf = (s: SaveFileV1 | null, slot: number): string | undefined => (s?.brief_prefs?.contexts.find((c) => c.slot === slot) as BriefContextV1 | undefined)?.preset
const revOf = (s: SaveFileV1 | null, slot: number): number | undefined => s?.brief_prefs?.contexts.find((c) => c.slot === slot)?.rev

describe('loading a save on the ready screen: the file’s notes settings win per slot (ROADMAP owner decisions 2026-10-01, AI.7)', () => {
  const anon = 'hb_' + 'a'.repeat(17)
  // The device was used a lot since the file was made: its sets carry the higher revs.
  const device = withPrefs(aSave('s_READYSTATE00010', anon), prefs({ contexts: [context(1, 8, { preset: 'reading' }), context(2, 3, { preset: 'writing' })] }))
  const file = withPrefs(aSave('s_READYSTATE00011', anon), prefs({ contexts: [context(1, 2, { preset: 'coding' }), context(3, 1, { preset: 'numbers' })] }))
  const restored = restoredOf(device, [anon])

  it('a plain merge would keep the device’s set; the base keeps the file’s, one rev above, and the device’s other sets', () => {
    const base = baseOf(restored, { includeFound: true, loaded: file })!
    expect(presetOf(base, 1)).toBe('coding')
    expect(revOf(base, 1)).toBe(9)
    expect(presetOf(base, 2), 'a slot the file has no set in keeps the device’s').toBe('writing')
    expect(presetOf(base, 3), 'a slot only the file has comes from the file').toBe('numbers')
    // the sessions are still a plain merge of both
    expect(base.sessions.map((s) => s.session_id).sort()).toEqual(['s_READYSTATE00010', 's_READYSTATE00011'])
    // and the base is what the notes builder’s restore gives (the same rule in both places)
    expect(jcs(base.brief_prefs!)).toBe(jcs(restoreBriefPrefs(device.brief_prefs, file.brief_prefs!).prefs))
  })

  it('wins the same way when the new session is not added to the earlier saves on the device', () => {
    const base = baseOf(restored, { includeFound: false, loaded: file })!
    expect(base.sessions.map((s) => s.session_id)).toEqual(['s_READYSTATE00011'])
    expect(presetOf(base, 1)).toBe('coding')
    expect(revOf(base, 1), 'above the device’s rev, so every later join of the device’s saves keeps it').toBe(9)
    expect(presetOf(base, 3)).toBe('numbers')
    expect(presetOf(base, 2), 'the device’s own sets are not copied into a base that leaves its saves out').toBeUndefined()
    // the device’s autosave and the session’s autosave, joined later, give the file’s sets
    const joined = mergeBriefPrefs([device.brief_prefs, base.brief_prefs]) as BriefPrefsV1
    expect(joined.contexts.map((c) => [c.slot, (c as BriefContextV1).preset])).toEqual([[1, 'coding'], [2, 'writing'], [3, 'numbers']])
  })

  it('changes nothing when either side has no notes settings', () => {
    const bare = withPrefs(file, undefined)
    expect(sameSave(baseOf(restored, { includeFound: false, loaded: bare })!, bare)).toBe(true)
    expect(presetOf(baseOf(restored, { includeFound: true, loaded: bare }), 1), 'the device’s settings stay').toBe('reading')
    const noDevice = restoredOf(withPrefs(device, undefined), [anon])
    expect(revOf(baseOf(noDevice, { includeFound: false, loaded: file }), 1), 'revs are the file’s own').toBe(2)
    expect(sameSave(baseOf(null, { includeFound: false, loaded: file })!, file)).toBe(true)
  })

  it('keeps the edit counts of a device whose settings the file agrees with (loading one’s own save again)', () => {
    const base = baseOf(restored, { includeFound: true, loaded: withPrefs(file, device.brief_prefs) })!
    expect(base.brief_prefs!.contexts.map((c) => [c.slot, c.rev])).toEqual([[1, 8], [2, 3]])
    expect(jcs(base.brief_prefs!)).toBe(jcs(mergeBriefPrefs([device.brief_prefs]) as BriefPrefsV1))
  })

  it('does not touch the loaded file itself, and drops a file-level signature it no longer matches', () => {
    const signed = { ...file, sig: { alg: 'HS256', kid: 'k1', mac: 'AAAA' } } as unknown as SaveFileV1
    const before = jcs(signed)
    const base = baseOf(restored, { includeFound: false, loaded: signed })!
    expect(jcs(signed)).toBe(before)
    expect(base.sig).toBeUndefined()
  })

  it('says the file’s settings replace the device’s only when a set of the device’s is replaced by a different one', () => {
    expect(replacesDeviceSettings(restored, file)).toBe(true)
    // the same sets as the device’s (only the edit counts differ), or only new slots: nothing is replaced
    expect(replacesDeviceSettings(restored, withPrefs(file, prefs({ contexts: [context(1, 1, { preset: 'reading' })] })))).toBe(false)
    expect(replacesDeviceSettings(restored, withPrefs(file, prefs({ contexts: [context(4, 1)] })))).toBe(false)
    // no settings in the file, none on the device, no autosaves at all
    expect(replacesDeviceSettings(restored, withPrefs(file, undefined))).toBe(false)
    expect(replacesDeviceSettings(restoredOf(withPrefs(device, undefined), [anon]), file)).toBe(false)
    expect(replacesDeviceSettings(null, file)).toBe(false)
    expect(replacesDeviceSettings({ save: null, keys: [], failures: [], anonIds: [] }, file)).toBe(false)
  })

  it('gives the file’s content in every slot it has, for any two sets of settings (property)', () => {
    const base = aSave('s_READYSTATE00012', anon)
    fc.assert(
      fc.property(arbBriefPrefs, arbBriefPrefs, fc.boolean(), (onDevice, inFile, includeFound) => {
        const got = baseOf(restoredOf(withPrefs(base, onDevice), [anon]), { includeFound, loaded: withPrefs(base, inFile) })!
        const want = mergeBriefPrefs([inFile]) as BriefPrefsV1
        for (const c of want.contexts) {
          const there = got.brief_prefs!.contexts.find((x) => x.slot === c.slot)
          expect(there, `slot ${c.slot}`).toBeDefined()
          // below the ceiling of revs the file’s set is kept as it is (apart from its edit count)
          if ((mergeBriefPrefs([onDevice])?.contexts.find((x) => x.slot === c.slot)?.rev ?? 0) < 1_000_000) expect(jcs({ ...there, rev: 0 })).toBe(jcs({ ...c, rev: 0 }))
        }
        // with the device’s saves included, it is exactly the notes builder’s restore
        if (includeFound) expect(jcs(got.brief_prefs!)).toBe(jcs(restoreBriefPrefs(onDevice, inFile).prefs))
      }),
      { numRuns: 300 },
    )
  })
})
