/**
 * The notes settings inside a save (`brief_prefs`; AI.7; proposal §5.5; requirements R-17.1,
 * R-17.12): the merge is a join (idempotent, commutative, associative), the schema admits no free
 * text, a prefs-only save validates, editing the settings never changes scoring, and the settings
 * travel with a session save.
 */

import Ajv2020 from 'ajv/dist/2020'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import schemaText from '../../../schema/save-v1.json?raw'
import surfaces from '../brief/surfaces.json'
import type { ResponseTuple } from '../engine/types'
import type { ItemInstance } from '../tasks/family'
import { matrices } from '../tasks/matrices'
import { rotation } from '../tasks/rotation'
import { BRIEF_DESTINATIONS, BRIEF_FORMS, BRIEF_LENGTHS, BRIEF_MODES, BRIEF_PRESETS, BRIEF_SETTINGS, BRIEF_TIERS, BRIEF_VERDICTS, FIT_KEEP_PER_TOPIC, briefPrefsCovered, isRemovedContext, mergeBriefPrefs, restoreBriefPrefs, withoutBriefPrefs } from './brief-prefs'
import { saveWithSession } from './create'
import { jcs } from './jcs'
import { mergeAll, normalizeSave, subsumes } from './merge'
import { rescoreSessions } from './rescore'
import { arbBriefPrefs, arbSaveFamily, TEST_CTX } from './testing'
import { SCHEMA_URL, SCHEMA_VERSION, type BriefContextV1, type BriefFitV1, type BriefPrefsV1, type SaveFileV1, type SaveSession } from './types'
import { validateSave } from './validate'

const ctx = TEST_CTX
const RUNS = { numRuns: 400 }
const schema = JSON.parse(schemaText) as { $defs: Record<string, unknown> } & Record<string, unknown>
const ajv = new Ajv2020({ strict: true, strictTuples: false, allowUnionTypes: true, allErrors: true })
const ajvValidate = ajv.compile(schema)
const ajvOk = (doc: unknown): boolean => ajvValidate(doc) === true
const tsOk = (doc: unknown): boolean => validateSave(doc).ok
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const j = (p: BriefPrefsV1 | undefined): string => (p === undefined ? 'undefined' : jcs(p))

const context = (slot: number, rev: number, over: Partial<BriefContextV1> = {}): BriefContextV1 => ({
  slot,
  preset: 'general',
  destination: 'chatgpt_instructions',
  tier: 'T1',
  mode: 'do',
  length: 'standard',
  topics: {},
  lines_on: [],
  lines_off: [],
  rev,
  ...over,
})
const prefs = (over: Partial<BriefPrefsV1> = {}): BriefPrefsV1 => ({ v: 1, topics: 'topics-v1', groups: 'g1', notes_as_of: '2026-11', contexts: [], fit_log: [], ...over })
const fit = (id: string, topic: string, month: string, verdict: BriefFitV1['verdict'] = 'too_basic'): BriefFitV1 => ({ id, topic, verdict, month })
const save = (bp?: BriefPrefsV1, over: Partial<SaveFileV1> = {}): SaveFileV1 => ({
  $schema: SCHEMA_URL,
  schema_version: SCHEMA_VERSION,
  bank_version: ctx.bank_version,
  anon_id: 'hb_7Q3m9Kx2Vw5rT8pL',
  created_utc: '2026-10-03T18:22:11Z',
  sessions: [],
  seen_items: [],
  seen_families: [],
  ...(bp === undefined ? {} : { brief_prefs: bp }),
  ...over,
})

