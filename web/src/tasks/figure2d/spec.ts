/**
 * Wire types and constants of the 2D figure family `figure2d` (DESIGN §3 row 7 "2D rotation/mirror", §4.2; ROADMAP
 * A9, A11). Everything here is integers.
 *
 * Render payload (`spec`, never the key):
 *
 *     { task: 'rotate' | 'mirror',
 *       figure: { cells: [[r, c], ...] },          // the target, drawn upright
 *       mirror_line?: 'v' | 'h' | 'd' | 'a',        // task 'mirror' only
 *       options: [{ cells: [[r, c], ...], angle }] × 4 }
 *
 * - `cells`: the unit squares of a figure as integer [row, column] pairs on its own grid (row 0 at the top, column 0 at
 *   the left), translated so the smallest row and column are 0 and sorted (row, then column). A sorted list carries no
 *   order information, so nothing about the key can be read from the order of the squares.
 * - `angle`: the display angle of an option only, whole degrees, a multiple of 15 in (−90, 90]; positive turns
 *   clockwise on screen (SVG `rotate(angle)` about the figure's centre). Task 'mirror' draws every option upright
 *   (angle 0).
 * - `mirror_line`: where the dashed mirror line is drawn beside the target: `v` vertical, to its right; `h` horizontal,
 *   below it; `d` the diagonal from the top left to the bottom right corner, above and to the right of it; `a` the
 *   diagonal from the bottom left to the top right corner, below and to the right of it.
 *
 * Key (`key`): `{ index }`, the position in `spec.options` of the turned figure (task 'rotate') or of its mirror image
 * (task 'mirror'). The response is that position (an option index).
 */

import type { ItemInstance } from '../family'

/** Options per item (A9: 3PL, c = 1/4). */
export const FIGURE2D_OPTIONS = 4
/** Squares of a figure. */
export const MIN_SQUARES = 5
export const MAX_SQUARES = 11
/**
 * Fewest squares of a task 'mirror' figure: the only 5-square figure with no symmetry and a square box (the F
 * pentomino) admits no distractor set without an option-only cue (exhaustive check), so mirror figures have 6–11.
 */
export const MIRROR_MIN_SQUARES = 6
/** Fewest squares for which a one-square-moved variant with the figure's row and column counts exists (exhaustive). */
export const HARD_VARIANT_MIN_SQUARES = 7
/** Display angles are multiples of this many degrees. */
export const ANGLE_STEP_DEG = 15
/** A well-formed spec's figures have at most this many squares and coordinates below this bound (bounds garbage). */
export const MAX_SPEC_CELLS = 32
export const COORD_LIMIT = 32

export type Figure2dTask = 'rotate' | 'mirror'
export const FIGURE2D_TASKS: readonly Figure2dTask[] = Object.freeze(['rotate', 'mirror'] as const)
/** The facet of each task (an item's facet is its task, §3 drill-down). */
export const FACET_OF_TASK: Readonly<Record<Figure2dTask, string>> = Object.freeze({ rotate: '2d_rotation', mirror: '2d_mirror' })
export const FIGURE2D_FACETS: readonly string[] = Object.freeze(['2d_rotation', '2d_mirror'])

export type MirrorLine = 'v' | 'h' | 'd' | 'a'
export const MIRROR_LINES: readonly MirrorLine[] = Object.freeze(['v', 'h', 'd', 'a'] as const)
/** The other straight line of the same class (vertical ↔ horizontal, one diagonal ↔ the other). */
export const OTHER_LINE: Readonly<Record<MirrorLine, MirrorLine>> = Object.freeze({ v: 'h', h: 'v', d: 'a', a: 'd' })
export const isDiagonal = (line: MirrorLine): boolean => line === 'd' || line === 'a'

/**
 * Distractor sets of task 'mirror' (3 distractors each; see `gen.ts`). Every set makes the four options look alike from
 * the options alone: each option has the same number of turned copies, mirror images and one-square-moved neighbours
 * among the others, so only the target and its line decide.
 * - `basic`: the reflection in the other straight line (= the key turned 180°), the figure itself, the figure turned 90°.
 * - `pairs`: the figure itself, the key with one square moved, and that moved shape's mirror image in the line.
 * - `near_turn`: the reflection in the other line, the key with one square moved, and that moved shape turned 180°.
 */
export type MirrorSet = 'basic' | 'pairs' | 'near_turn'
export const MIRROR_SETS: readonly MirrorSet[] = Object.freeze(['basic', 'pairs', 'near_turn'] as const)

/** Kinds of the distractors of each mirror set. */
export type MirrorDistractorKind = 'other_line' | 'unreflected' | 'turned_90' | 'moved' | 'moved_mirror' | 'moved_turned'
export const MIRROR_SET_KINDS: Readonly<Record<MirrorSet, readonly MirrorDistractorKind[]>> = Object.freeze({
  basic: Object.freeze(['other_line', 'unreflected', 'turned_90'] as const),
  pairs: Object.freeze(['unreflected', 'moved', 'moved_mirror'] as const),
  near_turn: Object.freeze(['other_line', 'moved', 'moved_turned'] as const),
})

/** Kinds of the distractors of task 'rotate': the mirror image, a one-square-moved variant V and V's mirror image. */
export type RotateDistractorKind = 'mirror' | 'moved' | 'moved_mirror'

