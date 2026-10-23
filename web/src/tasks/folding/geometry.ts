/**
 * Exact integer geometry of the paper-folding family (DESIGN §3 row 7; `spec.ts`), shared by the
 * generator, the verifier and the renderer. It has no verifier logic and no randomness.
 *
 * Coordinates are DOUBLED sheet units: the N × N sheet spans [0, 2N] × [0, 2N] with y pointing down,
 * and the centre of slot (row r, column c) (1-based) is the odd point (2c − 1, 2r − 1). Every fold
 * line is one of
 *
 *     v: x = c,   h: y = c,   d: x − y = c,   a: x + y = c        (c an even integer)
 *
 * and its reflection is an integer map (v: x → 2c − x; h: y → 2c − y; d: (x, y) → (y + c, x − c);
 * a: (x, y) → (c − y, c − x)) that takes slot centres to slot centres (an even c keeps odd
 * coordinates odd; for v and h it also keeps the line off every slot centre, which is the
 * "even sizes only" rule: a 4-wide strip folds to 2 and then 1, a 3-wide one does not fold).
 *
 * A folded shape is a convex polygon with integer vertices: the sheet, a rectangle, a corner
 * triangle (after a diagonal fold of a square) or a centre triangle (after folding a corner
 * triangle along its diagonal). A fold of orientation k is legal when the shape is mirror
 * symmetric about the line of that orientation through its middle and both halves have integer
 * vertices; so a diagonal fold needs a square or a corner triangle, and each fold halves the shape
 * exactly. The moving half is reflected onto the staying half, so after f folds every point strictly
 * inside the folded shape lies over exactly 2^f layers (every punch makes 2^f holes).
 */

import type { FoldStep, LineKind, Side, Slot } from './spec'

/** A point in doubled sheet units (integers). */
export type Pt = readonly [number, number]

/** A convex polygon, vertices in order. */
export type Shape = readonly Pt[]

export interface Line {
  readonly kind: LineKind
  readonly c: number
}

/** Unit direction (in doubled units) pointing into each side; the line kind is the one it crosses. */
export const SIDE_DIR: Readonly<Record<Side, Pt>> = Object.freeze({
  left: [-1, 0],
  right: [1, 0],
  top: [0, -1],
  bottom: [0, 1],
  top_left: [-1, -1],
  top_right: [1, -1],
  bottom_left: [-1, 1],
  bottom_right: [1, 1],
})

/** The two sides of each line kind, [negative side, positive side] of {@link lineValue}. */
export const LINE_SIDES: Readonly<Record<LineKind, readonly [Side, Side]>> = Object.freeze({
  v: ['left', 'right'],
  h: ['top', 'bottom'],
  d: ['bottom_left', 'top_right'],
  a: ['top_left', 'bottom_right'],
})

/** The line kind a moving side is folded across. */
export function lineKindOf(side: Side): LineKind {
  for (const k of ['v', 'h', 'd', 'a'] as const) if (LINE_SIDES[k].includes(side)) return k
  throw new RangeError(`unknown side ${String(side)}`)
}

/** −1 if `side` is the negative side of its line, +1 if the positive one. */
export function sideSign(side: Side): -1 | 1 {
  return LINE_SIDES[lineKindOf(side)][0] === side ? -1 : 1
}

/** The coordinate a line of this kind constrains: x, y, x − y or x + y. */
export function lineCoord(p: Pt, kind: LineKind): number {
  const [x, y] = p
  switch (kind) {
    case 'v':
      return x
    case 'h':
      return y
    case 'd':
      return x - y
    case 'a':
      return x + y
  }
}

/** Signed position of p relative to the line (0 on it; the sign names the side, {@link LINE_SIDES}). */
export function lineValue(p: Pt, line: Line): number {
  return lineCoord(p, line.kind) - line.c
}

/** The mirror image of p across the line (an integer map). */
export function reflect(p: Pt, line: Line): Pt {
  const [x, y] = p
  const c = line.c
  switch (line.kind) {
    case 'v':
      return [2 * c - x, y]
    case 'h':
      return [x, 2 * c - y]
    case 'd':
      return [y + c, x - c]
    case 'a':
      return [c - y, c - x]
  }
}