describe('mergeBriefPrefs is a join (idempotent, commutative, associative)', () => {
  it('is idempotent: merging a copy with itself, or again, changes nothing', () => {
    fc.assert(
      fc.property(arbBriefPrefs, (a) => {
        const m = mergeBriefPrefs([a])
        expect(j(mergeBriefPrefs([a, a]))).toBe(j(m))
        expect(j(mergeBriefPrefs([m, a]))).toBe(j(m))
        expect(j(mergeBriefPrefs([m]))).toBe(j(m))
      }),
      { numRuns: 1000 },
    )
  })

  it('is commutative', () => {
    fc.assert(
      fc.property(arbBriefPrefs, arbBriefPrefs, (a, b) => {
        expect(j(mergeBriefPrefs([a, b]))).toBe(j(mergeBriefPrefs([b, a])))
      }),
      { numRuns: 1000 },
    )
  })

  it('is associative, whatever the grouping', () => {
    fc.assert(
      fc.property(arbBriefPrefs, arbBriefPrefs, arbBriefPrefs, (a, b, c) => {
        const left = mergeBriefPrefs([mergeBriefPrefs([a, b]), c])
        const right = mergeBriefPrefs([a, mergeBriefPrefs([b, c])])
        expect(j(left)).toBe(j(right))
        expect(j(left)).toBe(j(mergeBriefPrefs([a, b, c])))
        expect(j(left)).toBe(j(mergeBriefPrefs([c, a, b])))
      }),
      { numRuns: 1000 },
    )
  })

  it('has no settings as its identity, and gives valid settings', () => {
    expect(mergeBriefPrefs([])).toBeUndefined()
    expect(mergeBriefPrefs([undefined, undefined])).toBeUndefined()
    fc.assert(
      fc.property(arbBriefPrefs, arbBriefPrefs, (a, b) => {
        expect(j(mergeBriefPrefs([a, undefined]))).toBe(j(mergeBriefPrefs([a])))
        const m = mergeBriefPrefs([a, b]) as BriefPrefsV1
        expect(ajvOk(save(m)), JSON.stringify(ajvValidate.errors)).toBe(true)
        expect(tsOk(save(m))).toBe(true)
        expect(m.contexts.length).toBeLessThanOrEqual(5)
        expect(new Set(m.contexts.map((c) => c.slot)).size).toBe(m.contexts.length)
      }),
      RUNS,
    )
  })

  it('does not change what it is given', () => {
    fc.assert(
      fc.property(arbBriefPrefs, arbBriefPrefs, (a, b) => {
        const before = [jcs(a), jcs(b)]
        mergeBriefPrefs([a, b])
        expect([jcs(a), jcs(b)]).toEqual(before)
      }),
      RUNS,
    )
  })

  it('makes whole-save merges a join too: settings ride along with the rest (property)', () => {
    fc.assert(
      fc.property(arbSaveFamily(3, { withPrefs: true }), ([a, b, c]) => {
        const ab = mergeAll([a!, b!], ctx)
        const abc1 = mergeAll([ab, c!], ctx)
        const abc2 = mergeAll([a!, mergeAll([b!, c!], ctx)], ctx)
        expect(jcs(abc1)).toBe(jcs(abc2))
        expect(jcs(mergeAll([b!, a!], ctx))).toBe(jcs(ab))
        expect(jcs(normalizeSave(ab, ctx))).toBe(jcs(ab))
        expect(validateSave(abc1).ok).toBe(true)
        expect(j(abc1.brief_prefs)).toBe(j(mergeBriefPrefs([a!.brief_prefs, b!.brief_prefs, c!.brief_prefs])))
      }),
      { numRuns: 60 },
    )
  })
})

