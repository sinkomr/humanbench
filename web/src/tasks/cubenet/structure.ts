/**
 * The cube-net family's combinatorics shared by the generator and the verifier (ROADMAP A11):
 * the 11 cube nets, the 8 placements of a net on the grid, hinge distances on a net, the
 * canonical form of a cube view, and the structural parameters (the `family_id` input). All
 * integer; the bank's `hb.gen.cubenet` builds the same `structural_params` with the same rules.
 *
 * The folding itself is NOT here: the generator folds by tracking each square's face frame
 * (`gen.ts`), the verifier by composing integer rotation matrices (`verify.ts`), two routes.
 */

import { MARKS, type CubeView, type Mark, type NetClass } from './spec'

export type Cell = readonly [number, number]

/**
 * The 11 cube nets, one placement each, with the class of their row pattern. A net's class is the
 * row lengths of the placement that has the most squares in a row: "141" (a row of four with one
 * square above and one below it; six nets), "231" (three nets), "222" (the staircase) and "33".
 */
export const NETS: readonly { readonly cls: NetClass; readonly cells: readonly Cell[] }[] = Object.freeze([
  { cls: '141', cells: [[0, 0], [1, 0], [1, 1], [1, 2], [1, 3], [2, 0]] },
  { cls: '141', cells: [[0, 0], [1, 0], [1, 1], [1, 2], [1, 3], [2, 1]] },
  { cls: '141', cells: [[0, 0], [1, 0], [1, 1], [1, 2], [1, 3], [2, 2]] },
  { cls: '141', cells: [[0, 0], [1, 0], [1, 1], [1, 2], [1, 3], [2, 3]] },
  { cls: '141', cells: [[0, 1], [1, 0], [1, 1], [1, 2], [1, 3], [2, 1]] },
  { cls: '141', cells: [[0, 1], [1, 0], [1, 1], [1, 2], [1, 3], [2, 2]] },
  { cls: '231', cells: [[0, 0], [0, 1], [1, 1], [1, 2], [1, 3], [2, 3]] },
  { cls: '231', cells: [[0, 0], [0, 1], [1, 1], [1, 2], [1, 3], [2, 2]] },
  { cls: '231', cells: [[0, 0], [0, 1], [1, 1], [1, 2], [1, 3], [2, 1]] },
  { cls: '222', cells: [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2], [2, 3]] },
  { cls: '33', cells: [[0, 0], [0, 1], [0, 2], [1, 2], [1, 3], [1, 4]] },
] as const)

/** The 8 symmetries of the square grid acting on (r, c): 4 turns, then 4 reflections. */
export const DIHEDRAL: readonly ((p: Cell) => Cell)[] = Object.freeze([
  ([r, c]: Cell): Cell => [r, c],
  ([r, c]: Cell): Cell => [c, -r],
  ([r, c]: Cell): Cell => [-r, -c],
  ([r, c]: Cell): Cell => [-c, r],
  ([r, c]: Cell): Cell => [r, -c],
  ([r, c]: Cell): Cell => [c, r],
  ([r, c]: Cell): Cell => [-r, c],
  ([r, c]: Cell): Cell => [-c, -r],
])

/** Translate cells so the smallest row and the smallest column are 0 (order kept). */
export function normalise(cells: readonly Cell[]): Cell[] {
  const r0 = Math.min(...cells.map((p) => p[0]))
  const c0 = Math.min(...cells.map((p) => p[1]))
  return cells.map(([r, c]): Cell => [r - r0, c - c0])
}

/** Placement `t` (0–7) of the cells, normalised (order kept). */
export function place(cells: readonly Cell[], t: number): Cell[] {
  const f = DIHEDRAL[t]
  if (f === undefined) throw new RangeError(`no placement ${t}`)
  return normalise(cells.map(f))
}

const cmpCell = (a: Cell, b: Cell): number => a[0] - b[0] || a[1] - b[1]

/** Lexicographic comparison of integer lists. */
export function cmpInts(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const d = (a[i] as number) - (b[i] as number)
    if (d !== 0) return d
  }
  return a.length - b.length
}

/** The canonical shape of a set of cells: the smallest row-major cell list over the 8 placements. */
export function canonicalShape(cells: readonly Cell[]): Cell[] {
  let best: Cell[] | null = null
  for (let t = 0; t < 8; t++) {
    const s = place(cells, t).sort(cmpCell)
    if (best === null || cmpInts(s.flat(), best.flat()) < 0) best = s
  }
  return best as Cell[]
}

const CLASS_BY_SHAPE: ReadonlyMap<string, NetClass> = new Map(NETS.map((n) => [JSON.stringify(canonicalShape(n.cells)), n.cls]))

