/**
 * Polycube and quaternion geometry for the mental-rotation family (DESIGN §4.2, ROADMAP A11).
 *
 * - Cubes are integer triples; a shape is a list of distinct cubes. Two shapes are the same
 *   object when one is the other under one of the 24 proper rotations of the cube (the chiral
 *   octahedral group, §4.2 `rotation_group`) plus a translation.
 * - {@link canon} is §4.2 `canon` exactly: rotate by every group element, translate to the min
 *   corner, sort the cubes, take the lexicographic minimum.
 * - A *chain* is a shape whose face-adjacency graph is a simple path (a Shepard–Metzler figure);
 *   its *arms* are the maximal straight runs of the path ({@link chainInfo}).
 * - A *one-cube-moved variant* (§4.2 distractor) removes a terminal cube (degree 1) and puts a
 *   cube on another free face-adjacent position, such that the result is again a chain with
 *   ≥ {@link MIN_ARMS} arms ({@link movedVariants}).
 * - Quaternions are unit Hamilton quaternions `[w, x, y, z]` rotating column vectors
 *   (v' = q v q*), the same convention as Three.js `Quaternion(x, y, z, w)`.
 */

import type { Rng } from '../../engine'

export type Cube = readonly [number, number, number]
export type Vec3 = readonly [number, number, number]
/** Row-major 3×3 matrix. */
export type Mat3 = readonly [Vec3, Vec3, Vec3]
/** Unit quaternion `[w, x, y, z]`. */
export type Quat = readonly [number, number, number, number]

/** Minimum number of arms (straight runs) of a Shepard–Metzler chain (§4.2). */
export const MIN_ARMS = 3

/** Coordinates handled by the integer cell codes below: |c| ≤ this (checked by the verifier). */
export const COORD_LIMIT = 100

/** The six unit steps, in a fixed order (+x, −x, +y, −y, +z, −z). */
export const AXIS_STEPS: readonly Vec3[] = Object.freeze([
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const)

// --- the chiral octahedral group (§4.2) -------------------------------------------------------

const PERMUTATIONS: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
]

function det3(m: Mat3): number {
  const [a, b, c] = m
  return a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])
}

/**
 * §4.2 `rotation_group()`: the signed permutation matrices m[i][perm[i]] = sign[i] with det = +1,
 * in the §4.2 enumeration order (itertools.permutations × itertools.product). Index 0 is the identity.
 */
export const ROTATION_GROUP: readonly Mat3[] = Object.freeze(
  (() => {
    const out: Mat3[] = []
    for (const perm of PERMUTATIONS) {
      for (const s0 of [1, -1]) {
        for (const s1 of [1, -1]) {
          for (const s2 of [1, -1]) {
            const signs = [s0, s1, s2]
            const rows = [0, 1, 2].map((i) => {
              const row = [0, 0, 0]
              row[perm[i] as number] = signs[i] as number
              return row as unknown as Vec3
            })
            const m = rows as unknown as Mat3
            if (det3(m) === 1) out.push(m)
          }
        }
      }
    }
    if (out.length !== 24) throw new Error('rotation group must have 24 elements')
    return out
  })(),
)

/** m · c for a cube (or any integer vector). */
export function applyMat(m: Mat3, c: Cube): Cube {
  const [r0, r1, r2] = m
  return [
    r0[0] * c[0] + r0[1] * c[1] + r0[2] * c[2],
    r1[0] * c[0] + r1[1] * c[1] + r1[2] * c[2],
    r2[0] * c[0] + r2[1] * c[1] + r2[2] * c[2],
  ]
}

/** The mirror image used by §4.2: (x, y, z) → (−x, y, z). */
export function mirror(cubes: readonly Cube[]): Cube[] {
  return cubes.map(([x, y, z]) => [0 - x, y, z])
}

/** Translate so the minimum of each coordinate is 0 (cube order is kept). */
export function normalise(cubes: readonly Cube[]): Cube[] {
  if (cubes.length === 0) return []
  let mx = Infinity
  let my = Infinity
  let mz = Infinity
  for (const [x, y, z] of cubes) {
    if (x < mx) mx = x
    if (y < my) my = y
    if (z < mz) mz = z
  }
  return cubes.map(([x, y, z]) => [x - mx, y - my, z - mz])
}

