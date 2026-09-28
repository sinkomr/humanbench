/**
 * Simulated takers for the TS CAT simulation (ROADMAP M1.4b (b); DESIGN §7.1, §14.3 M1
 * acceptance 2; A9, A10). SIMULATION SUPPORT ONLY: never imported by the app.
 *
 * A simulee with true θ answers the REAL registered families' items and blocks. Every response is
 * drawn from the scoring model of the item's own parameters (`item.params`: the families' A9
 * item models and their A10 block observation parameters, not the M1.4a stand-ins), expressed in
 * the family's response format, and scored by the family's own `score()`, which forms the
 * engine observation exactly as a real session would. So the simulated data follow the model the
 * engine scores with, and any gap between truth and estimate is the design's (items, blocks,
 * time), not a model mismatch; the only approximations are the ones the families' own scorers
 * make (the RT MAD-based SE and trimming, the Poisson SE of the coding count).
 *
 * - **Items** (kind 'item', 2PL / 3PL, A9): y ~ Bernoulli(P(θ)) with the item's a, b (and c); a
 *   correct MC answer is the keyed option, a wrong one another option; a correct entry is the key
 *   (canonical rational or letter), a wrong one an empty entry (unparseable = wrong, M1.F2).
 * - **Span** (GRM, A10): y ~ GRM(θ_WM; a, b_L) from the block's params; the taker passes every
 *   length up to the category's longest length (both trials exact) and fails both trials of the
 *   next, so `score()` returns category y.
 * - **RT** (Gaussian on median log RT, A10): the block location μ = d + lam·θ_RT + τ_res·ε, then
 *   every scored trial ln RT ~ N(μ, {@link RT_WITHIN_SD}²), correct position, no lapses; `score()`
 *   takes the median and its MAD-based SE and trims as in a real block.
 * - **Coding** (Gaussian on ln correct/min, A10): rate = exp(d + lam·θ_PS + τ_res·ε) per minute,
 *   N ~ Poisson(rate · 1.5 min) correct responses evenly spaced in the 90 s window (Var ln N ≈
 *   1/N, the scorer's SE); no errors.
 * - **Reading** (Gaussian on ln wpm, A10): ln wpm = d + lam·θ_PS + √(0.15² + τ_res²)·ε, the §7.1
 *   per-passage SD and the residual; every gate question answered correctly.
 *
 * All randomness comes from the injected seeded stream (engine PRNG), never `Math.random`.
 */

import { grmCumulative, p2pl, p3pl } from '../engine/irt'
import type { Rng } from '../engine/prng'
import type { Observation } from '../engine/types'
import type { AnyFamily, BlockScore, ItemInstance, NumericKey } from '../tasks/family'
import type { CodingItem, CodingResponse } from '../tasks/coding/config'
import type { ReadingKey, ReadingResponse, ReadingSpec } from '../tasks/reading/types'
import { RT_MODE_CONFIG, type RtResponse, type RtSpec } from '../tasks/rt/types'
import { spanSymbols, type SpanItem } from '../tasks/span/config'
import { runBlock } from '../tasks/span/score'
import { SIGMA_MEASUREMENT } from '../tasks/reading/prior'

/** Any family's item instance. */
export type AnyItem = ItemInstance<object, object>

/**
 * [SPEC] within-person SD of ln RT across the trials of one block (simulation only; typical web
 * simple/choice RT CVs are ≈ 0.15–0.25). It only sets the sampling error the RT scorer estimates.
 */
export const RT_WITHIN_SD = 0.2

/** The block families by response format. */
export const SPAN_FAMILIES: ReadonlySet<string> = new Set(['span_fwd', 'span_bwd', 'corsi'])
export const RT_FAMILIES: ReadonlySet<string> = new Set(['rt_simple', 'rt_choice4'])

/** P(correct | θ) of a keyed item by its own model (A9). Throws for block models. */
export function pCorrect(item: Pick<AnyItem, 'params' | 'item_id'>, theta: number): number {
  const p = item.params
  switch (p.model) {
    case '2pl':
    case '2pl_testlet':
      return p2pl(theta, p.a, p.b)
    case '3pl':
      return p3pl(theta, p.a, p.b, p.c)
    default:
      throw new RangeError(`${item.item_id}: a ${p.model} item is a block, not a keyed item`)
  }
}

