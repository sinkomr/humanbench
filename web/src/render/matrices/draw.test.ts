/**
 * Matrix cell drawing and text alternatives (ROADMAP M1.13; DESIGN §4.2 "Matrices", §13 WCAG 2.2
 * AA): object geometry, the orientation stripe of the grammar's render contract, the grey
 * palette's non-text contrast (1.4.11, ≥ 3:1), and structural descriptions.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { COLORS, FRAME_PATTERNS, FRAME_SHADES, ORIENTATIONS, SHAPES, SIZES, type FramePattern, type FrameShade, type MatrixCell } from '../../tasks/matrices/grammar'
import { matrices } from '../../tasks/matrices'
import { contrast, luminance } from '../color'
import {
  CELL,
  CELL_BORDER,
  FRAME_DASHES,
  FRAME_GREYS,
  FRAME_INNER_SCALE,
  FRAME_INSET,
  FRAME_PATH_LENGTH,
  FRAME_WIDTH,
  GREYS,
  OUTLINE,
  OUTLINE_WIDTH,
  PAPER,
  SIZE_RADIUS,
  SLOT,
  SLOT_NAMES,
  STRIPE_REACH,
  cellFrame,
  cellObjects,
  describeCell,
  gridCellLabel,
  objectVertices,
  slotCentre,
  stripeColor,
  type Point,
} from './draw'

/** Dark page background of app.css (the stimulus panel sits on it in the dark theme). */
const DARK_PAGE = '#15151a'

const positionsArb = fc.uniqueArray(fc.integer({ min: 0, max: 8 }), { minLength: 1, maxLength: 4 }).map((p) => [...p].sort((a, b) => a - b))
const cellArb: fc.Arbitrary<MatrixCell> = fc.record({
  shape: fc.constantFrom(...SHAPES),
  size: fc.constantFrom(...SIZES),
  color: fc.constantFrom(...COLORS),
  orientation: fc.constantFrom(...ORIENTATIONS),
  positions: positionsArb,
})

/** Distance from p to the segment ab. */
function segmentDistance(p: Point, a: Point, b: Point): number {
  const [px, py] = p
  const [ax, ay] = a
  const [bx, by] = b
  const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)))
  return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)))
}

/** Distance from p to the boundary of a closed polygon. */
function boundaryDistance(p: Point, poly: readonly Point[]): number {
  return Math.min(...poly.map((a, i) => segmentDistance(p, a, poly[(i + 1) % poly.length] as Point)))
}

/** Undirected line direction in degrees, in [0, 180). */
const lineAngle = (x1: number, y1: number, x2: number, y2: number): number => {
  const a = (Math.atan2(x2 - x1, -(y2 - y1)) * 180) / Math.PI // clockwise from up
  return (((a % 180) + 180) % 180) % 180
}

