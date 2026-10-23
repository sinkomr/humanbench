/**
 * Generator of the figure2d family (DESIGN §3 row 7, §4.2; ROADMAP A9, A11).
 *
 * Every item: pick the task (a fair coin), the stratum (the requested one, else uniform over 1–6, so the natural pool
 * is half each task, spread evenly over the strata), then a design point of that task uniformly among those whose prior
 * b lies in the stratum's band (`prior.ts` ROTATE_COMBOS / MIRROR_COMBOS), and build it:
 *
 * **Task 'rotate'** (facet `2d_rotation`).
 * 1. A figure F0 of n squares, grown at random, with no symmetry (all 8 images distinct), and a one-square-moved variant
 *    V0 drawn uniformly (by shape up to turning and flipping) among the variants that are connected, have no symmetry,
 *    are not F0 up to turning and flipping, and keep (hard_variant) or do not keep F0's squares per row and column up to
 *    turning and flipping ({@link geometry.profileKey}). A fair coin swaps the roles of F0 and V0 (F0 is a moved variant
 *    of V0 too), so the pairs below are exchangeable and nothing about V's shape points at the target's pair.
 * 2. Options: K = the target F, M = its mirror image, V, and V′ = the mirror image of V: two mirror pairs, all four
 *    different under turning (no two options are turns of each other), exactly one in F's turning class.
 * 3. Angles: K's total clockwise turn is T = turn_deg or 360 − turn_deg (a coin). Every option is drawn with the same
 *    tilt (T mod 90, so the tilt of the squares tells nothing) and its own quarter turns. An option with total turn T_i
 *    is listed as `turn(base, k_i)` drawn at `angle` φ_i with 90·k_i + φ_i = T_i and φ_i ∈ (−90, 90] (one of the two
 *    ways to split T_i, a coin); the key never lists the target's squares unchanged (k ≠ 0), and no other option can.
 *    Draws in which some option is the odd one out of the four (one differs, three agree) in what can be compared
 *    without the target (own-grid box shape, squares per row, squares per column, angle, box size, count profile) are
 *    redrawn, so no option-only look singles out any option.
 * 4. The target is drawn upright. The four options are shuffled (key uniform over positions).
 *
 * **Task 'mirror'** (facet `2d_mirror`).
 * 1. A figure F of n squares with no symmetry and a square bounding box (so neither a turn nor a reflection changes the
 *    outline of any option: no option-only box cue), and a mirror line: vertical or horizontal (a coin) or one of the
 *    two diagonals (a coin), as the design point says.
 * 2. The key is F's mirror image in the line (`reflect`), orientation kept: the options are drawn upright and only
 *    their shape and the way they face count, not where they sit.
 * 3. Distractors, by the design point's set (`spec.ts` MIRROR_SETS): `basic` = the reflection in the other straight
 *    line, F itself, F turned 90° (either way); `pairs` = F itself, the key with one square moved (the box kept, not F up
 *    to turning and flipping), that moved shape's mirror image in the line; `near_turn` = the other-line reflection,
 *    the moved key, the moved key turned 180°. Kept only if the four options are different shapes, each option has the
 *    same relations to the other three (turned copies, mirror images, one-square-moved neighbours; geometry
 *    `relationSignatures`), and no option is the odd one out in squares per row or per column.
 * 4. The options are shuffled.
 */

