/**
 * Hard quant table 2 (generator 1.4.0, ROADMAP M3.12): stratum 5 algebra (Vieta sums of a cubic,
 * a log equation, periodic recurrences), counting (stars and bars, lattice paths), probability
 * (Bayes, a meeting problem), number theory (divisor counts, three-modulus CRT, Legendre's formula,
 * a power mod 100) and a word problem (candles). The bank's twin is `hb.gen.quant.hard2`; the
 * verifier's independent routes are in `verify-hard2.ts`. See `templates.ts` (HARD) and the spec.
 */

import type { Rng } from '../../engine'
import { Fraction, exactRoot, frac } from './fraction'
import { V, gcd, int, lin, nonzero, num, oneOf, signed, until, type Given, type VariantDef } from './kit'

// --- generator-side helpers ----------------------------------------------------------------------

/** C(n, r) for small n (exact in doubles: every value here is far below 2^53). */
const binom = (n: number, r: number): number => {
  if (r < 0 || r > n) return 0
  let out = 1
  for (let i = 1; i <= r; i++) out = (out * (n - r + i)) / i
  return Math.round(out)
}

const cubic = (g: Given): [number, number, number, number] => [num(g, 'a'), num(g, 'b'), num(g, 'c'), num(g, 'd')]
const cubicText = (g: Given): string => {
  const [a, b, c, d] = cubic(g)
  return lin([[a, 'x^3'], [b, 'x^2'], [c, 'x'], [d, '']])
}

/** Three distinct real, irrational roots and coprime coefficients (the generator's own check). */
function cubicOk(a: number, b: number, c: number, d: number): boolean {
  const disc = 18 * a * b * c * d - 4 * b ** 3 * d + b * b * c * c - 4 * a * c ** 3 - 27 * a * a * d * d
  if (disc <= 0) return false
  if (gcd(gcd(a, Math.abs(b)), gcd(Math.abs(c), Math.abs(d))) !== 1) return false
  // A rational root s/q in lowest terms has s | d and q | a: a s³ + b s² q + c s q² + d q³ = 0.
  for (let p = 1; p <= Math.abs(d); p++) {
    if (d % p !== 0) continue
    for (let q = 1; q <= a; q++) {
      if (a % q !== 0) continue
      for (const s of [p, -p]) if (a * s ** 3 + b * s * s * q + c * s * q * q + d * q ** 3 === 0) return false
    }
  }
  return true
}

const drawCubic = (rng: Rng): Given =>
  until(
    () => ({ a: rng.int(1, 5), b: rng.int(-20, 20), c: nonzero(rng, -30, 30), d: nonzero(rng, -40, 40) }),
    (g) => cubicOk(g.a, g.b, g.c, g.d),
    'a cubic with three irrational real roots',
  )

/** log_eq: every (base, m, x0) with N = base^m in [8, 100000], x0 | N, x0² > N and k = x0 − N/x0 ≤ 9999. */
const LOG_CHOICES: readonly (readonly [number, number, number])[] = (() => {
  const out: [number, number, number][] = []
  for (const base of [2, 3, 5, 6, 10]) {
    for (let m = 1; m <= 16; m++) {
      const N = base ** m
      if (N < 8 || N > 100_000) continue
      for (let x = 1; x <= N; x++) if (N % x === 0 && x * x > N && x - N / x <= 9999) out.push([base, m, x])
    }
  }
  return out
})()

/** divisors: every n in [100, 99999] with all prime factors ≤ 11, ≥ 3 distinct primes and a square factor. */
const DIVISOR_NS: readonly number[] = (() => {
  const out: number[] = []
  const primes = [2, 3, 5, 7, 11]
  const walk = (i: number, n: number, distinct: number, squareful: boolean): void => {
    if (i === primes.length) {
      if (n >= 100 && distinct >= 3 && squareful) out.push(n)
      return
    }
    const p = primes[i] as number
    for (let e = 0, x = n; x <= 99_999; e++, x *= p) walk(i + 1, x, distinct + (e > 0 ? 1 : 0), squareful || e >= 2)
  }
  walk(0, 1, 0, false)
  return out.sort((x, y) => x - y)
})()

/** The exponents of an 11-smooth n over 2, 3, 5, 7, 11. */
const smoothExponents = (n: number): number[] =>
  [2, 3, 5, 7, 11].map((p) => {
    let e = 0
    while (n % p === 0) {
      n /= p
      e++
    }
    return e
  })

/** crt: the increasing pairwise-coprime modulus triples in [3, 13] with product ≤ 1001. */
const CRT_MODULI: readonly (readonly [number, number, number])[] = (() => {
  const out: [number, number, number][] = []
  for (let x = 3; x <= 13; x++)
    for (let y = x + 1; y <= 13; y++)
      for (let z = y + 1; z <= 13; z++) if (gcd(x, y) === 1 && gcd(x, z) === 1 && gcd(y, z) === 1 && x * y * z <= 1001) out.push([x, y, z])
  return out
})()

