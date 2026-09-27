/**
 * Shared property suite for procedural families (ROADMAP A1, DESIGN §14.3 M1 acceptance 1:
 * "10k generated instances per family pass verify").
 *
 * TEST-ONLY: import this from `*.test.ts` files and scripts, never from app code, so it stays
 * out of the app bundle (a test in `contract.test.ts` enforces this). It has no vitest
 * dependency: it throws a {@link FamilyPropertyError} listing the failing seeds, so a family's
 * test is simply
 *
 * ```ts
 * it('passes the family properties at n = 10,000', () => {
 *   runFamilyProperties(series)
 *   runFamilyProperties(series, { n: 1_200, strata: series.strata })
 * }, 120_000)
 * ```
 *
 * The bank mirrors this suite as `hb.gen.testing.run_family_properties` for the Python twins.
 */

import { canonicalJson, parseItemId, resolveSeed, type Stratum } from './ids'
import { validateItemInstance, type AnyFamily, type ItemInstance, type ProceduralFamily } from './family'

/** Instances per family property run (DESIGN §14.2; mirrors bank `hb.gen.VERIFY_INSTANCES`). */
export const VERIFY_INSTANCES = 10_000

/** Minimum share of distinct item_ids over a run (distinct seeds must give distinct ids). */
export const MIN_ITEM_ID_RATIO = 0.95

/** Default minimum share of distinct family_ids; families with tiny structural spaces override it. */
export const MIN_FAMILY_ID_RATIO = 0.5

/** Field names that must never appear anywhere in a spec (they almost always carry the key). */
export const BANNED_SPEC_FIELDS: ReadonlySet<string> = new Set([
  'key',
  'keys',
  'answer',
  'answers',
  'correct',
  'correct_index',
  'correct_option',
  'is_correct',
  'solution',
  'solutions',
])

export interface FamilyPropertyOptions<Spec extends object, Key extends object, Resp> {
  /** Instances to generate (default {@link VERIFY_INSTANCES}). */
  readonly n?: number
  /** Request these strata cyclically via `generate(seed, { stratum })` (default: none requested). */
  readonly strata?: readonly Stratum[]
  /** Seeds are `${seedPrefix}${i}` (default "prop-"). */
  readonly seedPrefix?: string
  /**
   * Override {@link MIN_FAMILY_ID_RATIO} for a family with a tiny structural space (e.g. quant
   * templates); `reason` documents the value, e.g. "55 unordered digit pairs".
   */
  readonly familyIdRatio?: { readonly min: number; readonly reason: string }
  /**
   * Disable the generic key-in-spec value checks, with the reason, for blocks whose stimuli are
   * the key by design (e.g. forward digit span, RT stimulus positions). Banned field names and
   * `specLeaksKey` still apply.
   */
  readonly allowKeyInSpec?: string
  /** Family-specific leak check: return a description of the leak, or null if none. */
  readonly specLeaksKey?: (item: ItemInstance<Spec, Key>) => string | null
  /** A response that must score `correct: 1`; exercises `score()` on every instance. */
  readonly correctResponse?: (item: ItemInstance<Spec, Key>) => Resp
  /** Failures to report before stopping (default 20). */
  readonly maxFailures?: number
}

export interface FamilyPropertyReport {
  readonly family: string
  readonly n: number
  readonly distinctItemIds: number
  readonly distinctFamilyIds: number
  readonly strataCounts: Readonly<Record<Stratum, number>>
  readonly bPrior: { readonly min: number; readonly max: number; readonly mean: number }
}

/** Thrown by {@link runFamilyProperties}; `failures` holds "seed: problem" lines. */
export class FamilyPropertyError extends Error {
  readonly failures: readonly string[]
  constructor(family: string, failures: readonly string[]) {
    super(`family ${family} failed its properties:\n  ${failures.join('\n  ')}`)
    this.name = 'FamilyPropertyError'
    this.failures = failures
  }
}

/**
 * Generic check that `spec` does not contain the key: the serialised key is not a substring of
 * the serialised spec, no field anywhere in spec has a {@link BANNED_SPEC_FIELDS} name, and (unless
 * `allowKeyInSpec`) no non-trivial key value (array with ≥ 2 elements, non-empty object, string of
 * ≥ 3 characters) appears verbatim in spec. Returns the problems found.
 */
