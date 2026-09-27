/**
 * Verifier of the `reading` family (ROADMAP M1.12, A14; DESIGN §4.1 G2/G3). Two layers:
 *
 * 1. {@link passageChecks}: the authoring rules of one passage, applied both to the bank records
 *    ({@link verifyPassage}, {@link bankProblems}) and to the passage an item carries:
 *    - `id_valid`: lowercase kebab-case id;
 *    - `paragraphs_clean`: ≥ 1 paragraph, each in the allowed charset, no tabs/newlines/double spaces;
 *    - `no_boilerplate`: no Gutenberg header, footer, licence or credit text (`BOILERPLATE_RE`);
 *    - `word_count_in_range`: 330–370 words under the WORD RULE (`text.ts`);
 *    - `word_count_matches`: the recorded word_count equals the recount;
 *    - `provenance_complete`: title, author, section, era, ebook number, both URLs (matching the
 *      ebook number), retrieved date, sha256, offsets, first/last words all present and well formed;
 *    - `year_before_1928`: first published before 1928 (public domain, §6.i);
 *    - `era_matches_year`: era is the decade of the year, e.g. 1861 → "1860s";
 *    - `excerpt_bounds_match`: the text starts with first_words and ends with last_words, and the
 *      source span (offsets) is at least as long as the stored text (it only loses whitespace);
 *    - `three_questions`, `question_ids_valid` (`<id>#q1..3`), `stems_clean` (ending in "?");
 *    - `four_options`, `options_clean`, `options_distinct` (case- and space-insensitive);
 *    - `key_in_range`: every key index is an integer 0–3;
 *    - `evidence_in_passage`: every evidence span has ≥ 3 words, no newline, and is a verbatim
 *      substring of the passage text.
 *    Bank records also need `rationales_complete` (one clean line per option).
 * 2. {@link verifyReading}: an item instance. The passage checks run on the item's own content
 *    (spec + key), and the item must match the bank: `passage_known`, `spec_matches_bank`,
 *    `options_match_bank` (a permutation of the authored options), `key_shape` (exactly
 *    `indices` and `evidence`, one per question), `key_matches_bank` (the keyed option and
 *    evidence are the authored ones), plus `params_match`, `prior_matches`, `stratum_matches`,
 *    `structure_matches` and `expected_time_matches`. The bank's Python twin
 *    (`hb.gen.reading`) implements the same check names independently.
 */

import type { JsonValue } from '../../engine'
import { verdict, type ItemInstance, type VerifyResult } from '../family'
import { canonicalJson } from '../ids'
import { passageById, PASSAGES } from './bank'
import { READING_OPTIONS, READING_QUESTIONS, READING_STRATUM, readingStructure } from './gen'
import {
  NORM_WPM,
  PUBLIC_DOMAIN_BEFORE,
  READING_S,
  SIGMA_MEASUREMENT,
  TAU_RES,
  readingDifficulty,
  readingExpectedTimeS,
  readingStratum,
} from './prior'
import { BOILERPLATE_RE, countPassageWords, isCleanLine, optionForm, passageText } from './text'
import type { PassageRecord, PassageSource, ReadingKey, ReadingSpec } from './types'

/** Inclusive word-count range of a passage (§14.6 example 13: ~350 words). */
export const MIN_WORDS = 330
export const MAX_WORDS = 370
/** The bank must hold at least this many passages (ROADMAP M1.12). */
export const MIN_PASSAGES = 6
/** Tolerance for recomputed floating-point values (params.d, expected_time_s). */
export const FLOAT_TOL = 1e-9

/** The passage fields the checks read; for an item, questions come from spec + key. */
export interface PassageUnderTest {
  readonly id: unknown
  readonly source: unknown
  readonly paragraphs: unknown
  readonly word_count: unknown
  readonly questions: readonly {
    readonly id: unknown
    readonly stem: unknown
    readonly options: unknown
    readonly key_index: unknown
    readonly evidence_span: unknown
  }[]
}

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const SHA256_RE = /^[0-9a-f]{64}$/

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isNat = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

/** A real calendar date written YYYY-MM-DD (proleptic Gregorian; no clock involved). */
function isIsoDate(s: unknown): boolean {
  if (typeof s !== 'string') return false
  const m = DATE_RE.exec(s)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]
  return days !== undefined && d >= 1 && d <= days
}

