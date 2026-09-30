import Ajv2020 from 'ajv/dist/2020'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import design from '../../../docs/DESIGN.md?raw'
import schemaText from '../../../schema/save-v1.json?raw'
import { jcs } from './jcs'
import { arbSave, TEST_CTX } from './testing'
import type { BriefPrefsV1 } from './types'
import { SCHEMA_URL, SCHEMA_VERSION } from './types'
import { UTC_SECONDS_RE, validateSave } from './validate'
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
  ['created_utc Feb 30', (d) => (d.created_utc = '2026-02-30T00:00:00Z')],
  ['created_utc Feb 29 of a common year', (d) => (d.created_utc = '2026-02-29T00:00:00Z')],
  ['created_utc Feb 29 of 2100', (d) => (d.created_utc = '2100-02-29T00:00:00Z')],
  ['created_utc Apr 31', (d) => (d.created_utc = '2026-04-31T12:00:00Z')],
  ['created_utc year 0000', (d) => (d.created_utc = '0000-01-01T00:00:00Z')],
  ['started_utc before 1970', (d) => (sessionsOf(d)[0]!.started_utc = '1969-12-31T23:59:59Z')],
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

/** Valid notes settings (AI.7) to break one rule at a time. */
const PREFS: BriefPrefsV1 = {
  v: 1,
  topics: 'topics-v1',
  groups: 'g1',
  notes_as_of: '2026-11',
  contexts: [
    {
      slot: 1,
      preset: 'coding',
      destination: 'claude_code_skill',
      tier: 'T1',
      mode: 'do',
      length: 'short',
      topics: { 'other/programming': 'skip', 'quant/probability_counting': 'ask_first' },
      lines_on: ['AC1'],
      lines_off: ['U3'],
      copied: { templates: '2026.09', month: '2026-11', lines: [{ id: 'F1', v: '1' }, { id: 'DS', v: '1' }] },
      rev: 7,
    },
    { slot: 2, rev: 3, removed: true },
  ],
  fit_log: [{ id: '3f9a01c2', topic: 'quant/probability_counting', verdict: 'too_basic', month: '2026-12' }],
  last_zones: {},
}

type PrefsDoc = { brief_prefs: { contexts: Doc[]; fit_log: Doc[] } & Doc }
const ctx0 = (d: Doc): Doc => (d as PrefsDoc).brief_prefs.contexts[0]!

/** One rule break per entry in the notes settings; each must make both validators reject. */
const PREFS_MUTATIONS: Mutation[] = [
  ['brief_prefs not an object', (d) => (d.brief_prefs = [])],
  ['brief_prefs extra key', (d) => ((d.brief_prefs as Doc).note = 'hello')],
  ['brief_prefs v 2', (d) => ((d.brief_prefs as Doc).v = 2)],
  ['brief_prefs drop fit_log', (d) => delete (d.brief_prefs as Doc).fit_log],
  ['topics version free text', (d) => ((d.brief_prefs as Doc).topics = 'my topics')],
  ['groups version free text', (d) => ((d.brief_prefs as Doc).groups = 'group one')],
  ['notes_as_of with a day', (d) => ((d.brief_prefs as Doc).notes_as_of = '2026-11-05')],
  ['notes_as_of month 13', (d) => ((d.brief_prefs as Doc).notes_as_of = '2026-13')],
  ['six contexts', (d) => ((d.brief_prefs as Doc).contexts = [1, 2, 3, 4, 5, 6].map((slot) => ({ slot, rev: 0, removed: true })))],
  ['context slot 0', (d) => (ctx0(d).slot = 0)],
  ['context slot 6', (d) => (ctx0(d).slot = 6)],
  ['context slot 1.5', (d) => (ctx0(d).slot = 1.5)],
  ['context preset unknown', (d) => (ctx0(d).preset = 'my level is low')],
  ['context destination sentence', (d) => (ctx0(d).destination = 'I am not good at maths')],
  ['context destination too long', (d) => (ctx0(d).destination = `a${'b'.repeat(41)}`)],
  ['context form unknown', (d) => (ctx0(d).form = 'huge')],
  ['context tier T9', (d) => (ctx0(d).tier = 'T9')],
  ['context mode unknown', (d) => (ctx0(d).mode = 'be nice')],
  ['context length unknown', (d) => (ctx0(d).length = 'verbose')],
  ['context topic key sentence', (d) => ((ctx0(d).topics as Doc)['I am bad at maths'] = 'skip')],
  ['context topic setting unknown', (d) => ((ctx0(d).topics as Doc)['other/programming'] = 'i give up')],
  ['context topics 41 entries', (d) => (ctx0(d).topics = Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`a/t${i}`, 'skip'])))],
  ['context topics_off duplicate', (d) => (ctx0(d).topics_off = ['quant/linear', 'quant/linear'])],
  ['context lines_on duplicate', (d) => (ctx0(d).lines_on = ['AC1', 'AC1'])],
  ['context lines_on sentence', (d) => (ctx0(d).lines_on = ['a sentence about me'])],
  ['context lines_off 61 entries', (d) => (ctx0(d).lines_off = Array.from({ length: 61 }, (_, i) => `K${i}`))],
  ['context phrasing value sentence', (d) => (ctx0(d).phrasing = { U1: 'a custom wording' })],
  ['context phrasing key sentence', (d) => (ctx0(d).phrasing = { 'my own line': 'U1' })],
  ['context rev negative', (d) => (ctx0(d).rev = -1)],
  ['context rev fraction', (d) => (ctx0(d).rev = 1.5)],
  ['context rev huge', (d) => (ctx0(d).rev = 1000001)],
  ['context extra key (interests)', (d) => (ctx0(d).interests = 'chess')],
  ['context missing lines_on', (d) => delete ctx0(d).lines_on],
  ['context copied without month', (d) => delete (ctx0(d).copied as Doc).month],
  ['context copied line free text', (d) => ((ctx0(d).copied as { lines: Doc[] }).lines[0]!.id = 'Keep it short')],
  ['context copied line v text', (d) => ((ctx0(d).copied as { lines: Doc[] }).lines[0]!.v = 'one')],
  ['context copied extra key', (d) => ((ctx0(d).copied as Doc).text = 'the notes')],
  ['removed set with a preset', (d) => ((d.brief_prefs as { contexts: Doc[] }).contexts[1]!.preset = 'coding')],
  ['removed false', (d) => ((d.brief_prefs as { contexts: Doc[] }).contexts[1]!.removed = false)],
  ['fit id uppercase', (d) => ((d as PrefsDoc).brief_prefs.fit_log[0]!.id = '3F9A01C2')],
  ['fit id short', (d) => ((d as PrefsDoc).brief_prefs.fit_log[0]!.id = '3f9a')],
  ['fit verdict free text', (d) => ((d as PrefsDoc).brief_prefs.fit_log[0]!.verdict = 'far too easy for me')],
  ['fit month with a day', (d) => ((d as PrefsDoc).brief_prefs.fit_log[0]!.month = '2026-12-01')],
  ['fit extra key (a note)', (d) => ((d as PrefsDoc).brief_prefs.fit_log[0]!.note = 'boring')],
  ['fit topic sentence', (d) => ((d as PrefsDoc).brief_prefs.fit_log[0]!.topic = 'Probability, I guess')],
  ['last_zones value unknown', (d) => ((d.brief_prefs as Doc).last_zones = { 'quant/linear': 'expert' })],
  ['last_zones key sentence', (d) => ((d.brief_prefs as Doc).last_zones = { 'my best topic': 'skip' })],
]