describe('what a merge keeps', () => {
  it('keeps, per slot, the set with the higher rev, whichever save it came from', () => {
    const old = prefs({ contexts: [context(1, 3, { mode: 'do' }), context(2, 1, { preset: 'coding' })] })
    const neu = prefs({ contexts: [context(1, 4, { mode: 'learn' }), context(3, 0)] })
    const m = mergeBriefPrefs([old, neu]) as BriefPrefsV1
    expect(m.contexts.map((c) => [c.slot, c.rev])).toEqual([[1, 4], [2, 1], [3, 0]])
    expect((m.contexts[0] as BriefContextV1).mode).toBe('learn')
    expect(j(mergeBriefPrefs([neu, old]))).toBe(j(m))
  })

  it('breaks a tie of revs by the canonical JSON, the same either way round', () => {
    const a = prefs({ contexts: [context(1, 2, { mode: 'do' })] })
    const b = prefs({ contexts: [context(1, 2, { mode: 'learn' })] })
    expect(j(mergeBriefPrefs([a, b]))).toBe(j(mergeBriefPrefs([b, a])))
  })

  it('keeps a removed set removed against an older copy, and lets a newer set replace the removal', () => {
    const live = prefs({ contexts: [context(2, 5)] })
    const removed = prefs({ contexts: [{ slot: 2, rev: 6, removed: true }] })
    const m = mergeBriefPrefs([live, removed]) as BriefPrefsV1
    expect(m.contexts).toEqual([{ slot: 2, rev: 6, removed: true }])
    expect(isRemovedContext(m.contexts[0] as BriefContextV1)).toBe(true)
    const again = prefs({ contexts: [context(2, 7, { preset: 'reading' })] })
    expect((mergeBriefPrefs([live, removed, again]) as BriefPrefsV1).contexts).toEqual([context(2, 7, { preset: 'reading' })])
  })

  it('sorts and de-duplicates the lists of a set, so equal settings are equal bytes', () => {
    const a = prefs({ contexts: [context(1, 1, { lines_on: ['W3', 'AC1', 'W3'], topics_off: ['quant/linear', 'kst/physics'] })] })
    const b = prefs({ contexts: [context(1, 1, { lines_on: ['AC1', 'W3'], topics_off: ['kst/physics', 'quant/linear'] })] })
    expect(j(mergeBriefPrefs([a]))).toBe(j(mergeBriefPrefs([b])))
    expect(((mergeBriefPrefs([a]) as BriefPrefsV1).contexts[0] as BriefContextV1).lines_on).toEqual(['AC1', 'W3'])
  })

  it('joins fit notes as a union, collapsing identical notes and keeping two different notes that share an id', () => {
    const one = fit('01a1b2c3', 'quant/linear', '2026-10')
    const two = fit('02a1b2c3', 'quant/linear', '2026-11', 'too_much')
    const clash = fit('01a1b2c3', 'kst/physics', '2026-10')
    const m = mergeBriefPrefs([prefs({ fit_log: [one, two] }), prefs({ fit_log: [two, clash, one] })]) as BriefPrefsV1
    expect(m.fit_log).toEqual([clash, one, two]) // same month and id: the canonical JSON decides, kst before quant
  })

  it('keeps the newest notes of each topic, in order of month then id, and drops only older ones of the same topic', () => {
    const many = Array.from({ length: FIT_KEEP_PER_TOPIC + 5 }, (_, i) => fit(`${String(i).padStart(2, '0')}000000`, 'quant/linear', '2026-10'))
    const other = fit('00000001', 'kst/physics', '2026-09')
    const m = mergeBriefPrefs([prefs({ fit_log: [...many, other] })]) as BriefPrefsV1
    const linear = m.fit_log.filter((f) => f.topic === 'quant/linear')
    expect(linear).toHaveLength(FIT_KEEP_PER_TOPIC)
    expect(linear[0]?.id).toBe('05000000')
    expect(linear.at(-1)?.id).toBe(many.at(-1)?.id)
    expect(m.fit_log.filter((f) => f.topic === 'kst/physics')).toEqual([other])
    // a later month outranks a larger id of an earlier month
    const later = fit('00000000', 'quant/linear', '2026-12')
    const m2 = mergeBriefPrefs([prefs({ fit_log: [...many, later] })]) as BriefPrefsV1
    expect(m2.fit_log.at(-1)).toEqual(later)
  })

  it('takes the later month, the later vocabulary versions by number, and last_zones from the later notes', () => {
    const a = prefs({ notes_as_of: '2026-10', topics: 'topics-v9', groups: 'g2', last_zones: { 'quant/linear': 'skip' } })
    const b = prefs({ notes_as_of: '2026-12', topics: 'topics-v10', groups: 'g1', last_zones: { 'quant/linear': 'build' } })
    const m = mergeBriefPrefs([a, b]) as BriefPrefsV1
    expect([m.notes_as_of, m.topics, m.groups]).toEqual(['2026-12', 'topics-v10', 'g2'])
    expect(m.last_zones).toEqual({ 'quant/linear': 'build' })
    expect(mergeBriefPrefs([prefs(), prefs()])).not.toHaveProperty('last_zones')
  })

  it('says whether a save already holds another\'s settings (so a prefs-only autosave is not pruned for a save without them)', () => {
    const a = prefs({ contexts: [context(1, 3)] })
    const older = prefs({ contexts: [context(1, 2)] })
    expect(briefPrefsCovered(a, older)).toBe(true)
    expect(briefPrefsCovered(older, a)).toBe(false)
    expect(briefPrefsCovered(undefined, a)).toBe(false)
    expect(briefPrefsCovered(a, undefined)).toBe(true)
    expect(subsumes(save(a), save(older))).toBe(true)
    expect(subsumes(save(), save(a))).toBe(false)
    expect(subsumes(save(older), save(a))).toBe(false)
    expect(subsumes(save(a), save())).toBe(true)
  })
})