/** Every field of the source present and well formed (the ebook number ties both URLs). */
function provenanceComplete(s: unknown): boolean {
  if (!isObj(s)) return false
  const n = s.gutenberg_ebook
  const off = s.offsets
  return (
    isNonEmptyString(s.title) &&
    isNonEmptyString(s.author) &&
    isNonEmptyString(s.section) &&
    typeof s.year === 'number' &&
    Number.isInteger(s.year) &&
    isNonEmptyString(s.era) &&
    isNat(n) &&
    n > 0 &&
    s.url === `https://www.gutenberg.org/ebooks/${n}` &&
    s.text_url === `https://www.gutenberg.org/cache/epub/${n}/pg${n}.txt` &&
    isIsoDate(s.retrieved) &&
    typeof s.sha256 === 'string' &&
    SHA256_RE.test(s.sha256) &&
    isObj(off) &&
    isNat(off.start) &&
    isNat(off.end) &&
    off.end > off.start &&
    isNonEmptyString(s.first_words) &&
    isNonEmptyString(s.last_words)
  )
}

/** The named checks of one passage (see the module comment); booleans only. */
export function passageChecks(p: PassageUnderTest): Record<string, boolean> {
  const paragraphs = p.paragraphs
  const parasOk = isStringArray(paragraphs) && paragraphs.length > 0
  const text = parasOk ? passageText(paragraphs) : ''
  const words = countPassageWords(text)
  const src = (isObj(p.source) ? p.source : {}) as Partial<Record<keyof PassageSource, unknown>>
  const year = src.year
  const off = isObj(src.offsets) ? src.offsets : {}
  const qs = Array.isArray(p.questions) ? p.questions : []
  const optionLists = qs.map((q) => (isStringArray(q.options) ? q.options : null))
  const firstWords = src.first_words
  const lastWords = src.last_words
  return {
    id_valid: typeof p.id === 'string' && ID_RE.test(p.id),
    paragraphs_clean: parasOk && paragraphs.every(isCleanLine),
    no_boilerplate: parasOk && !BOILERPLATE_RE.test(text),
    word_count_in_range: words >= MIN_WORDS && words <= MAX_WORDS,
    word_count_matches: p.word_count === words,
    provenance_complete: provenanceComplete(p.source),
    year_before_1928: typeof year === 'number' && Number.isInteger(year) && year < PUBLIC_DOMAIN_BEFORE,
    era_matches_year: typeof year === 'number' && Number.isInteger(year) && src.era === `${Math.floor(year / 10) * 10}s`,
    excerpt_bounds_match:
      parasOk &&
      typeof firstWords === 'string' &&
      countPassageWords(firstWords) >= 3 &&
      text.startsWith(firstWords) &&
      typeof lastWords === 'string' &&
      countPassageWords(lastWords) >= 3 &&
      text.endsWith(lastWords) &&
      isNat(off.start) &&
      isNat(off.end) &&
      off.end - off.start >= text.length,
    three_questions: qs.length === READING_QUESTIONS,
    question_ids_valid: typeof p.id === 'string' && qs.every((q, i) => q.id === `${p.id}#q${i + 1}`),
    stems_clean: qs.every((q) => typeof q.stem === 'string' && isCleanLine(q.stem) && q.stem.endsWith('?')),
    four_options: optionLists.every((o) => o !== null && o.length === READING_OPTIONS),
    options_clean: optionLists.every((o) => o !== null && o.every(isCleanLine)),
    options_distinct: optionLists.every((o) => o !== null && new Set(o.map(optionForm)).size === o.length),
    key_in_range: qs.every((q) => Number.isInteger(q.key_index) && (q.key_index as number) >= 0 && (q.key_index as number) < READING_OPTIONS),
    evidence_in_passage:
      parasOk &&
      qs.every(
        (q) =>
          typeof q.evidence_span === 'string' &&
          !q.evidence_span.includes('\n') &&
          countPassageWords(q.evidence_span) >= 3 &&
          text.includes(q.evidence_span),
      ),
  }
}

function malformed(e: unknown): VerifyResult {
  return { ok: false, reason: `malformed: ${e instanceof Error ? e.message : String(e)}`, checks: {} }
}

/** Verify one authored bank record: {@link passageChecks} plus `rationales_complete`. */
export function verifyPassage(p: PassageRecord): VerifyResult {
  try {
    const qs = Array.isArray(p.questions) ? p.questions : []
    return verdict({
      ...passageChecks(p),
      rationales_complete: qs.every(
        (q) => isStringArray(q.option_rationales) && q.option_rationales.length === READING_OPTIONS && q.option_rationales.every(isCleanLine),
      ),
    })
  } catch (e) {
    return malformed(e)
  }
}

