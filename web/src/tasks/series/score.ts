/**
 * Series scoring (DESIGN §4.2, §8; ROADMAP M1.7): exact match on the next term. An integer key
 * (tol 0) accepts a number or text such as " 42", "+42" or "−7" (Unicode minus); a letter key
 * accepts one letter in either case. Anything else scores 0.
 */

import type { ScoreResult } from '../family'
import type { SeriesItem, SeriesResponse } from './types'

const INTEGER_TEXT = /^[+-]?[0-9]+$/

/** The integer a response denotes, or undefined. */
export function parseIntegerResponse(response: unknown): number | undefined {
  if (typeof response === 'number') return Number.isSafeInteger(response) ? response : undefined
  if (typeof response !== 'string') return undefined
  const text = response.trim().replace(/^[−–]/, '-')
  if (!INTEGER_TEXT.test(text)) return undefined
  const v = Number(text)
  return Number.isSafeInteger(v) ? v + 0 : undefined
}

/** The uppercase letter a response denotes, or undefined. */
export function parseLetterResponse(response: unknown): string | undefined {
  if (typeof response !== 'string') return undefined
  const text = response.trim()
  return /^[A-Za-z]$/.test(text) ? text.toUpperCase() : undefined
}

export function scoreSeries(item: SeriesItem, response: SeriesResponse): ScoreResult {
  const key = item.key
  if ('letter' in key) return { correct: parseLetterResponse(response) === key.letter ? 1 : 0 }
  const v = parseIntegerResponse(response)
  return { correct: v !== undefined && Math.abs(v - key.value) <= key.tol ? 1 : 0 }
}
