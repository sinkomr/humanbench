/**
 * Verifier of the figure2d family (gates G2/G3; DESIGN §4.1, §4.2; ROADMAP A11). Not imported by the generator or by
 * `index.ts` (it stays out of the production chunks; `../verifier-slot.ts` installs it for the tests and the dump).
 *
 * Everything is recomputed from the item alone. Checks (all must hold):
 *
 * - `well_formed` (`spec.ts` specProblems: exact fields, integer squares, angles multiples of 15 in (−90, 90], mirror
 *   options upright), `four_options` (4 options, options_count 4: A9 3PL with c = 1/4), `key_in_range`,
 *   `facet_matches` (the facet is the task's), `shapes_normalised` (every list at row 0 / column 0, sorted),
 *   `square_count` (5–11 squares, every option as many), `connected`, `target_asymmetric` (all 8 images distinct).
 * - Task 'rotate', G2/G3: `unique_turn_match` (exactly the key option is the target turned in the plane),
 *   `options_distinct_under_turns` (no two options are turns of each other), `one_mirror` (exactly one option is the
 *   target's mirror image), `moved_pair` (the other two are mirror images of each other, a different figure from the
 *   target up to turning and flipping, with no symmetry, one square moved from the target in some orientation: each
 *   distractor fails for its recorded reason), `no_verbatim_target` (no option lists the target's squares unchanged),
 *   `same_tilt` (every option tilted alike), `no_odd_one_out` (no option stands apart in an option-only look: own-grid
 *   box, squares per row or column, angle, box size, count profile), `relations_alike` (every option has as many turned
 *   copies, mirror images and moved neighbours among the others), `turn_matches` (the key's total turn and its angular
 *   disparity, 15–180°), `variant_matches` (hard_variant ⇔ the moved pair keeps the target's count profile).
 * - Task 'mirror', G2/G3: `square_box` (the target's box is square), `unique_mirror_match` (exactly the key option is
 *   the target's mirror image in the line, as a normalised set), `options_distinct`, `distractor_set_matches` (the
 *   distractors are exactly the recorded set's kinds: the other-line reflection, the figure itself, the figure turned
 *   90°, the key with one square moved inside its box and not the figure up to turning and flipping, that moved shape's
 *   mirror image in the line, or its 180° turn), `no_odd_one_out` (box, squares per row, per column),
 *   `relations_alike` (same-orientation moved neighbours).
 * - Bookkeeping: `structure_matches` (A11), `features_match`, `prior_matches`, `stratum_matches`, `time_matches`,
 *   `provenance_matches`.
 */

import { verdict, type ItemInstance, type VerifyResult } from '../family'
import { canonicalJson } from '../ids'
import { stratumOfB } from '../priors'
import {
  bbox,
  c4Key,
  cellsKey,
  d4Canon,
  d4Key,
  isAsymmetric,
  isConnected,
  isOneMoveAnyTurn,
  isOneMoveExact,
  normalise,
  oddOneOut,
  profileKey,
  reflect,
  relationSignatures,
  turn,
  turnsBetween,
} from './geometry'
import { mirrorLooks, rotateLooks } from './gen'
import { MIRROR_PROVENANCE, ROTATE_PROVENANCE, mirrorBPrior, mirrorExpectedTime, offAxisOf, rotateBPrior, rotateExpectedTime } from './prior'
import {
  FACET_OF_TASK,
  FIGURE2D_OPTIONS,
  MAX_SQUARES,
  MIN_SQUARES,
  MIRROR_MIN_SQUARES,
  MIRROR_SETS,
  OTHER_LINE,
  isDiagonal,
  specProblems,
  type Cell,
  type Figure2dKey,
  type Figure2dSpec,
  type MirrorLine,
  type MirrorSet,
} from './spec'

type Checks = Record<string, boolean | number | string>
type Item = ItemInstance<Figure2dSpec, Figure2dKey>

const sameList = (a: readonly Cell[], b: readonly Cell[]): boolean => cellsKey(a) === cellsKey(b)
const same = (a: readonly Cell[], b: readonly Cell[]): boolean => cellsKey(normalise(a)) === cellsKey(normalise(b))
const mod = (x: number, m: number): number => ((x % m) + m) % m

const exactKeys = (o: object, keys: readonly string[]): boolean => Object.keys(o).sort().join(',') === [...keys].sort().join(',')

