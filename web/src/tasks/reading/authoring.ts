/**
 * The authored reading bank `passages.json` and its authoring checks (ROADMAP M1.12, A14).
 * TESTS AND TOOLS ONLY: the family (`index.ts`) and the app never import this module, so the
 * verifier-only fields (`evidence_span`, `option_rationales`) stay out of the runtime bundle,
 * which carries the projection `passages.render.json` instead (`bank.ts`; checked in a
 * production build by `web/scripts/bundle.test.ts`).
 *
 * {@link verifyPassage} is `passageChecks` (`verify.ts`) plus the checks of the authored-only
 * fields, with the same names as the bank's Python twin (`hb.gen.reading.bank.verify_passage`):
 * - `evidence_in_passage`: every evidence span has ≥ 3 words, no newline, and is a verbatim
 *   substring of the passage text;
 * - `rationales_complete`: one clean line per option.
 */

import { verdict, type VerifyResult } from '../family'
import { READING_OPTIONS } from './gen'
import raw from './passages.json'
import { countPassageWords, isCleanLine, passageText } from './text'
import type { PassageBankFile, PassageRecord } from './types'
import { MIN_PASSAGES, isStringArray, malformed, passageChecks } from './verify'

/** The authored bank as loaded (validated by {@link bankProblems} in the tests). */
export const AUTHORED_BANK: PassageBankFile = raw as PassageBankFile

/** The authored passages, in the same order as the runtime bank. */
export const AUTHORED_PASSAGES: readonly PassageRecord[] = AUTHORED_BANK.passages

/** Verify one authored record: `passageChecks` plus `evidence_in_passage` and `rationales_complete`. */
export function verifyPassage(p: PassageRecord): VerifyResult {
  try {
    const qs = Array.isArray(p.questions) ? p.questions : []
    const parasOk = isStringArray(p.paragraphs) && p.paragraphs.length > 0
    const text = parasOk ? passageText(p.paragraphs) : ''
    return verdict({
      ...passageChecks(p),
      evidence_in_passage:
        parasOk &&
        qs.every(
          (q) =>
            typeof q.evidence_span === 'string' &&
            !q.evidence_span.includes('\n') &&
            countPassageWords(q.evidence_span) >= 3 &&
            text.includes(q.evidence_span),
        ),
      rationales_complete: qs.every(
        (q) => isStringArray(q.option_rationales) && q.option_rationales.length === READING_OPTIONS && q.option_rationales.every(isCleanLine),
      ),
    })
  } catch (e) {
    return malformed(e)
  }
}

/** Every problem with a whole authored bank (empty = valid): per-passage verdicts, unique ids, size. */
export function bankProblems(passages: readonly PassageRecord[] = AUTHORED_PASSAGES): string[] {
  const out: string[] = []
  if (passages.length < MIN_PASSAGES) out.push(`the bank has ${passages.length} passages; need ≥ ${MIN_PASSAGES}`)
  const ids = new Set<string>()
  const texts = new Set<string>()
  for (const p of passages) {
    const v = verifyPassage(p)
    if (!v.ok) out.push(`${String(p.id)}: ${v.reason}`)
    if (ids.has(p.id)) out.push(`duplicate passage id ${p.id}`)
    ids.add(p.id)
    const t = Array.isArray(p.paragraphs) ? passageText(p.paragraphs) : ''
    if (texts.has(t)) out.push(`${p.id}: duplicate passage text`)
    texts.add(t)
  }
  return out
}
