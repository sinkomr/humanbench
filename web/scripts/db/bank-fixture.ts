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
  /**
   * A generated family whose answers anybody can compute (`item_families.source.type = 'procedural'`), not one of the
   * finite bank (`authored`): the seen lists of a save count only for the former (supabase/README.md). Default false:
   * the fixture's items stand for finite-bank items.
   */
  readonly procedural?: boolean | undefined
  /** An item of a family whose generator only reshuffles authored content (the reading bank, A14): `provenance.finite_content`. Default false. */
  readonly finiteContent?: boolean | undefined
  /** `item_parameters.extra.expected_time_s`, the E[T] of the selection criterion. Default: none (the length-based prior). */
  readonly expectedTimeS?: number | undefined
  /** `item_parameters.se_b`, the sd of b (pretest items: Thompson sampling). Default: null. */
  readonly seB?: number | null | undefined
  /** `items.payload` as it is (a made-up text question, M3.11). Default: the "Test item" stem with `media.renderer` 'test'. */
  readonly payload?: Readonly<Record<string, unknown>> | undefined
  /** `items.item_type` as stored, when it is not the fixture's 'mc' / 'numeric' (the banks' `mc_text`, `mc_passage`). */
  readonly storedType?: string | undefined
  /** `item_families.source.attribution`: the credit line of an excerpted or adapted text (M3.11 phase 2). Default: an authored family with none. */
  readonly attribution?: string | undefined
  /** `items.time_limit_s`. Default 180. */
  readonly timeLimitS?: number | undefined
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

/**
 * Made-up text multiple-choice items of one skill, in the shape the authored banks store (ROADMAP M3.11
 * phase 1): `item_type` 'mc_text', a payload of `{stem, options}` with no `media`, an `{index}` key, a
 * family per item. The text says it is made up and the key is a position drawn by the fixture's PRNG:
 * nothing here is, or is derived from, a real item or a real key.
 */
export function textItems(axis: AxisCode, count: number, seed = 'text'): FixtureItem[] {
  const rng = createRng(`text:${seed}:${axis}`)
  return Array.from({ length: count }, (_, k): FixtureItem => {
    const nOptions = 4 + (k % 3) // 4, 5 or 6 options
    const familyId = `f:tst:${hex12(`text:${seed}:${axis}:${k}`)}`
    const model = nOptions === 4 ? '3pl' : '2pl'
    return {
      itemId: `i:tst:txt:${axis.toLowerCase()}-${String(k).padStart(3, '0')}`,
      familyId,
      siblingGroup: familyId,
      axis,
      facet: `${axis.toLowerCase()}_made_up`,
      itemType: 'mc',
      storedType: 'mc_text',
      model,
      a: round3(Math.exp(rng.normal(0.15, 0.2))),
      b: round3(rng.normal(0, 0.8)),
      c: model === '3pl' ? 0.25 : null,
      nOptions,
      key: { index: rng.int(0, nOptions - 1) },
      status: 'live',
      practiceOnly: false,
      generator: 'authored_test',
      expectedTimeS: 20,
      payload: {
        stem: `Made-up test question ${k + 1} for ${axis}: which placeholder below is listed at position ${k + 1} of nowhere? (No real question.)`,
        options: Array.from({ length: nOptions }, (_, i) => `Placeholder ${axis}-${k + 1}-${'ABCDEF'[i]} (made up)`),
      },
    }
  })
}

export interface PassageSpec {
  /** Passages (one family each). */
  readonly passages: number
  /** Questions of passage `p` (0-based); default 3 and 4 in turn. */
  readonly questions?: (p: number) => number
  readonly axis?: AxisCode
  readonly seed?: string
  /** The parameter model of the questions; default '2pl_testlet' with five options ('3pl': four options, c = 0.25). */
  readonly model?: '2pl_testlet' | '3pl' | '2pl'
  /** A credit line in the family's source for passage `p`; default none. */
  readonly attribution?: (p: number) => string | undefined
  /** Whether the payload's own `media` carries the credit line too; default false. */
  readonly attributionInMedia?: boolean
  readonly status?: FixtureStatus
}

/** The made-up passage `p` of a seed: paragraphs that say they are placeholders. */
export function madeUpPassage(seed: string, p: number, paragraphs = 3): string[] {
  return Array.from(
    { length: paragraphs },
    (_, k) =>
      `Made-up test passage ${p + 1} (${seed}), paragraph ${k + 1}. This text is a placeholder written for a test: the invented town of Quibbleton-${p + 1} has ${k + 3} imaginary bridges, and nothing here is true, quoted or worth remembering.`,
  )
}

