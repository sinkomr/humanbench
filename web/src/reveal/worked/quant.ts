/**
 * Worked solutions of quantitative items (DESIGN §4.2 "Math"; ROADMAP M1.8, M1.R). One builder per
 * supported template variant; it reads the quantities the stem shows (`spec.given`) and does the
 * arithmetic exactly (`Fraction`), writing each step. The answer is what those steps give, not the
 * key; `worked.test.ts` checks it equals the key over thousands of items of every supported variant.
 *
 * Only strata 1–2 (arithmetic, percentages, fractions, ratios, rates, linear equations, averages)
 * have builders: they are the ones a reader can follow in three or four lines. A variant without a
 * builder is never picked as a worked example ({@link hasQuantSolution}).
 */

import { Fraction, frac } from '../../tasks/quant/fraction'
import type { QuantItem } from '../../tasks/quant'
import { lin, nums, num as gnum, str, type Given } from '../../tasks/quant/templates'
import type { WorkedSolution } from './types'
import { list, num, paren } from './text'

/** A rational as a decimal where it terminates ("187.5"), else "p/q"; typographic minus. For decimal-format answers. */
export function decimalText(f: Fraction): string {
  const sign = f.sign() < 0 ? '\u2212' : ''
  const a = f.abs()
  if (a.isInteger()) return `${sign}${a.n}`
  let d = a.d
  let twos = 0
  let fives = 0
  while (d % 2n === 0n) {
    d /= 2n
    twos++
  }
  while (d % 5n === 0n) {
    d /= 5n
    fives++
  }
  if (d !== 1n) return `${sign}${a.n}/${a.d}`
  const places = Math.max(twos, fives)
  const scaled = ((a.n * 10n ** BigInt(places)) / a.d).toString().padStart(places + 1, '0')
  return `${sign}${scaled.slice(0, scaled.length - places)}.${scaled.slice(scaled.length - places)}`
}

/** A rational as an integer or "p/q" (never a decimal); typographic minus. For integer and fraction answers. */
export function ratioText(f: Fraction): string {
  return f.toString().replace('-', '\u2212')
}

/** How a builder writes the rationals it computes (by the variant's answer format). */
type Fmt = (f: Fraction) => string

interface Built {
  readonly steps: readonly string[]
  readonly value: Fraction
}

const f = (n: number): Fraction => frac(n)
const at = (g: Given, k: string): number => gnum(g, k)
/** "− 5" / "+ 5" for a signed amount in a sentence. */
const withSign = (x: number): string => (x < 0 ? `− ${-x}` : `+ ${x}`)
/** "subtract 5 from both sides" / "add 5 to both sides" (to remove the amount `x` from one side). */
/** "12 − 5" or "12 − (−5)". */
const minus = (x: number, y: number): string => `${num(x)} \u2212 ${paren(y)}`
const bothSides = (x: number): string => (x < 0 ? `add ${-x} to both sides` : `subtract ${x} from both sides`)
const lcm = (a: number, b: number): number => {
  let x = a
  let y = b
  while (y !== 0) [x, y] = [y, x % y]
  return (a / x) * b
}

type Builder = (g: Given, fmt: Fmt) => Built

