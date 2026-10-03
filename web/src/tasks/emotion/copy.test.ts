import { describe, expect, it } from 'vitest'
import { EMO_AXIS_NAME, EMO_TOOLTIP } from '../../copy'
import { ENTRY_COPY } from './copy'

describe('the copy of the emotion vignette entry (M6.1)', () => {
  it('is plain text and says nothing about right or wrong (the language lint reads this file: scripts/language-lint.test.ts)', () => {
    for (const [name, text] of Object.entries(ENTRY_COPY)) {
      expect(text, name).toMatch(/^[A-Z].*[.a-z]$/)
      expect(text, name).not.toMatch(/\b(wrong|incorrect|correct|right answer|mistake|score)\b/i)
    }
  })

  it('names the skill and explains it only in the words of R-5.6.2', () => {
    expect(EMO_AXIS_NAME).toBe('Emotion Reading (text scenarios)')
    expect(EMO_TOOLTIP).toBe(
      'Measures agreement with appraisal-theory and consensus keys. Not a diagnostic or clinical measure; scores are strongly affected by vocabulary, culture and test familiarity.',
    )
    expect(ENTRY_COPY.tipButton).toBe('About this skill')
  })
})
