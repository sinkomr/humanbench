/**
 * `schema/brief-v1.json` (the published JSON Schema of the notes) against the hand-written
 * validator, the way `save/schema.test.ts` does for the save file: ajv and `validateBriefShape`
 * must agree on generated notes, single-rule mutations and random JSON. The grammar-level checks
 * of `validateBrief` sit on top and are tested here too.
 */

import Ajv2020 from 'ajv/dist/2020'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import schemaText from '../../../schema/brief-v1.json?raw'
import { buildBrief } from './build'
import { PROFILES } from './profiles'
import { briefObject, renderJson } from './render'
import { arbExtras, arbForm, arbMonth, arbPrefs } from './testing'
import { validateBrief, validateBriefShape } from './validate'

const schema = JSON.parse(schemaText) as Record<string, unknown>
const ajv = new Ajv2020({ strict: true, allErrors: true })
const ajvValidate = ajv.compile(schema)
const ajvOk = (doc: unknown): boolean => ajvValidate(doc) === true
const shapeOk = (doc: unknown): boolean => validateBriefShape(doc).length === 0
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

type Doc = Record<string, unknown>
const first = (): Doc => briefObject(buildBrief({ prefs: PROFILES[0]!.prefs, extras: PROFILES[0]!.extras, form: 'skill', asOf: '2026-11' }).brief)

const MUTATIONS: [string, (d: Doc) => void][] = [
  ['drop format', (d) => delete d.format],
  ['format hb-brief/2', (d) => (d.format = 'hb-brief/2')],
  ['extra key', (d) => (d.email = 'x')],
  ['drop lines', (d) => delete d.lines],
  ['templates format', (d) => (d.templates = '2026-09')],
  ['topics version', (d) => (d.topics = 'v1')],
  ['groups version', (d) => (d.groups = 'group1')],
  ['as_of day', (d) => (d.as_of = '2026-11-05')],
  ['as_of month 13', (d) => (d.as_of = '2026-13')],
  ['revisit text', (d) => (d.revisit = 'soon')],
  ['context unknown', (d) => (d.context = 'gaming')],
  ['form unknown', (d) => (d.form = 'medium')],
  ['tier T0', (d) => (d.tier = 'T0')],
  ['mode challenge', (d) => (d.mode_default = 'challenge')],
  ['length long', (d) => (d.length = 'long')],
  ['lines not array', (d) => (d.lines = {})],
  ['61 lines', (d) => (d.lines = Array.from({ length: 61 }, () => ({ id: 'F1' })))],
  ['line not object', (d) => ((d.lines as unknown[])[0] = 'F1')],
  ['line without id', (d) => ((d.lines as Doc[])[0] = {})],
  ['line id with space', (d) => ((d.lines as Doc[])[0] = { id: 'F 1' })],
  ['line id too long', (d) => ((d.lines as Doc[])[0] = { id: 'A'.repeat(17) })],
  ['line extra key', (d) => ((d.lines as Doc[])[0] = { id: 'F1', zone: 'skip' })],
  ['line status shipped', (d) => ((d.lines as Doc[])[0] = { id: 'F1', status: 'shipped' })],
  ['line custom false', (d) => ((d.lines as Doc[])[0] = { id: 'X1', text: 'Use metric units.', custom: false })],
  ['empty topics', (d) => ((d.lines as Doc[])[0] = { id: 'DS', topics: [] })],
  ['duplicate topics', (d) => ((d.lines as Doc[])[0] = { id: 'DS', topics: ['quant/linear', 'quant/linear'] })],
  ['topic id uppercase', (d) => ((d.lines as Doc[])[0] = { id: 'DS', topics: ['Quant/linear'] })],
  ['topic id no slash', (d) => ((d.lines as Doc[])[0] = { id: 'DS', topics: ['linear'] })],
  ['26 topics', (d) => ((d.lines as Doc[])[0] = { id: 'DS', topics: Array.from({ length: 26 }, (_, i) => `other/t${i}`) })],
  ['4 interests', (d) => ((d.lines as Doc[])[0] = { id: 'I1', interests: ['a1', 'b1', 'c1', 'd1'] })],
  ['interest with digit', (d) => ((d.lines as Doc[])[0] = { id: 'I1', interests: ['chess2'] })],
  ['text too short', (d) => ((d.lines as Doc[])[0] = { id: 'X1', text: 'ab', custom: true })],
  ['text non-ASCII', (d) => ((d.lines as Doc[])[0] = { id: 'X1', text: `caf${String.fromCodePoint(0xe9)} ok`, custom: true })],
  ['keywords value number', (d) => (d.keywords = { 'teach me': 1 })],
  ['keyword key uppercase', (d) => (d.keywords = { 'Teach me': 'learn' })],
  ['generator missing key', (d) => (d.generator = { version: 'x', zone_rule: 'z1' })],
  ['generator extra key', (d) => (d.generator = { version: 'x', zone_rule: 'z1', param_version: 'p', score: 'x' })],
  ['generator bad chars', (d) => (d.generator = { version: 'x y', zone_rule: 'z1', param_version: 'p' })],
]