/**
 * Made-up passages with their questions, in the shape the authored reading bank stores (ROADMAP M3.11 phase 2):
 * `item_type` 'mc_passage', a payload of `{stem, media: {renderer: 'passage_v1', passage: [...]}, options}`, an
 * `{index}` key, and ONE family per passage that all its questions share (A11). The ids order a passage's
 * questions (`...-p002-q1`, `-q2`): that is the order the server serves them in. The first question carries the
 * reading in its expected time and its time limit. The text says it is made up and the keys are positions
 * drawn by the fixture's PRNG: nothing here is, or is derived from, a real passage, item or key.
 */
export function passageItems(spec: PassageSpec): FixtureItem[] {
  const axis = spec.axis ?? 'RC'
  const seed = spec.seed ?? 'passages'
  const model = spec.model ?? '2pl_testlet'
  const nOptions = model === '3pl' ? 4 : 5
  const rng = createRng(`passage:${seed}:${axis}`)
  const out: FixtureItem[] = []
  for (let p = 0; p < spec.passages; p++) {
    const familyId = `f:tst:${hex12(`passage:${seed}:${axis}:${p}`)}`
    const passage = madeUpPassage(seed, p)
    const attribution = spec.attribution?.(p)
    const n = spec.questions?.(p) ?? 3 + (p % 2)
    for (let q = 0; q < n; q++) {
      out.push({
        itemId: `i:tst:${axis.toLowerCase()}:${seed}-p${String(p + 1).padStart(3, '0')}-q${q + 1}`,
        familyId,
        siblingGroup: familyId,
        axis,
        facet: `${axis.toLowerCase()}_made_up`,
        itemType: 'mc',
        storedType: 'mc_passage',
        model,
        a: round3(Math.exp(rng.normal(0.15, 0.2))),
        b: round3(rng.normal(0, 0.8)),
        c: model === '3pl' ? 0.25 : null,
        nOptions,
        key: { index: rng.int(0, nOptions - 1) },
        status: spec.status ?? 'live',
        practiceOnly: false,
        generator: 'authored_test',
        expectedTimeS: q === 0 ? 120 : 45,
        timeLimitS: q === 0 ? 300 : 180,
        attribution,
        payload: {
          stem: `Made-up test question ${q + 1} about made-up passage ${p + 1}: which placeholder is listed at position ${q + 1}? (No real question.)`,
          media: { renderer: 'passage_v1', passage, ...(spec.attributionInMedia === true && attribution !== undefined ? { attribution } : {}) },
          options: Array.from({ length: nOptions }, (_, i) => `Placeholder ${p + 1}-${q + 1}-${'ABCDEF'[i]} (made up)`),
        },
      })
    }
  }
  return out
}

/** Inserts the items, their families, keys and parameters (as the migration owner, bypassing RLS). */
export async function loadFixtureBank(db: TestDb, items: readonly FixtureItem[], paramVersion = 'p-test'): Promise<void> {
  const families = new Map<string, FixtureItem>()
  for (const it of items) if (!families.has(it.familyId)) families.set(it.familyId, it)
  const run = (sql: string, rows: unknown[], ...more: unknown[]) => db.owner.query(sql, [JSON.stringify(rows), ...more])

  await run(
    `insert into public.item_families (family_id, sibling_group, axis, facet, generator, gold_tier, source, license, created_by, practice_only)
     select family_id, sibling_group, axis, facet, generator, 'a',
            case when procedural then '{"type":"procedural","family":"test"}'::jsonb
                 when attribution is not null then jsonb_build_object('type', 'adapted', 'title', 'A made-up source', 'attribution', attribution)
                 else '{"type":"authored"}'::jsonb end, 'CC0', 'test:fixture', practice_only
       from jsonb_to_recordset($1::jsonb) as t (family_id text, sibling_group text, axis text, facet text, generator text, practice_only boolean, procedural boolean, attribution text)
     on conflict (family_id) do nothing`,
    [...families.values()].map((f) => ({ family_id: f.familyId, sibling_group: f.siblingGroup, axis: f.axis, facet: f.facet, generator: f.generator ?? 'test', practice_only: f.practiceOnly, procedural: f.procedural ?? false, attribution: f.attribution ?? null })),
  )
  await run(
    `insert into public.items (item_id, family_id, item_type, payload, time_limit_s, status, verification, provenance)
     select item_id, family_id, item_type, payload, time_limit_s, status, '{}'::jsonb,
            case when finite_content then '{"created_by":"test:fixture","finite_content":{"bank":"test"}}'::jsonb else '{"created_by":"test:fixture"}'::jsonb end
       from jsonb_to_recordset($1::jsonb) as t (item_id text, family_id text, item_type text, payload jsonb, status text, finite_content boolean, time_limit_s int)`,
    items.map((it) => ({
      item_id: it.itemId,
      family_id: it.familyId,
      item_type: it.storedType ?? it.itemType,
      status: it.status,
      finite_content: it.finiteContent ?? false,
      time_limit_s: it.timeLimitS ?? 180,
      payload: it.payload ?? {
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
