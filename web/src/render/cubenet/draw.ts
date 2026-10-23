/**
 * Geometry of the cube-net renderer (DESIGN §4.2, §13): the marks as filled SVG paths in a
 * 100 × 100 square, the net laid out on a 100-unit grid, and the isometric cube whose three
 * visible faces carry the same mark paths through an affine `matrix()` (so a mark looks like the
 * same mark lying on the face). Fixed paper colours (white, two light greys) with black ink, as in
 * the matrices cells, so the figure reads the same in the light and the dark theme (black on the
 * darkest face is ≥ 12:1). Faces differ only slightly in shade, for depth; nothing is colour-coded.
 */

import type { CubeView, Mark, NetSquare } from '../../tasks/cubenet/spec'

/** Side of a square of the net and of a cube edge, in SVG units. */
export const UNIT = 100
export const INK = '#000000'
export const PAPER = '#ffffff'
export const FOLD = '#6b6b6b'
/** Face shades: top, front left, front right (depth cue only). */
export const FACE_FILL = Object.freeze({ top: '#ffffff', left: '#e6e6e6', right: '#cfcfcf' })
export const EDGE_WIDTH = 3

/** One filled part of a mark: an SVG path and its fill rule. */
export interface MarkPart {
  readonly d: string
  readonly rule: 'nonzero' | 'evenodd'
}

const circle = (cx: number, cy: number, r: number): string => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`
const rect = (x0: number, y0: number, x1: number, y1: number): string => `M${x0} ${y0}H${x1}V${y1}H${x0}Z`

/** The marks in the square [0, 100]² (each symmetric under the square's 8 symmetries). */
export const MARK_PARTS: Readonly<Record<Mark, readonly MarkPart[]>> = Object.freeze({
  disc: [{ d: circle(50, 50, 28), rule: 'nonzero' }],
  ring: [{ d: circle(50, 50, 31) + circle(50, 50, 19), rule: 'evenodd' }],
  plus: [
    { d: rect(42, 16, 58, 84), rule: 'nonzero' },
    { d: rect(16, 42, 84, 58), rule: 'nonzero' },
  ],
  cross: [
    { d: 'M19 29L29 19L81 71L71 81Z', rule: 'nonzero' },
    { d: 'M71 19L81 29L29 81L19 71Z', rule: 'nonzero' },
  ],
  square: [{ d: rect(28, 28, 72, 72), rule: 'nonzero' }],
  dots: [{ d: circle(29, 29, 10) + circle(71, 29, 10) + circle(29, 71, 10) + circle(71, 71, 10), rule: 'nonzero' }],
  target: [
    { d: circle(50, 50, 33) + circle(50, 50, 23), rule: 'evenodd' },
    { d: circle(50, 50, 10), rule: 'nonzero' },
  ],
  frame: [{ d: rect(20, 20, 80, 80) + rect(31, 31, 69, 69), rule: 'evenodd' }],
})

/** The net's grid size (columns, rows). */
export function netSize(net: readonly NetSquare[]): { cols: number; rows: number } {
  return { cols: Math.max(...net.map((q) => q.c)) + 1, rows: Math.max(...net.map((q) => q.r)) + 1 }
}

/** A line segment of the net drawing. */
export interface Segment {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

/**
 * The net's edges: `folds` are the sides two squares share (drawn as light dashed fold lines),
 * `outline` the sides on the outside of the pattern (solid ink).
 */
export function netEdges(net: readonly NetSquare[]): { folds: Segment[]; outline: Segment[] } {
  const at = new Set(net.map((q) => `${q.r},${q.c}`))
  const folds: Segment[] = []
  const outline: Segment[] = []
  for (const { r, c } of net) {
    const x = c * UNIT
    const y = r * UNIT
    const sides: [number, number, Segment][] = [
      [-1, 0, { x1: x, y1: y, x2: x + UNIT, y2: y }],
      [1, 0, { x1: x, y1: y + UNIT, x2: x + UNIT, y2: y + UNIT }],
      [0, -1, { x1: x, y1: y, x2: x, y2: y + UNIT }],
      [0, 1, { x1: x + UNIT, y1: y, x2: x + UNIT, y2: y + UNIT }],
    ]
    for (const [dr, dc, seg] of sides) {
      if (!at.has(`${r + dr},${c + dc}`)) outline.push(seg)
      else if (dr === 1 || dc === 1) folds.push(seg)
    }
  }
  return { folds, outline }
}

/** Half the width of the isometric cube: UNIT · √3 / 2. */
export const ISO_HALF_WIDTH = (UNIT * Math.sqrt(3)) / 2

/** A visible face of a cube option: its outline and the affine map of the [0, 100]² mark square onto it. */
export interface CubeFace {
  readonly face: keyof CubeView
  readonly points: string
  readonly transform: string
  readonly fill: string
}

const k = ISO_HALF_WIDTH
const h = UNIT / 2
const fmt = (v: number): string => String(Math.round(v * 1000) / 1000)

/** One face from its origin corner O and its two edge vectors U, V (in SVG units). */
function face(name: keyof CubeView, o: [number, number], u: [number, number], v: [number, number]): CubeFace {
  const pts = [o, [o[0] + u[0], o[1] + u[1]], [o[0] + u[0] + v[0], o[1] + u[1] + v[1]], [o[0] + v[0], o[1] + v[1]]]
  return {
    face: name,
    points: pts.map((p) => `${fmt(p[0] as number)},${fmt(p[1] as number)}`).join(' '),
    transform: `matrix(${[u[0] / UNIT, u[1] / UNIT, v[0] / UNIT, v[1] / UNIT, o[0], o[1]].map(fmt).join(' ')})`,
    fill: FACE_FILL[name],
  }
}

/**
 * The three visible faces of a cube seen from above its near corner (at the origin): the top
 * rhombus above it, the front-left face below left and the front-right face below right.
 */
export const CUBE_FACES: readonly CubeFace[] = Object.freeze([
  face('top', [0, 0], [k, -h], [-k, -h]),
  face('left', [0, 0], [-k, -h], [0, UNIT]),
  face('right', [0, 0], [k, -h], [0, UNIT]),
])

/** viewBox of a cube option (margin for the edge stroke). */
export const CUBE_VIEWBOX = `${fmt(-k - 4)} ${-UNIT - 4} ${fmt(2 * k + 8)} ${2 * UNIT + 8}`
