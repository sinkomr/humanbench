/**
 * Hard quant table 4 (generator 1.4.0, ROADMAP M3.12): stratum 5 calculus (a derivative, a
 * definite integral, a 0/0 limit, a tangent-line optimisation) and stratum 6 counting,
 * probability, calculus and a word problem (digit sums, arithmetic triples, a biased gambler's
 * ruin, expected adjacencies, the area between a parabola and a line, a beta integral, a
 * telescoping series, a volume of revolution, necklaces up to rotation, two ferries). Every item
 * is solvable without a calculator. The bank twin is `hb.gen.quant.hard4`; the verifier's
 * independent routes are in `verify-hard4.ts`. See `templates.ts` (HARD) for how the tables join.
 */

import { Fraction, exactRoot, frac } from './fraction'
import { V, gcd, int, ipow, lin, nonzero, num, oneOf, signed, str, until, type VariantDef } from './kit'

const binom = (n: number, k: number): number => {
  if (k < 0 || k > n) return 0
  let r = 1
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i
  return r
}
const fact = (n: number): bigint => (n <= 1 ? 1n : BigInt(n) * fact(n - 1))
/** H_n = 1 + 1/2 + … + 1/n (H_0 = 0). */
const harmonic = (n: number): Fraction => {
  let h = Fraction.ZERO
  for (let i = 1; i <= n; i++) h = h.add(frac(1, i))
  return h
}
/** lcm(lo, lo + 1, …, hi). */
const lcmRange = (lo: number, hi: number): number => {
  let l = 1
  for (let i = lo; i <= hi; i++) l = (l * i) / gcd(l, i)
  return l
}
const phi = (n: number): number => {
  let c = 0
  for (let i = 1; i <= n; i++) if (gcd(i, n) === 1) c++
  return c
}

/** (p, q): the win chances p/q of the gambler's-ruin rounds (proper, reduced, not 1/2). */
const RUIN_PQ: readonly (readonly [number, number])[] = [
  [1, 3], [2, 3], [1, 4], [3, 4], [1, 5], [2, 5], [3, 5], [4, 5],
]

const coins = (k: number): string => (k === 1 ? '1 coin' : `${k} coins`)
const xPow = (m: number): string => (m === 1 ? 'x' : `x^${m}`)
const oneMinusPow = (n: number): string => (n === 1 ? '(1 − x)' : `(1 − x)^${n}`)

