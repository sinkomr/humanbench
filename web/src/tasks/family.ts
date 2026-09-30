/**
 * The procedural family contract, v2 (ROADMAP A1, A9, A10, A11, A17, M1.F, M1.F2, M1.P; DESIGN
 * §4.1–4.2, §6.ii, §7.1, §7.4, §12, §13).
 *
 * A *family* is a seeded generator of item instances plus its verifier and scorer. Every
 * procedural task in the static MVP is one, of one of two {@link FamilyKind kinds}:
 *
 * - `kind: 'item'`: keyed power items (rotation, matrices, series, quant) that the adaptive
 *   selector serves one at a time (§7.4, M1.14). They use the A9 models (2PL/3PL) and
 *   `score()` returns an {@link ItemScore} (`correct` 0/1).
 * - `kind: 'block'`: fixed blocks (span, RT, coding, reading) that the session runs whole, in
 *   the A15 order, never through the selector (M1.14). One {@link ItemInstance} is one whole
 *   block, it uses the A10 models (GRM for span, Gaussian for RT/PS), and `score()` returns a
 *   {@link BlockScore}: the engine observation, or none plus the reasons, and integrity flags.
 *
 * **Sub-tasks** (M1.F2): a block with sub-tasks (digit span forward / backward / Corsi, simple /
 * 4-choice RT) is ONE BLOCK FAMILY PER SUB-TASK (`span_fwd`, `span_bwd`, `corsi`, `rt_simple`,
 * `rt_choice4`). Each has its own name, facet, norms and params, one instance is one
 * administration, and the session asks each block family for one instance. No family encodes a
 * sub-task in its seed, so `generate(seed)` of a family always means the same task.
 *
 * ## Writing a family (implementers)
 *
 * Put everything in your own directory, `web/src/tasks/<family>/`, with an `index.ts` that
 * exports the family object; do not edit any shared file (an integrator adds it to
 * `registry.ts` later). Use {@link defineFamily}, which derives the ids, the stratum-targeted
 * seed, the A9 item parameters and the power-item time cap, so `build()` only returns content:
 *
 * ```ts
 * export const series = defineFamily<SeriesSpec, SeriesKey, SeriesResponse>({
 *   name: 'ser', kind: 'item', axis: 'MAT', facets: ['series'], generatorVersion: '1.0.0',
 *   itemType: NUMERIC_ITEM_TYPE, strata: [1, 2, 3, 4, 5, 6],
 *   build(rng, ctx) {
 *     const stratum = ctx.stratum ?? pickStratum(rng)   // honour a requested stratum
 *     ...                                               // draw only from rng
 *     return { stratum, spec, key, structural_params, difficulty, expected_time_s }
 *   },
 *   verify(item) { return verdict({ unique_min_dl_rule: ..., key_matches_rule: ... }) },
 *   score(item, response) { return { correct: response === item.key.value ? 1 : 0 } },
 * })
 * ```
 *
 * Then, in `<family>/<family>.test.ts`, run the shared property suite at n = 10,000
 * (`runFamilyProperties` in `../testing`, DESIGN §14.3 M1 acceptance 1) with your own
 * `specLeaksKey` check (e.g. `onlySpecFields(...)`; a documented `specLeaksKeyWaiver` otherwise)
 * and your synthetic responses (items: correct / incorrect; blocks: valid / invalid), and dump
 * ≥ 1,000 instances for the bank's Python cross-check (A1):
 *
 * ```
 * npm run dump:families -- --module src/tasks/<family>/index.ts --n 1000 --bank
 * ```
 *
 * ## Rules every instance must satisfy (checked by `validateItemInstance` and the suite)
 *
 * - **Determinism.** `generate(seed, opts)` is a pure function of its arguments: draw every
 *   random number from the provided seeded stream (engine `createRng`), never `Math.random`,
 *   the clock or module state. `generate(item.seed)` must rebuild the same item, which is what
 *   makes `item_id` sufficient to regenerate it (A11).
 * - **The key stays out of `spec`.** `spec` is the render payload handed to the renderer and
 *   the DOM (M1.13). It must not contain the key or anything that trivially reveals it: no
 *   field name containing the word key/ans/answer/correct/solution in any case style
 *   (`correctIndex`, `is_correct`, `answerValue`, `keyTable`; call a legend `legend`), no
 *   option order that encodes the answer, no precomputed result (a spec value that always
 *   equals a key value, also numerically, e.g. `42` beside the key `"42"`, is flagged across
 *   the run). `key`, `structural_params`, `params` and `difficulty` never reach the renderer.
 *   Keys are JSON objects, e.g. `{ index: 2 }` (MC) or the shared numeric-entry
 *   {@link NumericKey} `{ value: "42", tol: { abs: 0 } }`.
 * - **Option display order** (M1.13). An MC item (`options_count` = k) lists its options in
 *   `spec.options`, an array of exactly k entries, and that array order IS the display order:
 *   the renderer shows `spec.options[i]` as option i and never reorders, sorts or keys it; the
 *   generator shuffles, so `key.index` (an integer in 0 … k − 1, the position in
 *   `spec.options`) is uniform over positions (checked over every property run).
 * - **family_id** is `familyIdOf(structural_params)` (A11): the hash of the parameters that
 *   make two items isomorphs (canonical polycube, matrix rule set, series rule family +
 *   coefficient class, quant template variant). Canonicalise sets before hashing. The bank
 *   computes the same hash (see `ids.ts`), so its Python twin must build the same
 *   `structural_params` for the same structure: one structure, one family_id in both repos.
 * - **sibling_group** (A11 amended, M1.14) names the set of near-isomorph families a session
 *   shows at most once: the selector excludes a candidate whose `sibling_group` was already
 *   served in the session (and, across sessions, every seen `family_id`, §7.7). It is the
 *   item's `family_id` (a family is its own group) unless the family groups sibling families
 *   explicitly as `g:<family>:<label>` ({@link siblingGroupId}); quant groups its
 *   near-isomorph variants (`QUANT_SIBLING_SETS`: the same givens, only the question
 *   differs). Items of one family_id always share one sibling_group.
 * - **Family flags** (A23, AI.2; additive to contract v2). A QR instance may carry `ladder_probe`
 *   (a held-out F12 ladder probe, AI.17) or `practice_only` (a quiz item that never enters a
 *   scored session, AI.16), each `true` or absent, never both, and the same for every instance of
 *   a family_id. No family sets either yet. The other item tags (topic, curriculum level,
 *   notation, ...) are bank-side: topics come from `topics-v1.json` (`topics.ts`) and a quant
 *   item's topic group from its facet (`quant/topics.ts`), so they are not on the wire.
 * - **Facets** (§3 drill-down). A family declares its `facets`; each item's `facet` is one of
 *   them (quant: the template, e.g. "percent"; most families have exactly one).
 * - **Versions.** `generatorVersion` has no `+` build tag; bump it whenever `generate` output
 *   changes for any seed (old ids then no longer regenerate), and bump the bank twin to
 *   `<new>+py`. A twin's items carry `+py` because its content per seed differs (A11).
 * - **params (A9, A10).** Items: options k ≤ 4 → 3PL with c = 1/k; k ≥ 5 or numeric entry →
 *   2PL; with b = `difficulty.b_prior` and a = the family's default discrimination. Blocks use
 *   the A10 models (GRM for span, Gaussian for RT/PS), returned by `build()`, and omit
 *   `options_count`. The model family must match the kind (items dichotomous, blocks not).
 * - **One meaning of a Gaussian block's `params.sigma`**: it is τ_res, the residual SD of the
 *   block statistic x around lam·θ + d *beyond* the block's own sampling error. A scored
 *   block's observation carries sigma = √(SE² + τ_res²) ({@link gaussianObservationSigma}),
 *   where SE is that block's own standard error of x (RT: 1.2533·1.4826·MAD/√n; coding:
 *   1/√correct; reading: the §7.1 per-passage SD 0.15). So `params.sigma` is never the sigma
 *   of an observation by itself; take the observation from `score()`.
 * - **difficulty.** `b_prior` is finite with |b_prior| ≤ 4, `sd_prior` > 0 (σ_b = 1.0 by
 *   default), `features` are the named inputs of the v0 regression, and `provenance` says how
 *   b was obtained (see `priors.ts`, M1.P).
 * - **Time.** `expected_time_s` > 0 is E[T] for information per second (§7.4); blocks use the
 *   block duration. Every item (kind 'item') carries the one shared power-item cap of §13,
 *   `time_limit_s = powerTimeLimit(expected_time_s)` (`priors.ts`; `defineFamily` sets it);
 *   a block's `time_limit_s`, if present, is its own timed window (coding's 90 s).
 * - **JSON.** An instance is plain JSON with snake_case keys and survives a JSON round trip.
 *   Optional fields are omitted, never `undefined`.
 * - **Strata.** `stratum` ∈ `family.strata`, and `stratum = stratumOfB(difficulty.b_prior)`,
 *   the default band of the item's b (M1.P: one meaning of a stratum across families).
 *   `generate(seed, { stratum: k })` returns an item in stratum k (seed `<seed>@s<k>`, see
 *   `resolveSeed`) or throws a RangeError if the family cannot target k.
 * - **Pool anchoring (M1.P).** An ICAR-anchored family's pool (`generate(seed)` without a
 *   stratum) has mean b = its ICAR anchor (`priors.ts` ICAR_ANCHORED_FAMILIES). The pool's
 *   stratum mix is whatever that distribution gives, not uniform (at n = 2,000: rotation ≈ 1%
 *   in its 20–22° stratum 2, matrices ≈ 70% in stratum 3), so a selector that needs a stratum
 *   requests it with `generate(seed, { stratum })` (M1.14).
 *
 * ## Scoring rules (checked by the suite)
 *
 * - `score(item, response)` takes a response of the family's response type. A response that
 *   is not one (wrong JSON type, out of range, the wrong length, a response after a block
 *   finished; in span, an entered element outside the task's symbols) throws a
 *   {@link MalformedResponseError}, a RangeError, in every family (the bank
 *   twins raise `hb.gen.base.MalformedResponseError`, a ValueError). A well-formed but wrong
 *   answer is not malformed: it scores 0 (an unparseable typed entry is a wrong answer). A
 *   skipped or timed-out item is the session's record (§13), not a `score()` call.
 * - Items return `{ correct: 0 | 1 }`. Blocks return a {@link BlockScore}: the observation
 *   when the block yields one, otherwise no observation and ≥ 1 reason.
 */

