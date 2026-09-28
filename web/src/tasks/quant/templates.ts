/**
 * The quant templates (M1.8; DESIGN §3 row 6, §4.2 "Math", §14.6 example 3). This table is the
 * family's spec: the bank's Python twin (`hb.gen.quant`) re-implements it independently and must
 * agree on every rule, range and stem below (the A1 cross-check compares them on 1,000 items).
 *
 * An item is one *variant* of a *template*; `structural_params = { template, variant }`, so the
 * family_id is the template variant (A11: isomorphs differ only in their numbers). A variant is
 * a stem template in A11's sense (its own fields, stem and answer route); `template` groups
 * variants by topic. Hashing the topic alone would leave 4 families in each of strata 1–3, below
 * the 6S per stratum that per-user family exclusion needs (§7.7), so sibling variants of one
 * trick (recip/*, system/*, symmetric/*, …) are excluded per session instead: the near-isomorph
 * sets are `QUANT_SIBLING_GROUPS` in `engine/selector.ts` (M1.14, A11). Its `spec` is
 * `{ stem, hint, input_format, given }`: `given` holds exactly the quantities the stem shows
 * (never the solution: no roots, no x₀), and the stem is rendered from it. Numbers are integers;
 * negatives render with "−" (U+2212); `lin` renders a linear combination ("3x − y", "x^2 − 5x + 6").
 *
 * Strata (§6.ii): 1 arithmetic, percentages, fractions; 2 ratios/rates, linear equations,
 * averages; 3 2×2 systems, quadratics with integer roots, exponent rules, exact probability;
 * 4 symmetric-function tricks (x + 1/x = k), arithmetic/geometric series, modular arithmetic,
 * counting. Parameters are drawn so answers are "nice": integers, short fractions, or decimals
 * with at most two places.
 *
 * Answer formats: `integer` and `fraction` keys use tolerance `{ abs: 0 }` (exact). `decimal`
 * keys are exact terminating decimals with at most two places (sale prices, half-unit speeds), so
 * they use `{ abs: 0.005 }`: exactly the entries that round to the key at two places. §4.2's
 * `{ rel: 0.005 }` is for answers that need rounding, which no v0 template has; on these answers it
 * would accept rounding to the dollar and classic slips (the plain mean of the leg speeds), so it
 * is not used (review fix; recorded as a followup against the spec).
 */

import type { JsonValue, Rng } from '../../engine'
import type { EntryFormat } from '../family'
import type { Stratum } from '../ids'
import { Fraction, bigGcd, frac } from './fraction'

/** The quant entry formats: the shared {@link EntryFormat} vocabulary without letters. */
export type InputFormat = Exclude<EntryFormat, 'letter'>

/** The `given` object of an item's spec: the quantities its stem shows. */
export type Given = { readonly [k: string]: JsonValue }

/** A `given` field's allowed values (checked by the verifiers before any rule). */
export type FieldSpec =
  | { readonly kind: 'int'; readonly lo: number; readonly hi: number; readonly nonzero?: true }
  | { readonly kind: 'enum'; readonly values: readonly (string | number | boolean)[] }
  | { readonly kind: 'ints'; readonly minLen: number; readonly maxLen: number; readonly lo: number; readonly hi: number }

export interface VariantDef {
  readonly template: string
  readonly variant: string
  readonly stratum: Stratum
  readonly format: InputFormat
  /** [SPEC v0] per-variant offset added to the stratum anchor of the b prior (see `prior.ts`). */
  readonly offset: number
  /** Every field of `given`, with its allowed values; `given` has exactly these fields. */
  readonly fields: Readonly<Record<string, FieldSpec>>
  /** Draw a valid `given` from `rng` only. */
  draw(rng: Rng): Given
  /** The stem shown to the person. */
  render(g: Given): string
  /** The generator's route to the answer (the verifier recomputes it by another route). */
  compute(g: Given): Fraction
}

export const TOL_EXACT = Object.freeze({ abs: 0 })
/** Half a hundredth: the key has ≤ 2 decimal places, so this accepts the entries that round to it. */
export const TOL_DECIMAL = Object.freeze({ abs: 0.005 })

/** Input hints shown under the entry box, by format. */
export const HINTS: Readonly<Record<InputFormat, string>> = Object.freeze({
  integer: 'Enter an integer, such as 42 or -7.',
  decimal: 'Enter a number; decimals are fine, such as 12.5.',
  fraction: 'Enter a fraction such as 3/8, or an integer.',
})

export const THINGS = Object.freeze(['jacket', 'lamp', 'backpack', 'board game', 'toaster', 'desk chair', 'kettle', 'tent'])
export const NAMES = Object.freeze(['Maya', 'Sam', 'Priya', 'Leo', 'Ana', 'Kenji', 'Zoe', 'Omar'])
export const COLOURS = Object.freeze(['red', 'blue', 'green', 'yellow', 'white', 'black'])
const NUMBER_WORDS: Readonly<Record<number, string>> = { 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven' }

// --- field access (the verifier has checked the shape before any of these run) ----------------

export const num = (g: Given, k: string): number => {
  const v = g[k]
  if (typeof v !== 'number') throw new TypeError(`given.${k} is not a number`)
  return v
}
export const str = (g: Given, k: string): string => {
  const v = g[k]
  if (typeof v !== 'string') throw new TypeError(`given.${k} is not a string`)
  return v
}
export const bool = (g: Given, k: string): boolean => {
  const v = g[k]
  if (typeof v !== 'boolean') throw new TypeError(`given.${k} is not a boolean`)
  return v
}
export const nums = (g: Given, k: string): number[] => {
  const v = g[k]
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'number')) throw new TypeError(`given.${k} is not a number list`)
  return v as number[]
}

// --- rendering ---------------------------------------------------------------------------------

/** An integer with "−" (U+2212) for negatives. */
export const signed = (x: number): string => (x < 0 ? `−${-x}` : `${x}`)
/** A series term: negatives in parentheses, "(−6)". */
export const paren = (x: number): string => (x < 0 ? `(${signed(x)})` : `${x}`)
/** A rational: "p/q" or "p", "−" for negatives. */
export const ratText = (f: Fraction): string => (f.sign() < 0 ? `−${f.neg().toString()}` : f.toString())
/** A rational series term: negatives in parentheses. */
export const ratTerm = (f: Fraction): string => (f.sign() < 0 ? `(${ratText(f)})` : ratText(f))

/**
 * A linear combination Σ cᵢ·symᵢ (sym "" for the constant): zero terms are skipped; the first
 * term carries "−" directly ("−3x"), later ones " + " / " − "; a unit coefficient is dropped
 * before a symbol ("x", "− y"); all-zero renders "0".
 */
export function lin(terms: readonly (readonly [number, string])[]): string {
  let out = ''
  for (const [c, sym] of terms) {
    if (c === 0) continue
    const mag = Math.abs(c) === 1 && sym !== '' ? sym : `${Math.abs(c)}${sym}`
    out += out === '' ? (c < 0 ? `−${mag}` : mag) : c < 0 ? ` − ${mag}` : ` + ${mag}`
  }
  return out === '' ? '0' : out
}

