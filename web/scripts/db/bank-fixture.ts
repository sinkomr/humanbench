/**
 * A synthetic item bank for the M2.1-M2.4 database tests (ROADMAP M2.1). Everything here is made up
 * at run time from a seeded PRNG: ids are `i:tst:...`, stems say "Test item N", and the "answer
 * keys" are positions drawn by the same PRNG. Nothing in it is, or is derived from, a real item or a
 * real key (CLAUDE.md: no item_keys data, no finite-bank items in this repo), and the rows live only
 * in a throw-away database.
 */

import { createHash } from 'node:crypto'
import { AXIS_CODES, type AxisCode } from '../../src/engine/axes'
import { createRng } from '../../src/engine/prng'
import type { TestDb } from './harness'

export type FixtureStatus = 'draft' | 'review' | 'pretest' | 'live' | 'quarantined' | 'retired'

export interface FixtureItem {
  readonly itemId: string
  readonly familyId: string
  readonly siblingGroup: string
  readonly axis: AxisCode
  readonly facet: string
  readonly itemType: 'mc' | 'numeric'
  readonly model: '2pl' | '3pl' | '2pl_testlet'
  readonly a: number
  readonly b: number
  /** Guessing parameter: 1/k for a 4-option item, null for 2PL. */
  readonly c: number | null
  readonly nOptions: number
  /** The key as stored: `{index}` for MC, `{value, tol}` for numeric entry. */
  readonly key: Record<string, unknown>
  readonly status: FixtureStatus
  readonly practiceOnly: boolean
  /** The generator family name (`item_families.generator`): what the selector balances an axis over. Default `test`. */
  readonly generator?: string | undefined
  /** `item_parameters.extra.expected_time_s`, the E[T] of the selection criterion. Default: none (the length-based prior). */
  readonly expectedTimeS?: number | undefined
  /** `item_parameters.se_b`, the sd of b (pretest items: Thompson sampling). Default: null. */
  readonly seB?: number | null | undefined
}

export interface BankSpec {
  /** Items per axis. */
  readonly perAxis: number
  readonly axes?: readonly AxisCode[]
  readonly seed?: string
  /** Facets per axis (items are spread over them). */
  readonly facets?: number
  /** Items per sibling group: 1 = each item is its own group (the default). */
  readonly groupSize?: number
  readonly status?: FixtureStatus
}

const hex12 = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 12)
const round3 = (x: number): number => Math.round(x * 1000) / 1000

/** A deterministic bank: same spec, same items. */
export function fixtureBank(spec: BankSpec): FixtureItem[] {
  const rng = createRng(`bank:${spec.seed ?? 'default'}`)
  const axes = spec.axes ?? (['MAT', 'QR', 'VOC', 'SPA', 'KST'] as const)
  const facets = spec.facets ?? 3
  const groupSize = spec.groupSize ?? 1
  const items: FixtureItem[] = []
  let n = 0
  for (const axis of axes) {
    for (let k = 0; k < spec.perAxis; k++) {
      n++
      const four = n % 2 === 0
      const nOptions = four ? 4 : 5
      const facet = `${axis.toLowerCase()}_f${k % facets}`
      // Items k..k+groupSize-1 of an axis share one near-isomorph group, as quant templates do.
      const groupLabel = `${axis.toLowerCase()}_${Math.floor(k / groupSize)}`
      const familyId = `f:tst:${hex12(`family:${n}`)}`
      items.push({
        itemId: `i:tst:g1:${String(n).padStart(5, '0')}`,
        familyId,
        siblingGroup: groupSize === 1 ? familyId : `g:tst:${groupLabel}`,
        axis,
        facet,
        itemType: 'mc',
        model: four ? '3pl' : '2pl',
        a: round3(Math.exp(rng.normal(0.15, 0.3))),
        b: round3(rng.normal(0, 1.1)),
        c: four ? 0.25 : null,
        nOptions,
        key: { index: rng.int(0, nOptions - 1) },
        status: spec.status ?? 'live',
        practiceOnly: false,
      })
    }
  }
  return items
}

