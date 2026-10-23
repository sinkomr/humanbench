/**
 * Generator of the cube-net family (DESIGN §3 row 7, §4.2; ROADMAP A1, A9, A11).
 *
 * 1. The mirror-distractor count n_mirror: uniform 0–3 in the natural pool; the stratum's count for
 *    a requested stratum (`prior.ts` MIRRORS_OF_STRATUM), redrawing until b lies in its band.
 * 2. One of the 11 nets (uniform) in one of its 8 placements (uniform), squares row by row; six of
 *    the eight marks, shuffled onto the squares.
 * 3. Fold: the first square is the cube's top face (+z) and the cube hangs below the paper (marks
 *    outside); each square's face frame (outward normal n, the net's "east" e and "south" s on that
 *    face) is carried square to square: east → (e, −n, s), west → (−e, n, s), south → (s, e, −n),
 *    north → (−s, e, n), starting from (+z, +x, −y).
 * 4. Corners: the corner with outward faces (sx·x, sy·y, sz·z) is seen from outside with its faces
 *    in clockwise order (X, Y, Z) when sx·sy·sz = −1 and (X, Z, Y) otherwise (clockwise as seen ⇔
 *    det = −1). A view's clockwise order is top → front right → front left.
 * 5. Options: the key (a random corner's clockwise triple, turned so a random one of its faces is on
 *    top), n_mirror mirror views (other corners' triples in reversed order) and 3 − n_mirror
 *    opposite-pair views (two opposite faces and a third, either order). With n_mirror = 1 half the
 *    items use the "pairs" layout instead: the key's own mirror view plus one opposite-pair set in
 *    both orders, so every option shares its mark set with exactly one other.
 * 6. Option-only cue checks (redraw on failure): every option is in a mark-set group of the same
 *    size (all different sets, or all in pairs), so "pick the option whose marks recur" gains
 *    nothing; the key's summed mark frequency over the four options is neither the unique largest
 *    nor the unique smallest; the four views are pairwise different up to turning about the corner.
 * 7. Shuffle the options; the key is its display position.
 */

import type { BuildContext, BuiltItem } from '../family'
import type { Rng } from '../../engine/prng'
import type { Stratum } from '../ids'
import { stratumOfB } from '../priors'
import { CUBENET_PROVENANCE, CUBENET_SD_PRIOR, MIRRORS_OF_STRATUM, cubenetBPrior, cubenetExpectedTime } from './prior'
import {
  CUBENET_OPTIONS,
  MARKS,
  NET_SQUARES,
  type CubeView,
  type CubenetFeatures,
  type CubenetKey,
  type CubenetSpec,
  type Layout,
  type Mark,
} from './spec'
import {
  KIND_MIRROR,
  KIND_OPPOSITE,
  NETS,
  hingeDistances,
  place,
  spreadOf,
  structureOf,
  viewForm,
  viewSet,
  type Cell,
  type DistractorShape,
} from './structure'

type V3 = readonly [number, number, number]

const neg = (v: V3): V3 => [-v[0], -v[1], -v[2]]
const vkey = (v: V3): string => v.join(',')

/** Outward face normal of every square of a net (step 3 of the module comment). */
export function foldByFrames(cells: readonly Cell[]): V3[] {
  const index = new Map(cells.map(([r, c], i) => [`${r},${c}`, i]))
  const frames: ({ n: V3; e: V3; s: V3 } | undefined)[] = cells.map(() => undefined)
  frames[0] = { n: [0, 0, 1], e: [1, 0, 0], s: [0, -1, 0] }
  const queue = [0]
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h] as number
    const { n, e, s } = frames[i] as { n: V3; e: V3; s: V3 }
    const [r, c] = cells[i] as Cell
    const steps: [number, number, { n: V3; e: V3; s: V3 }][] = [
      [0, 1, { n: e, e: neg(n), s }],
      [0, -1, { n: neg(e), e: n, s }],
      [1, 0, { n: s, e, s: neg(n) }],
      [-1, 0, { n: neg(s), e, s: n }],
    ]
    for (const [dr, dc, f] of steps) {
      const j = index.get(`${r + dr},${c + dc}`)
      if (j !== undefined && frames[j] === undefined) {
        frames[j] = f
        queue.push(j)
      }
    }
  }
  return frames.map((f) => {
    if (f === undefined) throw new Error('cubenet: the net is not connected')
    return f.n
  })
}

/** A corner of the folded cube: its three squares in clockwise order as seen from outside. */
interface Corner {
  readonly squares: readonly [number, number, number]
}

/** The 8 corners (step 4). */
export function cornersOf(normals: readonly V3[]): Corner[] {
  const at = new Map(normals.map((n, i) => [vkey(n), i]))
  const sq = (v: V3): number => {
    const i = at.get(vkey(v))
    if (i === undefined) throw new Error('cubenet: the net does not fold into a cube')
    return i
  }
  const out: Corner[] = []
  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      for (const sz of [1, -1]) {
        const x = sq([sx, 0, 0])
        const y = sq([0, sy, 0])
        const z = sq([0, 0, sz])
        out.push({ squares: sx * sy * sz === -1 ? [x, y, z] : [x, z, y] })
      }
    }
  }
  return out
}

/** A view whose clockwise cycle top → right → left is (a, b, c) turned by `shift` (0–2). */
function viewOf(cycle: readonly [Mark, Mark, Mark], shift: number): CubeView {
  const t = cycle[shift % 3] as Mark
  const r = cycle[(shift + 1) % 3] as Mark
  const l = cycle[(shift + 2) % 3] as Mark
  return { top: t, right: r, left: l }
}