import type { Rng } from '../../engine'
import type { BuildContext, BuiltItem } from '../family'
import type { Stratum } from '../ids'
import { stratumOfB } from '../priors'
import {
  bbox,
  cellsKey,
  colKey,
  d4Canon,
  d4Key,
  growAsymmetric,
  cellsOfCodes,
  mirrorMovedList,
  rotateVariantList,
  shapeKey,
  oddOneOut,
  profileKey,
  reflect,
  relationSignatures,
  rowKey,
  turn,
} from './geometry'
import {
  FIGURE2D_SD_PRIOR,
  FIGURE2D_STRATA,
  MIRROR_PROVENANCE,
  ROTATE_PROVENANCE,
  mirrorBPrior,
  mirrorCombosOf,
  mirrorExpectedTime,
  mirrorInput,
  rotateBPrior,
  rotateCombosOf,
  rotateExpectedTime,
  rotateInput,
  type MirrorCombo,
  type RotateCombo,
} from './prior'
import {
  FACET_OF_TASK,
  FIGURE2D_OPTIONS,
  OTHER_LINE,
  isDiagonal,
  type Cell,
  type Figure2dKey,
  type Figure2dOption,
  type Figure2dSpec,
  type Figure2dStructure,
  type MirrorFeatures,
  type MirrorLine,
  type RotateFeatures,
} from './spec'

const MAX_ATTEMPTS = 20_000
/** Angle redraws per figure before a new figure is drawn (task 'rotate'). */
const ANGLE_ATTEMPTS = 40

/** Split a total clockwise turn T (degrees, multiple of 15) into its two (k, φ) forms with 90k + φ ≡ T, φ ∈ (−90, 90]. */
export function splitsOf(total: number): [number, number][] {
  const t = ((total % 360) + 360) % 360
  const phi = t % 90
  const k = (t - phi) / 90
  return phi === 0
    ? [
        [k, 0],
        [(k + 3) % 4, 90],
      ]
    : [
        [k, phi],
        [(k + 1) % 4, phi - 90],
      ]
}

/** The option-only looks compared across the options of a rotate item (any odd one out is redrawn). */
export function rotateLooks(options: readonly Figure2dOption[]): string[][] {
  const box = options.map((o) => bbox(o.cells).join('x'))
  const size = options.map((o) => [...bbox(o.cells)].sort((x, y) => x - y).join('x'))
  return [
    box,
    options.map((o) => rowKey(o.cells)),
    options.map((o) => colKey(o.cells)),
    options.map((o) => String(o.angle)),
    size,
    options.map((o) => profileKey(o.cells)),
  ]
}

/** The option-only looks compared across the options of a mirror item. */
export function mirrorLooks(options: readonly Figure2dOption[]): string[][] {
  return [
    options.map((o) => bbox(o.cells).join('x')),
    options.map((o) => rowKey(o.cells)),
    options.map((o) => colKey(o.cells)),
  ]
}

/** A plain copy of a figure for the spec (the geometry module remembers the arrays it returns). */
const plain = (cells: readonly Cell[]): Cell[] => cells.map((c): Cell => [c[0], c[1]])

const noOddOneOut = (looks: readonly string[][]): boolean => looks.every((v) => oddOneOut(v) === null)

function drawAsymmetric(rng: Rng, n: number, square: boolean): Cell[] {
  const f = growAsymmetric(rng, n, square, MAX_ATTEMPTS)
  if (f === null) throw new Error(`figure2d: no asymmetric figure of ${n} squares after ${MAX_ATTEMPTS} attempts`)
  return f
}

const MEMO_LIMIT = 50_000
const ROTATE_VARIANTS = new Map<string, readonly Int32Array[]>()
const MIRROR_MOVED = new Map<string, readonly Int32Array[]>()
/** A pure function of `key`, memoised (the cache never changes a result; it is cleared when large). */
function memo(map: Map<string, readonly Int32Array[]>, key: string, make: () => readonly Int32Array[]): readonly Int32Array[] {
  let hit = map.get(key)
  if (hit === undefined) {
    if (map.size >= MEMO_LIMIT) map.clear()
    hit = make()
    map.set(key, hit)
  }
  return hit
}

const rotateVariantCodes = (f: readonly Cell[], hard: boolean): readonly Int32Array[] =>
  memo(ROTATE_VARIANTS, `${shapeKey(f)}#${String(hard)}`, () => rotateVariantList(f, hard))