describe('restoreBriefPrefs ("Load settings from a save" is a restore, not a rev race)', () => {
  const withoutRevs = (p: BriefPrefsV1): string => jcs({ ...p, contexts: p.contexts.map((c) => ({ ...c, rev: 0 })) })

  it('lets the loaded set win over a page with a higher rev in the same slot, and keeps the other slots', () => {
    const page = prefs({ contexts: [context(1, 5, { preset: 'general' }), context(2, 2, { preset: 'reading' })] })
    const loaded = prefs({ contexts: [context(1, 2, { preset: 'coding' }), context(3, 1)] })
    // the plain join throws the loaded set away
    expect((mergeBriefPrefs([page, loaded])?.contexts[0] as BriefContextV1).preset).toBe('general')
    const r = restoreBriefPrefs(page, loaded)
    expect(r.changed).toBe(true)
    expect(r.prefs.contexts.map((c) => [c.slot, (c as BriefContextV1).preset, c.rev])).toEqual([[1, 'coding', 6], [2, 'reading', 2], [3, 'general', 1]])
  })

  it('takes a loaded set as it is when the page has nothing in that slot, and treats no page settings as everything new', () => {
    const loaded = prefs({ contexts: [context(2, 4)], fit_log: [fit('01a1b2c3', 'quant/linear', '2026-10')] })
    const r = restoreBriefPrefs(undefined, loaded)
    expect(r.changed).toBe(true)
    expect(j(r.prefs)).toBe(j(mergeBriefPrefs([loaded])))
  })

  it('keeps the ceiling of revs', () => {
    const r = restoreBriefPrefs(prefs({ contexts: [context(1, 1_000_000)] }), prefs({ contexts: [context(1, 3, { preset: 'coding' })] }))
    expect(r.prefs.contexts[0]?.rev).toBeLessThanOrEqual(1_000_000)
    expect(tsOk(save(r.prefs))).toBe(true)
  })

  it('gives the loaded content in every loaded slot, whatever the two revs were (property)', () => {
    fc.assert(
      fc.property(arbBriefPrefs, arbBriefPrefs, (page, loaded) => {
        const r = restoreBriefPrefs(page, loaded)
        const want = mergeBriefPrefs([loaded]) as BriefPrefsV1
        for (const c of want.contexts) {
          const got = r.prefs.contexts.find((x) => x.slot === c.slot)
          expect(got, `slot ${c.slot}`).toBeDefined()
          expect(jcs({ ...got, rev: 0 })).toBe(jcs({ ...c, rev: 0 }))
        }
        // and the slots only the page had are still there, as they were
        const mine = mergeBriefPrefs([page]) as BriefPrefsV1
        for (const c of mine.contexts) if (!want.contexts.some((x) => x.slot === c.slot)) expect(jcs(r.prefs.contexts.find((x) => x.slot === c.slot))).toBe(jcs(c))
        expect(ajvOk(save(r.prefs)), JSON.stringify(ajvValidate.errors)).toBe(true)
      }),
      { numRuns: 500 },
    )
  })

  it('is idempotent: loading the same save again changes nothing, and says so', () => {
    fc.assert(
      fc.property(arbBriefPrefs, arbBriefPrefs, (page, loaded) => {
        const first = restoreBriefPrefs(page, loaded)
        const again = restoreBriefPrefs(first.prefs, loaded)
        expect(again.changed).toBe(false)
        expect(withoutRevs(again.prefs)).toBe(withoutRevs(first.prefs))
      }),
      { numRuns: 500 },
    )
  })

  it('says "unchanged" only when the join brings nothing new apart from edit counts', () => {
    const page = prefs({ contexts: [context(1, 7)], fit_log: [fit('01a1b2c3', 'quant/linear', '2026-10')] })
    expect(restoreBriefPrefs(page, prefs({ contexts: [context(1, 1)], fit_log: page.fit_log })).changed).toBe(false)
    expect(restoreBriefPrefs(page, prefs({ contexts: [context(1, 1, { mode: 'learn' })], fit_log: page.fit_log })).changed).toBe(true)
    expect(restoreBriefPrefs(page, prefs({ contexts: [context(1, 1)], fit_log: [...page.fit_log, fit('02a1b2c3', 'quant/linear', '2026-10')] })).changed).toBe(true)
    expect(restoreBriefPrefs(page, prefs({ contexts: [context(1, 1)], notes_as_of: '2027-02', fit_log: page.fit_log })).changed).toBe(true)
  })
})