/** Does the mirror item's distractor list fit set `set` (key = reflect(F, line))? */
export function fitsMirrorSet(
  f: readonly Cell[],
  line: MirrorLine,
  key: readonly Cell[],
  distractors: readonly (readonly Cell[])[],
  set: MirrorSet,
): boolean {
  if (distractors.length !== 3) return false
  const other = reflect(f, OTHER_LINE[line])
  const [kh, kw] = bbox(key)
  const isMoved = (o: readonly Cell[]): boolean => {
    const [h, w] = bbox(o)
    return h === kh && w === kw && isAsymmetric(o) && d4Key(o) !== d4Key(f) && isOneMoveExact(normalise(key), normalise(o))
  }
  const has = (want: readonly Cell[]): number => distractors.findIndex((o) => same(o, want))
  if (set === 'basic') {
    const iOther = has(other)
    const iSame = has(f)
    const iTurn = distractors.findIndex((o) => same(o, turn(f, 1)) || same(o, turn(f, 3)))
    return iOther >= 0 && iSame >= 0 && iTurn >= 0 && new Set([iOther, iSame, iTurn]).size === 3
  }
  const anchor = set === 'pairs' ? has(f) : has(other)
  if (anchor < 0) return false
  const rest = [0, 1, 2].filter((i) => i !== anchor)
  return rest.some((i) => {
    const m = distractors[i] as Cell[]
    const j = rest.find((x) => x !== i) as number
    const partner = set === 'pairs' ? reflect(m, line) : turn(m, 2)
    return isMoved(m) && same(distractors[j] as Cell[], partner)
  })
}

function commonChecks(item: Item, checks: Checks): boolean {
  const { spec } = item
  const options = spec.options
  const four = options.length === FIGURE2D_OPTIONS && item.options_count === FIGURE2D_OPTIONS
  checks.four_options = four
  const idx = item.key.index
  const inRange = Number.isInteger(idx) && idx >= 0 && idx < options.length
  checks.key_in_range = inRange
  checks.facet_matches = item.facet === FACET_OF_TASK[spec.task]
  const shapes = [spec.figure.cells, ...options.map((o) => o.cells)]
  const normalised = shapes.every((s) => sameList(s, normalise(s)))
  checks.shapes_normalised = normalised
  const n = spec.figure.cells.length
  checks.n_squares = n
  const count = n >= (spec.task === 'mirror' ? MIRROR_MIN_SQUARES : MIN_SQUARES) && n <= MAX_SQUARES && options.every((o) => o.cells.length === n)
  checks.square_count = count
  checks.connected = shapes.every(isConnected)
  checks.target_asymmetric = isAsymmetric(spec.figure.cells)
  return four && inRange && normalised && count
}

function bookkeeping(
  item: Item,
  checks: Checks,
  structure: object,
  features: Readonly<Record<string, number | string | boolean>>,
  b: number,
  time: number,
  provenance: string,
): void {
  checks.structure_matches = canonicalJson(item.structural_params) === canonicalJson(structure)
  const got = item.difficulty.features
  checks.features_match = exactKeys(got, Object.keys(features)) && Object.entries(features).every(([k, v]) => got[k] === v)
  checks.prior_matches = item.difficulty.b_prior === b
  checks.stratum_matches = item.stratum === stratumOfB(b)
  checks.time_matches = item.expected_time_s === time
  checks.provenance_matches = item.difficulty.provenance === provenance
}

