/** The render payload of a situational judgment item and the guards of its answers (ROADMAP M6.2). */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  isMostLeast,
  isRatingLevel,
  isSjtRatings,
  RATING_LEVELS,
  SJT_ITEM_TYPE,
  SJT_OPTIONS,
  SJT_RENDERER,
  specFromPayload,
  specProblems,
  type SjtPayload,
  type SjtSpec,
} from './spec'

const RESPONSES = ['Raise it privately and ask what happened.', 'Tell the manager at once.', 'Say nothing and redo the work.', 'Mention it in the team channel.'] as const
const SPEC: SjtSpec = { scenario: 'A teammate misses a deadline that delays your work.', question: 'How effective is each response?', responses: RESPONSES }
const PAYLOAD: SjtPayload = { stem: SPEC.scenario, media: { renderer: SJT_RENDERER, question: SPEC.question }, options: RESPONSES }

describe('the names the bank and this renderer share', () => {
  it('are the ones of the contract with hb.sjt', () => {
    expect(SJT_ITEM_TYPE).toBe('sjt_rating')
    expect(SJT_RENDERER).toBe('sjt_rating_v1')
    expect(SJT_OPTIONS).toBe(4)
    expect(RATING_LEVELS).toBe(4)
  })
})

describe('specProblems', () => {
  it('has none for a situation with a question and four distinct responses', () => {
    expect(specProblems(SPEC)).toEqual([])
  })

  it('names a missing or blank scenario and question', () => {
    expect(specProblems({ ...SPEC, scenario: '  ' })).toEqual(['a situation has a scenario'])
    expect(specProblems({ ...SPEC, question: '' })).toEqual(['a situation has a question'])
  })

  it('wants exactly four responses', () => {
    for (const responses of [[], RESPONSES.slice(0, 3), [...RESPONSES, 'Another response.']]) {
      expect(specProblems({ ...SPEC, responses }), String(responses.length)).toEqual(['a situation has exactly 4 responses'])
    }
  })

  it('wants every response to be text, and the responses to differ (case and spacing aside)', () => {
    expect(specProblems({ ...SPEC, responses: ['One.', ' ', 'Three.', 'Four.'] })).toEqual(['every response is a text'])
    expect(specProblems({ ...SPEC, responses: ['One.', 'one. ', 'Three.', 'Four.'] })).toEqual(['the responses are distinct'])
  })

  it('does not throw on an object that is not a spec', () => {
    expect(specProblems({ scenario: 3, question: null, responses: 'abcd' } as unknown as SjtSpec).length).toBeGreaterThan(0)
  })
})

describe('specFromPayload', () => {
  it('reads the stem as the scenario, media.question as the question and the options as the responses', () => {
    expect(specFromPayload(PAYLOAD)).toEqual(SPEC)
  })

  it('refuses a payload of another renderer, a missing question, stem or options, or an unrenderable spec', () => {
    expect(specFromPayload({ ...PAYLOAD, media: { renderer: 'emotion_vignette_v1', question: SPEC.question } })).toBeNull()
    expect(specFromPayload({ ...PAYLOAD, media: null })).toBeNull()
    expect(specFromPayload({ ...PAYLOAD, media: { renderer: SJT_RENDERER } })).toBeNull()
    expect(specFromPayload({ ...PAYLOAD, media: { renderer: SJT_RENDERER, question: 7 } })).toBeNull()
    expect(specFromPayload({ ...PAYLOAD, stem: null })).toBeNull()
    expect(specFromPayload({ ...PAYLOAD, options: null })).toBeNull()
    expect(specFromPayload({ ...PAYLOAD, options: RESPONSES.slice(0, 3) })).toBeNull()
  })

  it('carries nothing but the three fields of the spec', () => {
    // a payload that carried a key by mistake still gives a spec of three fields
    const media = { renderer: SJT_RENDERER, question: SPEC.question, key: [4, 2, 1, 1.5] }
    const spec = specFromPayload({ ...PAYLOAD, media })
    expect(Object.keys(spec ?? {}).sort()).toEqual(['question', 'responses', 'scenario'])
    expect(JSON.stringify(spec)).not.toContain('1.5')
  })
})

describe('the guards of an answer', () => {
  it('isRatingLevel is an integer from 1 to 4', () => {
    for (const ok of [1, 2, 3, 4]) expect(isRatingLevel(ok), String(ok)).toBe(true)
    for (const bad of [0, 5, 2.5, -1, NaN, Infinity, '3', null, undefined, true]) expect(isRatingLevel(bad), String(bad)).toBe(false)
  })

  it('isSjtRatings is four ratings, in an array', () => {
    expect(isSjtRatings([4, 2, 1, 3])).toBe(true)
    expect(isSjtRatings([4, 2, 1])).toBe(false)
    expect(isSjtRatings([4, 2, 1, 3, 3])).toBe(false)
    expect(isSjtRatings([4, 2, 1, 5])).toBe(false)
    expect(isSjtRatings([4, 2, 1, 2.5])).toBe(false)
    expect(isSjtRatings({ most: 0, least: 1 })).toBe(false)
    expect(isSjtRatings('4213')).toBe(false)
    expect(isSjtRatings(null)).toBe(false)
  })

  it('isMostLeast is two different positions among the responses', () => {
    expect(isMostLeast({ most: 0, least: 3 })).toBe(true)
    expect(isMostLeast({ most: 2, least: 2 })).toBe(false)
    expect(isMostLeast({ most: 0, least: 4 })).toBe(false)
    expect(isMostLeast({ most: -1, least: 1 })).toBe(false)
    expect(isMostLeast({ most: 0.5, least: 1 })).toBe(false)
    expect(isMostLeast({ most: 0 })).toBe(false)
    expect(isMostLeast([0, 1])).toBe(false)
    expect(isMostLeast(null)).toBe(false)
    expect(isMostLeast({ most: 0, least: 5 }, 6)).toBe(true)
  })

  it('exactly one of the two guards holds for any answer built from the other', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 4 }), { minLength: 4, maxLength: 4 }), fc.integer({ min: 0, max: 3 }), fc.integer({ min: 1, max: 3 }), (ratings, most, step) => {
        const choice = { most, least: (most + step) % 4 }
        expect(isSjtRatings(ratings) && !isMostLeast(ratings)).toBe(true)
        expect(isMostLeast(choice) && !isSjtRatings(choice)).toBe(true)
      }),
    )
  })
})
