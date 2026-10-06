/**
 * Small vector helpers for the Alternative Uses Task scoring core (ROADMAP M6.4; DESIGN §5.4). They
 * work on embedding vectors only (`Float32Array` from the embedder, or plain number arrays in tests)
 * and never import the embedder, Svelte or the DOM.
 *
 * Sums are accumulated in float64 (JS numbers) whatever the input type, so a Float32Array and the
 * same values as a number[] give the same result. `norm`, `normalise` and `cosine` first divide by the
 * largest absolute component, so squares neither underflow (components near 1e-160) nor overflow
 * (near 1e160): any finite non-zero vector has a direction, and cosine is scale-invariant.
 */

/** An embedding vector: what the embedder returns, or a plain array in tests. */
export type Vec = Float32Array | readonly number[]

function checkSameLength(a: Vec, b: Vec): void {
  if (a.length !== b.length) throw new RangeError(`vectors differ in length: ${a.length} vs ${b.length}`)
}

/** a · b. Throws a RangeError when the lengths differ. */
export function dot(a: Vec, b: Vec): number {
  checkSameLength(a, b)
  let s = 0
  for (let i = 0; i < a.length; i++) s += (a[i] as number) * (b[i] as number)
  return s
}

/** The largest |component| of a: NaN if any component is NaN, 0 for an empty or zero vector. */
function maxAbs(a: Vec): number {
  let m = 0
  for (let i = 0; i < a.length; i++) {
    const x = Math.abs(a[i] as number)
    if (Number.isNaN(x)) return Number.NaN
    if (x > m) m = x
  }
  return m
}

/** Σ (a_i / s)², for a finite scale s > 0. */
function scaledSquares(a: Vec, s: number): number {
  let q = 0
  for (let i = 0; i < a.length; i++) {
    const x = (a[i] as number) / s
    q += x * x
  }
  return q
}

/** The Euclidean length of a: NaN if a component is NaN, Infinity if one is infinite. */
export function norm(a: Vec): number {
  const m = maxAbs(a)
  if (!(m > 0) || !Number.isFinite(m)) return m
  return m * Math.sqrt(scaledSquares(a, m))
}

/**
 * a scaled to unit length, as a new Float32Array. A vector with no direction (all zeros, or a NaN
 * or infinite component) comes back as zeros, which every cosine treats as 0.
 */
export function normalise(a: Vec): Float32Array {
  const out = new Float32Array(a.length)
  const m = maxAbs(a)
  if (!(m > 0) || !Number.isFinite(m)) return out
  const n = Math.sqrt(scaledSquares(a, m))
  for (let i = 0; i < a.length; i++) out[i] = (a[i] as number) / m / n
  return out
}

/**
 * The cosine of the angle between a and b, clamped to [−1, 1] (float rounding can step just past
 * ±1). It is 0 when either vector has no direction (all zeros, or a NaN or infinite component), so
 * it is never NaN. Throws a RangeError when the lengths differ.
 */
export function cosine(a: Vec, b: Vec): number {
  checkSameLength(a, b)
  const ma = maxAbs(a)
  const mb = maxAbs(b)
  if (!(ma > 0 && mb > 0 && Number.isFinite(ma) && Number.isFinite(mb))) return 0
  let d = 0
  let qa = 0
  let qb = 0
  for (let i = 0; i < a.length; i++) {
    const x = (a[i] as number) / ma
    const y = (b[i] as number) / mb
    d += x * y
    qa += x * x
    qb += y * y
  }
  const c = d / Math.sqrt(qa * qb)
  if (!Number.isFinite(c)) return 0
  return c > 1 ? 1 : c < -1 ? -1 : c
}

/** Whether every component of a is a finite number. */
export function isFiniteVec(a: Vec): boolean {
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i] as number)) return false
  return true
}