export const slotPt = (s: Slot): Pt => [2 * s.col - 1, 2 * s.row - 1]
export const ptSlot = (p: Pt): Slot => ({ row: (p[1] + 1) / 2, col: (p[0] + 1) / 2 })

export function sheetShape(n: number): Shape {
  return [
    [0, 0],
    [2 * n, 0],
    [2 * n, 2 * n],
    [0, 2 * n],
  ]
}

const ptKey = (p: Pt): string => `${p[0]},${p[1]}`

/** The part of the convex polygon where sign · lineValue ≥ 0, or null if a cut point is not an integer point. */
export function clipShape(shape: Shape, line: Line, keepSign: -1 | 1): Shape | null {
  const out: Pt[] = []
  const m = shape.length
  for (let i = 0; i < m; i++) {
    const p = shape[i] as Pt
    const q = shape[(i + 1) % m] as Pt
    const sp = keepSign * lineValue(p, line)
    const sq = keepSign * lineValue(q, line)
    if (sp >= 0) out.push(p)
    if ((sp > 0 && sq < 0) || (sp < 0 && sq > 0)) {
      // p + (q − p) · sp / (sp − sq), exact when it is an integer point.
      const den = sp - sq
      const nx = p[0] * den + (q[0] - p[0]) * sp
      const ny = p[1] * den + (q[1] - p[1]) * sp
      if (nx % den !== 0 || ny % den !== 0) return null
      out.push([nx / den, ny / den])
    }
  }
  return out.length >= 3 ? out : null
}

/**
 * The symmetry line of `shape` of this orientation through its middle, if folding along it is legal
 * (see the module comment): its constant c is an even integer strictly inside the shape's range, the
 * vertex set is mirror symmetric about it, and both halves have integer vertices. Otherwise null.
 */
export function symmetryLine(shape: Shape, kind: LineKind): Line | null {
  const vals = shape.map((p) => lineCoord(p, kind))
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  if ((lo + hi) % 4 !== 0) return null
  const line: Line = { kind, c: (lo + hi) / 2 }
  if (!(lo < line.c && line.c < hi)) return null
  const own = new Set(shape.map(ptKey))
  if (!shape.every((p) => own.has(ptKey(reflect(p, line))))) return null
  if (clipShape(shape, line, 1) === null || clipShape(shape, line, -1) === null) return null
  return line
}

/** The legal folds of a shape: every side of every orientation with a {@link symmetryLine}. */
export function legalFolds(shape: Shape): Side[] {
  const out: Side[] = []
  for (const k of ['v', 'h', 'd', 'a'] as const) if (symmetryLine(shape, k) !== null) out.push(...LINE_SIDES[k])
  return out
}

/** Twice the signed area (positive for clockwise order on screen, y down). */
export function doubleArea(shape: Shape): number {
  let s = 0
  for (let i = 0; i < shape.length; i++) {
    const p = shape[i] as Pt
    const q = shape[(i + 1) % shape.length] as Pt
    s += p[0] * q[1] - q[0] * p[1]
  }
  return s
}

/** p lies strictly inside the convex polygon (not on an edge). */
export function strictlyInside(p: Pt, shape: Shape): boolean {
  const o = Math.sign(doubleArea(shape))
  if (o === 0) return false
  for (let i = 0; i < shape.length; i++) {
    const a = shape[i] as Pt
    const b = shape[(i + 1) % shape.length] as Pt
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
    if (cross * o <= 0) return false
  }
  return true
}

/** The slots of an n × n sheet strictly inside `shape`, by row then column. */
export function interiorSlots(shape: Shape, n: number): Slot[] {
  const out: Slot[] = []
  for (let row = 1; row <= n; row++) for (let col = 1; col <= n; col++) if (strictlyInside(slotPt({ row, col }), shape)) out.push({ row, col })
  return out
}

