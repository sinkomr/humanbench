/**
 * G7 spot-audit verdicts (DESIGN §4.4, §12 `verification.human_audit`; ROADMAP M1.G7): what the
 * dev-only review page stores in localStorage and exports for the bank to ingest.
 *
 * Policy (§4.4): 30 instances per procedural family per generator version, seeds
 * `review-<family>-<i>` for i = 1 … 30, each marked pass / fail / unsure with an optional note.
 * Zero fails in 30 bounds the family's defect rate below 10% (one-sided 95%, rule of three); any
 * fail means the family is re-audited after the fix (a new generator version gets new ids).
 *
 * ## Export format `hb.g7_review.v1` (JSON, snake_case, one file per export)
 *
 * ```json
 * {
 *   "schema": "hb.g7_review.v1",
 *   "exported_utc": "2026-10-01T09:30:00Z",
 *   "reviewer": "sinkomr",
 *   "design_ref": "DESIGN §4.4 G7",
 *   "per_family": 30,
 *   "seed_pattern": "review-<family>-<i>",
 *   "families": [
 *     { "family": "series", "generator_version": "1.3.0", "planned": 30, "reviewed": 30, "pass": 29, "fail": 1, "unsure": 0 }
 *   ],
 *   "verdicts": [
 *     {
 *       "item_id": "i:series:1.3.0:review-series-1", "family": "series", "generator_version": "1.3.0",
 *       "seed": "review-series-1", "family_id": "f:series:0123456789ab", "sibling_group": "f:series:0123456789ab",
 *       "verdict": "pass", "note": "", "reviewed_utc": "2026-10-01T09:12:44Z"
 *     }
 *   ]
 * }
 * ```
 *
 * - `families`: one row per family of this build (its current generator version), counting the
 *   verdicts on its 30 planned instances; `reviewed` = pass + fail + unsure.
 * - `verdicts`: every stored verdict, sorted by item id, including ones for older generator
 *   versions (their ids no longer regenerate, A11; the bank keeps or drops them by version).
 * - `verdict` ∈ pass | fail | unsure; `note` is free text (≤ 2,000 characters); times are UTC
 *   whole seconds (`save/clock.ts`), the wall-clock date of the audit, never a response time.
 * - Bank ingestion (§12): each verdict becomes the item's `verification.human_audit` =
 *   `{ "by": reviewer, "date": reviewed_utc[0:10], "result": verdict }`, and the family's audit
 *   passes for that generator version iff `planned` = `reviewed` = `pass`.
 */

import { utcSeconds, wallClockMs } from '../save/clock'

export const REVIEW_SCHEMA = 'hb.g7_review.v1'
export const REVIEW_STORE_SCHEMA = 'hb.g7_review.store.v1'
/** localStorage key of the review store. */
export const REVIEW_STORAGE_KEY = 'hb.g7_review.v1'
/** Instances per family per generator version (§4.4). */
export const REVIEW_PER_FAMILY = 30
export const REVIEW_SEED_PATTERN = 'review-<family>-<i>'
export const NOTE_MAX = 2000

export type Verdict = 'pass' | 'fail' | 'unsure'
export const VERDICTS: readonly Verdict[] = Object.freeze(['pass', 'fail', 'unsure'] as const)

/** The seed of instance `i` (1 … 30) of a family. */
export function reviewSeed(family: string, i: number): string {
  return `review-${family}-${i}`
}

/** One stored verdict (the export's `verdicts[]` row). */
export interface VerdictRecord {
  readonly item_id: string
  readonly family: string
  readonly generator_version: string
  readonly seed: string
  readonly family_id: string
  readonly sibling_group: string
  readonly verdict: Verdict
  readonly note: string
  readonly reviewed_utc: string
}

/** What localStorage holds. */
export interface ReviewStore {
  readonly schema: typeof REVIEW_STORE_SCHEMA
  readonly reviewer: string
  readonly verdicts: Readonly<Record<string, VerdictRecord>>
}

export interface FamilySummary {
  readonly family: string
  readonly generator_version: string
  readonly planned: number
  readonly reviewed: number
  readonly pass: number
  readonly fail: number
  readonly unsure: number
}

export interface ReviewExport {
  readonly schema: typeof REVIEW_SCHEMA
  readonly exported_utc: string
  readonly reviewer: string
  readonly design_ref: string
  readonly per_family: number
  readonly seed_pattern: string
  readonly families: readonly FamilySummary[]
  readonly verdicts: readonly VerdictRecord[]
}

/** A family of this build: its name and current generator version. */
export interface PlannedFamily {
  readonly family: string
  readonly generator_version: string
}

export function emptyStore(): ReviewStore {
  return { schema: REVIEW_STORE_SCHEMA, reviewer: '', verdicts: {} }
}

/** The current wall-clock time as UTC whole seconds (audit metadata only, never RT). */
export function nowUtc(): string {
  return utcSeconds(wallClockMs())
}

const UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const ITEM_ID_RE = /^i:([a-z][a-z0-9_]{0,23}):([^:]+):(.+)$/

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'

