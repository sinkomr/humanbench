/**
 * Quantitative reasoning (M1.8; DESIGN §3 row 6 "Arithmetic → algebra", §4.2 "Math", §14.6
 * example 3): numeric-entry items from templates across strata 1–4, with exact rational keys and
 * a per-item tolerance. Axis QR, item type `numeric` (the shared `NUMERIC_ITEM_TYPE` and
 * `NumericKey` of `family.ts`, as series) → 2PL (A9); family_id = the template variant (A11).
 * Version 1.1.0: item type "numeric" and b on the stratum's default band (`prior.ts`). The spec
 * (templates, rules, stems) is in `templates.ts`, the verifier in `verify.ts`, the prior in
 * `prior.ts`; the bank's `hb.gen.quant` is the Python twin.
 *
 * Facets and siblings (M1.F2): an item's facet is its template ("percent", "system", …; the
 * family declares them all, `QUANT_TEMPLATES`), and the variants of one template form one
 * sibling group `g:quant:<template>`, so a session serves at most one item per template (M1.14)
 * while family_id stays per variant (A11 amended). Version 1.2.0: facet by template,
 * `sibling_group`, and the shared power-item cap `time_limit_s` (§13).
 */

import { NUMERIC_ITEM_TYPE, defineFamily, type ItemInstance } from '../family'
import { QUANT_STRATA, buildQuant, type QuantKey, type QuantSpec } from './gen'
import { QUANT_TEMPLATES } from './templates'
import { scoreQuant, type QuantResponse } from './score'
import { variantOf } from './templates'
import { verifyQuant } from './verify'

export type { QuantKey, QuantSpec } from './gen'
export { QUANT_TEMPLATES, quantSiblingGroup } from './templates'
export type { QuantResponse } from './score'
export type QuantItem = ItemInstance<QuantSpec, QuantKey>

export const quant = defineFamily<QuantSpec, QuantKey, QuantResponse>({
  name: 'quant',
  kind: 'item',
  axis: 'QR',
  facets: QUANT_TEMPLATES,
  generatorVersion: '1.2.0',
  itemType: NUMERIC_ITEM_TYPE,
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
