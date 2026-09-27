/**
 * Generator of the `reading` family (ROADMAP M1.12, A11; DESIGN §14.6 example 13): a seeded
 * pick of one bank passage, then an independent shuffle of each question's four options. The
 * question order stays as authored (it follows the passage). Everything is drawn from the
 * seeded stream, so `generate(item.seed)` rebuilds the item (A11).
 */

import type { Rng } from '../../engine'
import type { BuildContext, BuiltItem } from '../family'
import type { Stratum } from '../ids'
import { PASSAGES } from './bank'
import { readingDifficulty, readingExpectedTimeS, readingItemParams, readingStratum } from './prior'
import type { PassageRecord, ReadingKey, ReadingSpec, SpecQuestion } from './types'

/** Every pre-1928 passage has b = 0.4, stratum 3 (§6.ii bands); the family's only stratum. */
export const READING_STRATUM: Stratum = 3

/** Options per gate question. */
export const READING_OPTIONS = 4
/** Gate questions per passage. */
export const READING_QUESTIONS = 3

/** The structure hashed into family_id (A11): a user never reads the same passage twice (§7.7). */
export function readingStructure(passageId: string): { passage_id: string } {
  return { passage_id: passageId }
}

/** Build the block for bank passage `p` with option orders drawn from `rng`. */
export function buildFromPassage(p: PassageRecord, rng: Rng): BuiltItem<ReadingSpec, ReadingKey> {
  const questions: SpecQuestion[] = []
  const indices: number[] = []
  const evidence: string[] = []
  for (const q of p.questions) {
    // order[j] = the authored index of the option shown at position j.
    const order = rng.shuffle(q.options.map((_, i) => i))
    questions.push({ id: q.id, stem: q.stem, options: order.map((i) => q.options[i] as string) })
    indices.push(order.indexOf(q.key_index))
    evidence.push(q.evidence_span)
  }
  const difficulty = readingDifficulty(p)
  const params = readingItemParams(difficulty.b_prior)
  return {
    stratum: readingStratum(difficulty.b_prior),
    spec: { passage_id: p.id, paragraphs: p.paragraphs, word_count: p.word_count, source: p.source, questions },
    key: { indices, evidence },
    structural_params: readingStructure(p.id),
    difficulty,
    expected_time_s: readingExpectedTimeS(p.word_count, params.d, questions),
    params,
  }
}

/** `defineFamily` build(): pick a passage uniformly, then shuffle its options. */
export function buildReading(rng: Rng, ctx: BuildContext): BuiltItem<ReadingSpec, ReadingKey> {
  if (ctx.stratum !== undefined && ctx.stratum !== READING_STRATUM) {
    throw new RangeError(`reading blocks are stratum ${READING_STRATUM}, not ${ctx.stratum}`)
  }
  const p = PASSAGES[rng.int(0, PASSAGES.length - 1)] as PassageRecord
  const built = buildFromPassage(p, rng)
  if (built.stratum !== READING_STRATUM) throw new Error(`reading: passage ${p.id} is not in stratum ${READING_STRATUM}`)
  return built
}
