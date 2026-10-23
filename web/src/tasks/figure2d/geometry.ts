/**
 * Square-grid geometry of the figure2d family (DESIGN §4.2; ROADMAP A11), integers only.
 *
 * A figure is a set of unit squares [row, column] (row 0 at the top). {@link normalise} translates it so its smallest
 * row and column are 0 and sorts it (row, then column); every other function returns normalised figures. The eight
 * symmetries of the square (the dihedral group D4) act on it:
 *
 * - {@link turn}: k quarter turns CLOCKWISE on screen, (r, c) → (c, −r) per turn;
 * - {@link reflect}: the mirror image in a line: `v` vertical (r, c) → (r, −c), `h` horizontal (−r, c), `d` the
 *   top-left–bottom-right diagonal (c, r), `a` the bottom-left–top-right diagonal (−c, −r).
 *
 * Canonical forms: {@link c4Canon} (the least of the 4 turns: "the same figure turned in the plane") and
 * {@link d4Canon} (the least of all 8 images: "the same figure, perhaps flipped over"), the least in the order of
 * {@link compareCells} (element by element, row then column). The bank twin (`hb.gen.figure2d`) uses the same order,
 * so `d4Canon` (hashed into the family_id) is the same in both repos.
 */

import type { Rng } from '../../engine'
import type { Cell, MirrorLine } from './spec'

const STEPS: readonly Cell[] = Object.freeze([
  [-1, 0],
  [0, -1],
  [0, 1],
  [1, 0],
] as const)

/** Order of normalised figures: element by element (row, then column), then by length. */
export function compareCells(a: readonly Cell[], b: readonly Cell[]): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = a[i] as Cell
    const y = b[i] as Cell
    if (x[0] !== y[0]) return x[0] - y[0]
    if (x[1] !== y[1]) return x[1] - y[1]
  }
  return a.length - b.length
}

/** Code of a normalised square: row · 64 + column (coordinates of a normalised figure stay below 64). */
const SHIFT = 64

/**
 * The eight linear maps of D4 on (row, column), in the order of {@link images}: the 4 clockwise turns of the figure,
 * then the 4 turns of its vertical-line mirror image.
 */
const MAPS: readonly (readonly [number, number, number, number])[] = Object.freeze([
  [1, 0, 0, 1],
  [0, 1, -1, 0],
  [-1, 0, 0, -1],
  [0, -1, 1, 0],
  [1, 0, 0, -1],
  [0, -1, -1, 0],
  [-1, 0, 0, 1],
  [0, 1, 1, 0],
])

/** Sorted codes of the normalised image of `cells` under MAPS[t]. */
function codesOf(cells: readonly Cell[], t: number): Int32Array {
  const m = MAPS[t] as readonly [number, number, number, number]
  const a = m[0]
  const b = m[1]
  const c = m[2]
  const d = m[3]
  const n = cells.length
  let mr = Infinity
  let mc = Infinity
  for (let i = 0; i < n; i++) {
    const cell = cells[i] as Cell
    const r = a * cell[0] + b * cell[1]
    const q = c * cell[0] + d * cell[1]
    if (r < mr) mr = r
    if (q < mc) mc = q
  }
  const codes = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    const cell = cells[i] as Cell
    codes[i] = (a * cell[0] + b * cell[1] - mr) * SHIFT + (c * cell[0] + d * cell[1] - mc)
  }
  return codes.sort()
}

const decode = (codes: Int32Array): Cell[] => {
  const out: Cell[] = new Array<Cell>(codes.length)
  for (let i = 0; i < codes.length; i++) {
    const x = codes[i] as number
    out[i] = [(x - (x % SHIFT)) / SHIFT, x % SHIFT]
  }
  return out
}
/** A string key of sorted codes: one UTF-16 unit per square, so string order is code order. */
const codesKey = (codes: Int32Array): string => String.fromCharCode.apply(null, codes as unknown as number[])