function verifyRotate(item: Item, checks: Checks): void {
  const f = item.spec.figure.cells
  const options = item.spec.options
  const keyIdx = item.key.index
  const cells = options.map((o) => o.cells)
  const c4F = c4Key(f)
  const d4F = d4Key(f)
  const matches = cells.flatMap((c, i) => (c4Key(c) === c4F ? [i] : []))
  checks.unique_turn_match = matches.length === 1 && matches[0] === keyIdx
  checks.options_distinct_under_turns = new Set(cells.map(c4Key)).size === FIGURE2D_OPTIONS
  const mirrors = cells.flatMap((c, i) => (c4Key(c) !== c4F && d4Key(c) === d4F ? [i] : []))
  checks.one_mirror = mirrors.length === 1
  const pair = [0, 1, 2, 3].filter((i) => i !== keyIdx && !mirrors.includes(i)).map((i) => cells[i] as readonly Cell[])
  const [v1, v2] = pair
  checks.moved_pair =
    pair.length === 2 &&
    v1 !== undefined &&
    v2 !== undefined &&
    d4Key(v1) === d4Key(v2) &&
    c4Key(v1) !== c4Key(v2) &&
    d4Key(v1) !== d4F &&
    isAsymmetric(v1) &&
    isOneMoveAnyTurn(f, v1)
  checks.no_verbatim_target = cells.every((c) => !sameList(c, f))
  const tilt = mod(options[0]?.angle ?? 0, 90)
  checks.same_tilt = options.every((o) => mod(o.angle, 90) === tilt)
  checks.no_odd_one_out = rotateLooks(options).every((v) => oddOneOut(v) === null)
  checks.relations_alike = new Set(relationSignatures(cells, false)).size === 1
  const key = options[keyIdx]
  const ks = key === undefined ? [] : turnsBetween(f, key.cells)
  const total = ks.length === 1 && key !== undefined ? mod(90 * (ks[0] as number) + key.angle, 360) : -1
  const turnDeg = total < 0 ? -1 : Math.min(total, 360 - total)
  checks.key_turn_cw = total
  checks.turn_matches = ks.length === 1 && turnDeg >= 15 && turnDeg <= 180
  const variant = v1 ?? f
  const hard = profileKey(variant) === profileKey(f)
  checks.variant_matches = item.difficulty.features.hard_variant === hard
  if (!checks.turn_matches) {
    checks.prior_matches = false
    return
  }
  const input = { turn_deg: turnDeg, n_squares: f.length, off_axis: offAxisOf(turnDeg), hard_variant: hard }
  bookkeeping(
    item,
    checks,
    { task: 'rotate', figure: d4Canon(f), variant: d4Canon(variant) },
    { task: 'rotate', turn_deg: turnDeg, key_turn_cw: total, n_squares: f.length, off_axis: input.off_axis, hard_variant: hard },
    rotateBPrior(input),
    rotateExpectedTime(input),
    ROTATE_PROVENANCE,
  )
}

function verifyMirror(item: Item, checks: Checks): void {
  const f = item.spec.figure.cells
  const line = item.spec.mirror_line as MirrorLine
  const options = item.spec.options
  const keyIdx = item.key.index
  const cells = options.map((o) => o.cells)
  const [h, w] = bbox(f)
  checks.square_box = h === w
  const want = reflect(f, line)
  const matches = cells.flatMap((c, i) => (same(c, want) ? [i] : []))
  checks.unique_mirror_match = matches.length === 1 && matches[0] === keyIdx
  checks.options_distinct = new Set(cells.map((c) => cellsKey(normalise(c)))).size === FIGURE2D_OPTIONS
  const distractors = cells.filter((_, i) => i !== keyIdx)
  const fits = MIRROR_SETS.filter((s) => fitsMirrorSet(f, line, want, distractors, s))
  checks.fitting_sets = fits.join(',')
  const set = item.difficulty.features.distractor_set
  checks.distractor_set_matches = typeof set === 'string' && (fits as readonly string[]).includes(set)
  checks.no_odd_one_out = mirrorLooks(options).every((v) => oddOneOut(v) === null)
  checks.relations_alike = new Set(relationSignatures(cells, true)).size === 1
  if (!checks.distractor_set_matches) {
    checks.prior_matches = false
    return
  }
  const ms = set as MirrorSet
  const input = { n_squares: f.length, diagonal: isDiagonal(line), set_pairs: ms === 'pairs', set_near_turn: ms === 'near_turn' }
  bookkeeping(
    item,
    checks,
    { task: 'mirror', figure: d4Canon(f), line: input.diagonal ? 'diagonal' : 'axis', set: ms },
    { task: 'mirror', ...input, mirror_line: line, distractor_set: ms },
    mirrorBPrior(input),
    mirrorExpectedTime(input),
    MIRROR_PROVENANCE,
  )
}

/** The figure2d verifier (G2/G3); never throws on a well-formed item. */
export function verifyFigure2d(item: Item): VerifyResult {
  try {
    const problems = specProblems(item.spec)
    if (problems.length > 0) return verdict({ well_formed: false, problem: problems[0] as string })
    const checks: Checks = { well_formed: true, task: item.spec.task }
    if (!commonChecks(item, checks)) return verdict(checks)
    if (item.spec.task === 'rotate') verifyRotate(item, checks)
    else verifyMirror(item, checks)
    return verdict(checks)
  } catch (e) {
    return { ok: false, reason: `malformed item: ${String(e)}`, checks: {} }
  }
}
