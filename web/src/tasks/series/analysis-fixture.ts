/**
 * TS → bank differential fixture of the series uniqueness analysis (ROADMAP A1, A17; M1.7).
 *
 * The A1 cross-check (`golden/ts_dumps/series.json`) only shows the bank's verifier items that TS
 * accepted, so a TS/Python split on the rejection side (a spurious or missing competitor fit, a
 * DL, ε or interpolant difference) would only shrink one pool and never surface as a
 * disagreement. This fixture records `analyse()` for a seeded set of sequences, accepted and
 * rejected alike: hand-picked edge cases (exact ties, fits inside the ε band, zeros, constants,
 * the review's examples); a mix of generator drafts of every rule and length 5–7 (interleaved
 * m = 5 included), near misses (one visible term moved by ±1 or ±2), random short runs and random
 * letter runs; and sequences from the same mix plus tiny five-term runs that lie near the decision
 * boundary (fits within ε + 2 bits of the least DL that predict different next terms). The bank test `tests/gen/test_series.py` requires `hb.gen.series.rules.analyse` to
 * agree on every case: the fits (rule, coefficients, DL, prediction, minimum-DL set membership),
 * the least DL, the predictions and the interpolant's DL.
 *
 * Refresh it in the bank (run from web/), then update `ANALYSIS_FIXTURE_DIGEST` in series.test.ts:
 *
 *   npx tsx -e "import('./src/tasks/series/analysis-fixture.ts').then((m) => process.stdout.write(m.serializeAnalysisFixture()))" > ../../humanbench-bank/golden/ts_dumps/series.analysis.json
 *
 * When the bank checkout is present, `scripts/ts-dumps-sync.test.ts` fails while the bank copy
 * differs from `serializeAnalysisFixture()` (A17).
 */

import { createRng, type Rng } from '../../engine'
import { canonicalJson } from '../ids'
import { sampleDraft } from './gen'
import {
  ALPHABET,
  EPSILON_BITS,
  MAX_VISIBLE,
  MIN_VISIBLE,
  RULE_NAMES,
  TERM_BOUND,
  analyse,
  compareDl,
  toPosition,
  type Coefficients,
  type Dl,
  type FitName,
} from './rules'

/** Seed of the fixture's sequence stream. */
export const ANALYSIS_FIXTURE_SEED = 'series-analysis-fixture-v1'
/** Seeded cases from the mix, after the hand-picked ones. */
export const ANALYSIS_FIXTURE_N = 1_500
/** Seeded cases near the decision boundary, last. */
export const ANALYSIS_FIXTURE_BOUNDARY_N = 700

/** An exact DL on the wire: `prod` as a decimal string (it can exceed 2^53). */
export interface WireDl {
  readonly bits: number
  readonly prod: string
}

export interface WireFit {
  readonly rule: FitName
  readonly coefficients: Coefficients
  readonly dl: WireDl
  readonly next: number
  readonly in_min_set: boolean
}

/** One analysed sequence (letters as positions 1–26). */
export interface AnalysisCase {
  readonly terms: readonly number[]
  readonly letter: boolean
  /** Sorted by canonical JSON, so the order carries no meaning. */
  readonly fits: readonly WireFit[]
  readonly min_dl: WireDl | null
  readonly predictions: readonly number[]
  readonly interpolant: WireDl
}

export interface AnalysisFixture {
  readonly fixture: 'series.analysis'
  readonly seed: string
  readonly count: number
  readonly cases: readonly AnalysisCase[]
}

/** Hand-picked sequences: [terms, letter]. */
const EDGE_CASES: readonly (readonly [readonly number[], boolean])[] = [
  [[2, 6, 12, 20, 30], false], // §14.6 example 2
  [[2, 4, 3, 4, 4], false], // interleaved and Fibonacci-type tie exactly
  [[3, 1, 0, -1, -3], false], // interleaved → −3, cubic → −7 one bit above: ε decides
  [[8, 10, 13, 18, 26], false], // Fibonacci-type → 39, cubic → 38 0.54 bits above
  [[58, 55, 60, 65, 62], false], // cubic → 43, interleaved → 75 inside ε
  [[43, 4, 35, -4, 27], false], // interleaved m = 5: t_5 rests on t_1, t_3
  [[13, -3, 7, -9, 1], false],
  [[0, 0, 0, 0, 0], false],
  [[7, 7, 7, 7, 7, 7], false],
  [[1, -1, 1, -1, 1], false],
  [[0, 1, 0, 1, 0, 1], false],
  [[1, 2, 4, 8, 16, 32], false],
  [[1, 8, 27, 64, 125], false],
  [[0, 1, 2, 3, 4], false],
  [[1, 3, 7, 15, 31], false],
  [[1, 2, 3, 6, 7, 14], false],
  [[36, 32, 27, 21, 18], false],
  [[10_000, 5_000, 2_500, 1_250, 625], false],
  [[-10_000, 10_000, -10_000, 10_000, -10_000], false],
  [[24, 1, 4, 7, 10], true], // X A D G J
  [[1, 2, 4, 8, 16], true], // A B D H P
  [[5, 5, 5, 5, 5], true],
  [[26, 1, 26, 1, 26, 1], true],
]

