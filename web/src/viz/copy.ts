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
  'One spoke per skill. The same estimates, with their intervals, are in the table that goes with this chart.'

/** §9.1 + A12: ring units, "provisional", and the centre. */
export const RING_CAPTION =
  'Rings are standard-deviation (SD) units on a provisional scale. The dashed ring is 0 SD. The centre is −3 SD, not zero ability.'

/** In-chart ring note (A12, §9.1), so the SVG alone (M1.18 export) still says it. */
export const RING_NOTE: readonly string[] = ['Rings: SD units, provisional', 'Centre: \u22123 SD']

/** §9.3: fuzz + band; §9.5: muting (markers and the line). */
export const UNCERTAINTY_CAPTION =
  'The solid line is the most likely profile. The shaded band spans ±1 SD, and the faint lines are 20 plausible profiles drawn from your results. Whiskers show 90% intervals; where one overlaps 0 SD, the marker is hollow and the line turns grey.'

/** §9.7, A15. */
export const STUB_CAPTION = 'Dashed grey spokes are skills that were not measured; the line drops to the centre there.'

/** §9.5 a, b: read spokes one at a time; the shape's size carries no meaning. */
export const READING_CAPTION = 'Compare spokes one at a time. The size of the shape means nothing on its own, and the spoke order is fixed for everyone.'

/** Tier glyph legend (§9.7). */
export const TIER_TEXT: Readonly<Record<GoldTier, string>> = Object.freeze({
  a: 'answers checked against a verified key',
  b: 'timed, recall or estimate measures with provisional norms',
  c: 'consensus-keyed items, less certain',
})

export const TIER_LEGEND = `○ ${TIER_TEXT.b}. ◇ ${TIER_TEXT.c}.`

/** §9.7: the tier (c) hatch, shown when a ◇ skill is measured. */
export const HATCH_CAPTION = 'Hatched wedges mark measured ◇ skills (consensus-keyed items).'

export const TABLE_CAPTION = 'Estimates by skill, in SD units on a provisional scale, with 90% intervals.'
export const TABLE_SKILL = 'Skill'
export const TABLE_CLUSTER = 'Cluster'
export const TABLE_ESTIMATE = 'Estimate (SD)'
export const TABLE_INTERVAL = '90% interval (SD)'
export const TABLE_RELATION = 'Compared with 0 SD'

/** Bar view note: how to read a lollipop. */
export const BARS_NOTE = 'Each line runs from −3 SD to +3 SD. The dot is the estimate, the bar its 90% interval, and the dashed tick 0 SD.'

export const RELATION_TEXT: Readonly<Record<Relation, string>> = Object.freeze({
  above: 'Above 0 SD',
  below: 'Below 0 SD',
  overlaps: 'Overlaps 0 SD',
})

/** "1 item", "3 items", "1 block". */
export function countText(n: number, unit: CountUnit = 'item'): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`
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
  return `Facets of ${cluster}, in SD units on a provisional scale. A facet needs ${FACET_MIN_ITEMS} scored items or blocks before it gets an estimate.`
}
export const FACET_EMPTY = 'No facets have been measured in this cluster yet.'
export const FACET_SKILL = 'Facet'
export const FACET_GROUP = 'Skill'