describe('the schema admits no free text (R-17.12)', () => {
  /** Every place in a value where a string sits, as a path, for values and for object keys. */
  function stringSpots(v: unknown, path: (string | number)[] = [], out: { path: (string | number)[]; key: boolean }[] = []): typeof out {
    if (typeof v === 'string') out.push({ path, key: false })
    else if (Array.isArray(v)) v.forEach((x, i) => stringSpots(x, [...path, i], out))
    else if (typeof v === 'object' && v !== null) {
      for (const [k, x] of Object.entries(v)) {
        out.push({ path: [...path, k], key: true })
        stringSpots(x, [...path, k], out)
      }
    }
    return out
  }
  const at = (root: unknown, path: (string | number)[]): Record<string, unknown> => path.reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], root) as Record<string, unknown>
  const SENTENCES = ['I am not good at maths', 'my level is low', 'Explain it slowly, please.', 'a b', 'line one\nline two', ' ', 'x'.repeat(300)]

  it('rejects a sentence in every string position of valid settings, by the schema and by the validator', () => {
    let spots = 0
    fc.assert(
      fc.property(arbBriefPrefs.filter((p) => p.contexts.length > 0 || p.fit_log.length > 0), fc.nat(), fc.constantFrom(...SENTENCES), (p, pick, sentence) => {
        const doc = save(p)
        expect(ajvOk(doc)).toBe(true)
        const all = stringSpots(doc.brief_prefs, ['brief_prefs'].slice(1))
        const target = all[pick % all.length]
        fc.pre(target !== undefined)
        const d = clone(doc) as unknown as Record<string, unknown>
        const path = ['brief_prefs', ...(target as { path: (string | number)[] }).path]
        const last = path.at(-1) as string | number
        const parent = at(d, path.slice(0, -1))
        if ((target as { key: boolean }).key) {
          // rename the key to the sentence, keeping its value
          const value = parent[last as string]
          delete parent[last as string]
          parent[sentence] = value
        } else {
          parent[last as string] = sentence
        }
        spots++
        expect([JSON.stringify(path), ajvOk(d)]).toEqual([JSON.stringify(path), false])
        expect([JSON.stringify(path), tsOk(d)]).toEqual([JSON.stringify(path), false])
      }),
      { numRuns: 1500 },
    )
    expect(spots).toBeGreaterThan(500)
  })

  it('rejects a single word or snake_case text wherever the schema has a closed set, the destination included (a bare word is text too)', () => {
    const WORDS = ['dyslexia', 'Dyslexia', 'my_child_has_dyslexia', 'anxiety', 'other_person']
    const doc = save(
      prefs({
        contexts: [context(1, 1, { form: 'short', topics: { 'other/programming': 'skip' }, copied: { templates: '2026.11', month: '2026-11', lines: [{ id: 'DS', v: '1' }] } })],
        fit_log: [fit('01a1b2c3', 'quant/linear', '2026-10')],
        last_zones: { 'quant/linear': 'skip' },
      }),
    )
    expect(ajvOk(doc) && tsOk(doc)).toBe(true)
    const CLOSED: (string | number)[][] = [
      ['brief_prefs', 'contexts', 0, 'preset'],
      ['brief_prefs', 'contexts', 0, 'destination'],
      ['brief_prefs', 'contexts', 0, 'form'],
      ['brief_prefs', 'contexts', 0, 'tier'],
      ['brief_prefs', 'contexts', 0, 'mode'],
      ['brief_prefs', 'contexts', 0, 'length'],
      ['brief_prefs', 'contexts', 0, 'topics', 'other/programming'],
      ['brief_prefs', 'fit_log', 0, 'verdict'],
      ['brief_prefs', 'last_zones', 'quant/linear'],
    ]
    for (const path of CLOSED) {
      for (const word of WORDS) {
        const d = clone(doc) as unknown as Record<string, unknown>
        const parent = at(d, path.slice(0, -1))
        expect(path.at(-1) as string | number in parent, JSON.stringify(path)).toBe(true)
        parent[path.at(-1) as string] = word
        expect([JSON.stringify(path), word, ajvOk(d)]).toEqual([JSON.stringify(path), word, false])
        expect([JSON.stringify(path), word, tsOk(d)]).toEqual([JSON.stringify(path), word, false])
      }
    }
    // every destination the app has is accepted, and only those
    for (const destination of BRIEF_DESTINATIONS) {
      const d = clone(doc)
      ;(d.brief_prefs?.contexts[0] as BriefContextV1).destination = destination
      expect(ajvOk(d) && tsOk(d), destination).toBe(true)
    }
  })

  it('has for every text field of brief_prefs an enum, a const or a pattern that no sentence can match', () => {
    const defs = schema.$defs as Record<string, Record<string, unknown>>
    const resolve = (n: Record<string, unknown>): Record<string, unknown> => (typeof n.$ref === 'string' ? (defs[n.$ref.split('/').pop() as string] as Record<string, unknown>) : n)
    const spots: string[] = []
    const patternOnly = new Set<string>()
    const visit = (node: unknown, path: string): void => {
      if (typeof node !== 'object' || node === null) return
      const n = resolve(node as Record<string, unknown>)
      if (n.type === 'string') {
        spots.push(path)
        if (n.enum === undefined && n.const === undefined) {
          expect(typeof n.pattern, `${path} needs a pattern`).toBe('string')
          patternOnly.add(n.pattern as string)
          const re = new RegExp(n.pattern as string, 'u')
          for (const s of SENTENCES) expect(re.test(s), `${path} accepts ${JSON.stringify(s)}`).toBe(false)
          expect(re.test('Hello world'), path).toBe(false)
        }
      }
      // the keys of a map are strings too
      if (typeof n.propertyNames === 'object' && n.propertyNames !== null) visit({ type: 'string', ...resolve(n.propertyNames as Record<string, unknown>) }, `${path}/propertyNames`)
      for (const [k, x] of Object.entries(n)) if (k !== 'propertyNames' && k !== 'description') visit(x, `${path}/${k}`)
    }
    for (const name of ['brief_copied', 'brief_context', 'brief_context_removed', 'brief_fit', 'brief_prefs']) visit(defs[name], name)
    expect(spots.length).toBeGreaterThan(20)
    // What is left without a closed set is ids of fixed vocabularies, months and versions, and no other pattern: a new
    // free-form pattern must be added here on purpose. Only two of them accept a bare word (a template id and a tick key,
    // 16 characters at most); the app writes only known ones (the builder's own) and drops unknown ones on load (stored.test.ts).
    const p = (name: string): string => (defs[name] as { pattern: string }).pattern
    const prop = (def: string, ...keys: string[]): string => {
      const node = keys.reduce<Record<string, unknown>>((o, k) => (o.properties as Record<string, Record<string, unknown>>)[k] as Record<string, unknown>, defs[def] as Record<string, unknown>)
      return node.pattern as string
    }
    const wordAccepting = [...patternOnly].filter((pat) => new RegExp(pat, 'u').test('dyslexia'))
    expect(new Set(patternOnly)).toEqual(
      new Set([
        p('brief_month'),
        p('brief_topic_id'),
        p('brief_template_id'),
        p('brief_line_key'),
        prop('brief_fit', 'id'),
        prop('brief_copied', 'templates'),
        prop('brief_prefs', 'topics'),
        prop('brief_prefs', 'groups'),
        '^[0-9]{1,4}$', // the wording version of a copied line
      ]),
    )
    expect(new Set(wordAccepting)).toEqual(new Set([p('brief_template_id'), p('brief_line_key')]))
    for (const pat of wordAccepting) expect(new RegExp(pat, 'u').test('a'.repeat(17)), pat).toBe(false)
    // ... and a file cannot add a field of its own to carry text: additionalProperties is false everywhere
    for (const name of ['brief_copied', 'brief_context', 'brief_context_removed', 'brief_fit', 'brief_prefs']) expect(defs[name]?.additionalProperties, name).toBe(false)
    expect((defs.brief_copied?.properties as Record<string, { items: { additionalProperties: boolean } }>).lines!.items.additionalProperties).toBe(false)
  })

  it('writes only from the closed sets of the app: the schema enums are the lists in brief-prefs.ts', () => {
    const defs = schema.$defs as Record<string, { properties?: Record<string, { enum?: string[] }>; enum?: string[] }>
    const ctxProps = defs.brief_context?.properties ?? {}
    expect(ctxProps.preset?.enum).toEqual([...BRIEF_PRESETS])
    expect(ctxProps.mode?.enum).toEqual([...BRIEF_MODES])
    expect(ctxProps.length?.enum).toEqual([...BRIEF_LENGTHS])
    expect(ctxProps.tier?.enum).toEqual([...BRIEF_TIERS])
    expect(ctxProps.form?.enum).toEqual([...BRIEF_FORMS])
    // the destinations are the ones the builder offers (surfaces.json): a destination added there needs the schema (a minor bump) too
    expect(ctxProps.destination?.enum).toEqual([...BRIEF_DESTINATIONS])
    expect([...BRIEF_DESTINATIONS].sort()).toEqual(surfaces.destinations.map((d) => d.id).sort())
    expect(defs.brief_topic_setting?.enum).toEqual([...BRIEF_SETTINGS])
    expect(defs.brief_fit?.properties?.verdict?.enum).toEqual([...BRIEF_VERDICTS])
  })
})

