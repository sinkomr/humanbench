/**
 * Small dense linear algebra for the scorer (DESIGN §7.2: K ≤ 17, so plain O(n³) loops on
 * `number[][]` take microseconds). Matrices are arrays of rows. Nothing here mutates its inputs.
 */

export type Vector = number[]
export type Matrix = number[][]

const EPS = Number.EPSILON

/** Thrown by {@link cholesky} when the matrix is not (numerically) positive definite. */
export class NotPositiveDefiniteError extends Error {
  constructor(message = 'matrix is not positive definite') {
    super(message)
    this.name = 'NotPositiveDefiniteError'
  }
}

/** Thrown by {@link solve} and {@link inverse} when the matrix is (numerically) singular. */
export class SingularMatrixError extends Error {
  constructor(message = 'matrix is singular') {
    super(message)
    this.name = 'SingularMatrixError'
  }
}

function assertSquare(A: Matrix, fn: string): number {
  const n = A.length
  for (const row of A) {
    if (row.length !== n) throw new RangeError(`${fn}: matrix must be square, got ${n}×${row.length}`)
  }
  return n
}

/** n×m matrix of zeros (m defaults to n). */
export function zeros(n: number, m = n): Matrix {
  return Array.from({ length: n }, () => new Array<number>(m).fill(0))
}

/** n×n identity matrix. */
export function identity(n: number): Matrix {
  const I = zeros(n)
  for (let i = 0; i < n; i++) I[i]![i] = 1
  return I
}

/** Deep copy. */
export function clone(A: Matrix): Matrix {
  return A.map((row) => row.slice())
}

/** Aᵀ. */
export function transpose(A: Matrix): Matrix {
  const n = A.length
  const m = A[0]?.length ?? 0
  const T = zeros(m, n)
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) T[j]![i] = A[i]![j]!
  return T
}

/** (A + Aᵀ)/2 for a square matrix. */
export function symmetrize(A: Matrix): Matrix {
  const n = assertSquare(A, 'symmetrize')
  const S = zeros(n)
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) S[i]![j] = (A[i]![j]! + A[j]![i]!) / 2
  return S
}

/** A·B. */
export function matmul(A: Matrix, B: Matrix): Matrix {
  const n = A.length
  const inner = B.length
  const m = B[0]?.length ?? 0
  const C = zeros(n, m)
  for (let i = 0; i < n; i++) {
    const Ai = A[i]!
    if (Ai.length !== inner) throw new RangeError(`matmul: ${Ai.length} columns vs ${inner} rows`)
    const Ci = C[i]!
    for (let k = 0; k < inner; k++) {
      const aik = Ai[k]!
      const Bk = B[k]!
      for (let j = 0; j < m; j++) Ci[j] = Ci[j]! + aik * Bk[j]!
    }
  }
  return C
}

/** A·x. */
export function matvec(A: Matrix, x: Vector): Vector {
  return A.map((row) => {
    if (row.length !== x.length) throw new RangeError(`matvec: ${row.length} columns vs ${x.length}`)
    let s = 0
    for (let j = 0; j < row.length; j++) s += row[j]! * x[j]!
    return s
  })
}

/** Largest absolute element-wise difference; Infinity if the shapes differ. */
export function maxAbsDiff(A: Matrix, B: Matrix): number {
  if (A.length !== B.length) return Infinity
  let d = 0
  for (let i = 0; i < A.length; i++) {
    const Ai = A[i]!
    const Bi = B[i]!
    if (Ai.length !== Bi.length) return Infinity
    for (let j = 0; j < Ai.length; j++) d = Math.max(d, Math.abs(Ai[j]! - Bi[j]!))
  }
  return d
}

/** True if A is square and |A_ij − A_ji| ≤ tol for all i, j. */
export function isSymmetric(A: Matrix, tol = 0): boolean {
  const n = A.length
  if (A.some((row) => row.length !== n)) return false
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) if (!(Math.abs(A[i]![j]! - A[j]![i]!) <= tol)) return false
  }
  return true
}

// ------------------------------------------------------------------------------- Cholesky

