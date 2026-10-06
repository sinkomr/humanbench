/**
 * The word-links answer rule (ROADMAP M6.3; DESIGN §5.4): the key folds a text to the letters a-z, `matches` compares keys.
 * The bank's `hb.rat.answers` mirrors it; the shared golden vectors that pin the two belong to the parity package.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { answerKey, matches } from './answers'

describe('answerKey', () => {
  it('ignores case and the spaces, hyphens and apostrophes of a compound', () => {
    for (const t of ['cheesecake', 'Cheesecake', 'CHEESECAKE', 'cheese cake', 'Cheese-Cake ', "  cheese'cake", 'cheese\tcake\n']) expect(answerKey(t), t).toBe('cheesecake')
  })

  it('removes diacritics', () => {
    expect(answerKey('Chéese')).toBe('cheese')
    expect(answerKey('café')).toBe('cafe')
    expect(answerKey('naïve')).toBe('naive')
    expect(answerKey('crème brûlée')).toBe('cremebrulee')
    expect(answerKey('Cheesé')).toBe('cheese') // a combining acute written apart from its letter
    expect(answerKey('İstanbul')).toBe('istanbul') // dotted capital I
  })

  it('folds full-width letters and other compatibility forms to ASCII', () => {
    expect(answerKey('Ｃｈｅｅｓｅ')).toBe('cheese')
    expect(answerKey('ｃｈｅｅｓｅ　ｃａｋｅ')).toBe('cheesecake')
    expect(answerKey('ﬁsh')).toBe('fish') // the fi ligature
    expect(answerKey('Kite')).toBe('kite') // the Kelvin sign
  })

  it('drops digits, punctuation, symbols and emoji', () => {
    expect(answerKey('cheese2')).toBe('cheese')
    expect(answerKey('1234')).toBe('')
    expect(answerKey('cheese!?')).toBe('cheese')
    expect(answerKey('c.h.e.e.s.e')).toBe('cheese')
    expect(answerKey('cheese 🧀')).toBe('cheese')
    expect(answerKey('🧀')).toBe('')
    expect(answerKey('50% off')).toBe('off')
  })

  it('drops letters outside a-z that have no ASCII form, without failing', () => {
    expect(answerKey('straße')).toBe('strae')
    expect(answerKey('日本語')).toBe('')
    expect(answerKey('сыр')).toBe('')
    expect(answerKey('\ud800')).toBe('') // a lone surrogate
  })

  it('is empty for an empty or blank text', () => {
    expect(answerKey('')).toBe('')
    expect(answerKey(' \t\n ')).toBe('')
  })

  it('does not stem: a plural has its own key', () => {
    expect(answerKey('cheeses')).not.toBe(answerKey('cheese'))
  })

  describe('properties', () => {
    const texts = fc.oneof(fc.string({ unit: 'grapheme' }), fc.string({ unit: 'binary' }), fc.string({ unit: 'grapheme-ascii' }))

    it('is idempotent', () => {
      fc.assert(fc.property(texts, (t) => answerKey(answerKey(t)) === answerKey(t)))
    })

    it('yields only the letters a to z', () => {
      fc.assert(fc.property(texts, (t) => /^[a-z]*$/.test(answerKey(t))))
    })

    it('does not depend on case', () => {
      fc.assert(fc.property(fc.string({ unit: 'grapheme-ascii' }), (t) => answerKey(t.toUpperCase()) === answerKey(t) && answerKey(t.toLowerCase()) === answerKey(t)))
    })

    it('does not depend on the separators between the letters', () => {
      const parts = fc.array(fc.stringMatching(/^[a-zA-Z]{1,8}$/), { minLength: 1, maxLength: 4 })
      const seps = fc.constantFrom('', ' ', '-', "'", '  ', ' - ', '\t')
      fc.assert(fc.property(parts, seps, (ws, sep) => answerKey(ws.join(sep)) === answerKey(ws.join(''))))
    })

    it('keeps exactly the lowercased ASCII letters of an ASCII text, in order', () => {
      fc.assert(
        fc.property(fc.string({ unit: 'grapheme-ascii' }), (t) => {
          const kept = [...t.toLowerCase()].filter((c) => c >= 'a' && c <= 'z').join('')
          return answerKey(t) === kept
        }),
      )
    })
  })
})

describe('matches', () => {
  const accept = ['cheese']

  it('accepts the word however it is typed', () => {
    for (const t of ['cheese', 'Cheese', 'CHEESE', '  cheese  ', 'Chéese', 'ｃｈｅｅｓｅ', 'c-h-e-e-s-e', "che'ese"]) expect(matches(t, accept), t).toBe(true)
  })

  it('accepts a compound written with or without its space or hyphen', () => {
    const cake = ['cheesecake']
    for (const t of ['cheesecake', 'Cheese-Cake ', 'cheese cake', 'CHEESE CAKE']) expect(matches(t, cake), t).toBe(true)
  })

  it('does not accept another word, a plural, or a longer or shorter form', () => {
    for (const t of ['cheeses', 'chees', 'cheesy', 'cheese cake', 'brush', 'chese']) expect(matches(t, accept), t).toBe(false)
  })

  it('accepts any of several spellings, as listed by the key', () => {
    const grey = ['grey', 'gray']
    expect(matches('Gray', grey)).toBe(true)
    expect(matches('GREY', grey)).toBe(true)
    expect(matches('graye', grey)).toBe(false)
    expect(matches('gray', ['grey'])).toBe(false) // a variant the key does not list is not guessed
  })

  it('never accepts an empty answer, even when an accepted word has no letter', () => {
    for (const t of ['', ' ', '  \t', '123', '!!!', '🧀']) {
      expect(matches(t, accept), JSON.stringify(t)).toBe(false)
      expect(matches(t, ['', '42', '-']), JSON.stringify(t)).toBe(false)
    }
  })

  it('accepts nothing when there is nothing to accept', () => {
    expect(matches('cheese', [])).toBe(false)
  })

  it('reads the accepted words with the same key (their case and spacing do not matter)', () => {
    expect(matches('cheesecake', ['Cheese Cake'])).toBe(true)
    expect(matches('cheese cake', ['cheese-cake', 'cheesecake'])).toBe(true)
  })

  describe('properties', () => {
    const word = fc.stringMatching(/^[a-z]{1,10}$/)
    const variant = fc.string({ unit: 'grapheme-ascii' })

    it('is symmetric in the order of the accepted variants', () => {
      fc.assert(
        fc.property(variant, fc.array(variant, { maxLength: 5 }), (response, variants) => {
          const reversed = [...variants].reverse()
          return matches(response, variants) === matches(response, reversed)
        }),
      )
    })

    it('is symmetric between the response and an accepted word', () => {
      fc.assert(fc.property(variant, variant, (a, b) => matches(a, [b]) === matches(b, [a])))
    })

    it('is case-insensitive in the response and in the accepted words', () => {
      fc.assert(
        fc.property(variant, fc.array(variant, { maxLength: 4 }), (response, accepted) => {
          const base = matches(response, accepted)
          return matches(response.toUpperCase(), accepted) === base && matches(response, accepted.map((a) => a.toUpperCase())) === base
        }),
      )
    })

    it('accepts a word with itself, however it is padded, and never rejects it for the padding', () => {
      fc.assert(fc.property(word, fc.constantFrom('', ' ', '  ', '\t'), fc.constantFrom('', ' ', '\n'), (w, pre, post) => matches(`${pre}${w}${post}`, [w])))
    })

    it('never accepts a response that has no letter', () => {
      fc.assert(fc.property(fc.stringMatching(/^[^a-zA-Z]{0,12}$/), fc.array(variant, { maxLength: 4 }), (response, accepted) => answerKey(response) !== '' || !matches(response, accepted)))
    })
  })
})
