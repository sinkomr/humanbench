/**
 * Merging save files (DESIGN §8 "Merging (R-8.1)"), e.g. the same person's saves from two devices,
 * or a crash-recovery autosave with the downloaded file.
 *
 * Inputs are valid v1 saves, already migrated (§8 step 5 runs in `parse.ts`). The merge is a pure
 * join: {@link mergeSaves} is idempotent (`merge(a, a)` is `a` for a normalised `a`), commutative
 * and associative, so merging any set of saves in any order and grouping gives one result
 * (property-tested in `merge.test.ts`). Field by field:
 * - `sessions` (§8 step 1): union by `session_id`, ignoring duplicates. When two copies of one
 *   session differ (an autosave snapshot vs the finished session), the kept copy is the maximum of
 *   (signed, response count, duration, canonical JSON), a total order, so the choice never
 *   depends on argument order. Output is sorted by (`started_utc`, `session_id`).
 * - `seen_items`, `seen_families` (§8 step 2): sorted set union.
 * - `anon_id`: the smaller id (code-unit order), so repeated merges converge on one id. Saves
 *   with different ids may be one person's (a fresh start, later joined with an old file) or two
 *   people's on a shared device, which a merge cannot tell apart: callers check
 *   {@link distinctAnonIds} first and ask before combining (`restoreAutosaves` reports them).
 * - `created_utc`: the later one (fixed-width UTC sorts as text).
 * - `$schema`, `schema_version`, `bank_version`: those of the running app ({@link SaveContext}).
 * - `posterior_cache` (§8 step 4): kept only if its `param_version` is the context's, its shapes
 *   are consistent, and it was computed over exactly the merged sessions; otherwise dropped, and
 *   the caller re-scores from `responses` (§8 step 3, §7.8; M1.Q adds the retest model).
 * - file-level `sig` (§8, superseded by A16): kept only if the merged body is byte-identical under
 *   RFC 8785 to that input's body, i.e. while the MAC can still verify. Session `sig`s (A16) travel
 *   with their sessions and name the anon_id they bind (`SessionSig.anon_id`), so they still
 *   verify when the merged file's `anon_id` differs from the one they were issued to.
 */

import { isAxisCode } from '../engine/axes'
import { jcs } from './jcs'
import { SCHEMA_URL, SCHEMA_VERSION, type PosteriorCache, type SaveContext, type SaveFileV1, type SaveSession } from './types'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** Code-unit order, the order of RFC 8785 keys and of `Array.prototype.sort`. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

function sortedUnion(lists: readonly (readonly string[])[]): string[] {
  return [...new Set(lists.flat())].sort(cmp)
}

/** Total order on two copies of one session: the greater is kept (see the module comment). */
function compareCopies(a: SaveSession, b: SaveSession, ja: string, jb: string): number {
  const signed = Number(a.sig !== undefined) - Number(b.sig !== undefined)
  if (signed !== 0) return signed
  if (a.responses.length !== b.responses.length) return a.responses.length - b.responses.length
  if (a.duration_s !== b.duration_s) return a.duration_s - b.duration_s
  return cmp(ja, jb)
}

/** Sessions deduplicated by id (keeping the greatest copy) and sorted by start time, then id. */
export function mergeSessions(lists: readonly (readonly SaveSession[])[]): SaveSession[] {
  const best = new Map<string, { s: SaveSession; j: string }>()
  for (const s of lists.flat()) {
    const j = jcs(s)
    const prev = best.get(s.session_id)
    if (prev === undefined || compareCopies(s, prev.s, j, prev.j) > 0) best.set(s.session_id, { s, j })
  }
  return [...best.values()]
    .map((x) => clone(x.s))
    .sort((a, b) => cmp(a.started_utc, b.started_utc) || cmp(a.session_id, b.session_id))
}

/**
 * True iff `cache` can stand in for re-scoring under `paramVersion`: same parameter version, one
 * mean per axis, K(K+1)/2 covariance entries, distinct known axis codes (the §8 example's
 * placeholder `"..."` axis therefore fails).
 */
