/**
 * The quant verifier (gates G2/G3, DESIGN §4.1–4.2 "Math"; M1.8). It trusts nothing the
 * generator computed: from the item alone it checks the template, the shape and ranges of
 * `given`, the template's rules (the ones that make the answer unique and "nice"), that the stem
 * is the one rendered from `given`, and that the key equals the answer recomputed by an
 * independent exact route (BigInt {@link Fraction} arithmetic, never floats):
 *
 * - expressions (arithmetic, fractions, exponent laws, rational powers) are evaluated from the
 *   stem text by the expression parser;
 * - equations are solved and the solution substituted back (linear: isolate x; 2×2 systems:
 *   Cramer's rule; quadratics: the discriminant; a^(mx+k) = v: repeated division);
 * - x ± 1/x = k and a + b = s, ab = p: the irrational roots are substituted exactly in Q(√D)
 *   ({@link Surd}), for both roots, and the result must be rational and the same;
 * - probabilities by enumerating every ordered draw or dice outcome; series by summing the terms;
 *   residues by square-and-multiply or brute force; counts by Pascal's triangle or a recursion.
 *
 * It also checks the key format (canonical rational, tolerance for the input format), that the
 * answer fits the format (integers are integers; decimals have ≤ 2 places), and the prior and
 * expected time. Failure reasons are the names of the failed checks; template rules appear as
 * `rule_<name>`.
 */

import { verdict, type ItemInstance, type VerifyResult } from '../family'
import { Fraction, Surd, exactRoot, frac } from './fraction'
import { evaluate } from './expr'
import { HINTS, variantOf, toleranceFor, num, nums, str, bool, type FieldSpec, type Given, type VariantDef } from './templates'
import { QUANT_PROVENANCE, QUANT_SD_PRIOR, quantBPrior, quantExpectedTime, quantFeatures } from './prior'
import type { QuantKey, QuantSpec } from './gen'

type Rules = Record<string, boolean>
interface Check {
  /** Template rules beyond the field ranges. */
  rules(g: Given): Rules
  /** The answer by the verifier's own route (may throw on a broken item). */
  solve(g: Given, stem: string): Fraction
}

const f = (n: number, d = 1): Fraction => frac(n, d)
const gcd = (a: number, b: number): number => {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b) [a, b] = [b, a % b]
  return a
}
const inRange = (x: Fraction, lo: number, hi: number): boolean => x.cmp(f(lo)) >= 0 && x.cmp(f(hi)) <= 0
const isIntIn = (x: Fraction, lo: number, hi: number): boolean => x.isInteger() && inRange(x, lo, hi)
const sum = (xs: readonly number[]): number => xs.reduce((s, v) => s + v, 0)

/** The expression of a "Compute …." stem. */
function computeExpr(stem: string): Fraction {
  const m = /^Compute (.+)\.$/.exec(stem)
  if (!m) throw new SyntaxError('not a "Compute …." stem')
  return evaluate(m[1] as string)
}

/** Integer roots of a·x² + b·x + c by the discriminant, substituted back; null unless two distinct rational roots. */
function quadRoots(a: number, b: number, c: number): [Fraction, Fraction] | null {
  const D = BigInt(b) * BigInt(b) - 4n * BigInt(a) * BigInt(c)
  if (D <= 0n) return null
  const r = exactRoot(D, 2)
  if (r === null) return null
  const roots = [Fraction.of(-BigInt(b) - r, 2n * BigInt(a)), Fraction.of(-BigInt(b) + r, 2n * BigInt(a))] as [Fraction, Fraction]
  for (const x of roots) if (!f(a).mul(x).mul(x).add(f(b).mul(x)).add(f(c)).isZero()) return null
  return roots
}

/** Cramer's rule for a₁x + b₁y = c₁, a₂x + b₂y = c₂, substituted back; null if singular. */
function cramer(g: Given): [Fraction, Fraction] | null {
  const [a1, b1, c1, a2, b2, c2] = ['a1', 'b1', 'c1', 'a2', 'b2', 'c2'].map((k) => num(g, k)) as [number, number, number, number, number, number]
  const det = a1 * b2 - a2 * b1
  if (det === 0) return null
  const x = f(c1 * b2 - c2 * b1, det)
  const y = f(a1 * c2 - a2 * c1, det)
  const ok1 = f(a1).mul(x).add(f(b1).mul(y)).eq(f(c1))
  const ok2 = f(a2).mul(x).add(f(b2).mul(y)).eq(f(c2))
  return ok1 && ok2 ? [x, y] : null
}

