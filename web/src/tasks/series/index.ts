/**
 * Series family (axis MAT, facet "series"; DESIGN §4.2 "Series", §14.6 example 2; ROADMAP M1.7,
 * A1, A9, A11). Number and letter series, 5–7 terms shown, the next term entered. Numeric entry
 * is 2PL (A9) with b = the v0 prior of `prior.ts` anchored at ICAR series p = .59.
 *
 * Item type: M1.7 asks for numeric entry for numbers and single-letter entry for letters, but the
 * contract gives a family exactly one `item_type` (`defineFamily`, `validateItemInstance`). A
 * separate letter family is no way out: constant-step letter series have only 1,248 possible
 * contents (26 starts × 16 steps × 3 lengths) and reach strata 1–2 only, so it could not pass the
 * 10,000-instance property suite. Number and letter series therefore share `series_entry`, and
 * the renderer picks numeric or single-letter entry from `spec.input_format` ("integer" or
 * "letter"); a per-instance item type is a contract follow-up for the integrator.
 *
 * Rules, DL and uniqueness: `rules.ts`; generator: `gen.ts`; verifier: `verify.ts`; scoring:
 * `score.ts`; the TS → bank analysis fixture: `analysis-fixture.ts`. Python twin: the bank's
 * `hb.gen.series`.
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
