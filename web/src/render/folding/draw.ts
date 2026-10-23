/**
 * Drawing data of the paper-folding renderer (`FoldingRenderer.svelte`; DESIGN §3 row 7, §13): pure
 * functions of the spec, in the family's doubled sheet units (`tasks/folding/geometry.ts`: the n × n
 * sheet spans 0 … 2n, slot (row r, column c) has its centre at (2c − 1, 2r − 1)). Every intermediate
 * folded shape is derived here from the spec through the shared geometry; nothing reads a key.
 */

import { clipShape, foldPlan, isPlan, lineSegmentIn, reflect, slotPt, type FoldPlan, type Line, type Pt, type Shape } from '../../tasks/folding/geometry'
import type { FoldingSpec, Slot } from '../../tasks/folding/spec'

/** Margin around the sheet in every panel (doubled units). */
export const PAD = 1.2
/** Radius of a punched hole, and of a faint slot mark on an option sheet (doubled units). */
export const HOLE_R = 0.55
export const SLOT_R = 0.13

export const viewBoxOf = (n: number): string => `${-PAD} ${-PAD} ${2 * n + 2 * PAD} ${2 * n + 2 * PAD}`

export const pointsOf = (shape: Shape): string => shape.map(([x, y]) => `${x},${y}`).join(' ')

/** The fold plan of a spec, or null if the spec cannot be folded (the renderer then draws nothing). */
export function planOf(spec: FoldingSpec): FoldPlan | null {
  const p = foldPlan(spec.grid, spec.folds)
  return isPlan(p) ? p : null
}

/** Area-weighted centroid of a polygon. */
export function centroid(shape: Shape): Pt {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < shape.length; i++) {
    const [x0, y0] = shape[i] as Pt
    const [x1, y1] = shape[(i + 1) % shape.length] as Pt
    const w = x0 * y1 - x1 * y0
    a += w
    cx += (x0 + x1) * w
    cy += (y0 + y1) * w
  }
  return [cx / (3 * a), cy / (3 * a)]
}

/** Unit direction along a fold line. */
function along(line: Line): Pt {
  const r = Math.SQRT1_2
  switch (line.kind) {
    case 'v':
      return [0, 1]
    case 'h':
      return [1, 0]
    case 'd':
      return [r, r]
    case 'a':
      return [r, -r]
  }
}

export interface FoldPanel {
  /** The paper before this fold. */
  readonly shape: string
  /** The half that moves (hatched). */
  readonly moving: string
  /** The dashed fold line. */
  readonly line: { x1: number; y1: number; x2: number; y2: number }
  /** The curved arrow from the moving half to where it lands, and its head. */
  readonly arrow: string
  readonly head: string
}

const r2 = (x: number): number => Math.round(x * 100) / 100

/** The drawing of fold k (0-based) of a plan. */
export function foldPanel(plan: FoldPlan, k: number): FoldPanel {
  const shape = plan.shapes[k] as Shape
  const line = plan.lines[k] as Line
  const sign = plan.movingSigns[k] as -1 | 1
  const moving = clipShape(shape, line, sign) ?? shape
  const seg = lineSegmentIn(shape, line) ?? [
    [0, 0],
    [0, 0],
  ]
  const from = centroid(moving)
  const to = reflect(from, line)
  const dist = Math.hypot(to[0] - from[0], to[1] - from[1])
  const [ux, uy] = along(line)
  const mid: Pt = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
  // Bend the arrow sideways along the fold line, towards the paper's middle where there is room.
  const ctrl: Pt = [mid[0] - ux * 0.45 * dist, mid[1] - uy * 0.45 * dist]
  // Arrowhead: a triangle at `to`, pointing along the curve's end tangent (to − ctrl).
  const tx = to[0] - ctrl[0]
  const ty = to[1] - ctrl[1]
  const tl = Math.hypot(tx, ty) || 1
  const [dx, dy] = [tx / tl, ty / tl]
  const size = 0.9
  const base: Pt = [to[0] - dx * size, to[1] - dy * size]
  const left: Pt = [base[0] - dy * size * 0.6, base[1] + dx * size * 0.6]
  const right: Pt = [base[0] + dy * size * 0.6, base[1] - dx * size * 0.6]
  return {
    shape: pointsOf(shape),
    moving: pointsOf(moving),
    line: { x1: seg[0][0], y1: seg[0][1], x2: seg[1][0], y2: seg[1][1] },
    arrow: `M ${r2(from[0])} ${r2(from[1])} Q ${r2(ctrl[0])} ${r2(ctrl[1])} ${r2(base[0])} ${r2(base[1])}`,
    head: [to, left, right].map(([x, y]) => `${r2(x)},${r2(y)}`).join(' '),
  }
}

export const holeCentre = (s: Slot): Pt => slotPt(s)

/** Every slot of an n × n sheet, by row then column. */
export function allSlots(n: number): Slot[] {
  const out: Slot[] = []
  for (let row = 1; row <= n; row++) for (let col = 1; col <= n; col++) out.push({ row, col })
  return out
}
