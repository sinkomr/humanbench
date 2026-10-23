/**
 * Data interpretation and everyday word problems (axis QR; DESIGN §3 row 6, §4.2 "Math"; scope
 * variety): numeric-entry items that read a small table, bar chart or line chart of integers
 * (`dt_*` templates) or work out an everyday money, time, rate or mixture problem (`wp_*`), over
 * strata 1–6, with exact rational keys (`{ value, tol: { abs: 0 } }`, the shared `NumericKey`) and
 * quant's exact entry grammar. Item type `numeric` → 2PL (A9). Facet = template; family_id = the
 * template variant (A11); the variants of a multi-variant template form one sibling group
 * `g:qdata:<label>` (M1.14).
 *
 * Files: `spec.ts` (wire types, `specProblems` for the renderer), `settings.ts` (the wording),
 * `templates.ts` (the template table), `gen.ts`, `prior.ts` ([SPEC] v0), `score.ts`, and
 * `verify.ts` (G2/G3; reached only through the verifier slot, so it stays out of production
 * chunks). The bank's `hb.gen.qdata` is the Python twin.
 */

import { NUMERIC_ITEM_TYPE, defineFamily, type ItemInstance } from '../family'
import { verifiers } from '../verifier-slot'
import { QDATA_STRATA, buildQdata, type QdataKey } from './gen'
import { scoreQdata, type QdataResponse } from './score'
import type { QdataSpec } from './spec'
import { QDATA_TEMPLATES, variantOf } from './templates'

export type { QdataKey } from './gen'
export type { QdataResponse } from './score'
export type { QdataSpec, QdataExhibit } from './spec'
export { specProblems } from './spec'
export { QDATA_SIBLING_SETS, QDATA_TEMPLATES, qdataSiblingGroup } from './templates'
export type QdataItem = ItemInstance<QdataSpec, QdataKey>

export const qdata = defineFamily<QdataSpec, QdataKey, QdataResponse>({
  name: 'qdata',
  kind: 'item',
  axis: 'QR',
  facets: QDATA_TEMPLATES,
  generatorVersion: '1.0.0',
  itemType: NUMERIC_ITEM_TYPE,
  strata: QDATA_STRATA,
  build: buildQdata,
  verify: (item) => verifiers().qdata(item),
  score: scoreQdata,
})

/**
 * The family's leak check (`runFamilyProperties` `specLeaksKey`): the spec holds only stem, hint,
 * input_format, given and (for an exhibit template) exhibit; `given` holds exactly its variant's
 * declared fields; a word problem has no exhibit and an exhibit template has one of its kind. So no
 * total, mean or other result can ride along in the render payload.
 */
export function qdataSpecLeaksKey(item: QdataItem): string | null {
  const sp = item.structural_params as { template?: unknown; variant?: unknown }
  const v = variantOf(sp.template, sp.variant)
  if (!v) return 'unknown template variant'
  const want = ['given', 'hint', 'input_format', 'stem', ...(v.exhibit ? ['exhibit'] : [])].sort().join(',')
  const keys = Object.keys(item.spec).sort().join(',')
  if (keys !== want) return `spec fields are ${keys}, not ${want}`
  const got = Object.keys(item.spec.given).sort().join(',')
  const fields = [...v.fields].sort().join(',')
  if (got !== fields) return `given fields are ${got}, not ${fields}`
  if (v.exhibit && item.spec.exhibit?.kind !== v.exhibit) return `exhibit is not a ${v.exhibit}`
  return null
}

export default qdata
