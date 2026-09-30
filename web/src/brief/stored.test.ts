/**
 * The stored form of the builder's settings (AI.7; proposal §5.5; requirements R-17.1, R-17.12):
 * every string is an enum, an id, a version or a month; interests and own lines never appear; ids
 * written under an older vocabulary resolve through the alias map, so overrides and the fit log are
 * never orphaned; a removed set stays removed; and whatever a file holds, reading it never throws.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { validateSave } from '../save/validate'
import { SCHEMA_URL, SCHEMA_VERSION } from '../save/types'
import { addContext, initialState, persistedOf, recordCopied, recordFit, removeContext, setInterests, setCustomText, setTopic, stateFromStored, toggleTopic } from './builder'
import { FIT_VERDICTS, type FitEntry } from './fit'
import { normalizePrefs, type ContextPrefs } from './prefs'
import { copiedRecordOf } from './returning'
import { DESTINATIONS } from './surfaces'
import { fromStored, storedContext, toStored, type PersistedState } from './stored'
import { arbExtras, arbPrefs } from './testing'
import { GROUPS_VERSION, TOPICS, TOPICS_VERSION, resolveTopicId } from './topics'
import { PRESETS } from './types'

const asSave = (bp: unknown): unknown => ({ $schema: SCHEMA_URL, schema_version: SCHEMA_VERSION, bank_version: 'm1-static', anon_id: 'hb_7Q3m9Kx2Vw5rT8pL', created_utc: '2026-11-03T10:00:00Z', sessions: [], seen_items: [], seen_families: [], brief_prefs: bp })
const fit = (i: number, topic: string, verdict: FitEntry['verdict'] = 'too_basic', month = '2026-11'): FitEntry => ({ id: `${i.toString(16).padStart(2, '0')}abcdef`, topic, verdict, month })
const persisted = (over: Partial<PersistedState> = {}): PersistedState => ({ contexts: [normalizePrefs({ preset: 'coding', slot: 1 })], copied: [null], tombstones: [], fitLog: [], ...over })

describe('toStored', () => {
  it('writes the settings in the shape of proposal §5.5, leaving out what is empty or default', () => {
    const c = normalizePrefs({
      slot: 1,
      preset: 'coding',
      destination: 'claude_code_skill',
      mode: 'do',
      length: 'short',
      topics: { 'other/programming': 'skip', 'other/statistics': 'skip', 'quant/probability_counting': 'ask_first' },
      lines_on: ['AC1'],
      lines_off: ['U3'],
      rev: 7,
    })
    const copied = copiedRecordOf([{ id: 'F1' }, { id: 'DS', topics: ['other/programming'] }, { id: 'X1', text: 'Use metric units.', custom: true }], '2026-11')
    const s = toStored(persisted({ contexts: [c], copied: [copied], fitLog: [fit(3, 'quant/probability_counting')] }), '2026-11')
    expect(s).toEqual({
      v: 1,
      topics: TOPICS_VERSION,
      groups: GROUPS_VERSION,
      notes_as_of: '2026-11',
      contexts: [
        {
          slot: 1,
          preset: 'coding',
          destination: 'claude_code_skill',
          tier: 'T1',
          mode: 'do',
          length: 'short',
          topics: { 'other/programming': 'skip', 'other/statistics': 'skip', 'quant/probability_counting': 'ask_first' },
          lines_on: ['AC1'],
          lines_off: ['U3'],
          copied: { templates: '2026.09', month: '2026-11', lines: [{ id: 'F1', v: '1' }, { id: 'DS', v: '1' }] },
          rev: 7,
        },
      ],
      fit_log: [{ id: '03abcdef', topic: 'quant/probability_counting', verdict: 'too_basic', month: '2026-11' }],
    })
    // the custom line is not in it, and it is a valid `brief_prefs`
    expect(JSON.stringify(s)).not.toContain('metric')
    expect(validateSave(asSave(s)).ok).toBe(true)
  })

  it('validates as the brief_prefs of a save for any settings, and every string in it is from a closed set', () => {
    const CLOSED = new Set<string>([...PRESETS, 'T1', 'T2', 'short', 'long', 'skill', 'do', 'learn', 'standard', 'detailed', 'skip', 'ask_first', 'build', 'v', TOPICS_VERSION, GROUPS_VERSION, ...FIT_VERDICTS])
    fc.assert(
      fc.property(fc.array(arbPrefs, { minLength: 1, maxLength: 5 }), (list) => {
        const contexts = list.map((c, i) => ({ ...c, slot: i + 1 }))
        const s = toStored(persisted({ contexts, copied: contexts.map(() => null) }), '2026-11')
        expect(validateSave(asSave(s)).ok).toBe(true)
        const strings: string[] = []
        const walk = (v: unknown): void => {
          if (typeof v === 'string') strings.push(v)
          else if (Array.isArray(v)) v.forEach(walk)
          else if (typeof v === 'object' && v !== null) for (const [k, x] of Object.entries(v)) (strings.push(k), walk(x))
        }
        walk(s)
        const ids = new Set(TOPICS.map((t) => t.id))
        for (const t of strings) expect(CLOSED.has(t) || ids.has(t) || /^[A-Za-z][A-Za-z0-9.]{0,15}$/.test(t) || /^[a-z][a-z0-9_]{0,40}$/.test(t) || /^\d{4}-\d{2}$/.test(t), t).toBe(true)
      }),
      { numRuns: 300 },
    )
  })

  it('validates for every destination the builder offers and every use (the ids fit the schema)', () => {
    for (const d of DESTINATIONS) {
      for (const preset of PRESETS) {
        const c = normalizePrefs({ slot: 1, preset, destination: d.id })
        expect(c.destination, d.id).toBe(d.id)
        expect(validateSave(asSave(toStored(persisted({ contexts: [c] }), '2026-11'))).ok, `${preset} ${d.id}`).toBe(true)
      }
    }
  })

  it('never carries the interests, own lines or anything typed, whatever the page holds', () => {
    fc.assert(
      fc.property(arbExtras, (extras) => {
        let s = initialState('coding')
        s = toggleTopic(s, 'other/programming')
        s = setInterests(s, extras.interests)
        extras.custom.forEach((c, i) => (s = setCustomText(s, i, c.text)))
        const json = JSON.stringify(toStored(persistedOf(s), '2026-11'))
        for (const c of extras.custom) if (c.text.trim().length > 3) expect(json).not.toContain(c.text.trim())
        if (extras.interests.trim().length > 3) expect(json).not.toContain(extras.interests.trim())
        expect(json).not.toMatch(/interest|custom|"text"/)
      }),
      { numRuns: 100 },
    )
  })

  it('keeps a removed set as a tombstone and drops one whose slot is live again', () => {
    const c1 = normalizePrefs({ slot: 1 })
    const s = toStored(persisted({ contexts: [c1], copied: [null], tombstones: [{ slot: 2, rev: 4 }, { slot: 1, rev: 9 }] }), '2026-11')
    expect(s.contexts).toEqual([storedContext(c1, null), { slot: 2, rev: 4, removed: true }])
  })
})

describe('fromStored', () => {
  it('gives back what toStored wrote: sets, what was copied, removed sets and fit notes', () => {
    fc.assert(
      fc.property(fc.array(arbPrefs, { minLength: 1, maxLength: 4 }), fc.array(fc.constantFrom(...FIT_VERDICTS), { maxLength: 5 }), (list, verdicts) => {
        const contexts = list.map((c, i) => normalizePrefs({ ...c, slot: i + 1 }))
        const copied = contexts.map((_, i) => (i % 2 === 0 ? copiedRecordOf([{ id: 'F1' }, { id: 'U4' }], '2026-10') : null))
        const fitLog = verdicts.map((v, i) => fit(i, 'quant/linear', v))
        const tombstones = [{ slot: 5, rev: 3 }]
        const back = fromStored(toStored({ contexts, copied, tombstones, fitLog }, '2026-11'))
        expect(back).not.toBeNull()
        expect(back?.contexts).toEqual(contexts)
        expect(back?.copied).toEqual(copied)
        expect(back?.tombstones).toEqual(tombstones)
        expect(back?.fitLog).toEqual(fitLog)
        expect(back?.notesAsOf).toBe('2026-11')
      }),
      { numRuns: 200 },
    )
  })

  it('resolves a topic id written under an older vocabulary through the alias map (a split copies the setting to each successor)', () => {
    const aliases = { 'quant/old_probability': ['quant/probability_counting', 'quant/series_number'], 'other/old_stats': ['other/statistics'], 'gone/nothing': [] }
    const stored = {
      contexts: [{ slot: 1, preset: 'learning', destination: 'claude_project', tier: 'T1', mode: 'learn', length: 'standard', topics: { 'quant/old_probability': 'skip', 'other/old_stats': 'build', 'gone/nothing': 'skip', 'quant/linear': 'ask_first' }, topics_off: ['other/old_stats', 'nope/nope'], lines_on: [], lines_off: [], rev: 2 }],
      fit_log: [
        { id: '00abcdef', topic: 'quant/old_probability', verdict: 'too_basic', month: '2026-10' },
        { id: '01abcdef', topic: 'gone/nothing', verdict: 'too_basic', month: '2026-10' },
      ],
      notes_as_of: '2026-11',
    }
    const back = fromStored(stored, aliases)
    expect(back?.contexts[0]?.topics).toEqual({ 'quant/linear': 'ask_first', 'quant/probability_counting': 'skip', 'quant/series_number': 'skip', 'other/statistics': 'build' })
    expect(back?.contexts[0]?.topics_off).toEqual(['other/statistics'])
    expect(back?.fitLog.map((f) => [f.id, f.topic])).toEqual([['00abcdef', 'quant/probability_counting'], ['00abcdef', 'quant/series_number']])
  })

  it('gives a topic two old ids map to the setting that helps most', () => {
    const aliases = { 'a/one': ['quant/linear'], 'a/two': ['quant/linear'] }
    const stored = (one: string, two: string): unknown => ({
      contexts: [{ slot: 1, preset: 'general', destination: 'chatgpt_instructions', tier: 'T1', mode: 'do', length: 'standard', topics: { 'a/one': one, 'a/two': two }, lines_on: [], lines_off: [], rev: 0 }],
      fit_log: [],
      notes_as_of: '2026-11',
    })
    expect(fromStored(stored('skip', 'build'), aliases)?.contexts[0]?.topics).toEqual({ 'quant/linear': 'build' })
    expect(fromStored(stored('skip', 'ask_first'), aliases)?.contexts[0]?.topics).toEqual({ 'quant/linear': 'ask_first' })
    expect(fromStored(stored('build', 'skip'), aliases)?.contexts[0]?.topics).toEqual({ 'quant/linear': 'build' })
  })

  it('resolves every topic id the builder writes, directly or through the aliases (so nothing stored is orphaned)', () => {
    fc.assert(
      fc.property(fc.array(arbPrefs, { minLength: 1, maxLength: 3 }), (list) => {
        const contexts = list.map((c, i) => normalizePrefs({ ...c, slot: i + 1 }))
        const s = toStored({ contexts, copied: contexts.map(() => null), tombstones: [], fitLog: [] }, '2026-11')
        for (const c of s.contexts) if (!('removed' in c)) for (const id of [...Object.keys(c.topics), ...(c.topics_off ?? [])]) expect(resolveTopicId(id).length, id).toBeGreaterThan(0)
      }),
      { numRuns: 100 },
    )
  })

  it('drops unknown ids, junk sets and malformed notes, keeps the rest, and never throws', () => {
    expect(fromStored(null)).toBeNull()
    expect(fromStored('x')).toBeNull()
    expect(fromStored({})).toBeNull()
    const back = fromStored({
      contexts: [
        { slot: 9, preset: 'coding' },
        { slot: 1, preset: 'my level is low', destination: 'My Place', topics: { 'I am bad at maths': 'skip', 'quant/linear': 'i give up' }, lines_on: ['a sentence'], lines_off: ['U3'], rev: -4 },
        { slot: 1, preset: 'coding' },
        'x',
      ],
      fit_log: [{ id: 'nope', topic: 'quant/linear', verdict: 'too_basic', month: '2026-11' }, { id: '00abcdef', topic: 'quant/linear', verdict: 'far too easy', month: '2026-11' }, 7, null],
      notes_as_of: 'sometime',
    })
    expect(back?.contexts).toHaveLength(1)
    expect(back?.contexts[0]).toMatchObject({ slot: 1, preset: 'general', destination: 'chatgpt_instructions', topics: {}, lines_on: [], lines_off: ['U3'], rev: 0 })
    expect(back?.fitLog).toEqual([])
    expect(back?.notesAsOf).toBeNull()
    fc.assert(fc.property(fc.anything(), (x) => void fromStored(x)), { numRuns: 500 })
    fc.assert(fc.property(fc.jsonValue(), (x) => void fromStored({ contexts: [x], fit_log: [x], notes_as_of: x })), { numRuns: 500 })
  })

  it('drops text that fits an id pattern of the save schema but is not one of this build\'s ids: a bare word or snake_case in any id position (R-17.12)', () => {
    const back = fromStored({
      contexts: [
        {
          slot: 1,
          preset: 'coding',
          destination: 'my_child_has_dyslexia',
          topics: { 'other/health_anxiety': 'skip', 'other/programming': 'skip' },
          topics_off: ['other/health_anxiety', 'other/programming'],
          lines_on: ['Dyslexia', 'AC1'],
          lines_off: ['my_notes', 'U3'],
          phrasing: { U2: 'Dyslexia', U1: 'U1c' },
          copied: { templates: '2026.11', month: '2026-11', lines: [{ id: 'Dyslexia', v: '1' }, { id: 'DS', v: '1' }] },
          rev: 1,
        },
      ],
      fit_log: [{ id: '00abcdef', topic: 'other/health_anxiety', verdict: 'too_basic', month: '2026-11' }],
    })
    const c = back?.contexts[0]
    // the destination falls back to the preset's own, and every unknown id is gone
    expect(c?.destination).toBe('claude_code_skill')
    expect(c?.topics).toEqual({ 'other/programming': 'skip' })
    expect(c?.topics_off).toEqual(['other/programming'])
    expect(c?.lines_on).toEqual(['AC1'])
    expect(c?.lines_off).toEqual(['U3'])
    expect(c?.phrasing).toEqual({ U1: 'U1c' })
    expect(back?.fitLog).toEqual([])
    // a destination the builder offers is kept
    for (const d of DESTINATIONS) expect(fromStored({ contexts: [{ slot: 1, preset: 'general', destination: d.id }] })?.contexts[0]?.destination, d.id).toBe(d.id)
  })
})

describe('the builder state and its stored form', () => {
  it('keeps a removed set removed, and lets a set added in that slot replace the removal', () => {
    let s = initialState('coding')
    s = addContext(s) // slot 2
    s = { ...s, contexts: s.contexts.map((c) => (c.slot === 2 ? { ...c, rev: 5 } : c)) }
    s = removeContext(s, 1)
    expect(s.contexts.map((c) => c.slot)).toEqual([1])
    expect(s.tombstones).toEqual([{ slot: 2, rev: 6 }])
    expect(toStored(persistedOf(s), '2026-11').contexts).toContainEqual({ slot: 2, rev: 6, removed: true })
    const again = addContext(s)
    expect(again.tombstones).toEqual([])
    expect(again.contexts[1]).toMatchObject({ slot: 2, rev: 7 })
  })

  it('restores sets, copied records and fit notes, and keeps the typed extras of a set when settings are loaded over it', () => {
    let s = initialState('coding')
    s = toggleTopic(s, 'other/programming')
    s = setTopic(s, 'other/programming', 'skip')
    s = setInterests(s, 'chess')
    s = recordCopied(s, copiedRecordOf([{ id: 'F1' }], '2026-11'))
    s = recordFit(s, 'other/programming', 'too_basic', '2026-11', 'abcdef')
    const back = fromStored(toStored(persistedOf(s), '2026-11'))
    const restored = stateFromStored(back!)
    expect(restored.contexts).toEqual(s.contexts)
    expect(restored.copied).toEqual(s.copied)
    expect(restored.fitLog).toEqual(s.fitLog)
    expect(restored.extras[0]?.interests).toBe('')
    const merged = stateFromStored(back!, s)
    expect(merged.extras[0]?.interests).toBe('chess')
    expect(merged.active).toBe(0)
  })

  it('bumps a set\'s rev when something is copied for it (so the record wins a merge), and starts a fresh set above a removed one', () => {
    let s = initialState('coding')
    const before = s.contexts[0]!.rev
    s = recordCopied(s, copiedRecordOf([{ id: 'F1' }], '2026-11'))
    expect(s.contexts[0]!.rev).toBe(before + 1)
    expect(s.copied[0]?.lines).toEqual([{ id: 'F1', v: '1' }])
    const empty = stateFromStored({ contexts: [], copied: [], tombstones: [{ slot: 1, rev: 6 }], fitLog: [], notesAsOf: null })
    expect(empty.contexts).toHaveLength(1)
    expect(empty.contexts[0]).toMatchObject({ slot: 1, rev: 7 })
    expect(empty.tombstones).toEqual([])
  })

  it('records a fit note for a topic with the next id of the month', () => {
    let s = initialState()
    s = recordFit(s, 'quant/linear', 'too_basic', '2026-11', 'aaaaaa')
    s = recordFit(s, 'quant/linear', 'too_much', '2026-11', 'bbbbbb')
    expect(s.fitLog.map((f) => f.id)).toEqual(['00aaaaaa', '01bbbbbb'])
  })

  it('does not import the engine, the save module or any results code at run time', () => {
    const src = import.meta.glob<string>(['./stored.ts', './fit.ts', './builder.ts', './store-types.ts'], { query: '?raw', import: 'default', eager: true })
    for (const [file, text] of Object.entries(src)) {
      const runtime = [...text.matchAll(/^(?:import|export)(?! type)\s.*from '([^']+)'/gm)].map((m) => m[1] as string)
      expect(runtime.filter((i) => /save|engine|tasks|render|viz/.test(i)), file).toEqual([])
    }
  })
})

describe('context type', () => {
  it('is what the builder writes', () => {
    const c: ContextPrefs = normalizePrefs({ slot: 2, preset: 'reading' })
    expect(storedContext(c, null)).toMatchObject({ slot: 2, preset: 'reading', topics: {}, lines_on: [], lines_off: [], rev: 0 })
    expect(storedContext(c, null)).not.toHaveProperty('copied')
    expect(storedContext(c, null)).not.toHaveProperty('form')
    expect(storedContext({ ...c, form: 'long' }, null)).toMatchObject({ form: 'long' })
  })
})
