/**
 * The qdata generator (DESIGN §4.2 "Math", ROADMAP A1, A11): pick a stratum (or honour the requested
 * one), a template of that stratum, a variant of it, then draw its exhibit and `given` and render
 * the stem, all from the seeded stream. The key is the variant's intended answer (`Drawn.value`);
 * `verify.ts` recomputes it forward from the spec alone.
 */

import type { Rng } from '../../engine'
import type { BuildContext, BuiltItem, NumericKey } from '../family'
import type { Stratum } from '../ids'
import { HINTS } from '../quant/kit'
import type { Fraction } from '../quant/fraction'
import { stratumOfB } from '../priors'
import { QDATA_PROVENANCE, QDATA_SD_PRIOR, qdataBPrior, qdataExpectedTime, qdataFeatures, type QdataFeatures } from './prior'
import type { QdataExhibit, QdataGiven, QdataSpec } from './spec'
import { TEMPLATES_BY_STRATUM, qdataSiblingGroup, variantsOf, type VariantDef } from './templates'

/** Strata the family generates (§6.ii 1–6). */
export const QDATA_STRATA: readonly Stratum[] = Object.freeze([1, 2, 3, 4, 5, 6] as const)

/** Exact rational key, tolerance `{ abs: 0 }`: the shared {@link NumericKey}. */
export type QdataKey = NumericKey

export const QDATA_TOL = Object.freeze({ abs: 0 })

/** A negative number on the exhibit, in `given`, or as the answer. */
export function hasNegatives(exhibit: QdataExhibit | undefined, given: QdataGiven, value: Fraction): boolean {
  const nums: number[] = Object.values(given).filter((v): v is number => typeof v === 'number')
  if (exhibit?.kind === 'table') for (const r of exhibit.rows) nums.push(...r.values)
  else if (exhibit) for (const s of exhibit.series) nums.push(...s.values)
  return value.sign() < 0 || nums.some((x) => x < 0)
}

/** The features of an item of variant `v` (shared by the generator and the verifier). */
export function featuresOf(v: VariantDef, exhibit: QdataExhibit | undefined, given: QdataGiven, value: Fraction): QdataFeatures {
  return qdataFeatures({
    template: v.template,
    variant: v.variant,
    stratum: v.stratum,
    steps: v.steps,
    cells_read: v.cellsRead(exhibit, given),
    percent: v.percent,
    non_integer: !value.isInteger(),
    negatives: hasNegatives(exhibit, given, value),
    reversal: v.reversal,
  })
}

export function buildQdata(rng: Rng, ctx: BuildContext): BuiltItem<QdataSpec, QdataKey> {
  const stratum = ctx.stratum ?? rng.pick(QDATA_STRATA)
  const template = rng.pick(TEMPLATES_BY_STRATUM[stratum])
  const v = rng.pick(variantsOf(template))
  const { exhibit, given, value } = v.draw(rng)
  const stem = v.render(exhibit, given)
  const features = featuresOf(v, exhibit, given, value)
  const b = qdataBPrior(features)
  if (stratumOfB(b) !== stratum) throw new Error(`qdata ${template}/${v.variant}: b ${b} is not in stratum ${stratum}`)
  const group = qdataSiblingGroup(v.template, v.variant)
  const spec: QdataSpec = { stem, hint: HINTS[v.format], input_format: v.format, given, ...(exhibit === undefined ? {} : { exhibit }) }
  return {
    stratum,
    facet: v.template,
    ...(group === undefined ? {} : { sibling_group: group }),
    spec,
    key: { value: value.toString(), tol: { ...QDATA_TOL } },
    structural_params: { template: v.template, variant: v.variant },
    difficulty: { features, b_prior: b, sd_prior: QDATA_SD_PRIOR, provenance: QDATA_PROVENANCE },
    expected_time_s: qdataExpectedTime(stem, features.cells_read, v.steps),
  }
}
