/**
 * What each part of a whole session must have shown, for the two specs that play one (`keyboard-session.spec.ts`,
 * M1.21, and `session-save.spec.ts`, M1.22). A driver records, for each part of the session (by the title of its
 * interstitial), the kinds of screen it met; this says which kinds a part cannot do without.
 *
 * The Matrix & Series part serves both families: the selector balances the families of one axis (`balanceFamilies`
 * in `src/engine/selector.ts`, M1.14), so after its first item it owes the family it has served less, whatever the
 * random session id (the seed, `src/session/run.ts`) leads to. Before that, pure information per second served series
 * (typed entry) almost always and matrices (multiple choice) in about 1 session of 30. The part is asked for one item of
 * each kind, and its confidence rating.
 */

import { SEGMENT_TITLES } from './routes'

/** The kinds of screen a driver tells apart (`Screen` of `session-driver.ts`). */
type Kind = 'confidence' | 'choice' | 'entry' | 'rt' | 'span' | 'corsi' | 'coding' | 'reading'

/** Per part, groups of kinds: from each group at least one must have been on screen. */
export const PART_SCREENS: Readonly<Record<(typeof SEGMENT_TITLES)[number], readonly (readonly Kind[])[]>> = {
  'Reaction time': [['rt']],
  'Matrix & Series': [['choice'], ['entry'], ['confidence']],
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
