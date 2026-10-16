/**
 * Hard quant table 3 (generator 1.4.0, ROADMAP M3.12): stratum 6 geometry, trigonometry, algebra
 * and number theory, olympiad style but each solvable on scratch paper without a calculator. See
 * `templates.ts` (HARD) and the spec. The bank twin is `hb.gen.quant.hard3` (with `hard3_gen` and
 * `hard3_verify`); both agree on ids, fields, rules, stems and keys. The verifier's own routes and
 * rules are in `verify-hard3.ts`.
 *
 * Draws tightened inside the field ranges (the rules are the spec's): remainder/linear never
 * draws a or b = 0 (the divisor "x" would render "(x)(x + 2)" and give n = P(0) away);
 * gcd_power/mersenne keeps base^g ≤ 100,000 (g ≤ 16 for base 2, g ≤ 10 for base 3) so the
 * answer is a power worked out by hand.
 */

import type { Rng } from '../../engine'
import { exactRoot, frac } from './fraction'
import { V, gcd, int, lin, num, oneOf, ratText, signed, until, type VariantDef } from './kit'

/** n ≥ 0 is the square of an integer. */
const isSquare = (n: number): boolean => n >= 0 && exactRoot(BigInt(n), 2) !== null
const isqrt = (n: number): number => Number(exactRoot(BigInt(n), 2) as bigint)

/** The 16 primitive Pythagorean triples with hypotenuse ≤ 100 (leg, leg, hyp). */
const PT: readonly (readonly [number, number, number])[] = [
  [3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25], [20, 21, 29], [12, 35, 37], [9, 40, 41], [28, 45, 53],
  [11, 60, 61], [33, 56, 65], [16, 63, 65], [48, 55, 73], [13, 84, 85], [36, 77, 85], [39, 80, 89], [65, 72, 97],
]

/** A lazily computed, deterministic table. */
function lazy<T>(make: () => T): () => T {
  let v: T | undefined
  return () => (v ??= make())
}

/** The distinct primes dividing n ≥ 1, ascending. */
function primeFactors(n: number): number[] {
  const out: number[] = []
  for (let p = 2; p * p <= n; p++) {
    if (n % p === 0) {
      out.push(p)
      while (n % p === 0) n /= p
    }
  }
  if (n > 1) out.push(n)
  return out
}

/** 4·(d₁(n) − d₃(n)): the divisors ≡ 1 minus those ≡ 3 (mod 4). */
function latticeCount(n: number): number {
  let d1 = 0
  let d3 = 0
  for (let d = 1; d <= n; d++) {
    if (n % d !== 0) continue
    if (d % 4 === 1) d1++
    else if (d % 4 === 3) d3++
  }
  return 4 * (d1 - d3)
}

/** The discriminant of t³ − p t² + q t − r (> 0 iff three distinct real roots). */
function cubicDisc(p: number, q: number, r: number): bigint {
  const [b, c, d] = [BigInt(-p), BigInt(q), BigInt(-r)]
  return 18n * b * c * d - 4n * b ** 3n * d + b * b * c * c - 4n * c ** 3n - 27n * d * d
}

/** t³ − p t² + q t − r has an integer root (a divisor of r ≠ 0). */
function hasIntegerRoot(p: number, q: number, r: number): boolean {
  const R = Math.abs(r)
  for (let d = 1; d <= R; d++) {
    if (R % d !== 0) continue
    for (const t of [d, -d]) if (t ** 3 - p * t * t + q * t - r === 0) return true
  }
  return false
}

// --- enumerations (drawn uniformly) ---------------------------------------------------------------

/** Scalene, not right-angled, integer-area triangles a < b < c ≤ 75 (the heron/area rules). */
const HERON = lazy(() => {
  const out: [number, number, number][] = []
  for (let a = 3; a <= 75; a++)
    for (let b = a + 1; b <= 75; b++)
      for (let c = b + 1; c <= 75 && c < a + b; c++) {
        if (a * a + b * b === c * c) continue
        const P = (a + b + c) * (-a + b + c) * (a - b + c) * (a + b - c)
        if (isSquare(P) && isqrt(P) % 4 === 0) out.push([a, b, c])
      }
  return out
})

const TANGENT = lazy(() => {
  const out: [number, number, number][] = []
  for (let a = 1; a <= 40; a++)
    for (let b = a; b <= 40; b++)
      for (let c = Math.max(b, a + 1); c <= 40; c++) if (isSquare((a + b + c) * a * b * c)) out.push([a, b, c])
  return out
})

