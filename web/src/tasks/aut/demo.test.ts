import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DEMO_NOTE, DEMO_OBJECTS, demoAutItem, parseEmbedderChoice, parseSeconds } from './demo'
import { PROMPT_NORMS_V0 } from './params'
import { AUT_MAX_SECONDS, AUT_MIN_SECONDS, specProblems } from './spec'

describe('the practice prompts of the demo page (M6.4)', () => {
  it('are the two classic public objects, the ones the prompt norms are keyed on', () => {
    expect([...DEMO_OBJECTS]).toEqual(['brick', 'paperclip'])
    for (const o of DEMO_OBJECTS) expect(Object.hasOwn(PROMPT_NORMS_V0, o)).toBe(true)
    expect(DEMO_NOTE).toBe('A practice object for this page.')
  })

  it('are seeded: the same seed gives the same prompt, with an id that cannot be a bank id', () => {
    for (const seed of [1, 2, 'x', 'a-b', 12345]) {
      const a = demoAutItem(seed)
      expect(demoAutItem(seed)).toEqual(a)
      expect(a.item_id).toBe(`demo:aut:${String(seed)}`)
      expect(DEMO_OBJECTS).toContain(a.spec.object)
      expect(a.spec.seconds).toBe(90)
      expect(specProblems(a.spec)).toEqual([])
    }
  })

  it('reach both objects across seeds', () => {
    const seen = new Set(Array.from({ length: 30 }, (_, i) => demoAutItem(i + 1).spec.object))
    expect(seen).toEqual(new Set(DEMO_OBJECTS))
  })

  it('take the round length the page was given', () => {
    expect(demoAutItem(1, 5).spec.seconds).toBe(5)
    expect(demoAutItem(1, 30).spec.object).toBe(demoAutItem(1).spec.object)
  })
})

describe('parseSeconds (?seconds=N, dev only)', () => {
  it('takes a whole number, at least 5 and at most 600', () => {
    expect(parseSeconds('5')).toBe(5)
    expect(parseSeconds('30')).toBe(30)
    expect(parseSeconds(' 45 ')).toBe(45)
    expect(parseSeconds('600')).toBe(600)
    expect(parseSeconds('1')).toBe(AUT_MIN_SECONDS)
    expect(parseSeconds('0')).toBe(AUT_MIN_SECONDS)
    expect(parseSeconds('4')).toBe(5)
    expect(parseSeconds('9999')).toBe(AUT_MAX_SECONDS)
  })

  it('gives null (the default round) for anything else', () => {
    for (const raw of [null, undefined, '', ' ', 'abc', '-5', '1.5', '5s', '1e3', '0x10', '1234567']) expect(parseSeconds(raw), String(raw)).toBeNull()
  })

  it('always gives a valid round length or null (property)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 12 }), (raw) => {
        const s = parseSeconds(raw)
        if (s !== null) {
          expect(Number.isInteger(s)).toBe(true)
          expect(s).toBeGreaterThanOrEqual(AUT_MIN_SECONDS)
          expect(s).toBeLessThanOrEqual(AUT_MAX_SECONDS)
        }
      }),
    )
  })
})

describe('parseEmbedderChoice (?embedder=)', () => {
  it('is the test stand-in only for exactly "mock"', () => {
    expect(parseEmbedderChoice('mock')).toBe('mock')
    for (const raw of [null, undefined, '', 'minilm', 'Mock', 'mock ', 'other']) expect(parseEmbedderChoice(raw), String(raw)).toBe('minilm')
  })
})