const popcount = (x: number): number => {
  let v = x - ((x >>> 1) & 0x55555555)
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

/**
 * A normalised figure with its derived data, computed once per distinct figure and memoised (the cache is a pure
 * function of the figure, so it never changes what any function returns; it is cleared when it grows large).
 */
interface Shape {
  readonly key: string
  readonly codes: Int32Array
  readonly n: number
  readonly h: number
  readonly w: number
  /** Row bit masks (bit c = column c). */
  readonly masks: Int32Array
  info?: { readonly c4: string; readonly d4: string; readonly asymmetric: boolean }
  images?: readonly Shape[]
  profile?: string
  rows?: string
  cols?: string
  moved?: readonly (readonly Cell[])[]
  movedCodes?: readonly Int32Array[]
}

const CACHE_LIMIT = 200_000
const CACHE = new Map<string, Shape>()
/** Shapes of arrays this module handed out (decoded from codes), so a lookup skips re-normalising. */
const OF_ARRAY = new WeakMap<readonly Cell[], Shape>()

function shapeFromCodes(codes: Int32Array): Shape {
  const key = codesKey(codes)
  const hit = CACHE.get(key)
  if (hit !== undefined) return hit
  let h = 0
  let w = 0
  for (const x of codes) {
    const r = (x - (x % SHIFT)) / SHIFT
    const c = x % SHIFT
    if (r + 1 > h) h = r + 1
    if (c + 1 > w) w = c + 1
  }
  const masks = new Int32Array(h)
  for (const x of codes) {
    const r = (x - (x % SHIFT)) / SHIFT
    masks[r] = (masks[r] as number) | (1 << (x % SHIFT))
  }
  if (CACHE.size >= CACHE_LIMIT) CACHE.clear()
  const shape: Shape = { key, codes, n: codes.length, h, w, masks }
  CACHE.set(key, shape)
  return shape
}

function shapeOf(cells: readonly Cell[]): Shape {
  const known = OF_ARRAY.get(cells)
  if (known !== undefined) return known
  const s = shapeFromCodes(codesOf(cells, 0))
  OF_ARRAY.set(cells, s)
  return s
}

/** Decode a shape into a fresh array (callers may keep or change it), remembered as that shape. */
function cellsOf(s: Shape): Cell[] {
  const out = decode(s.codes)
  OF_ARRAY.set(out, s)
  return out
}

/**
 * Mask key of the image of `s` under MAPS[t], from the closed forms of the 8 maps on a normalised h × w figure:
 * (r, c), (c, h−1−r), (h−1−r, w−1−c), (w−1−c, r), (r, w−1−c), (w−1−c, h−1−r), (h−1−r, c), (c, r). One UTF-16 unit per
 * row (its column bit mask), so equal keys are equal figures. Only equality of these keys is ever used.
 */
function imageMaskKey(s: Shape, t: number, rows: Int32Array): string {
  const h = s.h
  const w = s.w
  // rr = a·r + b·c + e, cc = c'·r + d·c + f (the closed forms above).
  let a = 0
  let b = 0
  let e = 0
  let c2 = 0
  let d = 0
  let f = 0
  switch (t) {
    case 0:
      a = 1
      d = 1
      break
    case 1:
      b = 1
      c2 = -1
      f = h - 1
      break
    case 2:
      a = -1
      e = h - 1
      d = -1
      f = w - 1
      break
    case 3:
      b = -1
      e = w - 1
      c2 = 1
      break
    case 4:
      a = 1
      d = -1
      f = w - 1
      break
    case 5:
      b = -1
      e = w - 1
      c2 = -1
      f = h - 1
      break
    case 6:
      a = -1
      e = h - 1
      d = 1
      break
    default:
      b = 1
      c2 = 1
  }
  const n = t === 1 || t === 3 || t === 5 || t === 7 ? w : h
  rows.fill(0, 0, n)
  const codes = s.codes
  for (let i = 0; i < codes.length; i++) {
    const x = codes[i] as number
    const c = x & (SHIFT - 1)
    const r = x >> 6
    const rr = a * r + b * c + e
    rows[rr] = (rows[rr] as number) | (1 << (c2 * r + d * c + f))
  }
  return String.fromCharCode.apply(null, rows.subarray(0, n) as unknown as number[])
}

const MASK_ROWS = new Int32Array(64)

function infoOf(s: Shape): NonNullable<Shape['info']> {
  if (s.info !== undefined) return s.info
  const keys: string[] = []
  let c4 = ''
  let d4 = ''
  let asymmetric = true
  for (let t = 0; t < 8; t++) {
    const k = imageMaskKey(s, t, MASK_ROWS)
    if (asymmetric && keys.includes(k)) asymmetric = false
    keys.push(k)
    if (t < 4 && (t === 0 || k < c4)) c4 = k
    if (t === 0 || k < d4) d4 = k
  }
  s.info = { c4, d4, asymmetric }
  return s.info
}

/** The least of the 8 images in code order (the canonical form hashed into the family_id). */
function d4CodesOf(s: Shape): Int32Array {
  const cells = decode(s.codes)
  let best = s.codes
  let bestKey = s.key
  for (let t = 1; t < 8; t++) {
    const codes = codesOf(cells, t)
    const k = codesKey(codes)
    if (k < bestKey) {
      best = codes
      bestKey = k
    }
  }
  return best
}

/** The 8 images as shapes (in {@link images} order), built on first use. */
function imagesOf(s: Shape): readonly Shape[] {
  if (s.images === undefined) {
    const cells = decode(s.codes)
    s.images = MAPS.map((_, t) => (t === 0 ? s : shapeFromCodes(codesOf(cells, t))))
  }
  return s.images
}

/** Translate to min row = min column = 0 and sort (row, then column). */
export function normalise(cells: readonly Cell[]): Cell[] {
  return cells.length === 0 ? [] : cellsOf(shapeOf(cells))
}

/** A string key of a cell list as given (normalise first to compare shapes). */
export const cellsKey = (cells: readonly Cell[]): string => cells.map(([r, c]) => `${r},${c}`).join(';')

/** True if the two lists hold the same squares after normalising. */
export const sameShape = (a: readonly Cell[], b: readonly Cell[]): boolean => a.length === b.length && shapeOf(a).key === shapeOf(b).key

const imageShape = (cells: readonly Cell[], t: number): Shape => (cells.length === 0 ? shapeFromCodes(new Int32Array(0)) : (imagesOf(shapeOf(cells))[t] as Shape))

/** k quarter turns clockwise (k any integer; mod 4). */
export function turn(cells: readonly Cell[], k: number): Cell[] {
  return cellsOf(imageShape(cells, ((k % 4) + 4) % 4))
}

const REFLECT_MAP: Readonly<Record<MirrorLine, number>> = Object.freeze({ v: 4, h: 6, d: 7, a: 5 })

/** The mirror image in a line of the given direction. */
export function reflect(cells: readonly Cell[], line: MirrorLine): Cell[] {
  return cellsOf(imageShape(cells, REFLECT_MAP[line]))
}

/** The 4 turns (k = 0…3) of a figure. */
export const turns = (cells: readonly Cell[]): Cell[][] => [0, 1, 2, 3].map((t) => cellsOf(imageShape(cells, t)))

/** The 8 images under D4: the 4 turns, then the 4 turns of the vertical-line mirror image. */
export const images = (cells: readonly Cell[]): Cell[][] => MAPS.map((_, t) => cellsOf(imageShape(cells, t)))

/** The canonical form under turns in the plane. */
export const c4Canon = (cells: readonly Cell[]): Cell[] => least(turns(cells))
/** The canonical form under turns and reflections. */
export const d4Canon = (cells: readonly Cell[]): Cell[] => decode(d4CodesOf(shapeOf(cells)))
/** Keys of the canonical forms (equal keys = the same figure under turns / under turns and reflections). */
export const c4Key = (cells: readonly Cell[]): string => infoOf(shapeOf(cells)).c4
export const d4Key = (cells: readonly Cell[]): string => infoOf(shapeOf(cells)).d4

const least = (list: readonly Cell[][]): Cell[] => list.reduce((m, x) => (compareCells(x, m) < 0 ? x : m))

/** True if all 8 images are distinct (the figure has no symmetry, so every turn and reflection can be told apart). */
export const isAsymmetric = (cells: readonly Cell[]): boolean => infoOf(shapeOf(cells)).asymmetric

/** The quarter turns k ∈ 0…3 with turn(from, k) = to (as normalised sets). */
export function turnsBetween(from: readonly Cell[], to: readonly Cell[]): number[] {
  if (from.length !== to.length || from.length === 0) return []
  const want = shapeOf(to)
  const imgs = imagesOf(shapeOf(from))
  return [0, 1, 2, 3].filter((k) => (imgs[k] as Shape).key === want.key)
}

/** True if the squares are edge-connected (an empty list is not). */
export function isConnected(cells: readonly Cell[]): boolean {
  if (cells.length === 0) return false
  const set = new Set(cells.map(([r, c]) => `${r},${c}`))
  const first = cells[0] as Cell
  const seen = new Set([`${first[0]},${first[1]}`])
  const stack: Cell[] = [first]
  while (stack.length > 0) {
    const [r, c] = stack.pop() as Cell
    for (const [dr, dc] of STEPS) {
      const k = `${r + dr},${c + dc}`
      if (set.has(k) && !seen.has(k)) {
        seen.add(k)
        stack.push([r + dr, c + dc])
      }
    }
  }
  return seen.size === set.size
}

/** Edge-connectivity of sorted codes (row · 64 + column, all ≥ 0), by flood fill over a code-indexed grid. */
function codesConnected(codes: Int32Array, skip: number): boolean {
  const n = codes.length - (skip >= 0 ? 1 : 0)
  if (n <= 0) return false
  const inSet = new Set<number>()
  let first = -1
  for (let i = 0; i < codes.length; i++) {
    if (i === skip) continue
    inSet.add(codes[i] as number)
    if (first < 0) first = codes[i] as number
  }
  const seen = new Set<number>([first])
  const stack = [first]
  while (stack.length > 0) {
    const x = stack.pop() as number
    const c = x % SHIFT
    const nb = [x - SHIFT, x + SHIFT, c > 0 ? x - 1 : -1, c < SHIFT - 1 ? x + 1 : -1]
    for (const y of nb) {
      if (y >= 0 && inSet.has(y) && !seen.has(y)) {
        seen.add(y)
        stack.push(y)
      }
    }
  }
  return seen.size === n
}

/** Bounding box [height, width] of a figure. */
export function bbox(cells: readonly Cell[]): [number, number] {
  const known = OF_ARRAY.get(cells)
  if (known !== undefined) return [known.h, known.w]
  let mr = Infinity
  let mc = Infinity
  let xr = -Infinity
  let xc = -Infinity
  for (const [r, c] of cells) {
    if (r < mr) mr = r
    if (c < mc) mc = c
    if (r > xr) xr = r
    if (c > xc) xc = c
  }
  return cells.length === 0 ? [0, 0] : [xr - mr + 1, xc - mc + 1]
}

function countKeys(s: Shape): void {
  const rows = new Array<number>(s.h).fill(0)
  const cols = new Array<number>(s.w).fill(0)
  for (const x of s.codes) {
    const r = (x - (x % SHIFT)) / SHIFT
    rows[r] = (rows[r] as number) + 1
    cols[x % SHIFT] = (cols[x % SHIFT] as number) + 1
  }
  s.rows = rows.join(',')
  s.cols = cols.join(',')
}

/** Squares per row, top to bottom, as "1,2,1" (memoised). */
export function rowKey(cells: readonly Cell[]): string {
  const s = shapeOf(cells)
  if (s.rows === undefined) countKeys(s)
  return s.rows as string
}

/** Squares per column, left to right, as "2,1,1" (memoised). */
export function colKey(cells: readonly Cell[]): string {
  const s = shapeOf(cells)
  if (s.cols === undefined) countKeys(s)
  return s.cols as string
}

/** Squares per row, top to bottom. */
export function rowCounts(cells: readonly Cell[]): number[] {
  return rowKey(cells).split(',').map(Number)
}

/** Squares per column, left to right. */
export function colCounts(cells: readonly Cell[]): number[] {
  return colKey(cells).split(',').map(Number)
}

/**
 * The count profile (squares per row and per column) up to turning and flipping: the least over the 8 images of
 * "rows|cols". The 8 images' (rows, cols) are exactly the pairs (R or reversed R, C or reversed C) and (C or reversed C,
 * R or reversed R) of the figure's own counts R, C, so no image is built.
 */
export function profileKey(cells: readonly Cell[]): string {
  const s = shapeOf(cells)
  if (s.profile === undefined) {
    if (s.rows === undefined) countKeys(s)
    const r = s.rows as string
    const c = s.cols as string
    const rr = r.split(',').reverse().join(',')
    const cr = c.split(',').reverse().join(',')
    let best = `${r}|${c}`
    for (const k of [`${r}|${cr}`, `${rr}|${c}`, `${rr}|${cr}`, `${c}|${r}`, `${c}|${rr}`, `${cr}|${r}`, `${cr}|${rr}`]) if (k < best) best = k
    s.profile = best
  }
  return s.profile
}

/** The figure's memo key (equal keys = the same squares after normalising). */
export const shapeKey = (cells: readonly Cell[]): string => shapeOf(cells).key

/** Largest overlap of two shapes over all translations, by row bit masks; stops early once `enough` is reached. */
function overlapShapes(a: Shape, b: Shape, enough: number): number {
  let best = 0
  for (let dr = -(b.h - 1); dr <= a.h - 1; dr++) {
    const r0 = Math.max(0, -dr)
    const r1 = Math.min(b.h, a.h - dr)
    for (let dc = -(b.w - 1); dc <= a.w - 1; dc++) {
      let n = 0
      for (let r = r0; r < r1; r++) {
        const m = b.masks[r] as number
        const shifted = dc >= 0 ? m << dc : m >>> -dc
        n += popcount((a.masks[r + dr] as number) & shifted)
      }
      if (n > best) {
        best = n
        if (best >= enough) return best
      }
    }
  }
  return best
}

/** The largest overlap of `a` with a translate of `b` (both lists of distinct squares). */
export function maxOverlap(a: readonly Cell[], b: readonly Cell[]): number {
  if (a.length === 0 || b.length === 0) return 0
  return overlapShapes(shapeOf(a), shapeOf(b), Infinity)
}

/** One square moved, orientation kept: same size, different shape, and a translate of `b` shares all but one square with `a`. */
export function isOneMoveExact(a: readonly Cell[], b: readonly Cell[]): boolean {
  if (a.length !== b.length || a.length <= 1) return false
  const sa = shapeOf(a)
  const sb = shapeOf(b)
  return sa.key !== sb.key && overlapShapes(sa, sb, a.length - 1) === a.length - 1
}

/** One square moved, in any orientation: not the same figure up to D4, and some image of `b` is one move from `a`. */
export function isOneMoveAnyTurn(a: readonly Cell[], b: readonly Cell[]): boolean {
  if (a.length !== b.length || a.length < 2) return false
  const sa = shapeOf(a)
  const sb = shapeOf(b)
  if (infoOf(sa).d4 === infoOf(sb).d4) return false
  return imagesOf(sb).some((g) => overlapShapes(sa, g, a.length - 1) === a.length - 1)
}

/**
 * Every one-square-moved variant of a figure, normalised, without repeats, in a fixed order: remove one square (the
 * rest must stay connected), add one square next to the rest (not the removed one, not an existing one). Memoised per
 * figure; every call returns fresh arrays.
 */
export function movedVariants(cells: readonly Cell[]): Cell[][] {
  return movedVariantsShared(cells).map((v) => {
    const copy = v.map((c): Cell => [c[0], c[1]])
    OF_ARRAY.set(copy, shapeOf(v))
    return copy
  })
}

/** {@link movedVariants} without copying: the memoised arrays, which the caller must not change. */
export function movedVariantsShared(cells: readonly Cell[]): readonly (readonly Cell[])[] {
  if (cells.length === 0) return []
  const s = shapeOf(cells)
  if (s.moved === undefined) s.moved = movedCodes(s).map((v) => cellsOf(shapeFromCodes(v)))
  return s.moved
}

/**
 * The sorted codes of every one-square-moved variant, in {@link movedVariants} order, without repeats (memoised). The
 * rest stays sorted when a square is removed, the added square is merged in, and normalising subtracts one constant
 * (min row · 64 + min column) from every code, which keeps the order: no sort per variant.
 */
function movedCodes(s: Shape): readonly Int32Array[] {
  if (s.movedCodes !== undefined) return s.movedCodes
  // Codes offset by one row and column, so a neighbour of row or column 0 stays non-negative.
  const OFF = SHIFT + 1
  const base = Int32Array.from(s.codes, (x) => x + OFF)
  const n = base.length
  const seen = new Set<string>()
  const out: Int32Array[] = []
  const inBase = new Set<number>(base)
  for (let i = 0; i < n; i++) {
    if (!codesConnected(base, i)) continue
    const removed = base[i] as number
    const cand = new Set<number>()
    for (let j = 0; j < n; j++) {
      if (j === i) continue
      const x = base[j] as number
      let y = x - SHIFT
      if (y !== removed && !inBase.has(y)) cand.add(y)
      y = x - 1
      if (y !== removed && !inBase.has(y)) cand.add(y)
      y = x + 1
      if (y !== removed && !inBase.has(y)) cand.add(y)
      y = x + SHIFT
      if (y !== removed && !inBase.has(y)) cand.add(y)
    }
    const qs = [...cand].sort((x, y) => x - y)
    for (const q of qs) {
      const v = new Int32Array(n)
      let k = 0
      let placed = false
      let mr = Infinity
      let mc = Infinity
      for (let j = 0; j < n; j++) {
        if (j === i) continue
        const x = base[j] as number
        if (!placed && q < x) {
          v[k++] = q
          placed = true
        }
        v[k++] = x
      }
      if (!placed) v[k++] = q
      for (let j = 0; j < n; j++) {
        const x = v[j] as number
        const r = (x - (x % SHIFT)) / SHIFT
        if (r < mr) mr = r
        if (x % SHIFT < mc) mc = x % SHIFT
      }
      const shift = mr * SHIFT + mc
      for (let j = 0; j < n; j++) v[j] = (v[j] as number) - shift
      const key = codesKey(v)
      if (!seen.has(key)) {
        seen.add(key)
        out.push(v)
      }
    }
  }
  s.movedCodes = out
  return out
}

/** The 8 compact count keys of a figure's images (its count orbit: equal profiles = the same orbit). */
function countOrbit(s: Shape): Set<string> {
  const rows = new Array<number>(s.h).fill(0)
  const cols = new Array<number>(s.w).fill(0)
  for (const x of s.codes) {
    rows[(x - (x % SHIFT)) / SHIFT] = (rows[(x - (x % SHIFT)) / SHIFT] as number) + 1
    cols[x % SHIFT] = (cols[x % SHIFT] as number) + 1
  }
  const k = (a: number[], b: number[]): string => String.fromCharCode.apply(null, [...a, 0xffff, ...b])
  const rr = [...rows].reverse()
  const cr = [...cols].reverse()
  return new Set([k(rows, cols), k(rows, cr), k(rr, cols), k(rr, cr), k(cols, rows), k(cols, rr), k(cr, rows), k(cr, rr)])
}

/**
 * The task-'rotate' variants of F: its one-square-moved variants (in {@link movedVariants} order) that keep F's count
 * profile iff `hard`, have no symmetry, are not F up to D4, one per figure up to D4 (the first met). As sorted normalised codes (decode one with {@link cellsOfCodes}).
 */
export function rotateVariantList(f: readonly Cell[], hard: boolean): readonly Int32Array[] {
  const s = shapeOf(f)
  const own = infoOf(s).d4
  const orbit = countOrbit(s)
  const lo = Math.min(s.h, s.w)
  const hi = Math.max(s.h, s.w)
  const seen = new Set<string>()
  const out: Int32Array[] = []
  forEachMove(s, (h, w, countKey, build) => {
    const sameProfile = Math.min(h, w) === lo && Math.max(h, w) === hi && orbit.has(countKey())
    if (sameProfile !== hard) return
    const codes = build()
    const info = infoOfCodes(codes, h, w)
    if (info.d4 === own || seen.has(info.d4) || !info.asymmetric) return
    seen.add(info.d4)
    out.push(codes)
  })
  return out
}

/**
 * The task-'mirror' moved distractors: the key's one-square-moved variants (in {@link movedVariants} order, without
 * repeats) with the key's box, no symmetry, not F up to D4 (so also not the key). Shared arrays.
 */
export function mirrorMovedList(f: readonly Cell[], key: readonly Cell[]): readonly Int32Array[] {
  const own = infoOf(shapeOf(f)).d4
  const k = shapeOf(key)
  const seen = new Set<string>()
  const out: Int32Array[] = []
  forEachMove(k, (h, w, _countKey, build) => {
    if (h !== k.h || w !== k.w) return
    const codes = build()
    const ck = codesKey(codes)
    if (seen.has(ck)) return
    seen.add(ck)
    const info = infoOfCodes(codes, h, w)
    if (!info.asymmetric || info.d4 === own || ck === k.key) return
    out.push(codes)
  })
  return out
}

/** A fresh cell list of sorted normalised codes (from {@link rotateVariantList} / {@link mirrorMovedList}). */
export const cellsOfCodes = (codes: Int32Array): Cell[] => cellsOf(shapeFromCodes(codes))

/** {@link infoOf} of sorted normalised codes, through the shape cache when the figure is known there. */
function infoOfCodes(codes: Int32Array, h: number, w: number): NonNullable<Shape['info']> {
  const known = CACHE.get(codesKey(codes))
  if (known !== undefined) return infoOf(known)
  const light = { codes, h, w } as unknown as Shape
  return infoOf(light)
}

/**
 * Visit every one-square-moved variant of `s` in {@link movedVariants} order (repeats included): remove square i (the
 * rest connected), add a free square q next to the rest (not the removed one), i ascending, q ascending. The visitor
 * gets the variant's box, a lazy count key (as {@link countOrbit}) and a lazy builder of its sorted normalised codes;
 * per-row and per-column counts are updated in place, so a move that fails on its box or counts costs no allocation.
 */
function forEachMove(s: Shape, visit: (h: number, w: number, countKey: () => string, build: () => Int32Array) => void): void {
  const OFF = SHIFT + 1
  const base = Int32Array.from(s.codes, (x) => x + OFF)
  const n = base.length
  const inBase = new Set<number>(base)
  // Offset rows 1…h and columns 1…w; a moved square may land in row or column 0 or h + 1 / w + 1.
  const rowCnt = new Array<number>(s.h + 2).fill(0)
  const colCnt = new Array<number>(s.w + 2).fill(0)
  for (const x of base) {
    rowCnt[x >> 6] = (rowCnt[x >> 6] as number) + 1
    colCnt[x & (SHIFT - 1)] = (colCnt[x & (SHIFT - 1)] as number) + 1
  }
  const key: number[] = []
  let i = 0
  let q = 0
  let r0 = 0
  let r1 = 0
  let c0 = 0
  let c1 = 0
  const countKey = (): string => {
    key.length = 0
    for (let r = r0; r <= r1; r++) key.push(rowCnt[r] as number)
    key.push(0xffff)
    for (let c = c0; c <= c1; c++) key.push(colCnt[c] as number)
    return String.fromCharCode.apply(null, key)
  }
  const build = (): Int32Array => {
    const v = new Int32Array(n)
    const shift = r0 * SHIFT + c0
    let m = 0
    let placed = false
    for (let j = 0; j < n; j++) {
      if (j === i) continue
      const x = base[j] as number
      if (!placed && q < x) {
        v[m++] = q - shift
        placed = true
      }
      v[m++] = x - shift
    }
    if (!placed) v[m] = q - shift
    return v
  }
  for (i = 0; i < n; i++) {
    if (!codesConnected(base, i)) continue
    const removed = base[i] as number
    const rr = removed >> 6
    const rc = removed & (SHIFT - 1)
    rowCnt[rr] = (rowCnt[rr] as number) - 1
    colCnt[rc] = (colCnt[rc] as number) - 1
    const cand = new Set<number>()
    for (let j = 0; j < n; j++) {
      if (j === i) continue
      const x = base[j] as number
      for (let k = 0; k < 4; k++) {
        const y = k === 0 ? x - SHIFT : k === 1 ? x - 1 : k === 2 ? x + 1 : x + SHIFT
        if (y !== removed && !inBase.has(y)) cand.add(y)
      }
    }
    const qs = [...cand].sort((x, y) => x - y)
    for (const qq of qs) {
      q = qq
      const qr = q >> 6
      const qc = q & (SHIFT - 1)
      rowCnt[qr] = (rowCnt[qr] as number) + 1
      colCnt[qc] = (colCnt[qc] as number) + 1
      r0 = 0
      while (rowCnt[r0] === 0) r0++
      r1 = rowCnt.length - 1
      while (rowCnt[r1] === 0) r1--
      c0 = 0
      while (colCnt[c0] === 0) c0++
      c1 = colCnt.length - 1
      while (colCnt[c1] === 0) c1--
      visit(r1 - r0 + 1, c1 - c0 + 1, countKey, build)
      rowCnt[qr] = (rowCnt[qr] as number) - 1
      colCnt[qc] = (colCnt[qc] as number) - 1
    }
    rowCnt[rr] = (rowCnt[rr] as number) + 1
    colCnt[rc] = (colCnt[rc] as number) + 1
  }
}

/**
 * A random figure of n squares grown one square at a time: each new square is drawn uniformly from the free squares
 * next to the figure (listed in row, column order).
 */
export function growFigure(rng: Rng, n: number): Cell[] {
  return normalise(growCodes(rng, n).cells)
}

const GROW_W = 64
const GROW_O = 32
const GROW_STATE = new Uint8Array(GROW_W * GROW_W)

/**
 * The growth of {@link growFigure}: codes (r + 32) · 64 + (c + 32) on a 64 × 64 grid, whose numeric order is the (row,
 * column) order. The frontier (free squares next to the figure) is kept sorted and updated per added square, which
 * gives the same list, so the same draws, as rebuilding it. Returns the squares and the box.
 */
function growCodes(rng: Rng, n: number): { readonly cells: Cell[]; readonly h: number; readonly w: number } {
  const W = GROW_W
  const state = GROW_STATE // 1 = in the figure, 2 = in the frontier; cleared before returning
  const first = GROW_O * W + GROW_O
  const codes: number[] = [first]
  const frontier: number[] = []
  state[first] = 1
  let q = first
  let minR = GROW_O
  let maxR = GROW_O
  let minC = GROW_O
  let maxC = GROW_O
  for (;;) {
    for (let k = 0; k < 4; k++) {
      const y = k === 0 ? q - W : k === 1 ? q - 1 : k === 2 ? q + 1 : q + W
      if (state[y] !== 0) continue
      state[y] = 2
      let lo = 0
      let hi = frontier.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if ((frontier[mid] as number) < y) lo = mid + 1
        else hi = mid
      }
      frontier.splice(lo, 0, y)
    }
    if (codes.length >= n) break
    q = rng.pick(frontier)
    frontier.splice(frontier.indexOf(q), 1)
    state[q] = 1
    codes.push(q)
    const r = (q - (q % W)) / W
    const c = q % W
    if (r < minR) minR = r
    if (r > maxR) maxR = r
    if (c < minC) minC = c
    if (c > maxC) maxC = c
  }
  for (const x of codes) state[x] = 0
  for (const x of frontier) state[x] = 0
  const cells = codes.map((x): Cell => [(x - (x % W)) / W - GROW_O, (x % W) - GROW_O])
  return { cells, h: maxR - minR + 1, w: maxC - minC + 1 }
}

