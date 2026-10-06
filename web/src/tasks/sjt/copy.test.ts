import { describe, expect, it } from 'vitest'
import { EMO_AXIS_NAME, EMO_TOOLTIP } from '../../copy'
import { CONFIRM_LABEL } from '../../render/choice/keys'
import { RATING_LEVELS } from './spec'
import { ENTRY_COPY, FACET_NOTE, progressText, SCALE_LABELS } from './copy'

describe('the copy of the situational judgment entry (M6.2)', () => {
  it('is plain text and says nothing about right or wrong (the language lint reads this file: scripts/language-lint.test.ts)', () => {
    const texts: [string, string][] = [...Object.entries(ENTRY_COPY), ...SCALE_LABELS.map((t, i): [string, string] => [`scale ${i + 1}`, t]), ['FACET_NOTE', FACET_NOTE]]
    for (const [name, text] of texts) {
      expect(text, name).toMatch(/^[A-Z].*[.a-z?]$/)
      expect(text, name).not.toMatch(/\b(wrong|incorrect|correct|right answer|right|mistake|score|well done)\b/i)
    }
  })

  it('has the instruction, the confirm label and the note of the entry word for word', () => {
    expect(ENTRY_COPY.instructions).toBe('Read the situation, then rate how well each response would work.')
    expect(ENTRY_COPY.submit).toBe('Confirm')
    expect(ENTRY_COPY.submit).toBe(CONFIRM_LABEL)
    expect(ENTRY_COPY.recorded).toBe('Answer recorded.')
  })

  it('labels the four points of the scale from very ineffective to very effective', () => {
    expect([...SCALE_LABELS]).toEqual(['Very ineffective', 'Somewhat ineffective', 'Somewhat effective', 'Very effective'])
    expect(SCALE_LABELS).toHaveLength(RATING_LEVELS)
    expect(new Set(SCALE_LABELS).size).toBe(RATING_LEVELS)
  })

  it('labels the two questions of most/least mode, and says what to do when both name one response', () => {
    expect(ENTRY_COPY.most).toBe('Which response would work best?')
    expect(ENTRY_COPY.least).toBe('Which response would work least well?')
    expect(ENTRY_COPY.mostLeastSame).toMatch(/two different responses/)
  })

  it('says what the skill measures: agreement with typical and expert judgments, conventionality, overlap with verbal skills (DESIGN §5.2, §5.3)', () => {
    expect(FACET_NOTE).toBe(
      'Measures how closely your ratings agree with typical and expert judgments of what works in everyday situations. It rewards conventional choices and overlaps with reading and vocabulary skills.',
    )
  })

  it('names the skill in the words of R-5.6.2, which this entry shares with the emotion entry', () => {
    expect(EMO_AXIS_NAME).toBe('Emotion Reading (text scenarios)')
    expect(EMO_TOOLTIP.startsWith('Measures agreement with appraisal-theory and consensus keys.')).toBe(true)
    expect(ENTRY_COPY.tipButton).toBe('About this skill')
  })

  it('counts the ratings made so far', () => {
    expect(progressText(0, 4)).toBe('0 of 4 responses rated.')
    expect(progressText(3, 4)).toBe('3 of 4 responses rated.')
  })
})
