/** The pure steps of the notes builder (proposal §3.3): five topics, five sets, tick semantics, presets. */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { buildBrief } from './build'
import {
  activeExtras,
  activePrefs,
  addContext,
  applyTick,
  choosePreset,
  confirmT2,
  initialState,
  otherContexts,
  removeContext,
  removeCustom,
  resetAll,
  selectContext,
  setCustomText,
  setDestination,
  setForm,
  setInterests,
  setLength,
  setLine,
  setMode,
  setPhrasing,
  setTier,
  setTopic,
  setWordChoice,
  toggleTopic,
  wordChoice,
  type BuilderState,
} from './builder'
import { normalizePrefs } from './prefs'
import { resolveForm, destination } from './surfaces'
import { MAX_TOPICS_PER_CONTEXT, TOPICS } from './topics'

const build = (s: BuilderState) => buildBrief({ prefs: activePrefs(s), extras: activeExtras(s), form: 'long', asOf: '2026-11' })

describe('sets of notes', () => {
  it('starts with one general set, adds up to five with the lowest free slot, and removes one at a time', () => {
    let s = initialState()
    expect(s.contexts).toHaveLength(1)
    expect(activePrefs(s).preset).toBe('general')
    for (let i = 0; i < 6; i++) s = addContext(s)
    expect(s.contexts.map((c) => c.slot)).toEqual([1, 2, 3, 4, 5])
    expect(s.active).toBe(4)
    s = removeContext(s, 1)
    expect(s.contexts.map((c) => c.slot)).toEqual([1, 3, 4, 5])
    expect(s.active).toBe(3)
    s = addContext(s)
    expect(s.contexts.map((c) => c.slot)).toEqual([1, 3, 4, 5, 2])
    expect(s.extras).toHaveLength(5)
    expect(s.destinationChosen).toHaveLength(5)
    expect(selectContext(s, 0).active).toBe(0)
    expect(selectContext(s, 9)).toBe(s)
    expect(removeContext(initialState(), 0).contexts).toHaveLength(1)
    expect(removeContext(s, 9)).toBe(s)
  })

  it('shows the other sets to the active one (for the all-topics tier)', () => {
    let s = addContext(initialState())
    s = selectContext(s, 0)
    expect(otherContexts(s).map((c) => c.slot)).toEqual([2])
  })

  it('keeps the active index valid when the active or an earlier set is removed', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 0, max: 4 }), fc.integer({ min: 0, max: 4 }), (adds, activeAt, removeAt) => {
        let s = initialState()
        for (let i = 0; i < adds; i++) s = addContext(s)
        s = selectContext(s, Math.min(activeAt, s.contexts.length - 1))
        s = removeContext(s, removeAt)
        expect(s.active).toBeGreaterThanOrEqual(0)
        expect(s.active).toBeLessThan(s.contexts.length)
        expect(s.extras).toHaveLength(s.contexts.length)
      }),
    )
  })
})

describe('presets', () => {
  it('a different use takes the preset\'s mode, length, style lines and destination, keeping topics and typed extras', () => {
    let s = initialState()
    s = toggleTopic(s, 'kst/physics')
    s = setInterests(s, 'chess')
    s = setLine(s, 'U3', false)
    s = choosePreset(s, 'coding')
    const p = activePrefs(s)
    expect(p).toMatchObject({ preset: 'coding', mode: 'do', length: 'short', destination: 'claude_code_skill', lines_on: [], lines_off: [] })
    expect(p.topics).toEqual({ 'kst/physics': 'ask_first' })
    expect(activeExtras(s).interests).toBe('chess')
    expect(build(s).text).toContain('Lead with the answer or the code')
  })

  it('keeps a destination the person chose, and follows the preset otherwise', () => {
    const followed = choosePreset(initialState(), 'coding')
    expect(activePrefs(followed).destination).toBe('claude_code_skill')
    const chosen = choosePreset(setDestination(initialState(), 'gemini_gem'), 'coding')
    expect(activePrefs(chosen).destination).toBe('gemini_gem')
  })
})

