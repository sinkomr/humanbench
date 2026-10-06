/**
 * The words of the results (UX-018b, UX-029, UX-030, UX-032, UX-034, UX-035): no string promises a
 * benefit (A22 copy-claim rule: practice-adjusted scoring corrects for practice, so nothing here may
 * say that a session or a download "sharpens" or "improves" anything), none uses clinical or
 * diagnostic words (A13: the language lint, `scripts/language-lint.test.ts`, scans `copy.ts` and every
 * component of the reveal as part of `npm test`), and the sentences that name another screen name it as
 * that screen does.
 */

import { describe, expect, it } from 'vitest'
import { READY_HEADING, READY_LOAD_CODE } from '../session/copy'
import * as copy from './copy'

/** Every string the module exports, and what its functions give for sample arguments. */
function allStrings(): Map<string, string> {
  const out = new Map<string, string>()
  const add = (key: string, value: unknown): void => {
    if (typeof value === 'string') out.set(key, value)
  }
  for (const [name, v] of Object.entries(copy)) {
    if (typeof v === 'string') add(name, v)
    else if (typeof v === 'function') {
      const fn = v as (...args: unknown[]) => unknown
      for (const [label, args] of [
        ['1', [1, 1, 1]],
        ['3', [3, 3, 3]],
        ['text', ['Name', 4, 'text']],
        ['null', [null, null]],
      ] as const) {
        try {
          const r = fn(...args)
          if (Array.isArray(r)) add(`${name}(${label})`, r.join(''))
          else add(`${name}(${label})`, r)
        } catch {
          // A function that wants other arguments is covered by its own tests.
        }
      }
    } else if (typeof v === 'object' && v !== null) {
      for (const [k, x] of Object.entries(v)) add(`${name}.${k}`, x)
    }
  }
  return out
}

