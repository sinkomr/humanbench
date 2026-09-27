import { describe, expect, it } from 'vitest'
import { MAX_WORDS, MIN_PASSAGES, MIN_WORDS, PASSAGES, READING_BANK, bankProblems, countPassageWords, passageText, verifyPassage } from '.'

/**
 * Pinned word counts (WORD RULE, `text.ts`): a change to the rule or to a passage shows up here
 * and must be mirrored in the bank's Python twin (`hb.gen.reading`), which pins the same numbers.
 */
const PINNED_WORDS: Readonly<Record<string, number>> = {
  'franklin-autobiography-1791': 362,
  'darwin-beagle-1839': 363,
  'dana-hide-curing-1840': 354,
  'faraday-candle-1861': 365,
  'huxley-chalk-1870': 347,
  'bird-rocky-mountains-1879': 354,
  'twain-mississippi-1883': 368,
  'muir-sierra-snow-1894': 330,
}

describe('passage bank (A14, ROADMAP M1.12)', () => {
  it('is valid: every passage passes verifyPassage, ids and texts are unique', () => {
    expect(bankProblems()).toEqual([])
    for (const p of PASSAGES) expect(verifyPassage(p).reason, p.id).toBe('ok')
  })

  it(`holds ≥ ${MIN_PASSAGES} passages of ${MIN_WORDS}–${MAX_WORDS} words, with the pinned counts`, () => {
    expect(READING_BANK.version).toBe('reading-passages-v1')
    expect(PASSAGES.length).toBeGreaterThanOrEqual(MIN_PASSAGES)
    const counts = Object.fromEntries(PASSAGES.map((p) => [p.id, countPassageWords(passageText(p.paragraphs))]))
    expect(counts).toEqual(PINNED_WORDS)
  })

  it('draws on several authors and eras, all first published before 1928', () => {
    expect(new Set(PASSAGES.map((p) => p.source.author)).size).toBe(PASSAGES.length)
    expect(new Set(PASSAGES.map((p) => p.source.era)).size).toBeGreaterThanOrEqual(5)
    for (const p of PASSAGES) expect(p.source.year).toBeLessThan(1928)
  })

  it('balances the authored key positions and does not favour the longest option', () => {
    const qs = PASSAGES.flatMap((p) => p.questions)
    const byIndex = [0, 1, 2, 3].map((k) => qs.filter((q) => q.key_index === k).length)
    for (const c of byIndex) expect(c).toBeGreaterThanOrEqual(Math.floor(qs.length / 4) - 1)
    const uniqueLongest = qs.filter((q) => {
      const lens = q.options.map((o) => o.length)
      const max = Math.max(...lens)
      return lens[q.key_index] === max && lens.filter((l) => l === max).length === 1
    }).length
    const uniqueShortest = qs.filter((q) => {
      const lens = q.options.map((o) => o.length)
      const min = Math.min(...lens)
      return lens[q.key_index] === min && lens.filter((l) => l === min).length === 1
    }).length
    expect(uniqueLongest).toBeLessThanOrEqual(qs.length / 3)
    expect(uniqueShortest).toBeLessThanOrEqual(qs.length / 3)
  })

  it('each evidence span occurs in its passage and mentions no other option verbatim', () => {
    for (const p of PASSAGES) {
      const text = passageText(p.paragraphs)
      for (const q of p.questions) {
        expect(text.includes(q.evidence_span), q.id).toBe(true)
        for (const [i, o] of q.options.entries()) {
          if (i !== q.key_index) expect(q.evidence_span.toLowerCase().includes(o.toLowerCase()), `${q.id}: ${o}`).toBe(false)
        }
      }
    }
  })

  it('records where each excerpt came from (A14: header stripped, provenance kept)', () => {
    for (const p of PASSAGES) {
      const s = p.source
      expect(s.url).toBe(`https://www.gutenberg.org/ebooks/${s.gutenberg_ebook}`)
      expect(s.text_url).toBe(`https://www.gutenberg.org/cache/epub/${s.gutenberg_ebook}/pg${s.gutenberg_ebook}.txt`)
      expect(s.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(p.paragraphs[0]?.startsWith(s.first_words)).toBe(true)
      expect(p.paragraphs.at(-1)?.endsWith(s.last_words)).toBe(true)
    }
  })
})
