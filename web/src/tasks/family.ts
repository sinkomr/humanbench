/**
 * The procedural family contract (ROADMAP A1, A9, A11, A17, M1.P; DESIGN §4.1–4.2, §6.ii, §12).
 *
 * A *family* is a seeded generator of item instances plus its verifier and scorer. Every
 * procedural task in the static MVP is one: rotation, matrices, series, quant, and also the
 * fixed blocks (digit/Corsi span, RT, coding, reading), where one {@link ItemInstance} is one
 * whole block or trial list.
 *
 * ## Writing a family (implementers)
 *
 * Put everything in your own directory, `web/src/tasks/<family>/`, with an `index.ts` that
 * exports the family object; do not edit any shared file (an integrator adds it to
 * `registry.ts` later). Most families should use {@link defineFamily}, which derives the ids,
 * the stratum-targeted seed and the A9 item parameters, so `build()` only returns content:
 *
 * ```ts
 * export const series = defineFamily<SeriesSpec, SeriesKey, number>({
 *   name: 'ser', axis: 'MAT', facet: 'series', generatorVersion: '1.0.0',
 *   itemType: 'numeric_entry', strata: [1, 2, 3, 4, 5, 6],
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
 * `specLeaksKey` check (e.g. `onlySpecFields(...)`; a documented `specLeaksKeyWaiver` otherwise),
 * and dump ≥ 1,000 instances for the bank's Python cross-check (A1):
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
 *   equals a key value is flagged across the run). `key`, `structural_params`, `params` and
 *   `difficulty` never reach the renderer. Keys are JSON objects, e.g. `{ index: 2 }` (MC) or
 *   `{ value: 42, tol: 0 }` (numeric entry), as in the §12 item record.
 * - **family_id** is `familyIdOf(structural_params)` (A11): the hash of the parameters that
 *   make two items isomorphs (canonical polycube, matrix rule set, series rule family +
 *   coefficient class, quant template). Canonicalise sets before hashing (sort cells, rules).
 *   The bank computes the same hash (see `ids.ts`), so its Python twin must build the same
 *   `structural_params` for the same structure: one structure, one family_id in both repos.
 * - **Versions.** `generatorVersion` has no `+` build tag; bump it whenever `generate` output
 *   changes for any seed (old ids then no longer regenerate), and bump the bank twin to
 *   `<new>+py`. A twin's items carry `+py` because its content per seed differs (A11).
 * - **params (A9).** Options k ≤ 4 → 3PL with c = 1/k; k ≥ 5 or numeric entry → 2PL; with
 *   b = `difficulty.b_prior` and a = the family's default discrimination. Blocks use the
 *   A10 models (GRM for span, Gaussian for RT/PS) and omit `options_count`.
 * - **difficulty.** `b_prior` is finite with |b_prior| ≤ 4, `sd_prior` > 0 (σ_b = 1.0 by
 *   default), `features` are the named inputs of the v0 regression, and `provenance` says how
 *   b was obtained (see `priors.ts`, M1.P).
 * - **Time.** `expected_time_s` > 0 is E[T] for information per second (§7.4); blocks use the
 *   block duration. `time_limit_s`, if present, is > 0.
 * - **JSON.** An instance is plain JSON with snake_case keys and survives a JSON round trip.
 *   Optional fields are omitted, never `undefined`.
 * - **Strata.** `stratum` ∈ `family.strata`. `generate(seed, { stratum: k })` returns an item
 *   in stratum k (seed `<seed>@s<k>`, see `resolveSeed`) or throws a RangeError if the family
 *   cannot target k.
 */

import {
  axis as axisDef,
  createRng,
  isAxisCode,
  isJsonValue,
  type AxisCode,
  type ItemBase,
  type ItemParams,
  type JsonValue,
  type Rng,
} from '../engine'
import { FAMILY_ID_RE, FAMILY_NAME_RE, GENERATOR_VERSION_RE, familyId, isStratum, itemId, resolveSeed, type Stratum } from './ids'
import { B_PRIOR_LIMIT } from './priors'

/** A JSON object (the shape of `spec` and `key` once parsed from JSON). */
export type JsonObject = { [key: string]: JsonValue }

/** A named input of the difficulty regression. */
export type Feature = number | string | boolean

/** The item's difficulty prior b ~ N(b_prior, sd_prior²) and where it came from (§6.ii, §12). */
export interface DifficultyPrior {
  readonly features: Readonly<Record<string, Feature>>
  readonly b_prior: number
  readonly sd_prior: number
  readonly provenance: string
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
  /** The family name `<fam>` (e.g. "rot"). */
  readonly family: string
  readonly generator_version: string
  /** The resolved seed: `generate(seed)` reproduces this item exactly. */
  readonly seed: string
  readonly axis: AxisCode
  /** Drill-down sub-facet (§3), e.g. "3d_rotation", "series". */
  readonly facet: string
  /** Renderer / response format, e.g. "mc_image_spec", "numeric_entry", "span". */
  readonly item_type: string
  /** Difficulty stratum 1–6 (§6.ii). */
  readonly stratum: Stratum
  /** Render payload. Must not contain or trivially reveal the key. */
  readonly spec: Spec
  /** The answer key, a JSON object such as `{ index: 2 }` or `{ value: 42, tol: 0 }`. */
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
  readonly time_limit_s?: number
}