import {
  axis as axisDef,
  createRng,
  isAxisCode,
  isJsonValue,
  modelFamilyOf,
  type AxisCode,
  type ItemBase,
  type ItemParams,
  type JsonValue,
  type Observation,
  type Rng,
} from '../engine'
import { FAMILY_ID_RE, FAMILY_NAME_RE, GENERATOR_VERSION_RE, familyId, isStratum, itemId, resolveSeed, type Stratum } from './ids'
import { B_PRIOR_LIMIT, powerTimeLimit, stratumOfB } from './priors'

/** A JSON object (the shape of `spec` and `key` once parsed from JSON). */
export type JsonObject = { [key: string]: JsonValue }

/** A named input of the difficulty regression. */
export type Feature = number | string | boolean

/**
 * The two kinds of family (M1.F2): `item` = keyed power items served adaptively (§7.4, M1.14);
 * `block` = a fixed block run whole in the A15 order (span, RT, coding, reading; A10).
 */
export type FamilyKind = 'item' | 'block'

export const FAMILY_KINDS: readonly FamilyKind[] = Object.freeze(['item', 'block'] as const)

/** The kind a scoring model belongs to: dichotomous models are items, GRM and Gaussian blocks (A9, A10). */
export function kindOfModel(model: ItemParams['model']): FamilyKind {
  return modelFamilyOf(model) === 'dichotomous' ? 'item' : 'block'
}

/**
 * `item_type` of every typed-entry item (series, quant): "numeric", as in DESIGN §14.6 ex. 2. The
 * renderer picks the entry box from `spec.input_format` ({@link EntryFormat}).
 */
export const NUMERIC_ITEM_TYPE = 'numeric'

