/**
 * The quant generator (M1.8, DESIGN §4.2 "Math", ROADMAP A1, A11): pick a stratum (or honour the
 * requested one), a template of that stratum, a variant of it, then draw its `given` and render
 * the stem, all from the seeded stream. The key is the exact rational answer by the generator's
 * route (`VariantDef.compute`); `verify.ts` recomputes it independently.
 */

import type { Rng } from '../../engine'
import type { BuildContext, BuiltItem, NumericKey } from '../family'
import type { Stratum } from '../ids'
import { QUANT_PROVENANCE, QUANT_SD_PRIOR, quantBPrior, quantExpectedTime, quantFeatures } from './prior'
import { HINTS, TEMPLATES_BY_STRATUM, quantSiblingGroup, toleranceFor, variantsOf, type Given, type InputFormat } from './templates'

/** Strata the family generates (§6.ii 1–6: middle school to olympiad; 5 and 6 since generator 1.4.0, M3.12). */
export const QUANT_STRATA: readonly Stratum[] = Object.freeze([1, 2, 3, 4, 5, 6] as const)

/** Strata of generator 1.3.0, kept for its saved items (`QUANT_LEGACY_FAMILIES`). */
export const QUANT_STRATA_V130: readonly Stratum[] = Object.freeze([1, 2, 3, 4] as const)

/** The render payload: stem, input hint and format, and the quantities the stem shows. Never the key. */
export interface QuantSpec {
  readonly stem: string
  readonly hint: string
  readonly input_format: InputFormat
  readonly given: Given
}

/** Exact rational key ("p" or "p/q", lowest terms) and its tolerance (§4.2): the shared {@link NumericKey}. */
export type QuantKey = NumericKey

/** `{ sibling_group }` for a grouped near-isomorph variant; nothing (its family_id) otherwise (M1.F2). */
function siblingOf(template: string, variant: string): { sibling_group?: string } {
  const g = quantSiblingGroup(template, variant)
  return g === undefined ? {} : { sibling_group: g }
}

/**
 * The build of a generator version: its strata (the unforced draw picks one of them first) and its
 * prior's provenance text. Strata 1–4 draw exactly as in 1.3.0 (same tables, same stream), so the
 * 1.3.0 generator is this build over strata 1–4 with the 1.3.0 provenance.
 */
export function quantBuilder(strata: readonly Stratum[], provenance: string): (rng: Rng, ctx: BuildContext) => BuiltItem<QuantSpec, QuantKey> {
  return (rng, ctx) => buildWith(rng, ctx, strata, provenance)
}

export const buildQuant = quantBuilder(QUANT_STRATA, QUANT_PROVENANCE)

function buildWith(rng: Rng, ctx: BuildContext, strata: readonly Stratum[], provenance: string): BuiltItem<QuantSpec, QuantKey> {
  const stratum = ctx.stratum ?? rng.pick(strata)
  const template = rng.pick(TEMPLATES_BY_STRATUM[stratum])
  const variant = rng.pick(variantsOf(template))
  const given = variant.draw(rng)
  const stem = variant.render(given)
  const value = variant.compute(given)
  const features = quantFeatures(variant.template, variant.variant, stratum, variant.offset, !value.isInteger())
  return {
    stratum,
    facet: variant.template,
    ...siblingOf(variant.template, variant.variant),
    spec: { stem, hint: HINTS[variant.format], input_format: variant.format, given },
    key: { value: value.toString(), tol: toleranceFor(variant.format) },
    structural_params: { template: variant.template, variant: variant.variant },
    difficulty: { features, b_prior: quantBPrior(features), sd_prior: QUANT_SD_PRIOR, provenance },
    expected_time_s: quantExpectedTime(stratum, stem),
  }
}