/** One numeric-entry item (key `{value, tol}` as in ROADMAP A18). */
export function numericItem(n: number, axis: AxisCode, value: string, tol: Record<string, number>, over: Partial<FixtureItem> = {}): FixtureItem {
  const familyId = `f:tst:${hex12(`numeric:${n}`)}`
  return {
    itemId: `i:tst:num:${String(n).padStart(5, '0')}`,
    familyId,
    siblingGroup: familyId,
    axis,
    facet: `${axis.toLowerCase()}_num`,
    itemType: 'numeric',
    model: '2pl',
    a: 1.1,
    b: 0.2,
    c: null,
    nOptions: 0,
    key: { value, tol },
    status: 'live',
    practiceOnly: false,
    ...over,
  }
}

/**
 * One item with every property the selection tests care about set by the caller (axis, model, a, b, c,
 * generator, expected time, status, sibling group...). `n` makes the ids unique across a database.
 */
export function customItem(n: number, axis: AxisCode, over: Partial<FixtureItem> = {}): FixtureItem {
  const familyId = `f:tst:${hex12(`custom:${n}`)}`
  const model = over.model ?? '2pl'
  const four = model === '3pl'
  return {
    itemId: `i:tst:cus:${String(n).padStart(6, '0')}`,
    familyId,
    siblingGroup: familyId,
    axis,
    facet: `${axis.toLowerCase()}_c`,
    itemType: 'mc',
    model,
    a: 1,
    b: 0,
    c: four ? 0.25 : null,
    nOptions: four ? 4 : 5,
    key: { index: 0 },
    status: 'live',
    practiceOnly: false,
    ...over,
  }
}

/** Inserts the items, their families, keys and parameters (as the migration owner, bypassing RLS). */
export async function loadFixtureBank(db: TestDb, items: readonly FixtureItem[], paramVersion = 'p-test'): Promise<void> {
  const families = new Map<string, FixtureItem>()
  for (const it of items) if (!families.has(it.familyId)) families.set(it.familyId, it)
  const run = (sql: string, rows: unknown[], ...more: unknown[]) => db.owner.query(sql, [JSON.stringify(rows), ...more])

  await run(
    `insert into public.item_families (family_id, sibling_group, axis, facet, generator, gold_tier, source, license, created_by, practice_only)
     select family_id, sibling_group, axis, facet, generator, 'a', '{"type":"procedural","family":"test"}'::jsonb, 'CC0', 'test:fixture', practice_only
       from jsonb_to_recordset($1::jsonb) as t (family_id text, sibling_group text, axis text, facet text, generator text, practice_only boolean)
     on conflict (family_id) do nothing`,
    [...families.values()].map((f) => ({ family_id: f.familyId, sibling_group: f.siblingGroup, axis: f.axis, facet: f.facet, generator: f.generator ?? 'test', practice_only: f.practiceOnly })),
  )
  await run(
    `insert into public.items (item_id, family_id, item_type, payload, time_limit_s, status, verification, provenance)
     select item_id, family_id, item_type, payload, 180, status, '{}'::jsonb, '{"created_by":"test:fixture"}'::jsonb
       from jsonb_to_recordset($1::jsonb) as t (item_id text, family_id text, item_type text, payload jsonb, status text)`,
    items.map((it) => ({
      item_id: it.itemId,
      family_id: it.familyId,
      item_type: it.itemType,
      status: it.status,
      payload: {
        stem: `Test item ${it.itemId}`,
        media: { renderer: 'test', facet: it.facet },
        ...(it.nOptions > 0 ? { options: ['A', 'B', 'C', 'D', 'E'].slice(0, it.nOptions) } : {}),
      },
    })),
  )
  await run(
    `insert into public.item_keys (item_id, key)
     select item_id, key from jsonb_to_recordset($1::jsonb) as t (item_id text, key jsonb)`,
    items.map((it) => ({ item_id: it.itemId, key: it.key })),
  )
  await run(
    `insert into public.item_parameters (item_id, param_version, model, a, b, c, extra, n_resp, se_b)
     select item_id, $2::text, model, a, b, c, case when expected_time_s is null then '{}'::jsonb else jsonb_build_object('expected_time_s', expected_time_s) end, 0, se_b
       from jsonb_to_recordset($1::jsonb) as t (item_id text, model text, a double precision, b double precision, c double precision, expected_time_s double precision, se_b double precision)`,
    items.map((it) => ({ item_id: it.itemId, model: it.model, a: it.a, b: it.b, c: it.c, expected_time_s: it.expectedTimeS ?? null, se_b: it.seB ?? null })),
    paramVersion,
  )
}

/** Axis codes the fixture knows (for tests that loop over them). */
export const ALL_AXES = AXIS_CODES