/**
 * `spec.input_format` of a {@link NUMERIC_ITEM_TYPE} item, one vocabulary for every entry family:
 * an integer, a decimal, a fraction `a/b` (or an integer), or one letter A–Z (letter series).
 */
export type EntryFormat = 'integer' | 'decimal' | 'fraction' | 'letter'

/**
 * Per-item tolerance of a {@link NumericKey} (§4.2, §12 `item_keys.tolerance`): an absolute or a
 * relative bound, a finite JSON number ≥ 0 read exactly as its decimal text.
 */
export type Tolerance = { readonly abs: number } | { readonly rel: number }

/**
 * The numeric-entry key shared by the entry families (series, quant; §12; M1.F2): the exact
 * answer as a canonical rational string ("42", "-7", "3/8": lowest terms, positive denominator,
 * no "+"), so fractions stay exact, and its {@link Tolerance}. A letter answer uses `{ letter }`
 * instead (series). This replaces the `{"value": 42, "tol": 0}` of DESIGN §14.6 ex. 2–3, which
 * predate M1.F2 (the DESIGN examples are not yet updated; there the same key reads
 * `{"value": "42", "tol": {"abs": 0}}`).
 */
export interface NumericKey {
  readonly value: string
  readonly tol: Tolerance
}

/** A canonical rational string of a {@link NumericKey}: "42", "-7", "3/8" (lowest terms not checked here). */
export const CANONICAL_RATIONAL_RE = /^-?(?:0|[1-9][0-9]*)(?:\/[1-9][0-9]*)?$/

/** The item's difficulty prior b ~ N(b_prior, sd_prior²) and where it came from (§6.ii, §12). */
export interface DifficultyPrior {
  readonly features: Readonly<Record<string, Feature>>
  readonly b_prior: number
  readonly sd_prior: number
  readonly provenance: string
}

/**
 * A sibling group of families (A11 amended, M1.14): `g:<family>:<label>`, label lowercase
 * `[a-z0-9_]`, 1–48 characters. Families not grouped use their own family_id instead.
 */
export const SIBLING_GROUP_RE = /^g:([a-z][a-z0-9_]{0,23}):([a-z0-9_]{1,48})$/

/** `g:<family>:<label>`, the id of an explicit sibling group; throws a RangeError on a bad name or label. */
export function siblingGroupId(familyName: string, label: string): string {
  const id = `g:${familyName}:${label}`
  const m = SIBLING_GROUP_RE.exec(id)
  if (!m || m[1] !== familyName) throw new RangeError(`sibling group ${JSON.stringify(id)} must match ${SIBLING_GROUP_RE}`)
  return id
}

/**
 * One generated item (or one whole block), serialised as snake_case JSON. Field names are the
 * wire schema shared with the bank's pydantic `hb.gen.base.ItemInstance`, which loads TS dumps
 * strictly (unknown fields are rejected), so a change here needs the same change there.
 */
export interface ItemInstance<Spec extends object = JsonObject, Key extends object = JsonObject> {
  /** `i:<fam>:<genver>:<seed>` (A11). */
  readonly item_id: string
  /** `f:<fam>:<12 hex>` = `familyIdOf(structural_params)` (A11). */
  readonly family_id: string
  /** The family_id, or `g:<fam>:<label>` for grouped near-isomorph families (M1.14; see the module comment). */
  readonly sibling_group: string
  /** The family name `<fam>` (e.g. "rot"). */
  readonly family: string
  readonly generator_version: string
  /** The resolved seed: `generate(seed)` reproduces this item exactly. */
  readonly seed: string
  readonly axis: AxisCode
  /** Drill-down sub-facet (§3), one of the family's `facets`, e.g. "3d_rotation", "percent". */
  readonly facet: string
  /** Renderer / response format, e.g. "mc_image_spec", "numeric" ({@link NUMERIC_ITEM_TYPE}), "span". */
  readonly item_type: string
  /** Difficulty stratum 1–6 (§6.ii). */
  readonly stratum: Stratum
  /**
   * Render payload. Must not contain or trivially reveal the key. MC items list their options
   * in `spec.options`, in display order (never keyed; see the module comment).
   */
  readonly spec: Spec
  /** The answer key, a JSON object such as `{ index: 2 }` or a {@link NumericKey}. */
  readonly key: Key
  /** The structure hashed into `family_id` (A11); isomorphs share it. */
  readonly structural_params: JsonValue
  /** Number of response options for MC items (A9 picks 3PL for k ≤ 4); omitted otherwise. */
  readonly options_count?: number
  /** Scoring-model parameters (engine `ItemParams`, A9/A10). */
  readonly params: ItemParams
  readonly difficulty: DifficultyPrior
  /** E[T] in seconds (§7.4). */
  readonly expected_time_s: number
  /** Items: the shared cap `powerTimeLimit(expected_time_s)` (§13); blocks: their timed window, if any. */
  readonly time_limit_s?: number
  /**
   * Family metadata (A23, AI.2): `true` marks a held-out ladder probe for the F12 zone check
   * (AI.17). Present only when true (never `false`), only on axis QR, never with `practice_only`;
   * every instance of a family_id agrees. Nothing sets it yet.
   */
  readonly ladder_probe?: true
  /**
   * Family metadata (A23, AI.2): `true` marks a quiz or taste-test item that must never enter a
   * scored session (AI.16). Same rules as `ladder_probe`. Whatever serves scored items has to
   * skip it; AI.16 adds the first family that sets it, with the disjointness test.
   */
  readonly practice_only?: true
}

/** Result of a family verifier (gates G2/G3, §4.1): `checks` is recorded like §12 `verification.checks`. */
export interface VerifyResult {
  readonly ok: boolean
  /** "ok", or why the instance failed. */
  readonly reason: string
  readonly checks: Readonly<Record<string, JsonValue>>
}

/**
 * Result of scoring an item's response (kind 'item'): `correct` is 0/1 for keyed items (§8
 * response tuple); `value` is reserved for a continuous item score. Named `ItemScore`, not
 * `ScoreResult`: that is the engine's person-level MAP/EAP result (`engine/scorer.ts`), and code
 * that imports both barrels needs the two apart. The bank twin is `hb.gen.base.ScoreResult`.
 */
export interface ItemScore {
  readonly correct: 0 | 1 | null
  readonly value?: number
}