/** Result of a family verifier (gates G2/G3, §4.1): `checks` is recorded like §12 `verification.checks`. */
export interface VerifyResult {
  readonly ok: boolean
  /** "ok", or why the instance failed. */
  readonly reason: string
  readonly checks: Readonly<Record<string, JsonValue>>
}

/**
 * Result of scoring a response. `correct` is 0/1 for keyed items and null for blocks and
 * continuous responses (§8 response tuple); `value` carries a continuous score (e.g. GRM
 * category for span, median log-RT for RT, log correct/min for coding). Named `ItemScore`, not
 * `ScoreResult`: that is the engine's person-level MAP/EAP result (`engine/scorer.ts`), and code
 * that imports both barrels needs the two apart. The bank twin is `hb.gen.base.ScoreResult`.
 */
export interface ItemScore {
  readonly correct: 0 | 1 | null
  readonly value?: number
}

export interface GenerateOptions {
  /** Target difficulty stratum; the family throws a RangeError if it cannot produce it. */
  readonly stratum?: number
}

/** A procedural family: seeded generator, verifier and scorer (A1, A11). */
export interface ProceduralFamily<Spec extends object = JsonObject, Key extends object = JsonObject, Resp = unknown> {
  /** Short family code used in ids (`FAMILY_NAME_RE`), e.g. "rot". */
  readonly name: string
  readonly axis: AxisCode
  readonly facet: string
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
  score(item: ItemInstance<Spec, Key>, response: Resp): ItemScore
  /** `familyId(name, structuralParams)` for this family. */
  familyIdOf(structuralParams: JsonValue): string
}

/** Any family, e.g. in the registry (method parameters are bivariant, so every family fits). */
export type AnyFamily = ProceduralFamily<object, object, unknown>

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

/** What {@link FamilyDefinition.build} returns: the content; ids and seed are filled in. */
export interface BuiltItem<Spec extends object, Key extends object> {
  readonly stratum: Stratum
  readonly spec: Spec
  readonly key: Key
  readonly structural_params: JsonValue
  readonly options_count?: number
  readonly difficulty: DifficultyPrior
  readonly expected_time_s: number
  readonly time_limit_s?: number
  /** Override the A9 parameters, e.g. GRM (span) or Gaussian (RT, PS) for blocks (A10). */
  readonly params?: ItemParams
}

export interface BuildContext {
  /** The resolved seed recorded in the item (already includes any `@s<k>` suffix). */
  readonly seed: string
  /** The requested stratum, or undefined when the family chooses. */
  readonly stratum?: Stratum
}

/** Everything a family implements when using {@link defineFamily}. */
export interface FamilyDefinition<Spec extends object, Key extends object, Resp> {
  readonly name: string
  readonly axis: AxisCode
  readonly facet: string
  readonly generatorVersion: string
  readonly itemType: string
  readonly strata: readonly Stratum[]
  /** Family default discrimination a for the A9 params (default {@link DEFAULT_A}). */
  readonly defaultA?: number
  /**
   * Build the content from `rng` (seeded from `ctx.seed`; draw nothing from anywhere else).
   * When `ctx.stratum` is set the result must be in that stratum.
   */
  build(rng: Rng, ctx: BuildContext): BuiltItem<Spec, Key>
  verify(item: ItemInstance<Spec, Key>): VerifyResult
  score(item: ItemInstance<Spec, Key>, response: Resp): ItemScore
}

/**
 * Make a {@link ProceduralFamily} from a definition: resolves the stratum-targeted seed, seeds
 * the stream with `createRng(seed)`, and fills in `item_id`, `family_id`, the identity fields
 * and the A9 params (b = b_prior, a = defaultA) unless `build` returned `params`.
 */
