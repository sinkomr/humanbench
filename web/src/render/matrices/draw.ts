/**
 * Pure drawing and description of matrix cells (ROADMAP M1.13; DESIGN §4.2 "Matrices", §13
 * accessibility; `tasks/matrices/grammar.ts` render contract). The Svelte cell component only
 * writes out what these functions return, so the geometry, the palette contrast and the text
 * alternatives are unit-tested without a DOM.
 *
 * A cell is a 100 × 100 square split into a 3 × 3 sub-grid of slots (0–8, row-major); each
 * occupied slot holds one object of the cell's shape, size, grey and orientation. Objects:
 * - **shape**: a regular triangle, pentagon or hexagon with a vertex up, a flat-topped square, or
 *   a circle, of circumradius {@link SIZE_RADIUS} (small / medium / large, 1.35× steps);
 * - **orientation** 0/45/90/135° rotates the whole object clockwise, and every object carries an
 *   **orientation stripe**: the chord through its centre that is vertical at 0°, so all four
 *   orientations are visible for every shape, the circle included (the grammar's render contract);
 * - **color**: four greys ({@link GREYS}) with a black outline. Palette rules (WCAG 1.4.11 non-text
 *   contrast, tested): the outline is ≥ 3:1 against the paper; every fill but black is ≥ 3:1
 *   against the outline (black merges into it, and its silhouette is 21:1 against the paper);
 *   the stripe is ≥ 3:1 against its fill; and neighbouring greys are as far apart as four
 *   levels allow. (Three steps of ≥ 3:1 each would need a 27:1 range, and white to black is
 *   21:1, so the greys are spread evenly in contrast with dark grey at the 3:1 floor against the
 *   outline: steps ≈ 2.6, 2.6 and 3.0.) The stimulus keeps its paper-white cells in both themes.
 *
 * Coordinates are rounded to 0.01 so the SVG (and its snapshot) is stable.
 */

import { COLORS, ORIENTATIONS, SHAPES, SIZES, type Color, type MatrixCell, type Shape, type Size } from '../../tasks/matrices/grammar'

export const CELL = 100
export const SLOT = CELL / 3

/** Circumradius of an object by size: 1.35× steps; large still leaves a gap between slots and to the border. */
export const SIZE_RADIUS: Readonly<Record<Size, number>> = Object.freeze({ small: 7.4, medium: 10, large: 13.5 })

/** sRGB hex of the four greys (grammar order, light → dark). */
export const GREYS: Readonly<Record<Color, string>> = Object.freeze({
  white: '#ffffff',
  light_grey: '#9f9f9f',
  dark_grey: '#5a5a5a',
  black: '#000000',
})

/** Cell background (paper) and every object's outline. */
export const PAPER = '#ffffff'
export const OUTLINE = '#000000'
/** Cell border (≥ 3:1 against the paper and against the dark page background). */
export const CELL_BORDER = '#767676'

export const OUTLINE_WIDTH = 1.6
export const STRIPE_WIDTH = 2.2

/** The stripe contrasts with its fill: black on the light greys, white on the dark ones. */
export function stripeColor(color: Color): string {
  return color === 'white' || color === 'light_grey' ? '#000000' : '#ffffff'
}

// --- geometry ------------------------------------------------------------------------------------

export type Point = readonly [number, number]

const round2 = (x: number): number => Math.round(x * 100) / 100 + 0 // + 0 turns −0 into 0

/** Centre of slot s (0–8, row-major). */
export function slotCentre(slot: number): Point {
  if (!(Number.isInteger(slot) && slot >= 0 && slot < 9)) throw new RangeError(`slot ${slot} is not in 0–8`)
  return [SLOT * (slot % 3) + SLOT / 2, SLOT * Math.floor(slot / 3) + SLOT / 2]
}

/** Vertex angles (degrees, clockwise from up, y down) of each polygon at orientation 0. */
const POLYGON_VERTEX_ANGLES: Readonly<Partial<Record<Shape, readonly number[]>>> = Object.freeze({
  triangle: [0, 120, 240],
  square: [45, 135, 225, 315],
  pentagon: [0, 72, 144, 216, 288],
  hexagon: [0, 60, 120, 180, 240, 300],
})

/**
 * Where the vertical line through the centre leaves the unrotated shape, as distances up and down
 * from the centre, in units of the circumradius (the stripe's two ends).
 */
