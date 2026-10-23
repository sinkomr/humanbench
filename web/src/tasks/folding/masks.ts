/**
 * Slot sets as bit masks, for the generator's inner loops (`gen.ts`): slot (row, col) of an n × n
 * sheet is bit (row − 1)·n + (col − 1), bits 0–17 in `lo` and 18–35 in `hi` (n ≤ 6), so set
 * operations are a few 32-bit integer operations. The verifier does not use this module (it works on
 * slot lists, `cues.ts` and `verify.ts`), so the two are separate implementations.
 */

import { SHEET_MIRRORS, SHEET_SYMMETRIES, ptSlot, slotPt } from './geometry'
import type { Slot } from './spec'

export interface Mask {
  readonly lo: number
  readonly hi: number
}

const HALF = 18

export const EMPTY: Mask = Object.freeze({ lo: 0, hi: 0 })

export function popcount(x: number): number {
  let v = x - ((x >>> 1) & 0x55555555)
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

export const size = (m: Mask): number => popcount(m.lo) + popcount(m.hi)
export const bit = (i: number): Mask => (i < HALF ? { lo: 1 << i, hi: 0 } : { lo: 0, hi: 1 << (i - HALF) })
export const has = (m: Mask, i: number): boolean => (i < HALF ? (m.lo >>> i) & 1 : (m.hi >>> (i - HALF)) & 1) === 1
export const or = (a: Mask, b: Mask): Mask => ({ lo: a.lo | b.lo, hi: a.hi | b.hi })
export const andNot = (a: Mask, b: Mask): Mask => ({ lo: a.lo & ~b.lo, hi: a.hi & ~b.hi })
export const meets = (a: Mask, b: Mask): boolean => (a.lo & b.lo) !== 0 || (a.hi & b.hi) !== 0
export const same = (a: Mask, b: Mask): boolean => a.lo === b.lo && a.hi === b.hi
export const distance = (a: Mask, b: Mask): number => popcount(a.lo ^ b.lo) + popcount(a.hi ^ b.hi)
export const maskText = (m: Mask): string => `${m.lo}.${m.hi}`

export const slotIndex = (s: Slot, n: number): number => (s.row - 1) * n + (s.col - 1)

export function maskOf(slots: readonly Slot[], n: number): Mask {
  let m: Mask = EMPTY
  for (const s of slots) m = or(m, bit(slotIndex(s, n)))
  return m
}

/** The set bits, ascending (= slots sorted by row, then column). */
export function bits(m: Mask, n: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n * n; i++) if (has(m, i)) out.push(i)
  return out
}

export function slotsOf(m: Mask, n: number): Slot[] {
  return bits(m, n).map((i) => ({ row: Math.floor(i / n) + 1, col: (i % n) + 1 }))
}

/** perms[n][g][i]: the slot index that sheet symmetry g (`SHEET_SYMMETRIES` order) sends slot i to. */
const PERMS = new Map<number, readonly Int8Array[]>()

export function perms(n: number): readonly Int8Array[] {
  let p = PERMS.get(n)
  if (!p) {
    p = SHEET_SYMMETRIES.map((g) => {
      const a = new Int8Array(n * n)
      for (let i = 0; i < n * n; i++) a[i] = slotIndex(ptSlot(g.pt(slotPt({ row: Math.floor(i / n) + 1, col: (i % n) + 1 }), n)), n)
      return a
    })
    PERMS.set(n, p)
  }
  return p
}

/** rowTables(n)[g][r][v]: the image (lo, hi) under symmetry g of the bits v of row r (n ≤ 6: a row never straddles lo/hi). */
const ROWS = new Map<number, readonly (readonly { readonly lo: Int32Array; readonly hi: Int32Array }[])[]>()

function rowTables(n: number): readonly (readonly { readonly lo: Int32Array; readonly hi: Int32Array }[])[] {
  let t = ROWS.get(n)
  if (!t) {
    const ps = perms(n)
    t = ps.map((p) =>
      Array.from({ length: n }, (_, r) => {
        const lo = new Int32Array(1 << n)
        const hi = new Int32Array(1 << n)
        for (let v = 0; v < 1 << n; v++)
          for (let c = 0; c < n; c++)
            if ((v >>> c) & 1) {
              const j = p[r * n + c] as number
              if (j < HALF) lo[v] = (lo[v] as number) | (1 << j)
              else hi[v] = (hi[v] as number) | (1 << (j - HALF))
            }
        return { lo, hi }
      }),
    )
    ROWS.set(n, t)
  }
  return t
}