/** (r, h): the legs of a scaled primitive triple, either way round, hypotenuse ≤ 100. */
const CONES = lazy(() => {
  const seen = new Set<string>()
  const out: [number, number][] = []
  for (const [x, y, z] of PT)
    for (let k = 1; k * z <= 100; k++)
      for (const [r, h] of [[k * x, k * y], [k * y, k * x]] as const) {
        const id = `${r},${h}`
        if (r < 3 || h < 3 || r > 84 || h > 84 || seen.has(id)) continue
        seen.add(id)
        out.push([r, h])
      }
  return out
})

const SIN_STEPS = lazy(() => {
  const out: [number, number][] = []
  for (let first = 1; first <= 44; first++)
    for (let step = 1; step <= 10; step++) if ((90 - 2 * first) % step === 0 && (90 - 2 * first) / step + 1 >= 5) out.push([first, step])
  return out
})

const EGYPT = lazy(() => {
  const out: number[] = []
  for (let n = 2; n <= 150; n++) if (primeFactors(n).length >= 2) out.push(n)
  return out
})

const LATTICE = lazy(() => {
  const out: number[] = []
  for (let n = 25; n <= 2500; n++) if (!isSquare(n) && latticeCount(n) >= 12) out.push(n)
  return out
})

// --- drawing and rendering helpers ----------------------------------------------------------------

const nonzeroIn = (rng: Rng, lo: number, hi: number): number => until(() => rng.int(lo, hi), (v) => v !== 0, 'a non-zero integer')

/** "x − 3", "x + 2" ("x" for a = 0). */
const xMinus = (a: number): string => lin([[1, 'x'], [-a, '']])

/** gcd_power: the largest g drawn per base, base^g ≤ 100,000 (2^16, 3^10). */
const GCD_MAX_G: Readonly<Record<number, number>> = { 2: 16, 3: 10 }

