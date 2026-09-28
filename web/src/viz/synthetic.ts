/**
 * Synthetic profiles for the blob tests, bench and the dev-only demo route (ROADMAP M1.16). Each
 * simulates a seeded person answering synthetic items, then scores them with the real engine
 * (`scoreAll`), so the viz is exercised on genuine scorer output (MAP/cov + per-axis EAP). Not
 * used by production code (tree-shaken; the demo route is dev-only).
 */

import { AXES, type AxisCode } from '../engine/axes'
import { grmProbs, logistic } from '../engine/irt'
import { createRng, type Rng } from '../engine/prng'
import { scoreAll } from '../engine/scorer'
import type { Observation } from '../engine/types'
import type { FacetObservation } from './facets'
import type { ProfileInput } from './profile'

/** Facets of block families (A18 `kind: 'block'`): each observation is one administration. */
const BLOCK_FACETS: ReadonlySet<string> = new Set(['digits_forward', 'digits_backward', 'corsi', 'simple_rt', 'choice_rt', 'coding', 'reading_speed'])

/** How many observations of which facet an axis gets. */
type AxisPlan = Partial<Record<AxisCode, readonly (readonly [facet: string, n: number])[]>>

export interface SyntheticProfile {
  readonly id: string
  readonly label: string
  readonly input: ProfileInput
  readonly facetObservations: readonly FacetObservation[]
  readonly catalog: Partial<Record<AxisCode, readonly string[]>>
}

/** Simulate one observation on `axis` at true θ, with the axis's default model (§7.1, A9, A10). */
function simulate(rng: Rng, axis: AxisCode, theta: number): Observation {
  const def = AXES.find((a) => a.code === axis)!
  const a = 0.8 + 1.2 * rng.next()
  const b = rng.normal(0, 1)
  switch (def.defaultModelKind) {
    case 'grm': {
      const bs = [b - 1, b, b + 1]
      const probs = grmProbs(theta, 1.5, bs)
      let u = rng.next()
      let y = 0
      while (y < bs.length && u >= probs[y]!) u -= probs[y++]!
      return { kind: 'grm', axis, a: 1.5, b: bs, y }
    }
    case 'gaussian':
      return { kind: 'gaussian', axis, lam: 1, d: 0, sigma: 0.45, x: theta + rng.normal(0, 0.45) }
    case '3pl': {
      const c = 0.25
      return { kind: '3pl', axis, a, b, c, y: rng.next() < c + (1 - c) * logistic(a * (theta - b)) ? 1 : 0 }
    }
    default:
      return { kind: '2pl', axis, a, b, y: rng.next() < logistic(a * (theta - b)) ? 1 : 0 }
  }
}

function build(id: string, label: string, truth: Partial<Record<AxisCode, number>>, plan: AxisPlan, skipped: readonly AxisCode[] = []): SyntheticProfile {
  const rng = createRng(`hb-demo-${id}`)
  const facetObservations: FacetObservation[] = []
  for (const a of AXES) {
    for (const [facet, n] of plan[a.code] ?? []) {
      for (let i = 0; i < n; i++) {
        const obs = simulate(rng, a.code, truth[a.code] ?? 0)
        facetObservations.push(BLOCK_FACETS.has(facet) ? { facet, obs, block: true } : { facet, obs })
      }
    }
  }
  const score = scoreAll(facetObservations.map((o) => o.obs))
  const catalog: Partial<Record<AxisCode, readonly string[]>> = {}
  for (const [code, facets] of Object.entries(plan) as [AxisCode, readonly (readonly [string, number])[]][]) catalog[code] = facets.map(([f]) => f)
  return { id, label, input: { score, skipped }, facetObservations, catalog }
}

/** The M1 axes (A15 block order) with their registered facets (family contract `facets`). */
const M1_PLAN: AxisPlan = {
  MAT: [
    ['matrix', 12],
    ['series', 9],
  ],
  QR: [
    ['percent', 6],
    ['arith', 5],
    ['fraction', 3],
    ['ratio', 2],
  ],
  SPA: [['3d_rotation', 16]],
  WM: [
    ['digits_forward', 1],
    ['digits_backward', 1],
    ['corsi', 1],
  ],
  RT: [
    ['simple_rt', 1],
    ['choice_rt', 1],
  ],
  PS: [
    ['coding', 1],
    ['reading_speed', 1],
  ],
  CAL: [['confidence', 1]],
}

const M1_TRUTH: Partial<Record<AxisCode, number>> = { MAT: 1.3, QR: 0.7, SPA: -0.3, WM: 0.4, RT: -1.1, PS: 1.6, CAL: 0.1 }

/** Every axis measured (a later version), including the tier (c) axes that get the hatch. */
const FULL_PLAN: AxisPlan = {
  ...M1_PLAN,
  LR: [
    ['flaw', 6],
    ['assumption', 6],
  ],
  LG: [['ordering', 10]],
  RC: [['passage', 12]],
  VOC: [
    ['synonyms', 6],
    ['analogies', 5],
  ],
  FER: [['fermi', 4]],
  KST: [
    ['physics', 5],
    ['chemistry', 5],
    ['biology', 4],
    ['computing', 6],
  ],
  KHU: [
    ['history', 6],
    ['geography', 6],
    ['literature', 3],
  ],
  KAP: [
    ['music', 5],
    ['personal_finance', 7],
  ],
  EMO: [['appraisal', 12]],
  CRE: [['remote_associates', 10]],
}

const FULL_TRUTH: Partial<Record<AxisCode, number>> = {
  ...M1_TRUTH,
  LR: 0.9,
  LG: 1.8,
  RC: 0.2,
  VOC: -0.6,
  FER: 0.5,
  KST: 2.1,
  KHU: -1.4,
  KAP: 0.3,
  EMO: -0.2,
  CRE: 1.1,
}

/** Few items per axis: wide intervals, so most spokes are muted (§9.5). */
const SPARSE_PLAN: AxisPlan = {
  MAT: [['matrix', 3]],
  QR: [['percent', 2]],
  SPA: [['3d_rotation', 3]],
  RT: [['simple_rt', 1]],
}

export const SYNTHETIC_PROFILES: readonly SyntheticProfile[] = Object.freeze([
  build('m1', 'Typical first session', M1_TRUTH, M1_PLAN),
  build('full', 'Every skill measured', FULL_TRUTH, FULL_PLAN),
  build('skipped', 'Spatial skipped', M1_TRUTH, M1_PLAN, ['SPA']),
  build('sparse', 'Very few items', M1_TRUTH, SPARSE_PLAN),
])

export function syntheticProfile(id: string): SyntheticProfile | undefined {
  return SYNTHETIC_PROFILES.find((p) => p.id === id)
}
