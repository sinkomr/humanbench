/**
 * Display paragraphs of a reading passage (web/UX-REVIEW.md D11 option A, a provisional default;
 * ROADMAP A14): a long authored paragraph is drawn as pieces of about 120 words, cut only between
 * sentences, with the words and their order unchanged. Property tests (fast-check) on generated
 * paragraphs, and every passage of the runtime bank.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import raw from '../../tasks/reading/passages.render.json'
import { countPassageWords, passageText } from '../../tasks/reading/text'
import type { RenderBankFile } from '../../tasks/reading/types'
import { ABBREVIATIONS, LONGEST_WORDS, SHORTEST_WORDS, SPLIT_ABOVE_WORDS, TARGET_WORDS, splitParagraph, splitParagraphs } from './split'

const BANK = raw as RenderBankFile
const words = (s: string): number => countPassageWords(s)
/** `n` filler words that have no stop and no capital. */
const filler = (n: number): string => Array.from({ length: n }, (_, i) => `w${'abcdefghij'[i % 10]}`).join(' ')
/** One sentence of exactly `n` words (n >= 3), opening with a capital. */
const sentence = (n: number): string => `Start ${filler(n - 2)} end.`

/** A lower-case word that is not an abbreviation, so a generated sentence end really is one. */
const wordArb = fc
  .stringMatching(/^[a-z]{2,9}$/)
  .filter((w) => !ABBREVIATIONS.has(w) && !ABBREVIATIONS.has(w.charAt(0).toUpperCase() + w.slice(1)))

/** Things inside a sentence that must never be a cut: stops after abbreviations and initials, semicolons, colons, dashes. */
const innerArb = fc.constantFrom(
  'Mrs. C. was busy',
  'near St. Vrain Canyon',
  'with Dr. Brown and Lieut. Maury',
  'said J. S. Mill',
  'in the U.S. Army',
  'at five p.m. on Tuesday',
  'i.e. the third',
  'Mr. and Mrs. Smith',
  'Capt. Hall',
  'they went; and Smith followed',
  'it is so: Brown knew',
  'parts:--the pieces',
  'the horse--Black Jack',
)

/** One sentence of 3 to `maxWords` words (WORD RULE) with inner fragments, an opening quote or bracket and a closing stop. */
function sentenceArb(maxWords: number): fc.Arbitrary<string> {
  const maxItems = Math.max(3, Math.floor((maxWords - 1) / 2))
  return fc
    .record({
      head: wordArb,
      body: fc.array(fc.oneof({ weight: 8, arbitrary: wordArb }, { weight: 1, arbitrary: innerArb }), { minLength: 2, maxLength: maxItems }),
      punct: fc.constantFrom('.', '!', '?', '."', '.)', '!"', '.”', '?’'),
      open: fc.constantFrom('', '', '', '"', '(', '“', '‘'),
      commas: fc.array(fc.boolean(), { minLength: maxItems + 1, maxLength: maxItems + 1 }),
    })
    .map(({ head, body, punct, open, commas }) => {
      const parts = [head.charAt(0).toUpperCase() + head.slice(1), ...body]
      // Commas inside the sentence, never on its last token (a comma there would hide the stop).
      const text = parts.map((w, i) => (commas[i] && i < parts.length - 1 ? `${w},` : w)).join(' ')
      return `${open}${text}${punct}`
    })
    .filter((sentence) => words(sentence) <= maxWords)
}