// Sorting codes for non-negative coordinates < 1024: numeric order = lexicographic (x, y, z) order.
const B1 = 1024
const B2 = 1024 * 1024
const decodeSorted = (code: number): Cube => [Math.floor(code / B2), Math.floor(code / B1) % B1, code % B1]

/** A group element as a signed coordinate permutation: (m·c)[i] = sign[i] · c[perm[i]]. */
interface GroupOp {
  readonly p0: number
  readonly p1: number
  readonly p2: number
  readonly s0: number
  readonly s1: number
  readonly s2: number
}

const opOf = (m: Mat3): GroupOp => {
  const col = (row: Vec3): number => row.findIndex((v) => v !== 0)
  const [r0, r1, r2] = m
  const [p0, p1, p2] = [col(r0), col(r1), col(r2)]
  return { p0, p1, p2, s0: r0[p0] as number, s1: r1[p1] as number, s2: r2[p2] as number }
}

const IDENTITY_OP: GroupOp = { p0: 0, p1: 1, p2: 2, s0: 1, s1: 1, s2: 1 }
const GROUP_OPS: readonly GroupOp[] = ROTATION_GROUP.map(opOf)

// Scratch buffers (grown on demand) so canonicalisation does not allocate per group element.
let bufA = new Float64Array(16)
let bufB = new Float64Array(16)

/** Sorted min-corner codes of op·cubes, written into out[0..n). */
function sortedCodesInto(cubes: readonly Cube[], op: GroupOp, out: Float64Array): void {
  const n = cubes.length
  let mx = Infinity
  let my = Infinity
  let mz = Infinity
  for (let i = 0; i < n; i++) {
    const c = cubes[i] as Cube
    const x = op.s0 * (c[op.p0] as number)
    const y = op.s1 * (c[op.p1] as number)
    const z = op.s2 * (c[op.p2] as number)
    if (x < mx) mx = x
    if (y < my) my = y
    if (z < mz) mz = z
  }
  for (let i = 0; i < n; i++) {
    const c = cubes[i] as Cube
    const x = op.s0 * (c[op.p0] as number) - mx
    const y = op.s1 * (c[op.p1] as number) - my
    const z = op.s2 * (c[op.p2] as number) - mz
    if (x >= B1 || y >= B1 || z >= B1) throw new RangeError('polycube spans ≥ 1024 cells')
    const code = x * B2 + y * B1 + z
    let j = i - 1 // insertion sort (n is tiny)
    while (j >= 0 && (out[j] as number) > code) {
      out[j + 1] = out[j] as number
      j--
    }
    out[j + 1] = code
  }
}

/** Lexicographic comparison of a[0..n) and b[0..n). */
function lexCompare(a: Float64Array, b: Float64Array, n: number): number {
  for (let i = 0; i < n; i++) {
    const x = a[i] as number
    const y = b[i] as number
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

function ensureBuffers(n: number): void {
  if (bufA.length < n) {
    bufA = new Float64Array(2 * n)
    bufB = new Float64Array(2 * n)
  }
}

/** §4.2 `canon` as sorted codes (a fresh array). */
function canonCodes(cubes: readonly Cube[]): Float64Array {
  const n = cubes.length
  ensureBuffers(n)
  let best = bufA
  let cand = bufB
  sortedCodesInto(cubes, GROUP_OPS[0] as GroupOp, best)
  for (let g = 1; g < GROUP_OPS.length; g++) {
    sortedCodesInto(cubes, GROUP_OPS[g] as GroupOp, cand)
    if (lexCompare(cand, best, n) < 0) [best, cand] = [cand, best]
  }
  return best.slice(0, n)
}

/** §4.2 `canon`: the lexicographically least sorted, min-corner cube list over the 24 rotations. */
export function canon(cubes: readonly Cube[]): Cube[] {
  return Array.from(canonCodes(cubes), decodeSorted)
}

/** A string key of {@link canon}: equal iff the shapes are rotation-equivalent. */
export function canonKey(cubes: readonly Cube[]): string {
  return canonCodes(cubes).join(',')
}

/** Lexicographic comparison of two cube lists (§4.2 tuple order). */
export function compareCubeLists(a: readonly Cube[], b: readonly Cube[]): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const p = a[i] as Cube
    const q = b[i] as Cube
    for (let k = 0; k < 3; k++) if (p[k] !== q[k]) return (p[k] as number) - (q[k] as number)
  }
  return a.length - b.length
}

