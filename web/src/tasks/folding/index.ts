/**
 * Paper folding (fold and punch, ETS VZ-2 style; DESIGN §3 row 7 "paper folding", §4.1, §4.2, §12;
 * ROADMAP A1, A9, A11): axis SPA, facet `paper_folding`, item type `mc_image_spec`, five options →
 * 2PL (A9), kind 'item', strata 1–6.
 *
 * "A square sheet of paper is folded as shown, then a hole is punched through every layer. Which
 * option shows the sheet when it is unfolded?" (`render/folding/copy.ts`). The sheet is a 4 × 4 or
 * 6 × 6 grid of hole slots; 1–3 half folds (vertical, horizontal or
 * diagonal, `geometry.ts`), then 1–3 punches through every layer. The key is the unfolded sheet;
 * the four distractors are each wrong for a recorded reason (a missed unfold, a wrong unfold line, a
 * mirror image, an extra layer, a moved or an extra hole; `spec.ts`), and the key's place among
 * them is balanced against option-only cues (`cues.ts`, `gen.ts`).
 *
 * - `gen.ts`: the generator; `verify.ts`: the verifier (G2/G3, kept out of production chunks: this
 *   module reaches it only through `../verifier-slot`); `score.ts`; `prior.ts`: the [SPEC] v0 prior;
 *   `geometry.ts`: the exact integer fold geometry (shared with the renderer); `cues.ts`: the
 *   option-only cues; `spec.ts`: the wire types and `specProblems`.
 * - Python twin: the bank's `hb.gen.folding`, which verifies `golden/ts_dumps/folding.json`
 *   (`npx tsx scripts/dump-families.ts --module src/tasks/folding/index.ts --family folding --n 1000 --bank`).
 */

import { defineFamily, type ItemInstance } from '../family'
import { verifiers } from '../verifier-slot'
import { FOLDING_STRATA, buildFolding } from './gen'
import { scoreFolding } from './score'
import type { FoldingKey, FoldingResponse, FoldingSpec } from './spec'

export const FOLDING_GENERATOR_VERSION = '1.0.0'

export const folding = defineFamily<FoldingSpec, FoldingKey, FoldingResponse>({
  name: 'folding',
  kind: 'item',
  axis: 'SPA',
  facets: ['paper_folding'],
  generatorVersion: FOLDING_GENERATOR_VERSION,
  itemType: 'mc_image_spec',
  strata: FOLDING_STRATA,
  build: buildFolding,
  verify: (item) => verifiers().folding(item),
  score: scoreFolding,
})

/** The spec fields a folding item may carry (the family's `specLeaksKey` check). */
export const FOLDING_SPEC_FIELDS: readonly string[] = Object.freeze(['grid', 'folds', 'punches', 'options'])

/**
 * The family's leak predicate (`runFamilyProperties` `specLeaksKey`): only the four spec fields, and
 * every option an object with nothing but its sorted holes (no per-option field that could mark one).
 */
export function foldingSpecLeaksKey(item: ItemInstance<FoldingSpec, FoldingKey>): string | null {
  const extra = Object.keys(item.spec).filter((k) => !FOLDING_SPEC_FIELDS.includes(k))
  if (extra.length > 0) return `unexpected spec fields: ${extra.join(', ')}`
  const odd = item.spec.options.findIndex((o) => Object.keys(o).join(',') !== 'holes')
  if (odd >= 0) return `options[${odd}] has fields other than holes`
  const fold = item.spec.folds.findIndex((f) => Object.keys(f).sort().join(',') !== 'line,moving')
  if (fold >= 0) return `folds[${fold}] has fields other than line and moving`
  return null
}

export type { FoldStep, FoldingFeatures, FoldingItem, FoldingKey, FoldingOption, FoldingResponse, FoldingSpec, FoldingStructure, Slot } from './spec'
export default folding
