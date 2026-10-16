/**
 * The verifier's checks of hard quant table 2 (`hard2.ts`; generator 1.4.0, ROADMAP M3.12). Each
 * `solve` takes a route of its own, never the generator's closed form: the companion matrix of
 * the cubic (Vieta), the quadratic's discriminant and substitution (log equation), iterating the
 * recurrences, dynamic programming (stars and bars, lattice paths), counting a batch of bolts,
 * the meeting square in whole minutes, trial division, brute force over the residues, summed
 * valuations, square-and-multiply and the candle equation solved as a linear equation.
 */

import { Fraction, exactRoot } from './fraction'
import { num, type Given } from './kit'
import { f, gcd, powMod, type Check } from './verify-kit'

// --- vieta: the companion matrix ------------------------------------------------------------------

type Mat = Fraction[][]

const matMul = (x: Mat, y: Mat): Mat => x.map((row) => y[0]!.map((_, j) => row.reduce((s, v, k) => s.add(v.mul(y[k]![j]!)), Fraction.ZERO)))
const trace = (x: Mat): Fraction => x.reduce((s, row, i) => s.add(row[i]!), Fraction.ZERO)

/** The companion matrix of a x³ + b x² + c x + d: its eigenvalues are the cubic's roots. */
function companion(g: Given): Mat {
  const a = f(num(g, 'a'))
  const [b, c, d] = ['b', 'c', 'd'].map((k) => f(num(g, k)).div(a)) as [Fraction, Fraction, Fraction]
  const O = Fraction.ZERO, I = Fraction.ONE
  return [
    [O, O, d.neg()],
    [I, O, c.neg()],
    [O, I, b.neg()],
  ]
}

/** The inverse of a square matrix by Gauss–Jordan elimination (throws if singular). */
function inverse(x: Mat): Mat {
  const n = x.length
  const aug = x.map((row, i) => [...row, ...row.map((_, j) => (i === j ? Fraction.ONE : Fraction.ZERO))])
  for (let col = 0; col < n; col++) {
    const piv = aug.findIndex((row, r) => r >= col && !row[col]!.isZero())
    if (piv < 0) throw new Error('vieta: singular companion matrix')
    ;[aug[col], aug[piv]] = [aug[piv]!, aug[col]!]
    const p = aug[col]![col]!
    aug[col] = aug[col]!.map((v) => v.div(p))
    for (let r = 0; r < n; r++) {
      if (r === col || aug[r]![col]!.isZero()) continue
      const k = aug[r]![col]!
      aug[r] = aug[r]!.map((v, j) => v.sub(k.mul(aug[col]![j]!)))
    }
  }
  return aug.map((row) => row.slice(n))
}

function cubicRules(g: Given): Record<string, boolean> {
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((k) => BigInt(num(g, k))) as [bigint, bigint, bigint, bigint]
  const disc = 18n * a * b * c * d - 4n * b ** 3n * d + b * b * c * c - 4n * a * c ** 3n - 27n * a * a * d * d
  const at = (x: Fraction): Fraction => [a, b, c, d].reduce((s, k) => s.mul(x).add(f(Number(k))), Fraction.ZERO)
  let rational = false
  const D = Math.abs(num(g, 'd')), A = num(g, 'a')
  for (let p = 1; p <= D && !rational; p++)
    for (let q = 1; q <= A && !rational; q++) if (D % p === 0 && A % q === 0) rational = at(f(p, q)).isZero() || at(f(-p, q)).isZero()
  return {
    three_real: disc > 0n,
    no_rational_root: !rational,
    coprime: gcd(gcd(A, num(g, 'b')), gcd(num(g, 'c'), D)) === 1,
  }
}

// --- number theory and counting helpers -----------------------------------------------------------

/** The exponent of p in n ≥ 1. */
const valuation = (n: number, p: number): number => {
  let e = 0
  while (n % p === 0) {
    n /= p
    e++
  }
  return e
}

/** The distinct prime factors of n by trial division, with exponents. */
function factor(n: number): Map<number, number> {
  const out = new Map<number, number>()
  for (let p = 2; p * p <= n; p++) {
    while (n % p === 0) {
      out.set(p, (out.get(p) ?? 0) + 1)
      n /= p
    }
  }
  if (n > 1) out.set(n, (out.get(n) ?? 0) + 1)
  return out
}

function divisorRules(g: Given): Record<string, boolean> {
  const fs = factor(num(g, 'n'))
  return {
    smooth: [...fs.keys()].every((p) => p <= 11),
    rich: fs.size >= 3,
    squareful: [...fs.values()].some((e) => e >= 2),
  }
}

/** The divisors of n by trial division up to √n. */
function divisors(n: number): number[] {
  const out: number[] = []
  for (let d = 1; d * d <= n; d++) {
    if (n % d !== 0) continue
    out.push(d)
    if (d * d !== n) out.push(n / d)
  }
  return out
}

