/**
 * Shared engine types: item metadata (DESIGN §12 item record), the save-file response tuple
 * (§8) and the scorer's observation union (§7.1–7.2).
 *
 * Wire schema: observation and item-parameter field names match the bank's Python reference and
 * its golden vectors (`golden/scoring_v1.json`, ROADMAP A2) exactly, so golden cases load without
 * an adapter. In particular the Gaussian loading is `lam` (Python cannot name it `lambda`) and a
 * GRM item's increasing thresholds live in `b` as an array.
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
 * - 'gaussian': lam, d, sigma (x ~ N(lam·θ + d, sigma²)); lam may be negative.
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
  axis: AxisCode
  /** Sub-facet reported only in drill-down (§3), e.g. "3d_rotation". */
  facet?: string
  /** Renderer / response format, e.g. "mc", "mc_image_spec", "numeric_entry", "span". */
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
 * confidence was asked (§3 row 12: 50–100 on tier-a answers); `extra` carries e.g. RT trial arrays.
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

/** Runtime check that a value is plain JSON (finite numbers, plain objects, bounded depth). */
export function isJsonValue(v: unknown, depth = 0): v is JsonValue {
  if (depth > 64) return false
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true
  if (typeof v === 'number') return Number.isFinite(v)
  if (Array.isArray(v)) return v.every((x) => isJsonValue(x, depth + 1))
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
 * One scored observation on one axis, the scorer's input (simple structure, §7.2). Field names
 * are the golden-vector wire schema (see the module comment); meanings follow `irt.ts`.
 * A '2pl_testlet' item is scored as a '2pl' observation; its testlet effect is the scorer's job.
 */
export type Observation =
  | { kind: '2pl'; axis: AxisCode; a: number; b: number; y: 0 | 1 }
  | { kind: '3pl'; axis: AxisCode; a: number; b: number; c: number; y: 0 | 1 }
  | { kind: 'grm'; axis: AxisCode; a: number; b: readonly number[]; y: number }
  | { kind: 'gaussian'; axis: AxisCode; lam: number; d: number; sigma: number; x: number }

export type ObservationKind = Observation['kind']