describe('schema/save-v1.json (DESIGN §8)', () => {
  it('is a JSON Schema 2020-12 document whose $id is the §8 $schema URL', () => {
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(schema.$id).toBe(SCHEMA_URL)
    expect((designExample() as Doc).$schema).toBe(SCHEMA_URL)
    expect(SCHEMA_VERSION).toMatch(/^1\.\d+\.\d+$/)
  })

  it('the §8 example plus valid notes settings (a prefs-only save too) validates, under ajv and the TS validator', () => {
    const ex = clone(designExample()) as Doc
    ex.brief_prefs = clone(PREFS)
    expect(ajvValidate(ex), JSON.stringify(ajvValidate.errors)).toBe(true)
    expect(tsOk(ex)).toBe(true)
    const prefsOnly = { ...clone(ex), sessions: [], seen_items: [], seen_families: [] } as Doc
    delete prefsOnly.posterior_cache
    delete prefsOnly.sig
    expect(ajvOk(prefsOnly)).toBe(true)
    expect(tsOk(prefsOnly)).toBe(true)
  })

  it('every targeted mutation of valid notes settings is rejected by both validators', () => {
    for (const [name, apply] of PREFS_MUTATIONS) {
      const d = clone(designExample()) as Doc
      d.brief_prefs = clone(PREFS)
      apply(d)
      expect([name, ajvOk(d)]).toEqual([name, false])
      expect([name, tsOk(d)]).toEqual([name, false])
    }
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

  it('utc_seconds: the schema pattern is the TS pattern, and both accept the calendar edge days', () => {
    const defs = schema.$defs as Record<string, { pattern: string }>
    expect(defs.utc_seconds!.pattern).toBe(UTC_SECONDS_RE.source)
    for (const t of ['2028-02-29T12:00:00Z', '2000-02-29T00:00:00Z', '1972-02-29T00:00:00Z', '2400-02-29T23:59:59Z', '1970-01-01T00:00:00Z', '9999-12-31T23:59:59Z', '2026-12-31T23:59:59Z']) {
      const d = clone(designExample()) as Doc
      d.created_utc = t
      expect([t, ajvOk(d), tsOk(d)]).toEqual([t, true, true])
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

  it('agrees with ajv on generated saves with notes settings, and on random mutations inside them (property)', () => {
    const seen = { valid: 0, invalid: 0 }
    const replacement = fc.oneof(fc.constant(undefined), fc.constant(null), fc.constant(-1), fc.constant(1.5), fc.constant(''), fc.constant('x'), fc.constant('a b'), fc.constant('T1'), fc.constant('skip'), fc.constant(6), fc.constant([]), fc.constant({}), fc.constant(true))
    fc.assert(
      fc.property(arbSave({ withPrefs: true }), fc.array(fc.nat(), { minLength: 1, maxLength: 5 }), replacement, (s, path, rep) => {
        expect(ajvOk(s)).toBe(true)
        expect(tsOk(s)).toBe(true)
        expect(ajvOk(normalizeSave(s, TEST_CTX))).toBe(true)
        if (s.brief_prefs === undefined) return
        const d = clone(s) as unknown as Doc
        let cur: unknown = d.brief_prefs
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
      { numRuns: 1500 },
    )
    expect(seen.invalid).toBeGreaterThan(300)
    expect(seen.valid).toBeGreaterThan(30)
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
