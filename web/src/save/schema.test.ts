import Ajv2020 from 'ajv/dist/2020'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import design from '../../../docs/DESIGN.md?raw'
import schemaText from '../../../schema/save-v1.json?raw'
import { jcs } from './jcs'
import { arbSave, TEST_CTX } from './testing'
import { SCHEMA_URL, SCHEMA_VERSION } from './types'
import { validateSave } from './validate'
import { normalizeSave } from './merge'

/** The JSON example of DESIGN §8: the first ```json block after the §8 heading. */
function designExample(): unknown {
  const start = design.indexOf('## 8. Save file specification')
  if (start < 0) throw new Error('DESIGN §8 heading not found')
  const m = /```json\n([\s\S]*?)```/.exec(design.slice(start))
  if (!m?.[1]) throw new Error('DESIGN §8 JSON example not found')
  return JSON.parse(m[1])
}

const schema = JSON.parse(schemaText) as Record<string, unknown>
const ajv = new Ajv2020({ strict: true, strictTuples: false, allowUnionTypes: true, allErrors: true })
const ajvValidate = ajv.compile(schema)

const ajvOk = (doc: unknown): boolean => ajvValidate(doc) === true
const tsOk = (doc: unknown): boolean => validateSave(doc).ok

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

type Doc = Record<string, unknown>
type Mutation = [name: string, apply: (d: Doc) => void]

const sessionsOf = (d: Doc): Doc[] => d.sessions as Doc[]

