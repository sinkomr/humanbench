/**
 * Shared property suite for procedural families (ROADMAP A1, DESIGN §14.3 M1 acceptance 1:
 * "10k generated instances per family pass verify").
 *
 * TEST-ONLY: import this from `*.test.ts` files and scripts, never from app code, so it stays
 * out of the app bundle (the "testing.ts stays out of the app bundle" test in `testing.test.ts`
 * enforces this). It has no vitest dependency: it throws a {@link FamilyPropertyError} listing
 * the failing seeds, so a family's test is simply
 *
 * ```ts
 * it('passes the family properties at n = 10,000', () => {
 *   const opts = { specLeaksKey: onlySpecFields('terms', 'prompt'), correctResponse: (it) => it.key.value }
 *   runFamilyProperties(series, opts)
 *   runFamilyProperties(series, { ...opts, n: 1_200, strata: series.strata })
 * }, 120_000)
 * ```
 *
 * Every family must pass its own leak predicate (`specLeaksKey`) or a documented waiver: the
 * generic checks ({@link specKeyLeaks}, {@link KeyEchoTracker}) catch common shapes only.
 *
 * The bank mirrors this suite as `hb.gen.testing.run_family_properties` for the Python twins;
 * the banned-name lists below are compared with the bank's by a bank test.
 */

import { canonicalJson, parseItemId, resolveSeed, type Stratum } from './ids'
import { validateItemInstance, type AnyFamily, type ItemInstance, type JsonObject, type ProceduralFamily } from './family'

/** Instances per family property run (DESIGN §14.2; mirrors bank `hb.gen.VERIFY_INSTANCES`). */
export const VERIFY_INSTANCES = 10_000

/**
 * Default minimum share of distinct contents (canonical JSON of spec + key) over a run: distinct
 * seeds must give distinct items. (Distinct item_ids hold by construction: the id embeds the seed.)
 */
export const MIN_CONTENT_RATIO = 0.95

/** Default minimum share of distinct family_ids; families with tiny structural spaces override it. */
export const MIN_FAMILY_ID_RATIO = 0.5

/**
 * Words that must not appear in any spec field name, at any depth: names are split into words
 * at `_`, `-`, digits and camelCase boundaries (`correctIndex` → correct, index). Name a legend
 * `legend`, an input format `input_format`, never `key_table` or `answer_format`.
 */
export const BANNED_SPEC_NAME_TOKENS: ReadonlySet<string> = new Set([
  'key',
  'keys',
  'ans',
  'answer',
  'answers',
  'correct',
  'solution',
  'solutions',
])

/**
 * Stems that must not start or end a spec field name once lowercased with separators removed,
 * which catches names written without word boundaries (`correctindex`, `iscorrect`, `rightanswer`).
 */
export const BANNED_SPEC_NAME_STEMS: readonly string[] = Object.freeze(['answer', 'correct', 'solution'])

/** The words of a field name (see {@link BANNED_SPEC_NAME_TOKENS}), lowercased. */
export function specNameTokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0)
}

/** True if a spec field with this name would (almost certainly) carry the key. */
export function isBannedSpecFieldName(name: string): boolean {
  if (specNameTokens(name).some((w) => BANNED_SPEC_NAME_TOKENS.has(w))) return true
  const flat = name.toLowerCase().replace(/[^a-z0-9]/g, '')
  return BANNED_SPEC_NAME_STEMS.some((s) => flat.startsWith(s) || flat.endsWith(s))
}

/** Instances a spec path must be seen in before {@link KeyEchoTracker} judges it. */
export const KEY_ECHO_MIN_SEEN = 20

/** {@link KeyEchoTracker} ignores key leaves this concentrated (chance agreement Σp² above it). */
export const KEY_ECHO_MAX_CHANCE = 0.75

/** Key leaves beyond this many (blocks with per-trial keys) are not echo-checked. */
export const KEY_ECHO_MAX_KEY_LEAVES = 16

type Scalar = number | string | boolean

function scalarLeaves(v: unknown, path: string, out: [string, Scalar][]): void {
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') out.push([path, v])
  else if (Array.isArray(v)) v.forEach((x, i) => scalarLeaves(x, `${path}[${i}]`, out))
  else if (typeof v === 'object' && v !== null) for (const [k, x] of Object.entries(v)) scalarLeaves(x, `${path}.${k}`, out)
}

interface EchoStat {
  seen: number
  /** Still equal to the key leaf in every instance seen. */
  same: boolean
  /** Still the boolean negation of the key leaf in every instance seen. */
  negated: boolean
  /** Distribution of the key leaf over the instances seen (for the chance-agreement guard). */
  readonly keyCounts: Map<Scalar, number>
}