/**
 * Lower-triangular L with A = L·Lᵀ. Reads only the lower triangle of A (A is assumed
 * symmetric). Throws {@link NotPositiveDefiniteError} if a pivot is not strictly positive.
 */
export function cholesky(A: Matrix): Matrix {
  const n = assertSquare(A, 'cholesky')
  const L = zeros(n)
  for (let j = 0; j < n; j++) {
    const Lj = L[j]!
    let d = A[j]![j]!
    for (let k = 0; k < j; k++) d -= Lj[k]! * Lj[k]!
    if (!(d > 0) || !Number.isFinite(d)) {
      throw new NotPositiveDefiniteError(`matrix is not positive definite (pivot ${j} = ${d})`)
    }
    const ljj = Math.sqrt(d)
    Lj[j] = ljj
    for (let i = j + 1; i < n; i++) {
      const Li = L[i]!
      let s = A[i]![j]!
      for (let k = 0; k < j; k++) s -= Li[k]! * Lj[k]!
      Li[j] = s / ljj
    }
  }
  return L
}

/** {@link cholesky}, or null if A is not positive definite. */
export function tryCholesky(A: Matrix): Matrix | null {
  try {
    return cholesky(A)
  } catch (e) {
    if (e instanceof NotPositiveDefiniteError) return null
    throw e
  }
}

/** True if A is square, symmetric (to `tol`) and its Cholesky factorisation succeeds. */
export function isPositiveDefinite(A: Matrix, tol = 1e-12): boolean {
  return isSymmetric(A, tol) && tryCholesky(A) !== null
}

/** Solve (L·Lᵀ)·x = b given the Cholesky factor L. */
export function choleskySolve(L: Matrix, b: Vector): Vector {
  const n = L.length
  if (b.length !== n) throw new RangeError(`choleskySolve: ${n}×${n} vs vector of ${b.length}`)
  const y = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i++) {
    const Li = L[i]!
    let s = b[i]!
    for (let k = 0; k < i; k++) s -= Li[k]! * y[k]!
    y[i] = s / Li[i]!
  }
  const x = new Array<number>(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i]!
    for (let k = i + 1; k < n; k++) s -= L[k]![i]! * x[k]!
    x[i] = s / L[i]![i]!
  }
  return x
}

/** (L·Lᵀ)⁻¹ given the Cholesky factor L; exactly symmetric. */
export function choleskyInverse(L: Matrix): Matrix {
  const n = L.length
  const cols = Array.from({ length: n }, (_, j) => {
    const e = new Array<number>(n).fill(0)
    e[j] = 1
    return choleskySolve(L, e)
  })
  const inv = zeros(n)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      const v = (cols[j]![i]! + cols[i]![j]!) / 2
      inv[i]![j] = v
      inv[j]![i] = v
    }
  }
  return inv
}

/** log|L·Lᵀ| = 2·Σ log L_ii. */
export function choleskyLogDet(L: Matrix): number {
  let s = 0
  for (let i = 0; i < L.length; i++) s += Math.log(L[i]![i]!)
  return 2 * s
}

/** Solve A·x = b for symmetric positive-definite A (via Cholesky). */
export function spdSolve(A: Matrix, b: Vector): Vector {
  return choleskySolve(cholesky(A), b)
}

/** A⁻¹ for symmetric positive-definite A (via Cholesky); exactly symmetric. */
export function spdInverse(A: Matrix): Matrix {
  return choleskyInverse(cholesky(A))
}

// -------------------------------------------------------------------- general square solve

/** Threshold below which a pivot counts as zero, relative to the largest |A_ij|. */
function singularTol(A: Matrix): number {
  let scale = 0
  for (const row of A) for (const v of row) scale = Math.max(scale, Math.abs(v))
  return EPS * A.length * scale
}

/**
 * Gauss–Jordan elimination with partial pivoting on [A | B]; returns X with A·X = B.
 * Throws {@link SingularMatrixError} on a (numerically) zero pivot.
 */