export function isUsableCache(cache: PosteriorCache | undefined, paramVersion: string): cache is PosteriorCache {
  if (cache === undefined || cache.param_version !== paramVersion) return false
  const k = cache.axes.length
  return (
    k > 0 &&
    cache.mean.length === k &&
    cache.cov_lower.length === (k * (k + 1)) / 2 &&
    new Set(cache.axes).size === k &&
    cache.axes.every((a) => isAxisCode(a))
  )
}

/** Greatest by canonical JSON among `xs` (a deterministic, order-free pick), or undefined. */
function canonicalMax<T>(xs: readonly T[]): T | undefined {
  let best: { x: T; j: string } | undefined
  for (const x of xs) {
    const j = jcs(x)
    if (best === undefined || j > best.j) best = { x, j }
  }
  return best === undefined ? undefined : clone(best.x)
}

function bodyWithoutSig(s: SaveFileV1): string {
  const body: Partial<SaveFileV1> = { ...s }
  delete body.sig
  return jcs(body)
}

/**
 * Join of one or more saves under `ctx` (see the module comment). With one save this is its
 * normal form ({@link normalizeSave}). Throws a RangeError on an empty list.
 */
export function mergeAll(saves: readonly SaveFileV1[], ctx: SaveContext): SaveFileV1 {
  const first = saves[0]
  if (first === undefined) throw new RangeError('mergeAll: no saves to merge')
  const sessions = mergeSessions(saves.map((s) => s.sessions))
  const out: SaveFileV1 = {
    $schema: SCHEMA_URL,
    schema_version: SCHEMA_VERSION,
    bank_version: ctx.bank_version,
    anon_id: saves.reduce((m, s) => (s.anon_id < m ? s.anon_id : m), first.anon_id),
    created_utc: saves.reduce((m, s) => (s.created_utc > m ? s.created_utc : m), first.created_utc),
    sessions,
    seen_items: sortedUnion(saves.map((s) => s.seen_items)),
    seen_families: sortedUnion(saves.map((s) => s.seen_families)),
  }
  const sessionsJson = jcs(sessions)
  const cache = canonicalMax(
    saves
      .filter((s) => isUsableCache(s.posterior_cache, ctx.param_version) && jcs(mergeSessions([s.sessions])) === sessionsJson)
      .map((s) => s.posterior_cache as PosteriorCache),
  )
  if (cache !== undefined) out.posterior_cache = cache
  const body = jcs(out)
  const sig = canonicalMax(saves.filter((s) => s.sig !== undefined && bodyWithoutSig(s) === body).map((s) => s.sig))
  if (sig !== undefined) out.sig = sig
  return out
}

/**
 * The distinct `anon_id`s of `saves`, sorted. More than one means the merge would combine saves
 * issued to different ids (see the module comment); the UI should ask before doing so.
 */
export function distinctAnonIds(saves: readonly SaveFileV1[]): string[] {
  return sortedUnion([saves.map((s) => s.anon_id)])
}

/** Merge two saves (R-8.1). Commutative, associative, idempotent on normalised saves. */
export function mergeSaves(a: SaveFileV1, b: SaveFileV1, ctx: SaveContext): SaveFileV1 {
  return mergeAll([a, b], ctx)
}

/** The normal form of one save under `ctx`: `mergeSaves(s, s, ctx)`. */
export function normalizeSave(save: SaveFileV1, ctx: SaveContext): SaveFileV1 {
  return mergeAll([save], ctx)
}

/** True iff the saves are equal under RFC 8785 (key order and formatting ignored). */
export function sameSave(a: SaveFileV1, b: SaveFileV1): boolean {
  return jcs(a) === jcs(b)
}

/**
 * True iff `save` already holds all of `other`'s data: every seen id, and for every session of
 * `other` the copy a merge would keep. Header fields (`anon_id`, `created_utc`, versions), the
 * posterior cache and signatures are not data here. Used to prune redundant autosaves.
 */
export function subsumes(save: SaveFileV1, other: SaveFileV1): boolean {
  const seen = (mine: readonly string[], theirs: readonly string[]): boolean => {
    const set = new Set(mine)
    return theirs.every((x) => set.has(x))
  }
  return (
    seen(save.seen_items, other.seen_items) &&
    seen(save.seen_families, other.seen_families) &&
    jcs(mergeSessions([save.sessions, other.sessions])) === jcs(mergeSessions([save.sessions]))
  )
}