export function defineFamily<Spec extends object, Key extends object, Resp>(
  def: FamilyDefinition<Spec, Key, Resp>,
): ProceduralFamily<Spec, Key, Resp> {
  if (!FAMILY_NAME_RE.test(def.name)) throw new RangeError(`family name must match ${FAMILY_NAME_RE}, got ${JSON.stringify(def.name)}`)
  if (!GENERATOR_VERSION_RE.test(def.generatorVersion)) {
    throw new RangeError(`generator version must match ${GENERATOR_VERSION_RE}, got ${JSON.stringify(def.generatorVersion)}`)
  }
  if (!isAxisCode(def.axis)) throw new RangeError(`unknown axis ${JSON.stringify(def.axis)}`)
  if (def.strata.length === 0 || !def.strata.every(isStratum)) throw new RangeError('strata must be a non-empty list of 1–6')
  const a = def.defaultA ?? DEFAULT_A
  const familyIdOf = (structuralParams: JsonValue): string => familyId(def.name, structuralParams)
  return {
    name: def.name,
    axis: def.axis,
    facet: def.facet,
    generatorVersion: def.generatorVersion,
    itemType: def.itemType,
    strata: Object.freeze([...def.strata]),
    familyIdOf,
    verify: (item) => def.verify(item),
    score: (item, response) => def.score(item, response),
    generate(rawSeed: string, opts?: GenerateOptions): ItemInstance<Spec, Key> {
      const { seed, stratum } = resolveSeed(rawSeed, opts?.stratum)
      if (stratum !== undefined && !def.strata.includes(stratum)) {
        throw new RangeError(`family ${def.name} cannot generate stratum ${stratum} (supports ${def.strata.join(', ')})`)
      }
      const built = def.build(createRng(seed), stratum === undefined ? { seed } : { seed, stratum })
      if (stratum !== undefined && built.stratum !== stratum) {
        throw new Error(`family ${def.name}: build() returned stratum ${built.stratum} for requested stratum ${stratum}`)
      }
      return {
        item_id: itemId(def.name, def.generatorVersion, seed),
        family_id: familyIdOf(built.structural_params),
        family: def.name,
        generator_version: def.generatorVersion,
        seed,
        axis: def.axis,
        facet: def.facet,
        item_type: def.itemType,
        stratum: built.stratum,
        spec: built.spec,
        key: built.key,
        structural_params: built.structural_params,
        ...(built.options_count === undefined ? {} : { options_count: built.options_count }),
        params: built.params ?? itemParamsFor(built.options_count, a, built.difficulty.b_prior),
        difficulty: built.difficulty,
        expected_time_s: built.expected_time_s,
        ...(built.time_limit_s === undefined ? {} : { time_limit_s: built.time_limit_s }),
      }
    },
  }
}

const REQUIRED_FIELDS = [
  'item_id',
  'family_id',
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
const OPTIONAL_FIELDS = ['options_count', 'time_limit_s'] as const
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
      if (!isFinitePositive(p.sigma)) out.push('params.sigma must be finite and > 0')
      if (optionsCount !== undefined) out.push('gaussian items (blocks) must omit options_count')
      break
    }
    default:
      out.push(`unknown params.model ${JSON.stringify(p.model)}`)
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
  if (!isAxisCode(x.axis)) out.push(`unknown axis ${JSON.stringify(x.axis)}`)
  if (!isNonEmptyString(x.facet)) out.push('facet must be a non-empty string')
  if (!isNonEmptyString(x.item_type)) out.push('item_type must be a non-empty string')
  if (!isStratum(x.stratum)) out.push('stratum must be an integer 1–6')
  if (!isPlainObject(x.spec)) out.push('spec must be a JSON object')
  if (!isPlainObject(x.key)) out.push('key must be a JSON object')
  if ('options_count' in x) {
    const k = x.options_count
    if (!(typeof k === 'number' && Number.isInteger(k) && k >= 2)) out.push('options_count must be an integer ≥ 2')
  }
  if (!isFinitePositive(x.expected_time_s)) out.push('expected_time_s must be finite and > 0')
  if ('time_limit_s' in x && !isFinitePositive(x.time_limit_s)) out.push('time_limit_s must be finite and > 0')

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
    }
    if (!isFinitePositive(d.sd_prior)) out.push('difficulty.sd_prior must be finite and > 0')
    if (!isNonEmptyString(d.provenance)) out.push('difficulty.provenance must be a non-empty string')
  }
  out.push(...paramsProblems(x.params, x.options_count, isPlainObject(d) ? d.b_prior : undefined))

  if (family) {
    if (fam !== family.name) out.push(`family ${String(fam)} is not ${family.name}`)
    if (ver !== family.generatorVersion) out.push(`generator_version ${String(ver)} is not ${family.generatorVersion}`)
    if (x.axis !== family.axis) out.push(`axis ${String(x.axis)} is not ${family.axis}`)
    if (x.facet !== family.facet) out.push(`facet ${String(x.facet)} is not ${family.facet}`)
    if (x.item_type !== family.itemType) out.push(`item_type ${String(x.item_type)} is not ${family.itemType}`)
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
    axis: item.axis,
    facet: item.facet,
    item_type: item.item_type,
    gold_tier: axisDef(item.axis).tier,
    expected_time_s: item.expected_time_s,
    params: item.params,
    ...(item.time_limit_s === undefined ? {} : { time_limit_s: item.time_limit_s }),
  }
}
