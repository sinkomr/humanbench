/**
 * Gate statuses of the line types (ADR A22; proposal §7.3). The bank's behaviour harness decides
 * which line types exist and copies only their statuses here as `brief-gates.json` (A17): per
 * line id and wording version, a status, the model families it was checked with, and per-
 * destination smoke dates. Per-family metrics stay in the bank, so this repo never hosts a
 * benchmark of named AI models (§12, D1); `gates.test.ts` checks the file has no numeric field.
 *
 * - `shipped`: renders normally. T0 lines start here (generic good practice, proposal §7.3).
 * - `experimental`: renders with a badge. The person's own lines start here until they pass.
 * - `blocked`: never renders (K2 until the direction gate E7d passes).
 * - A status is keyed by (line id, wording version). A template whose `v` differs from the file's
 *   entry has changed wording, so its gate resets to the type's default ("the wording is the
 *   treatment").
 * - `DB.floor` is the gate for build-up lines on the two lowest quant groups (E3 with the
 *   lowest-level persona, proposal §3.3 step 2). Until it is `shipped`, a self-set "new to me"
 *   there renders as the ask-first line (the floor rule).
 */

import raw from './brief-gates.json'
import { TEMPLATE_BY_ID } from './grammar'
import type { LineId, LineStatus } from './types'

export const GATES_FORMAT = 'hb-brief-gates/1'
/** The gate for bottom-rung build-up lines (E3); not a template. */
export const FLOOR_GATE = 'DB.floor'

export interface GateEntry {
  /** The wording version this status was earned on. */
  readonly v: string
  readonly status: LineStatus
  /** Model families it was checked with, e.g. `Claude`, `Qwen`. Names only. */
  readonly families?: readonly string[]
  /** Month of the last run, `YYYY-MM`. */
  readonly checked?: string
}

export interface SurfaceSmoke {
  /** Month of the smoke test, `YYYY-MM`. */
  readonly date: string
  readonly result: 'pass' | 'fail' | 'not_run'
}

export interface GateFile {
  readonly format: typeof GATES_FORMAT
  readonly templates: string
  readonly lines: Readonly<Record<string, GateEntry>>
  readonly surfaces: Readonly<Record<string, SurfaceSmoke>>
}

const STATUSES: readonly LineStatus[] = ['shipped', 'experimental', 'blocked']

/** Validates untrusted JSON as a gates file; throws a RangeError naming the first problem. */
export function parseGateFile(x: unknown): GateFile {
  const fail = (why: string): never => {
    throw new RangeError(`brief-gates: ${why}`)
  }
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return fail('not an object')
  const o = x as Record<string, unknown>
  if (o.format !== GATES_FORMAT) fail(`format must be ${GATES_FORMAT}`)
  if (typeof o.templates !== 'string') fail('templates must be a string')
  const lines = o.lines
  if (typeof lines !== 'object' || lines === null || Array.isArray(lines)) return fail('lines must be an object')
  for (const [id, e] of Object.entries(lines)) {
    if (typeof e !== 'object' || e === null) fail(`${id}: not an object`)
    const g = e as Record<string, unknown>
    if (typeof g.v !== 'string') fail(`${id}: v must be a string`)
    if (!STATUSES.includes(g.status as LineStatus)) fail(`${id}: bad status`)
    if (g.families !== undefined && !(Array.isArray(g.families) && g.families.every((f) => typeof f === 'string'))) fail(`${id}: families must be strings`)
    if (g.checked !== undefined && (typeof g.checked !== 'string' || !/^\d{4}-\d{2}$/u.test(g.checked))) fail(`${id}: checked must be YYYY-MM`)
  }
  const surfaces = o.surfaces
  if (typeof surfaces !== 'object' || surfaces === null || Array.isArray(surfaces)) return fail('surfaces must be an object')
  for (const [id, s] of Object.entries(surfaces)) {
    const g = s as Record<string, unknown>
    if (typeof g?.date !== 'string' || !/^\d{4}-\d{2}$/u.test(g.date)) fail(`surface ${id}: date must be YYYY-MM`)
    if (!['pass', 'fail', 'not_run'].includes(g.result as string)) fail(`surface ${id}: bad result`)
  }
  return o as unknown as GateFile
}

/** The bundled statuses. The bank overwrites the JSON when a gate run finishes (A17). */
export const DEFAULT_GATES: GateFile = parseGateFile(raw)

/** The status a line type has without a gate entry (or with a stale one): T0 ships, the rest is experimental. */
export function defaultStatus(id: LineId): LineStatus {
  return TEMPLATE_BY_ID.get(id)?.tier === 'T0' ? 'shipped' : 'experimental'
}

/** The current status of a line type: its entry if the wording version matches, else the default. */
export function lineStatus(gates: GateFile, id: LineId): LineStatus {
  const t = TEMPLATE_BY_ID.get(id)
  if (t === undefined) return 'blocked'
  if (id === 'X1') return 'shipped'
  const e = gates.lines[id]
  return e !== undefined && e.v === t.v ? e.status : defaultStatus(id)
}

/** Whether the bottom-rung build-up gate has passed (`DB.floor` shipped): otherwise the floor rule applies. */
export function floorGatePassed(gates: GateFile): boolean {
  const e = gates.lines[FLOOR_GATE]
  const v = TEMPLATE_BY_ID.get('DB')?.v
  return e !== undefined && e.v === v && e.status === 'shipped'
}

/** Families and month a line type was checked with, for the drawer ("Checked with: ..."). */
export function checkedWith(gates: GateFile, id: LineId): { families: readonly string[]; month: string | null } {
  const e = gates.lines[id]
  const t = TEMPLATE_BY_ID.get(id)
  if (e === undefined || t === undefined || e.v !== t.v || !e.families || e.families.length === 0) return { families: [], month: null }
  return { families: e.families, month: e.checked ?? null }
}

const SEVERITY: Record<LineStatus, number> = { shipped: 0, experimental: 1, blocked: 2 }

/** The most restrictive of several statuses (a merged line is as restricted as its parts). */
export function worstStatus(statuses: readonly LineStatus[]): LineStatus {
  return statuses.reduce<LineStatus>((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a), 'shipped')
}
