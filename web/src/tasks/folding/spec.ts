/**
 * Wire types and constants of the paper-folding family (DESIGN §3 row 7 "paper folding", §4.2, §12;
 * ROADMAP A9, A11). Every number in the spec, the key, the structural params and the features is an
 * integer (no libm floats anywhere in the family), so both repos agree bit for bit.
 *
 * Render payload (`spec`):
 *
 * ```
 * { grid: 4 | 6,
 *   folds: [{ line: 'v' | 'h' | 'd' | 'a', moving: Side }, …]   1–3 folds, in order
 *   punches: [{ row, col }, …]                                    1–3 slots of the sheet, sorted
 *   options: [{ holes: [{ row, col }, …] }] × 5 }                 each option a full sheet, holes sorted
 * ```
 *
 * - `grid` N: the square sheet is an N × N grid of hole slots; rows and columns are numbered 1 … N
 *   from the top-left corner. Holes sit at slot centres.
 * - A fold is a half fold of the current folded shape about its symmetry line of that orientation
 *   (`geometry.ts`): `v` the vertical line through its middle, `h` the horizontal one, `d` the
 *   diagonal running from upper left to lower right, `a` the diagonal from upper right to lower left.
 *   `moving` is the half that is folded OVER (it moves); the other half stays where it is, so the
 *   folded paper always lies inside the sheet's frame and every punch is named by its sheet slot.
 *   The moving side determines the line (left/right → v, top/bottom → h, top_right/bottom_left → d,
 *   top_left/bottom_right → a); both are sent so the spec reads plainly.
 * - `punches`: the slots, in the sheet's frame, where a hole is punched through every layer of the
 *   fully folded paper (strictly inside the folded shape, never on a fold or an edge).
 * - `options`: five full sheets with holes, in display order (the key is a position, never in the spec).
 *
 * Key (`key`): `{ index }`, the option that shows the sheet unfolded.
 */

import type { ItemInstance } from '../family'

export const FOLDING_OPTIONS = 5
/** Sheet sizes: 4 × 4 or 6 × 6 slots (6 × 6 in every stratum, only 6 × 6 in strata 5–6). */
export const FOLDING_GRIDS: readonly number[] = Object.freeze([4, 6])
export const MIN_FOLDS = 1
export const MAX_FOLDS = 3
export const MIN_PUNCHES = 1
export const MAX_PUNCHES = 3

export type LineKind = 'v' | 'h' | 'd' | 'a'
export const LINE_KINDS: readonly LineKind[] = Object.freeze(['v', 'h', 'd', 'a'] as const)

/** The half of the folded shape that is folded over, named by where it lies. */
export type Side = 'left' | 'right' | 'top' | 'bottom' | 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right'

export const SIDES: readonly Side[] = Object.freeze(['left', 'right', 'top', 'bottom', 'top_left', 'top_right', 'bottom_left', 'bottom_right'] as const)

/** A slot of the sheet, 1-based from the top-left corner. */
export interface Slot {
  readonly row: number
  readonly col: number
}

export interface FoldStep {
  readonly line: LineKind
  readonly moving: Side
}

export interface FoldingOption {
  /** The option's holes, sorted by row then column, no repeats. */
  readonly holes: readonly Slot[]
}

export interface FoldingSpec {
  readonly grid: number
  readonly folds: readonly FoldStep[]
  readonly punches: readonly Slot[]
  readonly options: readonly FoldingOption[]
}

export interface FoldingKey {
  /** Position in `spec.options` of the sheet as it looks unfolded. */
  readonly index: number
}

/** The chosen option index. */
export type FoldingResponse = number

export type FoldingItem = ItemInstance<FoldingSpec, FoldingKey>

/**
 * A11 structure: the fold sequence (moving sides) and the punched slots, canonicalised together
 * under the eight symmetries of the square sheet, plus the sorted reasons of the distractors
 * (`geometry.ts` `foldingStructure`): an item turned or mirrored as a whole, with the same kinds of
 * lures, is an isomorph (same family_id).
 */
export interface FoldingStructure {
  /** The four distractors' reasons, sorted (`reasons.ts` `lureSignature`). */
  readonly lures: readonly string[]
  readonly grid: number
  readonly folds: readonly Side[]
  /** [row, col] pairs, sorted. */
  readonly punches: readonly (readonly [number, number])[]
}

/**
 * How a distractor is wrong (G3 `distractor_rationale`), checked by the verifier. A distractor is a
 * *base* sheet other than the key, or a base sheet (the key included) with one *perturbation*.
 *
 * Bases:
 * - `key`: the unfolded sheet itself (only as the base of a perturbation);
 * - `missed_unfold`: one fold is not undone (the holes of the layers that fold moved are missing);
 * - `wrong_line`: one fold is undone across another line (another symmetry line of the shape it
 *   folded, or the line of another fold);
 * - `mirrored`: the unfolded sheet mirrored as a whole across a line of the sheet;
 * - `extra_layer`: the unfolded sheet together with its mirror image across a line of the sheet (as if
 *   the paper had one more fold there).
 *
 * Perturbations keep every mirror and turn symmetry of their base (they act on whole orbits of the
 * base's symmetry group, `geometry.ts` `stabilizer`):
 * - `moved_hole`: one hole (with its symmetric partners) moved to a neighbouring free slot;
 * - `extra_hole`: one extra hole (with its symmetric partners).
 */