/** The engine observation a block yields: GRM (span) or Gaussian (RT, coding, reading) (A10). */
export type BlockObservation = Extract<Observation, { kind: 'grm' } | { kind: 'gaussian' }>

/** A flag or reason token of a {@link BlockScore}: lowercase snake_case, e.g. "too_few_valid_trials". */
export const SCORE_TOKEN_RE = /^[a-z][a-z0-9_]*$/

/**
 * Result of scoring a block (kind 'block', M1.F2): what the scorer consumes, the observation
 * (A10: GRM for span, Gaussian for RT/PS, see the module comment for its sigma), or, when the
 * block yields none (an unfinished span block, too few valid RT trials, a failed reading gate,
 * no correct coding response), no observation and the reasons why. `flags` are integrity flags
 * for the §13 client flags (M1.19), e.g. "high_error_rate", "skimming"; they may accompany an
 * observation. `correct` is null (a block, §8). The bank twin is `hb.gen.base.BlockScore`.
 */
export interface BlockScore {
  readonly correct: null
  /** Omitted exactly when `reasons` is non-empty. */
  readonly observation?: BlockObservation
  readonly flags: readonly string[]
  readonly reasons: readonly string[]
}

/**
 * Build a {@link BlockScore}: with an observation (and no reasons) or without one (≥ 1 reason).
 * Throws a RangeError on any other combination or a token that is not {@link SCORE_TOKEN_RE}.
 */
export function blockScore(observation: BlockObservation | null | undefined, flags: readonly string[] = [], reasons: readonly string[] = []): BlockScore {
  for (const t of [...flags, ...reasons]) {
    if (!SCORE_TOKEN_RE.test(t)) throw new RangeError(`block score token ${JSON.stringify(t)} must match ${SCORE_TOKEN_RE}`)
  }
  const has = observation !== null && observation !== undefined
  if (has === reasons.length > 0) throw new RangeError('a block score has an observation or ≥ 1 reason, not both and not neither')
  return has ? { correct: null, observation, flags: [...flags], reasons: [] } : { correct: null, flags: [...flags], reasons: [...reasons] }
}

/**
 * sigma of a Gaussian block observation, √(SE² + τ_res²) with τ_res = the item's `params.sigma`
 * (the one meaning of `params.sigma`, see the module comment). Throws a RangeError on a negative
 * or non-finite SE or non-Gaussian params.
 */
export function gaussianObservationSigma(se: number, params: ItemParams): number {
  if (params.model !== 'gaussian') throw new RangeError(`gaussianObservationSigma(): params.model is ${params.model}, not gaussian`)
  if (!(Number.isFinite(se) && se >= 0)) throw new RangeError(`gaussianObservationSigma(): SE must be finite and ≥ 0, got ${se}`)
  return Math.sqrt(se * se + params.sigma * params.sigma)
}

/**
 * Thrown by every family's `score()` on a response that is not of its response type (M1.F2):
 * one error class across families, a RangeError, so callers catch it uniformly. The bank twin
 * is `hb.gen.base.MalformedResponseError`, a ValueError.
 */
export class MalformedResponseError extends RangeError {
  constructor(message: string) {
    super(message)
    this.name = 'MalformedResponseError'
  }
}

/**
 * The response of an MC item: the chosen option index, an integer 0 … options_count − 1 (the
 * position in `spec.options`, M1.13). Throws a {@link MalformedResponseError} on anything else.
 */
export function mcResponseIndex(item: ItemInstance<object, object>, response: unknown): number {
  const k = item.options_count
  if (!(typeof response === 'number' && Number.isInteger(response) && typeof k === 'number' && response >= 0 && response < k)) {
    throw new MalformedResponseError(`${item.family}: an MC response is an option index 0..${String((k ?? 0) - 1)}, got ${String(response)}`)
  }
  return response
}

/**
 * The response of a typed-entry item ({@link NUMERIC_ITEM_TYPE}): the text typed, a string (and,
 * when `allowNumber`, a finite number, e.g. from a numeric keypad). Throws a
 * {@link MalformedResponseError} on anything else; an unparseable string is a wrong answer, not
 * a malformed response.
 */
export function entryResponse(item: ItemInstance<object, object>, response: unknown, allowNumber: boolean): string | number {
  if (typeof response === 'string') return response
  if (allowNumber && typeof response === 'number' && Number.isFinite(response)) return response
  throw new MalformedResponseError(`${item.family}: an entry response is the typed ${allowNumber ? 'text or a finite number' : 'text'}, got ${String(response)}`)
}

export interface GenerateOptions {
  /** Target difficulty stratum; the family throws a RangeError if it cannot produce it. */
  readonly stratum?: number
}

/** What every family has, whatever its kind. */
interface FamilyCore<Spec extends object, Key extends object> {
  /** Short family code used in ids (`FAMILY_NAME_RE`), e.g. "rot". */
  readonly name: string
  readonly kind: FamilyKind
  readonly axis: AxisCode
  /** The drill-down facets of this family's items (§3); each item's `facet` is one of them. */
  readonly facets: readonly string[]
  /**
   * Bump when the output for any seed changes; old ids then no longer regenerate. No `+` build
   * tag: `<ver>+py` names the bank's Python twin (A11, `PY_TWIN_BUILD` in `ids.ts`).
   */
  readonly generatorVersion: string
  readonly itemType: string
  /** Strata this family can generate (and target via `generate(seed, { stratum })`). */
  readonly strata: readonly Stratum[]
  /** Deterministic in (seed, opts). See the module comment for the full contract. */
  generate(seed: string, opts?: GenerateOptions): ItemInstance<Spec, Key>
  /** Programmatic key check + uniqueness/ambiguity (G2, G3). Must not throw on a well-formed item. */
  verify(item: ItemInstance<Spec, Key>): VerifyResult
  /** `familyId(name, structuralParams)` for this family. */
  familyIdOf(structuralParams: JsonValue): string
}

/** A family of keyed power items (kind 'item'): served by the adaptive selector (M1.14). */
export interface ItemFamily<Spec extends object = JsonObject, Key extends object = JsonObject, Resp = unknown> extends FamilyCore<Spec, Key> {
  readonly kind: 'item'
  /** Throws a {@link MalformedResponseError} on a response that is not of the family's type. */
  score(item: ItemInstance<Spec, Key>, response: Resp): ItemScore
}