/** Every way `v` fails to be a {@link VerdictRecord} (empty = valid). */
export function verdictProblems(v: unknown, where = 'verdict'): string[] {
  if (!isObj(v)) return [`${where} must be an object`]
  const out: string[] = []
  const fields = ['item_id', 'family', 'generator_version', 'seed', 'family_id', 'sibling_group', 'verdict', 'note', 'reviewed_utc']
  for (const k of Object.keys(v)) if (!fields.includes(k)) out.push(`${where}: unknown field ${k}`)
  for (const k of fields) if (!isStr(v[k])) out.push(`${where}.${k} must be a string`)
  if (out.length > 0) return out
  const m = ITEM_ID_RE.exec(v.item_id as string)
  if (!m) out.push(`${where}.item_id must be i:<family>:<version>:<seed>`)
  else if (m[1] !== v.family || m[2] !== v.generator_version || m[3] !== v.seed) out.push(`${where}: item_id does not match family, generator_version and seed`)
  if (!(VERDICTS as readonly string[]).includes(v.verdict as string)) out.push(`${where}.verdict must be pass, fail or unsure`)
  if ((v.note as string).length > NOTE_MAX) out.push(`${where}.note is longer than ${NOTE_MAX} characters`)
  if (!UTC_RE.test(v.reviewed_utc as string)) out.push(`${where}.reviewed_utc must be YYYY-MM-DDTHH:MM:SSZ`)
  return out
}

/** Parse a stored review (localStorage); anything unreadable gives an empty store, bad rows are dropped. */
export function parseStore(text: string | null): ReviewStore {
  if (text === null) return emptyStore()
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return emptyStore()
  }
  if (!isObj(raw) || raw.schema !== REVIEW_STORE_SCHEMA || !isObj(raw.verdicts)) return emptyStore()
  const verdicts: Record<string, VerdictRecord> = {}
  for (const [id, v] of Object.entries(raw.verdicts)) {
    if (verdictProblems(v).length === 0 && (v as VerdictRecord).item_id === id) verdicts[id] = v as VerdictRecord
  }
  return { schema: REVIEW_STORE_SCHEMA, reviewer: isStr(raw.reviewer) ? raw.reviewer : '', verdicts }
}

/** The store with `record` set (or removed when `record` is null). */
export function withVerdict(store: ReviewStore, itemId: string, record: VerdictRecord | null): ReviewStore {
  const verdicts = { ...store.verdicts }
  if (record === null) delete verdicts[itemId]
  else {
    const problems = verdictProblems(record)
    if (problems.length > 0) throw new RangeError(problems.join('; '))
    if (record.item_id !== itemId) throw new RangeError(`verdict for ${record.item_id} stored under ${itemId}`)
    verdicts[itemId] = record
  }
  return { ...store, verdicts }
}

/** Per-family counts over the planned instances (the verdicts on the family's current version). */
export function summarize(store: ReviewStore, planned: readonly PlannedFamily[]): FamilySummary[] {
  return planned.map(({ family, generator_version }) => {
    let pass = 0
    let fail = 0
    let unsure = 0
    for (let i = 1; i <= REVIEW_PER_FAMILY; i++) {
      const v = store.verdicts[`i:${family}:${generator_version}:${reviewSeed(family, i)}`]
      if (v?.verdict === 'pass') pass++
      else if (v?.verdict === 'fail') fail++
      else if (v?.verdict === 'unsure') unsure++
    }
    return { family, generator_version, planned: REVIEW_PER_FAMILY, reviewed: pass + fail + unsure, pass, fail, unsure }
  })
}

/** The export document (see the module comment). */
export function buildExport(store: ReviewStore, planned: readonly PlannedFamily[], exportedUtc: string): ReviewExport {
  return {
    schema: REVIEW_SCHEMA,
    exported_utc: exportedUtc,
    reviewer: store.reviewer,
    design_ref: 'DESIGN §4.4 G7',
    per_family: REVIEW_PER_FAMILY,
    seed_pattern: REVIEW_SEED_PATTERN,
    families: summarize(store, planned),
    verdicts: Object.values(store.verdicts).sort((a, b) => (a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0)),
  }
}

/** Every way `x` fails to be a {@link ReviewExport} (empty = valid). */
export function exportProblems(x: unknown): string[] {
  if (!isObj(x)) return ['an export must be a JSON object']
  const out: string[] = []
  if (x.schema !== REVIEW_SCHEMA) out.push(`schema must be ${REVIEW_SCHEMA}`)
  if (!isStr(x.exported_utc) || !UTC_RE.test(x.exported_utc)) out.push('exported_utc must be YYYY-MM-DDTHH:MM:SSZ')
  if (!isStr(x.reviewer)) out.push('reviewer must be a string')
  if (x.per_family !== REVIEW_PER_FAMILY) out.push(`per_family must be ${REVIEW_PER_FAMILY}`)
  if (!Array.isArray(x.families)) out.push('families must be an array')
  if (!Array.isArray(x.verdicts)) out.push('verdicts must be an array')
  else x.verdicts.forEach((v: unknown, i) => out.push(...verdictProblems(v, `verdicts[${i}]`)))
  return out
}

/** Read an export file back into a store (e.g. to continue an audit on another machine); throws on an invalid file. */
export function storeFromExport(text: string): ReviewStore {
  const x: unknown = JSON.parse(text)
  const problems = exportProblems(x)
  if (problems.length > 0) throw new RangeError(`not a ${REVIEW_SCHEMA} file: ${problems.slice(0, 5).join('; ')}`)
  const e = x as ReviewExport
  return { schema: REVIEW_STORE_SCHEMA, reviewer: e.reviewer, verdicts: Object.fromEntries(e.verdicts.map((v) => [v.item_id, v])) }
}

/** `base` with `incoming`'s verdicts added; on the same item the later `reviewed_utc` wins (ties keep `base`). */
export function mergeStores(base: ReviewStore, incoming: ReviewStore): ReviewStore {
  const verdicts: Record<string, VerdictRecord> = { ...base.verdicts }
  for (const [id, v] of Object.entries(incoming.verdicts)) {
    const cur = verdicts[id]
    if (cur === undefined || v.reviewed_utc > cur.reviewed_utc) verdicts[id] = v
  }
  return { schema: REVIEW_STORE_SCHEMA, reviewer: base.reviewer || incoming.reviewer, verdicts }
}