describe('a prefs-only save', () => {
  it('validates with no sessions and no seen ids, under ajv and the validator, and survives the normal form', () => {
    fc.assert(
      fc.property(arbBriefPrefs, (p) => {
        const s = save(p)
        expect(s.sessions).toEqual([])
        expect(ajvOk(s), JSON.stringify(ajvValidate.errors)).toBe(true)
        expect(tsOk(s)).toBe(true)
        const n = normalizeSave(s, ctx)
        expect(n.sessions).toEqual([])
        expect(ajvOk(n)).toBe(true)
        expect(j(n.brief_prefs)).toBe(j(mergeBriefPrefs([p])))
      }),
      RUNS,
    )
  })

  it('travels with a session: saveWithSession carries the settings of the save it started from, and a merge keeps them', () => {
    const p = prefs({ contexts: [context(1, 2)], fit_log: [fit('01a1b2c3', 'quant/linear', '2026-10')] })
    const state = {
      sessionId: 's_0000000a',
      startedMs: Date.UTC(2026, 9, 5),
      durationS: 12,
      device: { class: 'desktop', input: 'mouse', os_family: 'macOS', browser_family: 'Safari', refresh_hz_est: 120, timer_res_ms: 0.1, viewport: [1512, 861] } as const,
      flags: {},
      responses: [],
      seenItems: [],
      seenFamilies: [],
    }
    const withSession = saveWithSession(save(p), state as never, { ctx, createdMs: Date.UTC(2026, 9, 5) })
    expect(j(withSession.brief_prefs)).toBe(j(mergeBriefPrefs([p])))
    expect(withSession.sessions).toHaveLength(1)
    expect(saveWithSession(null, state as never, { ctx, createdMs: Date.UTC(2026, 9, 5), anonId: 'hb_7Q3m9Kx2Vw5rT8pL' }).brief_prefs).toBeUndefined()
    // and editing the settings later merges cleanly with the session save
    const edited = save(prefs({ contexts: [context(1, 3, { mode: 'learn' })] }))
    const merged = mergeAll([withSession, edited], ctx)
    expect(merged.sessions).toHaveLength(1)
    expect((merged.brief_prefs?.contexts[0] as BriefContextV1).mode).toBe('learn')
  })

  it('withoutBriefPrefs drops only the settings', () => {
    const p = prefs({ contexts: [context(1, 1)] })
    const s = save(p)
    const stripped = withoutBriefPrefs(s)
    expect('brief_prefs' in stripped).toBe(false)
    expect(stripped.anon_id).toBe(s.anon_id)
    expect(s.brief_prefs).toBeDefined()
    expect(tsOk(stripped)).toBe(true)
  })
})