/** A fixed-block family (kind 'block'): run whole by the session (A10, A15), never selected adaptively. */
export interface BlockFamily<Spec extends object = JsonObject, Key extends object = JsonObject, Resp = unknown> extends FamilyCore<Spec, Key> {
  readonly kind: 'block'
  /** Throws a {@link MalformedResponseError} on a response that is not of the family's type. */
  score(item: ItemInstance<Spec, Key>, response: Resp): BlockScore
}

/** A procedural family (A1, A11): an item family or a block family, told apart by `kind`. */
export type ProceduralFamily<Spec extends object = JsonObject, Key extends object = JsonObject, Resp = unknown> =
  | ItemFamily<Spec, Key, Resp>
  | BlockFamily<Spec, Key, Resp>

/** Any family, e.g. in the registry (method parameters are bivariant, so every family fits). */
export type AnyFamily = ItemFamily<object, object, unknown> | BlockFamily<object, object, unknown>

/** Default 2PL/3PL discrimination for a new family before calibration (§6.iii: a lognormal around the family mean). */
export const DEFAULT_A = 1.0

/**
 * The A9 item model for a keyed item: k ≤ 4 options → 3PL with c = 1/k; k ≥ 5 options or
 * numeric entry (`optionsCount` undefined) → 2PL. Throws a RangeError on invalid inputs.
 */
export function itemParamsFor(optionsCount: number | undefined, a: number, b: number): ItemParams {
  if (!(Number.isFinite(a) && a > 0)) throw new RangeError(`itemParamsFor(): a must be finite and > 0, got ${a}`)
  if (!Number.isFinite(b)) throw new RangeError(`itemParamsFor(): b must be finite, got ${b}`)
  if (optionsCount === undefined || optionsCount >= 5) {
    if (optionsCount !== undefined && !Number.isInteger(optionsCount)) {
      throw new RangeError(`itemParamsFor(): options count must be an integer, got ${optionsCount}`)
    }
    return { model: '2pl', a, b }
  }
  if (!(Number.isInteger(optionsCount) && optionsCount >= 2)) {
    throw new RangeError(`itemParamsFor(): options count must be an integer ≥ 2, got ${optionsCount}`)
  }
  return { model: '3pl', a, b, c: 1 / optionsCount }
}

/**
 * Build a {@link VerifyResult} from named checks: ok iff every boolean check is true (at least
 * one is required). Non-boolean entries are informational (counts, rule names).
 */
export function verdict(checks: Readonly<Record<string, JsonValue>>): VerifyResult {
  const bools = Object.entries(checks).filter(([, v]) => typeof v === 'boolean')
  if (bools.length === 0) return { ok: false, reason: 'no boolean checks were recorded', checks }
  const failed = bools.filter(([, v]) => v !== true).map(([k]) => k)
  return failed.length === 0 ? { ok: true, reason: 'ok', checks } : { ok: false, reason: `failed: ${failed.join(', ')}`, checks }
}

/** What {@link FamilyDefinition.build} returns: the content; ids, seed and the item time cap are filled in. */
export interface BuiltItem<Spec extends object, Key extends object> {
  readonly stratum: Stratum
  /** One of the family's `facets`; may be omitted when the family has exactly one. */
  readonly facet?: string
  /** A `g:<family>:<label>` group ({@link siblingGroupId}); omitted = the item's family_id. */
  readonly sibling_group?: string
  readonly spec: Spec
  readonly key: Key
  readonly structural_params: JsonValue
  readonly options_count?: number
  readonly difficulty: DifficultyPrior
  readonly expected_time_s: number
  /** Blocks only: the block's timed window. Items get the shared §13 cap from `defineFamily`. */
  readonly time_limit_s?: number
  /** Blocks only (required there): the A10 model, GRM (span) or Gaussian (RT, PS). Items get A9 params. */
  readonly params?: ItemParams
  /** A23 family metadata, QR only ({@link ItemInstance.ladder_probe}); omit unless true. */
  readonly ladder_probe?: true
  /** A23 family metadata, QR only ({@link ItemInstance.practice_only}); omit unless true. */
  readonly practice_only?: true
}

export interface BuildContext {
  /** The resolved seed recorded in the item (already includes any `@s<k>` suffix). */
  readonly seed: string
  /** The requested stratum, or undefined when the family chooses. */
  readonly stratum?: Stratum
}

/** What every family definition has, whatever its kind. */
interface DefinitionCore<Spec extends object, Key extends object> {
  readonly name: string
  readonly axis: AxisCode
  readonly facets: readonly string[]
  readonly generatorVersion: string
  readonly itemType: string
  readonly strata: readonly Stratum[]
  /** Family default discrimination a for the A9 params of items (default {@link DEFAULT_A}). */
  readonly defaultA?: number
  /**
   * Build the content from `rng` (seeded from `ctx.seed`; draw nothing from anywhere else).
   * When `ctx.stratum` is set the result must be in that stratum.
   */
  build(rng: Rng, ctx: BuildContext): BuiltItem<Spec, Key>
  verify(item: ItemInstance<Spec, Key>): VerifyResult
}

/** Everything an item family implements when using {@link defineFamily}. */
export interface ItemFamilyDefinition<Spec extends object, Key extends object, Resp> extends DefinitionCore<Spec, Key> {
  readonly kind: 'item'
  score(item: ItemInstance<Spec, Key>, response: Resp): ItemScore
}

/** Everything a block family implements when using {@link defineFamily}. */
export interface BlockFamilyDefinition<Spec extends object, Key extends object, Resp> extends DefinitionCore<Spec, Key> {
  readonly kind: 'block'
  score(item: ItemInstance<Spec, Key>, response: Resp): BlockScore
}

export type FamilyDefinition<Spec extends object, Key extends object, Resp> =
  | ItemFamilyDefinition<Spec, Key, Resp>
  | BlockFamilyDefinition<Spec, Key, Resp>

