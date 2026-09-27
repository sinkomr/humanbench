/**
 * Span block generator (ROADMAP M1.9; DESIGN §14.6 examples 10–11). Draws only from the seeded
 * stream it is given.
 *
 * Sequence rules (checked again by `verify.ts`):
 * - symbols: digits 1–9 (digit span) or Corsi block indices 0–8;
 * - no immediate repeats (…7, 7…);
 * - digits only: no ascending/descending runs of three, i.e. no three consecutive digits that
 *   step by +1 twice (3-4-5) or by −1 twice (8-7-6);
 * - backward only: no palindromes, so repeating the forward order is never exactly correct;
 * - no repeated sequence within a block.
 * Each element is drawn uniformly from the symbols the rules still allow (always ≥ 7 of 9), so
 * a sequence never dead-ends; a repeated or palindromic sequence is redrawn.
 */

import type { Rng } from '../../engine'
import { CORSI_BOARD, START_LENGTH, TRIALS_PER_LENGTH, type CorsiBoard, type SpanTaskConfig } from './config'

/** Redraws allowed for one trial before giving up (a collision is < 1% likely per draw). */
const MAX_REDRAWS = 1000

/** The symbol that would complete a ±1 run of three after `…, a, b`, or undefined. */
export function runCompletion(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined || b === undefined || Math.abs(b - a) !== 1) return undefined
  return b + (b - a)
}

/** One sequence of `length` symbols under the task's element rules (not distinctness). */
export function drawSequence(rng: Rng, cfg: SpanTaskConfig, length: number): number[] {
  const seq: number[] = []
  for (let i = 0; i < length; i++) {
    const prev = seq[i - 1]
    const banned = cfg.forbidRuns ? runCompletion(seq[i - 2], prev) : undefined
    seq.push(rng.pick(cfg.symbols.filter((s) => s !== prev && s !== banned)))
  }
  return seq
}

/** True if the sequence reads the same both ways. */
export function isPalindrome(seq: readonly number[]): boolean {
  for (let i = 0, j = seq.length - 1; i < j; i++, j--) if (seq[i] !== seq[j]) return false
  return true
}

/**
 * Every trial of a block in presentation order: `TRIALS_PER_LENGTH` distinct sequences at each
 * length from `START_LENGTH` to the task's maximum.
 */
export function drawTrials(rng: Rng, cfg: SpanTaskConfig): number[][] {
  const trials: number[][] = []
  const seen = new Set<string>()
  for (let length = START_LENGTH; length <= cfg.maxLength; length++) {
    for (let t = 0; t < TRIALS_PER_LENGTH; t++) {
      for (let tries = 0; ; tries++) {
        if (tries >= MAX_REDRAWS) throw new Error(`span ${cfg.name}: no admissible sequence of length ${length}`)
        const seq = drawSequence(rng, cfg, length)
        const id = seq.join(',')
        if (seen.has(id) || (cfg.forbidPalindromes && isPalindrome(seq))) continue
        seen.add(id)
        trials.push(seq)
        break
      }
    }
  }
  return trials
}

/** A fresh copy of the fixed Corsi board for one spec (items share no references). */
export function corsiBoard(): CorsiBoard {
  return { size: CORSI_BOARD.size, blocks: CORSI_BOARD.blocks.map(([x, y]) => [x, y] as const) }
}