/**
 * The polycube up to rotation *and* reflection: the lesser of canon(S) and canon(mirror(S)).
 * Enantiomers are isomorphs for family exclusion (A11 `family_id`).
 */
export function achiralCanon(cubes: readonly Cube[]): Cube[] {
  const a = canon(cubes)
  const b = canon(mirror(cubes))
  return compareCubeLists(a, b) <= 0 ? a : b
}

/** Key of the min-corner cube *set* in its own frame (no rotation): equal iff same set up to translation. */
export function sortedKey(cubes: readonly Cube[]): string {
  ensureBuffers(cubes.length)
  sortedCodesInto(cubes, IDENTITY_OP, bufA)
  return bufA.slice(0, cubes.length).join(',')
}

/** Indices g of {@link ROTATION_GROUP} with g·from = to up to translation. */
export function groupElementsMapping(from: readonly Cube[], to: readonly Cube[]): number[] {
  const n = from.length
  if (n !== to.length) return []
  ensureBuffers(n)
  const want = bufA
  const cand = bufB
  sortedCodesInto(to, IDENTITY_OP, want)
  const out: number[] = []
  GROUP_OPS.forEach((op, g) => {
    sortedCodesInto(from, op, cand)
    if (lexCompare(cand, want, n) === 0) out.push(g)
  })
  return out
}

/** Elements g of the group with g·S = S up to translation (1 = no rotational symmetry). */
export function symmetryOrder(cubes: readonly Cube[]): number {
  return groupElementsMapping(cubes, cubes).length
}

/**
 * True if the two cube *lists* are index-aligned copies of one shape: b[k] = M·a[k] + t for every
 * k, with one signed permutation M (a rotation, or a rotation after {@link mirror}) and one
 * translation t. An option list aligned with the target's would reveal the key (or the mirror)
 * with no mental rotation at all, which is why the generator shuffles every list (§4.2 no leak).
 */
export function indexAligned(a: readonly Cube[], b: readonly Cube[]): boolean {
  const n = a.length
  if (n === 0 || n !== b.length) return false
  for (const src of [a, mirror(a)]) {
    for (const op of GROUP_OPS) {
      const m = (c: Cube): Cube => [op.s0 * (c[op.p0] as number), op.s1 * (c[op.p1] as number), op.s2 * (c[op.p2] as number)]
      const m0 = m(src[0] as Cube)
      const b0 = b[0] as Cube
      let ok = true
      for (let k = 1; k < n && ok; k++) {
        const mk = m(src[k] as Cube)
        const bk = b[k] as Cube
        ok = bk[0] - mk[0] === b0[0] - m0[0] && bk[1] - mk[1] === b0[1] - m0[1] && bk[2] - mk[2] === b0[2] - m0[2]
      }
      if (ok) return true
    }
  }
  return false
}

// --- adjacency, chains, arms ------------------------------------------------------------------

// Cell codes (small integers) for |coordinate| < 127; the verifier bounds inputs by COORD_LIMIT
// first, and neighbours of such cells stay in range.
const C1 = 256
const C2 = 256 * 256
const OFF = 128
const cellCode = (x: number, y: number, z: number): number => (x + OFF) * C2 + (y + OFF) * C1 + (z + OFF)
const STEP_CODES = AXIS_STEPS.map(([x, y, z]) => x * C2 + y * C1 + z)

function codeSet(cubes: readonly Cube[]): Set<number> {
  return new Set(cubes.map(([x, y, z]) => cellCode(x, y, z)))
}

/** Number of face neighbours of each cube within the shape. */
export function degrees(cubes: readonly Cube[]): number[] {
  const set = codeSet(cubes)
  return cubes.map(([x, y, z]) => {
    const c = cellCode(x, y, z)
    let d = 0
    for (const s of STEP_CODES) if (set.has(c + s)) d++
    return d
  })
}

/** True if every cube is distinct. */
export function allDistinct(cubes: readonly Cube[]): boolean {
  return codeSet(cubes).size === cubes.length
}

