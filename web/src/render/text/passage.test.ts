/**
 * The spec of a served passage question (ROADMAP M3.11 phase 2; DESIGN §3 row 4, §11.2, R-11.1): what is
 * accepted and what is not, that the server's text stays text, how a served item becomes one, and how a
 * reply's `set` is read. Every payload here is made up (`demo-passage.ts`).
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { toServedItem } from '../../backend/items'
import { parseNext, parseSubmit } from '../../backend/replies'
import { DEMO_PASSAGES, demoPassage, demoPassagePayload } from './demo-passage'
import { PASSAGE_MEDIA_RENDERER, TEXT_PASSAGE_RENDERER, isPassageSpec, passageSpec, passageTextOf, textKey } from './passage'
import { TEXT_MC_RENDERER } from './spec'

const STEM = 'Made-up test question: which placeholder is listed first?'
const OPTIONS = ['Placeholder A', 'Placeholder B', 'Placeholder C', 'Placeholder D']
const payload = (media: Record<string, unknown> | null, over: { stem?: string | null; options?: readonly string[] | null } = {}) => ({
  stem: over.stem === undefined ? STEM : over.stem,
  media,
  options: over.options === undefined ? OPTIONS : over.options,
})
const media = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ renderer: PASSAGE_MEDIA_RENDERER, passage: ['Made-up paragraph one.', 'Made-up paragraph two.'], ...over })

describe('passageSpec: what a passage question is', () => {
  it('takes the bank\'s shape: a stem, options, and media with the renderer name and the paragraphs', () => {
    const spec = passageSpec(payload(media()))
    expect(spec).toEqual({ stem: STEM, stimulus: [], options: OPTIONS, passage: ['Made-up paragraph one.', 'Made-up paragraph two.'], attribution: null, title: null, passageKey: textKey(['Made-up paragraph one.', 'Made-up paragraph two.']) })
    expect(isPassageSpec(spec!)).toBe(true)
    expect(passageTextOf(spec!)).toEqual({ passage: spec!.passage, attribution: null, title: null, passageKey: spec!.passageKey })
  })

  it('takes a passage given as one string, split at blank lines, and a source line and a title', () => {
    const spec = passageSpec(payload(media({ passage: 'Made-up one.\n\nMade-up two.\r\n\r\nMade-up three.', attribution: '  A made-up source line.  ', title: 'A made-up title' })))
    expect(spec?.passage).toEqual(['Made-up one.', 'Made-up two.', 'Made-up three.'])
    expect(spec?.attribution).toBe('A made-up source line.')
    expect(spec?.title).toBe('A made-up title')
  })

  it('reads a blank source line or title as none', () => {
    expect(passageSpec(payload(media({ attribution: '   ', title: '' })))).toMatchObject({ attribution: null, title: null })
    expect(passageSpec(payload(media({ attribution: null })))).toMatchObject({ attribution: null })
  })

  it.each([
    ['no media', null],
    ['another renderer', media({ renderer: 'logic_game_v1' })],
    ['no renderer name', { passage: ['Made-up.'] }],
    ['no passage', { renderer: PASSAGE_MEDIA_RENDERER }],
    ['an empty passage', media({ passage: [] })],
    ['a passage of blanks', media({ passage: ['  ', '\n\n'] })],
    ['a passage that is not text', media({ passage: [1, 2] })],
    ['a passage that is an object', media({ passage: { text: 'x' } })],
    ['a source line that is not a string', media({ attribution: { text: 'x' } })],
    ['a title that is not a string', media({ title: 7 })],
    ['a field this screen cannot show', media({ figure: 'chart.png' })],
    ['a field named for an answer', media({ evidence_span: 'made up' })],
  ])('refuses %s: the question is not drawn', (_what, m) => {
    expect(passageSpec(payload(m as Record<string, unknown> | null))).toBeNull()
  })

  it('refuses a question the text renderer would refuse: no stem, one option, seven options, a blank option', () => {
    expect(passageSpec(payload(media(), { stem: null }))).toBeNull()
    expect(passageSpec(payload(media(), { stem: '  ' }))).toBeNull()
    expect(passageSpec(payload(media(), { options: null }))).toBeNull()
    expect(passageSpec(payload(media(), { options: ['only one'] }))).toBeNull()
    expect(passageSpec(payload(media(), { options: ['1', '2', '3', '4', '5', '6', '7'] }))).toBeNull()
    expect(passageSpec(payload(media(), { options: ['a', ' '] }))).toBeNull()
  })

  it('keeps every string as it was sent: markup is characters (fast-check)', () => {
    const text = fc.string({ minLength: 1, maxLength: 60 }).filter((s) => s.trim() !== '' && !/\n\s*\n/u.test(s) && !/\r/u.test(s))
    fc.assert(
      fc.property(fc.array(text, { minLength: 1, maxLength: 5 }), text, fc.array(text, { minLength: 2, maxLength: 6 }), fc.option(text, { nil: undefined }), (passage, stem, options, attribution) => {
        const spec = passageSpec(payload(media({ passage, ...(attribution === undefined ? {} : { attribution }) }), { stem, options }))
        expect(spec).not.toBeNull()
        expect(spec!.passage).toEqual(passage.map((p) => p.trim()))
        expect(spec!.stem).toBe(stem)
        expect(spec!.options).toEqual(options)
        expect(spec!.attribution).toBe(attribution === undefined ? null : attribution.trim())
        // nothing but the fields a client may see, and none named for a key
        expect(Object.keys(spec!).sort()).toEqual(['attribution', 'options', 'passage', 'passageKey', 'stem', 'stimulus', 'title'])
      }),
      { numRuns: 200 },
    )
  })

  it('every demo passage question is a passage question, with the same key for the questions of one passage and another for each passage', () => {
    const keys = DEMO_PASSAGES.map((p) => {
      const specs = p.questions.map((_, q) => passageSpec(demoPassagePayload(p, q)))
      expect(specs.every((s) => s !== null), p.id).toBe(true)
      expect(new Set(specs.map((s) => s!.passageKey)).size, p.id).toBe(1)
      for (const para of p.media.passage) expect(para, p.id).toMatch(/[Mm]ade-up|[Pp]laceholder/u)
      return specs[0]!.passageKey
    })
    expect(new Set(keys).size).toBe(DEMO_PASSAGES.length)
  })
})

describe('textKey: a name for "the same text"', () => {
  it('is equal for equal paragraphs and differs when the text or its split into paragraphs differs (fast-check)', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 40 }), { minLength: 1, maxLength: 6 }), (parts) => {
        expect(textKey([...parts])).toBe(textKey(parts))
        expect(textKey([...parts, 'x'])).not.toBe(textKey(parts))
        expect(textKey(parts.map((p, i) => (i === 0 ? `${p}!` : p)))).not.toBe(textKey(parts))
      }),
      { numRuns: 200 },
    )
    expect(textKey(['ab', 'c'])).not.toBe(textKey(['a', 'bc']))
    expect(textKey(['abc'])).not.toBe(textKey(['ab', 'c']))
  })
})

describe('a served passage item (backend/items.ts)', () => {
  const wire = (m: Record<string, unknown> | null, itemType = 'mc_passage') => ({ itemId: 'i:tst:rc:p001-q1', itemType, timeLimitS: 300, stem: STEM, media: m, options: OPTIONS })

  it('is shown by the passage renderer, with its place in the set and the time limit the server states', () => {
    const item = toServedItem(4, wire(media({ attribution: 'A made-up source line.' })), { index: 2, of: 4 })
    expect(item).toMatchObject({ seq: 4, item_id: 'i:tst:rc:p001-q1', item_type: 'mc_passage', family: TEXT_PASSAGE_RENDERER, supported: true, options_count: 4, time_limit_s: 300, set: { index: 2, of: 4 } })
    expect(isPassageSpec(item.spec)).toBe(true)
    expect(JSON.stringify(item)).not.toMatch(/"key"|"correct"|rationale|tolerance/u)
  })

  it('has no `set` when the server names none, and text multiple choice is untouched', () => {
    expect('set' in toServedItem(1, wire(media()))).toBe(false)
    const text = toServedItem(1, { ...wire(null), itemType: 'mc_text' })
    expect(text.family).toBe(TEXT_MC_RENDERER)
    expect('set' in text).toBe(false)
  })

  it('is not drawn when its media is not exactly a passage: the skip is offered instead of half a passage', () => {
    for (const m of [media({ figure: 'x' }), media({ passage: [] }), { renderer: PASSAGE_MEDIA_RENDERER }]) {
      expect(toServedItem(1, wire(m))).toMatchObject({ supported: false, family: PASSAGE_MEDIA_RENDERER, spec: {} })
    }
    // a logic game is drawn like a passage question since 2026-10-13, its setup in the passage's place (items.families.test.ts)
    expect(toServedItem(1, wire({ renderer: 'logic_game_v1', setup: 'Made up.' }, 'mc_logic_game'))).toMatchObject({ supported: true, family: 'text_passage' })
    // the alternate-uses task is suspended (owner, 2026-10-13): nothing draws it for a served item
    expect(toServedItem(1, wire({ renderer: 'aut_v1', object: 'a made-up object' }, 'aut_prompt'))).toMatchObject({ supported: false })
  })
})

describe('the place in a set, as a reply says it (backend/replies.ts)', () => {
  const item = { item_id: 'i:tst:rc:p001-q1', item_type: 'mc_passage', time_limit_s: 300, stem: STEM, media: media(), options: OPTIONS }

  it('is read from next_item and from the next of submit; a reply without one has none', () => {
    expect(parseNext({ seq: 3, item, set: { position: 1, of: 3 } })).toMatchObject({ kind: 'item', seq: 3, set: { index: 1, of: 3 } })
    expect(parseNext({ seq: 3, item })).toMatchObject({ kind: 'item', set: null })
    expect(parseNext({ seq: 3, item, set: null })).toMatchObject({ set: null })
    expect(parseSubmit({ ack: true, seq: 3, next: { seq: 4, item, set: { position: 2, of: 3 } } }).next).toMatchObject({ kind: 'item', set: { index: 2, of: 3 } })
  })

  it.each([
    ['not an object', 'first'],
    ['no position', { of: 3 }],
    ['the name of a key\'s field', { index: 1, of: 3 }],
    ['a place before the first', { position: 0, of: 3 }],
    ['a place past the last', { position: 4, of: 3 }],
    ['a fraction', { position: 1.5, of: 3 }],
    ['a set too large to be one', { position: 1, of: 1000 }],
  ])('refuses %s as a bad reply', (_what, set) => {
    expect(() => parseNext({ seq: 3, item, set })).toThrow(/bad_reply|set/u)
  })

  it('the demo passages have three or four questions each', () => {
    for (const p of DEMO_PASSAGES) expect([3, 4]).toContain(p.questions.length)
    expect(demoPassage(DEMO_PASSAGES.length)).toBe(DEMO_PASSAGES[0])
  })
})
