/**
 * The topic taxonomy and its alias map (ROADMAP A23, AI.3; proposal §5.1–§5.2; DESIGN R-17.3,
 * R-17.4). The bank runs the same checks in `tests/test_topics.py` on its own copy of the files
 * (byte-identical, ROADMAP A17: `scripts/sync-topics.test.ts`).
 *
 * - the committed `topics-v1.json` and `topics-aliases.json` are valid;
 * - labels are digit-free, ASCII, content words only: no school-level word and nothing that names
 *   a general ability, reading, memory, speed or a language background (a deny-list test, with
 *   pinned samples so the lists in the file cannot be emptied unnoticed);
 * - prefix consistency (a topic sits under its item's axis and facet), as a property test;
 * - alias resolution: every ID ever released resolves to live IDs directly or through the alias
 *   map, as a property test over random retirement histories.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { QUANT_GROUPS } from './quant/topics'
import rawAliases from './topics-aliases.json'
import rawTaxonomy from './topics-v1.json'
import {
  DENIED_CATEGORIES,
  DENIED_WORDS,
  GROUP_VERSION,
  ID_PATTERNS,
  RELEASED_IDS,
  TOPIC_ALIASES,
  TOPIC_AXES,
  TOPIC_IDS,
  TOPIC_NODES,
  TOPICS_VERSION,
  aliasesProblems,
  anyTopicId,
  deniedWordHits,
  facetsOf,
  isTopicId,
  nodesOfKind,
  resolveTopic,
  resolveTopicId,
  taxonomyProblems,
  topicLabel,
  topicNode,
  topicPrefixProblem,
  topicsOfFacet,
  type TopicNode,
} from './topics'

type Raw = { nodes: Record<string, unknown>[]; denied_words: Record<string, string[]>; [k: string]: unknown }
const RAW = rawTaxonomy as unknown as Raw
const RAW_ALIASES = rawAliases as unknown as { released: string[]; aliases: Record<string, string[]>; [k: string]: unknown }

/** A deep copy of the taxonomy file with `edit` applied. */
function mutated(edit: (r: Raw) => void): Raw {
  const r = structuredClone(RAW)
  edit(r)
  return r
}
const nodeIndex = (id: string): number => RAW.nodes.findIndex((n) => n.id === id)
const TOPICS = TOPIC_NODES.filter((n) => n.kind === 'topic')
const DENIED_ENTRIES = Object.entries(DENIED_WORDS).flatMap(([c, ws]) => ws.map((w) => [c, w] as const))