/**
 * Run-level check for scalar copies of the key in the spec, e.g. `{ total: x + y }` beside key
 * `{ value: x + y }`, `{ pick: 2 }` beside `{ index: 2 }`, or `{ mirrored: false }` beside
 * `{ same: true }`. A spec leaf path is flagged when, over ≥ {@link KEY_ECHO_MIN_SEEN} instances,
 * it equals a scalar key leaf (or, for booleans, its negation) in *every* instance, and the key
 * leaf is not so concentrated that this could be chance (Σp² ≤ {@link KEY_ECHO_MAX_CHANCE}).
 * Coincidences (a series term that happens to equal the answer) break the "every instance" rule,
 * so they are not flagged. Array positions are part of the path, so `options[2]` is its own path.
 */
export class KeyEchoTracker {
  private readonly stats = new Map<string, EchoStat>()
  private readonly dead = new Set<string>()

  observe(item: ItemInstance<object, object>): void {
    const keyLeaves: [string, Scalar][] = []
    scalarLeaves(item.key, 'key', keyLeaves)
    if (keyLeaves.length === 0 || keyLeaves.length > KEY_ECHO_MAX_KEY_LEAVES) return
    const specLeaves: [string, Scalar][] = []
    scalarLeaves(item.spec, 'spec', specLeaves)
    for (const [sp, sv] of specLeaves) {
      for (const [kp, kv] of keyLeaves) {
        const id = `${sp}\u0000${kp}`
        if (this.dead.has(id)) continue
        let st = this.stats.get(id)
        if (!st) {
          st = { seen: 0, same: true, negated: typeof sv === 'boolean' && typeof kv === 'boolean', keyCounts: new Map() }
          this.stats.set(id, st)
        }
        st.same &&= sv === kv
        st.negated &&= sv === !kv
        if (!st.same && !st.negated) {
          this.stats.delete(id)
          this.dead.add(id)
          continue
        }
        st.seen++
        st.keyCounts.set(kv, (st.keyCounts.get(kv) ?? 0) + 1)
      }
    }
  }

  /** One line per spec path that copies a key leaf. */
  problems(): string[] {
    const out: string[] = []
    for (const [id, st] of this.stats) {
      if (st.seen < KEY_ECHO_MIN_SEEN) continue
      let chance = 0
      for (const c of st.keyCounts.values()) chance += (c / st.seen) ** 2
      if (chance > KEY_ECHO_MAX_CHANCE) continue
      const [sp, kp] = id.split('\u0000') as [string, string]
      const how = st.same ? 'equals' : 'is the negation of'
      out.push(`${sp} ${how} ${kp} in all ${st.seen} instances (a scalar copy of the key)`)
    }
    return out.sort()
  }
}

type LeakPredicate<Spec extends object, Key extends object> = (item: ItemInstance<Spec, Key>) => string | null

/**
 * A ready-made `specLeaksKey`: the spec may hold only these top-level fields, so each new field
 * is a deliberate decision. Combine with your own checks where fields could still encode the key.
 */
export function onlySpecFields<Spec extends object = JsonObject, Key extends object = JsonObject>(
  ...fields: readonly string[]
): LeakPredicate<Spec, Key> {
  const allowed = new Set(fields)
  return (item) => {
    const extra = Object.keys(item.spec).filter((k) => !allowed.has(k))
    return extra.length === 0 ? null : `unexpected spec fields: ${extra.join(', ')}`
  }
}

interface FamilyPropertyBaseOptions<Spec extends object, Key extends object, Resp> {
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
  /** Override {@link MIN_CONTENT_RATIO} for a family with a small content space, with the reason. */
  readonly contentRatio?: { readonly min: number; readonly reason: string }
  /**
   * Disable the generic key-in-spec *value* checks (verbatim key values and {@link KeyEchoTracker}),
   * with the reason, for blocks whose stimuli are the key by design (e.g. forward digit span, RT
   * stimulus positions). Banned field names and `specLeaksKey` still apply.
   */
  readonly allowKeyInSpec?: string
  /** A response that must score `correct: 1`; exercises `score()` on every instance. */
  readonly correctResponse?: (item: ItemInstance<Spec, Key>) => Resp
  /** Failures to report before stopping (default 20). */
  readonly maxFailures?: number
}

/**
 * Options of {@link runFamilyProperties}. Exactly one of:
 * - `specLeaksKey`: the family's own leak check (return a description of the leak, or null), for
 *   the leak shapes the generic checks cannot see (option order, a highlighted cell, a stem that
 *   states the result). {@link onlySpecFields} is a good start;
 * - `specLeaksKeyWaiver`: why the family needs no check of its own (a non-empty reason).
 */
export type FamilyPropertyOptions<Spec extends object, Key extends object, Resp> = FamilyPropertyBaseOptions<Spec, Key, Resp> &
  (
    | { readonly specLeaksKey: LeakPredicate<Spec, Key>; readonly specLeaksKeyWaiver?: never }
    | { readonly specLeaksKey?: never; readonly specLeaksKeyWaiver: string }
  )

