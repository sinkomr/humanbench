/**
 * Series scoring (DESIGN §4.2, §8; ROADMAP M1.7): exact match on the next term. An integer key
 * (`{ value: "42", tol: { abs: 0 } }`, the shared `NumericKey`) accepts a number or text such as
 * " 42", "+42" or "−7" (Unicode minus); a letter key accepts one letter in either case. Anything
 * else scores 0.
 */

import type { ItemScore } from '../family'
import { WORD_SEPARATOR_RE } from '../priors'
import type { SeriesItem, SeriesResponse } from './types'

const INTEGER_TEXT = /^[+-]?[0-9]+$/

/**
 * Leading and trailing space, as an explicit class shared with the bank's scorer: the characters
 * of `WORD_SEPARATOR_RE` (JS `\s`, so the same as `trim()`), not Python's `str.strip()` set, which
 * also strips U+001C–U+001F and U+0085 but keeps U+FEFF (A1: from M2 on the server's score counts).
 */
const EDGE_SPACE = new RegExp(`^${WORD_SEPARATOR_RE.source}|${WORD_SEPARATOR_RE.source}$`, 'g')

/** `text` without leading and trailing {@link EDGE_SPACE}. */
export function stripSpace(text: string): string {
  return text.replace(EDGE_SPACE, '')
}

/** The integer a response denotes, or undefined. */
export function parseIntegerResponse(response: unknown): number | undefined {
  if (typeof response === 'number') return Number.isSafeInteger(response) ? response : undefined
  if (typeof response !== 'string') return undefined
  const text = stripSpace(response).replace(/^[−–]/, '-')
  if (!INTEGER_TEXT.test(text)) return undefined
  const v = Number(text)
  return Number.isSafeInteger(v) ? v + 0 : undefined
}

/** The uppercase letter a response denotes, or undefined. */
export function parseLetterResponse(response: unknown): string | undefined {
  if (typeof response !== 'string') return undefined
  const text = stripSpace(response)
  return /^[A-Za-z]$/.test(text) ? text.toUpperCase() : undefined
}

export function scoreSeries(item: SeriesItem, response: SeriesResponse): ItemScore {
  const key = item.key
  if ('letter' in key) return { correct: parseLetterResponse(response) === key.letter ? 1 : 0 }
  const v = parseIntegerResponse(response)
  return { correct: v !== undefined && Math.abs(v - Number(key.value)) <= key.tol.abs ? 1 : 0 }
}
