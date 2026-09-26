import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  cholesky,
  choleskyInverse,
  choleskyLogDet,
  choleskySolve,
  identity,
  inverse,
  isPositiveDefinite,
  isSymmetric,
  matmul,
  matvec,
  maxAbsDiff,
  NotPositiveDefiniteError,
  SingularMatrixError,
  solve,
  spdInverse,
  spdSolve,
  symmetricEigen,
  symmetrize,
  transpose,
  tryCholesky,
  zeros,
  type Matrix,
} from './linalg'

/** Random SPD matrix B·Bᵀ + n·δ·I from a generated square B. */
const spdArb = (maxN = 17) =>
  fc
    .integer({ min: 1, max: maxN })
    .chain((n) =>
      fc.array(fc.array(fc.double({ min: -2, max: 2, noNaN: true }), { minLength: n, maxLength: n }), {
        minLength: n,
        maxLength: n,
      }),
    )
    .map((B) => {
      const A = matmul(B, transpose(B))
      return A.map((row, i) => row.map((v, j) => (i === j ? v + 0.5 : v)))
    })

const diagOf = (values: number[]): Matrix => values.map((v, i) => values.map((_, j) => (i === j ? v : 0)))

describe('basic helpers', () => {
  it('matmul / matvec / transpose on known matrices', () => {
    const A = [
      [1, 2, 3],
      [4, 5, 6],
    ]
    const B = [
      [7, 8],
      [9, 10],
      [11, 12],
    ]
    expect(matmul(A, B)).toEqual([
      [58, 64],
      [139, 154],
    ])
    expect(matvec(A, [1, 0, -1])).toEqual([-2, -2])
    expect(transpose(A)).toEqual([
      [1, 4],
      [2, 5],
      [3, 6],
    ])
    expect(() => matmul(A, A)).toThrow(RangeError)
    expect(identity(2)).toEqual([
      [1, 0],
      [0, 1],
    ])
    expect(zeros(2, 3)).toEqual([
      [0, 0, 0],
      [0, 0, 0],
    ])
  })

  it('symmetrize, isSymmetric, maxAbsDiff', () => {
    const A = [
      [1, 2],
      [4, 3],
    ]
    expect(isSymmetric(A)).toBe(false)
    expect(symmetrize(A)).toEqual([
      [1, 3],
      [3, 3],
    ])
    expect(isSymmetric(symmetrize(A))).toBe(true)
    expect(maxAbsDiff(A, symmetrize(A))).toBe(1)
    expect(maxAbsDiff(A, [[1, 2]])).toBe(Infinity)
  })
})

describe('Cholesky', () => {
  // Classic example with an integer factor.
  const A = [
    [4, 12, -16],
    [12, 37, -43],
    [-16, -43, 98],
  ]
  const L = [
    [2, 0, 0],
    [6, 1, 0],
    [-8, 5, 3],
  ]

  it('factors a known SPD matrix', () => {
    expect(cholesky(A)).toEqual(L)
    expect(choleskyLogDet(L)).toBeCloseTo(Math.log(36), 12)
    expect(choleskySolve(L, [1, 2, 3])).toEqual(solve(A, [1, 2, 3]).map((v) => expect.closeTo(v, 10)))
  })

  it('rejects non-PD and non-square matrices', () => {
    const indefinite = [
      [1, 2],
      [2, 1],
    ]
    expect(() => cholesky(indefinite)).toThrow(NotPositiveDefiniteError)
    expect(tryCholesky(indefinite)).toBeNull()
    expect(isPositiveDefinite(indefinite)).toBe(false)
    expect(isPositiveDefinite([[1, 0.5], [0.4, 1]])).toBe(false) // not symmetric
    expect(isPositiveDefinite(A)).toBe(true)
    expect(() => cholesky([[1, 2]])).toThrow(RangeError)
    expect(() => cholesky([[Number.NaN]])).toThrow(NotPositiveDefiniteError)
  })

  it('L·Lᵀ reconstructs random SPD matrices', () => {
    fc.assert(
      fc.property(spdArb(), (S) => {
        const F = cholesky(S)
        expect(maxAbsDiff(matmul(F, transpose(F)), S)).toBeLessThan(1e-9)
      }),
    )
  })
})

