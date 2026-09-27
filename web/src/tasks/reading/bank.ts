/**
 * The authored reading-speed passage bank (ROADMAP M1.12, A14): `passages.json`, public-domain
 * Project Gutenberg excerpts of works first published before 1928, each with three literal gate
 * questions (4 options, key, verbatim evidence span, a one-line rationale per option).
 *
 * A14 is an ADR exception to "no finite items in pub": these are tier-b speed-gate items,
 * uncalibrated, allowed by §14.3 M1's static pool. The bank's Python twin keeps a byte-identical
 * copy (`hb/gen/reading/passages.json`) and validates it independently.
 *
 * Editing a passage or question changes what existing item ids regenerate to: bump the family's
 * `generatorVersion` and re-dump for the bank (A11, A17).
 */

import raw from './passages.json'
import type { PassageBankFile, PassageRecord } from './types'

/** The bank as loaded (validated by `bankProblems` in the tests, never at import time). */
export const READING_BANK: PassageBankFile = raw as PassageBankFile

/** The passages in bank order (generate() picks among these by index). */
export const PASSAGES: readonly PassageRecord[] = READING_BANK.passages

const BY_ID: ReadonlyMap<string, PassageRecord> = new Map(PASSAGES.map((p) => [p.id, p]))

/** The passage with this id, or undefined. */
export function passageById(id: string): PassageRecord | undefined {
  return BY_ID.get(id)
}
