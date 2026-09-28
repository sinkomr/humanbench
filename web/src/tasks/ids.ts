/**
 * Identifiers for procedural items and families (ROADMAP A11, DESIGN §7.7, §12).
 *
 * - `item_id   = "i:<fam>:<genver>:<seed>"`: the family name, generator version and seed, so the
 *   item can be regenerated from its id alone (A11). The seed is everything after the third
 *   colon and may itself contain colons.
 * - `family_id = "f:<fam>:<12 hex>"`: the first 12 hex digits of cyrb128 (the engine PRNG hash)
 *   over the canonical JSON of the family's *structural parameters* (the canonical polycube, the
 *   matrix rule set, the series rule family + coefficient class, the quant template, ...). Items
 *   with the same structure are isomorphs, and a user never sees two of one family (§7.7).
 *
 * Across repos (A1, A11): the bank's Python twins (`hb.gen.base`) port `canonicalJson` and cyrb128
 * bit-exactly, so `family_id` is ONE function in both repos. A structure has one family_id
 * whichever twin generated the item, and the §8 `seen_families` exclusion holds across repos.
 * Both repos pin the same vectors (`ids.test.ts` here, `tests/gen/test_gen_base.py` in the
 * bank, which also compares against this module live and recomputes family_id for every dumped
 * TS item); changing either function re-keys every family in both repos.
 * The twins are independent re-derivations and do NOT reproduce TS content for a seed, so an
 * `item_id` names one implementation: TS generators own the bare version (`1.0.0`, never a `+`
 * build tag) and a twin's items carry `<TS version>+py` ({@link PY_TWIN_BUILD}). So
 * `i:rotation:1.0.0:s` regenerates only with this TS generator and `i:rotation:1.0.0+py:s` only
 * with the bank twin (R-8.1 re-scoring): match `generator_version` exactly, never just the family.
 *
 * Stratum-targeted seeds: `generate(seed, { stratum: k })` must be reproducible from the item id
 * alone, so the requested stratum is folded into the seed as a `@s<k>` suffix
 * ({@link stratumSeed}). A family therefore generates from `resolveSeed(seed, stratum)` and records
 * the resolved seed; `generate("x", { stratum: 3 })` and `generate("x@s3")` are the same item.
 */

import { cyrb128, type JsonValue } from '../engine'

/** Difficulty stratum 1–6 (DESIGN §6.ii: MS, HS, college-entry, college, graduate, olympiad). */
export type Stratum = 1 | 2 | 3 | 4 | 5 | 6

/** All strata in order. */
export const STRATA: readonly Stratum[] = Object.freeze([1, 2, 3, 4, 5, 6] as const)

export function isStratum(v: unknown): v is Stratum {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 6
}

/** Family names: short lowercase codes used in ids, e.g. "rot", "mat", "ser", "span". */
export const FAMILY_NAME_RE = /^[a-z][a-z0-9_]{0,23}$/

/**
 * Generator versions (semver-like; no colon, so item ids parse unambiguously), e.g. "1.0.0".
 * TS generators use no `+` build tag; `+py` marks the bank's Python twin (A11).
 */
export const GENERATOR_VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,31}$/

/** Build tag of a bank Python twin's generator version: TS `1.0.0` ↔ twin `1.0.0+py` (A11). */
export const PY_TWIN_BUILD = '+py'

/** True iff `ver` is a bank Python twin's version (`<ver>+py`), which no TS generator rebuilds. */
export function isPyTwinVersion(ver: string): boolean {
  return (
    typeof ver === 'string' &&
    GENERATOR_VERSION_RE.test(ver) &&
    ver.endsWith(PY_TWIN_BUILD) &&
    !ver.slice(0, -PY_TWIN_BUILD.length).includes('+')
  )
}

/** A family id: `f:<fam>:<12 lowercase hex>` (A11). */
export const FAMILY_ID_RE = /^f:([a-z][a-z0-9_]{0,23}):([0-9a-f]{12})$/

/** Hex digits of the structural hash kept in a family id. */
export const FAMILY_HASH_HEX = 12

function checkFamilyName(fam: string): void {
  if (typeof fam !== 'string' || !FAMILY_NAME_RE.test(fam)) {
    throw new RangeError(`family name must match ${FAMILY_NAME_RE}, got ${JSON.stringify(fam)}`)
  }
}

function checkGeneratorVersion(ver: string): void {
  if (typeof ver !== 'string' || !GENERATOR_VERSION_RE.test(ver)) {
    throw new RangeError(`generator version must match ${GENERATOR_VERSION_RE}, got ${JSON.stringify(ver)}`)
  }
}

