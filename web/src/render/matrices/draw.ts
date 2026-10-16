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
 * **Frame** (hard template b, generator 1.3.0, M3.12): a framed cell also has a square band
 * {@link FRAME_WIDTH} wide whose centre line is {@link FRAME_INSET} inside the cell edge, in one of
 * three shades ({@link FRAME_GREYS}: every one ≥ 3:1 against the paper, neighbours ≈ 2.6:1 apart)
 * and patterns (solid; dashed: 10-on 5-off with an L-shaped dash on every corner; dotted: round
 * dots with one on every corner, both measured on a normalized `pathLength` so every side looks
 * the same). The objects of a framed cell are drawn {@link FRAME_INNER_SCALE} times as large
 * about the centre so they clear the band (every cell of a framed item is framed, so sizes still
 * compare across the item). A cell without a frame is drawn exactly as before.
 *
 * Coordinates are rounded to 0.01 so the SVG (and its snapshot) is stable.
 */

import {
  COLORS,
  FRAME_PATTERNS,
  FRAME_SHADES,
  ORIENTATIONS,
  SHAPES,
  SIZES,
  type Color,
  type FramePattern,
  type FrameShade,
  type MatrixCell,
  type Shape,
  type Size,
} from '../../tasks/matrices/grammar'

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

/** Frame band: centre line inset from the cell edge, band width, and the inner objects' scale. */
export const FRAME_INSET = 6.5
export const FRAME_WIDTH = 4
/**
 * Inner scale of a framed cell: a large object in a corner slot reaches 50 − 46.83·s from the edge
 * (slot centre 33.33 from the cell centre plus radius 13.5), which at 0.84 is 10.7, clear of the
 * band's inner edge at 8.5. The band's outer edge (4.5) stays 2.5 inside the cell border, so a
 * solid band never merges with the border into a double line.
 */
export const FRAME_INNER_SCALE = 0.84

/** Frame band shades (light → dark): ≥ 3:1 against the paper, steps ≈ 2.6:1 (luminance spread evenly). */
export const FRAME_GREYS: Readonly<Record<FrameShade, string>> = Object.freeze({
  light_grey: '#949494',
  dark_grey: '#515151',
  black: '#000000',
})

/** Normalized length of the frame's outline, so a pattern repeats a whole number of times per side. */
export const FRAME_PATH_LENGTH = 360

/** Dash pattern of each frame pattern, in {@link FRAME_PATH_LENGTH} units (90 per side). */
export const FRAME_DASHES: Readonly<Record<FramePattern, { readonly dasharray: string | null; readonly dashoffset: number; readonly linecap: 'butt' | 'round' }>> =
  Object.freeze({
    solid: { dasharray: null, dashoffset: 0, linecap: 'butt' },
    dashed: { dasharray: '10 5', dashoffset: 5, linecap: 'butt' },
    dotted: { dasharray: '0 7.5', dashoffset: 0, linecap: 'round' },
  })

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

/** The objects of a cell, one per occupied slot, in slot order (scaled about the centre in a framed cell). */
export function cellObjects(cell: MatrixCell): CellObject[] {
  if (!SHAPES.includes(cell.shape)) throw new RangeError(`unknown shape ${String(cell.shape)}`)
  if (!SIZES.includes(cell.size)) throw new RangeError(`unknown size ${String(cell.size)}`)
  if (!COLORS.includes(cell.color)) throw new RangeError(`unknown color ${String(cell.color)}`)
  if (!ORIENTATIONS.includes(cell.orientation)) throw new RangeError(`unknown orientation ${String(cell.orientation)}`)
  const k = cell.frame === undefined ? 1 : FRAME_INNER_SCALE
  const r = SIZE_RADIUS[cell.size] * k
  const [up, down] = STRIPE_REACH[cell.shape]
  return cell.positions.map((slot) => {
    const [sx, sy] = slotCentre(slot)
    const [cx, cy] = k === 1 ? [sx, sy] : [CELL / 2 + k * (sx - CELL / 2), CELL / 2 + k * (sy - CELL / 2)]
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

/** A cell's frame band, ready for SVG (a `rect` stroked with the band). */
export interface CellFrame {
  readonly x: number
  readonly y: number
  readonly size: number
  readonly stroke: string
  readonly strokeWidth: number
  readonly pathLength: number
  readonly dasharray: string | null
  readonly dashoffset: number
  readonly linecap: 'butt' | 'round'
}

/** The frame of a cell, or null for a cell without one. */
export function cellFrame(cell: MatrixCell): CellFrame | null {
  const f = cell.frame
  if (f === undefined) return null
  if (!FRAME_SHADES.includes(f.shade)) throw new RangeError(`unknown frame shade ${String(f.shade)}`)
  if (!FRAME_PATTERNS.includes(f.pattern)) throw new RangeError(`unknown frame pattern ${String(f.pattern)}`)
  return {
    x: FRAME_INSET,
    y: FRAME_INSET,
    size: CELL - 2 * FRAME_INSET,
    stroke: FRAME_GREYS[f.shade],
    strokeWidth: FRAME_WIDTH,
    pathLength: FRAME_PATH_LENGTH,
    ...FRAME_DASHES[f.pattern],
  }
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

const FRAME_SHADE_NAMES: Readonly<Record<FrameShade, string>> = Object.freeze({ light_grey: 'light grey', dark_grey: 'dark grey', black: 'black' })

/**
 * Structural text alternative of a cell: count, size, grey, shape, orientation and positions, e.g.
 * "2 large dark grey hexagons, turned 45°, at top left and centre", then the frame if there is
 * one ("…, inside a dashed black frame"). Every attribute the grammar varies is named, in a fixed
 * order, so two cells get the same text exactly when they look the same.
 */
export function describeCell(cell: MatrixCell): string {
  const n = cell.positions.length
  const shape = n === 1 ? cell.shape : SHAPE_PLURALS[cell.shape]
  const where = listOf(cell.positions.map((s) => SLOT_NAMES[s] ?? `slot ${s}`))
  const inner = `${n} ${cell.size} ${COLOR_NAMES[cell.color]} ${shape}, turned ${cell.orientation}°, at ${where}`
  const f = cell.frame
  return f === undefined ? inner : `${inner}, inside a ${f.pattern} ${FRAME_SHADE_NAMES[f.shade]} frame`
}

/** Label of the grid cell in row r, column c (1-based). */
export function gridCellLabel(row: number, col: number, cell: MatrixCell): string {
  return `Row ${row}, column ${col}: ${describeCell(cell)}`
}
