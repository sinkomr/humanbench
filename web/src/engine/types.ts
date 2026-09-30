/**
 * Shared engine types: item metadata (DESIGN §12 item record), the save-file response tuple
 * (§8) and the scorer's observation union (§7.1–7.2).
 *
 * Wire schema: observation and item-parameter field names match the bank's Python reference and
 * its golden vectors (`golden/scoring_v2.json`, which extends `scoring_v1.json`; ROADMAP A2, M3.9)
 * exactly, so golden cases load without an adapter. In particular the Gaussian loading is `lam`
 * (Python cannot name it `lambda`), a GRM item's increasing thresholds live in `b` as an array,
 * and a testlet is `{kind: 'testlet', axis, tau, items: [{a, b, y}]}`.
 */

import type { AxisCode, GoldTier } from './axes'

/** Any JSON value (response payloads and tuple extras are stored verbatim in the save file). */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/**
 * Item parameters for the scoring model (DESIGN §7.1, §12 `item_parameters`), one variant per
 * model with every field it needs required:
 * - '2pl' / '2pl_testlet': a, b (the testlet's passage/setup id is {@link ItemBase.testlet_id});
 * - '3pl': a, b, c (only for items with k ≤ 4 options, c fixed at 1/k; k ≥ 5 options or
 *   numeric entry → 2PL, ROADMAP A9);
 * - 'grm': a, b = strictly increasing thresholds b_1 < … < b_m;
 * - 'gaussian': lam, d, sigma; lam may be negative. `sigma` here is τ_res, the residual SD of
 *   the statistic x around lam·θ + d beyond a block's own sampling error (M1.F2: the one meaning
 *   of params.sigma, `tasks/family.ts`); the scored observation is x ~ N(lam·θ + d, SE² + τ_res²),
 *   its sigma from `gaussianObservationSigma(SE, params)` (`tasks/family.ts`). An observation's
 *   own `sigma` ({@link Observation}) is that full SD.
 */
export type ItemParams =
  | { model: '2pl'; a: number; b: number }
  | { model: '2pl_testlet'; a: number; b: number }
  | { model: '3pl'; a: number; b: number; c: number }
  | { model: 'grm'; a: number; b: readonly number[] }
  | { model: 'gaussian'; lam: number; d: number; sigma: number }

/** Item metadata the engine needs (DESIGN §12 item record); payload and key live elsewhere. */
export interface ItemBase {
  /** e.g. "i:mat:f0182:v3". */
  item_id: string
  /** e.g. "f:mat:0182"; a user never sees two items of one family (§7.7). */
  family_id: string
  /**
   * The near-isomorph group a session serves at most once (M1.F2, M1.14; A11 amended): the
   * family_id, or `g:<family>:<label>` (quant: per template). Absent = the family_id.
   */
  sibling_group?: string
  axis: AxisCode
  /** Sub-facet reported only in drill-down (§3), e.g. "3d_rotation". */
  facet?: string
  /** Renderer / response format, e.g. "mc", "mc_image_spec", "numeric", "span". */
  item_type: string
  gold_tier: GoldTier
  /**
   * Passage (RC) or game setup (LG) shared by a '2pl_testlet' item's siblings; the unit of the
   * §7.1 testlet effect γ ~ N(0, 0.3²). Absent for items that are not in a testlet.
   */
  testlet_id?: string
  time_limit_s?: number
  /** Expected time E[T_j] in seconds, the denominator of information per second (§7.4). */
  expected_time_s: number
  params: ItemParams
}

/**
 * One response in the save file (DESIGN §8):
 * `[item_id, pretest(0/1), response, correct(0/1/null), rt_ms, confidence_pct, extra?]`.
 * `correct` is null for unkeyed or continuous responses; `confidence_pct` is null when no
 * confidence was asked (§3 row 12: 50–100 on tier-a answers); `extra` carries optional extras.
 *
 * Block responses (kind 'block', A10: RT, span, coding, reading): a writer (M1.15) puts the
 * family's block response object (e.g. `RtResponse`, with every trial) in `response`, with
 * `correct` null. The §8 example's layout, `response` = "trials" with the trial data in `extra`,
 * is also read when re-scoring (`save/rescore.ts` `blockResponseOf`); its data must still be the
 * family's response object (a bare RT list has no choices and is malformed).
 */
