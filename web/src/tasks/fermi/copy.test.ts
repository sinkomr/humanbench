import { describe, expect, it } from 'vitest'
import { ENTRY_COPY, MAGNITUDE_NOTES } from './copy'
import { parseMagnitude } from './magnitude'
import { MAGNITUDE_MAX, MAGNITUDE_MIN } from './scoring'

describe('the copy of the magnitude entry (M5.1)', () => {
  it('writes the range note in the form the entry teaches, not as JavaScript writes a number', () => {
    expect(MAGNITUDE_NOTES.range).toBe('Use a number between 1 × 10^-30 and 1 × 10^30.')
    expect(MAGNITUDE_NOTES.range).not.toMatch(/\de[+-]?\d/)
    expect(ENTRY_COPY.instructions).toContain('3.2 × 10^6')
  })

  it('the limits the note names are accepted, and the numbers just outside them are the ones that note answers', () => {
    expect(parseMagnitude('1 × 10^-30')).toEqual({ ok: true, value: MAGNITUDE_MIN })
    expect(parseMagnitude('1 × 10^30')).toEqual({ ok: true, value: MAGNITUDE_MAX })
    expect(parseMagnitude('1 × 10^-31')).toEqual({ ok: false, problem: 'range' })
    expect(parseMagnitude('1 × 10^31')).toEqual({ ok: false, problem: 'range' })
  })

  it('every note is plain text of one or two sentences', () => {
    for (const [problem, note] of Object.entries(MAGNITUDE_NOTES)) {
      expect(note, problem).toMatch(/^[A-Z].*\.$/)
      expect(note, problem).not.toMatch(/\n/)
    }
  })
})
