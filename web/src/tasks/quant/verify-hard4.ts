/**
 * The verifier's checks of hard quant table 4 (`hard4.ts`; generator 1.4.0, ROADMAP M3.12). Each
 * `solve` takes a route of its own, in exact BigInt {@link Fraction} arithmetic:
 *
 * - derivative: forward-mode differentiation with dual numbers;
 * - integral: Simpson's rule (exact for polynomials up to degree 3);
 * - limit: synthetic division by (x − at), then the quotients at x = at;
 * - optimise: the critical point of the area A(t) from the quotient rule on polynomials, the
 *   discriminant, and A compared at nearby rationals on both sides;
 * - digit sums, arithmetic triples and necklaces: brute-force enumeration (cached per given);
 * - gambler's ruin: Gaussian elimination on the first-step equations;
 * - adjacent reds: linearity over the n − 1 neighbouring places;
 * - area, volume: exact antiderivatives of polynomials, by the method the generator does not use
 *   (shells about the x-axis, washers about the y-axis);
 * - beta: (1 − x)^n expanded binomially and integrated term by term;
 * - telescoping: a long partial sum added term by term, plus its telescoped tail;
 * - ferries: both ferries simulated exactly (piecewise linear, every pass counted, overtaking
 *   included) at the width from the distances run, which must reproduce both meeting points.
 */

import { Fraction, exactRoot } from './fraction'
import { num, str, type Given } from './kit'
import { f, gcd, type Check } from './verify-kit'

// --- small exact tools ----------------------------------------------------------------------------

/** A dual number re + eps·ε with ε² = 0. */
class Dual {
  constructor(
    readonly re: Fraction,
    readonly eps: Fraction,
  ) {}
  static c(x: Fraction): Dual {
    return new Dual(x, Fraction.ZERO)
  }
  add(o: Dual): Dual {
    return new Dual(this.re.add(o.re), this.eps.add(o.eps))
  }
  mul(o: Dual): Dual {
    return new Dual(this.re.mul(o.re), this.re.mul(o.eps).add(this.eps.mul(o.re)))
  }
  inv(): Dual {
    const r = Fraction.ONE.div(this.re)
    return new Dual(r, this.eps.neg().mul(r).mul(r))
  }
}

/** Polynomials as coefficient lists, lowest degree first. */
type Poly = Fraction[]
const pAt = (p: Poly, x: Fraction): Fraction => p.reduceRight((acc, c) => acc.mul(x).add(c), Fraction.ZERO)
const pMul = (p: Poly, q: Poly): Poly => {
  const out: Poly = Array.from({ length: p.length + q.length - 1 }, () => Fraction.ZERO)
  p.forEach((a, i) => q.forEach((b, j) => (out[i + j] = (out[i + j] as Fraction).add(a.mul(b)))))
  return out
}
const pSub = (p: Poly, q: Poly): Poly =>
  Array.from({ length: Math.max(p.length, q.length) }, (_, i) => (p[i] ?? Fraction.ZERO).sub(q[i] ?? Fraction.ZERO))
const pDiff = (p: Poly): Poly => p.slice(1).map((c, i) => c.mul(f(i + 1)))
/** ∫_lo^hi p(x) dx by the exact antiderivative. */
const pInt = (p: Poly, lo: Fraction, hi: Fraction): Fraction => {
  const P: Poly = [Fraction.ZERO, ...p.map((c, i) => c.div(f(i + 1)))]
  return pAt(P, hi).sub(pAt(P, lo))
}
const P = (...cs: number[]): Poly => cs.map((c) => f(c))

/** √x for a rational perfect square, else null. */
function ratSqrt(x: Fraction): Fraction | null {
  if (x.sign() < 0) return null
  const n = exactRoot(x.n, 2)
  const d = exactRoot(x.d, 2)
  return n === null || d === null ? null : Fraction.of(n, d)
}