/** Every problem with a whole bank (empty = valid): per-passage verdicts, unique ids, size. */
export function bankProblems(passages: readonly PassageRecord[] = PASSAGES): string[] {
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

/** The passage an item carries, in the shape {@link passageChecks} reads (key from `key`). */
function passageOfItem(item: ItemInstance<ReadingSpec, ReadingKey>): PassageUnderTest {
  const spec = item.spec
  const key = item.key
  const qs = Array.isArray(spec.questions) ? spec.questions : []
  return {
    id: spec.passage_id,
    source: spec.source,
    paragraphs: spec.paragraphs,
    word_count: spec.word_count,
    questions: qs.map((q, i) => ({
      id: q.id,
      stem: q.stem,
      options: q.options,
      key_index: Array.isArray(key.indices) ? key.indices[i] : undefined,
      evidence_span: Array.isArray(key.evidence) ? key.evidence[i] : undefined,
    })),
  }
}

const sameJson = (a: unknown, b: unknown): boolean => {
  try {
    return canonicalJson(a) === canonicalJson(b)
  } catch {
    return false
  }
}

/** The G2/G3 verifier of a reading block (see the module comment). Never throws. */
export function verifyReading(item: ItemInstance<ReadingSpec, ReadingKey>): VerifyResult {
  try {
    const spec = item.spec
    const key = item.key
    if (!isObj(spec) || !isObj(key) || !Array.isArray(spec.questions)) return verdict({ spec_well_formed: false })
    const bank = typeof spec.passage_id === 'string' ? passageById(spec.passage_id) : undefined
    const qs = spec.questions
    const keyShape =
      Array.isArray(key.indices) &&
      Array.isArray(key.evidence) &&
      key.indices.length === qs.length &&
      key.evidence.length === qs.length &&
      Object.keys(key).sort().join(',') === 'evidence,indices'

    let specMatches = false
    let optionsMatch = false
    let keyMatches = false
    if (bank) {
      specMatches =
        sameJson(spec.paragraphs, bank.paragraphs) &&
        spec.word_count === bank.word_count &&
        sameJson(spec.source, bank.source) &&
        qs.length === bank.questions.length &&
        qs.every((q, i) => q.id === bank.questions[i]?.id && q.stem === bank.questions[i]?.stem)
      optionsMatch =
        qs.length === bank.questions.length &&
        qs.every((q, i) => isStringArray(q.options) && sameJson([...q.options].sort(), [...(bank.questions[i]?.options ?? [])].sort()))
      keyMatches =
        keyShape &&
        qs.length === bank.questions.length &&
        qs.every((q, i) => {
          const b = bank.questions[i]
          const k = key.indices[i]
          return (
            b !== undefined &&
            Number.isInteger(k) &&
            isStringArray(q.options) &&
            q.options[k as number] === b.options[b.key_index] &&
            key.evidence[i] === b.evidence_span
          )
        })
    }

    const p = item.params
    const b = item.difficulty.b_prior
    const expectedD = Math.log(NORM_WPM) - READING_S * b
    const expectedSigma = Math.sqrt(SIGMA_MEASUREMENT * SIGMA_MEASUREMENT + TAU_RES * TAU_RES)
    const paramsMatch =
      p.model === 'gaussian' &&
      p.lam === READING_S &&
      Math.abs(p.d - expectedD) <= FLOAT_TOL &&
      Math.abs(p.sigma - expectedSigma) <= FLOAT_TOL &&
      item.options_count === undefined

    const own = passageChecks(passageOfItem(item))
    const parasOk = isStringArray(spec.paragraphs)
    const recomputed = parasOk && isObj(spec.source) ? readingDifficulty({ id: spec.passage_id, paragraphs: spec.paragraphs, source: spec.source }) : null
    const words = parasOk ? countPassageWords(passageText(spec.paragraphs)) : 0
    const timeOk =
      qs.every((q) => typeof q.stem === 'string' && isStringArray(q.options)) &&
      Math.abs(item.expected_time_s - readingExpectedTimeS(words, expectedD, qs)) <= FLOAT_TOL

    const checks: Record<string, JsonValue> = {
      passage_known: bank !== undefined,
      spec_matches_bank: specMatches,
      options_match_bank: optionsMatch,
      key_shape: keyShape,
      key_matches_bank: keyMatches,
      ...own,
      params_match: paramsMatch,
      prior_matches: recomputed !== null && sameJson(item.difficulty, recomputed),
      stratum_matches: item.stratum === READING_STRATUM && readingStratum(b) === READING_STRATUM,
      structure_matches: typeof spec.passage_id === 'string' && sameJson(item.structural_params, readingStructure(spec.passage_id)),
      expected_time_matches: timeOk,
    }
    return verdict(checks)
  } catch (e) {
    return malformed(e)
  }
}
