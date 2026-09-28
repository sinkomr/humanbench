import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { jcs } from './jcs'
import { majorOf, migrateToCurrent, MIGRATIONS, type Migration } from './migrate'
import { loadSaveDocument, parseSaveText } from './parse'
import { SCHEMA_MAJOR, SCHEMA_URL } from './types'
import { validateSave } from './validate'

/**
 * A fake pre-v1 format, to exercise the scaffold (§8 step 5): v0 kept camelCase keys, responses as
 * objects, and a single epoch-ms timestamp.
 */
interface V0 {
  schema_version: string
  anonId: string
  createdMs: number
  sessions: { id: string; startedMs: number; seconds: number; responses: { item: string; answer: string; correct: boolean | null; rtMs: number }[] }[]
  seen: string[]
}

const iso = (ms: number): string => `${new Date(ms).toISOString().slice(0, 19)}Z`

/** The fake v0 → v1 migration: pure, total on v0 documents. */
const migrateV0ToV1: Migration = {
  from: 0,
  to: 1,
  migrate(doc) {
    const v0 = doc as unknown as V0
    return {
      $schema: SCHEMA_URL,
      schema_version: '1.0.0',
      bank_version: 'v0-import',
      anon_id: v0.anonId,
      created_utc: iso(v0.createdMs),
      sessions: v0.sessions.map((s) => ({
        session_id: s.id,
        started_utc: iso(s.startedMs),
        duration_s: s.seconds,
        device: { class: 'other', input: 'other', os_family: 'Unknown', browser_family: 'Unknown', refresh_hz_est: null, timer_res_ms: null, viewport: [0, 0] },
        flags: {},
        responses: s.responses.map((r) => [r.item, 0, r.answer, r.correct === null ? null : r.correct ? 1 : 0, r.rtMs, null]),
      })),
      seen_items: [...v0.seen],
      seen_families: [],
    }
  },
}

const FAKE = new Map<number, Migration>([[0, migrateV0ToV1]])

const v0Doc: V0 = {
  schema_version: '0.3.1',
  anonId: 'hb_7Q3m9Kx2Vw5rT8pL',
  createdMs: Date.UTC(2026, 8, 1, 12),
  sessions: [
    {
      id: 's_01J9ZK3Q',
      startedMs: Date.UTC(2026, 8, 1, 11),
      seconds: 1800,
      responses: [
        { item: 'i:mat:f0182:v3', answer: 'C', correct: true, rtMs: 41250 },
        { item: 'i:rt:simple', answer: 'trials', correct: null, rtMs: 18211 },
      ],
    },
  ],
  seen: ['i:mat:f0182:v3'],
}

function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === 'object') {
    for (const x of Object.values(v)) deepFreeze(x)
    Object.freeze(v)
  }
  return v
}

