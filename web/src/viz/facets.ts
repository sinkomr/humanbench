/**
 * Drill-down facet scores (DESIGN §9.6, §3 "sub-facets reported only in drill-down"; ROADMAP A7,
 * A12, M1.16).
 *
 * A12: a facet score is a unidimensional grid EAP (the engine's `eapAxis`, §11.2) on that facet's
 * items with the AXIS posterior as prior — N(θ_k, cov_kk) from the correlated model, the same
 * estimate the blob shows for the axis — and it is shown only at ≥ 5 items; below that the facet
 * shows "insufficient data" and no number (§9.6). A7: drill-down is by cluster wedge, so a
 * cluster's facets are those of its axes.
 *
 * Note (A12 as written): the axis posterior already contains the facet's own items, so the facet
 * interval is somewhat narrower than a posterior that counts them once. Revisit with M4 (followup).
 *
 * What counts toward the ≥ 5 (decision, M1.16 review): scored observations, as A12 reads. An item
 * is one; a block (A18 `BlockScore`: one digit-span, Corsi, RT, coding or reading administration)
 * is also ONE, because the scorer sees it as one observation (A10: one GRM or Gaussian likelihood
 * term), however many trials it had. So a block facet needs 5 administrations, e.g. over several
 * sessions, and until then shows "insufficient data (n blocks; 5 needed)", counted in blocks.
 * Whether a block's trials should count instead is an open question for an ADR (followup).
 *
 * A facet of an axis the blob does not measure (skipped, not offered, no data) is "not measured"
 * with the axis's reason, never "insufficient data".
 */

import { AXES, AXIS_INDEX, type AxisCode, type Cluster } from '../engine/axes'
import { eapAxis } from '../engine/scorer'
import type { Observation } from '../engine/types'
import { measuredFields, type AxisEstimate, type NotMeasuredReason, type ProfileScore, type SpokeEstimate } from './profile'

/** A12 / §9.6: facets with fewer items show "insufficient data". */
export const FACET_MIN_ITEMS = 5

/** One scored observation tagged with its item's facet (`ItemBase.facet`, family contract). */
export interface FacetObservation {
  readonly facet: string
  readonly obs: Observation
  /** From a block family (`kind: 'block'`, A18): one administration, counted as one (module comment). */
  readonly block?: boolean
}

/** What a facet's count counts: items, or block administrations (module comment). */
export type CountUnit = 'item' | 'block'

export interface FacetEstimate extends SpokeEstimate {
  readonly axis: AxisCode
  readonly facet: string
  /** Scored observations on this facet: items, or blocks (`unit`). */
  readonly nItems: number
  readonly unit: CountUnit
}

/** "3d_rotation" → "3d rotation"; "percent" → "Percent". */
export function facetLabel(facet: string): string {
  const s = facet.replace(/[_-]+/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * A facet estimate computed elsewhere: the server's own-axis posterior for the facets of the parts it
 * scores (M2.7, `rescore`; the page never holds those answers' verdicts, R-11.1), as mean, sd (SD
 * units) and the number of answers behind it. The server shows a facet only from 5 answers of one
 * session, the same bar as {@link FACET_MIN_ITEMS}.
 */
export interface PrecomputedFacet {
  readonly mean: number
  readonly sd: number
  readonly n: number
}

export interface FacetOptions {
  /** Known facets per axis, listed even with no items (e.g. from the family registry). */
  readonly catalog?: Partial<Record<AxisCode, readonly string[]>>
  /** Facet estimates that arrive computed (the server's, M2.7), per axis and facet; they replace a local estimate of the same facet. */
  readonly precomputed?: Readonly<Partial<Record<AxisCode, Readonly<Record<string, PrecomputedFacet>>>>>
  /**
   * Axes that are not measured on the blob, with the reason (skipped, not offered, no data): their
   * facets get no number and show that reason ({@link unmeasuredReasons}).
   */
  readonly unmeasured?: Readonly<Partial<Record<AxisCode, NotMeasuredReason>>>
}

/** The {@link FacetOptions.unmeasured} map of a blob's axis estimates. */
export function unmeasuredReasons(estimates: readonly AxisEstimate[]): Partial<Record<AxisCode, NotMeasuredReason>> {
  const out: Partial<Record<AxisCode, NotMeasuredReason>> = {}
  for (const e of estimates) if (!e.measured) out[e.code] = e.reason ?? 'no_data'
  return out
}

/**
 * Facet estimates for the axes of `cluster`, grouped by axis in canonical order, facets in catalog
 * order then first appearance. A facet with ≥ {@link FACET_MIN_ITEMS} observations on a measured
 * axis is measured; a facet of an unmeasured axis is a stub with the axis's reason; any other is a
 * stub with reason 'insufficient_data' (§9.6: "insufficient data").
 */
export function clusterFacets(score: ProfileScore, observations: readonly FacetObservation[], cluster: Cluster, opts: FacetOptions = {}): FacetEstimate[] {
  const unmeasured = opts.unmeasured ?? {}
  const out: FacetEstimate[] = []
  for (const a of AXES) {
    if (a.cluster !== cluster) continue
    const mine = observations.filter((o) => o.obs.axis === a.code)
    const pre = opts.precomputed?.[a.code] ?? {}
    const facets = [...new Set([...(opts.catalog?.[a.code] ?? []), ...mine.map((o) => o.facet), ...Object.keys(pre)])]
    for (const facet of facets) {
      const tagged = mine.filter((o) => o.facet === facet)
      const obs = tagged.map((o) => o.obs)
      const base = {
        id: `${a.code}:${facet}`,
        axis: a.code,
        facet,
        name: `${facetLabel(facet)} (${a.name})`,
        shortLabel: [facetLabel(facet)],
        group: a.name,
        tier: a.tier,
        glyph: a.glyph,
        nItems: obs.length,
        unit: tagged.length > 0 && tagged.every((o) => o.block === true) ? ('block' as const) : ('item' as const),
      }
      const axisReason = unmeasured[a.code]
      if (axisReason !== undefined) {
        out.push({ ...base, measured: false, reason: axisReason, muted: false })
        continue
      }
      const given = Object.hasOwn(pre, facet) ? pre[facet] : undefined
      if (given !== undefined) {
        out.push({ ...base, nItems: given.n, unit: 'item', ...measuredFields(given.mean, given.sd) })
        continue
      }
      if (obs.length < FACET_MIN_ITEMS) {
        out.push({ ...base, measured: false, reason: 'insufficient_data', muted: false })
        continue
      }
      const k = AXIS_INDEX[a.code]
      const est = eapAxis(obs, score.theta[k]!, score.cov[k]![k]!)
      out.push({ ...base, ...measuredFields(est.mean, est.sd) })
    }
  }
  return out
}
