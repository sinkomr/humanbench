/** Reading one written line back to its template (R-17.11). */

import { describe, expect, it } from 'vitest'
import { TEMPLATES, wording } from './grammar'
import { parseInterestList, joinInterests, isInterest } from './interests'
import { idsInForm, isTemplateLine, matchLine } from './match'
import { lineText } from './render'

describe('matchLine', () => {
  it('reads every template line back to its id (with slot values) in each form it is written in', () => {
    for (const t of TEMPLATES) {
      if (t.header === true || t.id === 'X1') continue
      for (const form of ['short', 'long', 'skill'] as const) {
        const line = { id: t.id, ...((t.long ?? '').includes('opics}') ? { topics: ['quant/linear', 'kst/physics'] } : {}), ...(t.id === 'I1' ? { interests: ['chess'] } : {}) }
        const text = lineText(line, form)
        if (text === null) continue
        const m = matchLine(text, form)
        expect(m?.line, `${t.id} ${form}`).toEqual(line)
        expect(m?.offForm, `${t.id} ${form}`).toBe(false)
      }
    }
  })

  it('flags a line written in the other form as off-form', () => {
    const longK1L = lineText({ id: 'K1L' }, 'long') as string
    expect(matchLine(longK1L, 'short')).toEqual({ line: { id: 'K1L' }, offForm: true })
    const da = lineText({ id: 'DA', topics: ['quant/linear'] }, 'long') as string
    expect(matchLine(da, 'short')?.offForm).toBe(true)
    expect(matchLine(da, 'skill')?.offForm).toBe(false)
  })

  it('refuses text that is not a template line, including a template with a wrong slot', () => {
    expect(matchLine('Use metric units.', 'long')).toBeNull()
    expect(matchLine('Cooking: skip the basics and go straight to the method. Mention a step only if it is unusual.', 'long')).toBeNull()
    expect(matchLine('Statistics and programming: skip the basics and go straight to the method. Mention a step only if it is unusual.', 'long')).toBeNull()
    expect(matchLine('When you need an example, use a, b, c or d.', 'long')).toBeNull()
    expect(matchLine('', 'long')).toBeNull()
  })

  it('recognises standard lines for the custom-line check', () => {
    expect(isTemplateLine('Tell me plainly when I\'m wrong.')).toBe(true)
    expect(isTemplateLine('Tell me gently when I\'m wrong.')).toBe(false)
  })

  it('lists the templates written in a form', () => {
    expect(idsInForm('short')).not.toContain('DA')
    expect(idsInForm('long')).toContain('DA')
    expect(idsInForm('short').length).toBeLessThan(idsInForm('long').length)
    expect(wording(TEMPLATES[0]!, 'long')).toBe(TEMPLATES[0]!.long)
  })
})

describe('interest lists', () => {
  it('write and read one, two and three interests', () => {
    for (const items of [['cooking'], ['cooking', 'football'], ['cooking', 'football', 'chess']]) {
      expect(parseInterestList(joinInterests(items))).toEqual(items)
    }
    expect(joinInterests(['a b', 'c'])).toBe('a b or c')
  })

  it('refuses lists of the wrong shape', () => {
    for (const s of ['', 'a, b', 'a and b', 'a or a', 'a, b, c, d or e', 'A or b', 'a or ', 'x, y or 5']) expect(parseInterestList(s), s).toBeNull()
    expect(isInterest('rock climbing')).toBe(true)
    expect(isInterest('rock or roll')).toBe(false)
    expect(isInterest('chess ')).toBe(false)
  })
})
