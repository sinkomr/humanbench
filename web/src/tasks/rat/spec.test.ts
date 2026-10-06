/** The word-links payload, spec and response checks (ROADMAP M6.3; DESIGN §5.4). */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { MAX_ANSWER_CHARS, RAT_ITEM_TYPE, RAT_RENDERER, isRatResponse, specFromPayload, specProblems, type RatPayload } from './spec'

const PAYLOAD: RatPayload = {
  stem: 'cottage / swiss / cake',
  media: { renderer: RAT_RENDERER, cues: ['cottage', 'swiss', 'cake'] },
  options: null,
}

describe('the contract with the bank', () => {
  it('names the item type and the renderer as hb.rat does', () => {
    expect(RAT_ITEM_TYPE).toBe('rat_triad')
    expect(RAT_RENDERER).toBe('rat_triad_v1')
    expect(MAX_ANSWER_CHARS).toBe(40)
  })
})

describe('specFromPayload', () => {
  it('reads the cues of media, in order', () => {
    expect(specFromPayload(PAYLOAD)).toEqual({ cues: ['cottage', 'swiss', 'cake'] })
  })

  it('takes the cues from media only: the stem is informational and need not agree', () => {
    expect(specFromPayload({ ...PAYLOAD, stem: null })).toEqual({ cues: ['cottage', 'swiss', 'cake'] })
    expect(specFromPayload({ ...PAYLOAD, stem: 'a / b / c' })).toEqual({ cues: ['cottage', 'swiss', 'cake'] })
    expect(specFromPayload({ media: PAYLOAD.media })).toEqual({ cues: ['cottage', 'swiss', 'cake'] })
  })

  it('returns a spec of the cues alone: nothing else of the payload is carried over', () => {
    const spec = specFromPayload({ ...PAYLOAD, media: { ...PAYLOAD.media, solution: 'cheese', accept: ['cheese'] } as RatPayload['media'] })
    expect(Object.keys(spec ?? {})).toEqual(['cues'])
    expect(JSON.stringify(spec)).not.toMatch(/cheese|solution|accept|key/i)
  })

  it('rejects another renderer, no media, or media without a renderer', () => {
    expect(specFromPayload({ ...PAYLOAD, media: { renderer: 'emotion_vignette_v1', cues: ['a', 'b', 'c'] } })).toBeNull()
    expect(specFromPayload({ ...PAYLOAD, media: null })).toBeNull()
    expect(specFromPayload({ ...PAYLOAD, media: { cues: ['cottage', 'swiss', 'cake'] } })).toBeNull()
  })

  it('rejects options: a triad has none', () => {
    expect(specFromPayload({ ...PAYLOAD, options: ['cheese', 'brush'] })).toBeNull()
    expect(specFromPayload({ ...PAYLOAD, options: [] })).toBeNull()
  })

  it('rejects cues that are not exactly three words of text', () => {
    const bad: unknown[] = [undefined, null, 'cottage', ['cottage', 'swiss'], ['cottage', 'swiss', 'cake', 'sun'], ['cottage', 'swiss', 7], ['cottage', 'swiss', null], [['a'], 'b', 'c'], {}]
    for (const cues of bad) expect(specFromPayload({ ...PAYLOAD, media: { renderer: RAT_RENDERER, cues } }), JSON.stringify(cues)).toBeNull()
  })

  it('rejects cues that are not lowercase, are empty, padded or repeated', () => {
    const bad = [['Cottage', 'swiss', 'cake'], ['cottage', '', 'cake'], ['cottage', ' swiss', 'cake'], ['cottage', 'swiss ', 'cake'], ['cottage', 'cake', 'cake'], ['cottage', 'cake', 'ca-ke'], ['cottage', '12', 'cake'], ['cottage', '<b>', 'cake'], ['cottage', 'swiss', 'x'.repeat(31)]]
    for (const cues of bad) expect(specFromPayload({ ...PAYLOAD, media: { renderer: RAT_RENDERER, cues } }), JSON.stringify(cues)).toBeNull()
  })

  it('accepts a cue that is a short lowercase phrase', () => {
    expect(specFromPayload({ ...PAYLOAD, media: { renderer: RAT_RENDERER, cues: ['ice cream', "dog's", 'sea-side'] } })?.cues).toEqual(['ice cream', "dog's", 'sea-side'])
  })
})

describe('specProblems', () => {
  it('is empty for a spec that can be rendered', () => {
    expect(specProblems({ cues: ['cottage', 'swiss', 'cake'] })).toEqual([])
  })

  it('names what is wrong', () => {
    expect(specProblems({ cues: ['a', 'b'] })).toEqual(['a puzzle has exactly three cues'])
    expect(specProblems({})).toEqual(['a puzzle has exactly three cues'])
    expect(specProblems({ cues: [1, 2, 3] })).toEqual(['every cue is text'])
    expect(specProblems({ cues: ['Cottage', 'swiss', 'cake'] })).toEqual(['every cue is a lowercase word'])
    expect(specProblems({ cues: ['cake', 'Cake', 'sun'] })).toEqual(['every cue is a lowercase word', 'the cues are distinct'])
  })
})

describe('isRatResponse', () => {
  it('is true for text of 1 to 40 characters once trimmed', () => {
    expect(isRatResponse('cheese')).toBe(true)
    expect(isRatResponse('a')).toBe(true)
    expect(isRatResponse('  cheese  ')).toBe(true)
    expect(isRatResponse('x'.repeat(40))).toBe(true)
    expect(isRatResponse(` ${'x'.repeat(40)} `)).toBe(true)
  })

  it('is false for nothing, blank text, more than 40 characters, and anything that is not text', () => {
    for (const v of ['', ' ', ' \t\n', 'x'.repeat(41), undefined, null, 0, 7, true, ['cheese'], { word: 'cheese' }]) expect(isRatResponse(v), String(v)).toBe(false)
  })

  it('agrees with the length of the trimmed text', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 60 }), (t) => {
        const n = t.trim().length
        return isRatResponse(t) === (n >= 1 && n <= MAX_ANSWER_CHARS)
      }),
    )
  })
})
