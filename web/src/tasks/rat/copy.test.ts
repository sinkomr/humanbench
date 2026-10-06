import { describe, expect, it } from 'vitest'
import { facetLabel } from '../../viz/facets'
import { ENTRY_COPY, RAT_NAME } from './copy'

describe('the copy of the word links entry (M6.3)', () => {
  it('is plain text and says nothing about right or wrong (the language lint reads this file: scripts/language-lint.test.ts)', () => {
    for (const [name, text] of Object.entries(ENTRY_COPY)) {
      expect(text, name).toMatch(/^[A-Z].*[.a-z]$/)
      expect(text, name).not.toMatch(/\b(wrong|incorrect|correct|right answer|right|mistake|score|clinical|diagnos\w*)\b/i)
    }
  })

  it('has the words of the spec for the name, the instruction, the label, the button and the status', () => {
    expect(RAT_NAME).toBe('Word links')
    expect(ENTRY_COPY.name).toBe('Word links')
    expect(ENTRY_COPY.instructions).toBe('Find one word that goes with each of the three words to make a common word or phrase, before or after it.')
    expect(ENTRY_COPY.inputLabel).toBe('Linking word')
    expect(ENTRY_COPY.submit).toBe('Confirm')
    expect(ENTRY_COPY.recorded).toBe('Answer recorded.')
  })

  it('names the entry as the results do', () => {
    expect(facetLabel('remote_associates')).toBe(RAT_NAME)
  })

  it('says the limit of the answer in numbers that agree with the box', () => {
    expect(ENTRY_COPY.longNote).toBe('Use at most 40 characters.')
  })
})