/** The folded shapes (before fold 1 … after the last) and the fold lines of a fold sequence. */
export interface FoldPlan {
  readonly grid: number
  /** shapes[k] is the paper before fold k + 1; shapes[folds.length] is the fully folded paper. */
  readonly shapes: readonly Shape[]
  readonly lines: readonly Line[]
  /** The moving side's sign per fold ({@link sideSign}). */
  readonly movingSigns: readonly (-1 | 1)[]
}

/** Build the plan of a fold sequence on an n × n sheet, or return why it is not legal. */
export function foldPlan(n: number, folds: readonly FoldStep[]): FoldPlan | { readonly problems: readonly string[] } {
  const shapes: Shape[] = [sheetShape(n)]
  const lines: Line[] = []
  const movingSigns: (-1 | 1)[] = []
  for (let k = 0; k < folds.length; k++) {
    const f = folds[k] as FoldStep
    const kind = lineKindOf(f.moving)
    if (f.line !== kind) return { problems: [`fold ${k + 1}: side ${f.moving} is not a side of line ${f.line}`] }
    const shape = shapes[k] as Shape
    const line = symmetryLine(shape, kind)
    if (line === null) return { problems: [`fold ${k + 1}: the paper has no ${kind} fold line`] }
    const sign = sideSign(f.moving)
    const next = clipShape(shape, line, sign === -1 ? 1 : -1)
    if (next === null) return { problems: [`fold ${k + 1}: the folded half has non-integer corners`] }
    shapes.push(next)
    lines.push(line)
    movingSigns.push(sign)
  }
  return { grid: n, shapes, lines, movingSigns }
}

export function isPlan(p: FoldPlan | { readonly problems: readonly string[] }): p is FoldPlan {
  return 'shapes' in p
}

/** Where the paper at p (a point of the flat sheet) lies once every fold of the plan is made. */
export function foldedImage(p: Pt, plan: FoldPlan): Pt {
  let q = p
  plan.lines.forEach((line, k) => {
    if (lineValue(q, line) * (plan.movingSigns[k] as number) > 0) q = reflect(q, line)
  })
  return q
}

// --- slot sets -----------------------------------------------------------------------------------

export const slotCode = (s: Slot): number => s.row * 64 + s.col
export const codeSlot = (c: number): Slot => ({ row: Math.floor(c / 64), col: c % 64 })

/** Sorted, de-duplicated slots (by row, then column). */
export function sortSlots(slots: Iterable<Slot>): Slot[] {
  return [...new Set([...slots].map(slotCode))].sort((x, y) => x - y).map(codeSlot)
}

/** A canonical string of a slot set (for equality and hashing). */
export function slotsKey(slots: Iterable<Slot>): string {
  return sortSlots(slots)
    .map((s) => `${s.row}.${s.col}`)
    .join(' ')
}

// --- the eight symmetries of the square sheet ----------------------------------------------------

export interface SheetSymmetry {
  readonly name: string
  /** The point map on an n × n sheet. */
  pt(p: Pt, n: number): Pt
  /** Its linear part on direction vectors. */
  dir(d: Pt): Pt
}

export const SHEET_SYMMETRIES: readonly SheetSymmetry[] = Object.freeze([
  { name: 'identity', pt: (p: Pt) => p, dir: (d: Pt) => d },
  { name: 'turn_90', pt: (p: Pt, n: number): Pt => [2 * n - p[1], p[0]], dir: (d: Pt): Pt => [-d[1], d[0]] },
  { name: 'turn_180', pt: (p: Pt, n: number): Pt => [2 * n - p[0], 2 * n - p[1]], dir: (d: Pt): Pt => [-d[0], -d[1]] },
  { name: 'turn_270', pt: (p: Pt, n: number): Pt => [p[1], 2 * n - p[0]], dir: (d: Pt): Pt => [d[1], -d[0]] },
  { name: 'left_right', pt: (p: Pt, n: number): Pt => [2 * n - p[0], p[1]], dir: (d: Pt): Pt => [-d[0], d[1]] },
  { name: 'top_bottom', pt: (p: Pt, n: number): Pt => [p[0], 2 * n - p[1]], dir: (d: Pt): Pt => [d[0], -d[1]] },
  { name: 'diagonal_down', pt: (p: Pt): Pt => [p[1], p[0]], dir: (d: Pt): Pt => [d[1], d[0]] },
  { name: 'diagonal_up', pt: (p: Pt, n: number): Pt => [2 * n - p[1], 2 * n - p[0]], dir: (d: Pt): Pt => [-d[1], -d[0]] },
])

