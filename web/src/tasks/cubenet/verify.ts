/**
 * Verifier of the cube-net family (gates G2/G3; DESIGN §4.2; ROADMAP A1, A11).
 *
 * Everything is recomputed from the item alone, so the same function checks generated items,
 * JSON-loaded items (TS or the bank twin's) and hand-built bad ones. It folds the net by its own
 * route, composing integer rotation matrices square to square from the first square (east =
 * a quarter turn about y, south = a quarter turn about x; the generator carries face frames
 * instead), and decides every option twice: by brute force over the 24 rotations of the cube
 * (is there a turn of the folded cube that puts the option's top mark on top (+z), its front-left
 * mark at the front left (+x) and its front-right mark at the front right (+y), the renderer's
 * camera?) and by the sign of the integer triple product of the three face normals.
 *
 * Checks (all must hold):
 * - `well_formed` (`specProblems`), `four_options`, `key_in_range`;
 * - `net_folds_to_cube` (six different face normals) and `net_is_cube_net` (one of the 11 nets);
 * - `marks_on_net`: every option's marks are marks of the net (a mark not on the net would give the
 *   distractor away from the options alone);
 * - G2 `key_is_possible` (brute force) and `key_turn_matches` (faces pairwise adjacent and
 *   det(n_top, n_left, n_right) = +1); G3 `unique_possible` (exactly one option is possible, by
 *   both routes);
 * - `distractor_reasons`: every other option fails for exactly one recorded reason, "opposite"
 *   (two of its marks are on opposite faces) or "mirror" (pairwise adjacent, det = −1, so only the
 *   mirror-image cube shows it);
 * - option-only cues: `views_distinct` (pairwise different up to turning about the corner),
 *   `set_groups_uniform` (every option's mark set is shared by the same number of options),
 *   `frequency_cue_absent` (the key's summed mark frequency over the options is neither the unique
 *   largest nor the unique smallest);
 * - bookkeeping: `structure_matches` (A11), `family_id_matches`, `features_match`,
 *   `prior_matches`, `stratum_matches`, `time_matches`, `params_match`.
 */

import { verdict, type ItemInstance, type VerifyResult } from '../family'
import { canonicalJson, familyId } from '../ids'
import { powerTimeLimit, stratumOfB } from '../priors'
import { CUBENET_PROVENANCE, CUBENET_SD_PRIOR, MIRRORS_OF_STRATUM, cubenetBPrior, cubenetExpectedTime } from './prior'
import { CUBENET_OPTIONS, specProblems, type CubeView, type CubenetKey, type CubenetSpec, type Mark } from './spec'
import {
  KIND_MIRROR,
  KIND_OPPOSITE,
  hingeDistances,
  netClassOf,
  spreadOf,
  structureOf,
  viewForm,
  viewSet,
  type Cell,
  type DistractorShape,
} from './structure'

type V3 = readonly [number, number, number]
type M3 = readonly [V3, V3, V3]

const row = (m: M3, i: number): V3 => m[i as 0 | 1 | 2]
const col = (m: M3, j: number): V3 => [m[0][j as 0 | 1 | 2], m[1][j as 0 | 1 | 2], m[2][j as 0 | 1 | 2]]
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const mul = (a: M3, b: M3): M3 => {
  const r = (i: number): V3 => [dot(row(a, i), col(b, 0)), dot(row(a, i), col(b, 1)), dot(row(a, i), col(b, 2))]
  return [r(0), r(1), r(2)]
}
const apply = (m: M3, v: V3): V3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)]
const transpose = (m: M3): M3 => [col(m, 0), col(m, 1), col(m, 2)]
const det = (a: V3, b: V3, c: V3): number => a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])
const same = (a: V3, b: V3): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]

const I3: M3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
/** Quarter turn about y taking +z to +x: folding the east neighbour down. */
const RY: M3 = [[0, 0, 1], [0, 1, 0], [-1, 0, 0]]
/** Quarter turn about x taking +z to −y: folding the south neighbour down. */
const RX: M3 = [[1, 0, 0], [0, 0, -1], [0, 1, 0]]