describe('save migrations scaffold (DESIGN §8 merge step 5)', () => {
  it('ships no migrations yet: v1 is the first format', () => {
    expect(MIGRATIONS.size).toBe(0)
    expect(SCHEMA_MAJOR).toBe(1)
  })

  it('reads the major from schema_version', () => {
    expect(majorOf({ schema_version: '1.0.0' })).toBe(1)
    expect(majorOf({ schema_version: '0.3.1' })).toBe(0)
    expect(majorOf({ schema_version: '12.1.0' })).toBe(12)
    for (const bad of [null, [], 'x', {}, { schema_version: 1 }, { schema_version: 'v1' }, { schema_version: '1.0' }, { schema_version: '01.0.0' }]) {
      expect(majorOf(bad)).toBeNull()
    }
  })

  it('migrates a fake v0 document to a valid v1 save, purely', () => {
    const input = deepFreeze(structuredClone(v0Doc))
    const before = jcs(input)
    const r = migrateToCurrent(input, FAKE)
    if (!r.ok) throw new Error(r.message)
    expect(r.from).toBe(0)
    expect(r.applied).toEqual([0])
    expect(jcs(input)).toBe(before)
    const v = validateSave(r.doc)
    expect(v.ok, v.ok ? '' : v.errors.join('\n')).toBe(true)
    expect(r.doc.sessions).toEqual([
      expect.objectContaining({
        session_id: 's_01J9ZK3Q',
        started_utc: '2026-09-01T11:00:00Z',
        responses: [
          ['i:mat:f0182:v3', 0, 'C', 1, 41250, null],
          ['i:rt:simple', 0, 'trials', null, 18211, null],
        ],
      }),
    ])
  })

  it('upload of a v0 file goes through the registry (parse → migrate → validate)', async () => {
    const r = await parseSaveText(JSON.stringify(v0Doc), { migrations: FAKE })
    if (!r.ok) throw new Error(r.message)
    expect(r.migrated).toEqual([0])
    expect(r.save.anon_id).toBe(v0Doc.anonId)
    // Without the migration the same file is refused with a clear code, not misread.
    const bare = await parseSaveText(JSON.stringify(v0Doc))
    expect(bare.ok ? 'ok' : bare.code).toBe('unknown_version')
  })

  it('a v1 document passes through untouched', () => {
    const doc = { schema_version: '1.4.2', anything: true }
    const r = migrateToCurrent(doc, FAKE)
    expect(r.ok && r.doc === doc && r.applied.length === 0).toBe(true)
  })

  it('refuses newer majors, unknown versions, missing steps and bad steps', () => {
    expect(migrateToCurrent({ schema_version: '2.0.0' }, FAKE)).toMatchObject({ ok: false, code: 'newer_version' })
    expect(migrateToCurrent({ schema_version: 'x' }, FAKE)).toMatchObject({ ok: false, code: 'unknown_version' })
    expect(migrateToCurrent({ schema_version: '0.1.0' }, new Map())).toMatchObject({ ok: false, code: 'unknown_version' })
    const throws: Migration = { from: 0, to: 1, migrate: () => { throw new Error('boom') } }
    expect(migrateToCurrent({ schema_version: '0.1.0' }, new Map([[0, throws]]))).toMatchObject({ ok: false, code: 'migration_failed' })
    const skips: Migration = { from: 0, to: 1, migrate: () => ({ schema_version: '0.2.0' }) }
    expect(migrateToCurrent({ schema_version: '0.1.0' }, new Map([[0, skips]]))).toMatchObject({ ok: false, code: 'migration_failed' })
    const mislabelled: Migration = { from: 1, to: 2, migrate: (d) => ({ ...d }) }
    expect(migrateToCurrent({ schema_version: '0.1.0' }, new Map([[0, mislabelled]]))).toMatchObject({ ok: false, code: 'unknown_version' })
  })

  it('chains several steps (fake v0 → v1 → v2 with current = 2)', () => {
    const v1ToV2: Migration = { from: 1, to: 2, migrate: (d) => ({ ...d, schema_version: '2.0.0', extra: 'v2' }) }
    const r = migrateToCurrent(v0Doc, new Map([[0, migrateV0ToV1], [1, v1ToV2]]), 2)
    if (!r.ok) throw new Error(r.message)
    expect(r.applied).toEqual([0, 1])
    expect(r.doc.schema_version).toBe('2.0.0')
  })

  it('a migrated document that is not valid v1 is reported as invalid, not accepted', () => {
    const broken: Migration = { from: 0, to: 1, migrate: () => ({ schema_version: '1.0.0', sessions: 'nope' }) }
    const r = loadSaveDocument(v0Doc, 'json', { migrations: new Map([[0, broken]]) })
    expect(r.ok ? 'ok' : r.code).toBe('invalid')
  })

  it('the fake migration is total over generated v0 documents (property)', () => {
    const arbV0 = fc.record({
      schema_version: fc.constantFrom('0.0.1', '0.9.9'),
      anonId: fc.constant('hb_7Q3m9Kx2Vw5rT8pL'),
      createdMs: fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2035, 0, 1) }),
      sessions: fc.array(
        fc.record({
          id: fc.constantFrom('s_01J9ZK3Q', 's_01J9ZK3R'),
          startedMs: fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2035, 0, 1) }),
          seconds: fc.nat(10_000),
          responses: fc.array(fc.record({ item: fc.constantFrom('i:a', 'i:b:c'), answer: fc.string(), correct: fc.option(fc.boolean(), { nil: null }), rtMs: fc.nat(100_000) }), { maxLength: 4 }),
        }),
        { maxLength: 3 },
      ),
      seen: fc.array(fc.constantFrom('i:a', 'i:b:c')),
    })
    fc.assert(
      fc.property(arbV0, (d) => {
        const r = loadSaveDocument(d, 'json', { migrations: FAKE })
        expect(r.ok ? 'ok' : `${r.code} ${r.details?.join(';')}`).toBe('ok')
      }),
      { numRuns: 300 },
    )
  })
})
