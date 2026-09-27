/**
 * The quant generator (M1.8, DESIGN §4.2 "Math", ROADMAP A1, A11): pick a stratum (or honour the
 * requested one), a template of that stratum, a variant of it, then draw its `given` and render
 * the stem, all from the seeded stream. The key is the exact rational answer by the generator's
 * route (`VariantDef.compute`); `verify.ts` recomputes it independently.
 */

import type { Rng } from '../../engine'
import type { BuildContext, BuiltItem } from '../family'
import type { Stratum } from '../ids'
import type { Tolerance } from './numeric'
import { QUANT_PROVENANCE, QUANT_SD_PRIOR, quantBPrior, quantExpectedTime, quantFeatures } from './prior'
import { HINTS, TEMPLATES_BY_STRATUM, toleranceFor, variantsOf, type Given, type InputFormat } from './templates'

/** Strata the family generates (§6.ii 1–4: middle school to college). */
export const QUANT_STRATA: readonly Stratum[] = Object.freeze([1, 2, 3, 4] as const)

/** The render payload: stem, input hint and format, and the quantities the stem shows. Never the key. */
export interface QuantSpec {
  readonly stem: string
  readonly hint: string
  readonly input_format: InputFormat
  readonly given: Given
}

/** Exact rational key ("p" or "p/q", lowest terms) and its tolerance (§4.2). */
export interface QuantKey {
  readonly value: string
  readonly tol: Tolerance
}

export function buildQuant(rng: Rng, ctx: BuildContext): BuiltItem<QuantSpec, QuantKey> {
  const stratum = (ctx.stratum ?? rng.pick(QUANT_STRATA)) as 1 | 2 | 3 | 4
  const template = rng.pick(TEMPLATES_BY_STRATUM[stratum])
  const variant = rng.pick(variantsOf(template))
  const given = variant.draw(rng)
  const stem = variant.render(given)
  const value = variant.compute(given)
  const features = quantFeatures(variant.template, variant.variant, stratum, variant.offset, !value.isInteger())
  return {
    stratum,
    spec: { stem, hint: HINTS[variant.format], input_format: variant.format, given },
    key: { value: value.toString(), tol: toleranceFor(variant.format) },
    structural_params: { template: variant.template, variant: variant.variant },
    difficulty: { features, b_prior: quantBPrior(features), sd_prior: QUANT_SD_PRIOR, provenance: QUANT_PROVENANCE },
    expected_time_s: quantExpectedTime(stratum, stem),
  }
}