/**
 * Outward normals by composing rotation matrices (the verifier's own folding route): the first
 * square stays as the top face and every other square is reached by a chain of quarter turns.
 * Null when the squares are not edge-connected.
 */
export function foldByMatrices(cells: readonly Cell[]): V3[] | null {
  const index = new Map(cells.map(([r, c], i) => [`${r},${c}`, i]))
  const mats: (M3 | undefined)[] = cells.map(() => undefined)
  mats[0] = I3
  const queue = [0]
  const steps: [number, number, M3][] = [
    [0, 1, RY],
    [0, -1, transpose(RY)],
    [1, 0, RX],
    [-1, 0, transpose(RX)],
  ]
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h] as number
    const [r, c] = cells[i] as Cell
    for (const [dr, dc, step] of steps) {
      const j = index.get(`${r + dr},${c + dc}`)
      if (j !== undefined && mats[j] === undefined) {
        mats[j] = mul(mats[i] as M3, step)
        queue.push(j)
      }
    }
  }
  const out: V3[] = []
  for (const m of mats) {
    if (m === undefined) return null
    out.push(apply(m, [0, 0, 1]))
  }
  return out
}

/** The 24 rotations of the cube: signed permutation matrices with determinant +1. */
export const CUBE_ROTATIONS: readonly M3[] = (() => {
  const out: M3[] = []
  const perms = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ]
  for (const p of perms) {
    for (let signs = 0; signs < 8; signs++) {
      const r = (i: number): V3 => {
        const v = [0, 0, 0]
        v[p[i] as number] = signs & (1 << i) ? -1 : 1
        return v as unknown as V3
      }
      const m: M3 = [r(0), r(1), r(2)]
      if (det(m[0], m[1], m[2]) === 1) out.push(m)
    }
  }
  return Object.freeze(out)
})()

const Z: V3 = [0, 0, 1]
const X: V3 = [1, 0, 0]
const Y: V3 = [0, 1, 0]

/** Whether some rotation of the folded cube shows these normals as top (+z), front left (+x), front right (+y). */
export function possibleView(top: V3, left: V3, right: V3): boolean {
  return CUBE_ROTATIONS.some((r) => same(apply(r, top), Z) && same(apply(r, left), X) && same(apply(r, right), Y))
}

/** Why a view cannot be seen ("opposite", "mirror"; "repeat" for a repeated face), or null when it can (triple-product route). */
export function impossibleReason(top: V3, left: V3, right: V3): 'opposite' | 'mirror' | 'repeat' | null {
  if (same(top, left) || same(top, right) || same(left, right)) return 'repeat'
  if (dot(top, left) !== 0 || dot(top, right) !== 0 || dot(left, right) !== 0) return 'opposite'
  return det(top, left, right) === 1 ? null : 'mirror'
}

export function verifyCubenet(item: ItemInstance<CubenetSpec, CubenetKey>): VerifyResult {
  try {
    return check(item)
  } catch (e) {
    return { ok: false, reason: `malformed item: ${String(e)}`, checks: {} }
  }
}