/** The dichotomous engine observation of a scored item (A9: '2pl_testlet' is scored as '2pl'). */
export function itemObservation(item: Pick<AnyItem, 'params' | 'axis' | 'item_id'>, y: 0 | 1): Observation {
  const p = item.params
  if (p.model === '3pl') return { kind: '3pl', axis: item.axis, a: p.a, b: p.b, c: p.c, y }
  if (p.model === '2pl' || p.model === '2pl_testlet') return { kind: '2pl', axis: item.axis, a: p.a, b: p.b, y }
  throw new RangeError(`${item.item_id}: a ${p.model} item is a block, not a keyed item`)
}

/** A response in the item's own format that is correct iff `y` = 1 (see the module comment). */
export function itemResponse(item: AnyItem, y: 0 | 1, rng: Rng): unknown {
  const k = item.options_count
  const key = item.key as Partial<{ index: number; letter: string }> & Partial<NumericKey>
  if (typeof k === 'number') {
    const right = key.index
    if (typeof right !== 'number') throw new RangeError(`${item.item_id}: an MC item without a key index`)
    return y === 1 ? right : (right + rng.int(1, k - 1)) % k
  }
  if (y === 0) return ''
  if (typeof key.letter === 'string') return key.letter
  if (typeof key.value === 'string') return key.value
  throw new RangeError(`${item.item_id}: an entry item without a value or letter key`)
}

/** Result of answering one keyed item. */
export interface ItemAnswer {
  readonly y: 0 | 1
  readonly response: unknown
  readonly observation: Observation
}

/**
 * Answer a keyed item as a taker with θ on its axis: y ~ Bernoulli(P(θ)), the response in the
 * item's format, scored by the family's `score()` (which must agree with y).
 */
export function answerItem(family: AnyFamily, item: AnyItem, theta: number, rng: Rng): ItemAnswer {
  if (family.kind !== 'item') throw new RangeError(`${family.name} is a block family`)
  const y: 0 | 1 = rng.next() < pCorrect(item, theta) ? 1 : 0
  const response = itemResponse(item, y, rng)
  const scored = family.score(item, response)
  if (scored.correct !== y) throw new Error(`${item.item_id}: ${family.name}.score() gave ${String(scored.correct)} for a simulated y = ${y}`)
  return { y, response, observation: itemObservation(item, y) }
}

// ------------------------------------------------------------------------------ blocks

function gaussianParams(item: AnyItem): { lam: number; d: number; sigma: number } {
  const p = item.params
  if (p.model !== 'gaussian') throw new RangeError(`${item.item_id}: params.model ${p.model}, not gaussian`)
  return p
}

/** GRM category y = #{j ≥ 1 : u < P*(≥j)} for a uniform u (P(y = j) = P*(≥j) − P*(≥j+1)). */
export function grmCategory(theta: number, a: number, thresholds: readonly number[], u: number): number {
  const cum = grmCumulative(theta, a, thresholds)
  let y = 0
  for (let j = 1; j < cum.length - 1; j++) if (u < cum[j]!) y = j
  return y
}

/** A wrong entry for `expected`: the first element changed to another symbol of the task. */
function wrongEntry(item: SpanItem, expected: readonly number[]): number[] {
  const out = [...expected]
  const symbols = spanSymbols(item.spec.task)
  const first = expected[0]!
  out[0] = symbols.find((s) => s !== first)!
  return out
}

/** The response stream of a span taker whose longest passed length is `longest` (0 = none). */
export function spanStream(item: SpanItem, longest: number): number[][] {
  const out: number[][] = []
  for (;;) {
    const status = runBlock(item, out)
    if (status.finished) return out
    const expected = item.key.sequences[status.trial]!
    out.push(status.length <= longest ? [...expected] : wrongEntry(item, expected))
  }
}

