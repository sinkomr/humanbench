/**
 * Formal deduction (axis LR, facet `formal_logic`; DESIGN §3 row 2 "formal syllogisms", §4.2 "formal logic: check
 * validity with Z3 or a propositional truth table"; scope variety): five-option items over three templates
 * (`categorical` syllogisms, `chain` sorites, everyday `conditional` statements) and three questions (must be true,
 * could be true, must be false), over strata 1–6, keyed `{ index }` and proved by exact model enumeration under both
 * readings of existential import. Item type `mc_text`, 5 options → 2PL (A9). family_id = the item's logical structure
 * up to renaming its terms (A11).
 *
 * Files: `lexicon.ts` (the words), `logic.ts` (semantics, text, structure), `item.ts` (reading a spec back, features,
 * cue checks), `gen.ts`, `prior.ts` ([SPEC] v0), `score.ts`, `spec.ts` (wire types, `specProblems` for the renderer),
 * and `verify.ts` (G2/G3; reached only through the verifier slot, so it stays out of production chunks). The bank's
 * `hb.gen.syllogism` is the Python twin.
 */

import { defineFamily, type ItemInstance } from '../family'
import { verifiers } from '../verifier-slot'
import { SYLLOGISM_STRATA, buildSyllogism } from './gen'
import { scoreSyllogism } from './score'
import type { SyllogismKey, SyllogismResponse, SyllogismSpec } from './spec'

export type { SyllogismKey, SyllogismResponse, SyllogismSpec } from './spec'
export { SYLLOGISM_OPTIONS, specProblems } from './spec'
export { SYLLOGISM_STRATA } from './gen'
export type SyllogismItem = ItemInstance<SyllogismSpec, SyllogismKey>

/** The item type of the family: text multiple choice. */
export const SYLLOGISM_ITEM_TYPE = 'mc_text'

export const syllogism = defineFamily<SyllogismSpec, SyllogismKey, SyllogismResponse>({
  name: 'syllogism',
  kind: 'item',
  axis: 'LR',
  facets: ['formal_logic'],
  generatorVersion: '1.0.0',
  itemType: SYLLOGISM_ITEM_TYPE,
  strata: SYLLOGISM_STRATA,
  build: buildSyllogism,
  verify: (item) => verifiers().syllogism(item),
  score: scoreSyllogism,
})

const SPEC_FIELDS = ['intro', 'options', 'premises', 'question']

/**
 * The family's leak check (`runFamilyProperties` `specLeaksKey`): the spec holds only intro, premises, question and
 * options, every one text; the intro is present exactly on the made-up-word templates. So nothing beside the shown
 * words can carry the key; the verifier's cue checks cover what the words themselves could give away.
 */
export function syllogismSpecLeaksKey(item: SyllogismItem): string | null {
  const extra = Object.keys(item.spec).filter((k) => !SPEC_FIELDS.includes(k))
  if (extra.length > 0) return `unexpected spec fields: ${extra.join(', ')}`
  const template = (item.structural_params as { template?: unknown }).template
  if ((item.spec.intro !== undefined) !== (template !== 'conditional')) return 'the intro is shown on the made-up-word templates only'
  return null
}

export default syllogism