describe('matrix cells: geometry', () => {
  it('puts slots on a 3 × 3 sub-grid, row-major, and rejects other slots', () => {
    expect(slotCentre(0)).toEqual([SLOT / 2, SLOT / 2])
    expect(slotCentre(4)).toEqual([CELL / 2, CELL / 2])
    for (const v of slotCentre(8)) expect(v).toBeCloseTo(CELL - SLOT / 2, 9)
    expect(slotCentre(5)[0]).toBeGreaterThan(slotCentre(3)[0])
    expect(slotCentre(7)[1]).toBeGreaterThan(slotCentre(1)[1])
    for (const bad of [-1, 9, 1.5]) expect(() => slotCentre(bad)).toThrow(RangeError)
  })

  it('draws one object per occupied slot, in slot order, inside the cell and apart from its neighbours', () => {
    fc.assert(
      fc.property(cellArb, (cell) => {
        const objs = cellObjects(cell)
        expect(objs).toHaveLength(cell.positions.length)
        objs.forEach((o, k) => {
          const [cx, cy] = slotCentre(cell.positions[k] as number)
          expect(o.cx).toBeCloseTo(cx, 1)
          expect(o.cy).toBeCloseTo(cy, 1)
          // The outline stays inside the cell border (2 units) with room to spare.
          const reach = o.r + OUTLINE_WIDTH / 2
          for (const c of [o.cx - reach, o.cy - reach]) expect(c).toBeGreaterThan(2)
          for (const c of [o.cx + reach, o.cy + reach]) expect(c).toBeLessThan(CELL - 2)
        })
      }),
    )
    // Neighbouring slots never touch, even at the largest size.
    expect(SLOT - 2 * (SIZE_RADIUS.large + OUTLINE_WIDTH / 2)).toBeGreaterThan(2)
  })

  it('makes each size ≥ 1.3× the next smaller one, so sizes are easy to tell apart', () => {
    expect(SIZE_RADIUS.medium / SIZE_RADIUS.small).toBeGreaterThanOrEqual(1.3)
    expect(SIZE_RADIUS.large / SIZE_RADIUS.medium).toBeGreaterThanOrEqual(1.3)
  })

  it('draws regular polygons (vertex up; the square flat-topped) and circles', () => {
    const sides: Record<string, number> = { triangle: 3, square: 4, pentagon: 5, hexagon: 6 }
    for (const shape of SHAPES) {
      const v = objectVertices(shape, 50, 50, 10, 0)
      if (shape === 'circle') {
        expect(v).toBeNull()
        continue
      }
      expect(v).toHaveLength(sides[shape] as number)
      for (const [x, y] of v as Point[]) expect(Math.hypot(x - 50, y - 50)).toBeCloseTo(10, 9)
      const top = Math.min(...(v as Point[]).map((p) => p[1]))
      expect(top).toBeCloseTo(shape === 'square' ? 50 - 10 * Math.SQRT1_2 : 40, 9)
    }
  })

  it('draws the orientation stripe as a chord through the centre whose ends lie on the outline', () => {
    for (const shape of SHAPES) {
      for (const orientation of ORIENTATIONS) {
        const [o] = cellObjects({ shape, size: 'large', color: 'white', orientation, positions: [4] })
        if (!o) throw new Error('no object')
        const { x1, y1, x2, y2 } = o.stripe
        const ends: Point[] = [
          [x1, y1],
          [x2, y2],
        ]
        const verts = objectVertices(shape, o.cx, o.cy, o.r, orientation)
        for (const e of ends) {
          const d = verts === null ? Math.abs(Math.hypot(e[0] - o.cx, e[1] - o.cy) - o.r) : boundaryDistance(e, verts)
          expect(d, `${shape} ${orientation}°`).toBeLessThan(0.02)
        }
        // The chord passes through the centre.
        expect(segmentDistance([o.cx, o.cy], [x1, y1], [x2, y2])).toBeLessThan(0.02)
        // …and points along the orientation (vertical at 0°, clockwise after that).
        expect(lineAngle(x1, y1, x2, y2)).toBeCloseTo(orientation, 0)
        const [up, down] = STRIPE_REACH[shape]
        expect(Math.hypot(x1 - x2, y1 - y2)).toBeCloseTo(o.r * (up + down), 1)
      }
    }
  })

  it('shows all four orientations of every shape as different drawings (the grammar render contract)', () => {
    for (const shape of SHAPES) {
      const drawings = ORIENTATIONS.map((orientation) => JSON.stringify(cellObjects({ shape, size: 'medium', color: 'light_grey', orientation, positions: [4] })))
      expect(new Set(drawings).size).toBe(ORIENTATIONS.length)
      const stripes = ORIENTATIONS.map((orientation) => {
        const [o] = cellObjects({ shape, size: 'medium', color: 'light_grey', orientation, positions: [4] })
        return Math.round(lineAngle(o?.stripe.x1 ?? 0, o?.stripe.y1 ?? 0, o?.stripe.x2 ?? 0, o?.stripe.y2 ?? 0))
      })
      expect(new Set(stripes).size).toBe(ORIENTATIONS.length)
    }
  })

  it('rejects values outside the grammar', () => {
    const ok: MatrixCell = { shape: 'square', size: 'small', color: 'black', orientation: 0, positions: [0] }
    expect(() => cellObjects({ ...ok, shape: 'star' as never })).toThrow(RangeError)
    expect(() => cellObjects({ ...ok, size: 'huge' as never })).toThrow(RangeError)
    expect(() => cellObjects({ ...ok, color: 'red' as never })).toThrow(RangeError)
    expect(() => cellObjects({ ...ok, orientation: 30 as never })).toThrow(RangeError)
    expect(() => cellObjects({ ...ok, positions: [9] })).toThrow(RangeError)
  })
})

