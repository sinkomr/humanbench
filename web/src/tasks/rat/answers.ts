/**
 * How a typed word is compared with the words a word-links puzzle accepts (ROADMAP M6.3; DESIGN §5.4 "Accepted answers
 * include spelling variants"). The rule is the whole of the check, and the bank's `hb.rat.answers` (`answer_key`,
 * `matches`) is its exact mirror: the shared golden vectors that pin the two together belong to the parity package, so
 * nothing here may change without it.
 *
 * - {@link answerKey} folds a text to the letters a-z alone: Unicode NFKD, every combining mark removed (so `é` is `e`
 *   and a full-width `ｃ` is `c`), lower case, then everything that is not an ASCII letter dropped (spaces, hyphens,
 *   apostrophes, digits, emoji). `Cheese-Cake `, `cheese cake` and `cheesecake` have one key.
 * - {@link matches} is true iff the key of the response is not empty and equals the key of one accepted word.
 *
 * What it does NOT do, on purpose: a plural is another word (`cheeses` is not `cheese`), and a spelling variant that
 * folding does not make equal (`grey` and `gray`) is listed in the puzzle's accepted words, which only the bank has.
 * The accepted words never reach this repo for a real puzzle: only the demo's (`demo.ts`) are here.
 */

const MARKS = /\p{M}/gu
const NOT_A_TO_Z = /[^a-z]/g

/** The letters a-z of `text`, folded as the module comment says. Idempotent; `''` when `text` has no letter. */
export function answerKey(text: string): string {
  return text.normalize('NFKD').replace(MARKS, '').toLowerCase().replace(NOT_A_TO_Z, '')
}

/** True iff `response` has a letter and has the same key as one of the `accept` words. */
export function matches(response: string, accept: readonly string[]): boolean {
  const key = answerKey(response)
  return key !== '' && accept.some((a) => answerKey(a) === key)
}