/** Solve A·x = rhs exactly (Gauss–Jordan with pivot search); throws if singular. */
function gauss(A: Fraction[][], rhs: Fraction[]): Fraction[] {
  const n = rhs.length
  const M = A.map((row, i) => [...row, rhs[i] as Fraction])
  for (let col = 0; col < n; col++) {
    const piv = M.findIndex((row, r) => r >= col && !(row[col] as Fraction).isZero())
    if (piv < 0) throw new Error('gauss: singular system')
    ;[M[col], M[piv]] = [M[piv] as Fraction[], M[col] as Fraction[]]
    const pr = M[col] as Fraction[]
    const inv = Fraction.ONE.div(pr[col] as Fraction)
    for (let j = col; j <= n; j++) pr[j] = (pr[j] as Fraction).mul(inv)
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const row = M[r] as Fraction[]
      const k = row[col] as Fraction
      if (k.isZero()) continue
      for (let j = col; j <= n; j++) row[j] = (row[j] as Fraction).sub(k.mul(pr[j] as Fraction))
    }
  }
  return M.map((row) => row[n] as Fraction)
}

// --- enumerations, cached --------------------------------------------------------------------------

const DIGIT_SUMS = new Map<number, number[]>()
/** counts[s] = how many of 1 … 10^digits − 1 have digit sum s (brute force). */
function digitSumCounts(digits: number): number[] {
  let counts = DIGIT_SUMS.get(digits)
  if (counts === undefined) {
    counts = Array.from({ length: 9 * digits + 1 }, () => 0)
    for (let x = 1; x < 10 ** digits; x++) {
      let s = 0
      for (let y = x; y > 0; y = Math.floor(y / 10)) s += y % 10
      counts[s] = (counts[s] as number) + 1
    }
    DIGIT_SUMS.set(digits, counts)
  }
  return counts
}

const AP = new Map<number, Fraction>()
/** P(three of 1 … n form an arithmetic sequence), every 3-subset enumerated. */
function apProbability(n: number): Fraction {
  let p = AP.get(n)
  if (p === undefined) {
    let fav = 0
    let all = 0
    for (let i = 1; i <= n; i++)
      for (let j = i + 1; j <= n; j++)
        for (let k = j + 1; k <= n; k++) {
          all++
          if (j - i === k - j) fav++
        }
    p = f(fav, all)
    AP.set(n, p)
  }
  return p
}

const NECKLACES = new Map<string, number>()
/** Words over `c` letters of length n that are the least of their rotations (one per necklace). */
function necklaces(n: number, c: number): number {
  const id = `${n}:${c}`
  let count = NECKLACES.get(id)
  if (count === undefined) {
    count = 0
    const total = c ** n
    const top = c ** (n - 1)
    for (let w = 0; w < total; w++) {
      let least = true
      let r = w
      for (let i = 1; i < n && least; i++) {
        r = (r % top) * c + Math.floor(r / top)
        if (r < w) least = false
      }
      if (least) count++
    }
    NECKLACES.set(id, count)
  }
  return count
}

// --- the ferries, simulated ---------------------------------------------------------------------

/**
 * Ferry A from the west bank (x = 0) at speed vA, ferry B from the east bank (x = W) at speed vB;
 * each turns at the far bank and again at its home bank. The first `want` passes (head-on or
 * overtaking) as positions from the west bank, by exact event-driven simulation.
 */
function ferryPasses(W: Fraction, vA: Fraction, vB: Fraction, want: number): Fraction[] {
  let t = Fraction.ZERO
  let xA = Fraction.ZERO
  let xB = W
  let dA = 1
  let dB = -1
  const out: Fraction[] = []
  for (let step = 0; step < 50 && out.length < want; step++) {
    const uA = vA.mul(f(dA))
    const uB = vB.mul(f(dB))
    const bankA = (dA > 0 ? W.sub(xA) : xA).div(vA)
    const bankB = (dB > 0 ? W.sub(xB) : xB).div(vB)
    let meet: Fraction | null = null
    const rel = uA.sub(uB)
    if (!rel.isZero()) {
      const dt = xB.sub(xA).div(rel)
      if (dt.sign() > 0) meet = dt
    }
    let dt = bankA.cmp(bankB) <= 0 ? bankA : bankB
    if (meet !== null && meet.cmp(dt) <= 0) dt = meet
    t = t.add(dt)
    xA = xA.add(uA.mul(dt))
    xB = xB.add(uB.mul(dt))
    if (meet !== null && meet.eq(dt)) {
      if (xA.isZero() || xA.eq(W)) throw new Error('ferries: the two meet at a bank')
      out.push(xA)
    }
    if (xA.isZero() || xA.eq(W)) dA = xA.isZero() ? 1 : -1
    if (xB.isZero() || xB.eq(W)) dB = xB.isZero() ? 1 : -1
  }
  if (out.length < want) throw new Error('ferries: too few passes')
  return out
}