/**
 * Grow figures of n squares (as {@link growFigure}) until one has no symmetry and, when `square`, a square box; the
 * same draws and the same result as testing each grown figure in turn. Null after `attempts` figures.
 */
export function growAsymmetric(rng: Rng, n: number, square: boolean, attempts: number): Cell[] | null {
  for (let i = 0; i < attempts; i++) {
    const g = growCodes(rng, n)
    if (square && g.h !== g.w) continue
    const f = normalise(g.cells)
    if (!isAsymmetric(f)) continue
    return f
  }
  return null
}

/**
 * The option-only look of each option: the values a test taker could compare across the options without looking at the
 * target. `oddOneOut` of any of them must be null (no option stands apart from three alike ones).
 */
export function oddOneOut(values: readonly string[]): number | null {
  if (values.length !== 4) return null
  for (let i = 0; i < 4; i++) {
    const others = values.filter((_, j) => j !== i)
    if (others.every((v) => v === others[0]) && values[i] !== others[0]) return i
  }
  return null
}

/**
 * How each option relates to the other options, from the options alone: [turned copies (same figure under a turn),
 * mirror images (same figure under D4, not under a turn), one-square-moved neighbours]. `orientationMatters` (task
 * 'mirror', options drawn upright) counts a neighbour only in the same orientation; otherwise in any orientation. Each
 * option of a good item has the same signature, so these relations cannot single the key out.
 */
export function relationSignatures(options: readonly (readonly Cell[])[], orientationMatters: boolean): string[] {
  const c4 = options.map(c4Key)
  const d4 = options.map(d4Key)
  return options.map((o, i) => {
    let turned = 0
    let mirrored = 0
    let near = 0
    options.forEach((p, j) => {
      if (j === i) return
      if (c4[j] === c4[i]) turned++
      else if (d4[j] === d4[i]) mirrored++
      if (orientationMatters ? isOneMoveExact(o, p) : isOneMoveAnyTurn(o, p)) near++
    })
    return `${turned}/${mirrored}/${near}`
  })
}