describe('matrix cells: grey palette contrast (WCAG 1.4.11, ≥ 3:1)', () => {
  it('has four greys from white to black, getting darker in grammar order', () => {
    const lum = COLORS.map((c) => luminance(GREYS[c]))
    expect(lum[0]).toBeCloseTo(1, 12)
    expect(lum[3]).toBeCloseTo(0, 12)
    for (let i = 1; i < lum.length; i++) expect(lum[i] as number).toBeLessThan(lum[i - 1] as number)
  })

  it('outlines every object at ≥ 3:1 against the paper, and the cell border at ≥ 3:1 against the paper and both page themes', () => {
    expect(contrast(OUTLINE, PAPER)).toBeGreaterThanOrEqual(3)
    expect(contrast(CELL_BORDER, PAPER)).toBeGreaterThanOrEqual(3)
    expect(contrast(CELL_BORDER, DARK_PAGE)).toBeGreaterThanOrEqual(3)
  })

  it('keeps every fill but black ≥ 3:1 against the outline (black merges into it: its silhouette is ≥ 3:1 against the paper)', () => {
    for (const c of COLORS) {
      if (c === 'black') expect(contrast(GREYS[c], PAPER)).toBeGreaterThanOrEqual(3)
      else expect(contrast(GREYS[c], OUTLINE), c).toBeGreaterThanOrEqual(3)
    }
  })

  it('draws the orientation stripe at ≥ 3:1 against every fill', () => {
    for (const c of COLORS) expect(contrast(stripeColor(c), GREYS[c]), c).toBeGreaterThanOrEqual(3)
  })

  it('spreads neighbouring greys as far apart as four levels allow (each step ≥ 2.6:1; 3:1 steps would need 27:1)', () => {
    const steps = COLORS.slice(1).map((c, i) => contrast(GREYS[COLORS[i] as (typeof COLORS)[number]], GREYS[c]))
    for (const s of steps) expect(s).toBeGreaterThanOrEqual(2.6)
    // Three ≥ 3:1 steps multiply to ≥ 27, more than white/black's 21: the bound is tight.
    expect(steps.reduce((a, b) => a * b, 1)).toBeCloseTo(contrast(GREYS.white, GREYS.black), 6)
    expect(3 ** 3).toBeGreaterThan(contrast('#ffffff', '#000000'))
  })
})

describe('matrix cells: text alternatives', () => {
  it('names count, size, grey, shape, orientation and positions', () => {
    expect(describeCell({ shape: 'hexagon', size: 'large', color: 'dark_grey', orientation: 45, positions: [0, 4] })).toBe(
      '2 large dark grey hexagons, turned 45°, at top left and centre',
    )
    expect(describeCell({ shape: 'triangle', size: 'small', color: 'white', orientation: 0, positions: [4] })).toBe('1 small white triangle, turned 0°, at centre')
    expect(describeCell({ shape: 'circle', size: 'medium', color: 'light_grey', orientation: 135, positions: [0, 2, 6, 8] })).toBe(
      '4 medium light grey circles, turned 135°, at top left, top right, bottom left and bottom right',
    )
    expect(gridCellLabel(2, 3, { shape: 'square', size: 'small', color: 'black', orientation: 90, positions: [3, 5] })).toBe(
      'Row 2, column 3: 2 small black squares, turned 90°, at middle left and middle right',
    )
    expect(new Set(SLOT_NAMES).size).toBe(9)
  })

  it('gives two cells the same description exactly when they are drawn the same', () => {
    fc.assert(
      fc.property(cellArb, cellArb, (a, b) => {
        const sameText = describeCell(a) === describeCell(b)
        const sameDrawing = JSON.stringify(cellObjects(a)) === JSON.stringify(cellObjects(b))
        expect(sameText).toBe(sameDrawing)
      }),
      { numRuns: 2000 },
    )
  })

  it('describes every generated item cell without error, and the six options of an item differently', () => {
    for (let i = 0; i < 100; i++) {
      const { spec } = matrices.generate(`draw-desc-${i}`)
      for (const cell of [...spec.grid.flat(), ...spec.options]) expect(describeCell(cell)).toMatch(/^\d .+, turned \d+°, at .+$/)
      expect(new Set(spec.options.map(describeCell)).size).toBe(spec.options.length)
    }
  })
})

