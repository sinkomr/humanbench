/**
 * Save-file migrations (DESIGN §8 merge step 5: "If `schema_version` is older, run the migrations
 * `migrate_v1_to_v2()` etc. (pure functions, unit-tested)").
 *
 * A document's major version comes from its `schema_version` (semver). Each registered
 * {@link Migration} lifts one major to the next; {@link migrateToCurrent} chains them up to
 * {@link SCHEMA_MAJOR} and then the v1 validator runs (`parse.ts`). Minor and patch bumps are
 * additive within a major and need no migration; a newer-minor file that uses a field this build
 * does not know fails validation and `parse.ts` reports it as `newer_version` ({@link isNewerVersion}),
 * so nothing is silently dropped. v1 is the first format, so the production
 * registry is empty; `migrate.test.ts` exercises the machinery with a fake v0 → v1.
 *
 * Rules for a migration: pure (never mutate the input; return a new object), total on every valid
 * document of its source major, and output valid for the target major. Add one per major bump,
 * keyed by its `from` major, with a golden before/after test.
 */

import { SCHEMA_MAJOR, SCHEMA_VERSION } from './types'

export interface Migration {
  /** Source major version. */
  readonly from: number
  /** Target major version, `from + 1`. */
  readonly to: number
  readonly migrate: (doc: Readonly<Record<string, unknown>>) => Record<string, unknown>
}

/** Registered migrations by source major. Empty: v1 is the first save format. */
export const MIGRATIONS: ReadonlyMap<number, Migration> = new Map()

export type MigrateResult =
  | { ok: true; doc: Record<string, unknown>; from: number; applied: number[] }
  | { ok: false; code: 'unknown_version' | 'newer_version' | 'migration_failed'; message: string }

const SEMVER_RE = /^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/

/** [major, minor, patch] of a semver string, or null. */
function parseSemver(v: unknown): [number, number, number] | null {
  if (typeof v !== 'string') return null
  const m = SEMVER_RE.exec(v)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** [major, minor, patch] of a document's `schema_version`, or null if it has none or it is not semver. */
export function versionOf(doc: unknown): [number, number, number] | null {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return null
  return parseSemver((doc as Record<string, unknown>).schema_version)
}

/** The major of a document's `schema_version`, or null if it has none or it is not semver. */
export function majorOf(doc: unknown): number | null {
  return versionOf(doc)?.[0] ?? null
}

/** True iff the document's `schema_version` is later than `current` (default: this build's). */
export function isNewerVersion(doc: unknown, current: string = SCHEMA_VERSION): boolean {
  const v = versionOf(doc)
  const c = parseSemver(current)
  if (v === null || c === null) return false
  for (let i = 0; i < 3; i++) if (v[i] !== c[i]) return v[i]! > c[i]!
  return false
}

/**
 * Lift `doc` to the current major through `registry`. The input is never mutated. Errors:
 * `unknown_version` (no semver `schema_version`, or no migration from some older major),
 * `newer_version` (made by a newer HumanBench), `migration_failed` (a step threw or skipped a
 * major).
 */
export function migrateToCurrent(
  doc: unknown,
  registry: ReadonlyMap<number, Migration> = MIGRATIONS,
  current: number = SCHEMA_MAJOR,
): MigrateResult {
  const from = majorOf(doc)
  if (from === null) return { ok: false, code: 'unknown_version', message: 'no readable schema_version' }
  if (from > current) return { ok: false, code: 'newer_version', message: `schema_version major ${from} is newer than ${current}` }
  let cur = doc as Record<string, unknown>
  let major = from
  const applied: number[] = []
  while (major < current) {
    const step = registry.get(major)
    if (step === undefined || step.from !== major || step.to !== major + 1) {
      return { ok: false, code: 'unknown_version', message: `no migration from schema major ${major}` }
    }
    try {
      cur = step.migrate(cur)
    } catch (e) {
      return { ok: false, code: 'migration_failed', message: `migration ${major} → ${major + 1} threw: ${String(e)}` }
    }
    const next = majorOf(cur)
    if (next !== major + 1) return { ok: false, code: 'migration_failed', message: `migration ${major} → ${major + 1} produced major ${String(next)}` }
    applied.push(major)
    major = next
  }
  return { ok: true, doc: cur, from, applied }
}