/** One targeted rule break per entry; each must make both validators reject. */
const MUTATIONS: Mutation[] = [
  ['drop schema_version', (d) => delete d.schema_version],
  ['drop seen_items', (d) => delete d.seen_items],
  ['extra top-level key', (d) => (d.email = 'x@example.org')],
  ['schema_version 2.0.0', (d) => (d.schema_version = '2.0.0')],
  ['schema_version v1', (d) => (d.schema_version = 'v1')],
  ['anon_id without prefix', (d) => (d.anon_id = '7Q3m9Kx2Vw5rT8pL')],
  ['anon_id too short', (d) => (d.anon_id = 'hb_7Q3m9Kx2')],
  ['created_utc with offset', (d) => (d.created_utc = '2026-10-03T18:22:11+01:00')],
  ['created_utc month 13', (d) => (d.created_utc = '2026-13-03T18:22:11Z')],
  ['created_utc with ms', (d) => (d.created_utc = '2026-10-03T18:22:11.123Z')],
  ['bank_version empty', (d) => (d.bank_version = '')],
  ['seen item not i:', (d) => (d.seen_items = ['x:mat'])],
  ['seen family not f:', (d) => (d.seen_families = ['i:mat'])],
  ['sessions not array', (d) => (d.sessions = {})],
  ['sig wrong alg', (d) => (d.sig = { alg: 'none', kid: 'k', mac: 'AA' })],
  ['sig extra key', (d) => (d.sig = { alg: 'HMAC-SHA256', kid: 'k', mac: 'AA', x: 1 })],
  ['cache missing mean', (d) => (d.posterior_cache = { param_version: 'p', axes: [], cov_lower: [] })],
  ['cache axis empty', (d) => (d.posterior_cache = { param_version: 'p', axes: [''], mean: [], cov_lower: [] })],
  ['cache mean string', (d) => (d.posterior_cache = { param_version: 'p', axes: [], mean: ['0'], cov_lower: [] })],
  ['session id bad', (d) => (sessionsOf(d)[0]!.session_id = 'session-1')],
  ['session extra key', (d) => (sessionsOf(d)[0]!.ip = '127.0.0.1')],
  ['session negative duration', (d) => (sessionsOf(d)[0]!.duration_s = -1)],
  ['device extra key (privacy)', (d) => ((sessionsOf(d)[0]!.device as Doc).user_agent = 'Mozilla/5.0')],
  ['device class unknown', (d) => ((sessionsOf(d)[0]!.device as Doc).class = 'watch')],
  ['device viewport 3 numbers', (d) => ((sessionsOf(d)[0]!.device as Doc).viewport = [1, 2, 3])],
  ['device viewport fraction', (d) => ((sessionsOf(d)[0]!.device as Doc).viewport = [1.5, 2])],
  ['device refresh 0', (d) => ((sessionsOf(d)[0]!.device as Doc).refresh_hz_est = 0)],
  ['os_family with version', (d) => ((sessionsOf(d)[0]!.device as Doc).os_family = 'macOS 15.1 (24B83); build/xyz')],
  ['flag camelCase', (d) => ((sessionsOf(d)[0]!.flags as Doc).pasteEvents = 1)],
  ['flag paste fraction', (d) => ((sessionsOf(d)[0]!.flags as Doc).paste_events = 1.5)],
  ['flag string value', (d) => ((sessionsOf(d)[0]!.flags as Doc).note = 'hi')],
  ['response 5 elements', (d) => ((sessionsOf(d)[0]!.responses as unknown[][])[0] = ['i:x', 0, 'A', 1, 10])],
  ['response 8 elements', (d) => ((sessionsOf(d)[0]!.responses as unknown[][])[0] = ['i:x', 0, 'A', 1, 10, null, null, null])],
  ['response pretest 2', (d) => ((sessionsOf(d)[0]!.responses as unknown[][])[0] = ['i:x', 2, 'A', 1, 10, null])],
  ['response pretest true', (d) => ((sessionsOf(d)[0]!.responses as unknown[][])[0] = ['i:x', true, 'A', 1, 10, null])],
  ['response correct 0.5', (d) => ((sessionsOf(d)[0]!.responses as unknown[][])[0] = ['i:x', 0, 'A', 0.5, 10, null])],
  ['response negative rt', (d) => ((sessionsOf(d)[0]!.responses as unknown[][])[0] = ['i:x', 0, 'A', 1, -1, null])],
  ['response confidence 101', (d) => ((sessionsOf(d)[0]!.responses as unknown[][])[0] = ['i:x', 0, 'A', 1, 10, 101])],
  ['response item id bare', (d) => ((sessionsOf(d)[0]!.responses as unknown[][])[0] = ['mat', 0, 'A', 1, 10, null])],
  ['response lone surrogate', (d) => ((sessionsOf(d)[0]!.responses as unknown[][])[0] = ['i:x', 0, 'a\ud800', 1, 10, null])],
  ['response key lone surrogate', (d) => ((sessionsOf(d)[0]!.responses as unknown[][])[0] = ['i:x', 0, { '\udc00': 1 }, 1, 10, null])],
  ['extra lone surrogate', (d) => ((sessionsOf(d)[0]!.responses as unknown[][])[0] = ['i:x', 0, 'A', 1, 10, null, ['\ud83d']])],
  ['os_family version number', (d) => ((sessionsOf(d)[0]!.device as Doc).os_family = 'iOS 17.4.1')],
  ['browser_family version number', (d) => ((sessionsOf(d)[0]!.device as Doc).browser_family = 'Chrome 129.0.6668.100')],
  ['os_family trailing digit', (d) => ((sessionsOf(d)[0]!.device as Doc).os_family = 'Windows 11')],
  ['session sig bad mac', (d) => (sessionsOf(d)[0]!.sig = { alg: 'HMAC-SHA256', kid: 'k', mac: 'has space', anon_id: 'hb_7Q3m9Kx2Vw5rT8pL' })],
  ['session sig without anon_id (A16)', (d) => (sessionsOf(d)[0]!.sig = { alg: 'HMAC-SHA256', kid: 'k', mac: 'AA' })],
  ['session sig bad anon_id', (d) => (sessionsOf(d)[0]!.sig = { alg: 'HMAC-SHA256', kid: 'k', mac: 'AA', anon_id: 'hb_short' })],
  ['file sig with anon_id', (d) => (d.sig = { alg: 'HMAC-SHA256', kid: 'k', mac: 'AA', anon_id: 'hb_7Q3m9Kx2Vw5rT8pL' })],
]