describe('splitParagraph', () => {
  it('draws a paragraph of at most 150 words as it is', () => {
    fc.assert(
      fc.property(fc.array(sentenceArb(30), { minLength: 1, maxLength: 12 }), (sentences) => {
        const para = sentences.join(' ')
        fc.pre(words(para) <= SPLIT_ABOVE_WORDS)
        expect(splitParagraph(para)).toEqual([para])
      }),
      { numRuns: 200 },
    )
  })

  it('pieces joined by single spaces are the paragraph; none over 160 words, none under 40; always cut between sentences', () => {
    fc.assert(
      fc.property(fc.array(sentenceArb(60), { minLength: 1, maxLength: 24 }), (sentences) => {
        const para = sentences.join(' ')
        const pieces = splitParagraph(para)
        expect(pieces.join(' ')).toBe(para)
        // The real sentence ends of the paragraph, as character offsets of the cuts.
        const ends = new Set<number>()
        let at = 0
        for (const s of sentences.slice(0, -1)) {
          at += s.length
          ends.add(at)
          at += 1
        }
        let pos = 0
        for (const [i, piece] of pieces.entries()) {
          pos += piece.length
          if (i < pieces.length - 1) expect(ends.has(pos), `cut at ${pos} is not the end of a generated sentence: ...${piece.slice(-40)}`).toBe(true)
          pos += 1
        }
        if (words(para) <= SPLIT_ABOVE_WORDS) {
          expect(pieces).toEqual([para])
          return
        }
        // Sentences of at most 60 words always allow a cut set within 40 and 150 words, and the cut set found has it.
        expect(pieces.length).toBeGreaterThanOrEqual(2)
        for (const piece of pieces) {
          expect(words(piece)).toBeLessThanOrEqual(160)
          expect(words(piece)).toBeLessThanOrEqual(LONGEST_WORDS)
          expect(words(piece)).toBeGreaterThanOrEqual(SHORTEST_WORDS)
        }
      }),
      { numRuns: 300 },
    )
  })

  it('is deterministic and keeps the word count, and a piece never starts a sentence with a lower-case letter', () => {
    fc.assert(
      fc.property(fc.array(sentenceArb(50), { minLength: 4, maxLength: 20 }), (sentences) => {
        const para = sentences.join(' ')
        const a = splitParagraph(para)
        expect(splitParagraph(para)).toEqual(a)
        expect(a.reduce((n, p) => n + words(p), 0)).toBe(words(para))
        for (const piece of a.slice(1)) expect(piece.replace(/^[‘“"'(]+/, '')).toMatch(/^[A-Z]/)
      }),
      { numRuns: 150 },
    )
  })

  it('pieces stay near 120 words: the mean piece of a long paragraph is within 40 words of the target', () => {
    fc.assert(
      fc.property(fc.array(sentenceArb(30), { minLength: 25, maxLength: 60 }), (sentences) => {
        const para = sentences.join(' ')
        fc.pre(words(para) > 400)
        const pieces = splitParagraph(para)
        const mean = words(para) / pieces.length
        expect(Math.abs(mean - TARGET_WORDS)).toBeLessThanOrEqual(40)
      }),
      { numRuns: 100 },
    )
  })

  it('returns arbitrary text as it is joined back, even with double spaces, newlines and no stops at all', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 800 }), (text) => {
        expect(splitParagraph(text).join(' ')).toBe(text)
      }),
      { numRuns: 300 },
    )
    const odd = `${'word '.repeat(200)}end.  Next   one.\n${'more '.repeat(60)}done.`
    expect(splitParagraph(odd).join(' ')).toBe(odd)
  })

  it('does not cut after an abbreviation, an initial or dotted letters', () => {
    // A cut after the abbreviation would be the best one by size (121 words before it, then 78), but it is not the end of a sentence.
    for (const abbr of ['St.', 'Mrs.', 'Dr.', 'Lieut.', 'J.', 'C.', 'U.S.', 'p.m.']) {
      const para = `The road ran ${filler(116)} to ${abbr} Vrain and on. Then it rained for a long time over all the hills. ${filler(60)} and so it ended.`
      const pieces = splitParagraph(para)
      expect(pieces.join(' '), abbr).toBe(para)
      expect(pieces, abbr).toHaveLength(2)
      expect(pieces[0], abbr).toMatch(/Vrain and on\.$/)
      expect(pieces[1], abbr).toMatch(/^Then it rained/)
    }
  })

  it('cuts after "I." at a sentence end, where I is the pronoun, and after "etc." before a capital', () => {
    const a = `${filler(116)} and so did I. The ${filler(115)} and so on.`
    expect(splitParagraph(a).map((x) => words(x))).toEqual([120, 119])
    expect(splitParagraph(a)[0]).toMatch(/so did I\.$/)
    const b = `${filler(116)} and so on, etc. The ${filler(115)} and so it was.`
    expect(splitParagraph(b)[0]).toMatch(/etc\.$/)
    expect(splitParagraph(b)).toHaveLength(2)
  })

  it('never cuts at a semicolon, colon, comma or dash: a long semicolon-led sentence stays in one piece', () => {
    const semi = (clauses: number): string => `${Array.from({ length: clauses }, (_, k) => `${k === 0 ? 'The' : 'the'} ${'clause '.repeat(9)}number${k}`).join('; ')}.`
    const long = semi(16)
    expect(words(long)).toBeGreaterThan(SPLIT_ABOVE_WORDS)
    expect(splitParagraph(long)).toEqual([long])
    // Two such sentences of 88 words: the one cut is between them, not at any of their 14 semicolons.
    expect(splitParagraph(`${semi(8)} ${semi(8)}`)).toEqual([semi(8), semi(8)])
    // A long one after a short one: the cut falls between the two, and the long sentence is not broken to meet the limit.
    const first = sentence(60)
    expect(splitParagraph(`${first} ${long}`)).toEqual([first, long])
  })

  it('a paragraph with one sentence, or no capital after a stop, is not cut', () => {
    const one = `${'many '.repeat(300)}words.`
    expect(splitParagraph(one)).toEqual([one])
    const lower = `${'many '.repeat(100)}words. ${'more '.repeat(100)}here.`
    expect(splitParagraph(lower)).toEqual([lower])
  })

  it('takes the cut set that breaks the limits least when none meets them, and breaks no sentence', () => {
    // 140 + 30 words: whole is 20 over 150, split leaves 10 under 40. Either way the words are the same and no sentence is cut.
    const para = `${sentence(140)} ${sentence(30)}`
    expect(splitParagraph(para).join(' ')).toBe(para)
    expect(splitParagraph(para)).toEqual([sentence(140), sentence(30)])
    // One sentence of 200 words stays whole, so a piece may then be over the limit.
    const big = sentence(200)
    expect(splitParagraph(big)).toEqual([big])
  })

  it('handles empty text and a text of one word', () => {
    expect(splitParagraph('')).toEqual([''])
    expect(splitParagraph('Word.')).toEqual(['Word.'])
  })
})

