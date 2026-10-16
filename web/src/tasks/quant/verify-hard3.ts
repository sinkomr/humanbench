/**
 * The verifier's checks of hard quant table 3 (`hard3.ts`; generator 1.4.0, ROADMAP M3.12). Each
 * rule is the spec's, written here again (not imported from the generator), and each answer is
 * reached by a route of its own, in exact BigInt {@link Fraction} arithmetic:
 *
 * - triangles by coordinates (B = (0, 0), C = (a, 0), A from the two distances; the circumcentre,
 *   the foot of the bisector, the altitude), with exact rational square roots;
 * - the cone's inscribed sphere from the distance of the centre to the slant line;
 * - tan C from the product of the direction vectors (q, p) and (t, s) of the angles A and B;
 * - sin² sums by pairing k° with (90 − k)°; x⁴ + y⁴ + z⁴ as the trace of the 4th power of the
 *   cubic's companion matrix; the remainder and the functional equation by elimination;
 * - counts by enumeration (the pairs (x, y), the lattice points), the gcd of the two big
 *   integers, and the tower by computing b^c exactly and square-and-multiply.
 */

import { Fraction, bigGcd, exactRoot } from './fraction'
import { num, type Given } from './kit'
import { f, gcd, type Check } from './verify-kit'

const isSquare = (n: bigint): boolean => n >= 0n && exactRoot(n, 2) !== null

/** The exact rational square root of x ≥ 0, or null. */
function ratSqrt(x: Fraction): Fraction | null {
  if (x.sign() < 0) return null
  const n = exactRoot(x.n, 2)
  const d = exactRoot(x.d, 2)
  return n === null || d === null ? null : Fraction.of(n, d)
}

/** A = (x, y²) with B = (0, 0), C = (a, 0), |AB| = c, |AC| = b; throws unless a proper triangle. */
function apex(a: number, b: number, c: number): { x: Fraction; y2: Fraction } {
  const x = f(a * a + c * c - b * b, 2 * a)
  const y2 = f(c * c).sub(x.mul(x))
  if (y2.sign() <= 0) throw new RangeError('not a triangle')
  return { x, y2 }
}

/** a·x + b·y = e, c·x + d·y = h by elimination; throws if singular. */
function solve2(a: Fraction, b: Fraction, e: Fraction, c: Fraction, d: Fraction, h: Fraction): [Fraction, Fraction] {
  const det = a.mul(d).sub(b.mul(c))
  if (det.isZero()) throw new RangeError('singular system')
  return [e.mul(d).sub(b.mul(h)).div(det), a.mul(h).sub(e.mul(c)).div(det)]
}

/** BigInt base^exp mod m. */
function powModBig(base: bigint, exp: bigint, m: bigint): bigint {
  let r = 1n
  let b = base % m
  let e = exp
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m
    b = (b * b) % m
    e >>= 1n
  }
  return r
}

/** The lattice points of x² + y² = n by trying every x. */
function latticePoints(n: number): number {
  let count = 0
  for (let x = 0; x * x <= n; x++) {
    const y = exactRoot(BigInt(n - x * x), 2)
    if (y === null) continue
    count += (x === 0 ? 1 : 2) * (y === 0n ? 1 : 2)
  }
  return count
}

/** 3×3 BigInt matrix product. */
function matMul(A: bigint[][], B: bigint[][]): bigint[][] {
  return A.map((row) => B[0]!.map((_, j) => row.reduce((s, v, k) => s + v * (B[k]![j] as bigint), 0n)))
}

function heronRules(g: Given): Record<string, boolean> {
  const [a, b, c] = [num(g, 'a'), num(g, 'b'), num(g, 'c')]
  const P = BigInt(a + b + c) * BigInt(-a + b + c) * BigInt(a - b + c) * BigInt(a + b - c)
  const root = P > 0n ? exactRoot(P, 2) : null
  return {
    ordered: a <= b && b <= c,
    triangle: a + b > c,
    scalene: a < b && b < c,
    not_right: a * a + b * b !== c * c,
    integer_area: root !== null && root % 4n === 0n,
  }
}