export const HARD3: VariantDef[] = [
  V({
    template: 'triangle', variant: 'circumradius', stratum: 6, format: 'fraction', offset: -0.3,
    fields: { a: int(3, 75), b: int(3, 75), c: int(3, 75) },
    draw(rng) {
      const [a, b, c] = rng.pick(HERON())
      return { a, b, c }
    },
    render: (g) =>
      `A triangle has sides of length ${num(g, 'a')}, ${num(g, 'b')} and ${num(g, 'c')}. What is the radius of the circle that passes through all three of its corners?`,
    compute(g) {
      const [a, b, c] = [num(g, 'a'), num(g, 'b'), num(g, 'c')]
      const root = exactRoot(BigInt((a + b + c) * (-a + b + c) * (a - b + c) * (a + b - c)), 2)
      if (root === null) throw new RangeError('triangle/circumradius: area not rational')
      return frac(a * b * c).div(frac(root)) // abc / (4K) with K = √P / 4
    },
  }),
  V({
    template: 'triangle', variant: 'bisector', stratum: 6, format: 'fraction', offset: -0.1,
    fields: { a: int(2, 30), b: int(2, 30), c: int(2, 30) },
    draw: (rng) =>
      until(
        () => ({ a: rng.int(2, 30), b: rng.int(2, 30), c: rng.int(2, 30) }),
        (g) => g.a < g.b + g.c && g.b < g.a + g.c && g.c < g.a + g.b && g.b !== g.c,
        'triangle/bisector',
      ),
    render: (g) =>
      `In triangle ABC, BC = ${num(g, 'a')}, CA = ${num(g, 'b')} and AB = ${num(g, 'c')}. The bisector of angle A meets side BC at D. What is the value of AD^2?`,
    compute(g) {
      const [a, b, c] = [num(g, 'a'), num(g, 'b'), num(g, 'c')]
      return frac(b * c * ((b + c) ** 2 - a * a), (b + c) ** 2)
    },
  }),
  V({
    template: 'tangent_circles', variant: 'centres', stratum: 6, format: 'integer', offset: 0,
    fields: { a: int(1, 40), b: int(1, 40), c: int(1, 40) },
    draw(rng) {
      const [a, b, c] = rng.pick(TANGENT())
      return { a, b, c }
    },
    render: (g) =>
      `Three circles with radii ${num(g, 'a')}, ${num(g, 'b')} and ${num(g, 'c')} each touch the other two from the outside. What is the area of the triangle whose corners are the centres of the three circles?`,
    compute(g) {
      const [a, b, c] = [num(g, 'a'), num(g, 'b'), num(g, 'c')]
      const root = exactRoot(BigInt((a + b + c) * a * b * c), 2)
      if (root === null) throw new RangeError('tangent_circles/centres: area not an integer')
      return frac(root)
    },
  }),
  V({
    template: 'inscribed_sphere', variant: 'cone', stratum: 6, format: 'fraction', offset: 0.1,
    fields: { r: int(3, 84), h: int(3, 84) },
    draw(rng) {
      const [r, h] = rng.pick(CONES())
      return { r, h }
    },
    render: (g) =>
      `A right circular cone has a base radius of ${num(g, 'r')} and a height of ${num(g, 'h')}. A sphere sits inside the cone, touching its base and touching its curved surface all the way round. What is the radius of the sphere?`,
    compute(g) {
      const [r, h] = [num(g, 'r'), num(g, 'h')]
      const l = exactRoot(BigInt(r * r + h * h), 2)
      if (l === null) throw new RangeError('inscribed_sphere/cone: slant not an integer')
      return frac(r * h, r + Number(l))
    },
  }),
  V({
    template: 'tan_triangle', variant: 'third', stratum: 6, format: 'fraction', offset: -0.4,
    fields: { p: int(1, 9), q: int(1, 9), s: int(1, 9), t: int(1, 9) },
    draw: (rng) =>
      until(
        () => ({ p: rng.int(1, 9), q: rng.int(1, 9), s: rng.int(1, 9), t: rng.int(1, 9) }),
        (g) => gcd(g.p, g.q) === 1 && gcd(g.s, g.t) === 1 && g.p * g.s !== g.q * g.t && g.p * g.t !== g.q * g.s,
        'tan_triangle/third',
      ),
    render: (g) =>
      `In triangle ABC, tan A = ${ratText(frac(num(g, 'p'), num(g, 'q')))} and tan B = ${ratText(frac(num(g, 's'), num(g, 't')))}. What is the value of tan C?`,
    compute(g) {
      const [p, q, s, t] = [num(g, 'p'), num(g, 'q'), num(g, 's'), num(g, 't')]
      return frac(p * t + q * s, p * s - q * t)
    },
  }),
  V({
    template: 'sin_squares', variant: 'sum', stratum: 6, format: 'fraction', offset: 0,
    fields: { first: int(1, 44), step: int(1, 10) },
    draw(rng) {
      const [first, step] = rng.pick(SIN_STEPS())
      return { first, step }
    },
    render(g) {
      const [first, step] = [num(g, 'first'), num(g, 'step')]
      return `What is the value of sin^2(${first}°) + sin^2(${first + step}°) + sin^2(${first + 2 * step}°) + … + sin^2(${90 - first}°)?`
    },
    compute: (g) => frac((90 - 2 * num(g, 'first')) / num(g, 'step') + 1, 2),
  }),
  V({
    template: 'newton', variant: 'power4', stratum: 6, format: 'integer', offset: 0.1,
    fields: { p: int(-9, 9), q: int(-30, 30), r: int(-60, 60, true) },
    draw: (rng) =>
      until(
        () => ({ p: rng.int(-9, 9), q: rng.int(-30, 30), r: nonzeroIn(rng, -60, 60) }),
        (g) => cubicDisc(g.p, g.q, g.r) > 0n && !hasIntegerRoot(g.p, g.q, g.r),
        'newton/power4',
      ),
    render: (g) =>
      `Real numbers x, y and z satisfy x + y + z = ${signed(num(g, 'p'))}, xy + yz + zx = ${signed(num(g, 'q'))} and xyz = ${signed(num(g, 'r'))}. What is the value of x^4 + y^4 + z^4?`,
    compute(g) {
      const [e1, e2, e3] = [num(g, 'p'), num(g, 'q'), num(g, 'r')]
      const p1 = e1
      const p2 = e1 * p1 - 2 * e2
      const p3 = e1 * p2 - e2 * p1 + 3 * e3
      return frac(e1 * p3 - e2 * p2 + e3 * p1)
    },
  }),
  V({
    template: 'remainder', variant: 'linear', stratum: 6, format: 'fraction', offset: -0.3,
    fields: { a: int(-9, 9), b: int(-9, 9), ra: int(-30, 30), rb: int(-30, 30) },
    draw: (rng) =>
      until(
        () => ({ a: nonzeroIn(rng, -9, 9), b: nonzeroIn(rng, -9, 9), ra: rng.int(-30, 30), rb: rng.int(-30, 30) }),
        (g) => g.a !== g.b && g.ra !== g.rb,
        'remainder/linear',
      ),
    render(g) {
      const [a, b] = [num(g, 'a'), num(g, 'b')]
      return `When a polynomial P(x) is divided by ${xMinus(a)}, the remainder is ${signed(num(g, 'ra'))}. When P(x) is divided by ${xMinus(b)}, the remainder is ${signed(num(g, 'rb'))}. When P(x) is divided by (${xMinus(a)})(${xMinus(b)}), the remainder is mx + n. What is the value of n?`
    },
    compute(g) {
      const [a, b, ra, rb] = [num(g, 'a'), num(g, 'b'), num(g, 'ra'), num(g, 'rb')]
      return frac(a * rb - b * ra, a - b)
    },
  }),
  V({
    template: 'functional', variant: 'recip', stratum: 6, format: 'fraction', offset: -0.2,
    fields: { m: int(-5, 5), coef: int(-12, 12, true), k: int(-9, 9) },
    draw: (rng) =>
      until(
        () => ({ m: rng.int(-5, 5), coef: nonzeroIn(rng, -12, 12), k: rng.int(-9, 9) }),
        (g) => Math.abs(g.m) >= 2 && Math.abs(g.k) >= 2,
        'functional/recip',
      ),
    render: (g) =>
      `A function f satisfies ${lin([[1, 'f(x)'], [num(g, 'm'), 'f(1/x)']])} = ${lin([[num(g, 'coef'), 'x']])} for every x ≠ 0. What is the value of f(${signed(num(g, 'k'))})?`,
    compute(g) {
      const [m, coef, k] = [num(g, 'm'), num(g, 'coef'), num(g, 'k')]
      return frac(coef * (k * k - m), k * (1 - m * m))
    },
  }),
  V({
    template: 'egyptian', variant: 'pairs', stratum: 6, format: 'integer', offset: 0.2,
    fields: { n: int(2, 150) },
    draw: (rng) => ({ n: rng.pick(EGYPT()) }),
    render: (g) => `How many ordered pairs (x, y) of positive whole numbers satisfy 1/x + 1/y = 1/${num(g, 'n')}?`,
    compute(g) {
      let n = num(g, 'n')
      let count = 1
      for (const p of primeFactors(n)) {
        let e = 0
        while (n % p === 0) {
          n /= p
          e++
        }
        count *= 2 * e + 1 // the divisors of n² = ∏ p^(2e)
      }
      return frac(count)
    },
  }),
  V({
    template: 'gcd_power', variant: 'mersenne', stratum: 6, format: 'integer', offset: 0,
    fields: { base: oneOf(2, 3), m: int(10, 300), n: int(10, 300) },
    draw(rng) {
      const base = rng.pick([2, 3])
      const g = rng.int(2, GCD_MAX_G[base] as number)
      const lo = Math.max(2, Math.ceil(10 / g))
      const hi = Math.floor(300 / g)
      // m = g·i, n = g·j with i ≠ j coprime and ≥ 2: gcd(m, n) = g and neither divides the other
      return until(
        () => ({ base, m: g * rng.int(lo, hi), n: g * rng.int(lo, hi) }),
        (x) => x.m !== x.n && gcd(x.m / g, x.n / g) === 1,
        'gcd_power/mersenne',
      )
    },
    render: (g) => `What is the greatest common divisor of ${num(g, 'base')}^${num(g, 'm')} − 1 and ${num(g, 'base')}^${num(g, 'n')} − 1?`,
    compute: (g) => frac(BigInt(num(g, 'base')) ** BigInt(gcd(num(g, 'm'), num(g, 'n'))) - 1n),
  }),
  V({
    template: 'tower_mod', variant: 'remainder', stratum: 6, format: 'integer', offset: 0.4,
    fields: { a: int(2, 20), b: int(2, 9), c: int(2, 20), m: oneOf(7, 11, 13, 17, 19, 23) },
    draw: (rng) =>
      until(
        () => ({ a: rng.int(2, 20), b: rng.int(2, 9), c: rng.int(2, 20), m: rng.pick([7, 11, 13, 17, 19, 23]) }),
        (g) => g.a % g.m > 1 && g.b ** g.c >= g.m,
        'tower_mod/remainder',
      ),
    render: (g) => `What is the remainder when ${num(g, 'a')}^(${num(g, 'b')}^${num(g, 'c')}) is divided by ${num(g, 'm')}?`,
    compute(g) {
      // Fermat: a^(m−1) ≡ 1 (mod m) for the prime m ∤ a, so only b^c mod (m − 1) matters.
      const [a, b, c, m] = [num(g, 'a'), num(g, 'b'), num(g, 'c'), num(g, 'm')]
      let e = 1
      for (let i = 0; i < c; i++) e = (e * b) % (m - 1)
      let out = 1
      for (let i = 0; i < e; i++) out = (out * a) % m
      return frac(out)
    },
  }),
  V({
    template: 'lattice_circle', variant: 'count', stratum: 6, format: 'integer', offset: 0.5,
    fields: { n: int(25, 2500) },
    draw: (rng) => ({ n: rng.pick(LATTICE()) }),
    render: (g) =>
      `How many points (x, y) whose coordinates are both whole numbers (positive, negative or zero) lie on the circle x^2 + y^2 = ${num(g, 'n')}?`,
    compute: (g) => frac(latticeCount(num(g, 'n'))),
  }),
]
