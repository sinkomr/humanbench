/**
 * Generation of a coding block (ROADMAP M1.11): the legend bijection and the stimulus stream.
 * Every draw comes from the seeded stream passed in (A11).
 */

import type { JsonValue, Rng } from '../../engine'
import {
  CODING_DIGITS,
  CODING_SEQUENCE_LENGTH,
  CODING_SYMBOLS,
  type CodingSymbol,
  type LegendEntry,
} from './config'

/** A uniformly random bijection glyph → digit 1–9 (the per-session key table, M1.11). */
export function drawTable(rng: Rng): Record<CodingSymbol, number> {
  const digits = rng.shuffle(CODING_DIGITS)
  const table = {} as Record<CodingSymbol, number>
  CODING_SYMBOLS.forEach((s, i) => {
    table[s] = digits[i] as number
  })
  return table
}

/** The legend shown to the taker: digits 1–9 in order, each with its glyph. */
export function legendOf(table: Readonly<Record<CodingSymbol, number>>): LegendEntry[] {
  return CODING_DIGITS.map((digit) => {
    const symbol = CODING_SYMBOLS.find((s) => table[s] === digit)
    if (symbol === undefined) throw new RangeError(`legendOf(): no glyph has digit ${digit}`)
    return { digit, symbol }
  })
}

/**
 * Glyph counts of a balanced stream of length n: ⌊n/9⌋ each, plus one for n mod 9 glyphs
 * chosen at random, so counts differ by at most 1 (M1.11 "roughly uniform frequency").
 */
export function balancedCounts(rng: Rng, n: number): number[] {
  const k = CODING_SYMBOLS.length
  const base = Math.floor(n / k)
  const extra = new Set(rng.shuffle(CODING_SYMBOLS.map((_, i) => i)).slice(0, n % k))
  return CODING_SYMBOLS.map((_, i) => base + (extra.has(i) ? 1 : 0))
}

/**
 * Can `counts` (m items in all) be lined up with no two neighbours equal and not starting with
 * glyph `first`? Iff no glyph exceeds ⌈m/2⌉ and `first` does not exceed ⌊m/2⌋ (it cannot take
 * slot 1, so at most every other slot of 2…m).
 */
function arrangeable(counts: readonly number[], m: number, first: number): boolean {
  const cap = Math.ceil(m / 2)
  for (let t = 0; t < counts.length; t++) if ((counts[t] as number) > (t === first ? Math.floor(m / 2) : cap)) return false
  return true
}

/**
 * A stimulus stream of `n` glyphs with balanced counts ({@link balancedCounts}) and no immediate
 * repeats. Each slot draws a glyph with probability ∝ its remaining count among the glyphs that
 * differ from the previous one and leave the rest arrangeable, so the draw never dead-ends.
 */
export function drawSequence(rng: Rng, n: number = CODING_SEQUENCE_LENGTH): CodingSymbol[] {
  const counts = balancedCounts(rng, n)
  const out: CodingSymbol[] = []
  let prev = -1
  for (let pos = 0; pos < n; pos++) {
    const after = n - pos - 1
    const weights = counts.map((c, s) => {
      if (s === prev || c === 0) return 0
      counts[s] = c - 1
      const ok = arrangeable(counts, after, s)
      counts[s] = c
      return ok ? c : 0
    })
    const total = weights.reduce((a, w) => a + w, 0)
    if (total === 0) throw new Error('drawSequence(): no admissible glyph (unreachable)')
    let r = rng.int(0, total - 1)
    let s = 0
    while (r >= (weights[s] as number)) r -= weights[s++] as number
    counts[s] = (counts[s] as number) - 1
    out.push(CODING_SYMBOLS[s] as CodingSymbol)
    prev = s
  }
  return out
}

/**
 * The canonical structure of a stream under glyph relabelling (A11): each glyph replaced by
 * the order of its first appearance (0, 1, …). Blocks with the same pattern are isomorphs
 * whatever the glyphs and the table, so this is what `family_id` hashes.
 */
export function sequencePattern(sequence: readonly string[]): number[] {
  const first = new Map<string, number>()
  return sequence.map((s) => {
    let i = first.get(s)
    if (i === undefined) {
      i = first.size
      first.set(s, i)
    }
    return i
  })
}

/** `structural_params` of a block: the design and the relabelling-canonical stream pattern. */
export function codingStructure(sequence: readonly string[]): JsonValue {
  return {
    design: 'symbol_digit',
    n_symbols: CODING_SYMBOLS.length,
    pattern: sequencePattern(sequence),
  }
}
