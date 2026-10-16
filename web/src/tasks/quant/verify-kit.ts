/**
 * Shared pieces of the quant verifier (gates G2/G3, DESIGN §4.1–4.2; M1.8, M3.12): the shape of a
 * variant's check (its template rules and its independent route to the answer) and small exact
 * helpers, used by `verify.ts` (strata 1–4) and the hard strata's checks (`verify-hard*.ts`).
 */

import { Fraction, frac } from './fraction'
import type { Given } from './kit'

export type Rules = Record<string, boolean>
export interface Check {
  /** Template rules beyond the field ranges. */
  rules(g: Given): Rules
  /** The answer by the verifier's own route (may throw on a broken item). */
  solve(g: Given, stem: string): Fraction
}

export const f = (n: number, d = 1): Fraction => frac(n, d)
export const gcd = (a: number, b: number): number => {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b) [a, b] = [b, a % b]
  return a
}
export const inRange = (x: Fraction, lo: number, hi: number): boolean => x.cmp(f(lo)) >= 0 && x.cmp(f(hi)) <= 0
export const isIntIn = (x: Fraction, lo: number, hi: number): boolean => x.isInteger() && inRange(x, lo, hi)
export const sum = (xs: readonly number[]): number => xs.reduce((s, v) => s + v, 0)

/** base^exp mod m by square-and-multiply (BigInt). */
export function powMod(base: number, exp: number, m: number): number {
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

