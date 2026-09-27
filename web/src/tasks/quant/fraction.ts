/**
 * Exact arithmetic for the quant family (M1.8, DESIGN §4.2 "Math"): a BigInt {@link Fraction}
 * (the key and every verification are exact rationals, never floats) and {@link Surd}, numbers
 * a + b√D with rational a, b, used to substitute the irrational roots of x + 1/x = k and
 * t² − st + p = 0 back into the expression an item asks for.
 */

const ABS = (x: bigint): bigint => (x < 0n ? -x : x)

/** gcd(|a|, |b|); gcd(0, 0) = 0. */
export function bigGcd(a: bigint, b: bigint): bigint {
  a = ABS(a)
  b = ABS(b)
  while (b !== 0n) [a, b] = [b, a % b]
  return a
}

const toBig = (v: bigint | number, what: string): bigint => {
  if (typeof v === 'bigint') return v
  if (!Number.isSafeInteger(v)) throw new RangeError(`Fraction: ${what} must be a safe integer, got ${v}`)
  return BigInt(v)
}

/** Canonical rational text: "p" or "p/q" with q > 1, lowest terms, ASCII "-" (the key format). */
export const CANONICAL_RATIONAL_RE = /^-?(0|[1-9][0-9]*)(\/[1-9][0-9]*)?$/

/** An exact rational n/d in lowest terms with d > 0. Immutable. */
export class Fraction {
  readonly n: bigint
  readonly d: bigint

  private constructor(n: bigint, d: bigint) {
    this.n = n
    this.d = d
  }

  /** n/d reduced; throws a RangeError if d = 0 or a number argument is not a safe integer. */
  static of(n: bigint | number, d: bigint | number = 1n): Fraction {
    let nn = toBig(n, 'numerator')
    let dd = toBig(d, 'denominator')
    if (dd === 0n) throw new RangeError('Fraction: zero denominator')
    if (dd < 0n) {
      nn = -nn
      dd = -dd
    }
    const g = bigGcd(nn, dd)
    return g > 1n ? new Fraction(nn / g, dd / g) : new Fraction(nn, dd)
  }

  static readonly ZERO = Fraction.of(0)
  static readonly ONE = Fraction.of(1)

  /** Parse the canonical text of {@link toString} (and only that); null otherwise. */
  static parseCanonical(s: string): Fraction | null {
    if (typeof s !== 'string' || !CANONICAL_RATIONAL_RE.test(s)) return null
    const [p, q = '1'] = s.split('/') as [string, string?]
    const f = Fraction.of(BigInt(p), BigInt(q))
    return f.toString() === s ? f : null // rejects "-0", "4/2", "3/1"
  }

  add(o: Fraction): Fraction {
    return Fraction.of(this.n * o.d + o.n * this.d, this.d * o.d)
  }
  sub(o: Fraction): Fraction {
    return Fraction.of(this.n * o.d - o.n * this.d, this.d * o.d)
  }
  mul(o: Fraction): Fraction {
    return Fraction.of(this.n * o.n, this.d * o.d)
  }
  /** Throws a RangeError on division by zero. */
  div(o: Fraction): Fraction {
    if (o.n === 0n) throw new RangeError('Fraction: division by zero')
    return Fraction.of(this.n * o.d, this.d * o.n)
  }
  neg(): Fraction {
    return Fraction.of(-this.n, this.d)
  }
  abs(): Fraction {
    return this.n < 0n ? this.neg() : this
  }
  /** this^k for an integer k (negative k inverts; 0^negative throws). */
  pow(k: number): Fraction {
    if (!Number.isSafeInteger(k)) throw new RangeError(`Fraction.pow: exponent must be an integer, got ${k}`)
    if (k < 0) return Fraction.ONE.div(this.pow(-k))
    const e = BigInt(k)
    return Fraction.of(this.n ** e, this.d ** e)
  }
  /** −1, 0 or 1. */
  sign(): number {
    return this.n === 0n ? 0 : this.n < 0n ? -1 : 1
  }
  cmp(o: Fraction): number {
    return this.sub(o).sign()
  }
  eq(o: Fraction): boolean {
    return this.n === o.n && this.d === o.d
  }
  isZero(): boolean {
    return this.n === 0n
  }
  isInteger(): boolean {
    return this.d === 1n
  }
  /** Canonical text: "p" or "p/q", ASCII "-" for negatives. */
  toString(): string {
    return this.d === 1n ? `${this.n}` : `${this.n}/${this.d}`
  }
  toNumber(): number {
    return Number(this.n) / Number(this.d)
  }
}

/** Shorthand for {@link Fraction.of}. */
export const frac = (n: bigint | number, d: bigint | number = 1n): Fraction => Fraction.of(n, d)

/** The exact integer k-th root of x ≥ 0 (k ≥ 1), or null if x is not a perfect k-th power. */
export function exactRoot(x: bigint, k: number): bigint | null {
  if (!(Number.isInteger(k) && k >= 1)) throw new RangeError(`exactRoot: k must be an integer ≥ 1, got ${k}`)
  if (x < 0n) return null
  if (x < 2n || k === 1) return x
  const K = BigInt(k)
  let lo = 0n
  let hi = 1n << BigInt(Math.ceil(x.toString(2).length / k) + 1)
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n
    if (mid ** K <= x) lo = mid
    else hi = mid - 1n
  }
  return lo ** K === x ? lo : null
}

/**
 * A number a + b√D with rational a, b and a fixed square-free-or-not radicand D > 0 that is not a
 * perfect square (so a + b√D is rational iff b = 0). Operands of one operation share D.
 */
export class Surd {
  readonly a: Fraction
  readonly b: Fraction
  readonly D: bigint

  constructor(a: Fraction, b: Fraction, D: bigint) {
    if (D <= 0n || exactRoot(D, 2) !== null) throw new RangeError(`Surd: radicand must be a positive non-square, got ${D}`)
    this.a = a
    this.b = b
    this.D = D
  }

  private same(o: Surd): void {
    if (o.D !== this.D) throw new RangeError('Surd: mixed radicands')
  }
  add(o: Surd): Surd {
    this.same(o)
    return new Surd(this.a.add(o.a), this.b.add(o.b), this.D)
  }
  sub(o: Surd): Surd {
    this.same(o)
    return new Surd(this.a.sub(o.a), this.b.sub(o.b), this.D)
  }
  mul(o: Surd): Surd {
    this.same(o)
    const d = Fraction.of(this.D)
    return new Surd(this.a.mul(o.a).add(this.b.mul(o.b).mul(d)), this.a.mul(o.b).add(this.b.mul(o.a)), this.D)
  }
  /** 1 / (a + b√D) = (a − b√D) / (a² − b²D); throws on zero. */
  inv(): Surd {
    const norm = this.a.mul(this.a).sub(this.b.mul(this.b).mul(Fraction.of(this.D)))
    if (norm.isZero()) throw new RangeError('Surd: division by zero')
    return new Surd(this.a.div(norm), this.b.neg().div(norm), this.D)
  }
  /** this^k for an integer k ≥ 0 (negative k inverts). */
  pow(k: number): Surd {
    if (!Number.isSafeInteger(k)) throw new RangeError(`Surd.pow: exponent must be an integer, got ${k}`)
    if (k < 0) return this.inv().pow(-k)
    let out = new Surd(Fraction.ONE, Fraction.ZERO, this.D)
    for (let i = 0; i < k; i++) out = out.mul(this)
    return out
  }
  isRational(): boolean {
    return this.b.isZero()
  }
}
