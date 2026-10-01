/**
 * What the two whole-session specs ask of each part of the session (`e2e/parts.ts`; ROADMAP M1.21, M1.22). The
 * keyboard-only session failed on one run in six because it asked the Matrix & Series part for a multiple-choice
 * item, and the random session id mostly leads to series items. These tests run without a browser.
 */

import { describe, expect, it } from 'vitest'
import { PART_SCREENS, partsPlayedProblems } from '../e2e/parts'
import { SEGMENT_TITLES } from '../e2e/routes'
import { A15_SEGMENTS } from '../src/engine/selector'
import { SEGMENT_INFO } from '../src/session/segments'

/** A session that showed everything the parts need, with `override` replacing the kinds of one part. */
function session(override: Record<string, string[]> = {}): Map<string, Set<string>> {
  const played = new Map<string, Set<string>>([
    ['Reaction time', new Set(['rt'])],
    ['Matrix & Series', new Set(['entry', 'confidence'])],
    ['Spatial', new Set(['choice', 'confidence'])],
    ['Working Memory', new Set(['span', 'corsi'])],
    ['Quantitative Reasoning', new Set(['entry', 'confidence'])],
    ['Processing & Reading Speed', new Set(['coding', 'reading'])],
  ])
  for (const [title, kinds] of Object.entries(override)) played.set(title, new Set(kinds))
  return played
}

describe('what a played session must have shown, by part', () => {
  it('names every part of the plan, by its interstitial title, in order', () => {
    expect(Object.keys(PART_SCREENS)).toEqual([...SEGMENT_TITLES])
    expect(SEGMENT_TITLES).toEqual(A15_SEGMENTS.map((s) => SEGMENT_INFO[s.id].title))
  })

  it('accepts a session in which Matrix & Series served series, or matrices, or both', () => {
    expect(partsPlayedProblems(session())).toEqual([])
    expect(partsPlayedProblems(session({ 'Matrix & Series': ['choice', 'confidence'] }))).toEqual([])
    expect(partsPlayedProblems(session({ 'Matrix & Series': ['entry', 'choice', 'confidence'] }))).toEqual([])
  })

  it('names a part that showed no item, no rating, or the wrong kind of screen', () => {
    expect(partsPlayedProblems(session({ 'Matrix & Series': ['confidence'] }))).toEqual(['Matrix & Series: none of choice or entry (saw confidence)'])
    expect(partsPlayedProblems(session({ 'Matrix & Series': ['entry'] }))).toEqual(['Matrix & Series: none of confidence (saw entry)'])
    expect(partsPlayedProblems(session({ Spatial: ['entry', 'confidence'] }))).toEqual(['Spatial: none of choice (saw entry, confidence)'])
    expect(partsPlayedProblems(session({ 'Working Memory': ['span'] }))).toEqual(['Working Memory: none of corsi (saw span)'])
  })

  it('names a part that was not played at all, and every part that was not', () => {
    const none = new Map<string, Set<string>>()
    const problems = partsPlayedProblems(none)
    expect(problems).toHaveLength(Object.values(PART_SCREENS).reduce((n, groups) => n + groups.length, 0))
    expect(problems).toContain('Reaction time: none of rt (saw nothing)')
  })
})
