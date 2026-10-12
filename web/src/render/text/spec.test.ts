/**
 * The shape of a served text multiple-choice question (ROADMAP M3.11 phase 1; DESIGN §11.2, R-11.1):
 * what is taken for one, what is not, and that the text is kept as the characters it is.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { toServedItem } from '../../backend/items'
import { parseNext } from '../../backend/replies'
import { DEMO_TEXT_ITEMS } from './demo'
import { TEXT_MC_MAX_OPTIONS, TEXT_MC_MIN_OPTIONS, TEXT_MC_RENDERER, isTextMcResponse, paragraphs, splitTextStem, textMcSpec } from './spec'

const OPTIONS = ['First made-up option', 'Second made-up option', 'Third made-up option', 'Fourth made-up option']
const base = { stem: 'A made-up question?', media: null, options: OPTIONS } as const

describe('textMcSpec', () => {
  it('takes a stem and two to six options, with no media or an empty one', () => {
    expect(textMcSpec(base)).toEqual({ stem: 'A made-up question?', stimulus: [], options: OPTIONS })
    expect(textMcSpec({ ...base, media: {} })).toEqual({ stem: 'A made-up question?', stimulus: [], options: OPTIONS })
    for (let k = TEXT_MC_MIN_OPTIONS; k <= TEXT_MC_MAX_OPTIONS; k++) expect(textMcSpec({ ...base, options: Array.from({ length: k }, (_, i) => `Option ${i}`) })?.options).toHaveLength(k)
  })

  it('reads a stimulus as paragraphs, from a string or a list', () => {
    expect(textMcSpec({ ...base, media: { stimulus: 'One.\n\nTwo.' } })?.stimulus).toEqual(['One.', 'Two.'])
    expect(textMcSpec({ ...base, media: { stimulus: ['One.', 'Two.\n\nThree.'] } })?.stimulus).toEqual(['One.', 'Two.', 'Three.'])
  })

  it('is not text multiple choice with too few or too many options, an empty text, or anything else in media', () => {
    expect(textMcSpec({ ...base, options: null })).toBeNull()
    expect(textMcSpec({ ...base, options: ['only one'] })).toBeNull()
    expect(textMcSpec({ ...base, options: Array.from({ length: 7 }, (_, i) => `Option ${i}`) })).toBeNull()
    expect(textMcSpec({ ...base, options: ['a', ' ', 'c'] })).toBeNull()
    expect(textMcSpec({ ...base, stem: null })).toBeNull()
    expect(textMcSpec({ ...base, stem: '  \n ' })).toBeNull()
    expect(textMcSpec({ ...base, media: { renderer: 'passage_v1', passage: ['A passage.'] } })).toBeNull() // a passage question: a later phase
    expect(textMcSpec({ ...base, media: { renderer: 'logic_game_v1', setup: 'A setup.' } })).toBeNull()
    expect(textMcSpec({ ...base, media: { figure: 'x.svg' } })).toBeNull() // something this renderer cannot show
    expect(textMcSpec({ ...base, media: { stimulus: 'Text.', figure: 'x.svg' } })).toBeNull()
    expect(textMcSpec({ ...base, media: { stimulus: 7 } })).toBeNull()
    expect(textMcSpec({ ...base, media: { stimulus: '' } })).toBeNull()
    expect(textMcSpec({ ...base, media: { stimulus: ['a', 3] } })).toBeNull()
  })

  it('keeps every character of the stem and the options, whatever they are (the text is data)', () => {
    const text = fc.string({ minLength: 1, maxLength: 60 }).filter((s) => s.trim() !== '')
    fc.assert(
      fc.property(text, fc.array(text, { minLength: TEXT_MC_MIN_OPTIONS, maxLength: TEXT_MC_MAX_OPTIONS }), (stem, options) => {
        const spec = textMcSpec({ stem, media: null, options })
        expect(spec).toEqual({ stem, stimulus: [], options })
        expect(Object.keys(spec!).sort()).toEqual(['options', 'stem', 'stimulus'])
      }),
    )
  })

  it('never throws and never returns anything but a spec or null, for any payload', () => {
    fc.assert(
      fc.property(fc.option(fc.string(), { nil: null }), fc.option(fc.dictionary(fc.string(), fc.jsonValue()), { nil: null }), fc.option(fc.array(fc.string(), { maxLength: 9 }), { nil: null }), (stem, media, options) => {
        const spec = textMcSpec({ stem, media: media as Record<string, unknown> | null, options })
        if (spec === null) return
        expect(spec.options).toEqual(options)
        expect(spec.options.length).toBeGreaterThanOrEqual(TEXT_MC_MIN_OPTIONS)
        expect(spec.options.length).toBeLessThanOrEqual(TEXT_MC_MAX_OPTIONS)
        expect(Object.keys(media ?? {}).every((k) => k === 'stimulus')).toBe(true)
      }),
    )
  })
})

describe('the stem on screen', () => {
  it('splits at blank lines: the last paragraph is the question, the ones before are read first', () => {
    expect(splitTextStem('Only a question?')).toEqual({ lead: [], question: 'Only a question?' })
    expect(splitTextStem('An argument.\n\nMore of it.\r\n\r\nThe question?')).toEqual({ lead: ['An argument.', 'More of it.'], question: 'The question?' })
    expect(splitTextStem('Line one\nline two')).toEqual({ lead: [], question: 'Line one\nline two' }) // a single break stays inside its paragraph
    expect(paragraphs(' \n\n a \n \n b \n\n')).toEqual(['a', 'b'])
  })

  it('loses no text: the paragraphs joined are the stem, but for the blank lines', () => {
    fc.assert(
      fc.property(fc.array(fc.stringMatching(/^[a-z][a-z .?]{0,20}$/u), { minLength: 1, maxLength: 5 }), (parts) => {
        const { lead, question } = splitTextStem(parts.join('\n\n'))
        expect([...lead, question]).toEqual(parts.map((p) => p.trim()))
      }),
    )
  })
})

describe('the response', () => {
  it('is a position among the options and nothing else', () => {
    expect(isTextMcResponse(0, 4)).toBe(true)
    expect(isTextMcResponse(3, 4)).toBe(true)
    for (const bad of [4, -1, 1.5, '1', null, undefined, Number.NaN]) expect(isTextMcResponse(bad, 4)).toBe(false)
  })
})

describe('a served text item (backend/items.ts)', () => {
  it('goes to the text renderer under its client-side name, with the text as its spec and the option count for the slider', () => {
    for (const demo of DEMO_TEXT_ITEMS) {
      const w = parseNext({ seq: 2, item: { item_id: demo.item_id, item_type: 'mc_text', time_limit_s: 180, ...demo.payload } })
      if (w.kind !== 'item') throw new Error('no item')
      const served = toServedItem(w.seq, w.item)
      expect(served).toMatchObject({ seq: 2, item_id: demo.item_id, item_type: 'mc_text', family: TEXT_MC_RENDERER, supported: true, options_count: demo.payload.options.length, time_limit_s: 180 })
      expect(served.spec).toMatchObject({ stem: demo.payload.stem, options: demo.payload.options })
    }
  })

  it('carries nothing but what the server sent: no key, no verdict, no parameter can appear in it', () => {
    const w = parseNext({ seq: 1, item: { item_id: 'i:tst:1', item_type: 'mc_text', time_limit_s: 60, stem: 'A made-up question?', options: OPTIONS, key: { index: 2 }, rationale: 'x', a: 1.2, b: 0.3, correct: 1 } })
    if (w.kind !== 'item') throw new Error('no item')
    const served = toServedItem(w.seq, w.item)
    expect(served.supported).toBe(true)
    expect(JSON.stringify(served)).not.toMatch(/"key"|"index"|rationale|"correct"|"a":|"b":/u)
  })

  it('a payload that names a renderer is never taken for text, and a procedural family still goes to its own renderer', () => {
    const wire = { itemId: 'i:x', itemType: 'mc', timeLimitS: null, stem: 'A made-up question?', options: OPTIONS }
    expect(toServedItem(1, { ...wire, media: { renderer: 'passage_v1', passage: ['A passage.'] } })).toMatchObject({ supported: false, family: 'passage_v1', spec: {} })
    expect(toServedItem(1, { ...wire, media: { renderer: 'rat_triad_v1', cues: ['a', 'b', 'c'] } })).toMatchObject({ supported: false, family: 'rat_triad_v1' })
    expect(toServedItem(1, { ...wire, media: { renderer: 'matrices', grid: [] } })).toMatchObject({ supported: true, family: 'matrices' })
    expect(toServedItem(1, { ...wire, media: null })).toMatchObject({ supported: true, family: TEXT_MC_RENDERER })
  })
})