describe('the results copy', () => {
  const strings = allStrings()

  it('collects the module (the checks below bite)', () => {
    expect(strings.size).toBeGreaterThan(100)
    expect(strings.get('FOCUS_TEXT')).toBeDefined()
    expect(strings.get('paceLine(text)')).toBeDefined()
  })

  it('promises no benefit: nothing sharpens, improves, boosts or trains, and nothing "helps" (A22)', () => {
    const claim = /\b(sharpen\w*|improv\w*|boost\w*|enhanc\w*|strengthen\w*|train(ing|s)?|better|benefit\w*|helps?|stay(ing)? sharp|brain)\b/i
    for (const [key, text] of strings) expect(text, key).not.toMatch(claim)
  })

  it('says the ranges are still wide when no peak stands out, and never that overlapping ranges are not real differences (UX-071, owner decision 2026-10-05)', () => {
    expect(copy.PEAKS_NONE).toBe('No skill stands out clearly from your others yet. That is common after one session: the ranges are still wide.')
    for (const [key, text] of strings) {
      expect(text, key).not.toMatch(/overlap\w*[^.]{0,40}\bnot real\b/i)
      expect(text, key).not.toContain('Ranges that overlap are not real differences')
    }
  })

  it('the focus session is about measuring more precisely, not about getting better at anything', () => {
    expect(copy.FOCUS_TEXT).toBe('Pick the parts you want measured more precisely. A focus session takes about 20 minutes and covers only the parts you choose.')
    expect(copy.FOCUS_TEXT).not.toMatch(/sharpen|improve|practice/i)
  })

  it('names the screens as they are named: "Ready when you are", "Or paste a save code", Start', () => {
    expect(copy.SPACING_TEXT).toContain(`"${READY_HEADING}"`)
    expect(copy.SPACING_TEXT).toContain('press Start')
    expect(copy.SPACING_TEXT).not.toContain('start screen')
    expect(copy.SAVE_COPIED_NOT_SAVED).toContain(`"${READY_LOAD_CODE}"`)
    expect(copy.SAVE_COPIED_NOT_SAVED).toContain(`"${READY_HEADING}"`)
  })

  it('confirms a copied code once, and says the file is the safe way', () => {
    expect(copy.SAVE_COPIED_NOT_SAVED.match(/Save code copied\./g)).toHaveLength(1)
    expect(copy.SAVE_COPIED_NOT_SAVED).toContain('Downloading the file is still the safest way')
  })

  it('says what the file is for, where it went and that the results can be left once it is saved', () => {
    expect(copy.SAVE_PANEL_REQUIRED).toContain('load it before your next session')
    expect(copy.SAVE_PANEL_REQUIRED).toContain('clearing its data removes it')
    expect(copy.savedAs('humanbench-abc123-2026-10-05.hbsave.json')).toBe(
      'Saved as humanbench-abc123-2026-10-05.hbsave.json. Look in your Downloads folder (on an iPhone, the Files app) and keep it.',
    )
    expect(copy.SAVE_DONE).toContain('You can leave this page safely.')
    expect(copy.SAVE_DONE).toContain('share card')
    // Server mode keeps a mirror: nothing may say that HumanBench keeps no other copy.
    for (const text of [copy.SAVE_PANEL_REQUIRED, copy.SAVE_DONE, copy.SAVE_COPIED_NOT_SAVED]) expect(text).not.toMatch(/no other copy/i)
  })

  it('the pointer at the top of the results is not a status and says the file is not saved yet', () => {
    expect(copy.SAVE_POINTER).toBe('Your results are not saved yet. Download your save file to keep them.')
    expect(copy.SAVE_POINTER_LINK).toBe('Go to the save file')
  })

  it('describes the practice adjustment as a provisional population figure, not as something about the person', () => {
    expect(copy.PRACTICE_ADJUSTED_LATER).toContain('Each later session is credited')
    expect(copy.PRACTICE_ADJUSTED_LATER).toContain('typical gain from practice')
    expect(copy.PRACTICE_ADJUSTED_LATER).toContain('provisional')
    for (const text of [copy.PRACTICE_ADJUSTED_FIRST, copy.PRACTICE_ADJUSTED_LATER]) expect(text).not.toMatch(/describe you|you gained/)
    // A person with one session finds the same in the advice on when to come back, where they decide on a second one.
    expect(copy.SPACING_TEXT).toContain('Each later session is credited for the typical gain from practice (a provisional figure).')
  })

  it('keeps the practice note to one line: the label and one short sentence, no second sentence and no semicolon (D16)', () => {
    expect(copy.PRACTICE_ADJUSTED_LABEL).toBe('Practice-adjusted')
    expect(copy.PRACTICE_ADJUSTED_FIRST).toBe('Nothing to adjust yet.')
    for (const text of [copy.PRACTICE_ADJUSTED_FIRST, copy.PRACTICE_ADJUSTED_LATER]) {
      expect(text.match(/[.!?]/g), text).toHaveLength(1)
      expect(text, text).not.toContain(';')
      expect(`${copy.PRACTICE_ADJUSTED_LABEL}. ${text}`.length, text).toBeLessThanOrEqual(110)
    }
  })

  it('says the reading comparison is for people reading in their first language, as the last sentence of the reading line (D11 B)', () => {
    const line = copy.readingNorm(214)
    expect(line.startsWith('You read a passage at about 214 words per minute.')).toBe(true)
    expect(line.endsWith(' The comparison figures are for people reading in their first language.')).toBe(true)
    // The sentence before it is still there: one passage is a rough guide.
    expect(line).toContain('One passage is a rough guide. The comparison figures')
  })

  it('compares peaks with the profile as a whole and points at shapes, not colours', () => {
    expect(copy.PEAKS_INTRO).toContain('your profile as a whole')
    expect(copy.PEAKS_INTRO).not.toContain('the rest of')
    expect(copy.PEAKS_NOTE).toMatch(/hollow and filled markers/)
    expect(copy.PEAKS_NOTE).not.toMatch(/\b(grey|gray|blue|red|green|colou?r)\b/i)
  })

  it('writes units out and counts what is shown', () => {
    expect(copy.paceLine('Quantitative Reasoning', 45, 'close to typical')).toBe('Quantitative Reasoning: about 45 seconds per question, close to typical')
    expect(copy.paceLine('Quantitative Reasoning', 1, 'close to typical')).toContain('about 1 second per question')
    expect(copy.SHARE_SIZES).toBe('The PNG is 2400 × 1260 pixels (twice the card size, for sharp screens). The SVG is 1200 × 630 pixels and stays sharp at any size.')
    expect(copy.workedHeading(3)).toBe('Three worked examples')
    expect(copy.workedHeading(2)).toBe('Two worked examples')
    expect(copy.workedHeading(1)).toBe('One worked example')
    expect(copy.workedHeading(0)).toBe('Worked examples')
    expect(copy.WORKED_INTRO).not.toMatch(/these question types are left out/)
    expect(copy.NORMS_LATEST).toContain('most recent attempt')
  })

  it('the share card words: counts, the explanation for a short profile, the link to the helper', () => {
    expect(copy.shareCount(7)).toBe('7 skills are on the card.')
    expect(copy.shareCountParts(7)).toEqual([7, ' skills are on the card.'])
    expect(copy.shareTooFew(2, 3)).toBe('Tick at least 3 skills to make a card (2 ticked).')
    expect(copy.shareTooFewParts(2, 3)).toEqual(['Tick at least 3 skills to make a card (', 2, ' ticked).'])
    expect(copy.shareNeedsMore(3, 1)).toBe('A card needs at least 3 measured skills, and your profile has 1. Play more parts or add another session, then come back to make a card.')
    expect(copy.SHARE_TALK_LEAD).toBe('Thinking of asking an AI about your results?')
    expect(copy.SHARE_TALK_LINK).toBe('Read this first')
    expect(copy.SHARE_FULLSIZE).toBe('View the card full size (opens in a new tab)')
    // The intro's long sentence is split.
    for (const sentence of copy.SHARE_INTRO.split(/(?<=\.)\s+/)) expect(sentence.split(/\s+/).length, sentence).toBeLessThan(22)
  })
})