export const STRIPE_REACH: Readonly<Record<Shape, readonly [number, number]>> = Object.freeze({
  triangle: [1, 0.5],
  square: [Math.SQRT1_2, Math.SQRT1_2],
  pentagon: [1, Math.cos(Math.PI / 5)],
  hexagon: [1, 1],
  circle: [1, 1],
})

/** Point at distance r from (cx, cy) in direction `deg` (clockwise from up; SVG y points down). */
function polar(cx: number, cy: number, r: number, deg: number): Point {
  const a = (deg * Math.PI) / 180
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)]
}

/** One object of a cell, ready for SVG. */
export interface CellObject {
  /** `polygon` points "x,y x,y …", or null for a circle. */
  readonly points: string | null
  readonly cx: number
  readonly cy: number
  /** Circumradius. */
  readonly r: number
  readonly fill: string
  /** The orientation stripe, from its upper end at orientation 0 to its lower end. */
  readonly stripe: { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly stroke: string }
}

/** Polygon vertices of an object (null for a circle), rotated by `orientation` degrees clockwise. */
export function objectVertices(shape: Shape, cx: number, cy: number, r: number, orientation: number): Point[] | null {
  const angles = POLYGON_VERTEX_ANGLES[shape]
  return angles === undefined ? null : angles.map((a) => polar(cx, cy, r, a + orientation))
}

/** The objects of a cell, one per occupied slot, in slot order. */
export function cellObjects(cell: MatrixCell): CellObject[] {
  if (!SHAPES.includes(cell.shape)) throw new RangeError(`unknown shape ${String(cell.shape)}`)
  if (!SIZES.includes(cell.size)) throw new RangeError(`unknown size ${String(cell.size)}`)
  if (!COLORS.includes(cell.color)) throw new RangeError(`unknown color ${String(cell.color)}`)
  if (!ORIENTATIONS.includes(cell.orientation)) throw new RangeError(`unknown orientation ${String(cell.orientation)}`)
  const r = SIZE_RADIUS[cell.size]
  const [up, down] = STRIPE_REACH[cell.shape]
  return cell.positions.map((slot) => {
    const [cx, cy] = slotCentre(slot)
    const vertices = objectVertices(cell.shape, cx, cy, r, cell.orientation)
    const [x1, y1] = polar(cx, cy, r * up, cell.orientation)
    const [x2, y2] = polar(cx, cy, r * down, cell.orientation + 180)
    return {
      points: vertices === null ? null : vertices.map(([x, y]) => `${round2(x)},${round2(y)}`).join(' '),
      cx: round2(cx),
      cy: round2(cy),
      r: round2(r),
      fill: GREYS[cell.color],
      stripe: { x1: round2(x1), y1: round2(y1), x2: round2(x2), y2: round2(y2), stroke: stripeColor(cell.color) },
    }
  })
}

// --- text alternatives ---------------------------------------------------------------------------

/** Names of the nine slots, row-major. */
export const SLOT_NAMES: readonly string[] = Object.freeze([
  'top left',
  'top middle',
  'top right',
  'middle left',
  'centre',
  'middle right',
  'bottom left',
  'bottom middle',
  'bottom right',
])

const COLOR_NAMES: Readonly<Record<Color, string>> = Object.freeze({ white: 'white', light_grey: 'light grey', dark_grey: 'dark grey', black: 'black' })

const SHAPE_PLURALS: Readonly<Record<Shape, string>> = Object.freeze({
  triangle: 'triangles',
  square: 'squares',
  pentagon: 'pentagons',
  hexagon: 'hexagons',
  circle: 'circles',
})

/** "a", "a and b", "a, b and c". */
function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] as string}`
}

/**
 * Structural text alternative of a cell: count, size, grey, shape, orientation and positions, e.g.
 * "2 large dark grey hexagons, turned 45°, at top left and centre". Every attribute the grammar
 * varies is named, in a fixed order, so two cells get the same text exactly when they look the same.
 */
export function describeCell(cell: MatrixCell): string {
  const n = cell.positions.length
  const shape = n === 1 ? cell.shape : SHAPE_PLURALS[cell.shape]
  const where = listOf(cell.positions.map((s) => SLOT_NAMES[s] ?? `slot ${s}`))
  return `${n} ${cell.size} ${COLOR_NAMES[cell.color]} ${shape}, turned ${cell.orientation}°, at ${where}`
}

/** Label of the grid cell in row r, column c (1-based). */
export function gridCellLabel(row: number, col: number, cell: MatrixCell): string {
  return `Row ${row}, column ${col}: ${describeCell(cell)}`
}