/**
 * Make a family from a definition: resolves the stratum-targeted seed, seeds the stream with
 * `createRng(seed)`, and fills in `item_id`, `family_id`, `sibling_group`, the identity fields,
 * the A9 params (items: b = b_prior, a = defaultA) and the §13 power-item cap (items:
 * `time_limit_s = powerTimeLimit(expected_time_s)`). Throws if `build()` breaks a kind rule
 * (an item returning params or a time limit, a block without params) or returns a facet the
 * family does not declare.
 */
export function defineFamily<Spec extends object, Key extends object, Resp>(def: ItemFamilyDefinition<Spec, Key, Resp>): ItemFamily<Spec, Key, Resp>
export function defineFamily<Spec extends object, Key extends object, Resp>(def: BlockFamilyDefinition<Spec, Key, Resp>): BlockFamily<Spec, Key, Resp>
export function defineFamily<Spec extends object, Key extends object, Resp>(def: FamilyDefinition<Spec, Key, Resp>): ProceduralFamily<Spec, Key, Resp> {
  if (!FAMILY_NAME_RE.test(def.name)) throw new RangeError(`family name must match ${FAMILY_NAME_RE}, got ${JSON.stringify(def.name)}`)
  if (!(FAMILY_KINDS as readonly string[]).includes(def.kind)) throw new RangeError(`family kind must be item or block, got ${JSON.stringify(def.kind)}`)
  if (!GENERATOR_VERSION_RE.test(def.generatorVersion)) {
    throw new RangeError(`generator version must match ${GENERATOR_VERSION_RE}, got ${JSON.stringify(def.generatorVersion)}`)
  }
  if (!isAxisCode(def.axis)) throw new RangeError(`unknown axis ${JSON.stringify(def.axis)}`)
  if (def.strata.length === 0 || !def.strata.every(isStratum)) throw new RangeError('strata must be a non-empty list of 1–6')
  if (def.facets.length === 0 || !def.facets.every((f) => typeof f === 'string' && f.length > 0) || new Set(def.facets).size !== def.facets.length) {
    throw new RangeError('facets must be a non-empty list of distinct non-empty strings')
  }
  const a = def.defaultA ?? DEFAULT_A
  const familyIdOf = (structuralParams: JsonValue): string => familyId(def.name, structuralParams)
  const facets = Object.freeze([...def.facets])
  const generate = (rawSeed: string, opts?: GenerateOptions): ItemInstance<Spec, Key> => {
    const { seed, stratum } = resolveSeed(rawSeed, opts?.stratum)
    if (stratum !== undefined && !def.strata.includes(stratum)) {
      throw new RangeError(`family ${def.name} cannot generate stratum ${stratum} (supports ${def.strata.join(', ')})`)
    }
    const built = def.build(createRng(seed), stratum === undefined ? { seed } : { seed, stratum })
    if (stratum !== undefined && built.stratum !== stratum) {
      throw new Error(`family ${def.name}: build() returned stratum ${built.stratum} for requested stratum ${stratum}`)
    }
    const facet = built.facet ?? (facets.length === 1 ? facets[0] : undefined)
    if (facet === undefined || !facets.includes(facet)) {
      throw new Error(`family ${def.name}: build() returned facet ${JSON.stringify(built.facet)}, not one of ${facets.join(', ')}`)
    }
    let params: ItemParams
    let timeLimit: number | undefined
    if (def.kind === 'item') {
      if (built.params !== undefined) throw new Error(`family ${def.name}: an item family gets A9 params from defineFamily, not build()`)
      if (built.time_limit_s !== undefined) throw new Error(`family ${def.name}: an item's time limit is the shared §13 cap, not build()'s`)
      params = itemParamsFor(built.options_count, a, built.difficulty.b_prior)
      // A bad E[T] gets no cap here, so validateItemInstance reports the E[T] itself.
      const e = built.expected_time_s
      timeLimit = Number.isFinite(e) && e > 0 ? powerTimeLimit(e) : undefined
    } else {
      if (built.params === undefined) throw new Error(`family ${def.name}: a block family's build() must return its A10 params`)
      params = built.params
      timeLimit = built.time_limit_s
    }
    const fid = familyIdOf(built.structural_params)
    return {
      item_id: itemId(def.name, def.generatorVersion, seed),
      family_id: fid,
      sibling_group: built.sibling_group ?? fid,
      family: def.name,
      generator_version: def.generatorVersion,
      seed,
      axis: def.axis,
      facet,
      item_type: def.itemType,
      stratum: built.stratum,
      spec: built.spec,
      key: built.key,
      structural_params: built.structural_params,
      ...(built.options_count === undefined ? {} : { options_count: built.options_count }),
      params,
      difficulty: built.difficulty,
      expected_time_s: built.expected_time_s,
      ...(timeLimit === undefined ? {} : { time_limit_s: timeLimit }),
      ...(built.ladder_probe === undefined ? {} : { ladder_probe: built.ladder_probe }),
      ...(built.practice_only === undefined ? {} : { practice_only: built.practice_only }),
    }
  }
  const core = {
    name: def.name,
    axis: def.axis,
    facets,
    generatorVersion: def.generatorVersion,
    itemType: def.itemType,
    strata: Object.freeze([...def.strata]),
    familyIdOf,
    generate,
    verify: (item: ItemInstance<Spec, Key>) => def.verify(item),
  }
  if (def.kind === 'item') {
    const itemDef = def
    return { ...core, kind: 'item', score: (item: ItemInstance<Spec, Key>, response: Resp): ItemScore => itemDef.score(item, response) }
  }
  const blockDef = def
  return { ...core, kind: 'block', score: (item: ItemInstance<Spec, Key>, response: Resp): BlockScore => blockDef.score(item, response) }
}

const REQUIRED_FIELDS = [
  'item_id',
  'family_id',
  'sibling_group',
  'family',
  'generator_version',
  'seed',
  'axis',
  'facet',
  'item_type',
  'stratum',
  'spec',
  'key',
  'structural_params',
  'params',
  'difficulty',
  'expected_time_s',
] as const
const OPTIONAL_FIELDS = ['options_count', 'time_limit_s', 'ladder_probe', 'practice_only'] as const
/** Axes whose instances may carry `ladder_probe` or `practice_only` (A23: procedural QR). */
export const FAMILY_FLAG_AXES: readonly AxisCode[] = Object.freeze(['QR'] as const)
const ALL_FIELDS: ReadonlySet<string> = new Set<string>([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS])
const DIFFICULTY_FIELDS: ReadonlySet<string> = new Set(['features', 'b_prior', 'sd_prior', 'provenance'])

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isFinitePositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0

