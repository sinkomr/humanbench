/**
 * Exact evaluator for the arithmetic shown in quant stems (M1.8, §4.2 "Math"): integers,
 * + − × ÷ / ^, parentheses and unary minus, over {@link Fraction}. The verifier evaluates the
 * rendered expression with it, an independent route from the generator's direct formula.
 *
 * Precedence: ^ (right-associative, its exponent may carry a unary minus) > unary minus > × ÷ /
 * (left to right) > + − (left to right); so −2^2 = −4 and 144 ÷ 12 × 5 = 60. A rational
 * exponent p/q needs an exact rational q-th root (27^(2/3) = 9); anything irrational throws.
 */

import { Fraction, exactRoot } from './fraction'

type Tok = { t: 'num'; v: bigint } | { t: 'op'; v: string }

const OPS = new Set(['+', '-', '*', '/', '^', '(', ')'])
const ALIASES: Readonly<Record<string, string>> = { '−': '-', '×': '*', '÷': '/' }

/** Largest |integer exponent| the evaluator accepts (keeps BigInts small). */
export const MAX_EXPONENT = 64

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i] as string
    if (ch === ' ') {
      i++
      continue
    }
    if (ch >= '0' && ch <= '9') {
      let j = i
      while (j < src.length && (src[j] as string) >= '0' && (src[j] as string) <= '9') j++
      out.push({ t: 'num', v: BigInt(src.slice(i, j)) })
      i = j
      continue
    }
    const op = ALIASES[ch] ?? ch
    if (!OPS.has(op)) throw new SyntaxError(`expr: unexpected character ${JSON.stringify(ch)} at ${i}`)
    out.push({ t: 'op', v: op })
    i++
  }
  return out
}

/** base^exp exactly; throws a RangeError when the result is irrational or undefined. */
export function ratPow(base: Fraction, exp: Fraction): Fraction {
  if (exp.isInteger()) {
    const k = Number(exp.n)
    if (Math.abs(k) > MAX_EXPONENT) throw new RangeError(`expr: exponent ${k} too large`)
    if (base.isZero() && k < 0) throw new RangeError('expr: 0 to a negative power')
    return base.pow(k)
  }
  const q = Number(exp.d)
  if (q > MAX_EXPONENT || Math.abs(Number(exp.n)) > MAX_EXPONENT) throw new RangeError('expr: exponent too large')
  const neg = base.sign() < 0
  if (neg && q % 2 === 0) throw new RangeError('expr: even root of a negative number')
  const n = exactRoot(neg ? -base.n : base.n, q)
  const d = exactRoot(base.d, q)
  if (n === null || d === null) throw new RangeError('expr: irrational power')
  const root = Fraction.of(neg ? -n : n, d)
  return ratPow(root, Fraction.of(exp.n))
}

/** Evaluate an expression exactly; throws a SyntaxError or RangeError on bad input. */
export function evaluate(src: string): Fraction {
  const toks = tokenize(src)
  let pos = 0
  const peek = (): Tok | undefined => toks[pos]
  const isOp = (v: string): boolean => {
    const t = peek()
    return t !== undefined && t.t === 'op' && t.v === v
  }
  const expect = (v: string): void => {
    if (!isOp(v)) throw new SyntaxError(`expr: expected ${JSON.stringify(v)} at token ${pos}`)
    pos++
  }

  const atom = (): Fraction => {
    const t = peek()
    if (t === undefined) throw new SyntaxError('expr: unexpected end')
    if (t.t === 'num') {
      pos++
      return Fraction.of(t.v)
    }
    if (t.v === '(') {
      pos++
      const v = sum()
      expect(')')
      return v
    }
    throw new SyntaxError(`expr: unexpected ${JSON.stringify(t.v)} at token ${pos}`)
  }
  const power = (): Fraction => {
    const b = atom()
    if (isOp('^')) {
      pos++
      return ratPow(b, unary())
    }
    return b
  }
  const unary = (): Fraction => {
    if (isOp('-')) {
      pos++
      return unary().neg()
    }
    return power()
  }
  const product = (): Fraction => {
    let v = unary()
    for (;;) {
      if (isOp('*')) {
        pos++
        v = v.mul(unary())
      } else if (isOp('/')) {
        pos++
        v = v.div(unary())
      } else return v
    }
  }
  const sum = (): Fraction => {
    let v = product()
    for (;;) {
      if (isOp('+')) {
        pos++
        v = v.add(product())
      } else if (isOp('-')) {
        pos++
        v = v.sub(product())
      } else return v
    }
  }

  const v = sum()
  if (pos !== toks.length) throw new SyntaxError(`expr: trailing input at token ${pos}`)
  return v
}
