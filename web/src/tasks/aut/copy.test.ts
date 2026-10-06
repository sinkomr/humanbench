import { describe, expect, it } from 'vitest'
import { lintText } from '../../../scripts/language-lint'
import { facetLabel } from '../../viz/facets'
import { ANNOUNCE_AT_SECONDS, AUT_NAME, clockText, ENTRY_COPY, EXPERIMENTAL_LABEL, EXPERIMENTAL_NOTE, OCSAI_COPY, RESULT_COPY, RESULT_LABELS, SCORER_COPY, secondsLeftNote, secondsNote, STATUS_LABELS } from './copy'
import { AUT_STATUS_PRECEDENCE } from './scoring'

/** Every string of the copy: the objects' values, and what the functions say for a few inputs. */
function allText(): [string, string][] {
  const out: [string, string][] = []
  const groups: Record<string, Readonly<Record<string, unknown>>> = { ENTRY_COPY, SCORER_COPY, RESULT_COPY, RESULT_LABELS, STATUS_LABELS, OCSAI_COPY }
  for (const [g, obj] of Object.entries(groups)) {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') out.push([`${g}.${k}`, v])
      else if (typeof v === 'function') out.push([`${g}.${k}()`, (v as (a: string, b: string) => string)('all-MiniLM-L6-v2', 'aut-v0')])
    }
  }
  out.push(['EXPERIMENTAL_NOTE', EXPERIMENTAL_NOTE], ['secondsNote', secondsNote(90)], ['secondsLeftNote', secondsLeftNote(30)])
  return out
}

describe('the copy of the unusual uses entry (M6.4)', () => {
  it('has the words of the spec for the name, the label, the instruction, the warning and the notes', () => {
    expect(AUT_NAME).toBe('Unusual uses')
    expect(EXPERIMENTAL_LABEL).toBe('Experimental')
    expect(ENTRY_COPY.name).toBe('Unusual uses')
    expect(ENTRY_COPY.experimental).toBe('Experimental')
    expect(ENTRY_COPY.instructions).toBe('List as many unusual uses for the object as you can. Short answers work best.')
    expect(ENTRY_COPY.warningTitle).toBe("Don't type personal info")
    expect(ENTRY_COPY.warningBody).toBe('No names, addresses, phone numbers or emails. Your answers are kept in your save file, and anything that looks like contact details is left out.')
    expect(SCORER_COPY.note).toBe('Scoring runs on this device with a small language model (about 25 MB, downloaded once from Hugging Face). Your answers are not sent anywhere.')
    expect(SCORER_COPY.load).toBe('Load the scorer (about 25 MB)')
    expect(EXPERIMENTAL_NOTE).toBe(
      'Experimental: this is a rough measure of how far your ideas are from the object and from each other. Automated scoring like this agrees only loosely with human judges.',
    )
    expect(OCSAI_COPY.off).toBe('An optional outside scoring service may be offered later. It is off, and nothing is sent.')
  })

  it('names the three measures as the spec does, and none of them is a total, a percentile or a verdict', () => {
    expect(RESULT_LABELS).toEqual({ count: 'Ideas counted', distance: 'Distance score (experimental)', groups: 'Idea groups' })
    for (const [name, text] of allText()) expect(text, name).not.toMatch(/\b(total|percentile|rank|top \d+ percent|grade|wrong|incorrect|correct|right answer|mistake|well done|clinical|diagnos\w*)\b/i)
  })

  it('names the entry as the results do (the facet label is the name and the lower-case label in brackets)', () => {
    expect(facetLabel('alternative_uses')).toBe(`${AUT_NAME} (${EXPERIMENTAL_LABEL.toLowerCase()})`)
  })

  it('has a label for every way the scoring treats an idea, about counting and never about right or wrong', () => {
    expect(Object.keys(STATUS_LABELS).sort()).toEqual([...AUT_STATUS_PRECEDENCE].sort())
    expect(STATUS_LABELS.scored).toBe('Counted')
    for (const s of AUT_STATUS_PRECEDENCE) expect(STATUS_LABELS[s]).toMatch(/^(Counted|Not counted|Left out)/)
  })

  it('is plain sentences, and passes the language lint (A13) as rendered text', () => {
    for (const [name, text] of allText()) {
      expect(text.length, name).toBeGreaterThan(1)
      expect(text, name).toBe(text.trim())
      expect(lintText(text, `${name}.txt`), name).toEqual([])
    }
  })

  it('does not name the outside service anywhere', () => {
    for (const [name, text] of allText()) expect(text, name).not.toMatch(/ocsai|openscoring/i)
  })
})

describe('the countdown copy', () => {
  it('announces at 60, 30 and 10 seconds only', () => {
    expect([...ANNOUNCE_AT_SECONDS]).toEqual([60, 30, 10])
    expect(secondsLeftNote(60)).toBe('60 seconds left.')
    expect(secondsLeftNote(1)).toBe('1 second left.')
    expect(secondsNote(90)).toBe('You have 90 seconds.')
    expect(secondsNote(1)).toBe('You have 1 second.')
  })

  it('writes a time as m:ss, rounding up and never below zero', () => {
    expect(clockText(90)).toBe('1:30')
    expect(clockText(89.2)).toBe('1:30')
    expect(clockText(60)).toBe('1:00')
    expect(clockText(59)).toBe('0:59')
    expect(clockText(5)).toBe('0:05')
    expect(clockText(0)).toBe('0:00')
    expect(clockText(-3)).toBe('0:00')
    expect(clockText(600)).toBe('10:00')
  })
})