describe('schema/save-v1.json (DESIGN §8)', () => {
  it('is a JSON Schema 2020-12 document whose $id is the §8 $schema URL', () => {
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(schema.$id).toBe(SCHEMA_URL)
    expect((designExample() as Doc).$schema).toBe(SCHEMA_URL)
    expect(SCHEMA_VERSION).toMatch(/^1\.\d+\.\d+$/)
  })

  it('the §8 example validates, under ajv and the TS validator', () => {
    const ex = designExample()
    expect(ajvValidate(ex), JSON.stringify(ajvValidate.errors)).toBe(true)
    const r = validateSave(ex)
    expect(r.ok, r.ok ? '' : r.errors.join('\n')).toBe(true)
  })

  it('the §8 example normalises to a valid save; its placeholder posterior cache and its file sig are dropped', () => {
    const ex = validateSave(designExample())
    if (!ex.ok) throw new Error('example invalid')
    const n = normalizeSave(ex.save, { bank_version: '2026.10.03-b17', param_version: 'p2026.10.03' })
    expect(ajvOk(n)).toBe(true)
    // axes ["MAT", "LR", "..."] with 2 means is not a usable cache (merge.ts isUsableCache).
    expect(n.posterior_cache).toBeUndefined()
    // Dropping the cache changes the body the file-level MAC covered, so the sig goes too.
    expect(n.sig).toBeUndefined()
    expect(n.sessions).toEqual(ex.save.sessions)
  })

  it('every targeted mutation of the §8 example is rejected by both validators', () => {
    for (const [name, apply] of MUTATIONS) {
      const d = clone(designExample()) as Doc
      apply(d)
      expect([name, ajvOk(d)]).toEqual([name, false])
      expect([name, tsOk(d)]).toEqual([name, false])
    }
  })

  it('agrees with ajv on generated valid saves (property)', () => {
    fc.assert(
      fc.property(arbSave(), (s) => {
        expect(ajvOk(s)).toBe(true)
        expect(tsOk(s)).toBe(true)
        expect(ajvOk(normalizeSave(s, TEST_CTX))).toBe(true)
      }),
      { numRuns: 500 },
    )
  })

  it('agrees with ajv on mutated saves (property)', () => {
    const arbPath = fc.array(fc.nat(), { minLength: 1, maxLength: 6 })
    const replacement = fc.oneof(
      fc.constant(undefined),
      fc.constant(null),
      fc.constant(-1),
      fc.constant(1.5),
      fc.constant(''),
      fc.constant('x'),
      fc.constant('\ud800'),
      fc.constant([]),
      fc.constant({}),
      fc.constant(true),
      fc.constant(1e300),
      fc.string({ unit: 'binary', maxLength: 8 }),
    )
    const seen = { valid: 0, invalid: 0 }
    fc.assert(
      fc.property(arbSave(), arbPath, replacement, (s, path, rep) => {
        // Walk a random path of existing keys/indices and replace (or delete) the value there.
        const d = clone(s) as unknown
        let cur = d
        for (let i = 0; i < path.length; i++) {
          if (cur === null || typeof cur !== 'object') break
          const keys = Object.keys(cur)
          if (keys.length === 0) break
          const k = keys[(path[i] ?? 0) % keys.length] as string
          const last = i === path.length - 1 || typeof (cur as Doc)[k] !== 'object' || (cur as Doc)[k] === null
          if (last) {
            if (rep === undefined && !Array.isArray(cur)) delete (cur as Doc)[k]
            else (cur as Doc)[k] = rep === undefined ? null : rep
            break
          }
          cur = (cur as Doc)[k]
        }
        const ok = ajvOk(d)
        expect(tsOk(d)).toBe(ok)
        seen[ok ? 'valid' : 'invalid']++
      }),
      { numRuns: 3000 },
    )
    // Not vacuous: plenty of mutants on both sides of the boundary.
    expect(seen.invalid).toBeGreaterThan(1000)
    expect(seen.valid).toBeGreaterThan(100)
  })

  it('agrees with ajv on arbitrary JSON (property)', () => {
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 4 }), (v) => {
        expect(tsOk(v)).toBe(ajvOk(v))
      }),
      { numRuns: 1000 },
    )
  })

  it('the one intended difference: nesting beyond the canonicaliser limit (64) is rejected only by the TS validator', () => {
    const ex = clone(designExample()) as Doc
    let deep: unknown = 1
    for (let i = 0; i < 70; i++) deep = [deep]
    ;(sessionsOf(ex)[0]!.responses as unknown[][])[0] = ['i:x', 0, deep, 1, 10, null]
    expect(ajvOk(ex)).toBe(true)
    expect(tsOk(ex)).toBe(false)
    expect(() => jcs(ex)).toThrow(TypeError)
    // At exactly the limit both accept and it canonicalises.
    let ok: unknown = 1
    for (let i = 0; i < 59; i++) ok = [ok]
    ;(sessionsOf(ex)[0]!.responses as unknown[][])[0] = ['i:x', 0, ok, 1, 10, null]
    expect(tsOk(ex)).toBe(true)
    expect(() => jcs(ex)).not.toThrow()
  })
})
