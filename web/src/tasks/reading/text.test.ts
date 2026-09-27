import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  ALLOWED_TEXT_RE,
  BOILERPLATE_RE,
  countLetters,
  countPassageWords,
  countSentences,
  isCleanLine,
  optionForm,
  passageText,
} from './text'

describe('WORD RULE (wpm denominator)', () => {
  it.each([
    ['', 0],
    ['one', 1],
    ['one two  three', 3],
    ['well-known', 1],
    ['Yorkshire--a distance', 3],
    ['flame—for who', 3],
    ['1850–1860', 2],
    ['word -- word', 2],
    ['a --- b', 2],
    ['(which', 1],
    ["excus'd, and", 2],
    ['"grub," which', 2],
    ['7,500 feet', 2],
    ['-- , ; ! ?', 0],
    ['para one.\n\npara two.', 4],
  ])('%j has %i words', (text, n) => {
    expect(countPassageWords(text)).toBe(n)
  })

  it('counts k alphanumeric words joined by any mix of separators as k (property)', () => {
    const word = fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9',.;()"-]{0,8}$/).filter((w) => !w.includes('--') && !w.endsWith('-'))
    const sep = fc.constantFrom(' ', '\n', '\n\n', '--', ' -- ', '—', '–', ' — ', '---')
    fc.assert(
      fc.property(fc.array(fc.tuple(word, sep), { minLength: 1, maxLength: 40 }), (parts) => {
        const text = parts.map(([w, s], i) => (i === parts.length - 1 ? w : w + s)).join('')
        expect(countPassageWords(text)).toBe(parts.length)
      }),
      { numRuns: 500 },
    )
  })
})

describe('SENTENCE and LETTER rules (prior features)', () => {
  it.each([
    ['One. Two! Three?', 3],
    ['He said "go." Then left.', 2],
    ["the Great Sewer.' This", 1],
    ['Mrs. C. was busy.', 3],
    ['no end', 1],
    ['3.5 feet and 7,500.', 1],
    ['Wait... what?', 2],
  ])('%j has %i sentences', (text, n) => {
    expect(countSentences(text)).toBe(n)
  })

  it('counts ASCII letters only', () => {
    expect(countLetters("Ab c-d 12 e'f — é")).toBe(6)
  })
})

describe('charset, boilerplate and option form', () => {
  it('allows the passage punctuation and rejects markup, tabs and newlines', () => {
    expect(isCleanLine('It is, (he said) "fine"; well-known--yes: ‘a’ “b” – — ok? 7,500!')).toBe(true)
    for (const bad of ['_italic_', 'note [1]', 'a*b', 'x\ty', 'x\ny', ' lead', 'trail ', 'two  spaces', '', '#h', 'a/b', 'café']) {
      expect(isCleanLine(bad), bad).toBe(false)
    }
    expect(ALLOWED_TEXT_RE.test('')).toBe(true)
  })

  it('flags Gutenberg header, licence, credit and link text, but not ordinary prose', () => {
    for (const bad of [
      'The Project Gutenberg eBook of X',
      '*** START OF THE PROJECT',
      'This eBook is for the use of anyone',
      'an e-text of',
      'under the terms of the License',
      'the licence included',
      'Produced by Jane Doe',
      'para.\n\nProduced by Jane Doe',
      'Transcriber’s note',
      'see https://example.org',
      'www.gutenberg.org',
      'Copyright laws',
      'the Gutenberg trademark',
    ]) {
      expect(BOILERPLATE_RE.test(bad), bad).toBe(true)
    }
    for (const ok of [
      'the effect produced by the heat',
      'our illustrations',
      'a pretext for delay',
      'the context of the text',
      'at the start of the day',
      'the end of the project',
      'ebony and ivory',
    ]) {
      expect(BOILERPLATE_RE.test(ok), ok).toBe(false)
    }
  })

  it('compares options case- and space-insensitively', () => {
    expect(optionForm('  Fifteen   Feet ')).toBe('fifteen feet')
    expect(optionForm('A')).toBe(optionForm('a'))
  })

  it('joins paragraphs with a blank line', () => {
    expect(passageText(['a b', 'c'])).toBe('a b\n\nc')
  })
})