/** Ordered draws of two distinct marbles: favourable / all, by enumeration. */
function drawTwo(counts: readonly number[], favourable: (i: number, j: number) => boolean): Fraction {
  const colours = counts.flatMap((c, k) => Array.from({ length: c }, () => k))
  let fav = 0
  let all = 0
  for (let i = 0; i < colours.length; i++) {
    for (let j = 0; j < colours.length; j++) {
      if (i === j) continue
      all++
      if (favourable(colours[i] as number, colours[j] as number)) fav++
    }
  }
  return f(fav, all)
}

/** base^exp mod m by square-and-multiply (BigInt). */
function powMod(base: number, exp: number, m: number): number {
  let r = 1n
  let b = BigInt(base) % BigInt(m)
  let e = BigInt(exp)
  const M = BigInt(m)
  while (e > 0n) {
    if (e & 1n) r = (r * b) % M
    b = (b * b) % M
    e >>= 1n
  }
  return Number(r)
}

/** Pascal's triangle row n (BigInt), then entry k. */
function pascal(n: number, k: number): bigint {
  let row = [1n]
  for (let i = 0; i < n; i++) row = [1n, ...row.slice(1).map((v, j) => v + (row[j] as bigint)), 1n]
  return row[k] ?? 0n
}

/** Distinct orderings of a multiset with these counts, by recursion on the first letter placed. */
function orderings(counts: readonly number[]): bigint {
  const memo = new Map<string, bigint>()
  const go = (c: readonly number[]): bigint => {
    if (c.every((x) => x === 0)) return 1n
    const id = c.join(',')
    const hit = memo.get(id)
    if (hit !== undefined) return hit
    let total = 0n
    c.forEach((x, i) => {
      if (x > 0) total += go(c.map((y, j) => (j === i ? y - 1 : y)))
    })
    memo.set(id, total)
    return total
  }
  return go(counts)
}

/**
 * x^n ± x^−n at both roots of x ± 1/x = k, in Q(√D) exactly: returns the common rational value,
 * or null if it is irrational or the two roots disagree.
 */
function recipValue(k: number, minus: boolean, n: number, oddMinus: boolean): Fraction | null {
  // x + 1/x = k  ⇔  x² − kx + 1 = 0;  x − 1/x = k  ⇔  x² − kx − 1 = 0.
  const D = BigInt(k) * BigInt(k) + (minus ? 4n : -4n)
  if (D <= 0n || exactRoot(D, 2) !== null) return null
  const half = f(1, 2)
  const values = [1, -1].map((s) => {
    const x = new Surd(f(k).mul(half), f(s).mul(half), D)
    const lhs = minus ? x.sub(x.inv()) : x.add(x.inv())
    if (!(lhs.isRational() && lhs.a.eq(f(k)))) return null // the root satisfies the stem's equation
    const xn = x.pow(n)
    const v = oddMinus ? xn.sub(xn.inv()) : xn.add(xn.inv())
    return v.isRational() ? v.a : null
  })
  const [v1, v2] = values
  return v1 && v2 && v1.eq(v2) ? v1 : null
}

/** e(a, b) at both orderings of the roots of t² − st + p = 0 (rational or in Q(√D)); null if irrational or asymmetric. */
function symmetricValue(s: number, p: number, e: (a: Surd, b: Surd) => Surd): Fraction | null {
  const D = BigInt(s) * BigInt(s) - 4n * BigInt(p)
  if (D <= 0n) return null
  const r = exactRoot(D, 2)
  // Rational roots: embed them in Q(√2) (b = 0) so one code path serves both cases.
  const [a, b] =
    r === null
      ? [new Surd(f(s, 2), f(1, 2), D), new Surd(f(s, 2), f(-1, 2), D)]
      : [new Surd(Fraction.of(BigInt(s) + r, 2n), Fraction.ZERO, 2n), new Surd(Fraction.of(BigInt(s) - r, 2n), Fraction.ZERO, 2n)]
  if (!(a.add(b).isRational() && a.add(b).a.eq(f(s)) && a.mul(b).isRational() && a.mul(b).a.eq(f(p)))) return null
  const v1 = e(a, b)
  const v2 = e(b, a)
  return v1.isRational() && v2.isRational() && v1.a.eq(v2.a) ? v1.a : null
}