/** The rotate distractor variants of F (one per shape up to turning and flipping), by the hard flag. */
export function rotateVariants(f: readonly Cell[], hard: boolean): Cell[][] {
  return rotateVariantCodes(f, hard).map(cellsOfCodes)
}

interface Built {
  readonly spec: Figure2dSpec
  readonly key: Figure2dKey
  readonly structure: Figure2dStructure
}

function buildRotateContent(rng: Rng, combo: RotateCombo): Built & { readonly turnCw: number } {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const f0 = drawAsymmetric(rng, combo.n_squares, false)
    const variants = rotateVariantCodes(f0, combo.hard_variant)
    if (variants.length === 0) continue
    const v0 = cellsOfCodes(rng.pick(variants))
    const [f, v] = rng.next() < 0.5 ? [f0, v0] : [v0, f0]
    const bases: Cell[][] = [f, reflect(f, 'v'), v, reflect(v, 'v')]
    // The relation signatures of these four are always alike ("0/1/2": one mirror image, two moved neighbours in some
    // orientation, since V is a moved variant of F and V's figure differs from F's), whatever the angles below; the
    // verifier checks it (`relations_alike`), so it is not recomputed here.
    for (let a = 0; a < ANGLE_ATTEMPTS; a++) {
      const keyTurn = combo.turn_deg === 180 || rng.next() < 0.5 ? combo.turn_deg : 360 - combo.turn_deg
      const tilt = keyTurn % 90
      const totals = [keyTurn, ...[1, 2, 3].map(() => tilt + 90 * rng.int(0, 3))]
      const options: Figure2dOption[] = bases.map((base, i) => {
        const splits = splitsOf(totals[i] as number)
        let [k, angle] = splits[rng.int(0, 1)] as [number, number]
        if (i === 0 && k === 0) [k, angle] = splits.find((s) => s[0] !== 0) as [number, number]
        return { cells: plain(turn(base, k)), angle }
      })
      if (!noOddOneOut(rotateLooks(options))) continue
      const order = rng.shuffle([0, 1, 2, 3])
      return {
        spec: { task: 'rotate', figure: { cells: plain(f) }, options: order.map((i) => options[i] as Figure2dOption) },
        key: { index: order.indexOf(0) },
        structure: { task: 'rotate', figure: d4Canon(f), variant: d4Canon(v) },
        turnCw: keyTurn,
      }
    }
  }
  throw new Error('figure2d: no rotate item after many attempts')
}

const mirrorMovedCodes = (f: readonly Cell[], key: readonly Cell[]): readonly Int32Array[] =>
  memo(MIRROR_MOVED, `${shapeKey(f)}#${shapeKey(key)}`, () => mirrorMovedList(f, key))

/** The key with one square moved, the box kept, no symmetry, not F up to turning and flipping: candidates for task 'mirror'. */
export function mirrorMoved(f: readonly Cell[], key: readonly Cell[]): Cell[][] {
  return mirrorMovedCodes(f, key).map(cellsOfCodes)
}