describe('scoring isolation (R-17.12: the fit log and the settings never enter scoring)', () => {
  type AnyItem = ItemInstance<object, object>
  /** A response tuple for an MC item, answered right or wrong. */
  const answer = (item: AnyItem, right: boolean): ResponseTuple => {
    const k = item.options_count ?? 4
    const idx = (item.key as { index: number }).index
    return [item.item_id, 0, right ? idx : (idx + 1) % k, right ? 1 : 0, 30_000, null]
  }
  /** Sessions whose items the registry regenerates, so re-scoring really scores them. */
  const arbScorableSessions = fc
    .array(fc.array(fc.record({ seed: fc.stringMatching(/^[a-z0-9]{3,8}$/u), matrix: fc.boolean(), right: fc.boolean() }), { minLength: 1, maxLength: 6 }), { minLength: 1, maxLength: 3 })
    .map((sessions): SaveSession[] =>
      sessions.map((items, i) => ({
        session_id: `s_0000000${i + 1}`,
        started_utc: `2026-10-0${i + 1}T10:00:00Z`,
        duration_s: 1800,
        device: { class: 'desktop', input: 'keyboard', os_family: 'macOS', browser_family: 'Safari', refresh_hz_est: 120, timer_res_ms: 1, viewport: [1512, 861] },
        flags: {},
        responses: items.map((x) => answer((x.matrix ? matrices : rotation).generate(x.seed) as AnyItem, x.right)),
      })),
    )

  it('rescoreSessions is byte-identical with or without brief_prefs, on saves whose responses are really scored (n_scored > 0 in every run)', () => {
    let scoredRuns = 0
    fc.assert(
      fc.property(arbScorableSessions, arbBriefPrefs, (sessions, p) => {
        const withPrefs = normalizeSave(save(p, { sessions }), ctx)
        const without = withoutBriefPrefs(withPrefs) as SaveFileV1
        expect(withPrefs.brief_prefs).toBeDefined()
        const a = rescoreSessions(withPrefs)
        // a run that scores nothing would compare two prior-only results and prove nothing
        expect(a.n_scored).toBeGreaterThan(0)
        scoredRuns++
        expect(JSON.stringify(a)).toBe(JSON.stringify(rescoreSessions(without)))
        // the fit log alone, and the settings alone, change nothing either
        expect(JSON.stringify(rescoreSessions(normalizeSave(save({ ...p, fit_log: [] }, { sessions }), ctx)))).toBe(JSON.stringify(a))
      }),
      { numRuns: 60 },
    )
    expect(scoredRuns).toBe(60)
  })

  it('does not read the settings at all: rescore.ts names neither brief_prefs nor the fit log', () => {
    const src = import.meta.glob<string>('./rescore.ts', { query: '?raw', import: 'default', eager: true })['./rescore.ts'] ?? ''
    expect(src.length).toBeGreaterThan(1000)
    expect(src).not.toMatch(/brief_prefs|fit_log|briefPrefs|BriefPrefs/)
  })
})
