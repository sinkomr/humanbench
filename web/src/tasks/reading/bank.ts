/**
 * The runtime reading-speed passage bank (ROADMAP M1.12, A14): `passages.render.json`, the
 * projection of the authored bank `passages.json` without the verifier-only fields
 * (`evidence_span`, `option_rationales`). This is the only passage data the app bundle carries;
 * the authored file is read by `authoring.ts`, which only tests and tools import (checked in a
 * production build by `web/scripts/bundle.test.ts`).
 *
 * `passages.json` is the file authors edit: public-domain Project Gutenberg excerpts of works
 * first published before 1928, each with three literal gate questions (4 options, key, verbatim
 * evidence span, a one-line rationale per option). A14 is an ADR exception to "no finite items
 * in pub": these are tier-b speed-gate items, uncalibrated, allowed by §14.3 M1's static pool.
 * The bank's Python twin keeps a byte-identical copy (`hb/gen/reading/passages.json`) and
 * validates it independently.
 *
 * Editing a passage or question changes what existing item ids regenerate to: bump the family's
 * `generatorVersion`, run `npm run sync:reading-render` (the drift test in `bank.test.ts` fails
 * until you do), update the sha256 pinned in `bank.test.ts` and in the twin's tests (so drift
 * fails in either repo alone), copy the file to the bank, re-run the two independent solves
 * (A14) and re-dump for the bank (A11, A17).
 */

import raw from './passages.render.json'
import type { PassageBankFile, RenderBankFile, RenderPassage } from './types'

/** The runtime bank as loaded (checked against the authored file in the tests). */
export const READING_BANK: RenderBankFile = raw as RenderBankFile

/** The passages in bank order (generate() picks among these by index). */
export const PASSAGES: readonly RenderPassage[] = READING_BANK.passages

const BY_ID: ReadonlyMap<string, RenderPassage> = new Map(PASSAGES.map((p) => [p.id, p]))

/** The passage with this id, or undefined. */
export function passageById(id: string): RenderPassage | undefined {
  return BY_ID.get(id)
}

/** The runtime projection of an authored bank: every field except `evidence_span` and `option_rationales`. */
export function toRenderBank(file: PassageBankFile): RenderBankFile {
  return {
    version: file.version,
    passages: file.passages.map((p) => ({
      id: p.id,
      source: p.source,
      paragraphs: p.paragraphs,
      word_count: p.word_count,
      questions: p.questions.map((q) => ({ id: q.id, stem: q.stem, options: q.options, key_index: q.key_index })),
    })),
  }
}

/** `passages.render.json` as written: two-space JSON plus a final newline, like `passages.json`. */
export function serializeRenderBank(bank: RenderBankFile): string {
  return `${JSON.stringify(bank, null, 2)}\n`
}