const CHECKS: Readonly<Record<string, Check>> = {
  'arith/mul_sub_div': {
    rules: (g) => ({ divides: num(g, 'c') % num(g, 'd') === 0, quotient_range: isIntIn(f(num(g, 'c'), num(g, 'd')), 4, 19) }),
    solve: (_g, stem) => computeExpr(stem),
  },
  'arith/group_mul': {
    rules: (g) => ({ positive: (num(g, 'a') + num(g, 'b')) * num(g, 'c') - num(g, 'e') >= 1 }),
    solve: (_g, stem) => computeExpr(stem),
  },
  'arith/div_chain': {
    rules: (g) => ({ divides: num(g, 'a') % num(g, 'b') === 0, quotient_range: isIntIn(f(num(g, 'a'), num(g, 'b')), 4, 15) }),
    solve: (_g, stem) => computeExpr(stem),
  },
  'percent/of': {
    rules: (g) => ({
      percent_choice: num(g, 'p') % 5 === 0 && num(g, 'p') !== 50,
      whole_result: (num(g, 'p') * num(g, 'n')) % 100 === 0,
    }),
    solve: (g) => evaluate(`${num(g, 'n')} × ${num(g, 'p')} ÷ 100`),
  },
  'percent/discount': {
    rules: () => ({}),
    // Subtract the discount (the generator multiplies by the remaining share).
    solve: (g) => f(num(g, 'price')).sub(f(num(g, 'price') * num(g, 'p'), 100)),
  },
  'percent/change': {
    rules(g) {
      const [b, a] = [num(g, 'before'), num(g, 'after')]
      const pct = f(100 * Math.abs(a - b), b)
      const cap = a > b ? 80 : 60
      return {
        changed: a !== b,
        whole_percent: pct.isInteger() && Number(pct.n) % 5 === 0 && inRange(pct, 5, cap),
      }
    },
    solve(g) {
      // Solve before·(1 ± x/100) = after for x, then substitute back.
      const [b, a] = [f(num(g, 'before')), f(num(g, 'after'))]
      const rise = a.cmp(b) > 0
      const x = (rise ? a.sub(b) : b.sub(a)).mul(f(100)).div(b)
      const back = b.mul(f(1).add((rise ? x : x.neg()).div(f(100))))
      if (!back.eq(a)) throw new Error('percent/change: substitution failed')
      return x
    },
  },
  'fraction/add_sub': {
    rules(g) {
      const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((k) => num(g, k)) as [number, number, number, number]
      return {
        proper: a < b && c < d,
        lowest_terms: gcd(a, b) === 1 && gcd(c, d) === 1,
        distinct_denominators: b !== d,
        positive: str(g, 'op') === 'add' || a * d > c * b,
      }
    },
    solve: (_g, stem) => computeExpr(stem),
  },
  'fraction/mul_div': {
    rules(g) {
      const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((k) => num(g, k)) as [number, number, number, number]
      return { proper: a < b && c < d, lowest_terms: gcd(a, b) === 1 && gcd(c, d) === 1 }
    },
    solve: (_g, stem) => computeExpr(stem),
  },
  'fraction_of/rest': {
    rules: (g) => fractionOfRules(g, false),
    solve(g) {
      const total = f(num(g, 'total'))
      const rest = total.sub(total.mul(f(num(g, 'a'), num(g, 'b'))))
      return rest.mul(f(num(g, 'c'), num(g, 'd')))
    },
  },
  'fraction_of/spent': {
    rules: (g) => fractionOfRules(g, true),
    solve(g) {
      const total = f(num(g, 'total'))
      const rest = total.sub(total.mul(f(num(g, 'a'), num(g, 'b'))))
      return rest.sub(rest.mul(f(num(g, 'c'), num(g, 'd'))))
    },
  },
  'ratio/share': {
    rules(g) {
      const [a, b, t] = [num(g, 'a'), num(g, 'b'), num(g, 'total')]
      return {
        distinct_names: str(g, 'name1') !== str(g, 'name2'),
        ratio_reduced: a !== b && gcd(a, b) === 1,
        whole_parts: t % (a + b) === 0 && isIntIn(f(t, a + b), 2, 40),
      }
    },
    solve(g) {
      const [a, b, t] = [num(g, 'a'), num(g, 'b'), num(g, 'total')]
      const unit = f(t, a + b)
      if (!f(a).mul(unit).add(f(b).mul(unit)).eq(f(t))) throw new Error('ratio/share: parts do not add up')
      return f(b).mul(unit)
    },
  },
  'ratio/total': {
    rules(g) {
      const [a, b, k] = [num(g, 'a'), num(g, 'b'), num(g, 'count')]
      return {
        distinct_colours: str(g, 'colour1') !== str(g, 'colour2'),
        ratio_reduced: a !== b && gcd(a, b) === 1,
        whole_parts: k % a === 0 && isIntIn(f(k, a), 2, 30),
      }
    },
    solve(g) {
      const unit = f(num(g, 'count'), num(g, 'a'))
      return f(num(g, 'count')).add(unit.mul(f(num(g, 'b'))))
    },
  },
  'ratio/three_way': {
    rules(g) {
      const [a, b, c, t] = [num(g, 'a'), num(g, 'b'), num(g, 'c'), num(g, 'total')]
      return {
        ratio_reduced: gcd(gcd(a, b), c) === 1 && !(a === b && b === c),
        whole_parts: t % (a + b + c) === 0 && isIntIn(f(t, a + b + c), 2, 30),
      }
    },
    solve(g) {
      const unit = f(num(g, 'total'), num(g, 'a') + num(g, 'b') + num(g, 'c'))
      const parts = ['a', 'b', 'c'].map((k) => unit.mul(f(num(g, k))))
      if (!parts.reduce((s, p) => s.add(p), Fraction.ZERO).eq(f(num(g, 'total')))) throw new Error('ratio/three_way: parts do not add up')
      return parts.reduce((m, p) => (p.cmp(m) > 0 ? p : m))
    },
  },
  'rate/unit': {
    rules: (g) => ({
      distinct_times: num(g, 't1') !== num(g, 't2'),
      whole_rate: num(g, 'count') % num(g, 't1') === 0 && isIntIn(f(num(g, 'count'), num(g, 't1')), 3, 40),
    }),
    solve: (g) => f(num(g, 'count'), num(g, 't1')).mul(f(num(g, 't2'))),
  },
  'rate/avg_speed': {
    rules(g) {
      const [d1, t1, d2, t2] = [num(g, 'd1'), num(g, 't1'), num(g, 'd2'), num(g, 't2')]
      return {
        // t1 = t2 would make the time-weighted mean the plain mean of the leg speeds (no trap).
        distinct_times: t1 !== t2,
        leg_speeds: inRange(f(d1, t1), 5, 45) && inRange(f(d2, t2), 5, 45),
        legs_differ: d1 * t2 !== d2 * t1,
        average_range: inRange(f(d1 + d2, t1 + t2), 10, 30),
        half_units: (2 * (d1 + d2)) % (t1 + t2) === 0,
      }
    },
    solve(g) {
      // Time-weighted mean of the leg speeds.
      const [d1, t1, d2, t2] = [num(g, 'd1'), num(g, 't1'), num(g, 'd2'), num(g, 't2')]
      const v1 = f(d1, t1)
      const v2 = f(d2, t2)
      return v1.mul(f(t1)).add(v2.mul(f(t2))).div(f(t1 + t2))
    },
  },
  'rate/together': {
    rules: (g) => ({ ordered: num(g, 'a') < num(g, 'b') }),
    solve(g) {
      const rate = f(1, num(g, 'a')).add(f(1, num(g, 'b')))
      const t = Fraction.ONE.div(rate)
      if (!t.div(f(num(g, 'a'))).add(t.div(f(num(g, 'b')))).eq(Fraction.ONE)) throw new Error('rate/together: substitution failed')
      return t
    },
  },
  'linear_eq/both_sides': {
    rules(g) {
      const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((k) => num(g, k)) as [number, number, number, number]
      return { unique_solution: a !== c, solution_range: a !== c && isIntIn(f(d - b, a - c), -15, 15) && d !== b }
    },
    solve(g) {
      const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((k) => f(num(g, k))) as [Fraction, Fraction, Fraction, Fraction]
      const x = d.sub(b).div(a.sub(c))
      if (!a.mul(x).add(b).eq(c.mul(x).add(d))) throw new Error('linear_eq: substitution failed')
      return x
    },
  },
  'linear_eq/brackets': {
    rules(g) {
      const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((k) => num(g, k)) as [number, number, number, number]
      return {
        unique_solution: a !== c,
        solution_range: a !== c && isIntIn(f(d - a * b, a - c), -12, 12) && d !== a * b,
      }
    },
    solve(g) {
      const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((k) => f(num(g, k))) as [Fraction, Fraction, Fraction, Fraction]
      // a(x + b) = cx + d  ⇒  (a − c)x = d − ab.
      const x = d.sub(a.mul(b)).div(a.sub(c))
      if (!a.mul(x.add(b)).eq(c.mul(x).add(d))) throw new Error('linear_eq: substitution failed')
      return x
    },
  },
  'linear_eq/over': {
    rules: (g) => ({ nonzero_solution: num(g, 'c') !== num(g, 'b') }),
    solve(g) {
      const [p, b, c] = [f(num(g, 'p')), f(num(g, 'b')), f(num(g, 'c'))]
      const x = c.sub(b).mul(p)
      if (!x.div(p).add(b).eq(c)) throw new Error('linear_eq: substitution failed')
      return x
    },
  },
  'mean/missing': {
    rules(g) {
      const k = nums(g, 'known')
      const missing = num(g, 'count') * num(g, 'mean') - sum(k)
      return { list_length: k.length === num(g, 'count') - 1, missing_range: missing >= 1 && missing <= 99 }
    },
    solve(g) {
      const k = nums(g, 'known')
      const x = f(num(g, 'count')).mul(f(num(g, 'mean'))).sub(f(sum(k)))
      if (!f(sum(k)).add(x).div(f(k.length + 1)).eq(f(num(g, 'mean')))) throw new Error('mean: substitution failed')
      return x
    },
  },
  'mean/target': {
    rules(g) {
      const s = nums(g, 'scores')
      const need = (s.length + 1) * num(g, 'mean') - sum(s)
      return { score_range: need >= 0 && need <= 100 }
    },
    solve(g) {
      const s = nums(g, 'scores')
      const x = f(s.length + 1).mul(f(num(g, 'mean'))).sub(f(sum(s)))
      if (!f(sum(s)).add(x).div(f(s.length + 1)).eq(f(num(g, 'mean')))) throw new Error('mean: substitution failed')
      return x
    },
  },
  'system/solve': {
    rules: systemRules,
    solve(g) {
      const xy = cramer(g)
      if (!xy) throw new Error('singular system')
      return xy[str(g, 'ask') === 'x' ? 0 : 1]
    },
  },
  'system/sum': {
    rules: systemRules,
    solve(g) {
      const xy = cramer(g)
      if (!xy) throw new Error('singular system')
      return xy[0].add(xy[1])
    },
  },
  'system/product': {
    rules: systemRules,
    solve(g) {
      const xy = cramer(g)
      if (!xy) throw new Error('singular system')
      return xy[0].mul(xy[1])
    },
  },
  'quadratic/root': {
    rules: (g) => quadRules(1, num(g, 'b'), num(g, 'c'), 15),
    solve(g) {
      const r = quadRoots(1, num(g, 'b'), num(g, 'c'))
      if (!r) throw new Error('no two rational roots')
      return str(g, 'ask') === 'larger' ? r[1] : r[0]
    },
  },
  'quadratic/scaled': {
    rules: (g) => quadRules(num(g, 'a'), num(g, 'b'), num(g, 'c'), 10),
    solve(g) {
      const r = quadRoots(num(g, 'a'), num(g, 'b'), num(g, 'c'))
      if (!r) throw new Error('no two rational roots')
      return str(g, 'ask') === 'larger' ? r[1] : r[0]
    },
  },
  'quadratic/sum_squares': {
    rules: (g) => quadRules(1, num(g, 'b'), num(g, 'c'), 15),
    solve(g) {
      const r = quadRoots(1, num(g, 'b'), num(g, 'c'))
      if (!r) throw new Error('no two rational roots')
      return r[0].mul(r[0]).add(r[1].mul(r[1]))
    },
  },
  'exponent/product': {
    rules: (g) => {
      const e = num(g, 'e1') + num(g, 'e2') - num(g, 'e3')
      return { result_exponent: e >= 2 && e <= 4 }
    },
    solve: (_g, stem) => computeExpr(stem),
  },
  'exponent/power': {
    rules: (g) => {
      const e = num(g, 'e1') * num(g, 'e2') - num(g, 'e3')
      return { result_exponent: e >= 2 && e <= 4 }
    },
    solve: (_g, stem) => computeExpr(stem),
  },
  'exponent/root': {
    rules(g) {
      const r = exactRoot(BigInt(num(g, 'base')), num(g, 'q'))
      return { non_integer_exponent: gcd(num(g, 'p'), num(g, 'q')) === 1, perfect_power: r !== null && r >= 2n && r <= 9n }
    },
    solve: (_g, stem) => computeExpr(stem),
  },
  'exponent/solve': {
    rules(g) {
      const E = exactLog(num(g, 'value'), num(g, 'base'))
      const ok = E !== null && E >= 1 && E <= 14
      return { exact_power: ok, solution_range: ok && isIntIn(f((E as number) - num(g, 'k'), num(g, 'm')), 1, 6) }
    },
    solve(g) {
      const E = exactLog(num(g, 'value'), num(g, 'base'))
      if (E === null) throw new Error('not an exact power')
      const x = f(E - num(g, 'k'), num(g, 'm'))
      if (!x.isInteger()) throw new Error('non-integer exponent solution')
      if (!f(num(g, 'base')).pow(Number(x.n) * num(g, 'm') + num(g, 'k')).eq(f(num(g, 'value')))) throw new Error('substitution failed')
      return x
    },
  },
  'probability/both': {
    rules: () => ({}),
    solve(g) {
      const want = ['red', 'blue', 'green'].indexOf(str(g, 'colour'))
      return drawTwo([num(g, 'red'), num(g, 'blue'), num(g, 'green')], (i, j) => i === want && j === want)
    },
  },
  'probability/same': {
    rules: () => ({}),
    solve: (g) => drawTwo([num(g, 'red'), num(g, 'blue'), num(g, 'green')], (i, j) => i === j),
  },
  'probability/dice': {
    rules: (g) => ({ total_possible: num(g, 'total') <= 2 * num(g, 'faces') - 1 }),
    solve(g) {
      const faces = num(g, 'faces')
      const total = num(g, 'total')
      let fav = 0
      for (let i = 1; i <= faces; i++) {
        for (let j = 1; j <= faces; j++) if (bool(g, 'at_least') ? i + j >= total : i + j === total) fav++
      }
      return f(fav, faces * faces)
    },
  },
  ...Object.fromEntries(
    (
      [
        ['plus2', false, 2, false],
        ['plus3', false, 3, false],
        ['plus4', false, 4, false],
        ['minus2', true, 2, false],
        ['minus3', true, 3, true],
      ] as const
    ).map(([variant, minus, n, oddMinus]) => [
      `recip/${variant}`,
      {
        rules(g: Given) {
          const D = num(g, 'k') ** 2 + (minus ? 4 : -4)
          return { real_distinct_roots: D > 0, irrational_roots: exactRoot(BigInt(Math.max(D, 0)), 2) === null }
        },
        solve(g: Given) {
          const v = recipValue(num(g, 'k'), minus, n, oddMinus)
          if (v === null) throw new Error('recip: no common rational value')
          return v
        },
      } satisfies Check,
    ]),
  ),
  'symmetric/sum_sq': symmetricCheck((a, b) => a.mul(a).add(b.mul(b))),
  'symmetric/diff_sq': symmetricCheck((a, b) => a.sub(b).mul(a.sub(b))),
  'symmetric/sum_cube': symmetricCheck((a, b) => a.pow(3).add(b.pow(3))),
  'arith_series/sum': { rules: () => ({}), solve: (g) => apSum(g) },
  'arith_series/first_n': { rules: (g) => ({ difference: Math.abs(num(g, 'diff')) >= 2 }), solve: (g) => apSum(g) },
  'arith_series/multiples': {
    rules(g) {
      const [m, lo, hi] = [num(g, 'm'), num(g, 'lo'), num(g, 'hi')]
      return { ends_not_multiples: lo % m !== 0 && hi % m !== 0, span: hi - lo >= 5 * m && hi - lo <= 60 * m }
    },
    solve(g) {
      let s = 0
      for (let v = num(g, 'lo'); v <= num(g, 'hi'); v++) if (v % num(g, 'm') === 0) s += v
      return f(s)
    },
  },
  'geom_series/finite': {
    rules: (g) => ({ last_term_range: Math.abs(num(g, 'first') * num(g, 'ratio') ** (num(g, 'count') - 1)) <= 1_000_000 }),
    solve(g) {
      let s = Fraction.ZERO
      let t = f(num(g, 'first'))
      for (let i = 0; i < num(g, 'count'); i++) {
        s = s.add(t)
        t = t.mul(f(num(g, 'ratio')))
      }
      return s
    },
  },
  'geom_series/infinite': {
    rules: (g) => ({ convergent: Math.abs(num(g, 'p')) < num(g, 'q'), ratio_reduced: gcd(num(g, 'p'), num(g, 'q')) === 1 }),
    solve(g) {
      // S = a + r·S  ⇒  S = a·q / (q − p); substituted back. Only a convergent series has a sum.
      const [a, p, q] = [num(g, 'first'), num(g, 'p'), num(g, 'q')]
      if (Math.abs(p) >= q) throw new Error('geom_series: the series diverges')
      const S = f(a * q, q - p)
      if (!S.sub(f(p, q).mul(S)).eq(f(a))) throw new Error('geom_series: substitution failed')
      return S
    },
  },
  'modular/power': {
    rules: (g) => ({ base_not_multiple: num(g, 'base') % num(g, 'mod') !== 0 }),
    solve: (g) => f(powMod(num(g, 'base'), num(g, 'exp'), num(g, 'mod'))),
  },
  'modular/last_digit': {
    rules: (g) => ({ interesting_digit: [2, 3, 4, 7, 8, 9].includes(num(g, 'base') % 10) }),
    solve: (g) => f(powMod(num(g, 'base'), num(g, 'exp'), 10)),
  },
  'modular/congruence': {
    rules(g) {
      const [a, c, m] = [num(g, 'a'), num(g, 'c'), num(g, 'mod')]
      return { residues: a < m && c < m, invertible: gcd(a, m) === 1, not_trivial: c !== a }
    },
    solve(g) {
      const [a, c, m] = [num(g, 'a'), num(g, 'c'), num(g, 'mod')]
      const hits: number[] = []
      for (let n = 1; n <= m; n++) if ((a * n) % m === c) hits.push(n)
      if (hits.length !== 1) throw new Error('congruence: not exactly one residue')
      return f(hits[0] as number)
    },
  },
  'counting/choose': {
    rules: (g) => ({ group_size: num(g, 'k') <= num(g, 'n') - 2 }),
    solve: (g) => Fraction.of(pascal(num(g, 'n'), num(g, 'k'))),
  },
  'counting/two_groups': {
    rules: (g) => ({
      proper_picks: num(g, 'pick_adults') < num(g, 'adults') && num(g, 'pick_children') < num(g, 'children'),
      team_size: num(g, 'pick_adults') + num(g, 'pick_children') >= 3,
    }),
    solve: (g) =>
      Fraction.of(pascal(num(g, 'adults'), num(g, 'pick_adults')) * pascal(num(g, 'children'), num(g, 'pick_children'))),
  },
  'counting/arrange': {
    rules(g) {
      const c = nums(g, 'counts')
      return { letter_total: sum(c) >= 4 && sum(c) <= 10, repeated_letter: Math.max(...c) >= 2 }
    },
    solve: (g) => Fraction.of(orderings(nums(g, 'counts'))),
  },
}