function paramsProblems(p: unknown, optionsCount: unknown, bPrior: unknown): string[] {
  if (!isPlainObject(p)) return ['params must be an object']
  const out: string[] = []
  const keys = Object.keys(p).sort().join(',')
  const finite = (k: string) => typeof p[k] === 'number' && Number.isFinite(p[k])
  switch (p.model) {
    case '2pl':
    case '2pl_testlet':
    case '3pl': {
      const expected = p.model === '3pl' ? 'a,b,c,model' : 'a,b,model'
      if (keys !== expected) out.push(`params (${p.model}) must have exactly the fields ${expected}`)
      if (!isFinitePositive(p.a)) out.push('params.a must be finite and > 0')
      if (!finite('b')) out.push('params.b must be finite')
      else if (p.b !== bPrior) out.push(`params.b (${String(p.b)}) must equal difficulty.b_prior (${String(bPrior)})`)
      if (p.model === '3pl') {
        if (typeof optionsCount !== 'number') out.push('a 3pl item needs options_count (A9)')
        else if (optionsCount > 4) out.push(`options_count ${optionsCount} ≥ 5 must use 2pl, not 3pl (A9)`)
        else if (typeof p.c !== 'number' || Math.abs(p.c - 1 / optionsCount) > 1e-12) {
          out.push(`params.c must be 1/options_count = ${1 / optionsCount} (A9)`)
        }
      } else if (typeof optionsCount === 'number' && optionsCount <= 4) {
        out.push(`options_count ${optionsCount} ≤ 4 must use 3pl with c = 1/k (A9)`)
      }
      break
    }
    case 'grm': {
      if (keys !== 'a,b,model') out.push('params (grm) must have exactly the fields a,b,model')
      if (!isFinitePositive(p.a)) out.push('params.a must be finite and > 0')
      const b = p.b
      if (!Array.isArray(b) || b.length === 0 || !b.every((x) => typeof x === 'number' && Number.isFinite(x))) {
        out.push('params.b (grm) must be a non-empty array of finite thresholds')
      } else if (!b.every((x, i) => i === 0 || (x as number) > (b[i - 1] as number))) {
        out.push('params.b (grm) thresholds must be strictly increasing')
      }
      if (optionsCount !== undefined) out.push('grm items (blocks) must omit options_count')
      break
    }
    case 'gaussian': {
      if (keys !== 'd,lam,model,sigma') out.push('params (gaussian) must have exactly the fields d,lam,model,sigma')
      if (!finite('lam') || !finite('d')) out.push('params.lam and params.d must be finite')
      if (!isFinitePositive(p.sigma)) out.push('params.sigma (tau_res) must be finite and > 0')
      if (optionsCount !== undefined) out.push('gaussian items (blocks) must omit options_count')
      break
    }
    default:
      out.push(`unknown params.model ${JSON.stringify(p.model)}`)
  }
  return out
}

const PARAM_MODELS: ReadonlySet<string> = new Set(['2pl', '2pl_testlet', '3pl', 'grm', 'gaussian'])

/** The kind an instance's params imply (undefined when the model is unknown). */
function kindOfParams(p: unknown): FamilyKind | undefined {
  return isPlainObject(p) && typeof p.model === 'string' && PARAM_MODELS.has(p.model) ? kindOfModel(p.model as ItemParams['model']) : undefined
}

/** `ladder_probe` and `practice_only` are `true` or absent, only on QR, never both (A23; the bank's `ItemInstance` checks the same). */
function familyFlagProblems(x: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const name of ['ladder_probe', 'practice_only'] as const) {
    if (!(name in x)) continue
    if (x[name] !== true) out.push(`${name} must be true, or omitted`)
    if (!(FAMILY_FLAG_AXES as readonly unknown[]).includes(x.axis)) out.push(`${name} is for ${FAMILY_FLAG_AXES.join(', ')} items, not axis ${String(x.axis)}`)
  }
  if (x.ladder_probe === true && x.practice_only === true) out.push('an item is not both ladder_probe and practice_only')
  return out
}

/** MC option order and key shape (M1.13): `spec.options` has exactly k entries, `key.index` ∈ 0 … k − 1. */
function optionProblems(x: Record<string, unknown>): string[] {
  if (!('options_count' in x)) return []
  const k = x.options_count
  const spec = x.spec
  const key = x.key
  const out: string[] = []
  const options = isPlainObject(spec) ? spec.options : undefined
  if (!Array.isArray(options) || options.length !== k) out.push('an MC item lists exactly options_count options in spec.options (display order)')
  const index = isPlainObject(key) ? key.index : undefined
  if (!(typeof index === 'number' && Number.isInteger(index) && typeof k === 'number' && index >= 0 && index < k)) {
    out.push('an MC item keys an option position: key.index must be an integer 0 … options_count − 1')
  }
  return out
}

/**
 * Every way `x` fails to be a valid {@link ItemInstance} (empty = valid). With `family`, also
 * checks that the identity fields and `family_id` match that family. This is the TS twin of the
 * bank's strict pydantic model.
 */
