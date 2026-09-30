/**
 * The list of strings a share card must not contain (AI.6b, M1.18) is built from the grammar, so it
 * covers every notes line, not a few samples: a real template line put into a card was once missed
 * by a hand-typed list of seven strings.
 */

import { describe, expect, it } from 'vitest'
import { buildBrief } from './build'
import { HEADINGS, TEMPLATES, wording } from './grammar'
import { MIN_MARKER_CHARS, NOTES_LEAK_MARKERS, markerPieces, noteTexts } from './leak-markers'
import { PROFILE_A, PROFILE_B_LONG, PROFILE_B_SHORT, PROFILE_C } from './profiles'
import { contentLines } from './lint'
import { PREAMBLE, RESULTS_TALK, RESULTS_TALK_TEXT, REVEAL_CARD } from './results-talk'
import { RETIRED_WORDINGS } from './retired'

const covered = (text: string): boolean => NOTES_LEAK_MARKERS.some((m) => text.includes(m))

describe('NOTES_LEAK_MARKERS', () => {
  it('keeps the strings the earlier list held, the preamble, the results-talk text and the reveal-card copy', () => {
    for (const m of ['Notes for your AI', 'How I like explanations', 'not an assessment of me', 'rough, uncertain self-reflection results', PREAMBLE, RESULTS_TALK_TEXT, RESULTS_TALK.heading, RESULTS_TALK.neverPaste, REVEAL_CARD.heading, REVEAL_CARD.body, REVEAL_CARD.link]) {
      expect(NOTES_LEAK_MARKERS, m).toContain(m)
    }
  })

  it('has a piece of every wording of every template, in both forms, so no single line can go unnoticed', () => {
    const missing: string[] = []
    for (const t of TEMPLATES) {
      for (const form of ['long', 'short'] as const) {
        const w = wording(t, form)
        if (w === null || w.replace(/\{[A-Za-z]+\}/gu, '').trim() === '') continue // X1 is only the person's own words
        if (!markerPieces(w).some((p) => NOTES_LEAK_MARKERS.includes(p))) missing.push(`${t.id} (${form}): ${w}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('has a piece of the header, the title and every Skill description', () => {
    for (const text of noteTexts()) expect(markerPieces(text).length, text).toBeGreaterThan(0)
    expect(NOTES_LEAK_MARKERS.some((m) => m.startsWith('my own preferences, not an assessment of me'))).toBe(true)
    expect(NOTES_LEAK_MARKERS.some((m) => m.includes('Use when explaining a concept to me'))).toBe(true)
  })

  it('has a piece of every retired wording (earlier releases still parse, so their lines are notes lines too)', () => {
    for (const r of RETIRED_WORDINGS) for (const w of [r.long, r.short]) if (typeof w === 'string') expect(markerPieces(w).length, w).toBeGreaterThan(0)
  })

  it('finds every line of real notes in each form (slot-filled lines included), apart from headings and words a person typed', () => {
    const headings = new Set<string>(Object.values(HEADINGS))
    const typed = new Set(['cooking', 'football'])
    for (const p of [PROFILE_A, PROFILE_B_LONG, PROFILE_B_SHORT, PROFILE_C]) {
      const r = buildBrief({ prefs: p.prefs, extras: p.extras, form: p.form, asOf: p.asOf })
      const uncovered = contentLines(r.text)
        .map(([line]) => line)
        .filter((line) => !headings.has(line) && !covered(line) && !line.startsWith('Written') && ![...typed].some((w) => line.includes(w)))
      expect(uncovered, p.name).toEqual([])
    }
  })

  it('cuts a wording at quotes, ampersands and angle brackets, so an escaped copy in an SVG is found too', () => {
    const pieces = markerPieces('Keep the first answer plain & simple, and say "why" in a few words <after> that')
    expect(pieces).toEqual(['Keep the first answer plain', 'simple, and say', 'in a few words', 'that'].filter((p) => p.length >= MIN_MARKER_CHARS))
    for (const p of pieces) expect(p).not.toMatch(/['"&<>]/u)
    expect(markerPieces('Tell me plainly when I\'m wrong')).toEqual(['Tell me plainly when I'])
    expect(NOTES_LEAK_MARKERS).toContain('Tell me plainly when I')
  })

  it('has only long pieces (a short one would match ordinary card words)', () => {
    for (const m of NOTES_LEAK_MARKERS) expect(m.length, m).toBeGreaterThanOrEqual(MIN_MARKER_CHARS)
  })
})