function fractionOfRules(g: Given, spent: boolean): Rules {
  const [t, a, b, c, d] = ['total', 'a', 'b', 'c', 'd'].map((k) => num(g, k)) as [number, number, number, number, number]
  return {
    proper: a < b && c < d,
    lowest_terms: gcd(a, b) === 1 && gcd(c, d) === 1,
    whole_steps: (t * a) % b === 0 && (t * (b - a) * (spent ? d - c : c)) % (b * d) === 0,
  }
}

function systemRules(g: Given): Rules {
  const xy = cramer(g)
  return { unique_solution: xy !== null, solution_range: xy !== null && isIntIn(xy[0], -9, 9) && isIntIn(xy[1], -9, 9) }
}

function quadRules(a: number, b: number, c: number, bound: number): Rules {
  const D = b * b - 4 * a * c
  const r = quadRoots(a, b, c)
  return {
    two_solutions: D > 0,
    rational_roots: r !== null,
    roots_range: r !== null && r.every((x) => isIntIn(x, -bound, bound)),
  }
}

function symmetricCheck(e: (a: Surd, b: Surd) => Surd): Check {
  return {
    rules: (g) => ({ real_distinct_roots: num(g, 's') ** 2 - 4 * num(g, 'p') > 0 }),
    solve(g) {
      const v = symmetricValue(num(g, 's'), num(g, 'p'), e)
      if (v === null) throw new Error('symmetric: no common rational value')
      return v
    },
  }
}

