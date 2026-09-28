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
 */

import { AXES, AXIS_INDEX, type AxisCode, type Cluster } from '../engine/axes'
import { eapAxis } from '../engine/scorer'
import type { Observation } from '../engine/types'
import { measuredFields, type ProfileScore, type SpokeEstimate } from './profile'

/** A12 / §9.6: facets with fewer items show "insufficient data". */
export const FACET_MIN_ITEMS = 5

/** One scored observation tagged with its item's facet (`ItemBase.facet`, family contract). */
export interface FacetObservation {
  readonly facet: string
  readonly obs: Observation
}

export interface FacetEstimate extends SpokeEstimate {
  readonly axis: AxisCode
  readonly facet: string
  /** Items (observations) on this facet. */
  readonly nItems: number
}

/** "3d_rotation" → "3d rotation"; "percent" → "Percent". */
export function facetLabel(facet: string): string {
  const s = facet.replace(/[_-]+/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export interface FacetOptions {
  /** Known facets per axis, listed even with no items (e.g. from the family registry). */
  readonly catalog?: Partial<Record<AxisCode, readonly string[]>>
  /** Axes that are not measured on the blob (skipped or no data): their facets get no number. */
  readonly unmeasured?: readonly AxisCode[]
}

/**
 * Facet estimates for the axes of `cluster`, grouped by axis in canonical order, facets in catalog
 * order then first appearance. A facet with ≥ {@link FACET_MIN_ITEMS} items on a measured axis is
 * measured; any other is a stub with reason 'insufficient_data' (§9.6: "insufficient data").
 */
export function clusterFacets(score: ProfileScore, observations: readonly FacetObservation[], cluster: Cluster, opts: FacetOptions = {}): FacetEstimate[] {
  const unmeasured = new Set(opts.unmeasured ?? [])
  const out: FacetEstimate[] = []
  for (const a of AXES) {
    if (a.cluster !== cluster) continue
    const mine = observations.filter((o) => o.obs.axis === a.code)
    const facets = [...new Set([...(opts.catalog?.[a.code] ?? []), ...mine.map((o) => o.facet)])]
    for (const facet of facets) {
      const obs = mine.filter((o) => o.facet === facet).map((o) => o.obs)
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
      }
      if (obs.length < FACET_MIN_ITEMS || unmeasured.has(a.code)) {
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