describe('the committed files', () => {
  it('the taxonomy is valid', () => {
    expect(taxonomyProblems(RAW)).toEqual([])
    expect(TOPICS_VERSION).toBe('topics-v1')
    expect(GROUP_VERSION).toBe('g1')
    expect(RAW.topics_version).toBe(TOPICS_VERSION)
    expect(RAW.group_version).toBe(GROUP_VERSION)
    expect(Object.keys(DENIED_WORDS).sort()).toEqual([...DENIED_CATEGORIES].sort())
  })

  it('the alias file is valid and lists every live ID', () => {
    expect(aliasesProblems(RAW_ALIASES, TOPIC_IDS)).toEqual([])
    expect(new Set(RELEASED_IDS)).toEqual(new Set(TOPIC_IDS))
    expect(TOPIC_ALIASES).toEqual({}) // nothing has been retired yet
  })

  it('exports every node of the file, in file order, with derived parents', () => {
    expect(TOPIC_NODES.map((n) => n.id)).toEqual(RAW.nodes.map((n) => n.id))
    expect(TOPIC_IDS.size).toBe(RAW.nodes.length)
    for (const n of TOPIC_NODES) {
      expect(topicNode(n.id)).toBe(n)
      expect(isTopicId(n.id)).toBe(true)
      expect(topicLabel(n.id)).toBe(n.label)
      expect(n.parent).toBe(n.kind === 'topic' ? `${n.axis?.toLowerCase()}/${n.facet}` : null)
    }
    expect(isTopicId('kst/chemistry/nope')).toBe(false)
    expect(isTopicId(3)).toBe(false)
    expect(topicNode('nope')).toBeUndefined()
    expect(topicLabel('nope')).toBeUndefined()
  })

  it('has the kinds the proposal names', () => {
    expect(nodesOfKind('group').map((n) => n.id)).toEqual(QUANT_GROUPS.map((g) => g.id))
    for (const axis of TOPIC_AXES) {
      const facets = facetsOf(axis)
      expect(facets.length, axis).toBeGreaterThan(0)
      for (const f of facets) {
        expect(f.id.startsWith(`${axis.toLowerCase()}/`)).toBe(true)
        expect(topicsOfFacet(f.id).length, f.id).toBeGreaterThan(0)
      }
    }
    expect(nodesOfKind('other').length).toBeGreaterThanOrEqual(10)
    for (const wanted of ['statistics', 'programming', 'units_and_rates']) expect(TOPIC_IDS.has(`other/${wanted}`)).toBe(true) // proposal §5.2
    expect(topicNode('kst/chemistry/equilibrium')?.kind).toBe('topic') // the proposal's example
    expect(topicNode('khu/history/historiography')?.kind).toBe('topic')
  })

  it('the knowledge facets are the subject lists of DESIGN §3 (ROADMAP A7)', () => {
    const names = (axis: 'KST' | 'KHU' | 'KAP'): string[] => facetsOf(axis).map((f) => f.id.split('/')[1] as string).sort()
    expect(names('KST')).toEqual(['biology', 'chemistry', 'computing', 'earth_space', 'math_facts', 'physics'])
    expect(names('KHU')).toEqual(['civics', 'geography', 'history', 'literature', 'philosophy', 'religion'])
    expect(names('KAP')).toEqual(['everyday_law', 'film', 'health_info', 'home_mechanical', 'music', 'personal_finance', 'visual_arts'])
  })

  it('a measured subject is not repeated under other/', () => {
    const measured = new Set(TOPIC_NODES.filter((n) => n.kind !== 'other').map((n) => n.label.toLowerCase()))
    expect(nodesOfKind('other').filter((n) => measured.has(n.label.toLowerCase()))).toEqual([])
  })

  it('every ID and label is ASCII and digit-free', () => {
    for (const n of TOPIC_NODES) {
      expect(n.id).toMatch(/^[a-z_/]+$/)
      expect(n.label).toMatch(/^[A-Za-z, ]+$/)
      expect(n.id + n.label).not.toMatch(/\d/)
      expect(anyTopicId(n.id)).toBe(true)
      expect(ID_PATTERNS[n.kind].test(n.id)).toBe(true)
    }
  })

  it('every label and ID is free of denied and school-level words', () => {
    for (const n of TOPIC_NODES) {
      expect(deniedWordHits(n.label, DENIED_WORDS), n.label).toEqual([])
      expect(deniedWordHits(n.id, DENIED_WORDS), n.id).toEqual([])
    }
  })
})