describe('splitParagraphs', () => {
  it('keeps the order and the words of a passage, and cuts nothing short', () => {
    const paras = ['Short one here.', `${'Sentence number one is here. '.repeat(40)}`.trim(), 'Last.']
    const out = splitParagraphs(paras)
    expect(out[0]).toBe(paras[0])
    expect(out.at(-1)).toBe('Last.')
    expect(out.join(' ')).toBe(paras.join(' '))
    expect(out.length).toBeGreaterThan(paras.length)
  })
})

/** Piece sizes of the runtime bank, pinned: a change of the rule or of a passage shows up here. */
const PIECES: Readonly<Record<string, readonly (readonly number[])[]>> = {
  'franklin-autobiography-1868': [[125, 91], [105], [41]],
  'darwin-beagle-1845': [[136, 111, 116]],
  'dana-hide-curing-1840': [[125, 122, 107]],
  'faraday-candle-1861': [
    [91, 119],
    [91, 64],
  ],
  'huxley-chalk-1870': [[117], [46], [44], [71], [69]],
  'bird-rocky-mountains-1879': [[80, 113, 118], [43]],
  'twain-mississippi-1883': [[92], [63], [63], [110], [40]],
  'muir-sierra-snow-1894': [[102, 141], [87]],
}

describe('every passage of the runtime bank (passages.render.json)', () => {
  it('has the pinned list of passages', () => {
    expect(BANK.passages.map((p) => p.id).sort()).toEqual(Object.keys(PIECES).sort())
  })

  for (const p of BANK.passages) {
    it(`${p.id}: the display paragraphs hold the same words in the same order, and are 40 to 150 words`, () => {
      const shown = splitParagraphs(p.paragraphs)
      // Words and order unchanged: the passage text as drawn has the authored word count and the authored words.
      expect(shown.join(' ')).toBe(p.paragraphs.join(' '))
      expect(countPassageWords(passageText(shown))).toBe(p.word_count)
      expect(countPassageWords(passageText(p.paragraphs))).toBe(p.word_count)
      // A paragraph of at most 150 words is not touched; a longer one is cut into at least two pieces of 40 to 150 words,
      // each ending at the end of a sentence and the next opening with a capital.
      for (const para of p.paragraphs) {
        const pieces = splitParagraph(para)
        if (words(para) <= SPLIT_ABOVE_WORDS) {
          expect(pieces).toEqual([para])
          continue
        }
        expect(pieces.length).toBeGreaterThanOrEqual(2)
        for (const piece of pieces) {
          expect(words(piece), piece.slice(0, 40)).toBeLessThanOrEqual(LONGEST_WORDS)
          expect(words(piece), piece.slice(0, 40)).toBeGreaterThanOrEqual(SHORTEST_WORDS)
        }
        for (const piece of pieces.slice(0, -1)) expect(piece).toMatch(/[.!?]['")’”]*$/)
        for (const piece of pieces.slice(1)) expect(piece.replace(/^[‘“"'(]+/, '')).toMatch(/^[A-Z]/)
      }
      expect(p.paragraphs.map((para) => splitParagraph(para).map((x) => words(x)))).toEqual(PIECES[p.id])
    })
  }

  it('no passage is left with a paragraph over 150 words, so none draws taller than 150 words of text', () => {
    for (const p of BANK.passages) for (const piece of splitParagraphs(p.paragraphs)) expect(words(piece)).toBeLessThanOrEqual(LONGEST_WORDS)
  })

  it('does not cut after Mrs., St. or an initial in the Bird passage', () => {
    const bird = BANK.passages.find((p) => p.id === 'bird-rocky-mountains-1879')
    const pieces = splitParagraph(bird?.paragraphs[0] ?? '')
    expect(pieces).toHaveLength(3)
    for (const piece of pieces) expect(piece).not.toMatch(/\b(?:Mrs|St|C)\.$/)
    // "Mrs. C. was busy" opens the second piece: the cut is at the end of "...might not return." and not inside it.
    expect(pieces[0]).toMatch(/that I might not return\.$/)
    expect(pieces[1]).toMatch(/^Mrs\. C\. was busy/)
    expect(pieces[0]).toContain('St. Vrain Canyon')
  })
})