export type ResponseTuple = [
  item_id: string,
  pretest: 0 | 1,
  response: JsonValue,
  correct: 0 | 1 | null,
  rt_ms: number,
  confidence_pct: number | null,
  extra?: JsonValue,
]

/**
 * Runtime check that a value is plain JSON (finite numbers, plain objects, dense arrays, bounded
 * depth).
 */
export function isJsonValue(v: unknown, depth = 0): v is JsonValue {
  if (depth > 64) return false
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true
  if (typeof v === 'number') return Number.isFinite(v)
  if (Array.isArray(v)) {
    // An index loop, not every(): every() skips holes, and a hole (read as undefined) is not JSON.
    for (let i = 0; i < v.length; i++) if (!isJsonValue(v[i], depth + 1)) return false
    return true
  }
  if (typeof v === 'object') {
    const proto = Object.getPrototypeOf(v) as unknown
    if (proto !== Object.prototype && proto !== null) return false
    return Object.values(v).every((x) => isJsonValue(x, depth + 1))
  }
  return false
}

/** Runtime validator for a §8 response tuple (e.g. when loading an uploaded save file). */
export function isResponseTuple(t: unknown): t is ResponseTuple {
  if (!Array.isArray(t) || (t.length !== 6 && t.length !== 7)) return false
  const [itemId, pretest, response, correct, rtMs, conf] = t as unknown[]
  return (
    typeof itemId === 'string' &&
    itemId.length > 0 &&
    (pretest === 0 || pretest === 1) &&
    isJsonValue(response) &&
    (correct === 0 || correct === 1 || correct === null) &&
    typeof rtMs === 'number' &&
    Number.isFinite(rtMs) &&
    rtMs >= 0 &&
    (conf === null || (typeof conf === 'number' && Number.isFinite(conf) && conf >= 0 && conf <= 100)) &&
    (t.length === 6 || isJsonValue(t[6]))
  )
}

/**
 * One 2PL item inside an {@link Observation} of kind 'testlet': the fields of a '2pl' observation
 * without `kind` and `axis` (the testlet carries the axis). Given the testlet's effect γ,
 * P(y = 1) = σ(a(θ + γ − b)) (§7.1, M3.9).
 */
export interface TestletItem {
  a: number
  b: number
  y: 0 | 1
}

/**
 * One scored observation on one axis, the scorer's input (simple structure, §7.2). Field names
 * are the golden-vector wire schema (see the module comment); meanings follow `irt.ts`.
 *
 * The items of one testlet (passage / game setup, `ItemBase.testlet_id`) answered in a session are
 * scored together as one 'testlet' observation (§7.1, M3.9): 1 to 8 2PL items that share a random
 * effect γ ~ N(0, `tau`²), with `tau` = TESTLET_SD (0.3, `irt.ts`), integrated out, so the block's
 * likelihood is p(y | θ) = ∫ Π_j p_j(y_j | θ + γ) N(γ; 0, tau²) dγ with p_j the 2PL of item j.
 * Build it with `testletObservation()` (`scorer.ts`).
 *
 * Not yet wired: nothing in the app builds a 'testlet' observation, and a lone '2pl_testlet' item
 * is not the same as a '2pl' one (its marginal is flatter, §7.1). Until the session / re-score
 * paths group a session's items by `testlet_id` (they need it on the served item, which
 * `ItemInstance` does not carry yet), `save/rescore.ts`, `sim/responders.ts` and `engine/integrity.ts`
 * score a '2pl_testlet' item as a '2pl' observation and so leave γ out. No live family has
 * testlet items yet (RC and LG are not built), so nothing is mis-scored today.
 */
export type Observation =
  | { kind: '2pl'; axis: AxisCode; a: number; b: number; y: 0 | 1 }
  | { kind: '3pl'; axis: AxisCode; a: number; b: number; c: number; y: 0 | 1 }
  | { kind: 'grm'; axis: AxisCode; a: number; b: readonly number[]; y: number }
  | { kind: 'gaussian'; axis: AxisCode; lam: number; d: number; sigma: number; x: number }
  | { kind: 'testlet'; axis: AxisCode; tau: number; items: readonly TestletItem[] }

export type ObservationKind = Observation['kind']