describe('the deny-list (R-17.3)', () => {
  const MUST_CATCH: Record<string, string[]> = {
    general_ability: ['General intelligence', 'Cognitive ability', 'Aptitude', 'Reasoning', 'Being smart', 'Attention'],
    reading: ['Reading comprehension', 'Vocabulary', 'Literacy', 'Verbal skills', 'Reader'],
    memory: ['Working memory', 'Recall', 'Digit span', 'Memorization', 'Mnemonics'],
    speed: ['Processing speed', 'Reaction time', 'Fast thinking', 'Quick answers', 'Timing'],
    language_background: ['Native English speaker', 'First language', 'Bilingual', 'English fluency', 'Mother tongue', 'Second language', 'Fluent speakers'],
    school_level: [
      'High school algebra',
      'Grade',
      'Beginner statistics',
      'Advanced physics',
      'College chemistry',
      'Introductory logic',
      'Middle school science',
      'Basics of finance',
      'University maths',
      'Expert level',
    ],
  }

  it('pins samples for every category', () => {
    expect(Object.keys(MUST_CATCH).sort()).toEqual([...DENIED_CATEGORIES].sort())
  })

  it.each(Object.entries(MUST_CATCH).flatMap(([category, samples]) => samples.map((s) => [category, s] as const)))('%s catches "%s"', (category, sample) => {
    expect(deniedWordHits(sample, DENIED_WORDS).map(([c]) => c)).toContain(category)
  })

  it.each(['Spreadsheets', 'Motion and forces', 'The human body', 'Ethics', 'Cells and their parts'])('is whole-word, not substring: "%s" is clean', (text) => {
    // "read" and "ell" are denied words; "spreadsheets" and "cells" are not hits
    expect(deniedWordHits(text, DENIED_WORDS)).toEqual([])
  })

  it('reports a denied word added to any label', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: RAW.nodes.length - 1 }), fc.constantFrom(...DENIED_ENTRIES), (i, [category, word]) => {
        const raw = mutated((r) => {
          r.nodes[i]!.label = `${String(r.nodes[i]!.label)} ${word}`
        })
        return taxonomyProblems(raw).some((p) => p.includes(`denied ${category} word '${word}'`))
      }),
    )
  })

  it('reports a digit inserted anywhere in any label', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: RAW.nodes.length - 1 }), fc.constantFrom(...'0123456789'), fc.nat(80), (i, digit, position) => {
        const raw = mutated((r) => {
          const label = String(r.nodes[i]!.label)
          const at = position % (label.length + 1)
          r.nodes[i]!.label = label.slice(0, at) + digit + label.slice(at)
        })
        return taxonomyProblems(raw).some((p) => p.includes(': label '))
      }),
    )
  })

  it.each(['lowercase start', 'Has-hyphen', 'Has: colon', 'Has # hash', 'Trailing space ', 'Ünïcode', 'Two  spaces', '', 'A'.repeat(61), 'example.com', 'See a/b'])(
    'rejects the label shape "%s"',
    (label) => {
      // nothing that could carry a digit, a URL, markup or a non-ASCII character into a notes line
      const raw = mutated((r) => {
        r.nodes[nodeIndex('other/statistics')]!.label = label
      })
      expect(taxonomyProblems(raw).some((p) => p.includes('other/statistics: label'))).toBe(true)
    },
  )

  it('reports a denied word in an ID', () => {
    const raw = mutated((r) => {
      r.nodes[nodeIndex('other/statistics')]!.id = 'other/reading_list'
    })
    expect(taxonomyProblems(raw)).toContain("other/reading_list: ID uses the denied reading word 'reading'")
  })

  it('reports an emptied, dropped, extra or mis-cased list', () => {
    expect(taxonomyProblems(mutated((r) => void (r.denied_words.memory = []))).length).toBeGreaterThan(0)
    expect(taxonomyProblems(mutated((r) => void delete r.denied_words.speed)).length).toBeGreaterThan(0)
    expect(taxonomyProblems(mutated((r) => void (r.denied_words.extra = ['word']))).length).toBeGreaterThan(0)
    expect(taxonomyProblems(mutated((r) => void (r.denied_words.memory = ['Memory']))).length).toBeGreaterThan(0)
  })
})

