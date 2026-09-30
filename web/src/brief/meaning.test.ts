/** The plain-words descriptions (AI.6): one per template, in ordinary words, with no claim of benefit. */

import { describe, expect, it } from 'vitest'
import { TEMPLATES } from './grammar'
import { lintLine } from './lint'
import { MEANING_IDS, genericMeaning, meaningOf } from './meaning'
import { BENEFIT_RE } from './testing'

describe('meaning', () => {
  it('has a description for every template, and none for anything else', () => {
    expect([...MEANING_IDS].sort()).toEqual(TEMPLATES.map((t) => t.id).sort())
    expect(meaningOf({ id: 'nope' })).toBeNull()
    expect(genericMeaning('nope')).toBeNull()
  })

  it('fills the slots of a line, and names them in general words for a list of line types', () => {
    expect(meaningOf({ id: 'DS', topics: ['quant/linear', 'kst/physics'] })).toBe('On linear equations and systems and physics: skip the basics and go straight to the method, mentioning a step only if it is unusual.')
    expect(meaningOf({ id: 'I1', interests: ['chess', 'jazz'] })).toBe('When the assistant needs an example, it draws on chess or jazz.')
    expect(genericMeaning('I1')).toBe('When the assistant needs an example, it draws on your interests.')
    expect(genericMeaning('X1')).toBe('Your own line: "your own words"')
  })

  it('uses no clinical word, no digit, no level or ability word, and never says or implies benefit', () => {
    for (const id of MEANING_IDS) {
      const t = genericMeaning(id) as string
      expect(lintLine(t).filter((h) => h.rule === 'a13' || h.rule === 'digit' || h.rule === 'ascii'), `${id}: ${t}`).toEqual([])
      expect(BENEFIT_RE.test(t), `${id}: ${t}`).toBe(false)
      expect(t.length, id).toBeLessThanOrEqual(220)
    }
  })
})