describe('solve and inverse', () => {
  it('solves a known general system (needs pivoting)', () => {
    const A = [
      [0, 2, 1],
      [1, 1, 1],
      [2, 1, 0],
    ]
    const x = solve(A, [5, 4, 4])
    expect(maxAbsDiff([x], [[1, 2, 1]])).toBeLessThan(1e-12)
    expect(maxAbsDiff(matmul(A, inverse(A)), identity(3))).toBeLessThan(1e-12)
  })

  it('inverts a known matrix exactly', () => {
    expect(
      maxAbsDiff(
        inverse([
          [4, 7],
          [2, 6],
        ]),
        [
          [0.6, -0.7],
          [-0.2, 0.4],
        ],
      ),
    ).toBeLessThan(1e-15)
  })

  it('throws on singular matrices', () => {
    const S = [
      [1, 2],
      [2, 4],
    ]
    expect(() => inverse(S)).toThrow(SingularMatrixError)
    expect(() => solve(S, [1, 1])).toThrow(SingularMatrixError)
    expect(() => inverse(zeros(3))).toThrow(SingularMatrixError)
  })

  it('A·A⁻¹ ≈ I for random SPD (general and Cholesky paths)', () => {
    fc.assert(
      fc.property(spdArb(), (S) => {
        const n = S.length
        const I = identity(n)
        expect(maxAbsDiff(matmul(S, inverse(S)), I)).toBeLessThan(1e-7)
        const Si = spdInverse(S)
        expect(isSymmetric(Si)).toBe(true)
        expect(maxAbsDiff(matmul(S, Si), I)).toBeLessThan(1e-7)
        expect(maxAbsDiff(choleskyInverse(cholesky(S)), Si)).toBe(0)
      }),
    )
  })

  it('solve and spdSolve agree and satisfy A·x = b', () => {
    fc.assert(
      fc.property(
        spdArb().chain((S) =>
          fc.tuple(
            fc.constant(S),
            fc.array(fc.double({ min: -5, max: 5, noNaN: true }), { minLength: S.length, maxLength: S.length }),
          ),
        ),
        ([S, b]) => {
          const x1 = solve(S, b)
          const x2 = spdSolve(S, b)
          expect(maxAbsDiff([matvec(S, x1)], [b])).toBeLessThan(1e-7)
          expect(maxAbsDiff([x1], [x2])).toBeLessThan(1e-6)
        },
      ),
    )
  })
})

describe('Jacobi eigen-decomposition', () => {
  it('diagonalises a known 2×2 matrix', () => {
    const { values, vectors } = symmetricEigen([
      [2, 1],
      [1, 2],
    ])
    expect(values[0]).toBeCloseTo(1, 14)
    expect(values[1]).toBeCloseTo(3, 14)
    const v1 = vectors.map((row) => row[1]!)
    expect(Math.abs(v1[0]!)).toBeCloseTo(Math.SQRT1_2, 14)
    expect(v1[0]! * v1[1]!).toBeGreaterThan(0)
  })

  it('returns a diagonal matrix sorted, and handles 1×1 and zero matrices', () => {
    expect(symmetricEigen(diagOf([3, -1, 2])).values).toEqual([-1, 2, 3])
    expect(symmetricEigen([[5]])).toEqual({ values: [5], vectors: [[1]] })
    expect(symmetricEigen(zeros(3)).values).toEqual([0, 0, 0])
  })

  it('known eigenvalues of the tridiagonal (−1, 2, −1) matrix', () => {
    const n = 8
    const T = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? 2 : Math.abs(i - j) === 1 ? -1 : 0)),
    )
    const expected = Array.from({ length: n }, (_, k) => 2 - 2 * Math.cos(((k + 1) * Math.PI) / (n + 1)))
    expect(maxAbsDiff([symmetricEigen(T).values], [expected])).toBeLessThan(1e-13)
  })

  it('V·diag(w)·Vᵀ = A with orthonormal V, for random symmetric matrices', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 17 }).chain((n) =>
          fc.array(fc.array(fc.double({ min: -10, max: 10, noNaN: true }), { minLength: n, maxLength: n }), {
            minLength: n,
            maxLength: n,
          }),
        ),
        (B) => {
          const A = symmetrize(B)
          const n = A.length
          const { values, vectors: V } = symmetricEigen(A)
          for (let k = 1; k < n; k++) expect(values[k]!).toBeGreaterThanOrEqual(values[k - 1]!)
          expect(maxAbsDiff(matmul(transpose(V), V), identity(n))).toBeLessThan(1e-12)
          expect(maxAbsDiff(matmul(matmul(V, diagOf(values)), transpose(V)), A)).toBeLessThan(1e-10)
          const trace = A.reduce((s, row, i) => s + row[i]!, 0)
          expect(values.reduce((s, v) => s + v, 0)).toBeCloseTo(trace, 9)
        },
      ),
    )
  })
})
