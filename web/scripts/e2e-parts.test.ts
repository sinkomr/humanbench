/**
 * What the two whole-session specs ask of each part of the session (`e2e/parts.ts`; ROADMAP M1.21, M1.22). The
 * keyboard-only session failed on one run in six because it asked the Matrix & Series part for a multiple-choice
 * item while the selector served series almost only; the selector now balances the two families (M1.14), so the part
 * is asked for both. These tests run without a browser.
 */

import { describe, expect, it } from 'vitest'
import { PART_SCREENS, partsPlayedProblems } from '../e2e/parts'
import { SEGMENT_TITLES } from '../e2e/routes'
import { A15_SEGMENTS } from '../src/engine/selector'
import { SEGMENT_INFO } from '../src/session/segments'

/** A session that showed everything the parts need, with `override` replacing the kinds of one part. */
function session(override: Record<string, string[]> = {}): Map<string, Set<string>> {
  const played = new Map<string, Set<string>>([
    ['Reaction Time', new Set(['rt'])],
    ['Matrix & Series', new Set(['choice', 'entry', 'confidence'])],
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

  it('accepts a session in which Matrix & Series served both a matrix and a series item', () => {
    expect(partsPlayedProblems(session())).toEqual([])
  })

  it('names a Matrix & Series part that served only one of its two families', () => {
    expect(partsPlayedProblems(session({ 'Matrix & Series': ['entry', 'confidence'] }))).toEqual(['Matrix & Series: none of choice (saw entry, confidence)'])
    expect(partsPlayedProblems(session({ 'Matrix & Series': ['choice', 'confidence'] }))).toEqual(['Matrix & Series: none of entry (saw choice, confidence)'])
  })

  it('names a part that showed no item, no rating, or the wrong kind of screen', () => {
    expect(partsPlayedProblems(session({ 'Matrix & Series': ['confidence'] }))).toEqual(['Matrix & Series: none of choice (saw confidence)', 'Matrix & Series: none of entry (saw confidence)'])
    expect(partsPlayedProblems(session({ 'Matrix & Series': ['entry', 'choice'] }))).toEqual(['Matrix & Series: none of confidence (saw entry, choice)'])
    expect(partsPlayedProblems(session({ Spatial: ['entry', 'confidence'] }))).toEqual(['Spatial: none of choice (saw entry, confidence)'])
    expect(partsPlayedProblems(session({ 'Working Memory': ['span'] }))).toEqual(['Working Memory: none of corsi (saw span)'])
  })

  it('names a part that was not played at all, and every part that was not', () => {
    const none = new Map<string, Set<string>>()
    const problems = partsPlayedProblems(none)
    expect(problems).toHaveLength(Object.values(PART_SCREENS).reduce((n, groups) => n + groups.length, 0))
    expect(problems).toContain('Reaction Time: none of rt (saw nothing)')
  })
})