describe('structure', () => {
  const EDITS: Record<string, (r: Raw) => void> = {
    'a duplicate node': (r) => void r.nodes.push(structuredClone(r.nodes.at(-1) as Record<string, unknown>)),
    'a topic without its facet': (r) => void r.nodes.splice(nodeIndex('kst/chemistry'), 1),
    'a wrong facet field': (r) => void (r.nodes[nodeIndex('kst/chemistry/equilibrium')]!.facet = 'physics'),
    'a wrong axis': (r) => void (r.nodes[nodeIndex('kst/chemistry')]!.axis = 'KHU'),
    'an extra key': (r) => void (r.nodes[nodeIndex('other/statistics')]!.level = 'hs'),
    'a label repeated in another case': (r) => void (r.nodes[nodeIndex('other/economics')]!.label = 'STATISTICS'),
    'changed group templates': (r) => void (r.nodes[nodeIndex('quant/linear')]!.templates = ['linear_eq']),
    'a changed group label': (r) => void (r.nodes[nodeIndex('quant/linear')]!.label = 'Linear things'),
    'a dropped group': (r) => void r.nodes.splice(nodeIndex('quant/linear'), 1),
    'swapped groups': (r) => {
      const a = nodeIndex('quant/linear')
      const b = nodeIndex('quant/powers_quadratics')
      ;[r.nodes[a], r.nodes[b]] = [r.nodes[b] as Record<string, unknown>, r.nodes[a] as Record<string, unknown>]
    },
    'an unknown kind': (r) => void (r.nodes[nodeIndex('other/statistics')]!.kind = 'leaf'),
    'a wrong topics_version': (r) => void (r.topics_version = 'topics-v2'),
    'a wrong group_version': (r) => void (r.group_version = 'g2'),
    'no other/ topics': (r) => void (r.nodes = r.nodes.filter((n) => n.kind !== 'other')),
    'a three-segment other ID': (r) => void (r.nodes[nodeIndex('other/statistics')]!.id = 'other/statistics/extra'),
  }

  it.each(Object.keys(EDITS))('reports %s', (name) => {
    expect(taxonomyProblems(mutated(EDITS[name] as (r: Raw) => void)).length).toBeGreaterThan(0)
  })

  it.each([null, [], 'x', 3, {}, { nodes: 3 }, { nodes: [] }])('reports garbage %j without throwing', (raw) => {
    expect(taxonomyProblems(raw).length).toBeGreaterThan(0)
  })

  it('never throws on arbitrary JSON', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(taxonomyProblems(value).length).toBeGreaterThan(0)
        expect(aliasesProblems(value, TOPIC_IDS).length).toBeGreaterThan(0)
      }),
    )
  })

  it('has the ID grammar of the proposal', () => {
    const good = ['quant/linear', 'kst/chemistry', 'kst/chemistry/equilibrium', 'other/units_and_rates']
    const bad = ['', 'quant', 'quant/', 'quant/a/b', 'kst/a/b/c', 'xyz/a', 'other/a/b', 'KST/a', 'kst/A', 'kst/a_', 'kst/_a', 'kst/a__b', 'kst/a1', 'kst/a-b', 'kst/a b', '/kst/a']
    for (const x of good) expect(anyTopicId(x), x).toBe(true)
    for (const x of bad) expect(anyTopicId(x), x).toBe(false)
    expect(anyTopicId(null)).toBe(false)
    expect(anyTopicId(3)).toBe(false)
  })
})

describe('prefix consistency (a topic sits under its item’s axis and facet)', () => {
  const facetNames = [...new Set(TOPIC_NODES.filter((n) => n.kind === 'facet').map((n) => n.id.split('/')[1] as string))]
  const topicArb = fc.constantFrom(...TOPICS)

  it('every topic is consistent with its own axis and facet', () => {
    fc.assert(
      fc.property(topicArb, (node: TopicNode) => {
        expect(topicPrefixProblem(node.id, node.axis as string, node.facet as string)).toBeNull()
        expect(node.id.startsWith(`${node.axis?.toLowerCase()}/${node.facet}/`)).toBe(true)
        expect(topicNode(node.parent as string)?.kind).toBe('facet')
      }),
    )
  })

  it('a topic under another facet is rejected, and only then', () => {
    fc.assert(
      fc.property(topicArb, fc.constantFrom(...facetNames), (node, facet) => {
        expect(topicPrefixProblem(node.id, node.axis as string, facet) === null).toBe(facet === node.facet)
      }),
    )
  })

  it('a topic on another axis is rejected, and only then', () => {
    fc.assert(
      fc.property(topicArb, fc.constantFrom(...TOPIC_AXES), (node, axis) => {
        expect(topicPrefixProblem(node.id, axis, node.facet as string) === null).toBe(axis === node.axis)
      }),
    )
  })

  it.each([
    ['kst/chemistry', 'KST', 'chemistry'], // a facet is not a topic tag
    ['quant/linear', 'QR', 'linear_eq'], // QR has groups, not tags
    ['quant/linear', 'KST', 'linear_eq'],
    ['other/statistics', 'KST', 'statistics'],
    ['kst/chemistry/nope', 'KST', 'chemistry'], // not in the taxonomy
    ['', 'KST', 'chemistry'],
    ['kst/chemistry/equilibrium', 'QR', 'chemistry'],
    ['kst/chemistry/equilibrium', 'MAT', 'chemistry'],
  ])('rejects %j on axis %s with facet %s', (topic, axis, facet) => {
    expect(topicPrefixProblem(topic, axis, facet)).not.toBeNull()
  })

  it('does not accept a retired ID as a tag until it is retagged', () => {
    expect(topicPrefixProblem('kst/chemistry/retired', 'KST', 'chemistry')).toContain('alias')
  })
})