/** The four mirror symmetries of the sheet (the `mirrored` lures and the symmetry cue). */
export const SHEET_MIRRORS: readonly SheetSymmetry[] = Object.freeze(SHEET_SYMMETRIES.slice(4))

const DIR_SIDE = new Map<number, Side>((Object.entries(SIDE_DIR) as [Side, Pt][]).map(([side, v]) => [(v[0] + 1) * 3 + (v[1] + 1), side]))

export function sideOfDir(d: Pt): Side {
  const side = Math.abs(d[0]) <= 1 && Math.abs(d[1]) <= 1 ? DIR_SIDE.get((d[0] + 1) * 3 + (d[1] + 1)) : undefined
  if (side === undefined) throw new RangeError(`no side has direction ${d.join(',')}`)
  return side
}

/** The image of a slot set under a sheet symmetry. */
export function mapSlots(slots: readonly Slot[], sym: SheetSymmetry, n: number): Slot[] {
  return sortSlots(slots.map((s) => ptSlot(sym.pt(slotPt(s), n))))
}

/**
 * The A11 structure: the fold sides and the punched slots, canonicalised TOGETHER under the eight
 * sheet symmetries (the symmetric image of the whole configuration whose text `sides|r.c r.c` is
 * smallest in code-unit order; the bank's twin uses the same text and order), plus the sorted
 * reasons of the four distractors (`reasons.ts` `lureSignature`, invariant under the symmetries):
 * two items are isomorphs when one is the other turned or mirrored, with the same kinds of lures.
 */
export function foldingStructure(
  n: number,
  folds: readonly Side[],
  punches: readonly Slot[],
  lures: readonly string[],
): { grid: number; folds: Side[]; punches: [number, number][]; lures: string[] } {
  let best: { text: string; folds: Side[]; punches: Slot[] } | null = null
  for (const sym of SHEET_SYMMETRIES) {
    const fs = folds.map((s) => sideOfDir(sym.dir(SIDE_DIR[s])))
    const ps = mapSlots(punches, sym, n)
    const text = `${fs.join(',')}|${ps.map((s) => `${s.row}.${s.col}`).join(' ')}`
    if (best === null || text < best.text) best = { text, folds: fs, punches: ps }
  }
  const b = best as { folds: Side[]; punches: Slot[] }
  return { grid: n, folds: b.folds, punches: b.punches.map((s) => [s.row, s.col]), lures: [...lures].sort() }
}

/** The fold line's segment across the shape (its two boundary points), for drawing. */
export function lineSegmentIn(shape: Shape, line: Line): [Pt, Pt] | null {
  const pts: Pt[] = []
  const m = shape.length
  for (let i = 0; i < m; i++) {
    const p = shape[i] as Pt
    const q = shape[(i + 1) % m] as Pt
    const sp = lineValue(p, line)
    const sq = lineValue(q, line)
    if (sp === 0) pts.push(p)
    else if ((sp > 0 && sq < 0) || (sp < 0 && sq > 0)) {
      const t = sp / (sp - sq)
      pts.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t])
    }
  }
  return pts.length === 2 ? [pts[0] as Pt, pts[1] as Pt] : null
}

/** The sheet symmetries that map the slot set onto itself (always includes the identity). */
export function stabilizer(slots: readonly Slot[], n: number): SheetSymmetry[] {
  const own = slotsKey(slots)
  return SHEET_SYMMETRIES.filter((g) => slotsKey(mapSlots(slots, g, n)) === own)
}

/** The orbit of a slot under a group of sheet symmetries, sorted. */
export function orbit(slot: Slot, group: readonly SheetSymmetry[], n: number): Slot[] {
  return sortSlots(group.map((g) => ptSlot(g.pt(slotPt(slot), n))))
}