export const CHECKS_HARD3: Readonly<Record<string, Check>> = {
  'triangle/circumradius': {
    rules: heronRules,
    solve(g) {
      const [a, b, c] = [num(g, 'a'), num(g, 'b'), num(g, 'c')]
      const { x, y2 } = apex(a, b, c)
      const y = ratSqrt(y2)
      if (y === null) throw new RangeError('apex not rational')
      // O = (a/2, y0) with |OB| = |OA|: x² + y² − a·x = 2·y·y0
      const y0 = x.mul(x).add(y2).sub(f(a).mul(x)).div(f(2).mul(y))
      const R = ratSqrt(f(a, 2).pow(2).add(y0.mul(y0)))
      if (R === null) throw new RangeError('circumradius not rational')
      return R
    },
  },
  'triangle/bisector': {
    rules(g) {
      const [a, b, c] = [num(g, 'a'), num(g, 'b'), num(g, 'c')]
      return { triangle: a < b + c && b < a + c && c < a + b, not_isosceles: b !== c }
    },
    solve(g) {
      const [a, b, c] = [num(g, 'a'), num(g, 'b'), num(g, 'c')]
      const { x, y2 } = apex(a, b, c)
      const bd = f(a * c, b + c) // the bisector splits BC in the ratio c : b
      return x.sub(bd).pow(2).add(y2)
    },
  },
  'tangent_circles/centres': {
    rules(g) {
      const [a, b, c] = [num(g, 'a'), num(g, 'b'), num(g, 'c')]
      return { ordered: a <= b && b <= c, not_all_equal: a < c, integer_area: isSquare(BigInt(a + b + c) * BigInt(a * b * c)) }
    },
    solve(g) {
      const [a, b, c] = [num(g, 'a'), num(g, 'b'), num(g, 'c')]
      // centres P (radius a), Q (b), R (c): |PQ| = a + b on the x-axis, R from |PR| = a + c, |QR| = b + c
      const { y2 } = apex(a + b, b + c, a + c)
      const h = ratSqrt(y2)
      if (h === null) throw new RangeError('height not rational')
      return f(a + b).mul(h).div(f(2))
    },
  },
  'inscribed_sphere/cone': {
    rules: (g) => ({ integer_slant: isSquare(BigInt(num(g, 'r') ** 2 + num(g, 'h') ** 2)) }),
    solve(g) {
      const [r, h] = [num(g, 'r'), num(g, 'h')]
      const l = exactRoot(BigInt(r * r + h * h), 2)
      if (l === null) throw new RangeError('slant not an integer')
      // slant line h·X + r·Y − r·h = 0; centre (0, ρ) below it: distance r·(h − ρ)/l = ρ,
      // i.e. (1 + r/l)·ρ = r·h/l
      const L = Fraction.of(l)
      const rho = f(r * h).div(L).div(f(1).add(f(r).div(L)))
      if (rho.sign() <= 0 || rho.cmp(f(h)) >= 0) throw new RangeError('sphere outside the cone')
      return rho
    },
  },
  'tan_triangle/third': {
    rules(g) {
      const [p, q, s, t] = [num(g, 'p'), num(g, 'q'), num(g, 's'), num(g, 't')]
      return { reduced: gcd(p, q) === 1 && gcd(s, t) === 1, not_right: p * s !== q * t, distinct: p * t !== q * s }
    },
    solve(g) {
      const [p, q, s, t] = [num(g, 'p'), num(g, 'q'), num(g, 's'), num(g, 't')]
      // direction of A + B: (q + ip)(t + is); C = 180° − (A + B) has direction (−Re, Im)
      const re = q * t - p * s
      const im = q * s + p * t
      if (re === 0 || im <= 0) throw new RangeError('no tangent of C')
      return f(im, -re)
    },
  },
  'sin_squares/sum': {
    rules(g) {
      const [first, step] = [num(g, 'first'), num(g, 'step')]
      return { symmetric_steps: (90 - 2 * first) % step === 0, several_terms: 90 - 2 * first >= 4 * step }
    },
    solve(g) {
      const [first, step] = [num(g, 'first'), num(g, 'step')]
      const terms: number[] = []
      for (let k = first; k <= 90 - first; k += step) terms.push(k)
      if (terms[terms.length - 1] !== 90 - first) throw new RangeError('the terms do not end at 90° − first')
      const set = new Set(terms)
      let total = Fraction.ZERO
      for (const k of terms) {
        if (!set.has(90 - k)) throw new RangeError('unpaired term')
        if (k === 45) total = total.add(f(1, 2)) // sin² 45° = 1/2
        else if (k < 45) total = total.add(Fraction.ONE) // sin² k° + sin² (90 − k)° = 1
      }
      return total
    },
  },
  'newton/power4': {
    rules(g) {
      const [p, q, r] = [num(g, 'p'), num(g, 'q'), num(g, 'r')]
      const [P, Q, R] = [BigInt(p), BigInt(q), BigInt(r)]
      // discriminant of t³ + B t² + C t + D with B = −p, C = q, D = −r
      const [B, C, D] = [-P, Q, -R]
      const disc = 18n * B * C * D - 4n * B ** 3n * D + B * B * C * C - 4n * C ** 3n - 27n * D * D
      let root = false
      for (let d = 1; d <= Math.abs(r); d++) {
        if (r % d !== 0) continue
        for (const t of [BigInt(d), BigInt(-d)]) if (t ** 3n - P * t * t + Q * t - R === 0n) root = true
      }
      return { three_real: disc > 0n, no_rational_root: !root }
    },
    solve(g) {
      const [p, q, r] = [num(g, 'p'), num(g, 'q'), num(g, 'r')].map(BigInt) as [bigint, bigint, bigint]
      // companion matrix of t³ = p t² − q t + r: its eigenvalues are x, y, z
      const M = [
        [0n, 0n, r],
        [1n, 0n, -q],
        [0n, 1n, p],
      ]
      const M2 = matMul(M, M)
      const M4 = matMul(M2, M2)
      return Fraction.of((M4[0]![0] as bigint) + (M4[1]![1] as bigint) + (M4[2]![2] as bigint))
    },
  },
  'remainder/linear': {
    rules: (g) => ({ distinct: num(g, 'a') !== num(g, 'b'), slope: num(g, 'ra') !== num(g, 'rb') }),
    solve(g) {
      const [a, b, ra, rb] = [num(g, 'a'), num(g, 'b'), num(g, 'ra'), num(g, 'rb')]
      // P(a) = m·a + n = ra, P(b) = m·b + n = rb
      return solve2(f(a), f(1), f(ra), f(b), f(1), f(rb))[1]
    },
  },
  'functional/recip': {
    rules: (g) => ({ solvable: Math.abs(num(g, 'm')) >= 2, point: Math.abs(num(g, 'k')) >= 2 }),
    solve(g) {
      const [m, coef, k] = [num(g, 'm'), num(g, 'coef'), num(g, 'k')]
      // x = k: f(k) + m·f(1/k) = coef·k; x = 1/k: m·f(k) + f(1/k) = coef/k
      return solve2(f(1), f(m), f(coef * k), f(m), f(1), f(coef, k))[0]
    },
  },
  'egyptian/pairs': {
    rules(g) {
      let n = num(g, 'n')
      let primes = 0
      for (let p = 2; p <= n; p++) {
        if (n % p !== 0) continue
        primes++
        while (n % p === 0) n /= p
      }
      return { not_prime_power: primes >= 2 }
    },
    solve(g) {
      const n = num(g, 'n')
      let count = 0
      for (let x = n + 1; x <= n + n * n; x++) if ((n * x) % (x - n) === 0) count++ // y = nx/(x − n)
      return f(count)
    },
  },
  'gcd_power/mersenne': {
    rules(g) {
      const [base, m, n] = [num(g, 'base'), num(g, 'm'), num(g, 'n')]
      const d = gcd(m, n)
      return {
        distinct: m !== n,
        not_dividing: m % n !== 0 && n % m !== 0,
        shared: d >= 2,
        bound: BigInt(base) ** BigInt(d) - 1n <= 10_000_000n,
      }
    },
    solve(g) {
      const B = BigInt(num(g, 'base'))
      return Fraction.of(bigGcd(B ** BigInt(num(g, 'm')) - 1n, B ** BigInt(num(g, 'n')) - 1n))
    },
  },
  'tower_mod/remainder': {
    rules(g) {
      const [a, b, c, m] = [num(g, 'a'), num(g, 'b'), num(g, 'c'), num(g, 'm')]
      return { coprime: a % m !== 0, not_one: a % m !== 1, big_exponent: BigInt(b) ** BigInt(c) >= BigInt(m) }
    },
    solve(g) {
      const E = BigInt(num(g, 'b')) ** BigInt(num(g, 'c'))
      return Fraction.of(powModBig(BigInt(num(g, 'a')), E, BigInt(num(g, 'm'))))
    },
  },
  'lattice_circle/count': {
    rules: (g) => ({ many_points: latticePoints(num(g, 'n')) >= 12, not_square: !isSquare(BigInt(num(g, 'n'))) }),
    solve: (g) => f(latticePoints(num(g, 'n'))),
  },
}