/** The sum of `count` terms first, first + diff, …, by adding them up. */
function apSum(g: Given): Fraction {
  let s = 0
  for (let i = 0; i < num(g, 'count'); i++) s += num(g, 'first') + i * num(g, 'diff')
  return f(s)
}

/** E with base^E = value by repeated division, or null. */
function exactLog(value: number, base: number): number | null {
  if (!(Number.isInteger(value) && value >= 1 && base >= 2)) return null
  let E = 0
  while (value > 1) {
    if (value % base !== 0) return null
    value /= base
    E++
  }
  return E
}

// --- shape checks --------------------------------------------------------------------------------

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

function fieldOk(spec: FieldSpec, v: unknown): boolean {
  switch (spec.kind) {
    case 'int':
      return isInt(v) && v >= spec.lo && v <= spec.hi && !(spec.nonzero && v === 0)
    case 'enum':
      return spec.values.some((x) => x === v)
    case 'ints':
      return Array.isArray(v) && v.length >= spec.minLen && v.length <= spec.maxLen && v.every((x) => isInt(x) && x >= spec.lo && x <= spec.hi)
  }
}

/** Every field of `variant` present and valid, and no other field. */
export function givenOk(variant: VariantDef, given: unknown): given is Given {
  if (typeof given !== 'object' || given === null || Array.isArray(given)) return false
  const keys = Object.keys(given)
  const want = Object.keys(variant.fields)
  return (
    keys.length === want.length &&
    want.every((k) => Object.hasOwn(given, k) && fieldOk(variant.fields[k] as FieldSpec, (given as Record<string, unknown>)[k]))
  )
}