/** a⁻¹ mod m (gcd(a, m) = 1) by the extended Euclidean algorithm. */
function invMod(a: number, m: number): number {
  let [r0, r1, s0, s1] = [a % m, m, 1, 0]
  while (r1 !== 0) {
    const q = Math.floor(r0 / r1)
    ;[r0, r1] = [r1, r0 - q * r1]
    ;[s0, s1] = [s1, s0 - q * s1]
  }
  return ((s0 % m) + m) % m
}

/** Σ⌊n/p^i⌋ (Legendre's formula). */
const legendre = (n: number, p: number): number => {
  let s = 0
  for (let q = p; q <= n; q *= p) s += Math.floor(n / q)
  return s
}

const CUBIC_FIELDS = { a: int(1, 5), b: int(-20, 20), c: int(-30, 30, true), d: int(-40, 40, true) }
const DIVISOR_FIELDS = { n: int(100, 99999) }
const factorial = (n: number): string => `${n}! (the product 1 × 2 × 3 × … × ${n})`
/** bayes: the shares 10, 15, …, 90 without 50. */
const SHARES = Object.freeze([10, 15, 20, 25, 30, 35, 40, 45, 55, 60, 65, 70, 75, 80, 85, 90])

export const HARD2: VariantDef[] = [
  V({
    template: 'vieta', variant: 'sum_squares', stratum: 5, format: 'fraction', offset: -0.1,
    fields: CUBIC_FIELDS,
    draw: drawCubic,
    render: (g) => `The equation ${cubicText(g)} = 0 has three different real solutions. What is the sum of their squares?`,
    compute(g) {
      const [a, b, c] = cubic(g)
      return frac(b, a).pow(2).sub(frac(2 * c, a))
    },
  }),
  V({
    template: 'vieta', variant: 'sum_recip', stratum: 5, format: 'fraction', offset: 0.1,
    fields: CUBIC_FIELDS,
    draw: drawCubic,
    render: (g) => `The equation ${cubicText(g)} = 0 has three different real solutions. What is the sum of their reciprocals?`,
    compute: (g) => frac(-num(g, 'c'), num(g, 'd')),
  }),
  V({
    template: 'log_eq', variant: 'product', stratum: 5, format: 'integer', offset: 0,
    fields: { base: oneOf(2, 3, 5, 6, 10), k: int(1, 9999), m: int(1, 16) },
    draw(rng) {
      const [base, m, x] = rng.pick(LOG_CHOICES)
      return { base, k: x - base ** m / x, m }
    },
    render: (g) => `Solve for x: log_${num(g, 'base')}(x) + log_${num(g, 'base')}(x − ${num(g, 'k')}) = ${num(g, 'm')}.`,
    compute(g) {
      // x(x − k) = N with x > k: x = (k + √(k² + 4N))/2.
      const k = BigInt(num(g, 'k')), N = BigInt(num(g, 'base')) ** BigInt(num(g, 'm'))
      const s = exactRoot(k * k + 4n * N, 2)
      if (s === null) throw new Error('log_eq: no integer solution')
      return frac(k + s, 2n)
    },
  }),
  V({
    template: 'recurrence', variant: 'fib_diff', stratum: 5, format: 'integer', offset: -0.1,
    fields: { p: int(-20, 20, true), q: int(-20, 20, true), n: int(100, 3000) },
    draw: (rng) =>
      until(
        () => ({ p: nonzero(rng, -20, 20), q: nonzero(rng, -20, 20), n: rng.int(100, 3000) }),
        (g) => g.p !== g.q && g.p !== -g.q,
        'fib_diff starts',
      ),
    render: (g) =>
      `A sequence has a(1) = ${signed(num(g, 'p'))}, a(2) = ${signed(num(g, 'q'))}, and a(n) = a(n − 1) − a(n − 2) for every n ≥ 3. What is a(${num(g, 'n')})?`,
    compute(g) {
      const p = num(g, 'p'), q = num(g, 'q')
      return frac([p, q, q - p, -p, -q, p - q][(num(g, 'n') - 1) % 6] as number)
    },
  }),
  V({
    template: 'recurrence', variant: 'lyness', stratum: 5, format: 'fraction', offset: 0.2,
    fields: { p: int(1, 12), q: int(1, 12), n: int(100, 3000) },
    draw: (rng) => until(() => ({ p: rng.int(1, 12), q: rng.int(1, 12), n: rng.int(100, 3000) }), (g) => g.p !== g.q, 'lyness starts'),
    render: (g) =>
      `A sequence has a(1) = ${num(g, 'p')}, a(2) = ${num(g, 'q')}, and a(n) = (1 + a(n − 1))/a(n − 2) for every n ≥ 3. What is a(${num(g, 'n')})?`,
    compute(g) {
      const p = num(g, 'p'), q = num(g, 'q')
      const cycle = [frac(p), frac(q), frac(1 + q, p), frac(1 + p + q, p * q), frac(1 + p, q)]
      return cycle[(num(g, 'n') - 1) % 5] as Fraction
    },
  }),
  V({
    template: 'stars_bars', variant: 'at_least', stratum: 5, format: 'integer', offset: 0,
    fields: { n: int(10, 40), k: int(3, 6), m: int(1, 4) },
    // Draw tightened past the rule: the count stays ≤ 20,000 (C(20, 5), C(25, 4), …), a hand computation.
    draw: (rng) =>
      until(
        () => ({ n: rng.int(10, 40), k: rng.int(3, 6), m: rng.int(1, 4) }),
        (g) => g.n - g.k * g.m >= 2 && binom(g.n - g.k * g.m + g.k - 1, g.k - 1) <= 20_000,
        'stars and bars',
      ),
    render: (g) =>
      `In how many ways can ${num(g, 'n')} identical sweets be shared among ${num(g, 'k')} children so that every child gets at least ${num(g, 'm')}?`,
    compute(g) {
      const n = num(g, 'n'), k = num(g, 'k'), m = num(g, 'm')
      return frac(binom(n - k * m + k - 1, k - 1))
    },
  }),
  V({
    template: 'grid_paths', variant: 'avoid', stratum: 5, format: 'integer', offset: 0,
    fields: { m: int(4, 9), n: int(4, 9), p: int(1, 8), q: int(1, 8) },
    draw(rng) {
      const m = rng.int(4, 9), n = rng.int(4, 9)
      return { m, n, p: rng.int(1, m - 1), q: rng.int(1, n - 1) }
    },
    render: (g) =>
      `A path on a square grid goes from (0, 0) to (${num(g, 'm')}, ${num(g, 'n')}) in steps of one unit, each step either to the right or up. How many such paths do not pass through the point (${num(g, 'p')}, ${num(g, 'q')})?`,
    compute(g) {
      const m = num(g, 'm'), n = num(g, 'n'), p = num(g, 'p'), q = num(g, 'q')
      return frac(binom(m + n, m) - binom(p + q, p) * binom(m - p + n - q, m - p))
    },
  }),
  V({
    template: 'conditional', variant: 'bayes', stratum: 5, format: 'fraction', offset: 0,
    fields: { share: int(10, 90), fault_a: int(1, 20), fault_b: int(1, 20) },
    draw: (rng) =>
      until(() => ({ share: rng.pick(SHARES), fault_a: rng.int(1, 20), fault_b: rng.int(1, 20) }), (g) => g.fault_a !== g.fault_b, 'bayes rates'),
    render: (g) =>
      `Machine A makes ${num(g, 'share')}% of the bolts in a factory and machine B makes the rest. Of the bolts made by machine A, ${num(g, 'fault_a')}% are faulty; of those made by machine B, ${num(g, 'fault_b')}% are faulty. A bolt chosen at random from the factory's output is faulty. What is the probability that it was made by machine A?`,
    compute(g) {
      const s = num(g, 'share'), fa = num(g, 'fault_a'), fb = num(g, 'fault_b')
      return frac(s * fa, s * fa + (100 - s) * fb)
    },
  }),
  V({
    template: 'meet', variant: 'wait', stratum: 5, format: 'fraction', offset: 0.1,
    fields: { hours: int(1, 3), wait: int(5, 55) },
    draw: (rng) => ({ hours: rng.int(1, 3), wait: 5 * rng.int(1, 11) }),
    render: (g) =>
      `Two friends plan to meet at a café. Each arrives at a time chosen uniformly at random between 12:00 and ${num(g, 'hours')}:00, independently of the other, waits ${num(g, 'wait')} minutes for the other, and then leaves. What is the probability that they meet?`,
    compute: (g) => Fraction.ONE.sub(Fraction.ONE.sub(frac(num(g, 'wait'), 60 * num(g, 'hours'))).pow(2)),
  }),
  V({
    template: 'divisors', variant: 'count', stratum: 5, format: 'integer', offset: -0.3,
    fields: DIVISOR_FIELDS,
    draw: (rng) => ({ n: rng.pick(DIVISOR_NS) }),
    render: (g) => `How many positive divisors does ${num(g, 'n')} have?`,
    compute: (g) => frac(smoothExponents(num(g, 'n')).reduce((s, e) => s * (e + 1), 1)),
  }),
  V({
    template: 'divisors', variant: 'squares', stratum: 5, format: 'integer', offset: 0,
    fields: DIVISOR_FIELDS,
    draw: (rng) => ({ n: rng.pick(DIVISOR_NS) }),
    render: (g) => `How many of the positive divisors of ${num(g, 'n')} are perfect squares?`,
    compute: (g) => frac(smoothExponents(num(g, 'n')).reduce((s, e) => s * (Math.floor(e / 2) + 1), 1)),
  }),
  V({
    template: 'crt', variant: 'three', stratum: 5, format: 'integer', offset: 0,
    fields: { m1: int(3, 13), m2: int(3, 13), m3: int(3, 13), r1: int(0, 12), r2: int(0, 12), r3: int(0, 12) },
    draw(rng) {
      const [m1, m2, m3] = rng.pick(CRT_MODULI)
      return until(
        () => ({ m1, m2, m3, r1: rng.int(0, m1 - 1), r2: rng.int(0, m2 - 1), r3: rng.int(0, m3 - 1) }),
        (g) => !(g.r1 === g.r2 && g.r2 === g.r3) && !(m1 - g.r1 === m2 - g.r2 && m2 - g.r2 === m3 - g.r3),
        'crt residues',
      )
    },
    render: (g) =>
      `What is the smallest positive integer that leaves a remainder of ${num(g, 'r1')} when divided by ${num(g, 'm1')}, a remainder of ${num(g, 'r2')} when divided by ${num(g, 'm2')}, and a remainder of ${num(g, 'r3')} when divided by ${num(g, 'm3')}?`,
    compute(g) {
      // Constructive CRT: x = Σ rᵢ·Mᵢ·(Mᵢ⁻¹ mod mᵢ) mod M with Mᵢ = M/mᵢ; M itself if that is 0.
      const ms = [num(g, 'm1'), num(g, 'm2'), num(g, 'm3')]
      const rs = [num(g, 'r1'), num(g, 'r2'), num(g, 'r3')]
      const M = ms.reduce((s, m) => s * m, 1)
      let x = 0
      ms.forEach((m, i) => {
        const Mi = M / m
        x = (x + (rs[i] as number) * Mi * invMod(Mi % m, m)) % M
      })
      return frac(x === 0 ? M : x)
    },
  }),
  V({
    template: 'legendre', variant: 'zeros', stratum: 5, format: 'integer', offset: -0.3,
    fields: { n: int(100, 5000) },
    draw: (rng) => ({ n: rng.int(100, 5000) }),
    render: (g) => `How many zeros are at the end of the number ${factorial(num(g, 'n'))}?`,
    compute: (g) => frac(legendre(num(g, 'n'), 5)),
  }),
  V({
    template: 'legendre', variant: 'prime_power', stratum: 5, format: 'integer', offset: 0,
    fields: { p: oneOf(2, 3, 7), n: int(30, 1000) },
    draw: (rng) => ({ p: rng.pick([2, 3, 7]), n: rng.int(30, 1000) }),
    render: (g) => `What is the largest whole number k for which ${num(g, 'p')}^k divides ${factorial(num(g, 'n'))}?`,
    compute: (g) => frac(legendre(num(g, 'n'), num(g, 'p'))),
  }),
  V({
    template: 'mod100', variant: 'power', stratum: 5, format: 'integer', offset: 0.1,
    fields: { a: int(3, 99), e: int(100, 9999) },
    // Draw tightened past the rules: a ending in 5 is left out too (every such a^e ends in 25).
    draw: (rng) => ({ a: until(() => rng.int(3, 99), (a) => a % 10 !== 0 && a % 10 !== 5 && a !== 76, 'a mod-100 base'), e: rng.int(100, 9999) }),
    render: (g) => `What is the remainder when ${num(g, 'a')}^${num(g, 'e')} is divided by 100?`,
    compute(g) {
      // a^e mod 100 with the exponent reduced: a^(e) ≡ a^(20 + (e mod 20)) for e ≥ 20 (λ(100) = 20, 2^2 | a^2).
      const a = BigInt(num(g, 'a')), e = num(g, 'e')
      return frac(a ** BigInt(20 + (e % 20)) % 100n)
    },
  }),
  V({
    template: 'candles', variant: 'ratio', stratum: 5, format: 'fraction', offset: 0.1,
    fields: { a: int(2, 12), b: int(3, 15), k: int(2, 4) },
    draw: (rng) => until(() => ({ a: rng.int(2, 12), b: rng.int(3, 15), k: rng.int(2, 4) }), (g) => g.a < g.b, 'candle times'),
    render: (g) =>
      `Two candles are the same length. One burns down completely in ${num(g, 'a')} hours and the other in ${num(g, 'b')} hours, each at a steady rate. Both are lit at the same time. After how many hours is one candle exactly ${num(g, 'k')} times as long as the other?`,
    compute(g) {
      const a = num(g, 'a'), b = num(g, 'b'), k = num(g, 'k')
      return frac((k - 1) * a * b, k * b - a)
    },
  }),
]