export function validateItemInstance(x: unknown, family?: AnyFamily): string[] {
  if (!isPlainObject(x)) return ['an item instance must be a JSON object']
  if (!isJsonValue(x)) return ['an item instance must be plain JSON (finite numbers, no undefined, no class instances)']
  const out: string[] = []
  for (const f of REQUIRED_FIELDS) if (!(f in x)) out.push(`missing field ${f}`)
  for (const f of Object.keys(x)) if (!ALL_FIELDS.has(f)) out.push(`unknown field ${f}`)
  if (out.length > 0) return out

  const { family: fam, generator_version: ver, seed } = x
  if (!isNonEmptyString(fam) || !FAMILY_NAME_RE.test(fam)) out.push(`family must match ${FAMILY_NAME_RE}`)
  if (!isNonEmptyString(ver) || !GENERATOR_VERSION_RE.test(ver)) out.push(`generator_version must match ${GENERATOR_VERSION_RE}`)
  if (!isNonEmptyString(seed)) out.push('seed must be a non-empty string')
  if (out.length === 0 && x.item_id !== itemId(fam as string, ver as string, seed as string)) {
    out.push(`item_id must be i:<family>:<generator_version>:<seed>, got ${JSON.stringify(x.item_id)}`)
  }
  const fid = typeof x.family_id === 'string' ? FAMILY_ID_RE.exec(x.family_id) : null
  if (!fid) out.push(`family_id must match ${FAMILY_ID_RE}`)
  else if (fid[1] !== fam) out.push(`family_id prefix ${fid[1]} does not match family ${String(fam)}`)
  const group = typeof x.sibling_group === 'string' ? SIBLING_GROUP_RE.exec(x.sibling_group) : null
  if (x.sibling_group !== x.family_id && !(group && group[1] === fam)) {
    out.push(`sibling_group must be the family_id or g:<family>:<label> (${SIBLING_GROUP_RE})`)
  }
  if (!isAxisCode(x.axis)) out.push(`unknown axis ${JSON.stringify(x.axis)}`)
  if (!isNonEmptyString(x.facet)) out.push('facet must be a non-empty string')
  if (!isNonEmptyString(x.item_type)) out.push('item_type must be a non-empty string')
  if (!isStratum(x.stratum)) out.push('stratum must be an integer 1–6')
  if (!isPlainObject(x.spec)) out.push('spec must be a JSON object')
  if (!isPlainObject(x.key)) out.push('key must be a JSON object')
  if ('options_count' in x) {
    const k = x.options_count
    if (!(typeof k === 'number' && Number.isInteger(k) && k >= 2)) out.push('options_count must be an integer ≥ 2')
    else out.push(...optionProblems(x))
  }
  if (!isFinitePositive(x.expected_time_s)) out.push('expected_time_s must be finite and > 0')
  if ('time_limit_s' in x && !isFinitePositive(x.time_limit_s)) out.push('time_limit_s must be finite and > 0')
  out.push(...familyFlagProblems(x))
  const kind = kindOfParams(x.params)
  if (kind === 'item' && isFinitePositive(x.expected_time_s)) {
    const cap = powerTimeLimit(x.expected_time_s)
    if (x.time_limit_s !== cap) out.push(`an item's time_limit_s must be the shared §13 cap powerTimeLimit(expected_time_s) = ${cap}, got ${String(x.time_limit_s)}`)
  }

  const d = x.difficulty
  if (!isPlainObject(d)) {
    out.push('difficulty must be an object')
  } else {
    for (const f of Object.keys(d)) if (!DIFFICULTY_FIELDS.has(f)) out.push(`unknown field difficulty.${f}`)
    for (const f of DIFFICULTY_FIELDS) if (!(f in d)) out.push(`missing field difficulty.${f}`)
    const feats = d.features
    if (!isPlainObject(feats)) out.push('difficulty.features must be an object')
    else {
      for (const [k, v] of Object.entries(feats)) {
        if (!(typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)))) {
          out.push(`difficulty.features.${k} must be a number, string or boolean`)
        }
      }
    }
    const b = d.b_prior
    if (!(typeof b === 'number' && Number.isFinite(b) && Math.abs(b) <= B_PRIOR_LIMIT)) {
      out.push(`difficulty.b_prior must be finite with |b| ≤ ${B_PRIOR_LIMIT}`)
    } else if (isStratum(x.stratum) && stratumOfB(b) !== x.stratum) {
      out.push(`stratum ${x.stratum} is not the default band of b_prior ${b}: stratumOfB = ${stratumOfB(b)} (M1.P)`)
    }
    if (!isFinitePositive(d.sd_prior)) out.push('difficulty.sd_prior must be finite and > 0')
    if (!isNonEmptyString(d.provenance)) out.push('difficulty.provenance must be a non-empty string')
  }
  out.push(...paramsProblems(x.params, x.options_count, isPlainObject(d) ? d.b_prior : undefined))

  if (family) {
    if (fam !== family.name) out.push(`family ${String(fam)} is not ${family.name}`)
    if (ver !== family.generatorVersion) out.push(`generator_version ${String(ver)} is not ${family.generatorVersion}`)
    if (x.axis !== family.axis) out.push(`axis ${String(x.axis)} is not ${family.axis}`)
    if (typeof x.facet !== 'string' || !family.facets.includes(x.facet)) out.push(`facet ${String(x.facet)} is not one of ${family.facets.join(', ')}`)
    if (x.item_type !== family.itemType) out.push(`item_type ${String(x.item_type)} is not ${family.itemType}`)
    if (kind !== undefined && kind !== family.kind) out.push(`params.model ${String((x.params as Record<string, unknown>).model)} is not a ${family.kind} model (A9, A10)`)
    if (isStratum(x.stratum) && !family.strata.includes(x.stratum)) out.push(`stratum ${x.stratum} is not in the family's strata`)
    if (fid && x.family_id !== family.familyIdOf(x.structural_params as JsonValue)) {
      out.push('family_id does not equal familyIdOf(structural_params)')
    }
  }
  return out
}

/** Parse and validate an instance loaded from JSON; throws an Error listing every problem. */
export function parseItemInstance(x: unknown, family?: AnyFamily): ItemInstance {
  const problems = validateItemInstance(x, family)
  if (problems.length > 0) throw new Error(`invalid item instance: ${problems.join('; ')}`)
  return x as unknown as ItemInstance
}

/** The engine's view of an instance (§12 item metadata); gold tier comes from the axis registry. */
export function toItemBase(item: ItemInstance<object, object>): ItemBase {
  return {
    item_id: item.item_id,
    family_id: item.family_id,
    sibling_group: item.sibling_group,
    axis: item.axis,
    facet: item.facet,
    item_type: item.item_type,
    gold_tier: axisDef(item.axis).tier,
    expected_time_s: item.expected_time_s,
    params: item.params,
    ...(item.time_limit_s === undefined ? {} : { time_limit_s: item.time_limit_s }),
  }
}