describe('schema/brief-v1.json', () => {
  it('is a valid 2020-12 schema published under the Pages schema path', () => {
    expect(schema.$id).toBe('https://sinkomr.github.io/humanbench/schema/brief-v1.json')
    expect(schema.additionalProperties).toBe(false)
  })

  it('accepts the golden notes and both validators agree', () => {
    for (const p of PROFILES) {
      const doc = JSON.parse(renderJson(buildBrief({ prefs: p.prefs, extras: p.extras, form: p.form, asOf: p.asOf }).brief)) as unknown
      expect(ajvOk(doc), p.name).toBe(true)
      expect(validateBriefShape(doc), p.name).toEqual([])
      expect(validateBrief(doc).ok, p.name).toBe(true)
    }
  })

  it('agrees with the TypeScript validator on random notes', () => {
    fc.assert(
      fc.property(arbPrefs, arbExtras, arbForm, arbMonth, (prefs, extras, form, asOf) => {
        const doc = briefObject(buildBrief({ prefs, extras, form, asOf }).brief)
        expect(ajvOk(doc)).toBe(true)
        expect(shapeOk(doc)).toBe(true)
        expect(validateBrief(doc).ok).toBe(true)
      }),
      { numRuns: 300 },
    )
  })

  for (const [name, apply] of MUTATIONS) {
    it(`rejects: ${name}, in both validators`, () => {
      const d = clone(first())
      apply(d)
      expect(ajvOk(d)).toBe(false)
      expect(shapeOk(d)).toBe(false)
    })
  }

  it('agrees with ajv on arbitrary JSON', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        expect(shapeOk(v)).toBe(ajvOk(v))
      }),
      { numRuns: 300 },
    )
  })

  it('agrees with ajv on the golden notes with one random field replaced by random JSON', () => {
    const keys = Object.keys(first())
    fc.assert(
      fc.property(fc.constantFrom(...keys), fc.jsonValue(), (key, v) => {
        const d = clone(first())
        d[key] = v
        expect(shapeOk(d)).toBe(ajvOk(d))
      }),
      { numRuns: 400 },
    )
  })
})

describe('validateBrief (grammar rules on top of the schema)', () => {
  const base = (): Doc => clone(first())
  const lines = (d: Doc): Doc[] => d.lines as Doc[]

  it('rejects unknown line ids and topic ids', () => {
    const a = base()
    lines(a).push({ id: 'ZZ' })
    expect(validateBrief(a)).toMatchObject({ ok: false })
    const b = base()
    lines(b).push({ id: 'DS', topics: ['other/knitting'] })
    expect(validateBrief(b)).toMatchObject({ ok: false })
  })

  it('requires slots exactly where a template has them', () => {
    for (const bad of [{ id: 'DS' }, { id: 'F1', topics: ['quant/linear'] }, { id: 'I1' }, { id: 'F1', interests: ['chess'] }, { id: 'F1', text: 'Use metric units.' }, { id: 'X1' }, { id: 'X1', text: 'Use metric units.' }, { id: 'F1', custom: true }]) {
      const d = base()
      lines(d).push(bad)
      expect(validateBrief(d).ok, JSON.stringify(bad)).toBe(false)
    }
  })

  it('requires topics in taxonomy order and custom text that passes the lint', () => {
    const a = base()
    lines(a).push({ id: 'DS', topics: ['other/statistics', 'other/programming'] })
    expect(validateBrief(a).ok).toBe(false)
    const b = base()
    lines(b).push({ id: 'X1', text: 'Visit www.example soon.', custom: true })
    expect(validateBrief(b).ok).toBe(false)
    const c = base()
    lines(c).push({ id: 'X1', text: 'Use metric units.', custom: true })
    expect(validateBrief(c).ok).toBe(true)
  })

  it('returns the brief it was given when valid', () => {
    const d = base()
    const v = validateBrief(d)
    expect(v.ok && v.brief).toEqual(d)
  })
})
