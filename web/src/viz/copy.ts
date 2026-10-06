/**
 * User-facing text of the blob and bar views (DESIGN §9, §7.3, §13; ROADMAP A12, A13, A15).
 *
 * Rules this copy follows (tested in `ProfileView.dom.test.ts` and the e2e scan): SD units marked
 * "provisional" and no percentiles before M4 linking (A12); the centre is −3 SD, not zero ability
 * (§9.1); nothing names or implies a sum, a size of the shape, or one number for a person (§9.5 a,
 * CLAUDE.md blob rule); non-diagnostic wording (R-5.6.x, A13; the language lint scans this file).
 */

import type { GoldTier } from '../engine/axes'
import { FACET_MIN_ITEMS, type CountUnit } from './facets'
import type { NotMeasuredReason, Relation } from './profile'

export const PROFILE_HEADING = 'Profile by skill'

export const VIEW_GROUP_LABEL = 'Chart view'
export const VIEW_BLOB = 'Blob view'
export const VIEW_BARS = 'Bar view'

export const BLOB_TITLE = 'Skill profile blob'
export const BLOB_DESCRIPTION =
  'One spoke per skill. The same estimates, with their ranges, are in the table that goes with this chart.'

/** §9.1 + A12: ring units, "provisional", and the centre. */
export const RING_CAPTION =
  'Rings are standard-deviation (SD) units on a provisional scale. The dashed ring is 0 SD. The centre is −3 SD, not zero ability.'

/** In-chart ring note (A12, §9.1), so the SVG alone (M1.18 export) still says it. */
export const RING_NOTE: readonly string[] = ['Rings: SD units, provisional', 'Centre: \u22123 SD']

/** §9.3: fuzz + band; §9.5: muting (markers and the line). */
export const UNCERTAINTY_CAPTION =
  'The solid line is the most likely profile. The light band shows each estimate ± its uncertainty. The soft edge fades out across each 90% range: the darker the shading, the more likely that value. The thin lines through the markers show the 90% ranges; where one crosses 0 SD, the marker is hollow and the line turns grey.'

/** §9.7, A15. */
export const STUB_CAPTION = 'Dashed grey spokes are skills that were not measured; the line drops to the centre there.'

/** §9.5 a, b: read spokes one at a time; the shape's size carries no meaning. */
export const READING_CAPTION =
  'Compare spokes one at a time: the size of the shape means nothing on its own. The spoke order is the same for everyone, with skills that tend to go together placed side by side.'

/** Tier glyph legend (§9.7). */
export const TIER_TEXT: Readonly<Record<GoldTier, string>> = Object.freeze({
  a: 'answers checked against a verified key',
  b: 'timed, memory or estimation tasks, compared with provisional typical values',
  c: 'answers scored by how most people respond, so less certain',
})

export const TIER_LEGEND = `○ ${TIER_TEXT.b}. ◇ ${TIER_TEXT.c}.`

/** §9.7: the tier (c) hatch, shown when a ◇ skill is measured. */
export const HATCH_CAPTION = 'Hatched wedges mark measured ◇ skills (scored by how most people respond).'

export const TABLE_CAPTION =
  'Estimates by skill, in standard-deviation (SD) units on a provisional scale, each ± its uncertainty, with 90% ranges.'
export const TABLE_SKILL = 'Skill'
export const TABLE_CLUSTER = 'Cluster'
export const TABLE_ESTIMATE = 'Estimate (SD units)'
export const TABLE_INTERVAL = '90% range (SD)'
export const TABLE_RELATION = 'Compared with 0 SD'

/** Bar view note: how to read a lollipop. */
export const BARS_NOTE = 'Each line runs from −3 SD to +3 SD. The dot is the estimate, the bar its 90% range, and the dashed tick 0 SD.'

/** UX-037: the word under a spoke whose estimate is beyond the drawn scale, and what its arrow means. */
export const OFF_SCALE_LABEL = 'off scale'
export const OFF_SCALE_CAPTION =
  'An arrow at the centre or the rim of the chart marks an estimate at or past the end of the scale (−3 or +3 SD); the table gives the number.'
export const OFF_SCALE_BARS_NOTE = 'An arrow at the end of a line marks an estimate at or past the end of the scale (−3 or +3 SD); the table gives the number.'
/** The table's note beside such an estimate. */
export const OFF_SCALE_CELL = '(off scale)'

/** UX-044: shown beside the view toggle when the text is too large for the blob's labels to keep up. */
export const LARGE_TEXT_HINT = 'Large text: the bar view shows the same data in text.'

export const RELATION_TEXT: Readonly<Record<Relation, string>> = Object.freeze({
  above: 'Above 0 SD',
  below: 'Below 0 SD',
  overlaps: 'Overlaps 0 SD',
})

/** What a count counts, in the person's words: a scored question, or a timed task (a block). */
export const COUNT_UNIT_TEXT: Readonly<Record<CountUnit, string>> = Object.freeze({ item: 'question', block: 'timed task' })

/** "1 question", "3 questions", "1 timed task". */
export function countText(n: number, unit: CountUnit = 'item'): string {
  return `${n} ${COUNT_UNIT_TEXT[unit]}${n === 1 ? '' : 's'}`
}

export function notMeasuredText(reason: NotMeasuredReason | undefined, nItems?: number, unit: CountUnit = 'item'): string {
  switch (reason) {
    case 'skipped':
      return 'Not measured (skipped)'
    case 'not_yet_available':
      return 'Not measured (not offered yet)'
    case 'insufficient_data':
      return `Insufficient data (${countText(nItems ?? 0, unit)}; ${FACET_MIN_ITEMS} needed)`
    default:
      return 'Not measured'
  }
}

export const DRILL_PROMPT = 'Explore a cluster:'
export function facetHeading(cluster: string): string {
  return `${cluster}: facets`
}
export function facetCaption(cluster: string): string {
  return `Facets of ${cluster}, in SD units on a provisional scale. A facet needs ${FACET_MIN_ITEMS} scored questions or timed tasks before it gets an estimate.`
}
/** UX-041: one line instead of an empty chart, when no facet of the cluster has enough data yet. */
export function facetNone(cluster: string, n: number): string {
  const lead = n === 1 ? `The one facet of ${cluster} does not have enough data yet: it needs` : n === 2 ? `Neither of the 2 facets of ${cluster} has enough data yet: each needs` : `None of the ${n} facets of ${cluster} has enough data yet: each needs`
  return `${lead} ${FACET_MIN_ITEMS} scored questions or timed tasks. Facets fill in over several sessions.`
}
export const FACET_EMPTY = 'No facets have been measured in this cluster yet.'
export const FACET_SKILL = 'Facet'
export const FACET_GROUP = 'Skill'