describe('alias resolution', () => {
  type History = { ids: string[]; live: Set<string>; aliases: Record<string, string[]> }

  /**
   * A random retirement history: IDs in release order; the last k are live; every retired ID maps
   * to a non-empty subset of the IDs after it (so no cycle, and every chain ends live).
   */
  const historyArb: fc.Arbitrary<History> = fc
    .uniqueArray(fc.stringMatching(/^[a-h]{1,5}$/), { minLength: 2, maxLength: 10 })
    .chain((names) => {
      const ids = names.map((n) => `other/${n}`)
      return fc.integer({ min: 1, max: ids.length }).chain((nLive) => {
        const retired = ids.slice(0, ids.length - nLive)
        const picks = retired.map((_, i) => fc.uniqueArray(fc.constantFrom(...ids.slice(i + 1)), { minLength: 1, maxLength: 3 }))
        return fc.tuple(...picks).map((subsets) => ({
          ids,
          live: new Set(ids.slice(ids.length - nLive)),
          aliases: Object.fromEntries(retired.map((id, i) => [id, subsets[i] as string[]])),
        }))
      })
    })

  const file = (ids: string[], aliases: Record<string, string[]>): unknown => ({ about: 'x', topics_version: TOPICS_VERSION, released: [...ids].sort(), aliases })

  it('resolves every released ID directly or through the alias map', () => {
    fc.assert(
      fc.property(historyArb, ({ ids, live, aliases }) => {
        expect(aliasesProblems(file(ids, aliases), live)).toEqual([])
        for (const x of ids) {
          const got = resolveTopic(x, live, aliases)
          expect(got.length, x).toBeGreaterThan(0)
          expect(got.every((y) => live.has(y))).toBe(true)
          expect(got).toEqual([...got].sort())
          if (live.has(x)) expect(got).toEqual([x])
          else {
            // a split ID stands for all its successors
            const expected = new Set((aliases[x] as string[]).flatMap((s) => resolveTopic(s, live, aliases)))
            expect(new Set(got)).toEqual(expected)
          }
          for (const y of got) expect(resolveTopic(y, live, aliases)).toEqual([y]) // idempotent
        }
      }),
    )
  })

  it('resolves an ID that was never released to nothing', () => {
    fc.assert(fc.property(historyArb, fc.stringMatching(/^[xyz]{1,4}$/), ({ live, aliases }, name) => resolveTopic(`other/${name}`, live, aliases).length === 0))
  })

  it('reports a forgotten alias or a forgotten release', () => {
    fc.assert(
      fc.property(historyArb, ({ ids, live, aliases }) => {
        const retired = ids.filter((x) => !live.has(x))
        if (retired.length > 0) {
          const fewer = Object.fromEntries(Object.entries(aliases).filter(([k]) => k !== retired[0]))
          expect(aliasesProblems(file(ids, fewer), live).some((p) => p.includes('has no alias'))).toBe(true)
        }
        const unreleased = [...live].sort()[0] as string
        const rest = ids.filter((x) => x !== unreleased)
        const kept = Object.fromEntries(Object.entries(aliases).filter(([k]) => rest.includes(k)))
        expect(aliasesProblems(file(rest, kept), live).some((p) => p.includes('missing from released'))).toBe(true)
      }),
    )
  })

  it('reports the mistakes an alias file can make', () => {
    const live = new Set(['other/a', 'other/b'])
    const ok = { about: 'x', topics_version: TOPICS_VERSION, released: ['other/a', 'other/b', 'other/old'], aliases: { 'other/old': ['other/a', 'other/b'] } }
    expect(aliasesProblems(ok, live)).toEqual([])
    const cases: Record<string, (r: typeof ok & Record<string, unknown>) => void> = {
      loop: (r) => {
        r.released = ['other/a', 'other/b', 'other/old', 'other/old2']
        r.aliases = { 'other/old': ['other/old2'], 'other/old2': ['other/old'] } as never
      },
      'neither live nor an alias': (r) => void (r.aliases = { 'other/old': ['other/zzz'] } as never),
      'live ID': (r) => void ((r.aliases as Record<string, string[]>)['other/a'] = ['other/b']),
      'not in released': (r) => void ((r.aliases as Record<string, string[]>)['other/ghost'] = ['other/a']),
      'non-empty': (r) => void (r.aliases = { 'other/old': [] } as never),
      itself: (r) => void (r.aliases = { 'other/old': ['other/old'] } as never),
      sorted: (r) => void r.released.reverse(),
      'not a valid topic ID': (r) => void (r.released = ['Bad-ID', ...r.released]),
      topics_version: (r) => void (r.topics_version = 'topics-v9'),
      'top-level keys': (r) => void (r.extra = 1),
    }
    for (const [expected, edit] of Object.entries(cases)) {
      const raw = structuredClone(ok) as typeof ok & Record<string, unknown>
      edit(raw)
      expect(aliasesProblems(raw, live).some((p) => p.includes(expected)), expected).toBe(true)
    }
    expect(aliasesProblems({ released: [] }, live).length).toBeGreaterThan(0)
    expect(aliasesProblems([], live).length).toBeGreaterThan(0)
  })

  it('terminates on a cycle and resolves a dead end to nothing', () => {
    const aliases = { 'other/x': ['other/y'], 'other/y': ['other/x'], 'other/z': ['other/missing'] }
    const live = new Set(['other/live'])
    expect(resolveTopic('other/x', live, aliases)).toEqual([])
    expect(resolveTopic('other/z', live, aliases)).toEqual([])
    expect(resolveTopic('other/live', live, aliases)).toEqual(['other/live'])
    expect(resolveTopic('constructor', live, aliases)).toEqual([]) // prototype keys are not aliases
  })

  it('resolves a retired, split topic to its successors (a scenario: nothing is retired yet)', () => {
    const live = new Set([...TOPIC_IDS].filter((x) => x !== 'kst/chemistry/equilibrium'))
    live.add('kst/chemistry/equilibrium_constants')
    live.add('kst/chemistry/equilibrium_shifts')
    const aliases = { 'kst/chemistry/equilibrium': ['kst/chemistry/equilibrium_constants', 'kst/chemistry/equilibrium_shifts'] }
    const released = [...new Set([...RELEASED_IDS, ...live])].sort()
    expect(aliasesProblems({ about: 'x', topics_version: TOPICS_VERSION, released, aliases }, live)).toEqual([])
    expect(resolveTopic('kst/chemistry/equilibrium', live, aliases)).toEqual(['kst/chemistry/equilibrium_constants', 'kst/chemistry/equilibrium_shifts'])
    expect(resolveTopic('kst/physics/waves_light', live, aliases)).toEqual(['kst/physics/waves_light'])
  })

  it('resolves every ID ever released under the committed files', () => {
    for (const x of RELEASED_IDS) {
      const got = resolveTopicId(x)
      expect(got.length, x).toBeGreaterThan(0)
      expect(got.every((y) => TOPIC_IDS.has(y))).toBe(true)
    }
    expect(resolveTopicId('kst/chemistry/never_existed')).toEqual([])
  })
})