const BUILDERS: Readonly<Record<string, Builder>> = {
  'arith/mul_sub_div': (g, fmt) => {
    const [a, b, c, d] = [at(g, 'a'), at(g, 'b'), at(g, 'c'), at(g, 'd')] as [number, number, number, number]
    const value = f(a * b - c / d)
    return {
      steps: [
        `Multiplying and dividing come before subtracting: ${a} × ${b} = ${a * b}, and ${c} ÷ ${d} = ${c / d}.`,
        `Now subtract: ${a * b} − ${c / d} = ${fmt(value)}.`,
      ],
      value,
    }
  },
  'arith/group_mul': (g, fmt) => {
    const [a, b, c, e] = [at(g, 'a'), at(g, 'b'), at(g, 'c'), at(g, 'e')] as [number, number, number, number]
    const value = f((a + b) * c - e)
    return {
      steps: [`Brackets first: ${a} + ${b} = ${a + b}.`, `Multiply: ${a + b} × ${c} = ${(a + b) * c}.`, `Subtract: ${(a + b) * c} − ${e} = ${fmt(value)}.`],
      value,
    }
  },
  'arith/div_chain': (g, fmt) => {
    const [a, b, c, e] = [at(g, 'a'), at(g, 'b'), at(g, 'c'), at(g, 'e')] as [number, number, number, number]
    const q = a / b
    const value = f(q * c + e)
    return {
      steps: [
        `Divide and multiply from left to right: ${a} ÷ ${b} = ${q}, and then ${q} × ${c} = ${q * c}.`,
        `Add last: ${q * c} + ${e} = ${fmt(value)}.`,
      ],
      value,
    }
  },
  'percent/of': (g, fmt) => {
    const [p, n] = [at(g, 'p'), at(g, 'n')] as [number, number]
    const value = frac(p * n, 100)
    return {
      steps: [`${p}% means ${p} out of every 100, so ${p}% of ${n} is ${p} × ${n} ÷ 100.`, `${p} × ${n} = ${p * n}, and ${p * n} ÷ 100 = ${fmt(value)}.`],
      value,
    }
  },
  'percent/discount': (g, fmt) => {
    const [price, p] = [at(g, 'price'), at(g, 'p')] as [number, number]
    const value = frac(price * (100 - p), 100)
    return {
      steps: [
        `Cutting the price by ${p}% leaves ${100 - p}% of it.`,
        `${100 - p}% of $${price} is ${100 - p} × ${price} ÷ 100 = ${(100 - p) * price} ÷ 100 = ${fmt(value)}. The sale price is $${fmt(value)}.`,
      ],
      value,
    }
  },
  'percent/change': (g, fmt) => {
    const [before, after] = [at(g, 'before'), at(g, 'after')] as [number, number]
    const diff = Math.abs(after - before)
    const value = frac(100 * diff, before)
    return {
      steps: [
        `The price went from $${before} to $${after}, a change of $${diff}.`,
        `A percentage change compares the change with the starting price: ${diff} ÷ ${before} × 100.`,
        `${diff} ÷ ${before} = ${fmt(frac(diff, before))}, and × 100 gives ${fmt(value)}%.`,
      ],
      value,
    }
  },
  'fraction/add_sub': (g, fmt) => {
    const [a, b, c, d] = [at(g, 'a'), at(g, 'b'), at(g, 'c'), at(g, 'd')] as [number, number, number, number]
    const add = str(g, 'op') === 'add'
    const L = lcm(b, d)
    const x = (a * L) / b
    const y = (c * L) / d
    const value = add ? frac(a, b).add(frac(c, d)) : frac(a, b).sub(frac(c, d))
    const top = add ? x + y : x - y
    return {
      steps: [
        `Use a common denominator: ${b} and ${d} both go into ${L}.`,
        `${a}/${b} = ${x}/${L} and ${c}/${d} = ${y}/${L}.`,
        `${add ? 'Add' : 'Subtract'} the tops: ${x} ${add ? '+' : '−'} ${y} = ${top}, so the result is ${top}/${L}${top / L !== 0 && frac(top, L).toString() !== `${top}/${L}` ? `, which simplifies to ${fmt(value)}` : ''}.`,
      ],
      value,
    }
  },
  'fraction/mul_div': (g, fmt) => {
    const [a, b, c, d] = [at(g, 'a'), at(g, 'b'), at(g, 'c'), at(g, 'd')] as [number, number, number, number]
    const mul = str(g, 'op') === 'mul'
    const value = mul ? frac(a, b).mul(frac(c, d)) : frac(a, b).div(frac(c, d))
    return {
      steps: mul
        ? [`Multiply the tops and multiply the bottoms: (${a} × ${c}) / (${b} × ${d}) = ${a * c}/${b * d}.`, `Simplify: ${fmt(value)}.`]
        : [
            `Dividing by a fraction is the same as multiplying by its flip: ${a}/${b} ÷ ${c}/${d} = ${a}/${b} × ${d}/${c}.`,
            `Multiply the tops and the bottoms: ${a * d}/${b * c}, which simplifies to ${fmt(value)}.`,
          ],
      value,
    }
  },
  'fraction_of/rest': (g, fmt) => {
    const [total, a, b, c, d] = [at(g, 'total'), at(g, 'a'), at(g, 'b'), at(g, 'c'), at(g, 'd')] as [number, number, number, number, number]
    const bus = (total * a) / b
    const rest = total - bus
    const value = frac(rest * c, d)
    return {
      steps: [
        `${a}/${b} of ${total} take the bus: ${total} ÷ ${b} × ${a} = ${bus}.`,
        `The rest is ${total} − ${bus} = ${rest}.`,
        `${c}/${d} of the rest walk: ${rest} ÷ ${d} × ${c} = ${fmt(value)}.`,
      ],
      value,
    }
  },
  'fraction_of/spent': (g, fmt) => {
    const [total, a, b, c, d] = [at(g, 'total'), at(g, 'a'), at(g, 'b'), at(g, 'c'), at(g, 'd')] as [number, number, number, number, number]
    const name = str(g, 'name')
    const book = (total * a) / b
    const left = total - book
    const lunch = (left * c) / d
    const value = f(left - lunch)
    return {
      steps: [
        `The book costs ${a}/${b} of $${total}: ${total} ÷ ${b} × ${a} = $${book}.`,
        `After the book, ${name} has $${total} − $${book} = $${left}.`,
        `Lunch costs ${c}/${d} of $${left}: ${left} ÷ ${d} × ${c} = $${lunch}.`,
        `What is left: $${left} − $${lunch} = $${fmt(value)}.`,
      ],
      value,
    }
  },
  'ratio/share': (g, fmt) => {
    const [total, a, b] = [at(g, 'total'), at(g, 'a'), at(g, 'b')] as [number, number, number]
    const parts = a + b
    const one = total / parts
    const value = f(one * b)
    return {
      steps: [
        `The ratio ${a} : ${b} makes ${a} + ${b} = ${parts} equal parts.`,
        `One part is $${total} ÷ ${parts} = $${one}.`,
        `${str(g, 'name2')} gets ${b} parts: ${b} × $${one} = $${fmt(value)}.`,
      ],
      value,
    }
  },
  'ratio/total': (g, fmt) => {
    const [a, b, count] = [at(g, 'a'), at(g, 'b'), at(g, 'count')] as [number, number, number]
    const one = count / a
    const value = f(one * (a + b))
    return {
      steps: [
        `${a} parts are ${str(g, 'colour1')}, and there are ${count} of them, so one part is ${count} ÷ ${a} = ${one} marbles.`,
        `The jar has ${a} + ${b} = ${a + b} parts in all: ${a + b} × ${one} = ${fmt(value)}.`,
      ],
      value,
    }
  },
  'ratio/three_way': (g, fmt) => {
    const [total, a, b, c] = [at(g, 'total'), at(g, 'a'), at(g, 'b'), at(g, 'c')] as [number, number, number, number]
    const parts = a + b + c
    const one = total / parts
    const big = Math.max(a, b, c)
    const value = f(one * big)
    return {
      steps: [
        `The ratio ${a} : ${b} : ${c} makes ${a} + ${b} + ${c} = ${parts} equal parts.`,
        `One part is ${total} ÷ ${parts} = ${one}.`,
        `The largest ratio number is ${big}, so the largest part is ${big} × ${one} = ${fmt(value)}.`,
      ],
      value,
    }
  },
  'rate/unit': (g, fmt) => {
    const [count, t1, t2] = [at(g, 'count'), at(g, 't1'), at(g, 't2')] as [number, number, number]
    const per = count / t1
    const value = f(per * t2)
    return {
      steps: [`In one minute it does ${count} ÷ ${t1} = ${per}.`, `In ${t2} minutes it does ${per} × ${t2} = ${fmt(value)}.`],
      value,
    }
  },
  'rate/avg_speed': (g, fmt) => {
    const [d1, t1, d2, t2] = [at(g, 'd1'), at(g, 't1'), at(g, 'd2'), at(g, 't2')] as [number, number, number, number]
    const D = d1 + d2
    const T = t1 + t2
    const value = frac(D, T)
    return {
      steps: [
        `Average speed is the whole distance divided by the whole time. It is not the mean of the two speeds.`,
        `Distance: ${d1} + ${d2} = ${D} km. Time: ${t1} + ${t2} = ${T} hours.`,
        `${D} ÷ ${T} = ${fmt(value)} km/h.`,
      ],
      value,
    }
  },
  'rate/together': (g, fmt) => {
    const [a, b] = [at(g, 'a'), at(g, 'b')] as [number, number]
    const perHour = frac(1, a).add(frac(1, b))
    const value = Fraction.ONE.div(perHour)
    return {
      steps: [
        `In one hour the first does 1/${a} of the job and the second does 1/${b}.`,
        `Together, in one hour: 1/${a} + 1/${b} = ${fmt(perHour)} of the job.`,
        `The whole job takes 1 ÷ ${fmt(perHour)} = ${fmt(value)} hours.`,
      ],
      value,
    }
  },
  'linear_eq/both_sides': (g, fmt) => {
    const [a, b, c, d] = [at(g, 'a'), at(g, 'b'), at(g, 'c'), at(g, 'd')] as [number, number, number, number]
    const value = frac(d - b, a - c)
    return {
      steps: [
        `Collect the x terms on one side: subtract ${lin([[c, 'x']])} from both sides, which gives ${lin([[a - c, 'x'], [b, '']])} = ${num(d)}.`,
        `Move the number across: ${bothSides(b)}, which gives ${lin([[a - c, 'x']])} = ${minus(d, b)} = ${num(d - b)}.`,
        `Divide both sides by ${num(a - c)}: x = ${num(d - b)} \u00f7 ${paren(a - c)} = ${fmt(value)}.`,
      ],
      value,
    }
  },
  'linear_eq/brackets': (g, fmt) => {
    const [a, b, c, d] = [at(g, 'a'), at(g, 'b'), at(g, 'c'), at(g, 'd')] as [number, number, number, number]
    const value = frac(d - a * b, a - c)
    return {
      steps: [
        `Expand the bracket: ${a}(x ${withSign(b)}) is ${lin([[a, 'x'], [a * b, '']])}, so the equation reads ${lin([[a, 'x'], [a * b, '']])} = ${lin([[c, 'x'], [d, '']])}.`,
        `Subtract ${lin([[c, 'x']])} from both sides, and ${bothSides(a * b)}: ${lin([[a - c, 'x']])} = ${minus(d, a * b)} = ${num(d - a * b)}.`,
        `Divide both sides by ${num(a - c)}: x = ${num(d - a * b)} \u00f7 ${paren(a - c)} = ${fmt(value)}.`,
      ],
      value,
    }
  },
  'linear_eq/over': (g, fmt) => {
    const [p, b, c] = [at(g, 'p'), at(g, 'b'), at(g, 'c')] as [number, number, number]
    const value = f(p * (c - b))
    return {
      steps: [
        `First remove the number added to x/${p}: ${bothSides(b)}, which gives x/${p} = ${minus(c, b)} = ${num(c - b)}.`,
        `Multiply both sides by ${p}: x = ${num(c - b)} \u00d7 ${p} = ${fmt(value)}.`,
      ],
      value,
    }
  },
  'mean/missing': (g, fmt) => {
    const [count, mean] = [at(g, 'count'), at(g, 'mean')] as [number, number]
    const known = nums(g, 'known')
    const total = count * mean
    const sum = known.reduce((s, v) => s + v, 0)
    const value = f(total - sum)
    return {
      steps: [
        `The mean is the total divided by how many numbers there are, so the total of all ${count} numbers is ${count} × ${mean} = ${total}.`,
        `The numbers we know add up to ${known.join(' + ')} = ${sum}.`,
        `The remaining number is ${total} − ${sum} = ${fmt(value)}.`,
      ],
      value,
    }
  },
  'mean/target': (g, fmt) => {
    const mean = at(g, 'mean')
    const scores = nums(g, 'scores')
    const n = scores.length + 1
    const total = n * mean
    const sum = scores.reduce((s, v) => s + v, 0)
    const value = f(total - sum)
    return {
      steps: [
        `For a mean of ${mean} over ${n} tests the total must be ${n} × ${mean} = ${total}.`,
        `The tests so far add up to ${list(scores.map(String), 'and')}: ${scores.join(' + ')} = ${sum}.`,
        `The next test needs ${total} − ${sum} = ${fmt(value)}.`,
      ],
      value,
    }
  },
}

/** Whether `template/variant` has a worked solution. */
export function hasQuantSolution(template: string, variant: string): boolean {
  return Object.hasOwn(BUILDERS, `${template}/${variant}`)
}

/** The supported variants, `template/variant`. */
export const QUANT_SOLVED_VARIANTS: readonly string[] = Object.freeze(Object.keys(BUILDERS))

/** The worked solution of a quant item, or null for a variant without one. */
export function quantSolution(item: QuantItem): WorkedSolution | null {
  const sp = item.structural_params as { template?: unknown; variant?: unknown }
  if (typeof sp.template !== 'string' || typeof sp.variant !== 'string') return null
  const id = `${sp.template}/${sp.variant}`
  if (!Object.hasOwn(BUILDERS, id)) return null
  // Decimal answers are written as decimals; integer and fraction answers as integers or p/q.
  const { steps, value } = BUILDERS[id]!(item.spec.given, item.spec.input_format === 'decimal' ? decimalText : ratioText)
  return { steps, answer: item.spec.input_format === 'decimal' ? decimalText(value) : ratioText(value), exact: value.toString() }
}
