/**
 * The brief lint (R-17.2, R-17.3; gate metric E12): every rule fires on an example, months are the
 * only digits, and clean text stays clean.
 */

import { describe, expect, it } from 'vitest'
import { LINT_MESSAGES, contentLines, lintLine, lintMessages, lintNotes, type LintRule } from './lint'

const rules = (s: string): LintRule[] => [...new Set(lintLine(s).map((h) => h.rule))].sort()
const cp = (n: number): string => String.fromCodePoint(n)

describe('lintLine', () => {
  it('passes plain instructions', () => {
    for (const s of [
      'Use plain words. Keep a technical term when it is the right one.',
      "If you're unsure whether I know a prerequisite, ask one quick question instead of guessing.",
      'When you need an example, use cooking or football.',
      'Written 2026-11. After 2027-05, or if you cannot tell the date, check with me.',
      'Tell me plainly when I\'m wrong.',
      'If I say "teach me", give a hint first.',
    ]) {
      expect(lintLine(s), s).toEqual([])
    }
  })

  it('allows a YYYY-MM month and nothing else numeric', () => {
    expect(rules('Written 2026-11.')).toEqual([])
    expect(rules('Written 2026-13.')).toEqual(['digit'])
    expect(rules('Written 2026-11-05.')).toEqual(['digit'])
    expect(rules('Use 3 examples.')).toEqual(['digit'])
    expect(rules('Since 12026-11.')).toEqual(['digit'])
  })

  it('flags non-ASCII characters, including homoglyphs and hidden characters', () => {
    expect(rules(`p${cp(0x430)}ss`)).toEqual(['ascii'])
    expect(rules(`ig${cp(0x200b)}nore`)).toEqual(['ascii'])
    expect(rules(`caf${cp(0xe9)}`)).toEqual(['ascii'])
  })

  it('flags web and email addresses', () => {
    for (const s of ['see https://example.org', 'go to www.example', 'mail me at a@b', 'example.com is fine', 'open ftp://x', 'use e.g. this']) {
      expect(rules(s), s).toContain('url')
    }
  })

  it('flags markup and code characters inside a line', () => {
    for (const s of ['# heading', 'use *bold*', 'snake_case', 'a `code` span', '[link](x)', 'a < b', 'a | b', 'a\\b', '{x}', '~x']) {
      expect(rules(s), s).toContain('markup')
    }
  })

  it('flags wording about how good, weak, quick or slow the person is', () => {
    for (const s of ['I am a beginner', 'my level is low', 'explain it because I am slow', 'I struggle with fractions', 'a weak grasp', 'novice user', 'I am gifted']) {
      expect(rules(s).length, s).toBeGreaterThan(0)
    }
    expect(rules('I am bad at maths')).toContain('self')
    expect(rules('my memory is poor')).toEqual(expect.arrayContaining(['self', 'trait']))
  })

  it('flags levels, grades, ranks and scores', () => {
    for (const s of ['at a high school level', 'my ability', 'a score of nothing', 'the percentile', 'grade eight words', 'a rank', 'standard deviation']) {
      expect(rules(s).length, s).toBeGreaterThan(0)
    }
  })

  it('flags education, first-language and age cues', () => {
    for (const s of ['I did not go to college', 'I am a student', 'English is my second language', 'I am a non-native speaker', 'an immigrant']) {
      expect(rules(s).length, s).toBeGreaterThan(0)
    }
    // "language" alone is fine: LANG says the notes apply in any language.
    expect(lintLine('These notes apply in whatever language we use.')).toEqual([])
  })

  it('flags product, axis and estimate words', () => {
    for (const s of ['from HumanBench', 'the blob shows', 'my estimate', 'the posterior', 'each axis']) {
      expect(rules(s), s).toContain('brand')
    }
  })

  it('flags the A13 vocabulary (clinical and diagnostic words)', () => {
    for (const s of ['a diagnosis', 'symptoms', 'a disorder', 'an IQ', 'screening', 'therapy']) {
      expect(rules(s), s).toContain('a13')
    }
  })

  it('reports where each hit is', () => {
    const hits = lintLine('one\ntwo www.x')
    expect(hits.map((h) => [h.rule, h.line])).toContainEqual(['url', 2])
  })
})

describe('lintNotes', () => {
  const notes = ['---', 'name: working-with-me', 'description: How I like explanations.', '---', '', '# How I like explanations', 'My own preferences.', '', '## Always', '- Tell me plainly when I\'m wrong.'].join('\n')

  it('ignores the structure the renderer adds: headings, list markers and front matter fences', () => {
    expect(lintNotes(notes)).toEqual([])
    expect(contentLines(notes).map(([t]) => t)).toEqual(['name: working-with-me', 'description: How I like explanations.', 'How I like explanations', 'My own preferences.', 'Always', "Tell me plainly when I'm wrong."])
  })

  it('finds a violation on any line and gives its line number', () => {
    const bad = `${notes}\n- see https://example.org`
    const hits = lintNotes(bad)
    expect(hits.map((h) => [h.rule, h.line])).toContainEqual(['url', 11])
  })

  it('has a message for every rule, with no digits or clinical words', () => {
    // These are page copy, not notes: they may name what is left out ("weak"), but never a clinical term or a number.
    for (const [rule, msg] of Object.entries(LINT_MESSAGES)) {
      expect(lintLine(msg).filter((h) => h.rule === 'a13' || h.rule === 'digit' || h.rule === 'ascii'), rule).toEqual([])
    }
    expect(lintMessages(lintLine('www.x www.y'))).toEqual([LINT_MESSAGES.url])
  })
})
