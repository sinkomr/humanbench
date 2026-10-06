import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  AUT_DEFAULT_SECONDS,
  AUT_ITEM_TYPE,
  AUT_MAX_IDEAS,
  AUT_MAX_SECONDS,
  AUT_MIN_SECONDS,
  AUT_RENDERER,
  autSpec,
  isAutResponse,
  secondsOf,
  specFromPayload,
  specProblems,
} from './spec'
import { cleanResponse, personalInfo } from './text'

describe('the constants of the unusual uses spec (M6.4)', () => {
  it('names the item type and the renderer as the bank does', () => {
    expect(AUT_ITEM_TYPE).toBe('aut_prompt')
    expect(AUT_RENDERER).toBe('aut_v1')
  })

  it('has a 90 s round by default (DESIGN §5.4)', () => {
    expect(AUT_DEFAULT_SECONDS).toBe(90)
    expect(autSpec('brick')).toEqual({ object: 'brick', seconds: 90 })
    expect(autSpec('brick', 30)).toEqual({ object: 'brick', seconds: 30 })
  })
})

describe('specProblems / specFromPayload', () => {
  it('accepts an everyday object and a round length in range', () => {
    expect(specProblems({ object: 'paperclip', seconds: 90 })).toEqual([])
    expect(specProblems({ object: 'brick', seconds: AUT_MIN_SECONDS })).toEqual([])
    expect(specProblems({ object: 'brick', seconds: AUT_MAX_SECONDS })).toEqual([])
  })

  it('rejects an object that is empty, padded, too long or not text, and a length out of range or not whole', () => {
    for (const object of ['', ' ', ' brick', 'brick ', 'a'.repeat(41), 'two\nlines', 'double  space', 7, null, undefined]) {
      expect(specProblems({ object, seconds: 90 }).length, String(object)).toBeGreaterThan(0)
    }
    for (const seconds of [0, 4, 601, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '90', null, undefined]) {
      expect(specProblems({ object: 'brick', seconds }).length, String(seconds)).toBeGreaterThan(0)
    }
  })

  it('reads a served payload: the renderer name, the object, and 90 s when the payload gives none', () => {
    expect(specFromPayload({ media: { renderer: 'aut_v1', object: 'brick' } })).toEqual({ object: 'brick', seconds: 90 })
    expect(specFromPayload({ media: { renderer: 'aut_v1', object: 'brick', seconds: 60 }, options: null })).toEqual({ object: 'brick', seconds: 60 })
  })

  it('reads nothing from another renderer, from options, or from a payload that cannot be drawn', () => {
    expect(specFromPayload({ media: null })).toBeNull()
    expect(specFromPayload({ media: { renderer: 'rat_triad_v1', object: 'brick' } })).toBeNull()
    expect(specFromPayload({ media: { renderer: 'aut_v1', object: 'brick' }, options: ['a'] })).toBeNull()
    expect(specFromPayload({ media: { renderer: 'aut_v1' } })).toBeNull()
    expect(specFromPayload({ media: { renderer: 'aut_v1', object: 'brick', seconds: 2 } })).toBeNull()
  })
})

describe('secondsOf', () => {
  it('is the spec length when usable, else 90', () => {
    expect(secondsOf({ seconds: 45 })).toBe(45)
    expect(secondsOf({ seconds: 2 })).toBe(2)
    for (const seconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '90', undefined, null]) expect(secondsOf({ seconds }), String(seconds)).toBe(90)
  })
})

describe('isAutResponse', () => {
  it('accepts cleaned, contact-free ideas and a finite duration', () => {
    expect(isAutResponse({ responses: [], elapsedMs: 0 })).toBe(true)
    expect(isAutResponse({ responses: ['prop open a door', 'bookend'], elapsedMs: 89_999.5 })).toBe(true)
  })

  it('rejects an idea that is empty, not cleaned, or looks like contact details', () => {
    for (const bad of ['', ' padded ', 'two  spaces', 'tab\there', 'zero​width', 'mail jo@example.com', 'call 555 123 4567', 'x'.repeat(121)]) {
      expect(isAutResponse({ responses: [bad], elapsedMs: 1 }), JSON.stringify(bad)).toBe(false)
    }
  })

  it('rejects more ideas than the cap, a bad duration, and anything that is not the shape', () => {
    expect(isAutResponse({ responses: Array.from({ length: AUT_MAX_IDEAS }, (_, i) => `idea ${i}`), elapsedMs: 1 })).toBe(true)
    expect(isAutResponse({ responses: Array.from({ length: AUT_MAX_IDEAS + 1 }, (_, i) => `idea ${i}`), elapsedMs: 1 })).toBe(false)
    for (const elapsedMs of [-1, Number.NaN, Number.POSITIVE_INFINITY, '5', undefined]) expect(isAutResponse({ responses: [], elapsedMs }), String(elapsedMs)).toBe(false)
    for (const v of [null, undefined, 'x', 3, [], {}, { responses: 'a', elapsedMs: 1 }, { responses: [1], elapsedMs: 1 }]) expect(isAutResponse(v), JSON.stringify(v)).toBe(false)
  })

  it('agrees with the cleaning and the personal-info check on any text (property)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (raw) => {
        const idea = cleanResponse(raw)
        const expected = idea !== '' && personalInfo(idea).length === 0
        expect(isAutResponse({ responses: [idea], elapsedMs: 0 })).toBe(expected)
      }),
      { numRuns: 300 },
    )
  })
})