/** "a, b, c and d". */
export function listText(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] as string}`
}

export const numberWord = (k: number): string => {
  const w = NUMBER_WORDS[k]
  if (w === undefined) throw new RangeError(`no number word for ${k}`)
  return w
}
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
const hours = (t: number): string => (t === 1 ? '1 hour' : `${t} hours`)

// --- drawing helpers ---------------------------------------------------------------------------

/** Draw until `ok` (rejection sampling); throws if a template's constraints are unsatisfiable. */
function until<T>(draw: () => T, ok: (v: T) => boolean, what: string): T {
  for (let i = 0; i < 10_000; i++) {
    const v = draw()
    if (ok(v)) return v
  }
  throw new Error(`quant: could not draw ${what}`)
}
const nonzero = (rng: Rng, lo: number, hi: number): number => until(() => rng.int(lo, hi), (v) => v !== 0, 'a non-zero integer')
const gcd = (a: number, b: number): number => Number(bigGcd(BigInt(a), BigInt(b)))
/** A proper fraction a/b in lowest terms with b in [bLo, bHi]. */
const properFraction = (rng: Rng, bLo: number, bHi: number): [number, number] => {
  const b = rng.int(bLo, bHi)
  const a = until(() => rng.int(1, b - 1), (x) => gcd(x, b) === 1, 'a reduced numerator')
  return [a, b]
}
/** Integer power as a Fraction. */
const ipow = (b: number, e: number): Fraction => frac(BigInt(b) ** BigInt(e))

const int = (lo: number, hi: number, nz = false): FieldSpec => (nz ? { kind: 'int', lo, hi, nonzero: true } : { kind: 'int', lo, hi })
const oneOf = (...values: (string | number | boolean)[]): FieldSpec => ({ kind: 'enum', values })

// --- the templates -----------------------------------------------------------------------------

const V = (d: VariantDef): VariantDef => Object.freeze(d)

const S1: VariantDef[] = [
  // (1) multi-step arithmetic
  V({
    template: 'arith', variant: 'mul_sub_div', stratum: 1, format: 'integer', offset: -0.1,
    fields: { a: int(12, 49), b: int(3, 9), c: int(12, 171), d: int(3, 9) },
    draw(rng) {
      const a = rng.int(12, 49), b = rng.int(3, 9), d = rng.int(3, 9)
      return { a, b, c: d * rng.int(4, 19), d }
    },
    render: (g) => `Compute ${num(g, 'a')} × ${num(g, 'b')} − ${num(g, 'c')} ÷ ${num(g, 'd')}.`,
    compute: (g) => frac(num(g, 'a') * num(g, 'b') - num(g, 'c') / num(g, 'd')),
  }),
  V({
    template: 'arith', variant: 'group_mul', stratum: 1, format: 'integer', offset: -0.2,
    fields: { a: int(11, 59), b: int(11, 59), c: int(3, 9), e: int(10, 99) },
    draw: (rng) =>
      until(
        () => ({ a: rng.int(11, 59), b: rng.int(11, 59), c: rng.int(3, 9), e: rng.int(10, 99) }),
        (g) => (g.a + g.b) * g.c - g.e >= 1,
        'group_mul',
      ),
    render: (g) => `Compute (${num(g, 'a')} + ${num(g, 'b')}) × ${num(g, 'c')} − ${num(g, 'e')}.`,
    compute: (g) => frac((num(g, 'a') + num(g, 'b')) * num(g, 'c') - num(g, 'e')),
  }),
  V({
    template: 'arith', variant: 'div_chain', stratum: 1, format: 'integer', offset: 0,
    fields: { a: int(12, 180), b: int(3, 12), c: int(2, 9), e: int(5, 50) },
    draw(rng) {
      const b = rng.int(3, 12)
      return { a: b * rng.int(4, 15), b, c: rng.int(2, 9), e: rng.int(5, 50) }
    },
    render: (g) => `Compute ${num(g, 'a')} ÷ ${num(g, 'b')} × ${num(g, 'c')} + ${num(g, 'e')}.`,
    compute: (g) => frac((num(g, 'a') / num(g, 'b')) * num(g, 'c') + num(g, 'e')),
  }),
  // (1) percentages
  V({
    template: 'percent', variant: 'of', stratum: 1, format: 'integer', offset: -0.3,
    fields: { p: int(5, 95), n: int(10, 999) },
    draw(rng) {
      const p = 5 * until(() => rng.int(1, 19), (i) => i !== 10, 'a percentage')
      const step = 100 / gcd(p, 100)
      return { p, n: step * rng.int(Math.ceil(10 / step), Math.floor(999 / step)) }
    },
    render: (g) => `What is ${num(g, 'p')}% of ${num(g, 'n')}?`,
    compute: (g) => frac(num(g, 'p') * num(g, 'n'), 100),
  }),
  V({
    template: 'percent', variant: 'discount', stratum: 1, format: 'decimal', offset: 0,
    fields: { thing: oneOf(...THINGS), price: int(12, 250), p: oneOf(5, 10, 15, 20, 25, 30, 35, 40, 45, 60, 70) },
    draw: (rng) => ({ thing: rng.pick(THINGS), price: rng.int(12, 250), p: rng.pick([5, 10, 15, 20, 25, 30, 35, 40, 45, 60, 70]) }),
    render: (g) =>
      `A ${str(g, 'thing')} costs $${num(g, 'price')}. In a sale, its price is cut by ${num(g, 'p')}%. What is the sale price, in dollars?`,
    compute: (g) => frac(num(g, 'price') * (100 - num(g, 'p')), 100),
  }),
  V({
    template: 'percent', variant: 'change', stratum: 1, format: 'integer', offset: 0.2,
    fields: { thing: oneOf(...THINGS), before: int(10, 400), after: int(4, 720) },
    draw(rng) {
      const thing = rng.pick(THINGS)
      const rise = rng.int(0, 1) === 1
      const p = 5 * rng.int(1, rise ? 16 : 12)
      const step = 100 / gcd(p, 100)
      const before = step * rng.int(Math.ceil(10 / step), Math.floor(400 / step))
      return { thing, before, after: (before * (rise ? 100 + p : 100 - p)) / 100 }
    },
    render(g) {
      const verb = num(g, 'after') > num(g, 'before') ? 'rise' : 'fall'
      return `The price of a ${str(g, 'thing')} ${verb}s from $${num(g, 'before')} to $${num(g, 'after')}. By what percentage did the price ${verb}?`
    },
    compute: (g) => frac(100 * Math.abs(num(g, 'after') - num(g, 'before')), num(g, 'before')),
  }),
  // (1) fractions
  V({
    template: 'fraction', variant: 'add_sub', stratum: 1, format: 'fraction', offset: -0.1,
    fields: { a: int(1, 11), b: int(2, 12), c: int(1, 11), d: int(2, 12), op: oneOf('add', 'sub') },
    draw(rng) {
      let [a, b] = properFraction(rng, 2, 12)
      let [c, d] = until(() => properFraction(rng, 2, 12), ([, y]) => y !== b, 'a second denominator')
      const op = rng.pick(['add', 'sub'])
      if (op === 'sub' && a * d < c * b) [a, b, c, d] = [c, d, a, b]
      return { a, b, c, d, op }
    },
    render: (g) =>
      `Compute ${num(g, 'a')}/${num(g, 'b')} ${str(g, 'op') === 'add' ? '+' : '−'} ${num(g, 'c')}/${num(g, 'd')}.`,
    compute(g) {
      const x = frac(num(g, 'a'), num(g, 'b'))
      const y = frac(num(g, 'c'), num(g, 'd'))
      return str(g, 'op') === 'add' ? x.add(y) : x.sub(y)
    },
  }),
  V({
    template: 'fraction', variant: 'mul_div', stratum: 1, format: 'fraction', offset: 0,
    fields: { a: int(1, 11), b: int(2, 12), c: int(1, 11), d: int(2, 12), op: oneOf('mul', 'div') },
    draw(rng) {
      const [a, b] = properFraction(rng, 2, 12)
      const [c, d] = properFraction(rng, 2, 12)
      return { a, b, c, d, op: rng.pick(['mul', 'div']) }
    },
    render: (g) =>
      `Compute (${num(g, 'a')}/${num(g, 'b')}) ${str(g, 'op') === 'mul' ? '×' : '÷'} (${num(g, 'c')}/${num(g, 'd')}).`,
    compute(g) {
      const x = frac(num(g, 'a'), num(g, 'b'))
      const y = frac(num(g, 'c'), num(g, 'd'))
      return str(g, 'op') === 'mul' ? x.mul(y) : x.div(y)
    },
  }),
  // (1) fractions of quantities
  V({
    template: 'fraction_of', variant: 'rest', stratum: 1, format: 'integer', offset: 0.1,
    fields: { total: int(12, 960), a: int(1, 5), b: int(2, 6), c: int(1, 5), d: int(2, 6) },
    draw(rng) {
      const [a, b] = properFraction(rng, 2, 6)
      const [c, d] = properFraction(rng, 2, 6)
      return { total: b * d * rng.int(Math.ceil(12 / (b * d)), Math.floor(960 / (b * d))), a, b, c, d }
    },
    render: (g) =>
      `A school has ${num(g, 'total')} students. ${num(g, 'a')}/${num(g, 'b')} of them take the bus, and ${num(g, 'c')}/${num(g, 'd')} of the rest walk. How many students walk?`,
    compute: (g) =>
      frac(num(g, 'total')).mul(frac(1).sub(frac(num(g, 'a'), num(g, 'b')))).mul(frac(num(g, 'c'), num(g, 'd'))),
  }),
  V({
    template: 'fraction_of', variant: 'spent', stratum: 1, format: 'integer', offset: 0.2,
    fields: { name: oneOf(...NAMES), total: int(12, 960), a: int(1, 5), b: int(2, 6), c: int(1, 5), d: int(2, 6) },
    draw(rng) {
      const name = rng.pick(NAMES)
      const [a, b] = properFraction(rng, 2, 6)
      const [c, d] = properFraction(rng, 2, 6)
      return { name, total: b * d * rng.int(Math.ceil(12 / (b * d)), Math.floor(960 / (b * d))), a, b, c, d }
    },
    render: (g) =>
      `${str(g, 'name')} has $${num(g, 'total')}, spends ${num(g, 'a')}/${num(g, 'b')} of it on a book, and then spends ${num(g, 'c')}/${num(g, 'd')} of the money that is left on lunch. How many dollars does ${str(g, 'name')} have left?`,
    compute: (g) =>
      frac(num(g, 'total'))
        .mul(frac(1).sub(frac(num(g, 'a'), num(g, 'b'))))
        .mul(frac(1).sub(frac(num(g, 'c'), num(g, 'd')))),
  }),
]

const S2: VariantDef[] = [
  // (2) ratios
  V({
    template: 'ratio', variant: 'share', stratum: 2, format: 'integer', offset: -0.2,
    fields: { name1: oneOf(...NAMES), name2: oneOf(...NAMES), total: int(6, 680), a: int(1, 9), b: int(1, 9) },
    draw(rng) {
      const [name1, name2] = rng.shuffle(NAMES).slice(0, 2) as [string, string]
      const [a, b] = until(() => [rng.int(1, 9), rng.int(1, 9)] as const, ([x, y]) => x !== y && gcd(x, y) === 1, 'a ratio')
      return { name1, name2, total: (a + b) * rng.int(2, 40), a, b }
    },
    render: (g) =>
      `${str(g, 'name1')} and ${str(g, 'name2')} share $${num(g, 'total')} in the ratio ${num(g, 'a')} : ${num(g, 'b')}. How many dollars does ${str(g, 'name2')} get?`,
    compute: (g) => frac(num(g, 'total') * num(g, 'b'), num(g, 'a') + num(g, 'b')),
  }),
  V({
    template: 'ratio', variant: 'total', stratum: 2, format: 'integer', offset: -0.1,
    fields: { colour1: oneOf(...COLOURS), colour2: oneOf(...COLOURS), a: int(1, 9), b: int(1, 9), count: int(2, 270) },
    draw(rng) {
      const [colour1, colour2] = rng.shuffle(COLOURS).slice(0, 2) as [string, string]
      const [a, b] = until(() => [rng.int(1, 9), rng.int(1, 9)] as const, ([x, y]) => x !== y && gcd(x, y) === 1, 'a ratio')
      return { colour1, colour2, a, b, count: a * rng.int(2, 30) }
    },
    render: (g) =>
      `A jar holds only ${str(g, 'colour1')} and ${str(g, 'colour2')} marbles, in the ratio ${num(g, 'a')} : ${num(g, 'b')}. There are ${num(g, 'count')} ${str(g, 'colour1')} marbles. How many marbles are in the jar?`,
    compute: (g) => frac(num(g, 'count') * (num(g, 'a') + num(g, 'b')), num(g, 'a')),
  }),
  V({
    template: 'ratio', variant: 'three_way', stratum: 2, format: 'integer', offset: 0,
    fields: { total: int(8, 810), a: int(1, 9), b: int(1, 9), c: int(1, 9) },
    draw(rng) {
      const [a, b, c] = until(
        () => [rng.int(1, 9), rng.int(1, 9), rng.int(1, 9)] as const,
        ([x, y, z]) => gcd(gcd(x, y), z) === 1 && !(x === y && y === z),
        'a three-way ratio',
      )
      return { total: (a + b + c) * rng.int(2, 30), a, b, c }
    },
    render: (g) =>
      `The number ${num(g, 'total')} is split into three parts in the ratio ${num(g, 'a')} : ${num(g, 'b')} : ${num(g, 'c')}. What is the largest part?`,
    compute: (g) =>
      frac(num(g, 'total') * Math.max(num(g, 'a'), num(g, 'b'), num(g, 'c')), num(g, 'a') + num(g, 'b') + num(g, 'c')),
  }),
  // (2) rates
  V({
    template: 'rate', variant: 'unit', stratum: 2, format: 'integer', offset: -0.2,
    fields: { setting: oneOf('bottles', 'pages', 'labels'), count: int(6, 480), t1: int(2, 12), t2: int(3, 30) },
    draw(rng) {
      const setting = rng.pick(['bottles', 'pages', 'labels'])
      const t1 = rng.int(2, 12)
      const t2 = until(() => rng.int(3, 30), (t) => t !== t1, 'a second time')
      return { setting, count: t1 * rng.int(3, 40), t1, t2 }
    },
    render(g) {
      const [q, t1, t2] = [num(g, 'count'), num(g, 't1'), num(g, 't2')]
      switch (str(g, 'setting')) {
        case 'bottles':
          return `A machine fills ${q} bottles in ${t1} minutes. At the same rate, how many bottles does it fill in ${t2} minutes?`
        case 'pages':
          return `A printer prints ${q} pages in ${t1} minutes. At the same rate, how many pages does it print in ${t2} minutes?`
        default:
          return `A machine prints ${q} labels in ${t1} minutes. At the same rate, how many labels does it print in ${t2} minutes?`
      }
    },
    compute: (g) => frac(num(g, 'count') * num(g, 't2'), num(g, 't1')),
  }),
  V({
    template: 'rate', variant: 'avg_speed', stratum: 2, format: 'decimal', offset: 0.2,
    fields: { d1: int(1, 180), t1: int(1, 4), d2: int(1, 180), t2: int(1, 4) },
    draw: (rng) =>
      until(
        () => {
          const t1 = rng.int(1, 4)
          const t2 = rng.int(1, 4)
          const T = t1 + t2
          const v2 = until(() => rng.int(20, 60), (v) => (v * T) % 2 === 0, 'an even distance')
          const D = (v2 * T) / 2
          const d1 = rng.int(Math.max(1, 5 * t1), Math.max(1, Math.min(45 * t1, D - 1)))
          return { d1, t1, d2: D - d1, t2 }
        },
        // t1 ≠ t2, or the time-weighted mean is the plain mean of the leg speeds (no trap).
        (g) => g.t1 !== g.t2 && g.d2 >= 5 * g.t2 && g.d2 <= 45 * g.t2 && g.d1 * g.t2 !== g.d2 * g.t1 && g.d1 < 181 && g.d2 < 181,
        'avg_speed',
      ),
    render: (g) =>
      `A cyclist rides ${num(g, 'd1')} km in ${hours(num(g, 't1'))} and then ${num(g, 'd2')} km in ${hours(num(g, 't2'))}. What is the average speed for the whole ride, in km/h?`,
    compute: (g) => frac(num(g, 'd1') + num(g, 'd2'), num(g, 't1') + num(g, 't2')),
  }),
  V({
    template: 'rate', variant: 'together', stratum: 2, format: 'fraction', offset: 0.3,
    fields: { setting: oneOf('pipes', 'painters'), a: int(2, 24), b: int(2, 24) },
    draw(rng) {
      const setting = rng.pick(['pipes', 'painters'])
      const [a, b] = until(() => [rng.int(2, 24), rng.int(2, 24)] as const, ([x, y]) => x < y, 'two times')
      return { setting, a, b }
    },
    render(g) {
      const [a, b] = [num(g, 'a'), num(g, 'b')]
      return str(g, 'setting') === 'pipes'
        ? `One pipe can fill a tank in ${a} hours, and another pipe can fill it in ${b} hours. Working together, how many hours do the two pipes take to fill the tank?`
        : `One painter can paint a fence in ${a} hours, and another painter can paint it in ${b} hours. Working together, how many hours do the two painters take to paint the fence?`
    },
    compute: (g) => frac(num(g, 'a') * num(g, 'b'), num(g, 'a') + num(g, 'b')),
  }),
  // (2) simple linear equations
  V({
    template: 'linear_eq', variant: 'both_sides', stratum: 2, format: 'integer', offset: -0.1,
    fields: { a: int(2, 12), b: int(-30, 30, true), c: int(1, 11), d: int(-200, 200, true) },
    draw: (rng) =>
      until(
        () => {
          const a = rng.int(2, 12)
          const c = until(() => rng.int(1, 11), (x) => x !== a, 'a second coefficient')
          const x0 = nonzero(rng, -15, 15)
          const b = nonzero(rng, -30, 30)
          return { a, b, c, d: (a - c) * x0 + b }
        },
        (g) => g.d !== 0 && Math.abs(g.d) <= 200,
        'both_sides',
      ),
    render: (g) =>
      `Solve for x: ${lin([[num(g, 'a'), 'x'], [num(g, 'b'), '']])} = ${lin([[num(g, 'c'), 'x'], [num(g, 'd'), '']])}.`,
    compute: (g) => frac(num(g, 'd') - num(g, 'b'), num(g, 'a') - num(g, 'c')),
  }),
  V({
    template: 'linear_eq', variant: 'brackets', stratum: 2, format: 'integer', offset: 0.1,
    fields: { a: int(2, 9), b: int(-12, 12, true), c: int(1, 12), d: int(-300, 300, true) },
    draw: (rng) =>
      until(
        () => {
          const a = rng.int(2, 9)
          const b = nonzero(rng, -12, 12)
          const c = until(() => rng.int(1, 12), (x) => x !== a, 'a second coefficient')
          const x0 = nonzero(rng, -12, 12)
          return { a, b, c, d: a * (x0 + b) - c * x0 }
        },
        (g) => g.d !== 0 && Math.abs(g.d) <= 300,
        'brackets',
      ),
    render: (g) =>
      `Solve for x: ${num(g, 'a')}(${lin([[1, 'x'], [num(g, 'b'), '']])}) = ${lin([[num(g, 'c'), 'x'], [num(g, 'd'), '']])}.`,
    compute: (g) => frac(num(g, 'd') - num(g, 'a') * num(g, 'b'), num(g, 'a') - num(g, 'c')),
  }),
  V({
    template: 'linear_eq', variant: 'over', stratum: 2, format: 'integer', offset: -0.3,
    fields: { p: int(2, 9), b: int(-20, 20, true), c: int(-40, 40) },
    draw(rng) {
      const p = rng.int(2, 9)
      const b = nonzero(rng, -20, 20)
      return { p, b, c: until(() => rng.int(-40, 40), (c) => c !== b, 'a right-hand side') }
    },
    render: (g) => `Solve for x: ${lin([[1, `x/${num(g, 'p')}`], [num(g, 'b'), '']])} = ${signed(num(g, 'c'))}.`,
    compute: (g) => frac(num(g, 'p') * (num(g, 'c') - num(g, 'b'))),
  }),
  // (2) averages
  V({
    template: 'mean', variant: 'missing', stratum: 2, format: 'integer', offset: -0.1,
    fields: { count: int(4, 7), mean: int(8, 40), known: { kind: 'ints', minLen: 3, maxLen: 6, lo: 1, hi: 60 } },
    draw: (rng) =>
      until(
        () => {
          const count = rng.int(4, 7)
          const known = Array.from({ length: count - 1 }, () => rng.int(1, 60))
          return { count, mean: rng.int(8, 40), known }
        },
        (g) => {
          const m = g.count * g.mean - g.known.reduce((s, v) => s + v, 0)
          return m >= 1 && m <= 99
        },
        'mean/missing',
      ),
    render: (g) =>
      `The mean of ${numberWord(num(g, 'count'))} numbers is ${num(g, 'mean')}. ${cap(numberWord(num(g, 'count') - 1))} of the numbers are ${listText(nums(g, 'known').map(String))}. What is the remaining number?`,
    compute: (g) => frac(num(g, 'count') * num(g, 'mean') - nums(g, 'known').reduce((s, v) => s + v, 0)),
  }),
  V({
    template: 'mean', variant: 'target', stratum: 2, format: 'integer', offset: 0,
    fields: { name: oneOf(...NAMES), scores: { kind: 'ints', minLen: 3, maxLen: 5, lo: 50, hi: 100 }, mean: int(60, 95) },
    draw: (rng) =>
      until(
        () => {
          const k = rng.int(3, 5)
          return { name: rng.pick(NAMES), scores: Array.from({ length: k }, () => rng.int(50, 100)), mean: rng.int(60, 95) }
        },
        (g) => {
          const need = (g.scores.length + 1) * g.mean - g.scores.reduce((s, v) => s + v, 0)
          return need >= 0 && need <= 100
        },
        'mean/target',
      ),
    render(g) {
      const s = nums(g, 'scores')
      return `${str(g, 'name')} scored ${listText(s.map(String))} on ${numberWord(s.length)} tests. What score on the next test would make the mean of all ${numberWord(s.length + 1)} tests exactly ${num(g, 'mean')}?`
    },
    compute(g) {
      const s = nums(g, 'scores')
      return frac((s.length + 1) * num(g, 'mean') - s.reduce((t, v) => t + v, 0))
    },
  }),
]

/** Fields of the 2×2 system templates: a₁x + b₁y = c₁, a₂x + b₂y = c₂. */
const SYSTEM_FIELDS = {
  a1: int(-7, 7, true), b1: int(-7, 7, true), c1: int(-126, 126),
  a2: int(-7, 7, true), b2: int(-7, 7, true), c2: int(-126, 126),
} as const

function drawSystem(rng: Rng): { a1: number; b1: number; c1: number; a2: number; b2: number; c2: number; x: number; y: number } {
  const x = rng.int(-9, 9)
  const y = rng.int(-9, 9)
  const [a1, b1, a2, b2] = until(
    () => [nonzero(rng, -7, 7), nonzero(rng, -7, 7), nonzero(rng, -7, 7), nonzero(rng, -7, 7)] as const,
    ([p, q, r, s]) => p * s - q * r !== 0,
    'an invertible system',
  )
  return { a1, b1, c1: a1 * x + b1 * y, a2, b2, c2: a2 * x + b2 * y, x, y }
}
const systemGiven = (s: ReturnType<typeof drawSystem>): Given => ({ a1: s.a1, b1: s.b1, c1: s.c1, a2: s.a2, b2: s.b2, c2: s.c2 })
const eqText = (g: Given, i: 1 | 2): string =>
  `${lin([[num(g, `a${i}`), 'x'], [num(g, `b${i}`), 'y']])} = ${signed(num(g, `c${i}`))}`
/** The generator's (x, y) by elimination (the verifier uses Cramer's rule and substitutes back). */
function eliminate(g: Given): [Fraction, Fraction] {
  const [a1, b1, c1, a2, b2, c2] = ['a1', 'b1', 'c1', 'a2', 'b2', 'c2'].map((k) => frac(num(g, k))) as [
    Fraction, Fraction, Fraction, Fraction, Fraction, Fraction,
  ]
  // Eliminate x: (a1·b2 − a2·b1) y = a1·c2 − a2·c1.
  const y = a1.mul(c2).sub(a2.mul(c1)).div(a1.mul(b2).sub(a2.mul(b1)))
  const x = c1.sub(b1.mul(y)).div(a1)
  return [x, y]
}

const quadText = (a: number, b: number, c: number): string => lin([[a, 'x^2'], [b, 'x'], [c, '']])
function drawRoots(rng: Rng, lo: number, hi: number): [number, number] {
  const [r1, r2] = until(() => [rng.int(lo, hi), rng.int(lo, hi)] as const, ([p, q]) => p !== q, 'two distinct roots')
  return r1 < r2 ? [r1, r2] : [r2, r1]
}
/**
 * The generator's roots r < s: search integers r with s = −b/a − r and r·s = c/a (Vieta). The
 * verifier takes the other route: the discriminant, then substitution back into the equation.
 */
function vietaRoots(a: number, b: number, c: number): [Fraction, Fraction] {
  const sum = frac(-b, a)
  const prod = frac(c, a)
  const lim = 64
  for (let r = -lim; r <= lim; r++) {
    const s = sum.sub(frac(r))
    if (s.cmp(frac(r)) > 0 && s.mul(frac(r)).eq(prod)) return [frac(r), s]
  }
  throw new Error('quant: no integer roots')
}

const S3: VariantDef[] = [
  // (3) systems of two linear equations
  V({
    template: 'system', variant: 'solve', stratum: 3, format: 'integer', offset: -0.1,
    fields: { ...SYSTEM_FIELDS, ask: oneOf('x', 'y') },
    draw: (rng) => ({ ...systemGiven(drawSystem(rng)), ask: rng.pick(['x', 'y']) }),
    render: (g) => `If ${eqText(g, 1)} and ${eqText(g, 2)}, what is the value of ${str(g, 'ask')}?`,
    compute: (g) => eliminate(g)[str(g, 'ask') === 'x' ? 0 : 1],
  }),
  V({
    template: 'system', variant: 'sum', stratum: 3, format: 'integer', offset: 0,
    fields: SYSTEM_FIELDS,
    draw: (rng) => systemGiven(drawSystem(rng)),
    render: (g) => `If ${eqText(g, 1)} and ${eqText(g, 2)}, what is the value of x + y?`,
    compute: (g) => {
      const [x, y] = eliminate(g)
      return x.add(y)
    },
  }),
  V({
    template: 'system', variant: 'product', stratum: 3, format: 'integer', offset: 0.1,
    fields: SYSTEM_FIELDS,
    draw: (rng) => systemGiven(drawSystem(rng)),
    render: (g) => `If ${eqText(g, 1)} and ${eqText(g, 2)}, what is the value of xy?`,
    compute: (g) => {
      const [x, y] = eliminate(g)
      return x.mul(y)
    },
  }),
  // (3) quadratics with integer roots
  V({
    template: 'quadratic', variant: 'root', stratum: 3, format: 'integer', offset: -0.1,
    fields: { b: int(-30, 30), c: int(-225, 225), ask: oneOf('larger', 'smaller') },
    draw(rng) {
      const [r, s] = drawRoots(rng, -15, 15)
      return { b: -(r + s), c: r * s, ask: rng.pick(['larger', 'smaller']) }
    },
    render: (g) =>
      `The equation ${quadText(1, num(g, 'b'), num(g, 'c'))} = 0 has two solutions. What is the ${str(g, 'ask')} solution?`,
    compute: (g) => vietaRoots(1, num(g, 'b'), num(g, 'c'))[str(g, 'ask') === 'larger' ? 1 : 0],
  }),
  V({
    template: 'quadratic', variant: 'scaled', stratum: 3, format: 'integer', offset: 0,
    fields: { a: int(2, 4), b: int(-80, 80), c: int(-400, 400), ask: oneOf('larger', 'smaller') },
    draw(rng) {
      const a = rng.int(2, 4)
      const [r, s] = drawRoots(rng, -10, 10)
      return { a, b: -a * (r + s), c: a * r * s, ask: rng.pick(['larger', 'smaller']) }
    },
    render: (g) =>
      `The equation ${quadText(num(g, 'a'), num(g, 'b'), num(g, 'c'))} = 0 has two solutions. What is the ${str(g, 'ask')} solution?`,
    compute: (g) => vietaRoots(num(g, 'a'), num(g, 'b'), num(g, 'c'))[str(g, 'ask') === 'larger' ? 1 : 0],
  }),
  V({
    template: 'quadratic', variant: 'sum_squares', stratum: 3, format: 'integer', offset: 0.2,
    fields: { b: int(-30, 30), c: int(-225, 225) },
    draw(rng) {
      const [r, s] = drawRoots(rng, -15, 15)
      return { b: -(r + s), c: r * s }
    },
    render: (g) =>
      `The equation ${quadText(1, num(g, 'b'), num(g, 'c'))} = 0 has two solutions, p and q. What is the value of p^2 + q^2?`,
    compute(g) {
      // (p + q)² − 2pq with p + q = −b, pq = c.
      const b = num(g, 'b')
      return frac(b * b - 2 * num(g, 'c'))
    },
  }),
  // (3) exponent rules
  V({
    template: 'exponent', variant: 'product', stratum: 3, format: 'integer', offset: -0.2,
    fields: { base: int(2, 7), e1: int(2, 12), e2: int(2, 12), e3: int(2, 24) },
    draw: (rng) =>
      until(
        () => {
          // The result is base^e with e in 2..4, never 1 or the base itself.
          const [base, e1, e2, e] = [rng.int(2, 7), rng.int(2, 12), rng.int(2, 12), rng.int(2, 4)]
          return { base, e1, e2, e3: e1 + e2 - e }
        },
        (g) => g.e3 >= 2,
        'exponent/product',
      ),
    render: (g) =>
      `Compute ${num(g, 'base')}^${num(g, 'e1')} × ${num(g, 'base')}^${num(g, 'e2')} ÷ ${num(g, 'base')}^${num(g, 'e3')}.`,
    compute: (g) => ipow(num(g, 'base'), num(g, 'e1') + num(g, 'e2') - num(g, 'e3')),
  }),
  V({
    template: 'exponent', variant: 'power', stratum: 3, format: 'integer', offset: -0.1,
    fields: { base: int(2, 7), e1: int(2, 5), e2: int(2, 5), e3: int(2, 25) },
    draw: (rng) =>
      until(
        () => {
          const [base, e1, e2, e] = [rng.int(2, 7), rng.int(2, 5), rng.int(2, 5), rng.int(2, 4)]
          return { base, e1, e2, e3: e1 * e2 - e }
        },
        (g) => g.e3 >= 2,
        'exponent/power',
      ),
    render: (g) => `Compute (${num(g, 'base')}^${num(g, 'e1')})^${num(g, 'e2')} ÷ ${num(g, 'base')}^${num(g, 'e3')}.`,
    compute: (g) => ipow(num(g, 'base'), num(g, 'e1') * num(g, 'e2') - num(g, 'e3')),
  }),
  V({
    template: 'exponent', variant: 'root', stratum: 3, format: 'fraction', offset: 0.1,
    fields: { base: int(4, 729), p: oneOf(1, 2, 3, 4), q: oneOf(2, 3), negative: oneOf(false, true) },
    draw(rng) {
      const q = rng.pick([2, 3])
      const p = rng.pick(q === 2 ? [1, 3] : [1, 2, 4])
      const r = rng.int(2, 9)
      return { base: r ** q, p, q, negative: rng.int(0, 1) === 1 }
    },
    render: (g) =>
      `Compute ${num(g, 'base')}^(${bool(g, 'negative') ? '−' : ''}${num(g, 'p')}/${num(g, 'q')}).`,
    compute(g) {
      const r = Math.round(num(g, 'base') ** (1 / num(g, 'q')))
      const v = ipow(r, num(g, 'p'))
      return bool(g, 'negative') ? Fraction.ONE.div(v) : v
    },
  }),
  V({
    template: 'exponent', variant: 'solve', stratum: 3, format: 'integer', offset: 0,
    fields: { base: oneOf(2, 3, 5, 7), m: int(1, 4), k: int(-5, 5), value: int(2, 10_000_000) },
    draw: (rng) =>
      until(
        () => {
          const [base, m, k, x0] = [rng.pick([2, 3, 5, 7]), rng.int(1, 4), rng.int(-5, 5), rng.int(1, 6)]
          const E = m * x0 + k
          return { base, m, k, value: E >= 1 && E <= 14 ? base ** E : 0 }
        },
        (g) => g.value >= 2 && g.value <= 10_000_000,
        'exponent/solve',
      ),
    render(g) {
      // "2^x" for the bare exponent x, else "2^(3x − 1)".
      const e = lin([[num(g, 'm'), 'x'], [num(g, 'k'), '']])
      return `Solve for x: ${num(g, 'base')}^${e === 'x' ? e : `(${e})`} = ${num(g, 'value')}.`
    },
    compute(g) {
      const E = Math.round(Math.log(num(g, 'value')) / Math.log(num(g, 'base')))
      return frac(E - num(g, 'k'), num(g, 'm'))
    },
  }),
  // (3) simple probability, exact fractions
  V({
    template: 'probability', variant: 'both', stratum: 3, format: 'fraction', offset: 0,
    fields: { red: int(2, 9), blue: int(2, 9), green: int(2, 9), colour: oneOf('red', 'blue', 'green') },
    draw: (rng) => ({ red: rng.int(2, 9), blue: rng.int(2, 9), green: rng.int(2, 9), colour: rng.pick(['red', 'blue', 'green']) }),
    render: (g) =>
      `A bag holds ${num(g, 'red')} red, ${num(g, 'blue')} blue and ${num(g, 'green')} green marbles. Two marbles are drawn at random without replacement. What is the probability that both are ${str(g, 'colour')}?`,
    compute(g) {
      const k = num(g, str(g, 'colour'))
      const n = num(g, 'red') + num(g, 'blue') + num(g, 'green')
      return frac(k, n).mul(frac(k - 1, n - 1))
    },
  }),
  V({
    template: 'probability', variant: 'same', stratum: 3, format: 'fraction', offset: 0.3,
    fields: { red: int(2, 9), blue: int(2, 9), green: int(2, 9) },
    draw: (rng) => ({ red: rng.int(2, 9), blue: rng.int(2, 9), green: rng.int(2, 9) }),
    render: (g) =>
      `A bag holds ${num(g, 'red')} red, ${num(g, 'blue')} blue and ${num(g, 'green')} green marbles. Two marbles are drawn at random without replacement. What is the probability that the two marbles are the same colour?`,
    compute(g) {
      const ks = [num(g, 'red'), num(g, 'blue'), num(g, 'green')]
      const n = ks.reduce((s, v) => s + v, 0)
      return ks.reduce((s, k) => s.add(frac(k, n).mul(frac(k - 1, n - 1))), Fraction.ZERO)
    },
  }),
  V({
    template: 'probability', variant: 'dice', stratum: 3, format: 'fraction', offset: -0.1,
    fields: { faces: oneOf(4, 6, 8, 10, 12), total: int(3, 23), at_least: oneOf(false, true) },
    draw(rng) {
      const faces = rng.pick([4, 6, 8, 10, 12])
      return { faces, total: rng.int(3, 2 * faces - 1), at_least: rng.int(0, 1) === 1 }
    },
    render: (g) =>
      `Two fair dice, each numbered 1 to ${num(g, 'faces')}, are rolled. What is the probability that the two numbers add up to ${num(g, 'total')}${bool(g, 'at_least') ? ' or more' : ''}?`,
    compute(g) {
      // Ways to make t with two f-sided dice: f − |t − (f + 1)|.
      const f = num(g, 'faces')
      const ways = (t: number): number => Math.max(0, f - Math.abs(t - (f + 1)))
      let w = 0
      for (let t = num(g, 'total'); t <= (bool(g, 'at_least') ? 2 * f : num(g, 'total')); t++) w += ways(t)
      return frac(w, f * f)
    },
  }),
]

/** x^n ± 1/x^n in terms of k (the generator's closed forms). */
const RECIP_FORMS: Readonly<Record<string, (k: number) => number>> = {
  plus2: (k) => k * k - 2,
  plus3: (k) => k ** 3 - 3 * k,
  plus4: (k) => (k * k - 2) ** 2 - 2,
  minus2: (k) => k * k + 2,
  minus3: (k) => k ** 3 + 3 * k,
}
const recip = (variant: string, lo: number, hi: number, offset: number, stem: string): VariantDef =>
  V({
    template: 'recip', variant, stratum: 4, format: 'integer', offset,
    fields: { k: int(lo, hi) },
    draw: (rng) => ({ k: rng.int(lo, hi) }),
    render: (g) => stem.replace('{k}', String(num(g, 'k'))),
    compute: (g) => frac((RECIP_FORMS[variant] as (k: number) => number)(num(g, 'k'))),
  })

const symmetric = (variant: string, sHi: number, pHi: number, offset: number, what: string, form: (s: number, p: number) => number): VariantDef =>
  V({
    template: 'symmetric', variant, stratum: 4, format: 'integer', offset,
    fields: { s: int(-sHi, sHi, true), p: int(-pHi, pHi, true) },
    draw: (rng) => until(() => ({ s: nonzero(rng, -sHi, sHi), p: nonzero(rng, -pHi, pHi) }), (g) => g.s * g.s - 4 * g.p > 0, 'real roots'),
    render: (g) =>
      `Real numbers a and b satisfy a + b = ${signed(num(g, 's'))} and ab = ${signed(num(g, 'p'))}. What is the value of ${what}?`,
    compute: (g) => frac(form(num(g, 's'), num(g, 'p'))),
  })

const apTerm = (g: Given, i: number): number => num(g, 'first') + i * num(g, 'diff')
const gpTerm = (g: Given, i: number): number => num(g, 'first') * num(g, 'ratio') ** i
/** The infinite series' ratio p/q. */
const gpRatio = (g: Given): Fraction => frac(num(g, 'p'), num(g, 'q'))
const nCr = (n: number, k: number): number => {
  let r = 1
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i
  return r
}
const LETTERS = ['A', 'B', 'C', 'D'] as const

const S4: VariantDef[] = [
  // (4) symmetric-function tricks: x ± 1/x = k (§14.6 example 3)
  recip('plus2', 3, 30, -0.3, 'If x + 1/x = {k}, what is the value of x^2 + 1/x^2?'),
  recip('plus3', 3, 20, 0, 'If x + 1/x = {k}, what is the value of x^3 + 1/x^3?'),
  recip('plus4', 3, 12, 0.1, 'If x + 1/x = {k}, what is the value of x^4 + 1/x^4?'),
  recip('minus2', 1, 30, -0.2, 'If x − 1/x = {k}, what is the value of x^2 + 1/x^2?'),
  recip('minus3', 1, 20, 0, 'If x − 1/x = {k}, what is the value of x^3 − 1/x^3?'),
  // (4) symmetric functions of a, b from a + b and ab
  symmetric('sum_sq', 12, 40, -0.2, 'a^2 + b^2', (s, p) => s * s - 2 * p),
  symmetric('diff_sq', 12, 40, -0.1, '(a − b)^2', (s, p) => s * s - 4 * p),
  symmetric('sum_cube', 9, 30, 0.1, 'a^3 + b^3', (s, p) => s ** 3 - 3 * p * s),
  // (4) arithmetic series
  V({
    template: 'arith_series', variant: 'sum', stratum: 4, format: 'integer', offset: -0.1,
    fields: { first: int(-20, 30), diff: int(2, 12), count: int(8, 50) },
    draw: (rng) => ({ first: rng.int(-20, 30), diff: rng.int(2, 12), count: rng.int(8, 50) }),
    render: (g) =>
      `What is the value of the sum ${paren(apTerm(g, 0))} + ${paren(apTerm(g, 1))} + ${paren(apTerm(g, 2))} + … + ${paren(apTerm(g, num(g, 'count') - 1))}?`,
    compute: (g) => frac(num(g, 'count') * (apTerm(g, 0) + apTerm(g, num(g, 'count') - 1)), 2),
  }),
  V({
    template: 'arith_series', variant: 'first_n', stratum: 4, format: 'integer', offset: 0,
    fields: { first: int(-30, 30), diff: int(-9, 9), count: int(10, 60) },
    draw: (rng) => ({
      first: rng.int(-30, 30),
      diff: until(() => rng.int(-9, 9), (d) => Math.abs(d) >= 2, 'a difference'),
      count: rng.int(10, 60),
    }),
    render: (g) =>
      `An arithmetic sequence begins ${signed(apTerm(g, 0))}, ${signed(apTerm(g, 1))}, ${signed(apTerm(g, 2))}, … What is the sum of its first ${num(g, 'count')} terms?`,
    compute: (g) => frac(num(g, 'count') * (2 * num(g, 'first') + (num(g, 'count') - 1) * num(g, 'diff')), 2),
  }),
  V({
    template: 'arith_series', variant: 'multiples', stratum: 4, format: 'integer', offset: 0.2,
    fields: { m: int(3, 15), lo: int(10, 200), hi: int(25, 1100) },
    draw: (rng) =>
      until(
        () => {
          const m = rng.int(3, 15)
          const lo = rng.int(10, 200)
          return { m, lo, hi: rng.int(lo + 5 * m, lo + 60 * m) }
        },
        (g) => g.lo % g.m !== 0 && g.hi % g.m !== 0,
        'multiples',
      ),
    render: (g) => `What is the sum of all the multiples of ${num(g, 'm')} between ${num(g, 'lo')} and ${num(g, 'hi')}?`,
    compute(g) {
      const m = num(g, 'm')
      const i = Math.ceil(num(g, 'lo') / m)
      const j = Math.floor(num(g, 'hi') / m)
      return frac((m * (i + j) * (j - i + 1)) / 2)
    },
  }),
  // (4) geometric series
  V({
    template: 'geom_series', variant: 'finite', stratum: 4, format: 'integer', offset: 0,
    fields: { first: int(1, 30), ratio: oneOf(-3, -2, 2, 3, 4, 5), count: int(5, 10) },
    draw: (rng) =>
      until(
        () => ({ first: rng.int(1, 30), ratio: rng.pick([-3, -2, 2, 3, 4, 5]), count: rng.int(5, 10) }),
        (g) => Math.abs(g.first * g.ratio ** (g.count - 1)) <= 1_000_000,
        'geom_series/finite',
      ),
    render: (g) =>
      `What is the value of the sum ${paren(gpTerm(g, 0))} + ${paren(gpTerm(g, 1))} + ${paren(gpTerm(g, 2))} + … + ${paren(gpTerm(g, num(g, 'count') - 1))}?`,
    compute: (g) => frac(num(g, 'first') * (num(g, 'ratio') ** num(g, 'count') - 1), num(g, 'ratio') - 1),
  }),
  V({
    template: 'geom_series', variant: 'infinite', stratum: 4, format: 'fraction', offset: 0.1,
    fields: { first: int(2, 90), p: int(-4, 4, true), q: int(2, 5) },
    draw(rng) {
      const q = rng.int(2, 5)
      const p = until(() => nonzero(rng, 1 - q, q - 1), (x) => gcd(Math.abs(x), q) === 1, 'a ratio')
      return { first: rng.int(2, 90), p, q }
    },
    render(g) {
      const terms = [0, 1, 2, 3].map((i) => ratTerm(frac(num(g, 'first')).mul(gpRatio(g).pow(i))))
      return `What is the sum of the infinite geometric series ${terms.join(' + ')} + …?`
    },
    compute: (g) => frac(num(g, 'first')).div(Fraction.ONE.sub(gpRatio(g))),
  }),
  // (4) modular arithmetic
  V({
    template: 'modular', variant: 'power', stratum: 4, format: 'integer', offset: 0.1,
    fields: { base: int(2, 30), exp: int(10, 500), mod: int(3, 13) },
    draw: (rng) =>
      until(() => ({ base: rng.int(2, 30), exp: rng.int(10, 500), mod: rng.int(3, 13) }), (g) => g.base % g.mod !== 0, 'modular/power'),
    render: (g) => `What is the remainder when ${num(g, 'base')}^${num(g, 'exp')} is divided by ${num(g, 'mod')}?`,
    compute: (g) => frac(cyclePowMod(num(g, 'base'), num(g, 'exp'), num(g, 'mod'))),
  }),
  V({
    template: 'modular', variant: 'last_digit', stratum: 4, format: 'integer', offset: -0.1,
    fields: { base: int(2, 99), exp: int(10, 2026) },
    draw: (rng) => ({ base: 10 * rng.int(0, 9) + rng.pick([2, 3, 4, 7, 8, 9]), exp: rng.int(10, 2026) }),
    render: (g) => `What is the last digit of ${num(g, 'base')}^${num(g, 'exp')}?`,
    compute: (g) => frac(cyclePowMod(num(g, 'base'), num(g, 'exp'), 10)),
  }),
  V({
    template: 'modular', variant: 'congruence', stratum: 4, format: 'integer', offset: 0.3,
    fields: { a: int(2, 16), c: int(1, 16), mod: int(5, 17) },
    draw(rng) {
      const mod = rng.int(5, 17)
      const a = until(() => rng.int(2, mod - 1), (x) => gcd(x, mod) === 1, 'a unit')
      return { a, c: until(() => rng.int(1, mod - 1), (x) => x !== a, 'a residue'), mod }
    },
    render: (g) =>
      `What is the smallest positive integer n for which ${num(g, 'a')}n leaves a remainder of ${num(g, 'c')} when divided by ${num(g, 'mod')}?`,
    compute(g) {
      // n = c · a⁻¹ mod m, with a⁻¹ from the extended Euclidean algorithm.
      const m = num(g, 'mod')
      let [r0, r1, s0, s1] = [num(g, 'a'), m, 1, 0]
      while (r1 !== 0) {
        const q = Math.floor(r0 / r1)
        ;[r0, r1] = [r1, r0 - q * r1]
        ;[s0, s1] = [s1, s0 - q * s1]
      }
      const n = (((s0 * num(g, 'c')) % m) + m) % m
      return frac(n === 0 ? m : n)
    },
  }),
  // (4) counting
  V({
    template: 'counting', variant: 'choose', stratum: 4, format: 'integer', offset: -0.1,
    fields: { setting: oneOf('committee', 'books', 'toppings'), n: int(6, 20), k: int(2, 6) },
    draw(rng) {
      const n = rng.int(6, 20)
      return { setting: rng.pick(['committee', 'books', 'toppings']), n, k: rng.int(2, Math.min(6, n - 2)) }
    },
    render(g) {
      const [n, k] = [num(g, 'n'), num(g, 'k')]
      switch (str(g, 'setting')) {
        case 'committee':
          return `In how many ways can a committee of ${k} people be chosen from a group of ${n} people?`
        case 'books':
          return `In how many ways can ${k} books be chosen from a shelf of ${n} different books?`
        default:
          return `A pizza shop offers ${n} different toppings. How many different pizzas with exactly ${k} toppings are possible?`
      }
    },
    compute: (g) => frac(nCr(num(g, 'n'), num(g, 'k'))),
  }),
  V({
    template: 'counting', variant: 'two_groups', stratum: 4, format: 'integer', offset: 0.1,
    fields: { adults: int(4, 12), children: int(4, 12), pick_adults: int(1, 11), pick_children: int(1, 11) },
    draw: (rng) =>
      until(
        () => {
          const adults = rng.int(4, 12)
          const children = rng.int(4, 12)
          return { adults, children, pick_adults: rng.int(1, adults - 1), pick_children: rng.int(1, children - 1) }
        },
        (g) => g.pick_adults + g.pick_children >= 3,
        'counting/two_groups',
      ),
    render(g) {
      const [i, j] = [num(g, 'pick_adults'), num(g, 'pick_children')]
      return `A team of ${i} ${i === 1 ? 'adult' : 'adults'} and ${j} ${j === 1 ? 'child' : 'children'} is chosen from ${num(g, 'adults')} adults and ${num(g, 'children')} children. How many different teams are possible?`
    },
    compute: (g) => frac(nCr(num(g, 'adults'), num(g, 'pick_adults')) * nCr(num(g, 'children'), num(g, 'pick_children'))),
  }),
  V({
    template: 'counting', variant: 'arrange', stratum: 4, format: 'integer', offset: 0.2,
    fields: { counts: { kind: 'ints', minLen: 2, maxLen: 4, lo: 1, hi: 4 } },
    draw: (rng) =>
      until(
        () => ({ counts: Array.from({ length: rng.int(2, 4) }, () => rng.int(1, 4)) }),
        (g) => {
          const t = g.counts.reduce((s, v) => s + v, 0)
          return t >= 4 && t <= 10 && Math.max(...g.counts) >= 2
        },
        'counting/arrange',
      ),
    render(g) {
      const letters = nums(g, 'counts').flatMap((c, i) => Array.from({ length: c }, () => LETTERS[i] as string))
      return `In how many different orders can the letters ${listText(letters)} be written in a row?`
    },
    compute(g) {
      // n! / (k₁! k₂! …)
      const fact = (n: number): bigint => (n <= 1 ? 1n : BigInt(n) * fact(n - 1))
      const c = nums(g, 'counts')
      return frac(fact(c.reduce((s, v) => s + v, 0)), c.reduce((p, k) => p * fact(k), 1n))
    },
  }),
]

/** base^exp mod m via the eventual cycle of powers (the verifier uses square-and-multiply). */
function cyclePowMod(base: number, exp: number, m: number): number {
  const seen = new Map<number, number>()
  const seq: number[] = []
  let v = 1 % m
  for (let i = 0; ; i++) {
    if (i === exp) return v
    const at = seen.get(v)
    if (at !== undefined) return seq[at + ((exp - at) % (i - at))] as number
    seen.set(v, i)
    seq.push(v)
    v = (v * base) % m
  }
}

/** Every variant, in a fixed order (the generator's draw order depends on it). */
export const VARIANTS: readonly VariantDef[] = Object.freeze([...S1, ...S2, ...S3, ...S4])

/** Template ids by stratum, in table order. */
export const TEMPLATES_BY_STRATUM: Readonly<Record<1 | 2 | 3 | 4, readonly string[]>> = Object.freeze({
  1: [...new Set(S1.map((v) => v.template))],
  2: [...new Set(S2.map((v) => v.template))],
  3: [...new Set(S3.map((v) => v.template))],
  4: [...new Set(S4.map((v) => v.template))],
})

const BY_ID = new Map(VARIANTS.map((v) => [`${v.template}/${v.variant}`, v]))

/** The variant `template/variant`, or undefined. */
export function variantOf(template: unknown, variant: unknown): VariantDef | undefined {
  return typeof template === 'string' && typeof variant === 'string' ? BY_ID.get(`${template}/${variant}`) : undefined
}

/** The variants of one template, in table order. */
export function variantsOf(template: string): VariantDef[] {
  return VARIANTS.filter((v) => v.template === template)
}

/** The tolerance of a format: `{ abs: 0 }` for integer and fraction answers, `{ abs: 0.005 }` for decimals. */
export const toleranceFor = (format: InputFormat): { abs: number } | { rel: number } =>
  format === 'decimal' ? { ...TOL_DECIMAL } : { ...TOL_EXACT }
