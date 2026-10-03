/** The emotion vignette spec and its stem split (ROADMAP M6.1; DESIGN §5.1, R-5.6.2). */

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { EMOTION_ITEM_TYPE, EMOTION_OPTIONS, EMOTION_RENDERER, isEmotionResponse, specFromPayload, specProblems, splitStem, type EmotionSpec } from './spec'

const OPTIONS = ['Anger', 'Joy', 'Pride', 'Fear', 'Sadness'] as const
const SPEC: EmotionSpec = { stem: 'Ada waits at the stop. The bus goes past. How is Ada most likely to feel?', options: OPTIONS }

describe('the names the bank and this renderer share', () => {
  it('are the renderer and item type of hb.emo.record', () => {
    expect(EMOTION_RENDERER).toBe('emotion_vignette_v1')
    expect(EMOTION_ITEM_TYPE).toBe('emotion_vignette_mc')
    expect(EMOTION_OPTIONS).toBe(5)
  })
})

describe('specProblems', () => {
  it('accepts five distinct options and a stem', () => {
    expect(specProblems(SPEC)).toEqual([])
  })

  it('names what is wrong', () => {
    expect(specProblems({ ...SPEC, stem: '  ' })).toEqual(['a vignette has a stem'])
    expect(specProblems({ ...SPEC, options: OPTIONS.slice(0, 4) })).toEqual(['a vignette has exactly 5 options'])
    expect(specProblems({ ...SPEC, options: [...OPTIONS.slice(0, 4), ' '] })).toEqual(['every option is a word'])
    expect(specProblems({ ...SPEC, options: ['Anger', 'anger', 'Pride', 'Fear', 'Sadness'] })).toEqual(['the options are distinct'])
  })
})

describe('specFromPayload', () => {
  it('takes the stem and the options of a served vignette', () => {
    expect(specFromPayload({ stem: SPEC.stem, media: { renderer: EMOTION_RENDERER }, options: OPTIONS })).toEqual(SPEC)
  })

  it('refuses another renderer, a missing part or a spec that cannot be drawn', () => {
    expect(specFromPayload({ stem: SPEC.stem, media: { renderer: 'fermi_v1' }, options: OPTIONS })).toBeNull()
    expect(specFromPayload({ stem: SPEC.stem, media: null, options: OPTIONS })).toBeNull()
    expect(specFromPayload({ stem: null, media: { renderer: EMOTION_RENDERER }, options: OPTIONS })).toBeNull()
    expect(specFromPayload({ stem: SPEC.stem, media: { renderer: EMOTION_RENDERER }, options: null })).toBeNull()
    expect(specFromPayload({ stem: SPEC.stem, media: { renderer: EMOTION_RENDERER }, options: OPTIONS.slice(1) })).toBeNull()
  })
})

describe('splitStem', () => {
  it('separates the closing question from the scenario', () => {
    expect(splitStem(SPEC.stem)).toEqual({ scenario: 'Ada waits at the stop. The bus goes past.', question: 'How is Ada most likely to feel?' })
    expect(splitStem('A scene. How does Lan Anh most likely feel?').question).toBe('How does Lan Anh most likely feel?')
    expect(splitStem("Jo-Ann's day. How is Mary-Jane O'Neil most likely to feel?").question).toBe("How is Mary-Jane O'Neil most likely to feel?")
  })

  it('takes a stem without the question as all scenario', () => {
    expect(splitStem(' Just a scene. ')).toEqual({ scenario: 'Just a scene.', question: null })
    expect(splitStem('How is it going? A scene.').question).toBeNull()
  })

  it('loses nothing: scenario and question put back together are the stem', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Z][a-z ,.']{5,60}[.]$/), fc.stringMatching(/^[A-Z][a-z]{2,10}$/), (scenario, name) => {
        const stem = `${scenario} How is ${name} most likely to feel?`
        const { scenario: s, question } = splitStem(stem)
        expect(`${s} ${question}`).toBe(stem)
      }),
    )
  })
})

describe('isEmotionResponse', () => {
  it('is a display position among the options', () => {
    for (const ok of [0, 1, 4]) expect(isEmotionResponse(ok)).toBe(true)
    for (const bad of [-1, 5, 1.5, NaN, '1', null, undefined]) expect(isEmotionResponse(bad)).toBe(false)
    expect(isEmotionResponse(2, 3)).toBe(true)
    expect(isEmotionResponse(3, 3)).toBe(false)
  })
})
