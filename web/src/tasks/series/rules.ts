/**
 * Series rule families, their description length (DL) and the uniqueness analysis
 * (DESIGN §4.2 "Series", §14.6 example 2; ROADMAP M1.7). This comment is the spec that both
 * the TS family and the bank's Python twin (`hb.gen.series`) implement.
 *
 * ## Items
 *
 * An item shows m ∈ {5, 6, 7} terms t_0 … t_{m−1}; the key is the next term t_m. Integer terms
 * and the key satisfy |x| ≤ 10,000. A letter series shows single letters A–Z, read as the
 * positions A = 1 … Z = 26; every family below is fitted to the positions, and a prediction p is
 * read as the letter at position ((p − 1) mod 26) + 1.
 *
 * ## Rule families (complexity k ≤ 3: at most three coefficients besides the start terms)
 *
 * | family          | cost | DL coefficients      | rule                                          |
 * |-----------------|------|----------------------|-----------------------------------------------|
 * | `arithmetic`    | 2    | t0, d                | t_i = t0 + i·d (polynomial of degree 1)       |
 * | `quadratic`     | 4    | t0, Δ0, s            | constant 2nd difference s (degree 2)          |
 * | `cubic`         | 6    | t0, Δ0, Δ²0, Δ³      | constant 3rd difference (a competitor only)   |
 * | `geometric`     | 3    | t0, r                | t_{i+1} = r·t_i (integer r)                    |
 * | `interleaved`   | 4    | t0, da, t1, db       | t_{2j} = t0 + j·da, t_{2j+1} = t1 + j·db      |
 * | `fibonacci`     | 4    | t0, t1, c            | t_i = t_{i−1} + t_{i−2} + c                    |
 * | `composite_alt` | 6    | t0, x_a, x_b         | t_{i+1} = op_{i mod 2}(t_i), op = +x or ×x    |
 * | `composite_aff` | 6    | t0, m, c             | t_{i+1} = m·t_i + c ("×m then +c" each step)  |
 * | `letter`        | 2    | p0, d                | p_i = p0 + i·d (mod 26); letter series only   |
 *
 * Generator 1.4.0 (M3.12) adds six hard families, fitted for every 1.4.0 item (the fit set
 * {@link FIT_SETS}; a 1.3.0 item is analysed with the eight families above only):
 *
 * | family            | cost | DL coefficients      | rule                                                  |
 * |-------------------|------|----------------------|-------------------------------------------------------|
 * | `tribonacci`      | 6    | t0, t1, t2, c        | t_i = t_{i−1} + t_{i−2} + t_{i−3} + c                  |
 * | `diff_fibonacci`  | 7    | t0, Δ0, Δ1, c        | differences Δ_i = Δ_{i−1} + Δ_{i−2} + c                |
 * | `interleaved_ops` | 7    | t0, x_a, t1, x_b     | t_{i+2} = op_{i mod 2}(t_i), op = +x or ×x, one ×x    |
 * | `linear_rec`      | 8    | t0, t1, a, b         | t_i = a·t_{i−1} + b·t_{i−2}                            |
 * | `affine_index`    | 8    | t0, m, c, d          | t_{i+1} = m·t_i + c + d·i ("×m, then add c, c + d, …") |
 * | `cycle3`          | 9    | t0, x_a, x_b, x_c    | t_{i+1} = op_{i mod 3}(t_i), op = +x or ×x            |
 *
 * The cost of a family is the fixed part of its description: the number and kind of relations a
 * solver must find and hold (Simon & Kotovsky 1963; Holzman, Pellegrino & Glaser 1983), one or two
 * bits above the 1.3.0 family each one extends (Fibonacci-type → three terms; a rule on the
 * differences; a strand with its own op; weights on both earlier terms; a step that changes with
 * the index; a cycle of three ops). `linear_rec` fits a in −10 … 10 and b in −10 … 10 except 0
 * ({@link REC_WEIGHT_BOUND}); `affine_index` m in {@link MULTIPLIERS}; the ops of
 * `interleaved_ops` (strand a holds the even places; two +x strands are `interleaved`, so at least
 * one op is ×x) and `cycle3` range as the composite ops do.
 *
 * Polynomials are one family in Newton form: degree k has the coefficients t0, Δt0, …, Δ^k t0 and
 * cost 2k. Only the minimal fitting degree (≥ 1, so a constant run is arithmetic with d = 0) is a
 * candidate: a higher degree through the same points is the same function with more bits. The
 * letter step d is the representative of (p_1 − p_0) mod 26 in −12 … 13.
 *
 * DL(rule) = cost + Σ_coefficients (log2(1 + |c|) + 1): magnitude bits plus a sign bit for every
 * coefficient, start terms included. DLs are compared exactly, never in floating point: DL =
 * `bits` + log2(`prod`) with the integer `bits` = cost + number of coefficients and the bigint
 * `prod` = Π (1 + |c|), so the TS and Python verifiers cannot disagree on a tie.
 *
 * ## Fitting and verification
 *
 * Every family is fitted with every parameterisation within the bounds: composite multipliers ×x
 * range over {−10, …, −1, 2, …, 10}, additions +x over all integers (+0 included); every other
 * coefficient is determined by the terms. With min = the least DL of any fit and the
 * minimum-DL set = the fits with DL ≤ min + ε (ε = {@link EPSILON_BITS} bits), an item is valid
 * iff (§4.2 uniqueness check)
 * - every rule in the minimum-DL set predicts the same next term (for letters: the same letter);
 * - the key rule (`structural_params`) fits the terms, has DL = min and predicts the key;
 * - the part of the key rule that produces t_m is confirmed: it reproduces at least one visible
 *   term (or step) beyond those that determine it ({@link keyConfirmations}). This only bites
 *   for `interleaved` and `interleaved_ops` with m = 5, where t_5 would rest on the two-term
 *   subsequence t_1, t_3 (any step fits two terms), so their items show 6 or 7 terms, and for
 *   `cycle3`, whose items show 7 terms (each of the three ops is seen twice);
 * - DL(key rule) < DL of the degree-(n − 2) interpolating polynomial through the visible terms,
 *   where n = m + 1 is the series length counting the blank, so the degree is m − 1 and it
 *   always fits (cost 2(m − 1), coefficients t0, Δt0, …, Δ^{m−1} t0).
 *
 * The key rule's coefficients (its `structural_params`, which A11 hashes into the family_id)
 * exclude the start terms, so items differing only in where the series starts are isomorphs.
 * All constants here are [SPEC] v0.
 */

