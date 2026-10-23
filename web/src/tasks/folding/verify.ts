/**
 * Verifier of the paper-folding family (gates G2/G3, DESIGN §4.1; ROADMAP A1, A11). It recomputes
 * everything from the item alone and never throws on a well-formed item. It is not imported by the
 * generator or `index.ts` (it stays out of production chunks; `../verifier-slot` reaches it).
 *
 * - G2, its own route to the key: the fold plan is rebuilt from the spec (`geometry.ts` `foldPlan`:
 *   every fold must be a legal half fold of the shape it folds), the punches must lie strictly inside
 *   the folded paper, and the hole set is UNFOLDED step by step, last fold first, by reflecting the
 *   holes so far across each fold line (a reflection written here, not the generator's forward map
 *   `foldedImage`, and slot lists, not the generator's bit masks). Every punch must go through
 *   2^folds layers, and the keyed option must equal the unfolded sheet.
 * - G3: exactly one option equals it; the five sheets are pairwise distinct; every distractor is
 *   wrong for a recorded reason (`spec.ts` `LureBase`, `LurePerturbation`; listed in `checks.reasons`
 *   in display order); no enforced option-only cue singles out the key (`cues.ts`; every cue's picks
 *   and the key's typicality rank are recorded).
 * - Bookkeeping: the configuration is one the generator uses (`gen.ts`), and the structure (A11), the
 *   features, the prior, the stratum and E[T] all match a recomputation.
 */

import { canonicalJson } from '../ids'
import { verdict, type ItemInstance, type JsonObject, type VerifyResult } from '../family'
import { stratumOfB } from '../priors'
import { CUE_NAMES, ENFORCED_CUES, cueSets, typicalityRank } from './cues'
import { basesOf, reasonOf, unfold } from './reasons'
import {
  foldPlan,
  foldingStructure,
  interiorSlots,
  isPlan,
  lineKindOf,
  ptSlot,
  slotPt,
  slotsKey,
  sortSlots,
  strictlyInside,
  type Shape,
} from './geometry'
import { FOLDING_PROVENANCE, FOLDING_SD_PRIOR, foldingBPrior, foldingExpectedTime } from './prior'
import { FEATURE_NAMES, FOLDING_OPTIONS, specProblems, type FoldingKey, type FoldingSpec } from './spec'

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function verifyFolding(item: ItemInstance<FoldingSpec, FoldingKey>): VerifyResult {
  try {
    const spec: unknown = item.spec
    const problems = specProblems(spec)
    if (problems.length > 0) return { ok: false, reason: `malformed spec: ${problems.join('; ')}`, checks: { spec_well_formed: false } }
    const s = spec as FoldingSpec
    const n = s.grid
    const plan = foldPlan(n, s.folds)
    if (!isPlan(plan)) return { ok: false, reason: `illegal folds: ${plan.problems.join('; ')}`, checks: { spec_well_formed: true, folds_legal: false } }
    const f = s.folds.length
    const p = s.punches.length
    const folded = plan.shapes[f] as Shape
    const punchPts = s.punches.map(slotPt)
    const unfolded = sortSlots(unfold(punchPts, plan.lines).map(ptSlot))
    const unfoldedText = slotsKey(unfolded)
    const sheets = s.options.map((o) => o.holes)
    const texts = sheets.map(slotsKey)
    const index = isObj(item.key) ? item.key.index : undefined
    const keyInRange = typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < sheets.length
    const k = keyInRange ? (index as number) : -1

    const bases = basesOf(plan, punchPts, unfolded)
    const reasons = sheets.map((d, i) => (i === k ? 'key' : texts[i] === unfoldedText ? null : reasonOf(d, bases, n)))
    const nearMiss = sheets.every((d, i) => i === k || d.length === unfolded.length)

    const sets = cueSets(sheets, n)
    const singled = ENFORCED_CUES.filter((c) => sets[c].length === 1 && sets[c][0] === k)
    const cueValues: JsonObject = {}
    for (const c of CUE_NAMES) cueValues[c] = sets[c]

    const sides = s.folds.map((x) => x.moving)
    const nDiag = sides.filter((m) => ['d', 'a'].includes(lineKindOf(m))).length
    const features = { grid: n, n_folds: f, diagonal: nDiag > 0, n_diagonal: nDiag, n_punches: p, holes: unfolded.length, near_miss: nearMiss }
    const recorded = item.difficulty.features
    const featuresMatch =
      Object.keys(recorded).sort().join(',') === [...FEATURE_NAMES].sort().join(',') && FEATURE_NAMES.every((name) => recorded[name] === features[name])
    const bPrior = foldingBPrior(features)
    const inner = interiorSlots(folded, n).length

    return verdict({
      spec_well_formed: true,
      folds_legal: true,
      punches_inside_folded_paper: punchPts.every((q) => strictlyInside(q, folded)),
      every_punch_through_all_layers: unfolded.length === 2 ** f * p,
      configuration_allowed: 2 * unfolded.length <= n * n && p < inner,
      five_options: sheets.length === FOLDING_OPTIONS && item.options_count === FOLDING_OPTIONS,
      key_in_range: keyInRange,
      key_is_unfolded_sheet: keyInRange && texts[k] === unfoldedText,
      unique_unfolded_option: texts.filter((t) => t === unfoldedText).length === 1,
      options_distinct: new Set(texts).size === texts.length,
      every_distractor_has_reason: reasons.every((r) => r !== null),
      reasons: reasons.map((r) => r ?? 'none'),
      no_cue_singles_out_key: keyInRange && singled.length === 0,
      cues: cueValues,
      key_typicality_rank: keyInRange ? typicalityRank(sheets, k) : -1,
      structure_matches: canonicalJson(item.structural_params) === canonicalJson(foldingStructure(n, sides, s.punches, reasons.filter((_, i) => i !== k).map((r) => r ?? 'none'))),
      features_match: featuresMatch,
      prior_matches: item.difficulty.b_prior === bPrior && item.difficulty.sd_prior === FOLDING_SD_PRIOR && item.difficulty.provenance === FOLDING_PROVENANCE,
      stratum_matches: item.stratum === stratumOfB(bPrior),
      time_matches: item.expected_time_s === foldingExpectedTime(f, p),
    })
  } catch (e) {
    return { ok: false, reason: `malformed item: ${String(e)}`, checks: {} }
  }
}
