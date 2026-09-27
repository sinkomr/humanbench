/**
 * Test-only helpers for the quant family's tests (never imported by app code): find a generated
 * item of a given template variant, and rebuild an item around a hand-made `given` exactly as the
 * generator would, so a negative test changes one thing at a time.
 */

import type { JsonValue } from '../../engine'
import type { QuantItem } from '.'
import { quant } from '.'
import { QUANT_PROVENANCE, QUANT_SD_PRIOR, quantBPrior, quantExpectedTime, quantFeatures } from './prior'
import { HINTS, toleranceFor, variantOf, type Given, type VariantDef } from './templates'
import { quantSolve } from './verify'

export function variantDef(template: string, variant: string): VariantDef {
  const v = variantOf(template, variant)
  if (!v) throw new Error(`no variant ${template}/${variant}`)
  return v
}

/** The first generated item (seeds `<template>/<variant>-<i>`) of this template variant. */
export function sampleOf(template: string, variant: string): QuantItem {
  const v = variantDef(template, variant)
  for (let i = 0; i < 5_000; i++) {
    const item = quant.generate(`${template}/${variant}-${i}`, { stratum: v.stratum })
    const sp = item.structural_params as { template: string; variant: string }
    if (sp.template === template && sp.variant === variant) return item
  }
  throw new Error(`no sample of ${template}/${variant}`)
}

/** A deep copy through JSON (what the dump and the bank see). */
export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

/**
 * `item` with `given` replaced (merged over the old one; `null` deletes a field) and the stem,
 * key, features, prior and time recomputed as the generator would. The key is the generator's
 * answer, else the verifier's, else "0" when neither route can solve the new `given`.
 */
export function withGiven(item: QuantItem, patch: Readonly<Record<string, JsonValue | null>>): QuantItem {
  const sp = item.structural_params as { template: string; variant: string }
  const v = variantDef(sp.template, sp.variant)
  const given: Record<string, JsonValue> = { ...item.spec.given }
  for (const [k, x] of Object.entries(patch)) {
    if (x === null) delete given[k]
    else given[k] = x
  }
  let stem = item.spec.stem
  try {
    stem = v.render(given)
  } catch {
    // keep the old stem when the new given cannot be rendered
  }
  let value: string
  try {
    value = v.compute(given as Given).toString()
  } catch {
    value = quantSolve(v, given as Given)?.toString() ?? '0'
  }
  const nonInteger = value.includes('/')
  const features = quantFeatures(v.template, v.variant, v.stratum, v.offset, nonInteger)
  const b = quantBPrior(features)
  return clone<QuantItem>({
    ...item,
    spec: { stem, hint: HINTS[v.format], input_format: v.format, given },
    key: { value, tol: toleranceFor(v.format) },
    params: { model: '2pl', a: item.params.model === '2pl' ? item.params.a : 1, b },
    difficulty: { features, b_prior: b, sd_prior: QUANT_SD_PRIOR, provenance: QUANT_PROVENANCE },
    expected_time_s: quantExpectedTime(v.stratum as 1 | 2 | 3 | 4, stem),
  })
}