function checkSeed(seed: string): void {
  if (typeof seed !== 'string' || seed.length === 0) {
    throw new RangeError(`seed must be a non-empty string, got ${JSON.stringify(seed)}`)
  }
}

/** `i:<fam>:<genver>:<seed>` (A11). Throws on an invalid family name, version or empty seed. */
export function itemId(familyName: string, generatorVersion: string, seed: string): string {
  checkFamilyName(familyName)
  checkGeneratorVersion(generatorVersion)
  checkSeed(seed)
  return `i:${familyName}:${generatorVersion}:${seed}`
}

/** Inverse of {@link itemId}; null if `id` is not a well-formed procedural item id. */
export function parseItemId(id: string): { family: string; generatorVersion: string; seed: string } | null {
  const m = /^i:([^:]*):([^:]*):([\s\S]+)$/.exec(id)
  if (!m) return null
  const [, family = '', generatorVersion = '', seed = ''] = m
  if (!FAMILY_NAME_RE.test(family) || !GENERATOR_VERSION_RE.test(generatorVersion)) return null
  return { family, generatorVersion, seed }
}

/**
 * Canonical JSON: object keys sorted by UTF-16 code units (as RFC 8785), no whitespace, numbers
 * as `JSON.stringify` writes them (-0 becomes 0). Throws a TypeError on anything that is not
 * plain JSON (undefined, functions, non-finite numbers, class instances, sparse-array holes,
 * cycles).
 */
export function canonicalJson(v: unknown): string {
  return canon(v, 0)
}

function canon(v: unknown, depth: number): string {
  if (depth > 64) throw new TypeError('canonicalJson: nesting deeper than 64')
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new TypeError(`canonicalJson: non-finite number ${v}`)
    return JSON.stringify(v)
  }
  if (Array.isArray(v)) {
    // An index loop, not map(): map() skips holes and would emit invalid JSON such as "[,1]".
    const parts: string[] = []
    for (let i = 0; i < v.length; i++) {
      if (!(i in v)) throw new TypeError(`canonicalJson: sparse array (hole at index ${i})`)
      parts.push(canon(v[i], depth + 1))
    }
    return `[${parts.join(',')}]`
  }
  if (typeof v === 'object') {
    const proto = Object.getPrototypeOf(v) as unknown
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError('canonicalJson: only plain objects are JSON')
    }
    const rec = v as Record<string, unknown>
    const keys = Object.keys(rec).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(rec[k], depth + 1)}`).join(',')}}`
  }
  throw new TypeError(`canonicalJson: ${typeof v} is not JSON`)
}

/** First {@link FAMILY_HASH_HEX} hex digits of cyrb128 over the canonical JSON of `value`. */
export function structuralHash(value: JsonValue): string {
  return cyrb128(canonicalJson(value))
    .map((w) => w.toString(16).padStart(8, '0'))
    .join('')
    .slice(0, FAMILY_HASH_HEX)
}

/**
 * `f:<fam>:<12 hex>` over the canonical (sorted-key) JSON of the structural parameters (A11).
 * Key order does not matter; array order does, so canonicalise sets (e.g. sort a polycube's
 * cells) before hashing.
 */
export function familyId(familyName: string, structuralParams: JsonValue): string {
  checkFamilyName(familyName)
  return `f:${familyName}:${structuralHash(structuralParams)}`
}

const STRATUM_SUFFIX_RE = /^([\s\S]+)@s([1-6])$/

/** The canonical seed for a stratum-targeted item: `<seed>@s<k>`. */
export function stratumSeed(seed: string, stratum: Stratum): string {
  checkSeed(seed)
  if (!isStratum(stratum)) throw new RangeError(`stratum must be an integer 1–6, got ${String(stratum)}`)
  return `${seed}@s${stratum}`
}

/**
 * Resolve a (seed, requested stratum) pair to the canonical seed recorded in the item and the
 * stratum to target (undefined = the family chooses). A seed that already ends in `@s<k>` targets
 * stratum k; requesting a different stratum for it throws a RangeError.
 */
export function resolveSeed(seed: string, stratum?: number): { seed: string; stratum?: Stratum } {
  checkSeed(seed)
  if (stratum !== undefined && !isStratum(stratum)) {
    throw new RangeError(`stratum must be an integer 1–6, got ${String(stratum)}`)
  }
  const m = STRATUM_SUFFIX_RE.exec(seed)
  if (m) {
    const k = Number(m[2]) as Stratum
    if (stratum !== undefined && stratum !== k) {
      throw new RangeError(`seed ${JSON.stringify(seed)} targets stratum ${k}, but stratum ${stratum} was requested`)
    }
    return { seed, stratum: k }
  }
  return stratum === undefined ? { seed } : { seed: stratumSeed(seed, stratum), stratum }
}
