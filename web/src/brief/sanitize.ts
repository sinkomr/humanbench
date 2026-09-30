/**
 * Checks for the two things a person types into the notes: interests (I1) and their own line
 * (X1). Both are normalised to ASCII, run through the brief lint, and refused rather than
 * repaired when they break a rule (proposal §3.3 step 4: "checked for URLs, digits and trait
 * wording, flagged in the JSON, and never saved"). Neither is ever persisted (R-17.12); these
 * functions are pure and touch no storage.
 */

import { INTEREST_RE, MAX_INTERESTS, isInterest } from './interests'
import { lintLine, lintMessages } from './lint'
import { isTemplateLine } from './match'
import { collapseSpace, normalizeAscii } from './normalize'

export const MAX_CUSTOM_LINES = 3
export const MAX_CUSTOM_CHARS = 200
export const MIN_CUSTOM_CHARS = 3

export interface SanitizedInterests {
  readonly items: string[]
  /** Reasons, worded for the person; empty when everything typed was accepted. */
  readonly problems: string[]
}

/** Interests from a typed, comma-separated (or "and"/"or"-separated) list. */
export function sanitizeInterests(raw: string): SanitizedInterests {
  const problems: string[] = []
  const parts = normalizeAscii(raw)
    .toLowerCase()
    .split(/[,;\n/&+]|\s+(?:and|or)\s+/u)
    .map(collapseSpace)
    .filter((p) => p !== '')
  const items: string[] = []
  for (const p of parts) {
    const hits = lintLine(p)
    if (hits.length > 0) {
      problems.push(...lintMessages(hits))
      continue
    }
    if (!INTEREST_RE.test(p) || !isInterest(p)) {
      problems.push('Use a short name made of letters, such as "cooking" or "chess".')
      continue
    }
    if (!items.includes(p)) items.push(p)
  }
  if (items.length > MAX_INTERESTS) {
    problems.push('Only the first three are used.') // MAX_INTERESTS (sanitize.test.ts)
    items.length = MAX_INTERESTS
  }
  return { items, problems: [...new Set(problems)] }
}

export interface SanitizedCustom {
  /** The line as it will be written (ASCII, one line, ending in punctuation), or null when refused or empty. */
  readonly text: string | null
  readonly problems: string[]
}

/** A custom line: one line of the person's own words. Empty input is not a problem, just no line. */
export function sanitizeCustomLine(raw: string): SanitizedCustom {
  let s = collapseSpace(normalizeAscii(raw)).replace(/^[-*#>\s]+/u, '')
  if (s === '') return { text: null, problems: [] }
  // Close the sentence first: the limit is on the line as it will be written (the JSON schema caps it at 200).
  if (!/[.!?)"']$/u.test(s)) s += '.'
  const problems: string[] = []
  if (!/[a-z]{3,}/iu.test(s) || s.length < MIN_CUSTOM_CHARS) problems.push('Write a short sentence.')
  if (s.length > MAX_CUSTOM_CHARS) problems.push('Keep it under two hundred characters.') // MAX_CUSTOM_CHARS (sanitize.test.ts)
  const hits = lintLine(s)
  problems.push(...lintMessages(hits))
  if (problems.length === 0 && isTemplateLine(s)) problems.push('That is already one of the standard lines. Use its tick box instead.')
  return problems.length === 0 ? { text: s, problems } : { text: null, problems: [...new Set(problems)] }
}
