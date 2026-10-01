/**
 * What each part of a whole session must have shown, for the two specs that play one (`keyboard-session.spec.ts`,
 * M1.21, and `session-save.spec.ts`, M1.22). A driver records, for each part of the session (by the title of its
 * interstitial), the kinds of screen it met; this says which kinds a part cannot do without.
 *
 * A part that serves a random item cannot be asked for a particular family: the session seed is the random session id
 * (`src/session/run.ts`), and the selector picks by information per second, so the Matrix & Series part serves series
 * items (typed entry) almost always and matrix items (multiple choice) rarely: none in 60 simulated sessions, 2 of 60 with
 * short items. A test that required one of the two failed on one run in six. The part is asked for what it always
 * has, an item of either kind and its confidence rating, and each renderer has its own route in the accessibility
 * sweep and its own tests.
 */

import { SEGMENT_TITLES } from './routes'

/** The kinds of screen a driver tells apart (`Screen` of `session-driver.ts`). */
type Kind = 'confidence' | 'choice' | 'entry' | 'rt' | 'span' | 'corsi' | 'coding' | 'reading'

/** Per part, groups of kinds: from each group at least one must have been on screen. */
export const PART_SCREENS: Readonly<Record<(typeof SEGMENT_TITLES)[number], readonly (readonly Kind[])[]>> = {
  'Reaction time': [['rt']],
  'Matrix & Series': [['choice', 'entry'], ['confidence']],
  Spatial: [['choice'], ['confidence']],
  'Working Memory': [['span'], ['corsi']],
  'Quantitative Reasoning': [['entry'], ['confidence']],
  'Processing & Reading Speed': [['coding'], ['reading']],
}

/** What a played session lacks: one line per part that missed a group (none when every part showed what it must). */
export function partsPlayedProblems(played: ReadonlyMap<string, ReadonlySet<string>>): string[] {
  const problems: string[] = []
  for (const title of SEGMENT_TITLES) {
    const seen = played.get(title) ?? new Set<string>()
    for (const group of PART_SCREENS[title]) {
      if (!group.some((kind) => seen.has(kind))) problems.push(`${title}: none of ${group.join(' or ')} (saw ${[...seen].join(', ') || 'nothing'})`)
    }
  }
  return problems
}