describe('matrix cells: the frame of a hard item (M3.12)', () => {
  const framed = (cell: MatrixCell, shade: FrameShade = 'light_grey', pattern: FramePattern = 'solid'): MatrixCell => ({ ...cell, frame: { shade, pattern } })

  it('draws no frame and the objects unchanged without one', () => {
    fc.assert(
      fc.property(cellArb, (cell) => {
        expect(cellFrame(cell)).toBeNull()
        expect(cellObjects(cell)[0]?.r).toBe(SIZE_RADIUS[cell.size])
      }),
    )
  })

  it('draws a square band inside the cell edge and scales the objects so they clear it', () => {
    const band = { outer: FRAME_INSET - FRAME_WIDTH / 2, inner: FRAME_INSET + FRAME_WIDTH / 2 }
    expect(band.outer).toBeGreaterThanOrEqual(2 + 2.5) // clear of the cell border (stroke 0–2): no double line
    fc.assert(
      fc.property(cellArb, fc.constantFrom(...FRAME_SHADES), fc.constantFrom(...FRAME_PATTERNS), (cell, shade, pattern) => {
        const c = framed(cell, shade, pattern)
        const f = cellFrame(c)
        expect(f).toMatchObject({ x: FRAME_INSET, y: FRAME_INSET, size: CELL - 2 * FRAME_INSET, stroke: FRAME_GREYS[shade], strokeWidth: FRAME_WIDTH })
        for (const o of cellObjects(c)) {
          expect(o.r).toBeCloseTo(SIZE_RADIUS[cell.size] * FRAME_INNER_SCALE, 1)
          // Every point of the object (within its circumradius) is ≥ 2 units inside the band.
          for (const v of [o.cx - o.r, o.cy - o.r]) expect(v).toBeGreaterThanOrEqual(band.inner + 2)
          for (const v of [o.cx + o.r, o.cy + o.r]) expect(v).toBeLessThanOrEqual(CELL - band.inner - 2)
        }
      }),
    )
  })

  it('makes the patterns repeat a whole number of times per side, with a mark on every corner', () => {
    const side = FRAME_PATH_LENGTH / 4
    for (const p of FRAME_PATTERNS) {
      const d = FRAME_DASHES[p]
      if (d.dasharray === null) continue
      const period = d.dasharray.split(' ').map(Number).reduce((a, b) => a + b, 0)
      expect(Number.isInteger(side / period), p).toBe(true)
    }
    expect(FRAME_DASHES.dotted.linecap).toBe('round')
    expect(FRAME_DASHES.dashed.dashoffset).toBe(5) // a dash centred on each corner
  })

  it('draws every frame shade ≥ 3:1 against the paper, light to dark, neighbours ≥ 2.5:1 apart', () => {
    const shades = FRAME_SHADES.map((s) => FRAME_GREYS[s])
    for (const g of shades) expect(contrast(g, PAPER)).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < shades.length; i++) {
      expect(luminance(shades[i] as string)).toBeLessThan(luminance(shades[i - 1] as string))
      expect(contrast(shades[i] as string, shades[i - 1] as string)).toBeGreaterThanOrEqual(2.5)
    }
  })

  it('names the frame in the text alternative, so framed cells differ in text exactly when they differ in looks', () => {
    const base: MatrixCell = { shape: 'hexagon', size: 'large', color: 'dark_grey', orientation: 45, positions: [0, 4] }
    expect(describeCell(framed(base, 'black', 'dashed'))).toBe('2 large dark grey hexagons, turned 45°, at top left and centre, inside a dashed black frame')
    expect(describeCell(framed(base, 'light_grey', 'dotted'))).toBe('2 large dark grey hexagons, turned 45°, at top left and centre, inside a dotted light grey frame')
    expect(describeCell(base)).toBe('2 large dark grey hexagons, turned 45°, at top left and centre')
  })

  it('rejects frame values outside the grammar', () => {
    const base: MatrixCell = { shape: 'square', size: 'small', color: 'white', orientation: 0, positions: [4] }
    expect(() => cellFrame({ ...base, frame: { shade: 'white' as never, pattern: 'solid' } })).toThrow(RangeError)
    expect(() => cellFrame({ ...base, frame: { shade: 'black', pattern: 'wavy' as never } })).toThrow(RangeError)
  })

  it('describes every cell of generated hard items, and the six options of an item differently', () => {
    for (let i = 0; i < 60; i++) {
      const item = matrices.generate(`hard-draw-${i}`, { stratum: i % 2 === 0 ? 5 : 6 })
      const texts = item.spec.options.map(describeCell)
      expect(new Set(texts).size).toBe(6)
      for (const c of [...item.spec.grid.flat(), ...item.spec.options]) expect(() => cellObjects(c)).not.toThrow()
    }
  })
})