import { canonicalJson } from '../ids'

/** Fewest and most visible terms (§4.2: show 5–7 terms). */
export const MIN_VISIBLE = 5
export const MAX_VISIBLE = 7
/** Every integer term and key satisfies |x| ≤ TERM_BOUND. */
export const TERM_BOUND = 10_000
/** ε: fits whose DL is within this many bits of the minimum form the minimum-DL set ([SPEC] v0). */
export const EPSILON_BITS = 2
/** Letters A–Z are positions 1–26. */
export const ALPHABET = 26
/** The multipliers a composite ×x step may use (fitting and domain). */
export const MULTIPLIERS: readonly number[] = Object.freeze([-10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

/** The rule families of generator 1.3.0 (and of the natural pool and strata 1–4 since). */
export const LEGACY_RULE_NAMES = [
  'arithmetic',
  'geometric',
  'quadratic',
  'interleaved',
  'fibonacci',
  'composite_alt',
  'composite_aff',
  'letter',
] as const
/** The hard rule families of generator 1.4.0 (M3.12), drawn only for requested strata 5 and 6. */
export const HARD_RULE_NAMES = ['tribonacci', 'diff_fibonacci', 'interleaved_ops', 'linear_rec', 'affine_index', 'cycle3'] as const
/** The rule families an item's key rule may come from (generator 1.4.0). */
export const RULE_NAMES = [...LEGACY_RULE_NAMES, ...HARD_RULE_NAMES] as const
export type RuleName = (typeof RULE_NAMES)[number]
/** Every fitted family: the key rule families plus the cubic competitor. */
export type FitName = RuleName | 'cubic'

/**
 * The fit set of a generator version: the key rule families its analysis fits (with the cubic
 * competitor). Generator 1.3.0 fits the eight families of its time; 1.4.0 adds the hard families,
 * which then compete on every item of 1.4.0. A 1.3.0 item is analysed with the 1.3.0 set, so the
 * kept 1.3.0 generator rebuilds its items byte for byte (A11, R-8.1).
 */
export const FIT_SETS = Object.freeze({ '1.3.0': LEGACY_RULE_NAMES, '1.4.0': RULE_NAMES } as const)
export type FitSet = keyof typeof FIT_SETS
/** The fit set of the current generator. */
export const CURRENT_FIT_SET: FitSet = '1.4.0'

/** Fixed DL cost of each family in bits ([SPEC] v0, see the module table). */
export const FAMILY_COST: Readonly<Record<FitName, number>> = Object.freeze({
  arithmetic: 2,
  letter: 2,
  geometric: 3,
  quadratic: 4,
  interleaved: 4,
  fibonacci: 4,
  cubic: 6,
  composite_alt: 6,
  composite_aff: 6,
  tribonacci: 6,
  diff_fibonacci: 7,
  interleaved_ops: 7,
  linear_rec: 8,
  affine_index: 8,
  cycle3: 9,
})

/** Bound of the weights a, b of `linear_rec` (fitting and domain): |a| ≤ 10, 1 ≤ |b| ≤ 10. */
export const REC_WEIGHT_BOUND = 10

export type Op = 'add' | 'mul'

/** A rule's structural coefficients (no start terms), e.g. `{ d: 3 }` or `{ op_a: 'mul', by_a: 2, … }`. */
export type Coefficients = Readonly<Record<string, number | string>>

/** An exact description length: DL = bits + log2(prod); `approx` is the float value, for reports. */
export interface Dl {
  readonly bits: number
  readonly prod: bigint
  readonly approx: number
}

/** One fitted rule. */
export interface Fit {
  readonly rule: FitName
  readonly coefficients: Coefficients
  readonly dl: Dl
  /** The predicted next value (for a letter series, the position 1–26). */
  readonly next: number
}

/** The uniqueness analysis of a series (see the module comment). */
export interface Analysis {
  /** The visible values analysed (letters as positions 1–26). */
  readonly terms: readonly number[]
  readonly fits: readonly Fit[]
  /** The least DL of any fit (undefined when nothing fits). */
  readonly min?: Dl
  /** The fits with DL ≤ min + ε. */
  readonly minSet: readonly Fit[]
  /** The distinct next terms the minimum-DL set predicts, ascending. */
  readonly predictions: readonly number[]
  /** DL of the degree-(m − 1) interpolating polynomial through the visible terms. */
  readonly interpolant: Dl
}

/** The rule an item claims generated it (its `structural_params`). */
export interface KeyRule {
  readonly rule: RuleName
  readonly coefficients: Coefficients
}

/** Bits of one coefficient: log2(1 + |c|) + 1 sign bit. */
export function coefficientBits(c: number): number {
  return Math.log2(1 + Math.abs(c)) + 1
}

/** DL of a rule with this family cost and these coefficients (start terms included). */
export function descriptionLength(cost: number, coefficients: readonly number[]): Dl {
  let prod = 1n
  let approx = cost
  for (const c of coefficients) {
    if (!Number.isSafeInteger(c)) throw new RangeError(`descriptionLength(): coefficient ${c} is not a safe integer`)
    prod *= BigInt(1 + Math.abs(c))
    approx += coefficientBits(c)
  }
  return { bits: cost + coefficients.length, prod, approx }
}

/** Sign of DL(a) − (DL(b) + slackBits), exactly; `slackBits` is an integer ≥ 0. */
export function compareDl(a: Dl, b: Dl, slackBits = 0): -1 | 0 | 1 {
  if (!(Number.isInteger(slackBits) && slackBits >= 0)) throw new RangeError(`compareDl(): slack must be an integer ≥ 0, got ${slackBits}`)
  const lhs = a.prod << BigInt(a.bits)
  const rhs = b.prod << BigInt(b.bits + slackBits)
  return lhs < rhs ? -1 : lhs > rhs ? 1 : 0
}

/** x mod n in [0, n). */
export function mod(x: number, n: number): number {
  return ((x % n) + n) % n
}

/** The letter position 1–26 a (possibly out-of-range) position prediction reads as. */
export function toPosition(x: number): number {
  return mod(x - 1, ALPHABET) + 1
}

/** Letter A–Z → position 1–26 (undefined for anything else). */
export function letterPosition(letter: unknown): number | undefined {
  return typeof letter === 'string' && /^[A-Z]$/.test(letter) ? letter.charCodeAt(0) - 64 : undefined
}

/** Position 1–26 → letter A–Z. */
export function positionLetter(p: number): string {
  return String.fromCharCode(64 + toPosition(p))
}

/** The letter step's representative of `x` mod 26 in −12 … 13. */
export function letterStep(x: number): number {
  const r = mod(x, ALPHABET)
  return r > 13 ? r - ALPHABET : r
}

const z = (x: number): number => x + 0 // turns −0 into 0

function differences(v: readonly number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < v.length; i++) out.push((v[i] as number) - (v[i - 1] as number))
  return out
}

/** Rows Δ^0 … Δ^{m−1} of the difference table. */
function differenceTable(v: readonly number[]): number[][] {
  const rows: number[][] = [[...v]]
  while ((rows[rows.length - 1] as number[]).length > 1) rows.push(differences(rows[rows.length - 1] as number[]))
  return rows
}

const constant = (v: readonly number[]): boolean => v.every((x) => x === v[0])
const last = (v: readonly number[]): number => v[v.length - 1] as number

/** The minimal-degree polynomial (degree 1–3), or null if none of degree ≤ 3 fits. */
export function fitPolynomial(v: readonly number[]): Fit | null {
  const rows = differenceTable(v)
  let k = 1
  while (k + 1 < rows.length && !(rows[k + 1] as number[]).every((x) => x === 0)) k++
  if (k > 3) return null
  const used = rows.slice(0, k + 1)
  const params = used.map((r) => r[0] as number)
  const next = used.reduce((s, r) => s + last(r), 0)
  const lead = params[k] as number
  const rule = k === 1 ? 'arithmetic' : k === 2 ? 'quadratic' : 'cubic'
  const coefficients: Coefficients = { [k === 1 ? 'd' : k === 2 ? 's' : 'd3']: lead }
  return { rule, coefficients, dl: descriptionLength(FAMILY_COST[rule], params), next: z(next) }
}

/** DL of the degree-(m − 1) interpolating polynomial through all m visible terms. */
export function interpolantDl(v: readonly number[]): Dl {
  const rows = differenceTable(v)
  return descriptionLength(2 * (v.length - 1), rows.map((r) => r[0] as number))
}

export function fitGeometric(v: readonly number[]): Fit | null {
  const t0 = v[0] as number
  let r: number
  if (t0 === 0) {
    if (!v.every((x) => x === 0)) return null
    r = 0 // all zeros: every ratio fits and predicts 0; r = 0 is the cheapest
  } else {
    const t1 = v[1] as number
    if (t1 % t0 !== 0) return null
    r = z(t1 / t0)
  }
  for (let i = 0; i + 1 < v.length; i++) if (v[i + 1] !== r * (v[i] as number)) return null
  return { rule: 'geometric', coefficients: { r }, dl: descriptionLength(FAMILY_COST.geometric, [t0, r]), next: z(r * last(v)) }
}

export function fitInterleaved(v: readonly number[]): Fit | null {
  const even = v.filter((_, i) => i % 2 === 0)
  const odd = v.filter((_, i) => i % 2 === 1)
  const de = differences(even)
  const dd = differences(odd)
  if (de.length === 0 || dd.length === 0 || !constant(de) || !constant(dd)) return null
  const da = de[0] as number
  const db = dd[0] as number
  const next = v.length % 2 === 0 ? last(even) + da : last(odd) + db
  return {
    rule: 'interleaved',
    coefficients: { da, db },
    dl: descriptionLength(FAMILY_COST.interleaved, [v[0] as number, da, v[1] as number, db]),
    next: z(next),
  }
}

export function fitFibonacci(v: readonly number[]): Fit | null {
  if (v.length < 3) return null
  const c = (v[2] as number) - (v[1] as number) - (v[0] as number)
  for (let i = 2; i < v.length; i++) if (v[i] !== (v[i - 1] as number) + (v[i - 2] as number) + c) return null
  return {
    rule: 'fibonacci',
    coefficients: { c },
    dl: descriptionLength(FAMILY_COST.fibonacci, [v[0] as number, v[1] as number, c]),
    next: z(last(v) + (v[v.length - 2] as number) + c),
  }
}

const applyOp = (op: Op, x: number, t: number): number => z(op === 'add' ? t + x : t * x)

/** Every op that maps each pair: +x for any integer x, ×x for x in {@link MULTIPLIERS}. */
function pairOps(steps: readonly (readonly [number, number])[]): [Op, number][] {
  if (steps.length === 0) return []
  const out: [Op, number][] = []
  const [a0, b0] = steps[0] as readonly [number, number]
  const x = b0 - a0
  if (steps.every(([a, b]) => b - a === x)) out.push(['add', x])
  for (const k of MULTIPLIERS) if (steps.every(([a, b]) => b === k * a)) out.push(['mul', k])
  return out
}

/** Every op fitting the steps t_i → t_{i+lag}, i ≡ phase (mod period). */
function phaseOps(v: readonly number[], phase: number, period = 2, lag = 1): [Op, number][] {
  const steps: [number, number][] = []
  for (let i = phase; i + lag < v.length; i += period) steps.push([v[i] as number, v[i + lag] as number])
  return pairOps(steps)
}

export function fitCompositeAlt(v: readonly number[]): Fit[] {
  const out: Fit[] = []
  const nextPhase = (v.length - 1) % 2
  for (const [opA, xA] of phaseOps(v, 0)) {
    for (const [opB, xB] of phaseOps(v, 1)) {
      const next = nextPhase === 0 ? applyOp(opA, xA, last(v)) : applyOp(opB, xB, last(v))
      out.push({
        rule: 'composite_alt',
        coefficients: { op_a: opA, by_a: xA, op_b: opB, by_b: xB },
        dl: descriptionLength(FAMILY_COST.composite_alt, [v[0] as number, xA, xB]),
        next,
      })
    }
  }
  return out
}

export function fitCompositeAff(v: readonly number[]): Fit[] {
  const out: Fit[] = []
  const t0 = v[0] as number
  for (const m of MULTIPLIERS) {
    const c = z((v[1] as number) - m * t0)
    let ok = true
    for (let i = 0; ok && i + 1 < v.length; i++) ok = v[i + 1] === m * (v[i] as number) + c
    if (ok) out.push({ rule: 'composite_aff', coefficients: { m, c }, dl: descriptionLength(FAMILY_COST.composite_aff, [t0, m, c]), next: z(m * last(v) + c) })
  }
  return out
}

/** Letter-position arithmetic mod 26 on positions 1–26. */
export function fitLetter(p: readonly number[]): Fit | null {
  const d = letterStep((p[1] as number) - (p[0] as number))
  for (let i = 0; i + 1 < p.length; i++) if (mod((p[i + 1] as number) - (p[i] as number) - d, ALPHABET) !== 0) return null
  return { rule: 'letter', coefficients: { d }, dl: descriptionLength(FAMILY_COST.letter, [p[0] as number, d]), next: toPosition(last(p) + d) }
}

/** `tribonacci`: t_i = t_{i−1} + t_{i−2} + t_{i−3} + c (c fixed by t_3). */
export function fitTribonacci(v: readonly number[]): Fit | null {
  if (v.length < 4) return null
  const at = (i: number): number => v[i] as number
  const c = at(3) - at(2) - at(1) - at(0)
  for (let i = 3; i < v.length; i++) if (at(i) !== at(i - 1) + at(i - 2) + at(i - 3) + c) return null
  const m = v.length
  return {
    rule: 'tribonacci',
    coefficients: { c },
    dl: descriptionLength(FAMILY_COST.tribonacci, [at(0), at(1), at(2), c]),
    next: z(at(m - 1) + at(m - 2) + at(m - 3) + c),
  }
}

/** `diff_fibonacci`: the differences Δ_i = t_{i+1} − t_i satisfy Δ_i = Δ_{i−1} + Δ_{i−2} + c. */
export function fitDiffFibonacci(v: readonly number[]): Fit | null {
  const d = differences(v)
  if (d.length < 3) return null
  const at = (i: number): number => d[i] as number
  const c = at(2) - at(1) - at(0)
  for (let i = 2; i < d.length; i++) if (at(i) !== at(i - 1) + at(i - 2) + c) return null
  const k = d.length
  return {
    rule: 'diff_fibonacci',
    coefficients: { c },
    dl: descriptionLength(FAMILY_COST.diff_fibonacci, [v[0] as number, at(0), at(1), c]),
    next: z(last(v) + at(k - 1) + at(k - 2) + c),
  }
}

/**
 * `interleaved_ops`: two interleaved strands, each with its own op, t_{i+2} = op_{i mod 2}(t_i)
 * (+x or ×x; strand a holds the even places), at least one of them ×x (two +x strands are
 * `interleaved`).
 */
export function fitInterleavedOps(v: readonly number[]): Fit[] {
  const out: Fit[] = []
  const m = v.length
  if (m < 4) return out
  for (const [opA, xA] of phaseOps(v, 0, 2, 2)) {
    for (const [opB, xB] of phaseOps(v, 1, 2, 2)) {
      if (opA === 'add' && opB === 'add') continue
      const [op, x] = m % 2 === 0 ? [opA, xA] : [opB, xB]
      out.push({
        rule: 'interleaved_ops',
        coefficients: { op_a: opA, by_a: xA, op_b: opB, by_b: xB },
        dl: descriptionLength(FAMILY_COST.interleaved_ops, [v[0] as number, xA, v[1] as number, xB]),
        next: applyOp(op, x, v[m - 2] as number),
      })
    }
  }
  return out
}

/** `linear_rec`: t_i = a·t_{i−1} + b·t_{i−2} for every a in −10 … 10 and b in −10 … 10 except 0. */
export function fitLinearRec(v: readonly number[]): Fit[] {
  const out: Fit[] = []
  const m = v.length
  if (m < 3) return out
  const at = (i: number): number => v[i] as number
  for (let a = -REC_WEIGHT_BOUND; a <= REC_WEIGHT_BOUND; a++) {
    for (let b = -REC_WEIGHT_BOUND; b <= REC_WEIGHT_BOUND; b++) {
      if (b === 0) continue
      let ok = true
      for (let i = 2; ok && i < m; i++) ok = at(i) === a * at(i - 1) + b * at(i - 2)
      if (ok) {
        out.push({
          rule: 'linear_rec',
          coefficients: { a, b },
          dl: descriptionLength(FAMILY_COST.linear_rec, [at(0), at(1), a, b]),
          next: z(a * at(m - 1) + b * at(m - 2)),
        })
      }
    }
  }
  return out
}

/** `affine_index`: t_{i+1} = m·t_i + c + d·i (×m, then add a step that grows by d), m in {@link MULTIPLIERS}. */
export function fitAffineIndex(v: readonly number[]): Fit[] {
  const out: Fit[] = []
  const n = v.length
  if (n < 3) return out
  const t0 = v[0] as number
  for (const k of MULTIPLIERS) {
    const u: number[] = []
    for (let i = 0; i + 1 < n; i++) u.push((v[i + 1] as number) - k * (v[i] as number))
    const c = z(u[0] as number)
    const d = z((u[1] as number) - c)
    if (!u.every((x, i) => x === c + d * i)) continue
    out.push({
      rule: 'affine_index',
      coefficients: { m: k, c, d },
      dl: descriptionLength(FAMILY_COST.affine_index, [t0, k, c, d]),
      next: z(k * last(v) + c + d * (n - 1)),
    })
  }
  return out
}

/** `cycle3`: three ops (+x or ×x) applied in turn, t_{i+1} = op_{i mod 3}(t_i). */
export function fitCycle3(v: readonly number[]): Fit[] {
  const out: Fit[] = []
  const m = v.length
  if (m < 4) return out
  const nextPhase = (m - 1) % 3
  const phases = [phaseOps(v, 0, 3), phaseOps(v, 1, 3), phaseOps(v, 2, 3)]
  for (const [opA, xA] of phases[0] as [Op, number][]) {
    for (const [opB, xB] of phases[1] as [Op, number][]) {
      for (const [opC, xC] of phases[2] as [Op, number][]) {
        const ops: [Op, number][] = [
          [opA, xA],
          [opB, xB],
          [opC, xC],
        ]
        const [op, x] = ops[nextPhase] as [Op, number]
        out.push({
          rule: 'cycle3',
          coefficients: { op_a: opA, by_a: xA, op_b: opB, by_b: xB, op_c: opC, by_c: xC },
          dl: descriptionLength(FAMILY_COST.cycle3, [v[0] as number, xA, xB, xC]),
          next: applyOp(op, x, last(v)),
        })
      }
    }
  }
  return out
}

/**
 * Every fitting rule of every family of `fitSet` (for letters, fitted to the positions,
 * predictions mod 26).
 */
export function fitAll(values: readonly number[], letter: boolean, fitSet: FitSet = CURRENT_FIT_SET): Fit[] {
  const fits: Fit[] = []
  const push = (f: Fit | null): void => {
    if (f) fits.push(letter ? { ...f, next: toPosition(f.next) } : f)
  }
  push(fitPolynomial(values))
  push(fitGeometric(values))
  push(fitInterleaved(values))
  push(fitFibonacci(values))
  for (const f of fitCompositeAlt(values)) push(f)
  for (const f of fitCompositeAff(values)) push(f)
  if (fitSet !== '1.3.0') {
    push(fitTribonacci(values))
    push(fitDiffFibonacci(values))
    for (const f of fitInterleavedOps(values)) push(f)
    for (const f of fitLinearRec(values)) push(f)
    for (const f of fitAffineIndex(values)) push(f)
    for (const f of fitCycle3(values)) push(f)
  }
  if (letter) push(fitLetter(values))
  return fits
}

/** Fit every family of `fitSet` and form the minimum-DL set (see the module comment). */
export function analyse(values: readonly number[], letter: boolean, fitSet: FitSet = CURRENT_FIT_SET): Analysis {
  const fits = fitAll(values, letter, fitSet)
  const interpolant = interpolantDl(values)
  let min: Dl | undefined
  for (const f of fits) if (min === undefined || compareDl(f.dl, min) < 0) min = f.dl
  const terms = [...values]
  if (min === undefined) return { terms, fits, minSet: [], predictions: [], interpolant }
  const floor = min
  const minSet = fits.filter((f) => compareDl(f.dl, floor, EPSILON_BITS) <= 0)
  const predictions = [...new Set(minSet.map((f) => f.next))].sort((a, b) => a - b)
  return { terms, fits, min, minSet, predictions, interpolant }
}

/** Visible values that determine a rule's coefficients and start terms (the strand and cycle rules: see below). */
const DETERMINING_TERMS: Readonly<Record<Exclude<RuleName, 'interleaved' | 'interleaved_ops' | 'composite_alt' | 'cycle3'>, number>> = Object.freeze({
  arithmetic: 2, // t0, d
  letter: 2, // p0, d
  geometric: 2, // t0, r
  quadratic: 3, // t0, Δt0, s
  fibonacci: 3, // t0, t1, c
  composite_aff: 3, // t0, m, c (two steps fix m and c)
  tribonacci: 4, // t0, t1, t2, c
  diff_fibonacci: 4, // t0, Δ0, Δ1, c
  linear_rec: 4, // t0, t1, a, b (two steps fix a and b)
  affine_index: 4, // t0, m, c, d (three steps fix them)
})

/**
 * How many visible terms (or steps) confirm the part of the key rule that produces t_m, beyond
 * those that determine it, with m visible terms. `interleaved`: t_m continues the subsequence of
 * its own parity, which shows ⌊m/2⌋ terms, two of which fix its start and step. `composite_alt`:
 * t_m comes from op_{(m−1) mod 2}, seen on ⌊(m−1)/2⌋ visible steps, one of which fixes it. Every
 * other family: m minus its determining terms. `interleaved_ops` as `interleaved` (one step of
 * each strand fixes its op). `cycle3`: t_m comes from op_{(m−1) mod 3}, seen on the visible steps
 * of that phase, one of which fixes it, so of 5–7 terms only m = 7 confirms it. An item needs ≥ 1
 * (§4.2, [SPEC] v0).
 */
export function keyConfirmations(rule: RuleName, m: number): number {
  if (rule === 'interleaved' || rule === 'interleaved_ops') return Math.floor(m / 2) - 2
  if (rule === 'composite_alt') return Math.floor((m - 1) / 2) - 1
  if (rule === 'cycle3') {
    const phase = (m - 1) % 3
    return phase > m - 2 ? -1 : Math.floor((m - 2 - phase) / 3)
  }
  return m - DETERMINING_TERMS[rule]
}

/** The fit of the key rule (same family and structural coefficients), if it fits. */
export function findKeyFit(analysis: Analysis, keyRule: KeyRule): Fit | undefined {
  const want = canonicalJson(keyRule.coefficients)
  return analysis.fits.find((f) => f.rule === keyRule.rule && canonicalJson(f.coefficients) === want)
}

/** The uniqueness checks of an analysed series against its key rule and key value (§4.2). */
export function uniquenessChecks(analysis: Analysis, keyRule: KeyRule, key: number): Record<string, boolean | number> {
  const fit = findKeyFit(analysis, keyRule)
  return {
    key_rule_fits: fit !== undefined,
    key_is_rule_prediction: fit !== undefined && fit.next === key,
    key_rule_is_min_dl: fit !== undefined && analysis.min !== undefined && compareDl(fit.dl, analysis.min) <= 0,
    key_rule_confirmed: keyConfirmations(keyRule.rule, analysis.terms.length) >= 1,
    min_dl_rules_agree: analysis.predictions.length === 1,
    simpler_than_interpolant: fit !== undefined && compareDl(fit.dl, analysis.interpolant) < 0,
    fits: analysis.fits.length,
    min_dl_set: analysis.minSet.length,
    key_rule_dl_bits: fit === undefined ? -1 : round3(fit.dl.approx),
    interpolant_dl_bits: round3(analysis.interpolant.approx),
  }
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const hasExactly = (c: Coefficients, names: readonly string[]): boolean => {
  const keys = Object.keys(c).sort()
  return keys.length === names.length && [...names].sort().every((n, i) => keys[i] === n)
}
const isOp = (op: unknown, x: unknown): boolean =>
  (op === 'add' && isInt(x) && x !== 0) || (op === 'mul' && isInt(x) && MULTIPLIERS.includes(x))

/**
 * Whether `coefficients` are a valid key rule of `rule` (the generator's domain): no zero steps,
 * |r| ≥ 2, letter steps 1 ≤ |d| ≤ 12, composite ops +x (x ≠ 0) or ×x (x in {@link MULTIPLIERS});
 * `interleaved_ops` has at least one ×x strand, `cycle3` at least one +x and one ×x op,
 * `linear_rec` |a| ≤ 10 and 1 ≤ |b| ≤ 10, `affine_index` d ≠ 0 (d = 0 is `composite_aff`).
 */
export function inRuleDomain(rule: RuleName, c: Coefficients): boolean {
  switch (rule) {
    case 'arithmetic':
      return hasExactly(c, ['d']) && isInt(c.d) && c.d !== 0
    case 'geometric':
      return hasExactly(c, ['r']) && isInt(c.r) && Math.abs(c.r) >= 2
    case 'quadratic':
      return hasExactly(c, ['s']) && isInt(c.s) && c.s !== 0
    case 'interleaved':
      return hasExactly(c, ['da', 'db']) && isInt(c.da) && isInt(c.db) && !(c.da === 0 && c.db === 0)
    case 'fibonacci':
      return hasExactly(c, ['c']) && isInt(c.c)
    case 'composite_alt':
      return hasExactly(c, ['op_a', 'by_a', 'op_b', 'by_b']) && isOp(c.op_a, c.by_a) && isOp(c.op_b, c.by_b)
    case 'composite_aff':
      return hasExactly(c, ['m', 'c']) && isInt(c.m) && MULTIPLIERS.includes(c.m) && isInt(c.c) && c.c !== 0
    case 'letter':
      return hasExactly(c, ['d']) && isInt(c.d) && Math.abs(c.d) >= 1 && Math.abs(c.d) <= 12
    case 'tribonacci':
    case 'diff_fibonacci':
      return hasExactly(c, ['c']) && isInt(c.c)
    case 'interleaved_ops':
      return hasExactly(c, ['op_a', 'by_a', 'op_b', 'by_b']) && isOp(c.op_a, c.by_a) && isOp(c.op_b, c.by_b) && (c.op_a === 'mul' || c.op_b === 'mul')
    case 'linear_rec':
      return (
        hasExactly(c, ['a', 'b']) &&
        isInt(c.a) &&
        isInt(c.b) &&
        Math.abs(c.a) <= REC_WEIGHT_BOUND &&
        Math.abs(c.b) >= 1 &&
        Math.abs(c.b) <= REC_WEIGHT_BOUND
      )
    case 'affine_index':
      return hasExactly(c, ['m', 'c', 'd']) && isInt(c.m) && MULTIPLIERS.includes(c.m) && isInt(c.c) && isInt(c.d) && c.d !== 0
    case 'cycle3': {
      const ops = [c.op_a, c.op_b, c.op_c]
      return (
        hasExactly(c, ['op_a', 'by_a', 'op_b', 'by_b', 'op_c', 'by_c']) &&
        isOp(c.op_a, c.by_a) &&
        isOp(c.op_b, c.by_b) &&
        isOp(c.op_c, c.by_c) &&
        ops.includes('add') &&
        ops.includes('mul')
      )
    }
  }
}

/** Whether `v` names a key rule family of `fitSet`. */
export function isRuleName(v: unknown, fitSet: FitSet = CURRENT_FIT_SET): v is RuleName {
  return typeof v === 'string' && (FIT_SETS[fitSet] as readonly string[]).includes(v)
}
