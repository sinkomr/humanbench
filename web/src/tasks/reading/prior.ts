/**
 * Norms, item parameters and priors of the `reading` family (ROADMAP M1.P, A10; DESIGN §6.ii,
 * §7.1, §7.3, §7.4). Every number here is provisional until M4.8 calibrates the PS model.
 *
 * Measurement model (§7.1, A10): a passed block gives x = ln(wpm), a Gaussian observation on
 * θ_PS, x ~ N(lam·θ + d, sigma²), with
 * - lam = s = 0.25 ln-wpm per θ SD [SPEC];
 * - d = ln 238 − s·b, where 238 wpm is Brysbaert's (2019) silent-reading norm for non-fiction
 *   [EST, §7.3] and b is the passage prior below; for pre-1928 prose b = 0.4, so
 *   d = ln 238 − 0.1 (the [SPEC] era adjustment of −0.1 ln-wpm, ≈ 215 wpm at θ = 0);
 * - params.sigma = τ_res = 0.05 [SPEC], the model residual, the same provisional value as the
 *   other A10 Gaussian blocks (RT, coding): the one meaning of a Gaussian block's sigma (M1.F2,
 *   `family.ts`). A passed block's observation has sigma = √(0.15² + τ_res²), where 0.15 is the
 *   §7.1 per-passage SD of ln wpm (it already covers passage-to-passage variation), the block's
 *   own measurement SE. (Before generator 1.4.0 `params.sigma` held that observation sigma.)
 *
 * The item's b (difficulty prior, M1.P) is on the θ scale: the θ at which a reader's expected
 * speed on this passage equals the 238-wpm norm, so d = ln 238 − s·b keeps the two consistent.
 */

import type { ItemParams } from '../../engine'
import type { DifficultyPrior, Feature } from '../family'
import type { Stratum } from '../ids'
import { SIGMA_B_DEFAULT, clampPrior, linearB, stratumOfB, type LinearPriorModel } from '../priors'
import { countLetters, countPassageWords, countSentences, passageText } from './text'
import type { PassageRecord, SpecQuestion } from './types'

/** Version tag of the norms below. */
export const READING_NORMS_VERSION = 'reading-v0'

/** [EST] Brysbaert (2019): silent reading of non-fiction, 238 wpm (§7.3). */
export const NORM_WPM = 238
/** [SPEC] ln-wpm per θ SD (A10 PS reading observation). */
export const READING_S = 0.25
/** [SPEC] era adjustment of ln wpm for pre-1928 prose. */
export const PRE_1928_SHIFT = -0.1
/** §7.1: SD of ln wpm per passage. */
export const SIGMA_MEASUREMENT = 0.15
/** [SPEC] residual SD of ln wpm beyond the §7.1 per-passage SD (as for the RT and coding blocks, A10). */
export const TAU_RES = 0.05
/** Works first published in or after this year are not public domain everywhere; excluded (§6.i). */
export const PUBLIC_DOMAIN_BEFORE = 1928

/**
 * [SPEC] v0 difficulty regression (M1.P), b on θ:
 * b = 0 + 0.4·pre_1928 + 0·(mean_sentence_words − 25) + 0·(letters_per_word − 4.5).
 * The era term is the −0.1 ln-wpm adjustment divided by s (0.1 / 0.25 = 0.4); the readability
 * terms are recorded as features with coefficient 0 until M4.8 fits them.
 */
export const READING_PRIOR: LinearPriorModel = Object.freeze({
  anchorB: 0,
  terms: Object.freeze({
    pre_1928: Object.freeze({ beta: -PRE_1928_SHIFT / READING_S, centre: 0 }),
    mean_sentence_words: Object.freeze({ beta: 0, centre: 25 }),
    letters_per_word: Object.freeze({ beta: 0, centre: 4.5 }),
  }),
})

export const READING_PROVENANCE =
  '[SPEC] v0 reading prior: b = 0.4*pre_1928 + 0*(mean_sentence_words - 25) + 0*(letters_per_word - 4.5), ' +
  'where 0.4 = the -0.1 ln-wpm pre-1928 era shift / s = 0.25; Gaussian d = ln 238 - s*b ' +
  '(Brysbaert 2019 non-fiction 238 wpm [EST], DESIGN 7.3); sd_prior 1.0 (M1.P, A10)'

/** The regression features of a passage (plus informational fields). */
export function readingFeatures(p: Pick<PassageRecord, 'id' | 'paragraphs' | 'source'>): Record<string, Feature> {
  const text = passageText(p.paragraphs)
  const words = countPassageWords(text)
  const sentences = countSentences(text)
  return {
    passage_id: p.id,
    year: p.source.year,
    era: p.source.era,
    pre_1928: p.source.year < PUBLIC_DOMAIN_BEFORE,
    words,
    sentences,
    mean_sentence_words: words / sentences,
    letters_per_word: countLetters(text) / words,
    n_questions: 3,
  }
}

/** The block's difficulty prior: features, b from {@link READING_PRIOR}, σ_b = 1.0. */
export function readingDifficulty(p: Pick<PassageRecord, 'id' | 'paragraphs' | 'source'>): DifficultyPrior {
  const features = readingFeatures(p)
  return {
    features,
    b_prior: clampPrior(linearB(READING_PRIOR, features)),
    sd_prior: SIGMA_B_DEFAULT,
    provenance: READING_PROVENANCE,
  }
}

/** The A10 Gaussian item parameters for a block with prior location b. */
export function readingItemParams(bPrior: number): Extract<ItemParams, { model: 'gaussian' }> {
  return {
    model: 'gaussian',
    lam: READING_S,
    d: Math.log(NORM_WPM) - READING_S * bPrior,
    sigma: TAU_RES,
  }
}

/** The stratum of a block: the §6.ii band of its b (pre-1928 passages: b = 0.4 → 3). */
export function readingStratum(bPrior: number): Stratum {
  return stratumOfB(bPrior)
}

/**
 * [SPEC] v0 block-time model (§7.4 E[T]; for blocks the block duration): instructions, then
 * reading at the passage's expected speed exp(d) wpm, then per question a 5 s decision plus the
 * §7.4 rate of 4 s per 50 words of stem and options.
 */
export const READING_TIME_MODEL = Object.freeze({ instructions_s: 10, question_base_s: 5, seconds_per_50_words: 4 })

/** Expected block duration in seconds: 10 + 60·W/exp(d) + Σ_q (5 + 4·w_q/50). */
export function readingExpectedTimeS(words: number, d: number, questions: readonly Pick<SpecQuestion, 'stem' | 'options'>[]): number {
  let t = READING_TIME_MODEL.instructions_s
  t += (60 * words) / Math.exp(d)
  for (const q of questions) {
    let w = countPassageWords(q.stem)
    for (const o of q.options) w += countPassageWords(o)
    t += READING_TIME_MODEL.question_base_s + (READING_TIME_MODEL.seconds_per_50_words * w) / 50
  }
  return t
}