/** True if the face-adjacency graph is connected (and the shape non-empty). */
export function isConnected(cubes: readonly Cube[]): boolean {
  if (cubes.length === 0) return false
  const set = codeSet(cubes)
  const first = cubes[0] as Cube
  const start = cellCode(first[0], first[1], first[2])
  const seen = new Set([start])
  const stack = [start]
  while (stack.length > 0) {
    const c = stack.pop() as number
    for (const s of STEP_CODES) {
      const nb = c + s
      if (set.has(nb) && !seen.has(nb)) {
        seen.add(nb)
        stack.push(nb)
      }
    }
  }
  return seen.size === set.size
}

export interface ChainInfo {
  /** The cubes in path order, from one end. */
  readonly order: readonly Cube[]
  /** Number of maximal straight runs of the path (the arms). */
  readonly arms: number
}

/**
 * Path order and arm count if the shape is a chain (distinct cubes whose face-adjacency graph is
 * a simple path: every degree 1 or 2, and the walk from a degree-1 end visits every cube), else
 * null. Linear scans instead of hashing: shapes have ~10 cubes.
 */
// Scratch buffers of chainInfo (grown on demand; chainInfo is not re-entrant).
let chainCodes = new Int32Array(16)
let chainNeighbours = new Int32Array(96)

export function chainInfo(cubes: readonly Cube[]): ChainInfo | null {
  const n = cubes.length
  if (n < 2) return null
  if (chainCodes.length < n) {
    chainCodes = new Int32Array(2 * n)
    chainNeighbours = new Int32Array(12 * n)
  }
  const codes = chainCodes
  for (let i = 0; i < n; i++) {
    const c = cubes[i] as Cube
    codes[i] = cellCode(c[0], c[1], c[2])
  }
  for (let i = 1; i < n; i++) for (let j = 0; j < i; j++) if (codes[i] === codes[j]) return null // duplicate
  // neighbours[6i + s] = index of the cube one step s from cube i, or −1
  const neighbours = chainNeighbours.fill(-1, 0, 6 * n)
  let start = -1
  for (let i = 0; i < n; i++) {
    let d = 0
    for (let s = 0; s < 6; s++) {
      const want = (codes[i] as number) + (STEP_CODES[s] as number)
      for (let j = 0; j < n; j++) {
        if (codes[j] === want) {
          neighbours[6 * i + s] = j
          d++
          break
        }
      }
    }
    if (d === 0 || d > 2) return null
    if (d === 1 && start < 0) start = i
  }
  if (start < 0) return null // every degree is 2: a cycle
  const order: Cube[] = [cubes[start] as Cube]
  let prev = -1
  let cur = start
  let arms = 0
  let lastStep = -1
  for (;;) {
    let next = -1
    let step = -1
    for (let s = 0; s < 6; s++) {
      const j = neighbours[6 * cur + s] as number
      if (j >= 0 && j !== prev) {
        next = j
        step = s
      }
    }
    if (next < 0) break
    if (step !== lastStep) arms++
    lastStep = step
    prev = cur
    cur = next
    order.push(cubes[cur] as Cube)
  }
  return order.length === n ? { order, arms } : null
}

/** Arm count of a chain, or 0 if the shape is not a chain. */
export function armCount(cubes: readonly Cube[]): number {
  return chainInfo(cubes)?.arms ?? 0
}

/**
 * Every one-cube-moved variant of a shape (§4.2): remove a terminal cube (degree 1), then add a
 * cube at any free cell face-adjacent to the rest (not the removed cell), keeping those results
 * that are chains with ≥ {@link MIN_ARMS} arms. Brute force over all free neighbours; the list
 * may hold rotation-equivalent duplicates (callers dedupe by {@link chainKey} or {@link canonKey}).
 */
export function movedVariants(cubes: readonly Cube[]): Cube[][] {
  return movedVariantChains(cubes).map((v) => v.cubes)
}