describe('topics', () => {
  it('adds a topic as "not sure", removes it again, and never lists more than five', () => {
    let s = initialState()
    s = toggleTopic(s, 'kst/physics')
    expect(activePrefs(s).topics).toEqual({ 'kst/physics': 'ask_first' })
    s = toggleTopic(s, 'kst/physics')
    expect(activePrefs(s).topics).toEqual({})
    for (const t of TOPICS.slice(0, 8)) s = toggleTopic(s, t.id)
    expect(Object.keys(activePrefs(s).topics)).toHaveLength(MAX_TOPICS_PER_CONTEXT)
  })

  it('sets and changes a topic\'s setting, only for a picked topic', () => {
    let s = toggleTopic(initialState(), 'kst/physics')
    s = setTopic(s, 'kst/physics', 'build')
    expect(activePrefs(s).topics['kst/physics']).toBe('build')
    expect(setTopic(s, 'kst/biology', 'skip')).toBe(s)
  })

  it('forgets that a removed topic was ticked off in the preview', () => {
    let s = toggleTopic(initialState(), 'kst/physics')
    s = applyTick(s, { kind: 'topics', topics: ['kst/physics'] }, false)
    expect(activePrefs(s).topics_off).toEqual(['kst/physics'])
    s = toggleTopic(s, 'kst/physics')
    expect(activePrefs(s).topics_off).toEqual([])
  })
})

describe('ticks', () => {
  it('unticks a default by remembering it, and ticks it back by forgetting it', () => {
    let s = initialState()
    s = setLine(s, 'U3', false)
    expect(activePrefs(s).lines_off).toEqual(['U3'])
    expect(build(s).text).not.toContain('few new ideas')
    s = setLine(s, 'U3', true)
    expect(activePrefs(s)).toMatchObject({ lines_off: [], lines_on: [] })
    expect(build(s).text).toContain('few new ideas')
  })

  it('ticks an optional line on by listing it, and off by dropping it', () => {
    let s = setLine(initialState(), 'FMT1', true)
    expect(activePrefs(s).lines_on).toEqual(['FMT1'])
    s = setLine(s, 'FMT1', false)
    expect(activePrefs(s)).toMatchObject({ lines_on: [], lines_off: [] })
  })

  it('applies a preview tick by kind: key, topics, custom, and nothing for a locked line', () => {
    let s = setInterests(initialState(), '')
    s = setCustomText(s, 0, 'Use metric units')
    s = applyTick(s, { kind: 'custom', index: 0 }, false)
    expect(activeExtras(s).custom[0]).toEqual({ text: 'Use metric units', on: false })
    s = applyTick(s, { kind: 'key', key: 'U5' }, false)
    expect(activePrefs(s).lines_off).toEqual(['U5'])
    expect(applyTick(s, { kind: 'locked' }, false)).toBe(s)
  })

  it('bumps the revision of the changed set only', () => {
    let s = addContext(initialState())
    const before = s.contexts.map((c) => c.rev)
    s = setMode(s, 'learn')
    expect(activePrefs(s).rev).toBe(before[1]! + 1)
    expect(s.contexts[0]!.rev).toBe(before[0])
  })
})