export type LureBase = 'key' | 'missed_unfold' | 'wrong_line' | 'mirrored' | 'extra_layer'
export type LurePerturbation = 'moved_hole' | 'extra_hole'

export const LURE_BASES: readonly LureBase[] = Object.freeze(['key', 'missed_unfold', 'wrong_line', 'mirrored', 'extra_layer'] as const)
export const LURE_PERTURBATIONS: readonly LurePerturbation[] = Object.freeze(['moved_hole', 'extra_hole'] as const)

/** A distractor's reason: its base, its perturbation, or both (`moved_hole`, `extra_hole` of the key; `moved_hole+mirrored`). */
export function lureReason(base: LureBase, perturbation: LurePerturbation | null): string {
  if (perturbation === null) return base
  return base === 'key' ? perturbation : `${perturbation}+${base}`
}

/** Difficulty features (all integers or booleans; see `prior.ts`). */
export interface FoldingFeatures {
  readonly grid: number
  readonly n_folds: number
  /** Some fold is along a diagonal line. */
  readonly diagonal: boolean
  /** Number of folds along a diagonal line (recorded, not in the v0 prior). */
  readonly n_diagonal: number
  readonly n_punches: number
  /** Holes in the unfolded sheet: 2^n_folds · n_punches (every punch goes through 2^n_folds layers). */
  readonly holes: number
  /** Every distractor has the key's number of holes (only near-miss lures). */
  readonly near_miss: boolean
}

export const FEATURE_NAMES: readonly (keyof FoldingFeatures)[] = Object.freeze(['grid', 'n_folds', 'diagonal', 'n_diagonal', 'n_punches', 'holes', 'near_miss'])

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function slotProblems(where: string, s: unknown, n: number): string[] {
  if (!isObj(s) || Object.keys(s).sort().join(',') !== 'col,row') return [`${where} must be { row, col }`]
  if (!isInt(s.row) || !isInt(s.col) || s.row < 1 || s.col < 1 || s.row > n || s.col > n) return [`${where} must be a slot 1…${n}`]
  return []
}

function sortedDistinct(slots: readonly Slot[]): boolean {
  for (let i = 1; i < slots.length; i++) {
    const a = slots[i - 1] as Slot
    const b = slots[i] as Slot
    if (!(a.row < b.row || (a.row === b.row && a.col < b.col))) return false
  }
  return true
}

/**
 * Why `spec` cannot be drawn (empty = drawable): the shape checks the renderer relies on (the lazy
 * loader's `fits` check). It does not check that the folds are legal for the shapes they fold or that
 * the punches lie inside the folded paper; `geometry.ts` `foldPlan` does (the renderer draws nothing
 * for a plan it cannot build).
 */
export function specProblems(spec: unknown): string[] {
  if (!isObj(spec)) return ['spec must be an object']
  const out: string[] = []
  const keys = Object.keys(spec).sort().join(',')
  if (keys !== 'folds,grid,options,punches') out.push('spec has exactly grid, folds, punches, options')
  const n = spec.grid
  if (!isInt(n) || !FOLDING_GRIDS.includes(n)) return [...out, `grid must be one of ${FOLDING_GRIDS.join(', ')}`]
  const folds = spec.folds
  if (!Array.isArray(folds) || folds.length < MIN_FOLDS || folds.length > MAX_FOLDS) out.push(`folds must list ${MIN_FOLDS}–${MAX_FOLDS} folds`)
  else
    folds.forEach((f, i) => {
      if (!isObj(f) || Object.keys(f).sort().join(',') !== 'line,moving') out.push(`folds[${i}] must be { line, moving }`)
      else if (!(LINE_KINDS as readonly unknown[]).includes(f.line) || !(SIDES as readonly unknown[]).includes(f.moving)) out.push(`folds[${i}] has an unknown line or side`)
    })
  const punches = spec.punches
  if (!Array.isArray(punches) || punches.length < MIN_PUNCHES || punches.length > MAX_PUNCHES) out.push(`punches must list ${MIN_PUNCHES}–${MAX_PUNCHES} slots`)
  else {
    punches.forEach((p, i) => out.push(...slotProblems(`punches[${i}]`, p, n)))
    if (out.length === 0 && !sortedDistinct(punches as Slot[])) out.push('punches must be sorted and distinct')
  }
  const options = spec.options
  if (!Array.isArray(options) || options.length !== FOLDING_OPTIONS) out.push(`options must list ${FOLDING_OPTIONS} sheets`)
  else
    options.forEach((o, i) => {
      if (!isObj(o) || Object.keys(o).join(',') !== 'holes' || !Array.isArray(o.holes) || o.holes.length === 0 || o.holes.length > n * n) {
        out.push(`options[${i}] must be { holes: [1…${n * n} slots] }`)
        return
      }
      const before = out.length
      ;(o.holes as unknown[]).forEach((h, j) => out.push(...slotProblems(`options[${i}].holes[${j}]`, h, n)))
      if (out.length === before && !sortedDistinct(o.holes as Slot[])) out.push(`options[${i}].holes must be sorted and distinct`)
    })
  return out
}