/** The class of a cube net, or null when the cells are not one of the 11 cube nets. */
export function netClassOf(cells: readonly Cell[]): NetClass | null {
  return CLASS_BY_SHAPE.get(JSON.stringify(canonicalShape(cells))) ?? null
}

/** Hinge distances between the squares of an edge-connected net (BFS; −1 = not connected). */
export function hingeDistances(cells: readonly Cell[]): number[][] {
  const index = new Map(cells.map(([r, c], i) => [`${r},${c}`, i]))
  return cells.map((_, a) => {
    const d = cells.map(() => -1)
    d[a] = 0
    const queue = [a]
    for (let h = 0; h < queue.length; h++) {
      const i = queue[h] as number
      const [r, c] = cells[i] as Cell
      for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
        const j = index.get(`${r + dr},${c + dc}`)
        if (j !== undefined && d[j] === -1) {
          d[j] = (d[i] as number) + 1
          queue.push(j)
        }
      }
    }
    return d
  })
}

/** The largest hinge distance between two of the given squares. */
export function spreadOf(dist: readonly (readonly number[])[], squares: readonly number[]): number {
  let m = 0
  for (const a of squares) for (const b of squares) m = Math.max(m, (dist[a] as number[])[b] as number)
  return m
}

const markRank = (m: Mark): number => MARKS.indexOf(m)

/**
 * The canonical form of a view up to turning the cube about the viewed corner: its clockwise
 * cycle top → right → left, started at the mark that comes first in {@link MARKS}. Two options
 * are the same view iff their forms are equal.
 */
export function viewForm(v: CubeView): string {
  const cyc = [v.top, v.right, v.left]
  let s = 0
  for (let i = 1; i < 3; i++) if (markRank(cyc[i] as Mark) < markRank(cyc[s] as Mark)) s = i
  return [0, 1, 2].map((k) => cyc[(s + k) % 3]).join('>')
}

/** The mark set of a view (sorted by {@link MARKS} order), as text. */
export function viewSet(v: CubeView): string {
  return [v.top, v.left, v.right].sort((a, b) => markRank(a) - markRank(b)).join('+')
}

/** Distractor kinds in the structural parameters. */
export const KIND_OPPOSITE = 0
export const KIND_MIRROR = 1

/** One distractor in structural terms: its kind and the net squares (spec indices) of its three marks. */
export interface DistractorShape {
  readonly kind: typeof KIND_OPPOSITE | typeof KIND_MIRROR
  readonly squares: readonly number[]
}

/** The structural parameters of an item (A11: the family_id input). */
export interface CubenetStructure {
  /** The canonical placement of the net: six [r, c], row-major. */
  readonly net: readonly Cell[]
  /** The key's three squares, as sorted indices into `net`. */
  readonly key: readonly number[]
  /** Each distractor as [kind, i, j, k] (kind 0 = opposite pair, 1 = mirror), sorted. */
  readonly distractors: readonly (readonly number[])[]
}

/**
 * Structural parameters: the net, the key's squares and every distractor's kind and squares, in
 * the placement of the net (of the 8) whose list [net…, key…, distractors…] is smallest. The marks
 * themselves, which face is on top and the option order are not structure. A reflected net folds
 * into the mirror cube, which turns every view into its mirror view; but kinds and square sets do
 * not change under it, so the 8 placements give one structure (a mirrored item is an isomorph).
 */
export function structureOf(cells: readonly Cell[], key: readonly number[], distractors: readonly DistractorShape[]): CubenetStructure {
  let best: { flat: number[]; s: CubenetStructure } | null = null
  for (let t = 0; t < 8; t++) {
    const placed = place(cells, t)
    const order = placed.map((_, i) => i).sort((a, b) => cmpCell(placed[a] as Cell, placed[b] as Cell))
    const rank: number[] = []
    order.forEach((i, pos) => (rank[i] = pos))
    const net = order.map((i) => placed[i] as Cell)
    const sortIdx = (sq: readonly number[]): number[] => sq.map((i) => rank[i] as number).sort((a, b) => a - b)
    const ds = distractors.map((d) => [d.kind, ...sortIdx(d.squares)]).sort(cmpInts)
    const s: CubenetStructure = { net, key: sortIdx(key), distractors: ds }
    const flat = [...net.flat(), ...s.key, ...ds.flat()]
    if (best === null || cmpInts(flat, best.flat) < 0) best = { flat, s }
  }
  const s = (best as { s: CubenetStructure }).s
  return { net: s.net.map(([r, c]) => [r, c] as Cell), key: [...s.key], distractors: s.distractors.map((d) => [...d]) }
}