function gaussJordan(A: Matrix, B: Matrix, fn: string): Matrix {
  const n = assertSquare(A, fn)
  if (B.length !== n) throw new RangeError(`${fn}: ${n}×${n} vs right-hand side of ${B.length} rows`)
  const tol = singularTol(A)
  const M = clone(A)
  const X = clone(B)
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r
    const p = M[piv]![col]!
    if (!(Math.abs(p) > tol) || !Number.isFinite(p)) {
      throw new SingularMatrixError(`${fn}: matrix is singular (pivot ${col})`)
    }
    if (piv !== col) {
      ;[M[col], M[piv]] = [M[piv]!, M[col]!]
      ;[X[col], X[piv]] = [X[piv]!, X[col]!]
    }
    const Mc = M[col]!
    const Xc = X[col]!
    for (let j = 0; j < n; j++) Mc[j] = Mc[j]! / p
    for (let j = 0; j < Xc.length; j++) Xc[j] = Xc[j]! / p
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const Mr = M[r]!
      const f = Mr[col]!
      if (f === 0) continue
      const Xr = X[r]!
      for (let j = 0; j < n; j++) Mr[j] = Mr[j]! - f * Mc[j]!
      for (let j = 0; j < Xr.length; j++) Xr[j] = Xr[j]! - f * Xc[j]!
    }
  }
  return X
}

/** Solve A·x = b for a general square A (partial pivoting). */
export function solve(A: Matrix, b: Vector): Vector {
  return gaussJordan(
    A,
    b.map((v) => [v]),
    'solve',
  ).map((row) => row[0]!)
}

/** A⁻¹ for a general square A (Gauss–Jordan, partial pivoting). */
export function inverse(A: Matrix): Matrix {
  return gaussJordan(A, identity(A.length), 'inverse')
}

// --------------------------------------------------------------------------- Jacobi eigen

export interface EigenDecomposition {
  /** Eigenvalues in ascending order. */
  values: Vector
  /** Orthonormal eigenvectors as columns: vectors[i][k] is component i of eigenvector k. */
  vectors: Matrix
}

/**
 * Eigen-decomposition of a symmetric matrix by the cyclic Jacobi method (rotation formulas as
 * in Numerical Recipes §11.1). The input is symmetrised first. Iterates until the off-diagonal
 * Frobenius norm is ≤ 1e-14 × ‖A‖_F (quadratic convergence: ~6–10 sweeps for n = 17).
 */
export function symmetricEigen(A: Matrix, maxSweeps = 100): EigenDecomposition {
  const n = assertSquare(A, 'symmetricEigen')
  const a = symmetrize(A)
  const v = identity(n)
  let norm2 = 0
  for (const row of a) for (const x of row) norm2 += x * x
  const target = 1e-14 * Math.sqrt(norm2)

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off2 = 0
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off2 += a[p]![q]! ** 2
    if (Math.sqrt(off2) <= target) break

    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p]![q]!
        if (apq === 0) continue
        const theta = (a[q]![q]! - a[p]![p]!) / (2 * apq)
        // t = tan of the rotation angle: the smaller root of t² + 2θt − 1 = 0.
        const t =
          Math.abs(theta) > 1e150
            ? 1 / (2 * theta)
            : Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        // A ← Pᵀ·A·P with P the (p, q) rotation; columns first, then rows.
        for (let k = 0; k < n; k++) {
          const ak = a[k]!
          const akp = ak[p]!
          const akq = ak[q]!
          ak[p] = c * akp - s * akq
          ak[q] = s * akp + c * akq
        }
        const ap = a[p]!
        const aq = a[q]!
        for (let k = 0; k < n; k++) {
          const apk = ap[k]!
          const aqk = aq[k]!
          ap[k] = c * apk - s * aqk
          aq[k] = s * apk + c * aqk
        }
        ap[q] = 0
        aq[p] = 0
        for (let k = 0; k < n; k++) {
          const vk = v[k]!
          const vkp = vk[p]!
          const vkq = vk[q]!
          vk[p] = c * vkp - s * vkq
          vk[q] = s * vkp + c * vkq
        }
      }
    }
  }

  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => a[i]![i]! - a[j]![j]!)
  return {
    values: order.map((i) => a[i]![i]!),
    vectors: v.map((row) => order.map((k) => row[k]!)),
  }
}