// --- the checks ---------------------------------------------------------------------------------

export const CHECKS_HARD4: Readonly<Record<string, Check>> = {
  'derivative/quotient': {
    rules: (g) => ({ defined: num(g, 'c') + num(g, 'b') !== 0 }),
    solve(g) {
      const x = new Dual(f(num(g, 'c')), Fraction.ONE)
      const top = x.mul(x).add(Dual.c(f(num(g, 'a'))))
      const bottom = x.add(Dual.c(f(num(g, 'b'))))
      if (bottom.re.isZero()) throw new Error('derivative: f is undefined there')
      return top.mul(bottom.inv()).eps
    },
  },
  'integral/poly': {
    rules: (g) => ({ ordered: num(g, 'lo') < num(g, 'hi') }),
    solve(g) {
      const p = P(num(g, 'c'), num(g, 'b'), num(g, 'a'))
      const [lo, hi] = [f(num(g, 'lo')), f(num(g, 'hi'))]
      if (lo.cmp(hi) >= 0) throw new Error('integral: limits out of order')
      const mid = lo.add(hi).div(f(2))
      return hi.sub(lo).div(f(6)).mul(pAt(p, lo).add(f(4).mul(pAt(p, mid))).add(pAt(p, hi)))
    },
  },
  'limit/factor': {
    rules(g) {
      const [p1, q1, p2, q2, at] = ['p1', 'q1', 'p2', 'q2', 'at'].map((k) => num(g, k)) as [number, number, number, number, number]
      return {
        zero_over_zero: at * at + p1 * at + q1 === 0 && at * at + p2 * at + q2 === 0,
        finite: 2 * at + p2 !== 0,
        different: p1 !== p2,
        nonzero_limit: 2 * at + p1 !== 0,
      }
    },
    solve(g) {
      const at = f(num(g, 'at'))
      // x² + p·x + q = (x − at)(x + c1) + rem: synthetic division, then (x + c1) at x = at
      const reduced = (p: number, q: number): Fraction => {
        const c1 = f(p).add(at)
        const rem = f(q).add(at.mul(c1))
        if (!rem.isZero()) throw new Error('limit: (x − at) does not divide')
        return at.add(c1)
      }
      const top = reduced(num(g, 'p1'), num(g, 'q1'))
      const bottom = reduced(num(g, 'p2'), num(g, 'q2'))
      if (bottom.isZero()) throw new Error('limit: infinite')
      return top.div(bottom)
    },
  },
  'optimise/tangent_triangle': {
    rules: () => ({}),
    solve(g) {
      const [a, b] = [num(g, 'a'), num(g, 'b')]
      // The line through (a, b) and (t, 0), t > a, meets the y-axis at bt/(t − a): area A = N/D.
      const N = P(0, 0, b) // b·t²
      const D = P(-2 * a, 2) // 2(t − a)
      const A = (t: Fraction): Fraction => pAt(N, t).div(pAt(D, t))
      // A′ = (N′D − ND′)/D²: the critical points are the roots of N′D − ND′ with t > a.
      const top = pSub(pMul(pDiff(N), D), pMul(N, pDiff(D)))
      const [c0, c1, c2] = [top[0] ?? f(0), top[1] ?? f(0), top[2] ?? f(0)]
      const disc = c1.mul(c1).sub(f(4).mul(c2).mul(c0))
      const r = ratSqrt(disc)
      if (r === null || c2.isZero()) throw new Error('optimise: no rational critical point')
      const crit = [c1.neg().add(r), c1.neg().sub(r)].map((x) => x.div(f(2).mul(c2))).filter((t) => t.cmp(f(a)) > 0)
      if (crit.length !== 1) throw new Error('optimise: not one critical point')
      const t0 = crit[0] as Fraction
      const best = A(t0)
      for (const h of [f(1, 1000), f(1, 7), f(1, 2)]) {
        const left = t0.sub(h)
        if (left.cmp(f(a)) > 0 && A(left).cmp(best) <= 0) throw new Error('optimise: not a minimum')
        if (A(t0.add(h)).cmp(best) <= 0) throw new Error('optimise: not a minimum')
      }
      return best
    },
  },
  'digit_sum/count': {
    rules: (g) => ({ two_sided: num(g, 's') >= 10 && num(g, 's') <= 9 * num(g, 'digits') - 10 }),
    solve: (g) => f(digitSumCounts(num(g, 'digits'))[num(g, 's')] ?? 0),
  },
  'ap_triples/prob': {
    rules: () => ({}),
    solve: (g) => apProbability(num(g, 'n')),
  },
  'ruin/biased': {
    rules(g) {
      const [p, q, a, b] = [num(g, 'p'), num(g, 'q'), num(g, 'a'), num(g, 'b')]
      return { proper: p < q && gcd(p, q) === 1, not_fair: 2 * p !== q, total: a + b <= 8 }
    },
    solve(g) {
      // P(i) = Ana's chance with i coins: P(0) = 0, P(N) = 1, P(i) = w·P(i + 1) + (1 − w)·P(i − 1)
      const w = f(num(g, 'p'), num(g, 'q'))
      const N = num(g, 'a') + num(g, 'b')
      const A: Fraction[][] = []
      const rhs: Fraction[] = []
      for (let i = 0; i <= N; i++) {
        const row = Array.from({ length: N + 1 }, () => Fraction.ZERO)
        row[i] = Fraction.ONE
        if (i === 0 || i === N) rhs.push(i === N ? Fraction.ONE : Fraction.ZERO)
        else {
          row[i + 1] = w.neg()
          row[i - 1] = w.sub(Fraction.ONE)
          rhs.push(Fraction.ZERO)
        }
        A.push(row)
      }
      return gauss(A, rhs)[num(g, 'a')] as Fraction
    },
  },
  'adjacent/expect': {
    rules: () => ({}),
    solve(g) {
      // n − 1 neighbouring places; the two beads at one place are a uniformly random pair of the
      // n beads, so both red with chance C(red, 2)/C(n, 2) (linearity of expectation)
      const [r, n] = [num(g, 'red'), num(g, 'red') + num(g, 'blue')]
      const pairs = (k: number): number => (k * (k - 1)) / 2
      return f(n - 1).mul(f(pairs(r), pairs(n)))
    },
  },
  'area_between/parabola_line': {
    rules(g) {
      const B = BigInt(num(g, 'b') - num(g, 'm'))
      const D = B * B - 4n * BigInt(num(g, 'c') - num(g, 'k'))
      const r = D > 0n ? exactRoot(D, 2) : null
      return { two_crossings: r !== null && (r - B) % 2n === 0n }
    },
    solve(g) {
      // line − parabola = −x² + (m − b)x + (k − c); crossings where it vanishes
      const gap = P(num(g, 'k') - num(g, 'c'), num(g, 'm') - num(g, 'b'), -1)
      const B = f(num(g, 'b') - num(g, 'm'))
      const r = ratSqrt(B.mul(B).sub(f(4).mul(f(num(g, 'c') - num(g, 'k')))))
      if (r === null || r.isZero()) throw new Error('area_between: no two rational crossings')
      const x1 = B.neg().sub(r).div(f(2))
      const x2 = B.neg().add(r).div(f(2))
      if (!(pAt(gap, x1).isZero() && pAt(gap, x2).isZero())) throw new Error('area_between: crossings do not check')
      const area = pInt(gap, x1, x2)
      if (area.sign() <= 0) throw new Error('area_between: the line is not above the parabola')
      return area
    },
  },
  'beta/integral': {
    rules: () => ({}),
    solve(g) {
      // ∫₀¹ x^m Σ_j C(n, j)(−x)^j dx = Σ_j (−1)^j C(n, j)/(m + j + 1)
      const [m, n] = [num(g, 'm'), num(g, 'n')]
      let total = Fraction.ZERO
      let c = 1
      for (let j = 0; j <= n; j++) {
        total = total.add(f((-1) ** j * c, m + j + 1))
        c = (c * (n - j)) / (j + 1)
      }
      return total
    },
  },
  'telescoping/infinite': {
    rules: () => ({}),
    solve(g) {
      // S = Σ_{i ≤ K} 1/((i + s)(i + s + a)) + tail, where the tail telescopes to (1/a)·Σ_{j=1}^{a} 1/(K + s + j)
      const [s, a] = [num(g, 's'), num(g, 'a')]
      const K = 40
      let head = Fraction.ZERO
      for (let i = 1; i <= K; i++) head = head.add(f(1, (i + s) * (i + s + a)))
      let tail = Fraction.ZERO
      for (let j = 1; j <= a; j++) tail = tail.add(f(1, K + s + j))
      return head.add(tail.div(f(a)))
    },
  },
  'revolution/volume': {
    rules: (g) => ({ reduced: gcd(num(g, 'a'), num(g, 'k')) === 1 }),
    solve(g) {
      const [a, k] = [f(num(g, 'a')), f(num(g, 'k'))]
      // The curves cross at x = 0 and x = k/a, height Y = k²/a; at height y the region spans
      // x from y/k (the line) to √(y/a) (the parabola).
      const Y = k.mul(k).div(a)
      if (str(g, 'axis') === 'y') {
        // washers about the y-axis: π ∫₀^Y (y/a − y²/k²) dy
        return pInt([Fraction.ZERO, Fraction.ONE.div(a), Fraction.ONE.div(k.mul(k)).neg()], Fraction.ZERO, Y)
      }
      // shells about the x-axis: 2π ∫₀^Y y(√(y/a) − y/k) dy, with ∫₀^Y y^(3/2) dy = (2/5)·Y²·√Y
      const root = ratSqrt(Y.div(a))
      if (root === null) throw new Error('revolution: irrational crossing')
      const curve = f(2, 5).mul(Y).mul(Y).mul(root)
      const line = pInt([Fraction.ZERO, Fraction.ZERO, Fraction.ONE.div(k)], Fraction.ZERO, Y)
      return f(2).mul(curve.sub(line))
    },
  },
  'necklace/rotations': {
    rules: (g) => ({ bound: num(g, 'colours') ** num(g, 'n') <= 65536 }),
    solve: (g) => f(necklaces(num(g, 'n'), num(g, 'colours'))),
  },
  'ferries/width': {
    rules(g) {
      const [d1, d2] = [num(g, 'd1'), num(g, 'd2')]
      const W = 3 * d1 - d2
      return { tens: d1 % 10 === 0 && d2 % 10 === 0, consistent: d2 < W && d1 < W, unequal: 2 * d1 !== W }
    },
    solve(g: Given) {
      const [d1, d2] = [f(num(g, 'd1')), f(num(g, 'd2'))]
      // By the second pass the two have run three widths between them, A three times its
      // distance to the first pass: 3·d1 = W + d2.
      const W = f(3).mul(d1).sub(d2)
      if (W.cmp(d1) <= 0) throw new Error('ferries: no width')
      const [first, second] = ferryPasses(W, d1, W.sub(d1), 2) as [Fraction, Fraction]
      if (!first.eq(d1) || !W.sub(second).eq(d2)) throw new Error('ferries: the passes do not match the stem')
      return W
    },
  },
}
