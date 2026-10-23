/**
 * Wire types and constants of the cube-net family (DESIGN §3 row 7 "Spatial", §4.2, §12; ROADMAP
 * A9, A11).
 *
 * Render payload (`spec`): `{ net: [{ r, c, mark }] × 6, options: [{ top, left, right }] × 4 }`.
 * - `net`: the six squares of a cube net (a hexomino that folds into a cube) as integer grid
 *   positions, row `r` from the top and column `c` from the left, both from 0, listed row by row
 *   (sorted by r, then c). Each square carries a distinct {@link Mark}, printed on the side that
 *   ends up on the OUTSIDE of the folded cube. The pattern is seen from the printed side.
 * - `options`: four cubes in display order (M1.13), each seen from above one corner: the marks on
 *   its top face, its front-left face and its front-right face.
 *
 * Every mark looks the same however it is turned or flipped (each is symmetric under the 8
 * symmetries of the square), so a view of a cube is fully described by which marks its three
 * visible faces carry and where: the face orientation never matters.
 *
 * Key (`key`): `{ index }`, the option that the net can fold into (never in `spec`). The spec holds
 * no face directions, corner ids, validity flags or distractor kinds.
 */

import type { ItemInstance } from '../family'

export const CUBENET_OPTIONS = 4

/** Squares of a cube net. */
export const NET_SQUARES = 6

/**
 * The marks (ids on the wire; the renderer's `copy.ts` names them). Eight marks that stay distinct
 * when drawn on a skewed cube face; a net uses six of them. Each is symmetric under the 8
 * symmetries of the square (no filled diamond: on a skewed face it is the filled square turned 45°).
 */
export const MARKS = Object.freeze(['disc', 'ring', 'plus', 'cross', 'square', 'dots', 'target', 'frame'] as const)

export type Mark = (typeof MARKS)[number]

export const isMark = (v: unknown): v is Mark => typeof v === 'string' && (MARKS as readonly string[]).includes(v)

/** A square of the net: grid row and column (from 0) and its mark. */
export interface NetSquare {
  readonly r: number
  readonly c: number
  readonly mark: Mark
}

/**
 * A cube seen from above one corner: the marks of the top, front-left and front-right faces. Read
 * as seen by the viewer, going top → front right → front left is clockwise.
 */
export interface CubeView {
  readonly top: Mark
  readonly left: Mark
  readonly right: Mark
}

export interface CubenetSpec {
  readonly net: readonly NetSquare[]
  readonly options: readonly CubeView[]
}

export interface CubenetKey {
  /** Display position of the cube the net folds into. */
  readonly index: number
}

/** The chosen option's display position. */
export type CubenetResponse = number

/**
 * The difficulty features (prior.ts): `n_mirror` + `n_opposite` = 3 distractors; `net_class` the
 * net's row pattern ("141" = a row of four with one square on each side, "231", "222", "33");
 * `net_hard` = not "141"; `key_spread` = the largest number of hinges between two of the key's
 * three squares on the net (2–5); `layout` = "pairs" (the key's own mirror view plus one
 * opposite-pair set in both orders) or "singles" (four different mark sets).
 */
export interface CubenetFeatures {
  readonly n_mirror: number
  readonly n_opposite: number
  readonly net_class: NetClass
  readonly net_hard: boolean
  readonly key_spread: number
  readonly layout: Layout
}

export type NetClass = '141' | '231' | '222' | '33'
export type Layout = 'pairs' | 'singles'

export type CubenetItem = ItemInstance<CubenetSpec, CubenetKey>

/** The largest grid coordinate a well-formed net may use (cube nets fit in 2 × 5 or 3 × 4). */
export const MAX_COORD = 4

const isCoord = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_COORD

/**
 * What stops the renderer from drawing `spec` (empty = drawable): six squares at distinct integer
 * grid positions in 0–4 with six distinct known marks, edge-connected, and four options of three
 * distinct known marks each. The lazy renderer loader uses it as its `fits` check. It does not
 * check that the net folds into a cube or which option is right (that is the verifier's job).
 */
export function specProblems(spec: unknown): string[] {
  const out: string[] = []
  if (typeof spec !== 'object' || spec === null) return ['spec is not an object']
  const s = spec as { net?: unknown; options?: unknown }
  if (!Array.isArray(s.net) || s.net.length !== NET_SQUARES) out.push(`net must have ${NET_SQUARES} squares`)
  else {
    const seen = new Set<string>()
    const marks = new Set<string>()
    for (const [i, q] of (s.net as unknown[]).entries()) {
      const sq = q as { r?: unknown; c?: unknown; mark?: unknown } | null
      if (typeof sq !== 'object' || sq === null || !isCoord(sq.r) || !isCoord(sq.c) || !isMark(sq.mark)) {
        out.push(`net square ${i} is not { r, c, mark } with r, c in 0–${MAX_COORD} and a known mark`)
        continue
      }
      seen.add(`${sq.r},${sq.c}`)
      marks.add(sq.mark)
    }
    if (out.length === 0) {
      if (seen.size !== NET_SQUARES) out.push('net squares overlap')
      if (marks.size !== NET_SQUARES) out.push('net marks repeat')
      if (!connected((s.net as NetSquare[]).map((q) => [q.r, q.c] as const))) out.push('net squares are not joined edge to edge')
    }
  }
  if (!Array.isArray(s.options) || s.options.length !== CUBENET_OPTIONS) out.push(`options must have ${CUBENET_OPTIONS} cubes`)
  else {
    for (const [i, o] of (s.options as unknown[]).entries()) {
      const v = o as { top?: unknown; left?: unknown; right?: unknown } | null
      if (typeof v !== 'object' || v === null || !isMark(v.top) || !isMark(v.left) || !isMark(v.right)) out.push(`option ${i} is not { top, left, right } of known marks`)
      else if (new Set([v.top, v.left, v.right]).size !== 3) out.push(`option ${i} repeats a mark`)
    }
  }
  return out
}

/** Whether the grid squares form one edge-connected piece. */
export function connected(cells: readonly (readonly [number, number])[]): boolean {
  if (cells.length === 0) return false
  const key = (r: number, c: number): string => `${r},${c}`
  const all = new Set(cells.map(([r, c]) => key(r, c)))
  const first = cells[0] as readonly [number, number]
  const seen = new Set([key(first[0], first[1])])
  const stack = [first]
  while (stack.length > 0) {
    const [r, c] = stack.pop() as readonly [number, number]
    for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const k = key(r + dr, c + dc)
      if (all.has(k) && !seen.has(k)) {
        seen.add(k)
        stack.push([r + dr, c + dc])
      }
    }
  }
  return seen.size === all.size
}
