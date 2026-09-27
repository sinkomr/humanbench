/**
 * Quantitative reasoning (M1.8; DESIGN §3 row 6 "Arithmetic → algebra", §4.2 "Math", §14.6
 * example 3): numeric-entry items from templates across strata 1–4, with exact rational keys and
 * a per-item tolerance. Axis QR, item type `numeric_entry` → 2PL (A9); family_id = the template
 * variant (A11). The spec (templates, rules, stems) is in `templates.ts`, the verifier in
 * `verify.ts`, the prior in `prior.ts`; the bank's `hb.gen.quant` is the Python twin.
 *
 * The contract gives a family one `facet` (`validateItemInstance` requires item.facet ===
 * family.facet), so the facet is "quant" and the template is carried in `structural_params` and
 * `difficulty.features` for drill-down.
 */

import { defineFamily, type ItemInstance } from '../family'
import { QUANT_STRATA, buildQuant, type QuantKey, type QuantSpec } from './gen'
import { scoreQuant, type QuantResponse } from './score'
import { variantOf } from './templates'
import { verifyQuant } from './verify'

export type { QuantKey, QuantSpec } from './gen'
export type { QuantResponse } from './score'
export type QuantItem = ItemInstance<QuantSpec, QuantKey>

export const quant = defineFamily<QuantSpec, QuantKey, QuantResponse>({
  name: 'quant',
  axis: 'QR',
  facet: 'quant',
  generatorVersion: '1.0.0',
  itemType: 'numeric_entry',
  strata: QUANT_STRATA,
  build: buildQuant,
  verify: verifyQuant,
  score: scoreQuant,
})

const SPEC_FIELDS = ['given', 'hint', 'input_format', 'stem']

/**
 * The family's leak check (`runFamilyProperties` `specLeaksKey`): the spec holds only stem, hint,
 * input_format and given, and `given` holds exactly its variant's declared fields, so no solution
 * value (a root, x₀, a count) can ride along in the render payload.
 */
export function quantSpecLeaksKey(item: QuantItem): string | null {
  const keys = Object.keys(item.spec).sort()
  if (keys.join(',') !== SPEC_FIELDS.join(',')) return `spec fields are ${keys.join(', ')}, not ${SPEC_FIELDS.join(', ')}`
  const sp = item.structural_params as { template?: unknown; variant?: unknown }
  const v = variantOf(sp.template, sp.variant)
  if (!v) return 'unknown template variant'
  const want = Object.keys(v.fields).sort().join(',')
  const got = Object.keys(item.spec.given).sort().join(',')
  return got === want ? null : `given fields are ${got}, not ${want}`
}

export default quant