export interface FamilyPropertyReport {
  readonly family: string
  readonly n: number
  readonly distinctItemIds: number
  readonly distinctContents: number
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
 * Generic per-instance check that `spec` does not contain the key: no field anywhere in spec has
 * a banned name ({@link isBannedSpecFieldName}), the serialised key is not a substring of the
 * serialised spec, and (unless `allowKeyInSpec`) no non-trivial key value (array with ≥ 2
 * elements, non-empty object, string of ≥ 3 characters) appears verbatim in spec. Scalar copies
 * of the key are caught across instances by {@link KeyEchoTracker}. Returns the problems found.
 */
export function specKeyLeaks(item: ItemInstance<object, object>, allowKeyInSpec = false): string[] {
  const out: string[] = []
  const walk = (v: unknown, path: string): void => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`))
    else if (typeof v === 'object' && v !== null) {
      for (const [k, x] of Object.entries(v)) {
        if (isBannedSpecFieldName(k)) out.push(`spec has a field named ${JSON.stringify(k)} at ${path}`)
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

const needsReason = (what: string, v: { readonly reason: string } | string | undefined): void => {
  if (v === undefined) return
  const reason = typeof v === 'string' ? v : v.reason
  if (!(typeof reason === 'string' && reason.trim().length > 0)) throw new RangeError(`${what} needs a documented reason`)
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
 * - `score(item, correctResponse(item))` gives `correct === 1` and a finite `value` (if any)
 *   when `correctResponse` is given.
 * Over the run: no spec path copies a scalar key leaf ({@link KeyEchoTracker}, unless
 * `allowKeyInSpec`), ≥ 95% (or `contentRatio.min`) distinct contents and ≥ 50% (or
 * `familyIdRatio.min`) distinct family_ids.
 */
export function runFamilyProperties<Spec extends object, Key extends object, Resp>(
  family: ProceduralFamily<Spec, Key, Resp>,
  opts: FamilyPropertyOptions<Spec, Key, Resp>,
): FamilyPropertyReport {
  const n = opts.n ?? VERIFY_INSTANCES
  const prefix = opts.seedPrefix ?? 'prop-'
  const maxFailures = opts.maxFailures ?? 20
  const minFamilyRatio = opts.familyIdRatio?.min ?? MIN_FAMILY_ID_RATIO
  const minContentRatio = opts.contentRatio?.min ?? MIN_CONTENT_RATIO
  if (!(Number.isInteger(n) && n >= 1)) throw new RangeError(`n must be a positive integer, got ${n}`)
  needsReason('familyIdRatio', opts.familyIdRatio)
  needsReason('contentRatio', opts.contentRatio)
  needsReason('allowKeyInSpec', opts.allowKeyInSpec)
  needsReason('specLeaksKeyWaiver', opts.specLeaksKeyWaiver)
  if ((typeof opts.specLeaksKey === 'function') === (opts.specLeaksKeyWaiver !== undefined)) {
    throw new RangeError('give exactly one of specLeaksKey (the family leak check) or specLeaksKeyWaiver (why none is needed)')
  }
  const any = family as unknown as AnyFamily
  const failures: string[] = []
  const itemIds = new Set<string>()
  const contents = new Set<string>()
  const familyIds = new Set<string>()
  const echoes = new KeyEchoTracker()
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
      contents.add(canonicalJson({ spec: item.spec, key: item.key }))
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
      if (opts.allowKeyInSpec === undefined) echoes.observe(item)
      const extra = opts.specLeaksKey?.(item) ?? null
      if (extra !== null) fail(`specLeaksKey: ${extra}`)

      if (opts.correctResponse) {
        const s = family.score(loaded, opts.correctResponse(loaded))
        if (s.correct !== 1) fail(`score(correctResponse) gave correct = ${String(s.correct)}`)
        if (s.value !== undefined && !(typeof s.value === 'number' && Number.isFinite(s.value))) {
          fail(`score value must be a finite number, got ${String(s.value)}`)
        }
      }
    } catch (e) {
      fail(`threw ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`)
    }
  }

  if (failures.length === 0) {
    failures.push(...echoes.problems())
    if (contents.size < minContentRatio * n) {
      const why = opts.contentRatio ? ` (override: ${opts.contentRatio.reason})` : ''
      failures.push(`only ${contents.size}/${n} distinct contents (spec + key; need ≥ ${minContentRatio * 100}%${why})`)
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
    distinctContents: contents.size,
    distinctFamilyIds: familyIds.size,
    strataCounts,
    bPrior: { min: bMin, max: bMax, mean: bSum / generated },
  }
}