function buildMirrorContent(rng: Rng, combo: MirrorCombo): Built & { readonly line: MirrorLine } {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const f = drawAsymmetric(rng, combo.n_squares, true)
    const line: MirrorLine = combo.diagonal ? (rng.next() < 0.5 ? 'd' : 'a') : rng.next() < 0.5 ? 'v' : 'h'
    const key = reflect(f, line)
    let distractors: Cell[][]
    if (combo.set === 'basic') {
      distractors = [reflect(f, OTHER_LINE[line]), f, turn(f, rng.next() < 0.5 ? 1 : 3)]
    } else {
      const moved = mirrorMovedCodes(f, key)
      if (moved.length === 0) continue
      const m = cellsOfCodes(rng.pick(moved))
      distractors = combo.set === 'pairs' ? [f, m, reflect(m, line)] : [reflect(f, OTHER_LINE[line]), m, turn(m, 2)]
    }
    const all = [key, ...distractors]
    if (new Set(all.map(cellsKey)).size !== FIGURE2D_OPTIONS) continue
    if (combo.set !== 'basic' && d4Key(distractors[2] as Cell[]) === d4Key(f)) continue
    const options: Figure2dOption[] = all.map((cells) => ({ cells: plain(cells), angle: 0 }))
    if (!noOddOneOut(mirrorLooks(options))) continue
    if (new Set(relationSignatures(all, true)).size !== 1) continue
    const order = rng.shuffle([0, 1, 2, 3])
    return {
      spec: { task: 'mirror', figure: { cells: plain(f) }, mirror_line: line, options: order.map((i) => options[i] as Figure2dOption) },
      key: { index: order.indexOf(0) },
      structure: { task: 'mirror', figure: d4Canon(f), line: isDiagonal(line) ? 'diagonal' : 'axis', set: combo.set },
      line,
    }
  }
  throw new Error('figure2d: no mirror item after many attempts')
}

/** `build()` of the family (see the module comment). */
export function buildFigure2d(rng: Rng, ctx: BuildContext): BuiltItem<Figure2dSpec, Figure2dKey> {
  const task = rng.next() < 0.5 ? 'rotate' : 'mirror'
  const stratum: Stratum = ctx.stratum ?? (FIGURE2D_STRATA[rng.int(0, FIGURE2D_STRATA.length - 1)] as Stratum)
  if (task === 'rotate') {
    const combos = rotateCombosOf(stratum)
    if (combos.length === 0) throw new RangeError(`figure2d: no rotate design point in stratum ${stratum}`)
    const combo = rng.pick(combos)
    const input = rotateInput(combo)
    const b = rotateBPrior(input)
    if (stratumOfB(b) !== stratum) throw new Error('figure2d: rotate prior and stratum disagree')
    const built = buildRotateContent(rng, combo)
    const features: RotateFeatures = {
      task: 'rotate',
      turn_deg: combo.turn_deg,
      key_turn_cw: built.turnCw,
      n_squares: combo.n_squares,
      off_axis: input.off_axis,
      hard_variant: combo.hard_variant,
    }
    return {
      stratum,
      facet: FACET_OF_TASK.rotate,
      spec: built.spec,
      key: built.key,
      structural_params: built.structure as unknown as BuiltItem<Figure2dSpec, Figure2dKey>['structural_params'],
      options_count: FIGURE2D_OPTIONS,
      difficulty: { features: { ...features }, b_prior: b, sd_prior: FIGURE2D_SD_PRIOR, provenance: ROTATE_PROVENANCE },
      expected_time_s: rotateExpectedTime(input),
    }
  }
  const combos = mirrorCombosOf(stratum)
  if (combos.length === 0) throw new RangeError(`figure2d: no mirror design point in stratum ${stratum}`)
  const combo = rng.pick(combos)
  const input = mirrorInput(combo)
  const b = mirrorBPrior(input)
  if (stratumOfB(b) !== stratum) throw new Error('figure2d: mirror prior and stratum disagree')
  const built = buildMirrorContent(rng, combo)
  const features: MirrorFeatures = {
    task: 'mirror',
    n_squares: combo.n_squares,
    diagonal: combo.diagonal,
    set_pairs: input.set_pairs,
    set_near_turn: input.set_near_turn,
    mirror_line: built.line,
    distractor_set: combo.set,
  }
  return {
    stratum,
    facet: FACET_OF_TASK.mirror,
    spec: built.spec,
    key: built.key,
    structural_params: built.structure as unknown as BuiltItem<Figure2dSpec, Figure2dKey>['structural_params'],
    options_count: FIGURE2D_OPTIONS,
    difficulty: { features: { ...features }, b_prior: b, sd_prior: FIGURE2D_SD_PRIOR, provenance: MIRROR_PROVENANCE },
    expected_time_s: mirrorExpectedTime(input),
  }
}