describe('mode, length, words, wording, destination, tier', () => {
  it('changes the default mode and the answer length', () => {
    let s = setMode(initialState(), 'learn')
    s = setLength(s, 'detailed')
    expect(activePrefs(s)).toMatchObject({ mode: 'learn', length: 'detailed' })
    expect(build(s).text).toContain('Detailed answers are welcome.')
  })

  it('reads and sets the word choice, one at a time', () => {
    let s = initialState()
    expect(wordChoice(activePrefs(s))).toBe('plain')
    s = setWordChoice(s, 'w1')
    expect(wordChoice(activePrefs(s))).toBe('w1')
    s = setWordChoice(s, 'w2')
    expect(activePrefs(s).lines_on).toEqual(['W2'])
    expect(wordChoice(activePrefs(s))).toBe('w2')
    s = setWordChoice(s, 'plain')
    expect(activePrefs(s).lines_on).toEqual([])
    expect(build(s).text).toContain('Use plain words.')
  })

  it('chooses another wording from a family', () => {
    const s = setPhrasing(initialState(), 'U1', 'U1c')
    expect(build(s).text).toContain('Lead with the answer or the code')
    expect(normalizePrefs(activePrefs(s)).phrasing).toEqual({ U1: 'U1c' })
  })

  it('sets the destination and the length of the notes, and resets the length when the destination changes', () => {
    let s = setDestination(initialState(), 'chatgpt_instructions')
    expect(resolveForm(destination(activePrefs(s).destination)!, activePrefs(s).form)).toBe('short')
    s = setForm(s, 'long')
    expect(resolveForm(destination('chatgpt_instructions')!, activePrefs(s).form)).toBe('long')
    s = setDestination(s, 'claude_project')
    expect(activePrefs(s).form).toBeUndefined()
  })

  it('needs an explicit acknowledgement for the all-topics tier, and forgets it when the tier goes back', () => {
    let s = setTier(initialState(), 'T2')
    expect(s.t2Confirmed).toBe(false)
    s = confirmT2(s, true)
    expect(s.t2Confirmed).toBe(true)
    s = setTier(s, 'T1')
    expect(s.t2Confirmed).toBe(false)
  })
})

describe('typed extras', () => {
  it('adds custom lines up to three, edits them, and removes them', () => {
    let s = initialState()
    for (let i = 0; i < 5; i++) s = setCustomText(s, i, `Line number ${'x'.repeat(i)}`)
    expect(activeExtras(s).custom).toHaveLength(3)
    s = setCustomText(s, 1, 'Changed')
    expect(activeExtras(s).custom[1]?.text).toBe('Changed')
    s = removeCustom(s, 0)
    expect(activeExtras(s).custom.map((c) => c.text)).toEqual(['Changed', 'Line number xx'])
  })

  it('keeps typed extras apart from the settings that AI.7 will store', () => {
    const s = setCustomText(setInterests(initialState(), 'chess'), 0, 'Use metric units')
    expect(JSON.stringify(s.contexts)).not.toMatch(/chess|metric/)
  })

  it('goes back to a fresh page when the settings are removed', () => {
    const s = resetAll()
    expect(s).toEqual(initialState())
  })
})

describe('any sequence of steps keeps the settings valid', () => {
  it('leaves settings that normalise to themselves, within the caps', () => {
    const steps: ((s: BuilderState) => BuilderState)[] = [
      (s) => toggleTopic(s, 'kst/physics'),
      (s) => toggleTopic(s, 'other/statistics'),
      (s) => setTopic(s, 'kst/physics', 'build'),
      (s) => setMode(s, 'learn'),
      (s) => setLength(s, 'short'),
      (s) => setLine(s, 'FMT1', true),
      (s) => setLine(s, 'U3', false),
      (s) => setWordChoice(s, 'w2'),
      (s) => setPhrasing(s, 'DA', 'DA.p'),
      (s) => addContext(s),
      (s) => choosePreset(s, 'coding'),
      (s) => setDestination(s, 'claude_code_skill'),
      (s) => setTier(s, 'T2'),
      (s) => applyTick(s, { kind: 'topics', topics: ['kst/physics'] }, false),
      (s) => removeContext(s, 0),
    ]
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...steps), { maxLength: 25 }), (seq) => {
        const s = seq.reduce((acc, f) => f(acc), initialState())
        expect(s.contexts.length).toBeLessThanOrEqual(5)
        expect(s.contexts.length).toBeGreaterThanOrEqual(1)
        for (const c of s.contexts) {
          expect(normalizePrefs(c)).toEqual(c)
          expect(Object.keys(c.topics).length).toBeLessThanOrEqual(MAX_TOPICS_PER_CONTEXT)
        }
        // and the notes always build within their limit
        const r = build(s)
        expect(r.fits).toBe(true)
      }),
      { numRuns: 200 },
    )
  })
})