/** The image of a set under symmetry `g` (an index into `SHEET_SYMMETRIES`). */
export function permuteBy(m: Mask, g: number, n: number): Mask {
  const rows = (rowTables(n)[g] as readonly { readonly lo: Int32Array; readonly hi: Int32Array }[])
  const full = (1 << n) - 1
  let lo = 0
  let hi = 0
  for (let r = 0; r < n; r++) {
    const start = r * n
    const v = start < HALF ? (m.lo >>> start) & full : (m.hi >>> (start - HALF)) & full
    if (v === 0) continue
    const row = rows[r] as { readonly lo: Int32Array; readonly hi: Int32Array }
    lo |= row.lo[v] as number
    hi |= row.hi[v] as number
  }
  return { lo, hi }
}

/** A number naming the set exactly (lo + hi · 2^18 < 2^36). */
export const idOf = (m: Mask): number => m.lo + m.hi * 262144

export function permute(m: Mask, perm: Int8Array, n: number): Mask {
  const g = perms(n).indexOf(perm)
  if (g >= 0) return permuteBy(m, g, n)
  let out: Mask = EMPTY
  for (const i of bits(m, n)) out = or(out, bit(perm[i] as number))
  return out
}

const STABS = new Map<number, number[]>()

/** Indices (into `SHEET_SYMMETRIES`) of the symmetries that map the set onto itself (cached; do not mutate). */
export function stabilizerOf(m: Mask, n: number): number[] {
  const key = idOf(m) * 8 + n
  let s = STABS.get(key)
  if (!s) {
    s = []
    for (let g = 0; g < 8; g++) if (same(permuteBy(m, g, n), m)) s.push(g)
    if (STABS.size > 200_000) STABS.clear()
    STABS.set(key, s)
  }
  return s
}

/** Indices of the mirror symmetries (`SHEET_MIRRORS`, 4–7 in `SHEET_SYMMETRIES`). */
export const MIRROR_INDICES: readonly number[] = Object.freeze(SHEET_MIRRORS.map((m) => SHEET_SYMMETRIES.indexOf(m)))

const ORBITS = new Map<number, Mask>()
const ORBIT_TABLES = new Map<number, { readonly lo: Int32Array; readonly hi: Int32Array; readonly size: Int8Array; readonly min: Int8Array }>()

/** Every slot's orbit under a group, as parallel arrays (lo, hi, size, lowest slot), cached per (group, n). */
export function orbitTable(group: readonly number[], n: number): { readonly lo: Int32Array; readonly hi: Int32Array; readonly size: Int8Array; readonly min: Int8Array } {
  let gb = 0
  for (const g of group) gb |= 1 << g
  const key = gb * 8 + n
  let t = ORBIT_TABLES.get(key)
  if (!t) {
    const ps = perms(n)
    const lo = new Int32Array(n * n)
    const hi = new Int32Array(n * n)
    const sz = new Int8Array(n * n)
    const mn = new Int8Array(n * n)
    for (let i = 0; i < n * n; i++) {
      let l = 0
      let h = 0
      let m = i
      for (const g of group) {
        const j = (ps[g] as Int8Array)[i] as number
        if (j < HALF) l |= 1 << j
        else h |= 1 << (j - HALF)
        m = Math.min(m, j)
      }
      lo[i] = l
      hi[i] = h
      sz[i] = popcount(l) + popcount(h)
      mn[i] = m
    }
    t = { lo, hi, size: sz, min: mn }
    ORBIT_TABLES.set(key, t)
  }
  return t
}

export function orbitOf(i: number, group: readonly number[], n: number): Mask {
  let gb = 0
  for (const g of group) gb |= 1 << g
  const key = (i * 256 + gb) * 8 + n
  let out = ORBITS.get(key)
  if (!out) {
    const ps = perms(n)
    let m: Mask = EMPTY
    for (const g of group) m = or(m, bit((ps[g] as Int8Array)[i] as number))
    out = m
    ORBITS.set(key, out)
  }
  return out
}

/** The lowest slot index of the orbit (its first slot in reading order). */
export function orbitMin(i: number, group: readonly number[], n: number): number {
  const ps = perms(n)
  let lo = i
  for (const g of group) lo = Math.min(lo, (ps[g] as Int8Array)[i] as number)
  return lo
}
