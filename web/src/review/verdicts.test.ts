/**
 * The G7 verdict store and export (DESIGN §4.4, §12 `human_audit`; ROADMAP M1.G7): validation,
 * per-family summaries over the 30 planned seeds, the documented export shape, the round trip
 * export → import, and merge semantics (later review wins, idempotent).
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  REVIEW_PER_FAMILY,
  REVIEW_SCHEMA,
  buildExport,
  emptyStore,
  exportProblems,
  mergeStores,
  nowUtc,
  parseStore,
  reviewSeed,
  storeFromExport,
  summarize,
  verdictProblems,
  withVerdict,
  type Verdict,
  type VerdictRecord,
} from './verdicts'

const planned = [
  { family: 'series', generator_version: '1.3.0' },
  { family: 'quant', generator_version: '1.3.0' },
]

function rec(family: string, i: number, verdict: Verdict, utc = '2026-10-01T09:00:00Z', version = '1.3.0', reviewer = 'sinkomr'): VerdictRecord {
  const seed = reviewSeed(family, i)
  return {
    item_id: `i:${family}:${version}:${seed}`,
    family,
    generator_version: version,
    seed,
    family_id: `f:${family}:0123456789ab`,
    sibling_group: `f:${family}:0123456789ab`,
    verdict,
    note: '',
    reviewer,
    reviewed_utc: utc,
  }
}

describe('verdict records', () => {
  it('accepts a well-formed record and rejects each kind of bad field', () => {
    expect(verdictProblems(rec('series', 1, 'pass'))).toEqual([])
    expect(verdictProblems({ ...rec('series', 1, 'pass'), verdict: 'ok' })).not.toEqual([])
    expect(verdictProblems({ ...rec('series', 1, 'pass'), seed: 'review-series-2' })).not.toEqual([])
    expect(verdictProblems({ ...rec('series', 1, 'pass'), reviewed_utc: '2026-10-01' })).not.toEqual([])
    expect(verdictProblems({ ...rec('series', 1, 'pass'), note: 'x'.repeat(2001) })).not.toEqual([])
    expect(verdictProblems({ ...rec('series', 1, 'pass'), extra: 1 })).not.toEqual([])
    expect(verdictProblems({ ...rec('series', 1, 'pass'), reviewer: '' })).not.toEqual([])
    expect(verdictProblems({ ...rec('series', 1, 'pass'), reviewer: '  ' })).not.toEqual([])
    const noReviewer: Record<string, unknown> = { ...rec('series', 1, 'pass') }
    delete noReviewer.reviewer
    expect(verdictProblems(noReviewer)).not.toEqual([])
    expect(verdictProblems(null)).not.toEqual([])
  })

  it('withVerdict sets and clears, and refuses a record under another id', () => {
    const r = rec('series', 3, 'fail')
    const s = withVerdict(emptyStore(), r.item_id, r)
    expect(s.verdicts[r.item_id]).toEqual(r)
    expect(withVerdict(s, r.item_id, null).verdicts).toEqual({})
    expect(() => withVerdict(s, 'i:series:1.3.0:other', r)).toThrow(RangeError)
  })

  it('nowUtc is UTC whole seconds', () => {
    expect(nowUtc()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  })
})

describe('store parsing', () => {
  it('reads what it wrote, drops bad rows, and survives garbage', () => {
    const good = rec('quant', 2, 'unsure')
    const s = withVerdict({ ...emptyStore(), reviewer: 'me' }, good.item_id, good)
    expect(parseStore(JSON.stringify(s))).toEqual(s)
    const withBad = { ...s, verdicts: { ...s.verdicts, 'i:x:1:y': { nope: true } } }
    expect(parseStore(JSON.stringify(withBad))).toEqual(s)
    for (const junk of [null, '', '{', '[]', '{"schema":"other"}', 'null']) expect(parseStore(junk)).toEqual(emptyStore())
  })
})

describe('summaries and export', () => {
  it('counts verdicts on the 30 planned seeds of the current version only', () => {
    let s = emptyStore()
    for (let i = 1; i <= 30; i++) s = withVerdict(s, rec('series', i, i === 7 ? 'fail' : i === 9 ? 'unsure' : 'pass').item_id, rec('series', i, i === 7 ? 'fail' : i === 9 ? 'unsure' : 'pass'))
    const old = rec('series', 1, 'fail', '2026-09-01T00:00:00Z', '1.2.0')
    const extra = rec('series', 31, 'fail')
    s = withVerdict(withVerdict(s, old.item_id, old), extra.item_id, extra)
    expect(summarize(s, planned)).toEqual([
      { family: 'series', generator_version: '1.3.0', planned: 30, reviewed: 30, pass: 28, fail: 1, unsure: 1 },
      { family: 'quant', generator_version: '1.3.0', planned: 30, reviewed: 0, pass: 0, fail: 0, unsure: 0 },
    ])
  })

  it('exports the documented shape, sorted by item id, including older versions', () => {
    let s = { ...emptyStore(), reviewer: 'sinkomr' }
    for (const r of [rec('quant', 2, 'pass'), rec('series', 1, 'fail'), rec('series', 1, 'pass', '2026-09-01T00:00:00Z', '1.2.0')]) s = withVerdict(s, r.item_id, r)
    const doc = buildExport(s, planned, '2026-10-02T10:00:00Z')
    expect(doc).toMatchObject({
      schema: REVIEW_SCHEMA,
      exported_utc: '2026-10-02T10:00:00Z',
      reviewer: 'sinkomr',
      design_ref: 'DESIGN §4.4 G7',
      per_family: REVIEW_PER_FAMILY,
      seed_pattern: 'review-<family>-<i>',
    })
    expect(doc.verdicts.map((v) => v.item_id)).toEqual(['i:quant:1.3.0:review-quant-2', 'i:series:1.2.0:review-series-1', 'i:series:1.3.0:review-series-1'])
    expect(exportProblems(doc)).toEqual([])
    expect(exportProblems(JSON.parse(JSON.stringify(doc)))).toEqual([])
    expect(exportProblems({ ...doc, schema: 'x' })).not.toEqual([])
    expect(exportProblems({ ...doc, verdicts: [{}] })).not.toEqual([])
    expect(exportProblems({ ...doc, reviewer: '' })).not.toEqual([])
  })

  it('refuses to export without a reviewer name (§12 human_audit.by)', () => {
    const r = rec('quant', 2, 'pass')
    const s = withVerdict(emptyStore(), r.item_id, r)
    expect(() => buildExport(s, planned, '2026-10-02T10:00:00Z')).toThrow(RangeError)
    expect(() => buildExport({ ...s, reviewer: ' ' }, planned, '2026-10-02T10:00:00Z')).toThrow(RangeError)
    expect(buildExport({ ...s, reviewer: 'me' }, planned, '2026-10-02T10:00:00Z').reviewer).toBe('me')
  })

  it('an export imports back to the same verdicts; bad files are refused', () => {
    let s = { ...emptyStore(), reviewer: 'r' }
    for (const r of [rec('quant', 2, 'pass'), rec('series', 5, 'fail')]) s = withVerdict(s, r.item_id, r)
    const back = storeFromExport(JSON.stringify(buildExport(s, planned, '2026-10-02T10:00:00Z')))
    expect(back).toEqual(s)
    expect(() => storeFromExport('{"schema":"hb.g7_review.v1"}')).toThrow(RangeError)
    expect(() => storeFromExport('not json')).toThrow()
  })

  it('merge keeps each verdict\'s own reviewer and this browser\'s reviewer name', () => {
    const mine = rec('quant', 1, 'pass', '2026-09-10T00:00:00Z', '1.3.0', 'alice')
    const theirs = [rec('quant', 1, 'fail', '2026-09-11T00:00:00Z', '1.3.0', 'bob'), rec('series', 2, 'unsure', '2026-09-11T00:00:00Z', '1.3.0', 'bob')]
    const a = withVerdict({ ...emptyStore(), reviewer: 'alice' }, mine.item_id, mine)
    const b = theirs.reduce((s, r) => withVerdict(s, r.item_id, r), { ...emptyStore(), reviewer: 'bob' })
    const m = mergeStores(a, storeFromExport(JSON.stringify(buildExport(b, planned, '2026-09-12T00:00:00Z'))))
    expect(m.reviewer).toBe('alice')
    expect(Object.values(m.verdicts).map((v) => [v.item_id, v.reviewer])).toEqual([
      ['i:quant:1.3.0:review-quant-1', 'bob'],
      ['i:series:1.3.0:review-series-2', 'bob'],
    ])
    const doc = buildExport(m, planned, '2026-09-13T00:00:00Z')
    expect(doc.reviewer).toBe('alice')
    expect(doc.verdicts.every((v) => v.reviewer === 'bob')).toBe(true)
  })

  it('merge keeps the later review of an item, and is idempotent (property)', () => {
    const arbRec = fc
      .record({ fam: fc.constantFrom('series', 'quant'), i: fc.integer({ min: 1, max: 5 }), v: fc.constantFrom<Verdict>('pass', 'fail', 'unsure'), day: fc.integer({ min: 10, max: 28 }) })
      .map(({ fam, i, v, day }) => rec(fam, i, v, `2026-09-${day}T00:00:00Z`))
    const arbStore = fc.array(arbRec, { maxLength: 8 }).map((rs) => rs.reduce((s, r) => withVerdict(s, r.item_id, r), emptyStore()))
    fc.assert(
      fc.property(arbStore, arbStore, (a, b) => {
        const m = mergeStores(a, b)
        expect(mergeStores(m, b)).toEqual(m)
        expect(mergeStores(m, a)).toEqual(m)
        for (const [id, v] of Object.entries(m.verdicts)) {
          const later = [a.verdicts[id], b.verdicts[id]].filter((x): x is VerdictRecord => x !== undefined).map((x) => x.reviewed_utc)
          expect(v.reviewed_utc).toBe(later.sort().at(-1))
        }
      }),
    )
  })
})