function check(item: ItemInstance<CubenetSpec, CubenetKey>): VerifyResult {
  const problems = specProblems(item.spec)
  if (problems.length > 0) return verdict({ well_formed: false, problems: problems.join('; ') })
  const { net, options } = item.spec
  const cells = net.map((q): Cell => [q.r, q.c])
  const keyIndex = (item.key as { index?: unknown } | null)?.index
  const keyInRange = typeof keyIndex === 'number' && Number.isInteger(keyIndex) && keyIndex >= 0 && keyIndex < options.length
  const normals = foldByMatrices(cells)
  const folds = normals !== null && new Set(normals.map((n) => n.join(','))).size === 6
  const netClass = netClassOf(cells)
  if (!folds || normals === null || netClass === null || !keyInRange) {
    return verdict({ well_formed: true, key_in_range: keyInRange, net_folds_to_cube: folds, net_is_cube_net: netClass !== null })
  }
  const squareOf = new Map(net.map((q, i) => [q.mark, i]))
  const marksOnNet = options.every((o) => [o.top, o.left, o.right].every((m) => squareOf.has(m)))
  if (!marksOnNet) return verdict({ well_formed: true, marks_on_net: false })
  const sq = (m: Mark): number => squareOf.get(m) as number
  const nOf = (m: Mark): V3 => normals[sq(m)] as V3
  const possible = options.map((o) => possibleView(nOf(o.top), nOf(o.left), nOf(o.right)))
  const reasons = options.map((o) => impossibleReason(nOf(o.top), nOf(o.left), nOf(o.right)))
  const key = options[keyIndex] as CubeView
  const distractors = options.map((o, i) => ({ o, i, reason: reasons[i] })).filter((d) => d.i !== keyIndex)
  const nMirror = distractors.filter((d) => d.reason === 'mirror').length
  const nOpposite = distractors.filter((d) => d.reason === 'opposite').length

  // Option-only cues (the generator's rules, recomputed here).
  const sets = options.map(viewSet)
  const groupSizes = sets.map((s) => sets.filter((t) => t === s).length)
  const freq = new Map<Mark, number>()
  for (const o of options) for (const m of [o.top, o.left, o.right]) freq.set(m, (freq.get(m) ?? 0) + 1)
  const fsum = options.map((o) => [o.top, o.left, o.right].reduce((a, m) => a + (freq.get(m) as number), 0))
  const others = fsum.filter((_, i) => i !== keyIndex)
  const kf = fsum[keyIndex] as number

  const shapes: DistractorShape[] = distractors.map((d) => ({
    kind: d.reason === 'mirror' ? KIND_MIRROR : KIND_OPPOSITE,
    squares: [sq(d.o.top), sq(d.o.left), sq(d.o.right)],
  }))
  const keySquares = [sq(key.top), sq(key.left), sq(key.right)]
  const structure = structureOf(cells, keySquares, shapes)
  const layout = distractors.some((d) => viewSet(d.o) === viewSet(key)) ? 'pairs' : 'singles'
  const spread = spreadOf(hingeDistances(cells), keySquares)
  const recomputed = { n_mirror: nMirror, n_opposite: nOpposite, net_class: netClass, net_hard: netClass !== '141', key_spread: spread, layout } as const
  const b = cubenetBPrior(recomputed)
  const p = item.params as { model?: unknown; a?: unknown; b?: unknown; c?: unknown }

  return verdict({
    well_formed: true,
    four_options: options.length === CUBENET_OPTIONS && item.options_count === CUBENET_OPTIONS,
    key_in_range: true,
    net_folds_to_cube: true,
    net_is_cube_net: true,
    marks_on_net: true,
    key_is_possible: possible[keyIndex] === true,
    key_turn_matches: reasons[keyIndex] === null,
    unique_possible: possible.filter(Boolean).length === 1 && reasons.filter((r) => r === null).length === 1,
    distractor_reasons: distractors.every((d) => d.reason === 'mirror' || d.reason === 'opposite') && nMirror + nOpposite === 3,
    views_distinct: new Set(options.map(viewForm)).size === options.length,
    set_groups_uniform: new Set(groupSizes).size === 1,
    frequency_cue_absent: !others.every((s) => s < kf) && !others.every((s) => s > kf),
    structure_matches: canonicalJson(item.structural_params) === canonicalJson(structure),
    family_id_matches: item.family_id === familyId('cubenet', item.structural_params),
    features_match: canonicalJson(item.difficulty.features) === canonicalJson(recomputed),
    prior_matches: item.difficulty.b_prior === b && item.difficulty.sd_prior === CUBENET_SD_PRIOR && item.difficulty.provenance === CUBENET_PROVENANCE,
    stratum_matches: item.stratum === stratumOfB(b) && MIRRORS_OF_STRATUM[item.stratum] === nMirror,
    time_matches: item.expected_time_s === cubenetExpectedTime(recomputed) && item.time_limit_s === powerTimeLimit(item.expected_time_s),
    params_match: p.model === '3pl' && p.a === 1 && p.b === b && p.c === 1 / CUBENET_OPTIONS,
    layout,
    n_mirror: nMirror,
    n_opposite: nOpposite,
  })
}