/** {@link movedVariants} with each variant's {@link ChainInfo}. */
export function movedVariantChains(cubes: readonly Cube[]): { cubes: Cube[]; info: ChainInfo }[] {
  const out: { cubes: Cube[]; info: ChainInfo }[] = []
  const all = codeSet(cubes)
  const deg = degrees(cubes)
  for (let i = 0; i < cubes.length; i++) {
    if (deg[i] !== 1) continue
    const end = cubes[i] as Cube
    const endCode = cellCode(end[0], end[1], end[2])
    const rest = cubes.filter((_, j) => j !== i)
    const restDeg = degrees(rest)
    const restDegree = new Map(rest.map((c, j) => [cellCode(c[0], c[1], c[2]), restDeg[j] as number] as const))
    const tried = new Set<number>()
    for (const [x, y, z] of rest) {
      for (const [dx, dy, dz] of AXIS_STEPS) {
        const p: Cube = [x + dx, y + dy, z + dz]
        const code = cellCode(p[0], p[1], p[2])
        if (all.has(code) || tried.has(code)) continue // occupied, or the removed terminal cell itself
        tried.add(code)
        // Skip early what cannot be a chain: the new cube must touch exactly one cube, and that
        // cube must be an end of the rest (degree ≤ 1 there); chainInfo decides the survivors.
        let touching = 0
        let attach = -1
        for (const st of STEP_CODES) {
          if (code + st !== endCode && all.has(code + st)) {
            touching++
            attach = code + st
          }
        }
        if (touching !== 1 || (restDegree.get(attach) ?? 0) > 1) continue
        const candidate = [...rest, p]
        const info = chainInfo(candidate)
        if (info !== null && info.arms >= MIN_ARMS) out.push({ cubes: candidate, info })
      }
    }
  }
  return out
}

const stepIndex = (a: Cube, b: Cube): number => {
  const d0 = b[0] - a[0]
  const d1 = b[1] - a[1]
  const d2 = b[2] - a[2]
  return d0 !== 0 ? (d0 > 0 ? 0 : 1) : d1 !== 0 ? (d1 > 0 ? 2 : 3) : d2 > 0 ? 4 : 5
}

/** FRAME_DIGIT[a][b][s]: the step s expressed in the frame (a, b, a × b), as an AXIS_STEPS index (−1: b ∦ ⊥ a). */
const FRAME_DIGIT: readonly (readonly (readonly number[])[])[] = AXIS_STEPS.map((a) =>
  AXIS_STEPS.map((b) => {
    if (dot(a, b) !== 0) return AXIS_STEPS.map(() => -1)
    const c: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
    return AXIS_STEPS.map((v) => {
      const w: Vec3 = [dot(a, v), dot(b, v), dot(c, v)]
      return AXIS_STEPS.findIndex((u) => u[0] === w[0] && u[1] === w[1] && u[2] === w[2])
    })
  }),
)
/** PARALLEL[a][s]: step s is parallel (±) to step a. */
const PARALLEL: readonly (readonly boolean[])[] = AXIS_STEPS.map((a) => AXIS_STEPS.map((v) => dot(a, v) !== 0))

/** The step sequence (indices into AXIS_STEPS) re-expressed in the frame (s₁, b, s₁ × b), b = first step ∦ s₁. */
function frameCode(steps: readonly number[]): string {
  const a = steps[0] as number
  const b = steps.find((st) => !(PARALLEL[a] as readonly boolean[])[st])
  if (b === undefined) return `line${steps.length}`
  const table = (FRAME_DIGIT[a] as readonly (readonly number[])[])[b] as readonly number[]
  let out = ''
  for (const st of steps) out += table[st] as number
  return out
}

/**
 * A complete invariant of chains under the 24 rotations plus translation: the lesser of the two
 * reading directions' {@link frameCode}s. Two chains are rotation-equivalent iff their chain keys
 * are equal (the frame (s₁, b, s₁ × b) is carried along by any proper rotation, and a rotation
 * mapping one chain onto another maps ends to ends). Equal to comparing {@link canonKey}s, in O(n).
 */
export function chainKeyOf(info: ChainInfo): string {
  const o = info.order
  const fwd: number[] = []
  const rev: number[] = []
  for (let i = 1; i < o.length; i++) fwd.push(stepIndex(o[i - 1] as Cube, o[i] as Cube))
  for (let i = o.length - 1; i > 0; i--) rev.push(stepIndex(o[i] as Cube, o[i - 1] as Cube))
  const f = frameCode(fwd)
  const r = frameCode(rev)
  return f <= r ? f : r
}