const bounded = (v: readonly number[]): boolean => v.every((x) => Number.isSafeInteger(x) && Math.abs(x) <= TERM_BOUND)

/** A generator draft's visible terms (any rule, any length 5–7, not checked for uniqueness). */
function draftTerms(rng: Rng): [number[], boolean] {
  for (;;) {
    const rule = rng.pick(RULE_NAMES)
    const m = rng.int(MIN_VISIBLE, MAX_VISIBLE)
    const values = sampleDraft(rng, rule, m).values.slice(0, m)
    if (bounded(values)) return [values, rule === 'letter']
  }
}

/** One seeded sequence: 40% drafts, 30% near misses, 18% random short runs, 12% random letters. */
function seededTerms(rng: Rng): [number[], boolean] {
  const u = rng.next()
  const m = rng.int(MIN_VISIBLE, MAX_VISIBLE)
  if (u < 0.4) return draftTerms(rng)
  if (u < 0.7) {
    const [terms, letter] = draftTerms(rng)
    const i = rng.int(0, terms.length - 1)
    const delta = rng.pick([-2, -1, 1, 2])
    terms[i] = letter ? toPosition((terms[i] as number) + delta) : (terms[i] as number) + delta
    return [terms, letter]
  }
  if (u < 0.88) {
    const hi = rng.pick([3, 6, 12, 60])
    return [Array.from({ length: m }, () => rng.int(-hi, hi)), false]
  }
  return [Array.from({ length: m }, () => rng.int(1, ALPHABET)), true]
}

/** A mix sequence (half the time) or a tiny five-term run, kept only near the decision boundary (above). */
function boundaryTerms(rng: Rng): [number[], boolean] {
  for (;;) {
    const hi = rng.pick([2, 4, 8])
    const [terms, letter] = rng.next() < 0.5 ? seededTerms(rng) : [Array.from({ length: 5 }, () => rng.int(-hi, hi)), false]
    const a = analyse(terms, letter)
    const floor = a.min
    if (floor === undefined) continue
    const near = a.fits.filter((f) => compareDl(f.dl, floor, EPSILON_BITS + 2) <= 0)
    if (new Set(near.map((f) => f.next)).size >= 2) return [terms, letter]
  }
}

const wireDl = (dl: Dl): WireDl => ({ bits: dl.bits, prod: dl.prod.toString() })

/** The fixture record of `analyse(terms, letter)`. */
export function analysisCase(terms: readonly number[], letter: boolean): AnalysisCase {
  const a = analyse(terms, letter)
  const inMin = new Set(a.minSet)
  const fits = a.fits
    .map((f) => ({ rule: f.rule, coefficients: f.coefficients, dl: wireDl(f.dl), next: f.next, in_min_set: inMin.has(f) }))
    .map((f) => [canonicalJson(f), f] as const)
    .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
    .map(([, f]) => f)
  return {
    terms: [...terms],
    letter,
    fits,
    min_dl: a.min === undefined ? null : wireDl(a.min),
    predictions: a.predictions,
    interpolant: wireDl(a.interpolant),
  }
}

/** The hand-picked cases, then {@link ANALYSIS_FIXTURE_N} mix and {@link ANALYSIS_FIXTURE_BOUNDARY_N} boundary ones. */
export function analysisFixture(n = ANALYSIS_FIXTURE_N, boundaryN = ANALYSIS_FIXTURE_BOUNDARY_N): AnalysisFixture {
  const rng = createRng(ANALYSIS_FIXTURE_SEED)
  const cases = EDGE_CASES.map(([t, letter]) => analysisCase(t, letter))
  for (let i = 0; i < n; i++) {
    const [terms, letter] = seededTerms(rng)
    cases.push(analysisCase(terms, letter))
  }
  for (let i = 0; i < boundaryN; i++) {
    const [terms, letter] = boundaryTerms(rng)
    cases.push(analysisCase(terms, letter))
  }
  return { fixture: 'series.analysis', seed: ANALYSIS_FIXTURE_SEED, count: cases.length, cases }
}

/** Fixture JSON: header fields, then one canonical-JSON case per line (stable diffs). */
export function serializeAnalysisFixture(fixture: AnalysisFixture = analysisFixture()): string {
  const head = `{"fixture":${JSON.stringify(fixture.fixture)},"seed":${JSON.stringify(fixture.seed)},"count":${fixture.count},"cases":[`
  return `${head}\n${fixture.cases.map((c) => canonicalJson(c)).join(',\n')}\n]}\n`
}
