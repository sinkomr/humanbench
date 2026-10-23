/**
 * Series family (axis MAT, facet "series"; DESIGN §4.2 "Series", §14.6 example 2; ROADMAP M1.7,
 * A1, A9, A11). Number and letter series, 5–7 terms shown, the next term entered. Numeric entry
 * is 2PL (A9) with b = the v0 prior of `prior.ts` anchored at ICAR series p = .59.
 *
 * Item type: M1.7 asks for numeric entry for numbers and single-letter entry for letters, but the
 * contract gives a family exactly one `item_type` (`defineFamily`, `validateItemInstance`). A
 * separate letter family is no way out: constant-step letter series have only 1,248 possible
 * contents (26 starts × 16 steps × 3 lengths) and reach strata 1–2 only, so it could not pass the
 * 10,000-instance property suite. Number and letter series therefore share the typed-entry item
 * type "numeric" (`NUMERIC_ITEM_TYPE`, DESIGN §14.6 ex. 2, as quant), and the renderer picks
 * numeric or single-letter entry from `spec.input_format` ("integer" or "letter", the shared
 * `EntryFormat` vocabulary). Integer keys are the shared `NumericKey` `{ value: "42", tol:
 * { abs: 0 } }`; letter keys are `{ letter: "K" }`. Version 1.1.0: that item type and key shape
 * (was `series_entry` and `{ value: 42, tol: 0 }`; audit: quant conventions). Version 1.2.0
 * (contract v2, M1.F2): `sibling_group` and the shared power-item cap `time_limit_s` (§13).
 * Version 1.3.0 (M1.P): the natural pool draws rule families from `NATURAL_MENU` (not stratum
 * first) and the prior is centred at its feature means, so its mean b is the ICAR anchor.
 * Version 1.4.0 (M3.12, harder items at the upper end): six hard rule families (`rules.ts`
 * `HARD_RULE_NAMES`: three-term Fibonacci, Fibonacci differences, strands with their own ops,
 * weighted two-term recurrences, index-dependent affine steps, cycles of three ops), drawn only
 * for requested strata 5 and 6 (stratum 6 is new), and fitted as competitors on every 1.4.0 item.
 * The natural pool and strata 1–4 draw as 1.3.0, and the prior is unchanged (the new families
 * enter it through their family cost). The 1.3.0 generator is kept whole as
 * {@link SERIES_LEGACY_FAMILIES} for saved items.
 * Version 1.5.0 (letter series of any family): letter templates (`gen.ts` LETTER_TEMPLATES) draw
 * letter series whose key rule is an integer family on positions 1–26 (growing skips, two
 * strands, alternating steps, Fibonacci-type, a cycle of three ops; structure
 * `letters: true`) and the rule `letter` with steps of 5–12, only for requested strata 2–6 (a
 * quarter of those items). The natural pool and stratum 1 draw as 1.4.0 (the fit set is
 * unchanged), and the prior's letter terms apply to every letter series. 1.4.0 is kept whole in
 * {@link SERIES_LEGACY_FAMILIES} too.
 *
 * Rules, DL and uniqueness: `rules.ts`; generator: `gen.ts`; verifier: `verify.ts`; scoring:
 * `score.ts`; the TS → bank analysis fixture: `analysis-fixture.ts`. Python twin: the bank's
 * `hb.gen.series`.
 */

import { NUMERIC_ITEM_TYPE, defineFamily } from '../family'
import { buildSeries, seriesStrataOf } from './gen'
import { scoreSeries } from './score'
import type { SeriesItem, SeriesKey, SeriesResponse, SeriesSpec } from './types'
import { MAX_VISIBLE, MIN_VISIBLE, type FitSet } from './rules'
import { verifiers } from '../verifier-slot'

export type { SeriesItem, SeriesKey, SeriesResponse, SeriesSpec, SeriesStructure } from './types'

/** Current generator version (letter series of any family in requested strata 2–6). */
export const SERIES_GENERATOR_VERSION = '1.5.0'
/** The version of M3.12 (the hard rule families, strata 5 and 6), before the letter templates. */
export const SERIES_HARD_GENERATOR_VERSION = '1.4.0'
/** The version before the hard families; saves made before M3.12 hold items of it. */
export const SERIES_LEGACY_GENERATOR_VERSION = '1.3.0'

/** The series family of one generator version (its version string is its fit set, `rules.ts` FIT_SETS). */
function seriesFamily(version: FitSet) {
  return defineFamily<SeriesSpec, SeriesKey, SeriesResponse>({
    name: 'series',
    kind: 'item',
    axis: 'MAT',
    facets: ['series'],
    generatorVersion: version,
    itemType: NUMERIC_ITEM_TYPE,
    strata: seriesStrataOf(version),
    build: (rng, ctx) => buildSeries(rng, ctx, version),
    verify: (item) => verifiers().series(item, version),
    score: scoreSeries,
  })
}

export const series = seriesFamily(SERIES_GENERATOR_VERSION)

/**
 * The earlier generators, by version: 1.4.0 (strata 1–6, the hard families, no letter templates)
 * and 1.3.0 (strata 1–5, the eight 1.3.0 rule families and their fit set). Not registered and
 * never served: `registry.ts` `resolveItem` rebuilds a saved item with its own version (A11,
 * R-8.1), byte for byte (the live pool of 2026-10-12 is 1.3.0, the hard pool of 2026-10-16 1.4.0).
 */
export const SERIES_LEGACY_FAMILIES = Object.freeze({
  [SERIES_HARD_GENERATOR_VERSION]: seriesFamily(SERIES_HARD_GENERATOR_VERSION),
  [SERIES_LEGACY_GENERATOR_VERSION]: seriesFamily(SERIES_LEGACY_GENERATOR_VERSION),
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