const sameKeys = (o: object, keys: readonly string[]): boolean =>
  Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k))

/** The key's tolerance is exactly the one of the variant's input format. */
function toleranceOk(tol: unknown, variant: VariantDef): boolean {
  if (typeof tol !== 'object' || tol === null || Array.isArray(tol)) return false
  const want = toleranceFor(variant.format)
  return sameKeys(tol, Object.keys(want)) && Object.entries(want).every(([k, v]) => (tol as Record<string, unknown>)[k] === v)
}

/** The answer suits the input format: integers for "integer", ≤ 2 decimal places (and ≠ 0) for "decimal". */
export function fitsFormat(v: Fraction, variant: VariantDef): boolean {
  if (variant.format === 'integer') return v.isInteger()
  if (variant.format === 'decimal') return !v.isZero() && 100n % v.d === 0n
  return true
}

/** Largest |answer| the family produces. */
export const MAX_ABS_ANSWER = 10_000_000

/** The template rules of `given` (field shapes already checked); `{ unknown: false }` for a variant without a check. */
export function quantRules(variant: VariantDef, given: Given): Rules {
  const c = CHECKS[`${variant.template}/${variant.variant}`]
  return c ? c.rules(given) : { unknown: false }
}

/** The verifier's independent answer for `given` (solved from the rendered stem), or null if it cannot be solved. */
export function quantSolve(variant: VariantDef, given: Given): Fraction | null {
  const c = CHECKS[`${variant.template}/${variant.variant}`]
  if (!c) return null
  try {
    return c.solve(given, variant.render(given))
  } catch {
    return null
  }
}