/** A span block response: category y ~ GRM(θ) from the block's params, as a response stream. */
export function spanResponse(item: SpanItem, theta: number, rng: Rng): number[][] {
  const p = item.params
  if (p.model !== 'grm') throw new RangeError(`${item.item_id}: params.model ${p.model}, not grm`)
  const y = grmCategory(theta, p.a, p.b, rng.next())
  return spanStream(item, y === 0 ? 0 : item.spec.start_length + y - 1)
}

/** An RT block response (see the module comment); RTs in whole 0.1 ms. */
export function rtResponse(item: ItemInstance<RtSpec, object>, theta: number, rng: Rng): RtResponse {
  const { lam, d, sigma } = gaussianParams(item)
  const mu = d + lam * theta + sigma * rng.normal()
  const simple = RT_MODE_CONFIG[item.spec.mode].n_positions === 1
  const rt = item.spec.positions.map(() => Math.round(10 * Math.exp(mu + RT_WITHIN_SD * rng.normal())) / 10)
  return { rt_ms: rt, choice: item.spec.positions.map((pos) => (simple ? 0 : pos)) }
}

/** A Poisson(λ) count (Knuth's product of uniforms; λ ≤ 700 so e^−λ stays a normal double). */
export function poisson(lambda: number, rng: Rng): number {
  if (!(Number.isFinite(lambda) && lambda >= 0 && lambda <= 700)) throw new RangeError(`poisson(): λ must be in [0, 700], got ${lambda}`)
  const limit = Math.exp(-lambda)
  let k = 0
  let prod = 1 - rng.next() // (0, 1]
  while (prod > limit) {
    k++
    prod *= 1 - rng.next()
  }
  return k
}

/** A coding block response (see the module comment): N correct responses evenly spaced in the window. */
export function codingResponse(item: CodingItem, theta: number, rng: Rng): CodingResponse[] {
  const { lam, d, sigma } = gaussianParams(item)
  const perMin = Math.exp(d + lam * theta + sigma * rng.normal())
  const windowMs = item.spec.duration_s * 1000
  const n = Math.min(poisson((perMin * item.spec.duration_s) / 60, rng), item.spec.sequence.length)
  return item.spec.sequence.slice(0, n).map((glyph, k) => ({ digit: item.key.table[glyph], t_ms: ((k + 1) * windowMs) / (n + 1) }))
}

/** A reading block response (see the module comment); the reading time in whole ms. */
export function readingResponse(item: ItemInstance<ReadingSpec, ReadingKey>, theta: number, rng: Rng): ReadingResponse {
  const { lam, d, sigma } = gaussianParams(item)
  const sd = Math.sqrt(SIGMA_MEASUREMENT * SIGMA_MEASUREMENT + sigma * sigma)
  const wpm = Math.exp(d + lam * theta + sd * rng.normal())
  return { reading_time_ms: Math.max(1, Math.round((item.spec.word_count * 60_000) / wpm)), choices: [...item.key.indices] }
}

/** A block response for any registered block family (by name). */
export function blockResponse(item: AnyItem, theta: number, rng: Rng): unknown {
  if (SPAN_FAMILIES.has(item.family)) return spanResponse(item as SpanItem, theta, rng)
  if (RT_FAMILIES.has(item.family)) return rtResponse(item as ItemInstance<RtSpec, object>, theta, rng)
  if (item.family === 'coding') return codingResponse(item as CodingItem, theta, rng)
  if (item.family === 'reading') return readingResponse(item as ItemInstance<ReadingSpec, ReadingKey>, theta, rng)
  throw new RangeError(`no simulated taker for block family ${item.family}`)
}

/** Result of running one fixed block. */
export interface BlockAnswer {
  readonly response: unknown
  readonly score: BlockScore
}

/** Run a fixed block as a taker with θ on its axis and score it with the family's `score()`. */
export function answerBlock(family: AnyFamily, item: AnyItem, theta: number, rng: Rng): BlockAnswer {
  if (family.kind !== 'block') throw new RangeError(`${family.name} is an item family`)
  const response = blockResponse(item, theta, rng)
  return { response, score: family.score(item, response) }
}