/** A unit square: [row, column]. */
export type Cell = readonly [number, number]

export interface Figure {
  readonly cells: readonly Cell[]
}

export interface Figure2dOption {
  readonly cells: readonly Cell[]
  /** Display angle in whole degrees (clockwise positive), a multiple of 15 in (−90, 90]. */
  readonly angle: number
}

export interface Figure2dSpec {
  readonly task: Figure2dTask
  readonly figure: Figure
  /** Task 'mirror' only. */
  readonly mirror_line?: MirrorLine
  readonly options: readonly Figure2dOption[]
}

export interface Figure2dKey {
  readonly index: number
}

/** The chosen option's display position. */
export type Figure2dResponse = number

export type Figure2dItem = ItemInstance<Figure2dSpec, Figure2dKey>

/** Difficulty features of a task 'rotate' item (the prior reads turn_deg, n_squares, off_axis, hard_variant). */
export interface RotateFeatures {
  readonly task: 'rotate'
  /** Angular disparity between the target and the key as drawn: min(T, 360 − T) of the key's total turn T, 15–180. */
  readonly turn_deg: number
  /** The key's total clockwise turn T = 90·k + angle (mod 360), 0–359. */
  readonly key_turn_cw: number
  readonly n_squares: number
  /** The squares are drawn tilted (T is not a multiple of 90°). */
  readonly off_axis: boolean
  /** V has the figure's squares per row and column (up to turning and flipping), so counting cannot separate the pairs. */
  readonly hard_variant: boolean
}

/** Difficulty features of a task 'mirror' item (the prior reads n_squares, diagonal, set_pairs, set_near_turn). */
export interface MirrorFeatures {
  readonly task: 'mirror'
  readonly n_squares: number
  readonly diagonal: boolean
  readonly set_pairs: boolean
  readonly set_near_turn: boolean
  readonly mirror_line: MirrorLine
  readonly distractor_set: MirrorSet
}

export type Figure2dFeatures = RotateFeatures | MirrorFeatures

/** `structural_params` (A11): the target up to turning and flipping, plus what makes two items isomorphs. */
export type Figure2dStructure =
  | { readonly task: 'rotate'; readonly figure: readonly Cell[]; readonly variant: readonly Cell[] }
  | { readonly task: 'mirror'; readonly figure: readonly Cell[]; readonly line: 'axis' | 'diagonal'; readonly set: MirrorSet }

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const hasExactly = (o: Record<string, unknown>, fields: readonly string[]): boolean => {
  const keys = Object.keys(o)
  return keys.length === fields.length && fields.every((f) => f in o)
}

function cellsProblems(cells: unknown, what: string): string[] {
  if (!Array.isArray(cells) || cells.length === 0 || cells.length > MAX_SPEC_CELLS) return [`${what}: cells must be a list of 1–${MAX_SPEC_CELLS} squares`]
  const ok = cells.every(
    (c) => Array.isArray(c) && c.length === 2 && c.every((x) => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < COORD_LIMIT),
  )
  if (!ok) return [`${what}: every square is [row, column] with integers 0–${COORD_LIMIT - 1}`]
  const keys = new Set(cells.map((c) => `${String(c[0])},${String(c[1])}`))
  return keys.size === cells.length ? [] : [`${what}: repeated squares`]
}

/**
 * Every way `spec` cannot be drawn by the figure2d renderer (empty = drawable). The session's lazy renderer loader uses
 * it as its `fits` check; it says nothing about whether the item is a good one (that is the verifier's job).
 */
export function specProblems(spec: unknown): string[] {
  if (!isPlainObject(spec)) return ['spec must be an object']
  const out: string[] = []
  const task = spec.task
  if (task !== 'rotate' && task !== 'mirror') return ['spec.task must be "rotate" or "mirror"']
  const fields = task === 'mirror' ? ['task', 'figure', 'mirror_line', 'options'] : ['task', 'figure', 'options']
  if (!hasExactly(spec, fields)) out.push(`spec fields must be exactly ${fields.join(', ')}`)
  const fig = spec.figure
  if (!isPlainObject(fig) || !hasExactly(fig, ['cells'])) out.push('spec.figure must be { cells }')
  else out.push(...cellsProblems(fig.cells, 'figure'))
  if (task === 'mirror' && !(MIRROR_LINES as readonly unknown[]).includes(spec.mirror_line)) out.push('spec.mirror_line must be v, h, d or a')
  const options = spec.options
  if (!Array.isArray(options) || options.length !== FIGURE2D_OPTIONS) return [...out, `spec.options must list ${FIGURE2D_OPTIONS} options`]
  options.forEach((o, i) => {
    if (!isPlainObject(o) || !hasExactly(o, ['cells', 'angle'])) {
      out.push(`option ${i} must be { cells, angle }`)
      return
    }
    out.push(...cellsProblems(o.cells, `option ${i}`))
    const a = o.angle
    if (!(typeof a === 'number' && Number.isInteger(a) && a % ANGLE_STEP_DEG === 0 && a > -90 && a <= 90)) {
      out.push(`option ${i}: angle must be a multiple of ${ANGLE_STEP_DEG} in (−90, 90]`)
    } else if (task === 'mirror' && a !== 0) out.push(`option ${i}: a mirror option is drawn upright (angle 0)`)
  })
  return out
}