/** The 12 three-square sets that contain an opposite pair: each pair of opposite squares with each of the other four. */
function oppositeSets(normals: readonly V3[]): [number, number, number][] {
  const at = new Map(normals.map((n, i) => [vkey(n), i]))
  const out: [number, number, number][] = []
  for (const axis of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as V3[]) {
    const p = at.get(vkey(axis)) as number
    const q = at.get(vkey(neg(axis))) as number
    for (let o = 0; o < NET_SQUARES; o++) if (o !== p && o !== q) out.push([p, q, o])
  }
  return out
}

/** Option-only cue checks (step 6); `options[0]` is the key. */
export function cueProblems(options: readonly CubeView[], keyIndex: number): string[] {
  const out: string[] = []
  const sets = options.map(viewSet)
  const groupSize = sets.map((s) => sets.filter((t) => t === s).length)
  if (new Set(groupSize).size !== 1) out.push('mark-set groups differ in size')
  const freq = new Map<Mark, number>()
  for (const o of options) for (const m of [o.top, o.left, o.right]) freq.set(m, (freq.get(m) ?? 0) + 1)
  const score = options.map((o) => [o.top, o.left, o.right].reduce((a, m) => a + (freq.get(m) as number), 0))
  const k = score[keyIndex] as number
  const others = score.filter((_, i) => i !== keyIndex)
  if (others.every((s) => s < k)) out.push('the key has the unique largest mark frequency')
  if (others.every((s) => s > k)) out.push('the key has the unique smallest mark frequency')
  if (new Set(options.map(viewForm)).size !== options.length) out.push('two options are the same view')
  return out
}

/** Attempts per item before giving up (a requested stratum is reached in a few). */
const MAX_ATTEMPTS = 2_000

export function buildCubenet(rng: Rng, ctx: BuildContext): BuiltItem<CubenetSpec, CubenetKey> {
  const target = ctx.stratum
  if (target !== undefined && MIRRORS_OF_STRATUM[target] === undefined) throw new RangeError(`cubenet cannot generate stratum ${target}`)
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const nMirror = target === undefined ? rng.int(0, 3) : (MIRRORS_OF_STRATUM[target] as number)
    const netNo = rng.int(0, NETS.length - 1)
    const net = NETS[netNo] as (typeof NETS)[number]
    const cells = place(net.cells, rng.int(0, 7)).sort((a, b) => a[0] - b[0] || a[1] - b[1])
    const marks = rng.shuffle(MARKS).slice(0, NET_SQUARES)
    const markOf = (i: number): Mark => marks[i] as Mark
    const normals = foldByFrames(cells)
    const corners = cornersOf(normals)
    const keyCorner = rng.int(0, 7)
    const cycleOf = (sq: readonly number[]): [Mark, Mark, Mark] => [markOf(sq[0] as number), markOf(sq[1] as number), markOf(sq[2] as number)]
    const real = (corners[keyCorner] as Corner).squares
    const layout: Layout = nMirror === 1 && rng.next() < 0.5 ? 'pairs' : 'singles'
    const shapes: DistractorShape[] = []
    const views: CubeView[] = [viewOf(cycleOf(real), rng.int(0, 2))]
    const opp = oppositeSets(normals)
    if (layout === 'pairs') {
      const mirror = [real[0], real[2], real[1]]
      views.push(viewOf(cycleOf(mirror), rng.int(0, 2)))
      shapes.push({ kind: KIND_MIRROR, squares: mirror })
      const set = rng.pick(opp)
      views.push(viewOf(cycleOf(set), rng.int(0, 2)))
      views.push(viewOf(cycleOf([set[0], set[2], set[1]]), rng.int(0, 2)))
      shapes.push({ kind: KIND_OPPOSITE, squares: set }, { kind: KIND_OPPOSITE, squares: set })
    } else {
      const others = rng.shuffle(corners.filter((_, i) => i !== keyCorner)).slice(0, nMirror)
      for (const c of others) {
        const mirror = [c.squares[0], c.squares[2], c.squares[1]]
        views.push(viewOf(cycleOf(mirror), rng.int(0, 2)))
        shapes.push({ kind: KIND_MIRROR, squares: mirror })
      }
      for (const set of rng.shuffle(opp).slice(0, 3 - nMirror)) {
        const order = rng.int(0, 1) === 0 ? set : ([set[0], set[2], set[1]] as const)
        views.push(viewOf(cycleOf(order), rng.int(0, 2)))
        shapes.push({ kind: KIND_OPPOSITE, squares: set })
      }
    }
    if (cueProblems(views, 0).length > 0) continue
    const dist = hingeDistances(cells)
    const features: CubenetFeatures = {
      n_mirror: nMirror,
      n_opposite: 3 - nMirror,
      net_class: net.cls,
      net_hard: net.cls !== '141',
      key_spread: spreadOf(dist, real),
      layout,
    }
    const bPrior = cubenetBPrior(features)
    const stratum: Stratum = stratumOfB(bPrior)
    if (target !== undefined && stratum !== target) continue
    const order = rng.shuffle([0, 1, 2, 3])
    const options = order.map((i) => views[i] as CubeView)
    return {
      stratum,
      spec: { net: cells.map(([r, c], i) => ({ r, c, mark: markOf(i) })), options },
      key: { index: order.indexOf(0) },
      structural_params: structureOf(cells, real, shapes) as unknown as BuiltItem<CubenetSpec, CubenetKey>['structural_params'],
      options_count: CUBENET_OPTIONS,
      difficulty: { features: { ...features }, b_prior: bPrior, sd_prior: CUBENET_SD_PRIOR, provenance: CUBENET_PROVENANCE },
      expected_time_s: cubenetExpectedTime(features),
    }
  }
  throw new Error(`cubenet: no item after ${MAX_ATTEMPTS} attempts (stratum ${String(target)})`)
}