export function verifyQuant(item: ItemInstance<QuantSpec, QuantKey>): VerifyResult {
  try {
    const sp = item.structural_params as { template?: unknown; variant?: unknown } | null
    const variant =
      typeof sp === 'object' && sp !== null && !Array.isArray(sp) && sameKeys(sp, ['template', 'variant'])
        ? variantOf(sp.template, sp.variant)
        : undefined
    if (!variant) return verdict({ structure_known: false })
    const spec = item.spec as unknown
    const specShape =
      typeof spec === 'object' && spec !== null && !Array.isArray(spec) && sameKeys(spec, ['stem', 'hint', 'input_format', 'given'])
    if (!specShape) return verdict({ structure_known: true, spec_fields: false })
    const { stem, hint, input_format: format, given } = item.spec
    if (!givenOk(variant, given)) return verdict({ structure_known: true, spec_fields: true, given_fields: false })

    const rules = Object.fromEntries(Object.entries(quantRules(variant, given)).map(([k, v]) => [`rule_${k}`, v]))
    const stemOk = typeof stem === 'string' && stem === variant.render(given)
    const answer = quantSolve(variant, given)

    const key = item.key as unknown
    const keyShape = typeof key === 'object' && key !== null && !Array.isArray(key) && sameKeys(key, ['value', 'tol'])
    const keyValue = keyShape ? Fraction.parseCanonical(item.key.value) : null
    const d = item.difficulty
    const feats = quantFeatures(variant.template, variant.variant, variant.stratum, variant.offset, answer !== null && !answer.isInteger())
    const featuresOk =
      typeof d.features === 'object' &&
      d.features !== null &&
      sameKeys(d.features, Object.keys(feats)) &&
      Object.entries(feats).every(([k, v]) => d.features[k] === v)
    return verdict({
      template: `${variant.template}/${variant.variant}`,
      structure_known: true,
      spec_fields: true,
      given_fields: true,
      stratum_matches: item.stratum === variant.stratum,
      input_format_matches: format === variant.format,
      hint_matches: hint === HINTS[variant.format],
      ...rules,
      stem_matches: stemOk,
      solved: answer !== null,
      key_shape: keyShape && keyValue !== null,
      key_matches: answer !== null && keyValue !== null && keyValue.eq(answer),
      tolerance_matches: keyShape && toleranceOk(item.key.tol, variant),
      answer_fits_format: answer !== null && fitsFormat(answer, variant),
      answer_magnitude: answer !== null && answer.abs().cmp(Fraction.of(MAX_ABS_ANSWER)) <= 0,
      features_match: featuresOk,
      prior_matches:
        featuresOk && Math.abs(d.b_prior - quantBPrior(feats)) <= 1e-12 && d.sd_prior === QUANT_SD_PRIOR && d.provenance === QUANT_PROVENANCE,
      time_matches: stemOk && Math.abs(item.expected_time_s - quantExpectedTime(variant.stratum as 1 | 2 | 3 | 4, stem)) <= 1e-9,
      no_options: item.options_count === undefined,
    })
  } catch (e) {
    return { ok: false, reason: `malformed item: ${String(e)}`, checks: {} }
  }
}
