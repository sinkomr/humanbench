/**
 * Series family (axis MAT, facet "series"; DESIGN §4.2 "Series", §14.6 example 2; ROADMAP M1.7,
 * A1, A9, A11). Number and letter series, 5–7 terms shown, the next term entered. Numeric entry
 * is 2PL (A9) with b = the v0 prior of `prior.ts` anchored at ICAR series p = .59.
 *
 * The contract gives a family one `item_type`, so number and letter series share
 * `series_entry` and the renderer picks the input from `spec.input_format` ("integer" or
 * "letter"). Rules, DL and uniqueness: `rules.ts`; generator: `gen.ts`; verifier: `verify.ts`;
 * scoring: `score.ts`. Python twin: the bank's `hb.gen.series`.
 */

import { defineFamily } from '../family'
import { SERIES_STRATA, buildSeries } from './gen'
import { scoreSeries } from './score'
import type { SeriesItem, SeriesKey, SeriesResponse, SeriesSpec } from './types'
import { MAX_VISIBLE, MIN_VISIBLE } from './rules'
import { verifySeries } from './verify'

export type { SeriesItem, SeriesKey, SeriesResponse, SeriesSpec, SeriesStructure } from './types'

export const SERIES_ITEM_TYPE = 'series_entry'

export const series = defineFamily<SeriesSpec, SeriesKey, SeriesResponse>({
  name: 'series',
  axis: 'MAT',
  facet: 'series',
  generatorVersion: '1.0.0',
  itemType: SERIES_ITEM_TYPE,
  strata: SERIES_STRATA,
  build: buildSeries,
  verify: verifySeries,
  score: scoreSeries,
})

/**
 * The family's leak check for `runFamilyProperties`: the spec holds only `input_format` and the
 * 5–7 visible `terms` (the key is the unshown next term, never a spec field).
 */
export function seriesSpecLeaksKey(item: SeriesItem): string | null {
  const extra = Object.keys(item.spec).filter((k) => k !== 'input_format' && k !== 'terms')
  if (extra.length > 0) return `unexpected spec fields: ${extra.join(', ')}`
  const n = item.spec.terms.length
  if (n < MIN_VISIBLE || n > MAX_VISIBLE) return `spec shows ${n} terms (5–7 allowed)`
  return null
}

export default series