/** {@link chainKeyOf} of a shape, or null if it is not a chain. */
export function chainKey(cubes: readonly Cube[]): string | null {
  const info = chainInfo(cubes)
  return info === null ? null : chainKeyOf(info)
}

// --- quaternions ------------------------------------------------------------------------------

/** Hamilton product a ⊗ b (apply b, then a). */
export function quatMul(a: Quat, b: Quat): Quat {
  const [aw, ax, ay, az] = a
  const [bw, bx, by, bz] = b
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ]
}

export function quatConj(q: Quat): Quat {
  return [q[0], 0 - q[1], 0 - q[2], 0 - q[3]]
}

export function quatNorm(q: Quat): number {
  return Math.hypot(q[0], q[1], q[2], q[3])
}

/** q / |q| with w ≥ 0 (q and −q are the same rotation; the sign is fixed for tidy specs). */
export function quatNormalize(q: Quat): Quat {
  const n = quatNorm(q)
  if (!(n > 0 && Number.isFinite(n))) throw new RangeError('cannot normalise a zero or non-finite quaternion')
  const s = q[0] < 0 ? -1 / n : 1 / n
  return [q[0] * s, q[1] * s, q[2] * s, q[3] * s]
}

/** Rotation by `angleDeg` degrees about the unit `axis`. */
export function quatFromAxisAngle(axis: Vec3, angleDeg: number): Quat {
  const h = (angleDeg * Math.PI) / 360
  const s = Math.sin(h)
  return [Math.cos(h), axis[0] * s, axis[1] * s, axis[2] * s]
}

/** Quaternion of a proper rotation matrix (Shepperd's method, stable for every rotation). */
export function quatFromMat3(m: Mat3): Quat {
  const [[m00, m01, m02], [m10, m11, m12], [m20, m21, m22]] = m
  const tr = m00 + m11 + m22
  let q: Quat
  if (tr >= m00 && tr >= m11 && tr >= m22) {
    const s = 2 * Math.sqrt(1 + tr)
    q = [s / 4, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s]
  } else if (m00 >= m11 && m00 >= m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22)
    q = [(m21 - m12) / s, s / 4, (m01 + m10) / s, (m02 + m20) / s]
  } else if (m11 >= m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22)
    q = [(m02 - m20) / s, (m01 + m10) / s, s / 4, (m12 + m21) / s]
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11)
    q = [(m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, s / 4]
  }
  return quatNormalize(q)
}

/** Rotation matrix of a unit quaternion. */
export function mat3FromQuat(q: Quat): Mat3 {
  const [w, x, y, z] = q
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ]
}

/** Rotation angle of a unit quaternion in degrees, in [0, 180]. */
export function quatAngleDeg(q: Quat): number {
  return (2 * Math.atan2(Math.hypot(q[1], q[2], q[3]), Math.abs(q[0])) * 180) / Math.PI
}

/** Unit rotation axis of a quaternion (sign arbitrary); throws for the identity. */
export function quatAxis(q: Quat): Vec3 {
  const s = Math.hypot(q[1], q[2], q[3])
  if (!(s > 0)) throw new RangeError('the identity rotation has no axis')
  return [q[1] / s, q[2] / s, q[3] / s]
}

/** A uniformly random rotation (Shoemake 1992, three uniforms). */
export function randomQuat(rng: Rng): Quat {
  const u1 = rng.next()
  const u2 = rng.next()
  const u3 = rng.next()
  const a = Math.sqrt(1 - u1)
  const b = Math.sqrt(u1)
  const t2 = 2 * Math.PI * u2
  const t3 = 2 * Math.PI * u3
  return quatNormalize([b * Math.cos(t3), a * Math.sin(t2), a * Math.cos(t2), b * Math.sin(t3)])
}

/** A uniformly random unit vector (Archimedes: z uniform in [−1, 1], azimuth uniform). */
export function randomUnitVector(rng: Rng): Vec3 {
  const z = 2 * rng.next() - 1
  const phi = 2 * Math.PI * rng.next()
  const r = Math.sqrt(Math.max(0, 1 - z * z))
  return [r * Math.cos(phi), r * Math.sin(phi), z]
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