export const HARD4: VariantDef[] = [
  // --- stratum 5: calculus --------------------------------------------------------------------
  V({
    template: 'derivative', variant: 'quotient', stratum: 5, format: 'fraction', offset: -0.2,
    fields: { a: int(-20, 20, true), b: int(-9, 9, true), c: int(-9, 9) },
    draw: (rng) =>
      until(
        () => ({ a: nonzero(rng, -20, 20), b: nonzero(rng, -9, 9), c: rng.int(-9, 9) }),
        // a = −b² would cancel x² + a against x + b (f′ = 1 everywhere): drawn out.
        (g) => g.c + g.b !== 0 && g.a !== -g.b * g.b,
        'derivative/quotient',
      ),
    render: (g) =>
      `Let f(x) = (${lin([[1, 'x^2'], [num(g, 'a'), '']])})/(${lin([[1, 'x'], [num(g, 'b'), '']])}). What is the value of f′(${signed(num(g, 'c'))})?`,
    compute(g) {
      const [a, b, c] = [num(g, 'a'), num(g, 'b'), num(g, 'c')]
      return frac(c * c + 2 * b * c - a, (c + b) ** 2)
    },
  }),
  V({
    template: 'integral', variant: 'poly', stratum: 5, format: 'fraction', offset: -0.3,
    fields: { a: int(-9, 9, true), b: int(-9, 9), c: int(-9, 9), lo: int(-5, 5), hi: int(-4, 6) },
    draw: (rng) =>
      until(
        () => ({ a: nonzero(rng, -9, 9), b: rng.int(-9, 9), c: rng.int(-9, 9), lo: rng.int(-5, 5), hi: rng.int(-4, 6) }),
        (g) => g.lo < g.hi,
        'integral/poly',
      ),
    render: (g) =>
      `What is the value of the integral of ${lin([[num(g, 'a'), 'x^2'], [num(g, 'b'), 'x'], [num(g, 'c'), '']])} with respect to x, from x = ${signed(num(g, 'lo'))} to x = ${signed(num(g, 'hi'))}?`,
    compute(g) {
      const [a, b, c, lo, hi] = ['a', 'b', 'c', 'lo', 'hi'].map((k) => num(g, k)) as [number, number, number, number, number]
      return frac(a * (hi ** 3 - lo ** 3), 3).add(frac(b * (hi ** 2 - lo ** 2), 2)).add(frac(c * (hi - lo)))
    },
  }),
  V({
    template: 'limit', variant: 'factor', stratum: 5, format: 'fraction', offset: -0.2,
    fields: { p1: int(-18, 18), q1: int(-81, 81), p2: int(-18, 18), q2: int(-81, 81), at: int(-9, 9) },
    draw(rng) {
      // numerator (x − at)(x − u), denominator (x − at)(x − v)
      const [at, u, v] = until(
        () => [rng.int(-9, 9), rng.int(-9, 9), rng.int(-9, 9)] as const,
        ([t, x, y]) => x !== t && y !== t && x !== y,
        'limit/factor roots',
      )
      return { p1: -(at + u), q1: at * u, p2: -(at + v), q2: at * v, at }
    },
    render: (g) =>
      `What is the limit of (${lin([[1, 'x^2'], [num(g, 'p1'), 'x'], [num(g, 'q1'), '']])})/(${lin([[1, 'x^2'], [num(g, 'p2'), 'x'], [num(g, 'q2'), '']])}) as x → ${signed(num(g, 'at'))}?`,
    compute(g) {
      const at = num(g, 'at')
      return frac(2 * at + num(g, 'p1'), 2 * at + num(g, 'p2'))
    },
  }),
  V({
    template: 'optimise', variant: 'tangent_triangle', stratum: 5, format: 'integer', offset: 0.1,
    fields: { a: int(1, 20), b: int(1, 20) },
    draw: (rng) => ({ a: rng.int(1, 20), b: rng.int(1, 20) }),
    render: (g) =>
      `A straight line passes through the point (${num(g, 'a')}, ${num(g, 'b')}) and crosses both the positive x-axis and the positive y-axis, cutting off a triangle with the two axes. What is the smallest possible area of this triangle?`,
    compute: (g) => frac(2 * num(g, 'a') * num(g, 'b')),
  }),

  // --- stratum 6 ------------------------------------------------------------------------------
  V({
    template: 'digit_sum', variant: 'count', stratum: 6, format: 'integer', offset: 0.3,
    fields: { digits: oneOf(3, 4), s: int(10, 26) },
    draw(rng) {
      const digits = rng.pick([3, 4])
      return { digits, s: rng.int(10, 9 * digits - 10) }
    },
    render: (g) => `How many whole numbers from 1 to ${num(g, 'digits') === 3 ? 999 : 9999} have digits that add up to ${num(g, 's')}?`,
    compute(g) {
      // inclusion–exclusion over the digits forced to be ≥ 10
      const [d, s] = [num(g, 'digits'), num(g, 's')]
      let total = 0
      for (let j = 0; 10 * j <= s; j++) total += (-1) ** j * binom(d, j) * binom(s - 10 * j + d - 1, d - 1)
      return frac(total)
    },
  }),
  V({
    template: 'ap_triples', variant: 'prob', stratum: 6, format: 'fraction', offset: 0.2,
    fields: { n: int(6, 40) },
    draw: (rng) => ({ n: rng.int(6, 40) }),
    render: (g) =>
      `Three different numbers are chosen at random from the whole numbers 1 to ${num(g, 'n')}. What is the probability that the three numbers, in some order, form an arithmetic sequence?`,
    compute(g) {
      const n = num(g, 'n')
      let A = 0
      for (let d = 1; d <= Math.floor((n - 1) / 2); d++) A += n - 2 * d
      return frac(A, binom(n, 3))
    },
  }),
  V({
    template: 'ruin', variant: 'biased', stratum: 6, format: 'fraction', offset: 0.2,
    fields: { p: int(1, 4), q: int(2, 5), a: int(1, 6), b: int(1, 6) },
    draw(rng) {
      const [p, q] = rng.pick(RUIN_PQ)
      // ρ = 3/2 or 2/3 (powers of both 2 and 3): at most 6 coins in all, so no power passes 3^6.
      const most = p > 1 && q - p > 1 ? 6 : 8
      return { p, q, ...until(() => ({ a: rng.int(1, 6), b: rng.int(1, 6) }), (x) => x.a + x.b <= most, 'ruin coins') }
    },
    render: (g) =>
      `Ana and Ben play a series of rounds. Ana wins each round with probability ${num(g, 'p')}/${num(g, 'q')}, independently of the other rounds; otherwise Ben wins it. After each round the loser gives the winner one coin. Ana starts with ${coins(num(g, 'a'))} and Ben with ${coins(num(g, 'b'))}. They stop as soon as one of them has no coins. What is the probability that Ana ends up with all the coins?`,
    compute(g) {
      const [p, q, a, b] = [num(g, 'p'), num(g, 'q'), num(g, 'a'), num(g, 'b')]
      const rho = frac(q - p, p)
      return Fraction.ONE.sub(rho.pow(a)).div(Fraction.ONE.sub(rho.pow(a + b)))
    },
  }),
  V({
    template: 'adjacent', variant: 'expect', stratum: 6, format: 'fraction', offset: 0,
    fields: { red: int(2, 15), blue: int(2, 15) },
    draw: (rng) => ({ red: rng.int(2, 15), blue: rng.int(2, 15) }),
    render: (g) =>
      `${num(g, 'red')} red beads and ${num(g, 'blue')} blue beads are put in a row in a random order. What is the expected number of places in the row where two red beads are next to each other?`,
    compute: (g) => frac(num(g, 'red') * (num(g, 'red') - 1), num(g, 'red') + num(g, 'blue')),
  }),
  V({
    template: 'area_between', variant: 'parabola_line', stratum: 6, format: 'fraction', offset: -0.3,
    fields: { b: int(-12, 12), c: int(-30, 30), m: int(-12, 12), k: int(-30, 30) },
    draw(rng) {
      // x² + (b − m)x + (c − k) = (x − r1)(x − r2), r1 < r2
      const [r1, r2] = until(
        () => {
          const r = rng.int(-8, 8)
          return [r, r + rng.int(1, 9)] as const
        },
        ([x, y]) => Math.abs(x * y) <= 60,
        'area_between roots',
      )
      const B = -(r1 + r2)
      const C = r1 * r2
      const m = rng.int(Math.max(-12, -12 - B), Math.min(12, 12 - B))
      const k = rng.int(Math.max(-30, -30 - C), Math.min(30, 30 - C))
      return { b: B + m, c: C + k, m, k }
    },
    render: (g) =>
      `What is the area of the region enclosed by the parabola y = ${lin([[1, 'x^2'], [num(g, 'b'), 'x'], [num(g, 'c'), '']])} and the line y = ${lin([[num(g, 'm'), 'x'], [num(g, 'k'), '']])}?`,
    compute(g) {
      // (r2 − r1)² is the discriminant of x² + (b − m)x + (c − k)
      const B = BigInt(num(g, 'b') - num(g, 'm'))
      const width = exactRoot(B * B - 4n * BigInt(num(g, 'c') - num(g, 'k')), 2)
      if (width === null) throw new RangeError('area_between: the crossings are not integers')
      return frac(width ** 3n, 6n)
    },
  }),
  V({
    template: 'beta', variant: 'integral', stratum: 6, format: 'fraction', offset: 0.3,
    fields: { m: int(1, 6), n: int(1, 6) },
    draw: (rng) => ({ m: rng.int(1, 6), n: rng.int(1, 6) }),
    render: (g) =>
      `What is the value of the integral of ${xPow(num(g, 'm'))}${oneMinusPow(num(g, 'n'))} with respect to x, from x = 0 to x = 1?`,
    compute: (g) => frac(fact(num(g, 'm')) * fact(num(g, 'n')), fact(num(g, 'm') + num(g, 'n') + 1)),
  }),
  V({
    template: 'telescoping', variant: 'infinite', stratum: 6, format: 'fraction', offset: 0.1,
    fields: { s: int(0, 6), a: int(2, 6) },
    // The terms' common denominator lcm(s + 1, …, s + a) at most 840, so the sum stays a hand
    // calculation (s = 6, a = 6 would need 27720).
    draw: (rng) => until(() => ({ s: rng.int(0, 6), a: rng.int(2, 6) }), (g) => lcmRange(g.s + 1, g.s + g.a) <= 840, 'telescoping'),
    render(g) {
      const [s, a] = [num(g, 's'), num(g, 'a')]
      const term = (i: number): string => `1/(${i + s} × ${i + s + a})`
      return `What is the value of the infinite sum ${term(1)} + ${term(2)} + ${term(3)} + …?`
    },
    compute: (g) => harmonic(num(g, 's') + num(g, 'a')).sub(harmonic(num(g, 's'))).div(frac(num(g, 'a'))),
  }),
  V({
    template: 'revolution', variant: 'volume', stratum: 6, format: 'fraction', offset: 0,
    fields: { a: int(1, 4), k: int(1, 8), axis: oneOf('x', 'y') },
    draw: (rng) => ({
      ...until(() => ({ a: rng.int(1, 4), k: rng.int(1, 8) }), (x) => gcd(x.a, x.k) === 1, 'revolution a, k'),
      axis: rng.pick(['x', 'y']),
    }),
    render: (g) =>
      `The region enclosed by the curve y = ${lin([[num(g, 'a'), 'x^2']])} and the line y = ${lin([[num(g, 'k'), 'x']])} is turned about the ${str(g, 'axis')}-axis. The volume of the solid formed is cπ. What is c?`,
    compute(g) {
      const [a, k] = [num(g, 'a'), num(g, 'k')]
      return str(g, 'axis') === 'x' ? ipow(k, 5).mul(frac(2, 15 * a ** 3)) : ipow(k, 4).mul(frac(1, 6 * a ** 3))
    },
  }),
  V({
    template: 'necklace', variant: 'rotations', stratum: 6, format: 'integer', offset: 0.6,
    fields: { n: int(4, 8), colours: int(2, 4) },
    draw: (rng) => until(() => ({ n: rng.int(4, 8), colours: rng.int(2, 4) }), (g) => g.colours ** g.n <= 65536, 'necklace'),
    render: (g) =>
      `A necklace has ${num(g, 'n')} beads equally spaced around a loop, and each bead is one of ${num(g, 'colours')} colours. Two necklaces count as the same if one can be turned (rotated, without flipping it over) to match the other. How many different necklaces are there?`,
    compute(g) {
      // Burnside: (1/n) Σ_{d | n} φ(d)·colours^(n/d)
      const [n, c] = [num(g, 'n'), num(g, 'colours')]
      let total = 0
      for (let d = 1; d <= n; d++) if (n % d === 0) total += phi(d) * c ** (n / d)
      return frac(total, n)
    },
  }),
  V({
    template: 'ferries', variant: 'width', stratum: 6, format: 'integer', offset: 0.2,
    fields: { d1: int(100, 900), d2: int(50, 900) },
    draw(rng) {
      // Speeds d1 : (W − d1) strictly between 1 : 2 and 2 : 1 ⇔ 2·d2 < 3·d1, so neither ferry
      // overtakes the other before both have turned; d2 ≠ d1, else the speeds are equal.
      const t1 = rng.int(10, 90)
      const t2 = until(() => rng.int(5, Math.min(90, Math.floor((3 * t1 - 1) / 2))), (t) => t !== t1, 'ferries d2')
      return { d1: 10 * t1, d2: 10 * t2 }
    },
    render: (g) =>
      `Two ferries leave opposite banks of a river at the same moment, each crossing at its own constant speed. They first pass each other ${num(g, 'd1')} metres from the west bank. Each turns back at once on reaching the far bank, and they pass each other again ${num(g, 'd2')} metres from the east bank. How wide is the river, in metres?`,
    compute: (g) => frac(3 * num(g, 'd1') - num(g, 'd2')),
  }),
]