export function specKeyLeaks(item: ItemInstance<object, object>, allowKeyInSpec = false): string[] {
  const out: string[] = []
  const walk = (v: unknown, path: string): void => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`))
    else if (typeof v === 'object' && v !== null) {
      for (const [k, x] of Object.entries(v)) {
        if (BANNED_SPEC_FIELDS.has(k.toLowerCase())) out.push(`spec has a field named ${JSON.stringify(k)} at ${path}`)
        walk(x, `${path}.${k}`)
      }
    }
  }
  walk(item.spec, 'spec')
  if (allowKeyInSpec) return out
  const specJson = canonicalJson(item.spec)
  if (specJson.includes(canonicalJson(item.key))) out.push('spec contains the serialised key')
  for (const [k, v] of Object.entries(item.key)) {
    const nonTrivial =
      (Array.isArray(v) && v.length >= 2) ||
      (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length > 0) ||
      (typeof v === 'string' && v.length >= 3)
    if (nonTrivial && specJson.includes(canonicalJson(v))) out.push(`spec contains key.${k} verbatim`)
  }
  return out
}

/**
 * Run the family property suite and throw a {@link FamilyPropertyError} on any failure. For
 * every seed `${seedPrefix}${i}`, i < n, it asserts:
 * - `generate` does not throw, and the instance passes `validateItemInstance(item, family)`
 *   (ids, identity fields, A9 params with b = b_prior, |b_prior| ≤ 4, sd_prior > 0,
 *   expected_time_s > 0, family_id = familyIdOf(structural_params), stratum in family.strata);
 * - the recorded seed is the resolved seed, a requested stratum is honoured, `generate` is
 *   deterministic, and `generate(seed from item_id)` rebuilds the item (A11);
 * - the JSON round trip preserves the item, and `verify()` of the JSON-loaded copy is ok;
 * - spec does not leak the key ({@link specKeyLeaks} plus `specLeaksKey`);
 * - `score(item, correctResponse(item)).correct === 1` when `correctResponse` is given.
 * Over the run: ≥ 95% distinct item_ids and ≥ 50% (or `familyIdRatio.min`) distinct family_ids.
 */
export function runFamilyProperties<Spec extends object, Key extends object, Resp>(
  family: ProceduralFamily<Spec, Key, Resp>,
  opts: FamilyPropertyOptions<Spec, Key, Resp> = {},
): FamilyPropertyReport {
  const n = opts.n ?? VERIFY_INSTANCES
  const prefix = opts.seedPrefix ?? 'prop-'
  const maxFailures = opts.maxFailures ?? 20
  const minFamilyRatio = opts.familyIdRatio?.min ?? MIN_FAMILY_ID_RATIO
  if (!(Number.isInteger(n) && n >= 1)) throw new RangeError(`n must be a positive integer, got ${n}`)
  if (opts.familyIdRatio && !(opts.familyIdRatio.reason.trim().length > 0)) {
    throw new RangeError('familyIdRatio needs a documented reason')
  }
  if (opts.allowKeyInSpec !== undefined && opts.allowKeyInSpec.trim().length === 0) {
    throw new RangeError('allowKeyInSpec needs a documented reason')
  }
  const any = family as unknown as AnyFamily
  const failures: string[] = []
  const itemIds = new Set<string>()
  const familyIds = new Set<string>()
  const strataCounts: Record<Stratum, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }
  let bMin = Infinity
  let bMax = -Infinity
  let bSum = 0
  let generated = 0

  for (let i = 0; i < n && failures.length < maxFailures; i++) {
    const seed = `${prefix}${i}`
    const stratum = opts.strata && opts.strata.length > 0 ? opts.strata[i % opts.strata.length] : undefined
    const genOpts = stratum === undefined ? undefined : { stratum }
    const fail = (msg: string): void => {
      failures.push(`${seed}${stratum === undefined ? '' : ` (stratum ${stratum})`}: ${msg}`)
    }
    try {
      const item = family.generate(seed, genOpts)
      const problems = validateItemInstance(item, any)
      if (problems.length > 0) {
        fail(problems.join('; '))
        continue
      }
      generated++
      itemIds.add(item.item_id)
      familyIds.add(item.family_id)
      strataCounts[item.stratum]++
      const b = item.difficulty.b_prior
      bMin = Math.min(bMin, b)
      bMax = Math.max(bMax, b)
      bSum += b

      const json = canonicalJson(item)
      const expectedSeed = resolveSeed(seed, stratum).seed
      if (item.seed !== expectedSeed) fail(`recorded seed ${JSON.stringify(item.seed)} is not the resolved seed ${JSON.stringify(expectedSeed)}`)
      if (stratum !== undefined && item.stratum !== stratum) fail(`requested stratum ${stratum}, got ${item.stratum}`)
      if (canonicalJson(family.generate(seed, genOpts)) !== json) fail('generate is not deterministic')
      if (stratum !== undefined) {
        const fromId = parseItemId(item.item_id)
        if (!fromId || canonicalJson(family.generate(fromId.seed)) !== json) fail('generate(seed from item_id) does not rebuild the item')
      }

      const loaded = JSON.parse(JSON.stringify(item)) as ItemInstance<Spec, Key>
      if (canonicalJson(loaded) !== json) fail('JSON round trip changed the item')
      const v = family.verify(loaded)
      if (!v.ok) fail(`verify failed: ${v.reason}`)

      for (const leak of specKeyLeaks(item, opts.allowKeyInSpec !== undefined)) fail(leak)
      const extra = opts.specLeaksKey?.(item) ?? null
      if (extra !== null) fail(`specLeaksKey: ${extra}`)

      if (opts.correctResponse) {
        const s = family.score(loaded, opts.correctResponse(loaded))
        if (s.correct !== 1) fail(`score(correctResponse) gave correct = ${String(s.correct)}`)
        if (s.value !== undefined && !Number.isFinite(s.value)) fail('score value must be finite')
      }
    } catch (e) {
      fail(`threw ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`)
    }
  }

  if (failures.length === 0) {
    if (itemIds.size < MIN_ITEM_ID_RATIO * n) {
      failures.push(`only ${itemIds.size}/${n} distinct item_ids (need ≥ ${MIN_ITEM_ID_RATIO * 100}%)`)
    }
    if (familyIds.size < minFamilyRatio * n) {
      const why = opts.familyIdRatio ? ` (override: ${opts.familyIdRatio.reason})` : ''
      failures.push(`only ${familyIds.size}/${n} distinct family_ids (need ≥ ${minFamilyRatio * 100}%${why})`)
    }
  }
  if (failures.length > 0) throw new FamilyPropertyError(family.name, failures)
  return {
    family: family.name,
    n,
    distinctItemIds: itemIds.size,
    distinctFamilyIds: familyIds.size,
    strataCounts,
    bPrior: { min: bMin, max: bMax, mean: bSum / generated },
  }
}