/** The 5-adic (and 2-adic) valuations of 1 … n summed: trailing zeros of n! are the smaller sum. */
const valuationSum = (n: number, p: number): number => {
  let s = 0
  for (let i = 1; i <= n; i++) s += valuation(i, p)
  return s
}

const pos = (x: Fraction): boolean => x.sign() > 0

export const CHECKS_HARD2: Readonly<Record<string, Check>> = {
  'vieta/sum_squares': {
    rules: cubicRules,
    // Σ rᵢ² = trace(C²) for the companion matrix C.
    solve: (g) => {
      const C = companion(g)
      return trace(matMul(C, C))
    },
  },
  'vieta/sum_recip': {
    rules: cubicRules,
    // Σ 1/rᵢ = trace(C⁻¹): the eigenvalues of C⁻¹ are the reciprocals of the roots.
    solve: (g) => trace(inverse(companion(g))),
  },
  'log_eq/product': {
    rules(g) {
      const N = BigInt(num(g, 'base')) ** BigInt(num(g, 'm'))
      const k = BigInt(num(g, 'k'))
      const s = exactRoot(k * k + 4n * N, 2)
      return {
        power_bound: N >= 8n && N <= 100_000n,
        integer_solution: s !== null && (k + s) % 2n === 0n && (k + s) / 2n > k,
      }
    },
    solve(g) {
      // log_b(x) + log_b(x − k) = m with x > k > 0 ⇔ x² − kx − b^m = 0; the root above k, checked by substitution.
      const base = num(g, 'base'), k = num(g, 'k'), m = num(g, 'm')
      const N = BigInt(base) ** BigInt(m)
      const s = exactRoot(BigInt(k) * BigInt(k) + 4n * N, 2)
      if (s === null) throw new Error('log_eq: irrational roots')
      const roots = [BigInt(k) + s, BigInt(k) - s].filter((t) => t % 2n === 0n).map((t) => t / 2n).filter((x) => x > BigInt(k))
      if (roots.length !== 1) throw new Error('log_eq: no unique solution')
      const x = roots[0] as bigint
      // Substitute: x·(x − k) must be base^m, found by dividing out the base m times.
      let prod = x * (x - BigInt(k))
      for (let i = 0; i < m; i++) {
        if (prod % BigInt(base) !== 0n) throw new Error('log_eq: substitution fails')
        prod /= BigInt(base)
      }
      if (prod !== 1n) throw new Error('log_eq: substitution fails')
      return Fraction.of(x)
    },
  },
  'recurrence/fib_diff': {
    rules: (g) => ({ distinct: num(g, 'p') !== num(g, 'q'), not_opposite: num(g, 'p') !== -num(g, 'q') }),
    solve(g) {
      let [x, y] = [num(g, 'p'), num(g, 'q')]
      for (let i = 3; i <= num(g, 'n'); i++) [x, y] = [y, y - x]
      return f(num(g, 'n') === 1 ? x : y)
    },
  },
  'recurrence/lyness': {
    rules: (g) => ({ distinct: num(g, 'p') !== num(g, 'q') }),
    solve(g) {
      let [x, y] = [f(num(g, 'p')), f(num(g, 'q'))]
      for (let i = 3; i <= num(g, 'n'); i++) [x, y] = [y, Fraction.ONE.add(y).div(x)]
      return num(g, 'n') === 1 ? x : y
    },
  },
  'stars_bars/at_least': {
    rules: (g) => ({ enough: num(g, 'n') - num(g, 'k') * num(g, 'm') >= 2 }),
    solve(g) {
      // ways[s] = the shares of s sweets among the children so far, each ≥ m.
      const n = num(g, 'n'), k = num(g, 'k'), m = num(g, 'm')
      let ways: bigint[] = Array.from({ length: n + 1 }, (_, s) => (s === 0 ? 1n : 0n))
      for (let child = 0; child < k; child++) {
        const next: bigint[] = Array.from({ length: n + 1 }, () => 0n)
        for (let s = 0; s <= n; s++) for (let give = m; s + give <= n; give++) next[s + give]! += ways[s]!
        ways = next
      }
      return Fraction.of(ways[n]!)
    },
  },
  'grid_paths/avoid': {
    rules: (g) => ({ inside: num(g, 'p') >= 1 && num(g, 'p') <= num(g, 'm') - 1 && num(g, 'q') >= 1 && num(g, 'q') <= num(g, 'n') - 1 }),
    solve(g) {
      const m = num(g, 'm'), n = num(g, 'n'), p = num(g, 'p'), q = num(g, 'q')
      const w: number[][] = Array.from({ length: m + 1 }, () => Array.from({ length: n + 1 }, () => 0))
      for (let x = 0; x <= m; x++)
        for (let y = 0; y <= n; y++) {
          if (x === p && y === q) continue
          w[x]![y] = x === 0 && y === 0 ? 1 : (x > 0 ? w[x - 1]![y]! : 0) + (y > 0 ? w[x]![y - 1]! : 0)
        }
      return f(w[m]![n]!)
    },
  },
  'conditional/bayes': {
    rules: (g) => ({
      share_step: num(g, 'share') % 5 === 0 && num(g, 'share') !== 50,
      different_rates: num(g, 'fault_a') !== num(g, 'fault_b'),
    }),
    solve(g) {
      // A batch of 10,000 bolts: share·100 from A, of which fault_a% are faulty; the rest from B.
      const fromA = num(g, 'share') * 100, fromB = 10_000 - fromA
      const faultyA = (fromA * num(g, 'fault_a')) / 100, faultyB = (fromB * num(g, 'fault_b')) / 100
      if (!Number.isInteger(faultyA) || !Number.isInteger(faultyB)) throw new Error('bayes: fractional bolts')
      return f(faultyA, faultyA + faultyB)
    },
  },
  'meet/wait': {
    rules: (g) => ({ wait_step: num(g, 'wait') % 5 === 0, wait_shorter: num(g, 'wait') < 60 * num(g, 'hours') }),
    solve(g) {
      // Arrival minutes s, t in [0, T]; they meet iff |s − t| ≤ w: the square minus two corner triangles.
      const T = 60 * num(g, 'hours'), w = num(g, 'wait')
      if (!(w > 0 && w < T)) throw new Error('meet: wait out of range')
      const triangle = f((T - w) * (T - w), 2)
      return f(T * T).sub(triangle).sub(triangle).div(f(T * T))
    },
  },
  'divisors/count': {
    rules: divisorRules,
    solve: (g) => f(divisors(num(g, 'n')).length),
  },
  'divisors/squares': {
    rules: divisorRules,
    solve: (g) => f(divisors(num(g, 'n')).filter((d) => exactRoot(BigInt(d), 2) !== null).length),
  },
  'crt/three': {
    rules(g) {
      const [m1, m2, m3, r1, r2, r3] = ['m1', 'm2', 'm3', 'r1', 'r2', 'r3'].map((k) => num(g, k)) as [number, number, number, number, number, number]
      return {
        increasing: m1 < m2 && m2 < m3,
        coprime: gcd(m1, m2) === 1 && gcd(m1, m3) === 1 && gcd(m2, m3) === 1,
        residues: r1 < m1 && r2 < m2 && r3 < m3,
        product_bound: m1 * m2 * m3 <= 1001,
        not_uniform: !(r1 === r2 && r2 === r3),
        not_shifted: !(m1 - r1 === m2 - r2 && m2 - r2 === m3 - r3),
      }
    },
    solve(g) {
      const [m1, m2, m3, r1, r2, r3] = ['m1', 'm2', 'm3', 'r1', 'r2', 'r3'].map((k) => num(g, k)) as [number, number, number, number, number, number]
      for (let x = 1; x <= m1 * m2 * m3; x++) if (x % m1 === r1 && x % m2 === r2 && x % m3 === r3) return f(x)
      throw new Error('crt: no solution')
    },
  },
  'legendre/zeros': {
    rules: () => ({}),
    solve: (g) => f(Math.min(valuationSum(num(g, 'n'), 5), valuationSum(num(g, 'n'), 2))),
  },
  'legendre/prime_power': {
    rules: () => ({}),
    solve: (g) => f(valuationSum(num(g, 'n'), num(g, 'p'))),
  },
  'mod100/power': {
    rules: (g) => ({ not_multiple_of_10: num(g, 'a') % 10 !== 0, not_fixed: num(g, 'a') !== 25 && num(g, 'a') !== 76 }),
    solve: (g) => f(powMod(num(g, 'a'), num(g, 'e'), 100)),
  },
  'candles/ratio': {
    rules: (g) => ({ ordered: num(g, 'a') < num(g, 'b') }),
    solve(g) {
      // Lengths 1 − t/b (slower) and 1 − t/a: 1 − t/b = k(1 − t/a) ⇔ t·(k/a − 1/b) = k − 1.
      const a = f(num(g, 'a')), b = f(num(g, 'b')), k = f(num(g, 'k'))
      const t = k.sub(Fraction.ONE).div(k.div(a).sub(Fraction.ONE.div(b)))
      if (!(pos(t) && t.cmp(a) < 0)) throw new Error('candles: no time before the first candle is out')
      if (!Fraction.ONE.sub(t.div(b)).eq(k.mul(Fraction.ONE.sub(t.div(a))))) throw new Error('candles: substitution fails')
      return t
    },
  },
}
