/**
 * The generator (proposal §3-§4; §7.2 V0 invariants, all non-zone ones): worked profiles against
 * golden text, the floor rule, tiers, merges, the length rule, and fast-check properties over
 * random settings: 0 lint violations, ASCII, within the limit, deterministic, locked lines first.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { compose, buildBrief, NOTICE_TEXT } from './build'
import { PRESET_INFO } from './contexts'
import { DEFAULT_GATES, FLOOR_GATE, type GateFile } from './gates'
import { TEMPLATE_BY_ID, wording } from './grammar'
import { lintNotes } from './lint'
import { defaultPrefs, type ContextPrefs } from './prefs'
import { PROFILES, PROFILE_A, PROFILE_B_LONG, PROFILE_B_SHORT, PROFILE_C, type Profile } from './profiles'
import { parseText } from './parse'
import { renderJson } from './render'
import { arbExtras, arbForm, arbMonth, arbPrefs } from './testing'
import { FORM_LIMITS, type Form } from './types'

const FIXTURES = import.meta.glob<string>('./__fixtures__/**/*', { query: '?raw', import: 'default', eager: true })
const fixture = (path: string): string => {
  const text = FIXTURES[`./__fixtures__/${path}`]
  if (text === undefined) throw new Error(`missing fixture ${path}`)
  return text
}
const golden = (name: string, ext: string): string => fixture(`golden/${name}.${ext}`)
const proposal = (name: string): string => fixture(`proposal/${name}`)
const build = (p: Profile) => buildBrief({ prefs: p.prefs, extras: p.extras, form: p.form, asOf: p.asOf })
const ids = (r: ReturnType<typeof buildBrief>): string[] => r.brief.lines.map((l) => l.id)
const gatesWith = (over: Record<string, { v: string; status: 'shipped' | 'experimental' | 'blocked' }>): GateFile => ({ ...DEFAULT_GATES, lines: { ...DEFAULT_GATES.lines, ...over } })

describe('worked profiles (proposal §4.9) match their golden text', () => {
  for (const p of PROFILES) {
    it(p.name, () => {
      const r = build(p)
      expect(r.text).toBe(golden(p.name, p.form === 'short' ? 'txt' : 'md'))
      expect(renderJson(r.brief)).toBe(golden(p.name, 'json'))
      expect(r.fits).toBe(true)
    })
  }

  it('reads every bullet of the proposal\'s own Profile A skill as a template line', () => {
    const p = parseText(proposal('A-skill.md'))
    expect(p.form).toBe('skill')
    expect(p.problems).toEqual([])
    expect(p.foreign).toEqual([])
    expect(p.lines.map((l) => l.id)).toEqual(['H', 'F1', 'F2', 'F3', 'F4', 'CC', 'U1c', 'LEN.short', 'U4', 'U6c', 'DS', 'DA', 'AC1', 'K1'])
    expect(p.lines.find((l) => l.id === 'DS')?.topics).toEqual(['other/programming', 'other/statistics'])
  })

  it('reads every bullet of the proposal\'s Profile B short notes as a template line', () => {
    const p = parseText(proposal('B-short.txt'))
    expect(p.form).toBe('short')
    expect(p.foreign).toEqual([])
    expect(p.lines.map((l) => l.id)).toEqual(['H', 'F1', 'F2', 'F3', 'F4', 'U1', 'U2.W3', 'U5', 'U4', 'DB', 'K1L', 'I1', 'LANG'])
    expect(p.lines.find((l) => l.id === 'I1')?.interests).toEqual(['cooking', 'football'])
  })

  it('reads Profile B\'s long notes except the two lines the taxonomy relabelled or merged', () => {
    const p = parseText(proposal('B-long.md'))
    // "Fractions and percentages" is now "Arithmetic, fractions and percentages", and the worked-example
    // sentence is its own bullet here. Those two read as the person's own (custom) lines; the rest is grammar.
    expect(p.foreign).toEqual([])
    expect(p.lines.filter((l) => l.custom === true).map((l) => l.text?.slice(0, 30))).toEqual(['Fractions and percentages: bef', "By default, teach: ask what I'"])
  })

  it('keeps the short notes of Profile B within the limit the way the proposal\'s example does', () => {
    const r = build(PROFILE_B_SHORT)
    expect(r.chars).toBeLessThanOrEqual(1500)
    expect(Math.abs(r.chars - proposal('B-short.txt').length)).toBeLessThan(40)
    expect(r.dropped.map((d) => d.line.id)).toEqual(['VOICE', 'U6', 'U3'])
  })
})

describe('content rules', () => {
  it('puts the header and the fixed clauses first in every form, and CC only in coding contexts', () => {
    for (const form of ['short', 'long', 'skill'] as Form[]) {
      const coding = buildBrief({ prefs: defaultPrefs('coding'), form, asOf: '2026-11' })
      expect(ids(coding).slice(0, 6)).toEqual(['H', 'F1', 'F2', 'F3', 'F4', 'CC'])
      const learning = buildBrief({ prefs: defaultPrefs('learning'), form, asOf: '2026-11' })
      expect(ids(learning).slice(0, 5)).toEqual(['H', 'F1', 'F2', 'F3', 'F4'])
      expect(ids(learning)).not.toContain('CC')
    }
  })

  it('cannot switch a locked clause off, by any setting', () => {
    const off: ContextPrefs = { ...defaultPrefs('coding'), lines_off: ['LANG', 'U1', 'CC', 'F1'] }
    const r = buildBrief({ prefs: { ...off, lines_off: [...off.lines_off] }, form: 'long', asOf: '2026-11' })
    expect(ids(r)).toEqual(expect.arrayContaining(['H', 'F1', 'F2', 'F3', 'F4', 'CC']))
    expect(r.lines.filter((l) => l.locked).every((l) => l.on)).toBe(true)
  })

  it('dates the header from the month it is given and asks to be revisited six months later', () => {
    const r = buildBrief({ prefs: defaultPrefs('general'), form: 'long', asOf: '2026-11' })
    expect(r.brief.as_of).toBe('2026-11')
    expect(r.brief.revisit).toBe('2027-05')
    expect(r.text).toContain('Written 2026-11. After 2027-05,')
    expect(buildBrief({ prefs: defaultPrefs('general'), form: 'long', asOf: '2026-09' }).brief.revisit).toBe('2027-03')
  })

  it('applies each context\'s defaults: code first in coding, caveats kept in reading, the writing line only in writing', () => {
    const t = (p: ContextPrefs, form: Form = 'long'): string => buildBrief({ prefs: p, form, asOf: '2026-11' }).text
    expect(t(defaultPrefs('coding'))).toContain('Lead with the answer or the code');
    expect(t(defaultPrefs('coding'))).toContain('such as a test or a command')
    expect(t(defaultPrefs('reading'))).toContain('keep its caveats and numbers')
    expect(t(defaultPrefs('reading'))).toContain('## Reading and summarising')
    expect(t(defaultPrefs('numbers'))).toContain('Give chances and risks as counts')
    expect(t(defaultPrefs('writing'))).toContain('keep my voice and word choices')
    expect(t(defaultPrefs('learning'))).toContain('Introduce only a few new ideas at a time')
    expect(t(defaultPrefs('coding'))).not.toContain('keep my voice')
  })

  it('lets the person switch a default off, phrase it another way, and tick optional lines on', () => {
    const p: ContextPrefs = { ...defaultPrefs('learning'), lines_off: ['U3'], lines_on: ['FMT1', 'FMT3'], phrasing: { U1: 'U1c', U2: 'U2.b' } }
    const text = buildBrief({ prefs: p, form: 'long', asOf: '2026-11' }).text
    expect(text).not.toContain('few new ideas')
    expect(text).toContain('no Markdown symbols')
    expect(text).toContain('put each step on its own line')
    expect(text).toContain('Lead with the answer or the code')
    expect(text).toContain('Prefer everyday words.')
    // a phrasing that is not in the family is ignored
    const bad = buildBrief({ prefs: { ...defaultPrefs('learning'), phrasing: { U1: 'DS' } }, form: 'long', asOf: '2026-11' })
    expect(bad.text).toContain('Start with the answer in a sentence or two')
  })

  it('adds the answer-length line only for short or detailed', () => {
    const t = (length: 'short' | 'standard' | 'detailed'): string => buildBrief({ prefs: { ...defaultPrefs('general'), length }, form: 'long', asOf: '2026-11' }).text
    expect(t('short')).toContain('Keep answers short and offer more detail at the end.')
    expect(t('detailed')).toContain('Detailed answers are welcome.')
    expect(t('standard')).not.toMatch(/Keep answers short|Detailed answers/)
  })

  it('merges "plain words" and "short sentences" into one line, and lets a word choice replace plain words', () => {
    const t = (p: Partial<ContextPrefs>): string => buildBrief({ prefs: { ...defaultPrefs('learning'), ...p }, form: 'long', asOf: '2026-11' }).text
    const merged = t({ lines_on: ['W3'] })
    expect(merged).toContain('Use plain words and short sentences. Keep a technical term')
    expect(merged).not.toContain('Use short sentences, one idea per sentence.')
    const w1 = t({ lines_on: ['W1', 'W3'] })
    expect(w1).toContain('General and academic vocabulary is fine')
    expect(w1).not.toContain('Use plain words')
    expect(w1).toContain('Use short sentences, one idea per sentence.')
    const both = buildBrief({ prefs: { ...defaultPrefs('learning'), lines_on: ['W1', 'W2'] }, form: 'long', asOf: '2026-11' })
    expect(both.text).toContain('General and academic vocabulary is fine')
    expect(both.text).not.toContain('Explain less common words')
    expect(both.notices.map((n) => n.kind)).toContain('words')
    const alone = t({ lines_off: ['U2'], lines_on: ['W3'] })
    expect(alone).toContain('Use short sentences, one idea per sentence.')
  })

  it('keeps "ask one quick question" in the style block, and moves it under the topic lines when there are some', () => {
    const none = buildBrief({ prefs: defaultPrefs('learning'), form: 'long', asOf: '2026-11' })
    expect(ids(none)).toContain('U4')
    expect(ids(none)).not.toContain('U4.t')
    const some = buildBrief({ prefs: { ...defaultPrefs('learning'), topics: { 'kst/physics': 'skip' } }, form: 'long', asOf: '2026-11' })
    expect(ids(some)).toContain('U4.t')
    expect(ids(some)).not.toContain('U4')
    const short = buildBrief({ prefs: { ...defaultPrefs('learning'), topics: { 'kst/physics': 'skip' } }, form: 'short', asOf: '2026-11' })
    expect(ids(short)).toContain('U4')
    // only ask-first topics in the short form: no topic line is written, so U4 stays plain
    const askShort = buildBrief({ prefs: { ...defaultPrefs('learning'), topics: { 'kst/physics': 'ask_first' } }, form: 'short', asOf: '2026-11' })
    expect(ids(askShort)).toContain('U4')
    expect(askShort.notices.map((n) => n.kind)).toContain('ask_first_short')
  })

  it('writes topics with the same wording family and setting as one line, in taxonomy order', () => {
    const p: ContextPrefs = { ...defaultPrefs('general'), topics: { 'other/statistics': 'skip', 'other/programming': 'skip', 'kst/biology': 'skip', 'khu/history': 'skip', 'quant/linear': 'build' } }
    const r = buildBrief({ prefs: p, form: 'long', asOf: '2026-11' })
    expect(r.brief.lines.filter((l) => l.topics !== undefined).map((l) => [l.id, l.topics])).toEqual([
      ['DS', ['other/programming', 'other/statistics']],
      ['DS.k', ['kst/biology', 'khu/history']],
      ['DB', ['quant/linear']],
    ])
    expect(r.text).toContain('- Programming and statistics: skip the basics and go straight to the method.')
    expect(r.text).toContain('- Biology and history: skip the basics and go straight to mechanisms, evidence and open questions.')
  })

  it('handles logic notation as its own topic line', () => {
    const t = (s: 'skip' | 'ask_first' | 'build'): string[] => ids(buildBrief({ prefs: { ...defaultPrefs('general'), topics: { 'lr/notation': s } }, form: 'long', asOf: '2026-11' }))
    expect(t('skip')).toContain('NT.skip')
    expect(t('build')).toContain('NT.build')
    expect(t('ask_first')).toContain('DA')
  })

  it('offers a worked example on build-up topics only in learn mode, as its own line', () => {
    const learn = buildBrief({ prefs: { ...defaultPrefs('learning'), topics: { 'quant/probability_counting': 'build', 'kst/physics': 'build' } }, form: 'long', asOf: '2026-11' })
    expect(learn.brief.lines.find((l) => l.id === 'K1F')?.topics).toEqual(['quant/probability_counting', 'kst/physics'])
    expect(learn.text).toContain('On probability and counting and physics, show one worked example')
    const doMode = buildBrief({ prefs: { ...defaultPrefs('general'), topics: { 'quant/probability_counting': 'build' } }, form: 'long', asOf: '2026-11' })
    expect(ids(doMode)).not.toContain('K1F')
    const skipOnly = buildBrief({ prefs: { ...defaultPrefs('learning'), topics: { 'kst/physics': 'skip' } }, form: 'long', asOf: '2026-11' })
    expect(ids(skipOnly)).not.toContain('K1F')
  })

  it('writes the mode lines by the default mode, and the challenge line only in the long forms', () => {
    expect(ids(buildBrief({ prefs: defaultPrefs('general'), form: 'long', asOf: '2026-11' }))).toContain('K1')
    const learn = buildBrief({ prefs: { ...defaultPrefs('general'), mode: 'learn' }, form: 'long', asOf: '2026-11' })
    expect(ids(learn)).toEqual(expect.arrayContaining(['K1L', 'K1D', 'K1C']))
    const learnShort = buildBrief({ prefs: { ...defaultPrefs('general'), mode: 'learn' }, form: 'short', asOf: '2026-11' })
    expect(ids(learnShort)).toContain('K1L')
    expect(ids(learnShort)).not.toContain('K1C')
    expect(learn.brief.keywords).toEqual({ 'just do it': 'do', 'challenge me': 'challenge' })
    expect(buildBrief({ prefs: defaultPrefs('general'), form: 'long', asOf: '2026-11' }).brief.keywords).toEqual({ 'teach me': 'learn', 'just do it': 'do', 'challenge me': 'challenge' })
  })

  it('offers the coding collaboration lines only in coding contexts', () => {
    const on = ['AC1', 'AC2']
    expect(ids(buildBrief({ prefs: { ...defaultPrefs('coding'), lines_on: on }, form: 'long', asOf: '2026-11' }))).toEqual(expect.arrayContaining(on))
    expect(ids(buildBrief({ prefs: { ...defaultPrefs('learning'), lines_on: on }, form: 'long', asOf: '2026-11' }))).not.toContain('AC1')
  })

  it('writes interests and the person\'s own lines last, and refuses lines that break a rule', () => {
    const r = buildBrief({
      prefs: defaultPrefs('general'),
      form: 'long',
      asOf: '2026-11',
      extras: { interests: 'chess, cooking', custom: [{ text: 'Use metric units', on: true }, { text: 'See https://example.org', on: true }, { text: 'Prefer British spelling.', on: false }] },
    })
    expect(r.text.split('\n').slice(-4)).toEqual(['', '## My additions', '- When you need an example, use chess or cooking.', '- Use metric units.'])
    expect(r.brief.lines.filter((l) => l.id === 'X1')).toEqual([{ id: 'X1', text: 'Use metric units.', custom: true }])
    expect(r.notices.some((n) => n.kind === 'custom')).toBe(true)
    // the unticked custom line stays in the list, unticked
    expect(r.lines.filter((l) => l.line.id === 'X1').map((l) => l.on)).toEqual([true, false])
  })

  it('keeps unticked defaults in the list so they can be ticked again, and keeps unticked topic lines too', () => {
    const p: ContextPrefs = { ...defaultPrefs('learning'), lines_off: ['U5'], topics: { 'kst/physics': 'skip', 'kst/biology': 'skip' }, topics_off: ['kst/biology'] }
    const c = compose({ prefs: p, form: 'long', asOf: '2026-11' })
    expect(c.lines.find((l) => l.line.id === 'U5')?.on).toBe(false)
    const dsk = c.lines.filter((l) => l.line.id === 'DS.k')
    expect(dsk.map((l) => [l.line.topics, l.on])).toEqual([[['kst/physics'], true], [['kst/biology'], false]])
  })
})

describe('the floor rule (proposal §3.3 step 2; A22)', () => {
  const p: ContextPrefs = { ...defaultPrefs('learning'), topics: { 'quant/arith_fractions_percent': 'build', 'quant/ratios_rates_averages': 'build', 'quant/probability_counting': 'build' } }

  it('renders a self-set "new to me" on the two lowest quant groups as ask-first until the gate passes', () => {
    const r = buildBrief({ prefs: p, form: 'long', asOf: '2026-11' })
    expect(r.brief.lines.filter((l) => l.topics !== undefined && l.id !== 'K1F').map((l) => [l.id, l.topics])).toEqual([
      ['DA', ['quant/arith_fractions_percent', 'quant/ratios_rates_averages']],
      ['DB', ['quant/probability_counting']],
    ])
    const floor = r.notices.find((n) => n.kind === 'floor')
    expect(floor?.message).toBe(NOTICE_TEXT.floor)
    expect(floor?.topics).toEqual(['quant/arith_fractions_percent', 'quant/ratios_rates_averages'])
  })

  it('does not apply to skip or ask-first settings, or to other topics', () => {
    const q: ContextPrefs = { ...defaultPrefs('learning'), topics: { 'quant/arith_fractions_percent': 'skip', 'quant/linear': 'build' } }
    const r = buildBrief({ prefs: q, form: 'long', asOf: '2026-11' })
    expect(ids(r)).toEqual(expect.arrayContaining(['DS', 'DB']))
    expect(r.notices.some((n) => n.kind === 'floor')).toBe(false)
  })

  it('lifts once the bottom-rung gate is shipped at the current wording', () => {
    const r = buildBrief({ prefs: p, form: 'long', asOf: '2026-11', gates: gatesWith({ [FLOOR_GATE]: { v: '1', status: 'shipped' } }) })
    expect(r.brief.lines.filter((l) => l.topics !== undefined && l.id !== 'K1F').map((l) => [l.id, l.topics])).toEqual([['DB', ['quant/arith_fractions_percent', 'quant/ratios_rates_averages', 'quant/probability_counting']]])
    expect(r.notices.some((n) => n.kind === 'floor')).toBe(false)
  })

  it('never renders a build-up line for a floor topic while the gate is not passed (random settings)', () => {
    fc.assert(
      fc.property(arbPrefs, arbForm, (prefs, form) => {
        const r = buildBrief({ prefs, form, asOf: '2026-11' })
        for (const l of r.brief.lines) {
          if (l.id === 'DB' || l.id === 'DB.k' || l.id === 'K1F') for (const t of l.topics ?? []) expect(t.startsWith('quant/arith') || t.startsWith('quant/ratios'), `${l.id} ${t}`).toBe(false)
        }
      }),
      { numRuns: 400 },
    )
  })
})

describe('tiers and the topic cap', () => {
  const topics = { 'quant/linear': 'skip', 'quant/powers_quadratics': 'skip', 'kst/physics': 'skip', 'kst/biology': 'skip', 'khu/history': 'skip', 'other/statistics': 'skip', 'other/programming': 'skip' } as const

  it('lists at most five topics per context in T1, in taxonomy order, and says so', () => {
    const r = buildBrief({ prefs: { ...defaultPrefs('general'), topics }, form: 'long', asOf: '2026-11' })
    const used = r.brief.lines.flatMap((l) => l.topics ?? [])
    expect(used).toHaveLength(5)
    expect(used).toEqual(['quant/linear', 'quant/powers_quadratics', 'kst/biology', 'kst/physics', 'khu/history'])
    expect(r.notices.map((n) => n.kind)).toContain('cap')
  })

  it('lists every topic set in all contexts in T2, and the current context wins a conflict', () => {
    const other: ContextPrefs = { ...defaultPrefs('reading', 2), topics: { 'kst/biology': 'build', 'other/economics': 'skip' } }
    const here: ContextPrefs = { ...defaultPrefs('general'), tier: 'T2', topics: { ...topics, 'kst/biology': 'ask_first' } }
    const r = buildBrief({ prefs: here, otherContexts: [other], form: 'long', asOf: '2026-11' })
    const used = r.brief.lines.flatMap((l) => l.topics ?? [])
    expect(used).toContain('other/economics')
    expect(used.filter((t) => t === 'kst/biology')).toHaveLength(1)
    expect(r.brief.lines.find((l) => l.topics?.includes('kst/biology'))?.id).toBe('DA')
    expect(r.brief.tier).toBe('T2')
    expect(used.length).toBeGreaterThan(5)
    expect(r.notices.map((n) => n.kind)).toContain('tier')
  })
})

describe('gate statuses shape the notes (A22)', () => {
  it('marks the person\'s own lines experimental and leaves the generic ones unmarked', () => {
    const r = buildBrief({ prefs: { ...defaultPrefs('general'), topics: { 'kst/physics': 'skip' }, lines_on: ['FMT1'] }, form: 'long', asOf: '2026-11' })
    const by = Object.fromEntries(r.brief.lines.map((l) => [l.id, l.status]))
    expect(by['DS.k']).toBe('experimental')
    expect(by['FMT1']).toBe('experimental')
    expect(by['F1']).toBeUndefined()
    expect(by['U1']).toBeUndefined()
    expect(by['K1']).toBeUndefined()
  })

  it('never renders a blocked line type: K2 is blocked until the direction gate passes', () => {
    const r = buildBrief({ prefs: defaultPrefs('general'), form: 'long', asOf: '2026-11' })
    expect(ids(r)).not.toContain('K2')
    expect(r.blocked).toEqual(['K2'])
    const ok = buildBrief({ prefs: defaultPrefs('general'), form: 'long', asOf: '2026-11', gates: gatesWith({ K2: { v: '1', status: 'experimental' } }) })
    expect(ids(ok)).toContain('K2')
    expect(ok.brief.lines.find((l) => l.id === 'K2')?.status).toBe('experimental')
    expect(ok.brief.keywords).toMatchObject({ deeper: 'up', 'more steps': 'down' })
    const short = buildBrief({ prefs: defaultPrefs('general'), form: 'short', asOf: '2026-11', gates: gatesWith({ K2: { v: '1', status: 'shipped' } }) })
    expect(ids(short)).not.toContain('K2')
    const blockedDs = buildBrief({ prefs: { ...defaultPrefs('general'), topics: { 'kst/physics': 'skip' } }, form: 'long', asOf: '2026-11', gates: gatesWith({ 'DS.k': { v: '1', status: 'blocked' } }) })
    expect(ids(blockedDs)).not.toContain('DS.k')
  })

  it('resets a status earned on other wording', () => {
    const r = buildBrief({ prefs: { ...defaultPrefs('general'), topics: { 'kst/physics': 'skip' } }, form: 'long', asOf: '2026-11', gates: gatesWith({ 'DS.k': { v: '0', status: 'blocked' } }) })
    expect(r.brief.lines.find((l) => l.id === 'DS.k')?.status).toBe('experimental')
  })
})

describe('the length rule (proposal §3.3 step 4, §4.1)', () => {
  const crowded: ContextPrefs = {
    ...defaultPrefs('learning'),
    topics: { 'quant/linear': 'build', 'quant/powers_quadratics': 'skip', 'kst/physics': 'build', 'kst/biology': 'skip', 'khu/history': 'skip' },
    lines_on: ['W3', 'FMT1', 'FMT2', 'FMT3', 'VOICE'],
    length: 'short',
  }
  const extras = { interests: 'cooking, football, chess', custom: [{ text: 'Use metric units', on: true }] }

  it('drops the lowest-priority ticked lines until the text fits, and names every one', () => {
    const r = buildBrief({ prefs: crowded, extras, form: 'short', asOf: '2026-11' })
    expect(r.chars).toBeLessThanOrEqual(1500)
    expect(r.dropped.length).toBeGreaterThan(0)
    const kept = new Set(ids(r))
    for (const d of r.dropped) expect(kept.has(d.line.id) && d.line.id !== 'X1' ? d.line.topics === undefined : true).toBe(true)
    // the fixed clauses always survive
    expect(ids(r).slice(0, 5)).toEqual(['H', 'F1', 'F2', 'F3', 'F4'])
  })

  it('drops the short-form "if it fits" lines first, then later sections before earlier ones', () => {
    const r = buildBrief({ prefs: crowded, extras, form: 'short', asOf: '2026-11' })
    const order = r.dropped.map((d) => d.line.id)
    // U3, U6 and VOICE are "if it fits" lines; they go before any topic, mode or extra line
    const fitIds = ['U3', 'U6', 'VOICE']
    const firstNonFit = order.findIndex((i) => !fitIds.includes(i))
    expect(order.slice(0, firstNonFit === -1 ? order.length : firstNonFit).every((i) => fitIds.includes(i))).toBe(true)
    // ... and among the rest, later sections (extras, then modes, then topics) go first
    const rest = order.slice(firstNonFit === -1 ? order.length : firstNonFit).map((i) => TEMPLATE_BY_ID.get(i)?.section ?? 'S0')
    expect(rest).toEqual([...rest].sort().reverse())
  })

  it('writes everything when it fits, and reports nothing dropped', () => {
    expect(buildBrief({ prefs: defaultPrefs('general'), form: 'long', asOf: '2026-11' }).dropped).toEqual([])
    expect(build(PROFILE_A).dropped).toEqual([])
    expect(build(PROFILE_B_LONG).dropped).toEqual([])
    expect(build(PROFILE_C).dropped).toEqual([])
  })

  it('honours a smaller limit exactly, dropping in priority order without changing kept lines', () => {
    const full = buildBrief({ prefs: crowded, extras, form: 'long', asOf: '2026-11' })
    expect(full.dropped).toEqual([])
    const small = buildBrief({ prefs: crowded, extras, form: 'long', asOf: '2026-11', limit: full.chars - 1 })
    expect(small.dropped).toHaveLength(1)
    expect(small.chars).toBeLessThan(full.chars)
    // the dropped line is the last in the low-priority order: the custom line (S7)
    expect(small.dropped[0]?.line.id).toBe('X1')
  })

  it('reports (does not hide) a limit that cannot be met: only locked lines are left', () => {
    const r = buildBrief({ prefs: crowded, extras, form: 'long', asOf: '2026-11', limit: 100 })
    expect(r.fits).toBe(false)
    expect(ids(r)).toEqual(['H', 'F1', 'F2', 'F3', 'F4'])
    expect(r.dropped.length).toBeGreaterThan(5)
  })

  it('keeps the merge decisions consistent after a drop (U4 moves back when the topic lines go)', () => {
    const p: ContextPrefs = { ...defaultPrefs('general'), topics: { 'kst/physics': 'skip' } }
    const full = buildBrief({ prefs: p, form: 'long', asOf: '2026-11' })
    expect(ids(full)).toContain('U4.t')
    const cut = buildBrief({ prefs: p, form: 'long', asOf: '2026-11', limit: full.chars - 5 })
    // dropping the topic line (or anything after it) never leaves "Any other topic" without topics
    if (!ids(cut).includes('DS.k')) expect(ids(cut)).not.toContain('U4.t')
  })
})

describe('properties over random settings (V0 generator invariants, non-zone)', () => {
  const runs = 600

  it('gives 0 lint violations, plain ASCII and text within the limit of the form, with nothing silently cut', () => {
    fc.assert(
      fc.property(arbPrefs, arbExtras, arbForm, arbMonth, (prefs, extras, form, asOf) => {
        const r = buildBrief({ prefs, extras, form, asOf })
        expect(lintNotes(r.text)).toEqual([])
        expect(/^[\x20-\x7E\n]*$/.test(r.text)).toBe(true)
        expect(r.chars).toBe(r.text.length)
        expect(r.chars).toBeLessThanOrEqual(FORM_LIMITS[form])
        expect(r.fits).toBe(true)
        // every ticked line is either written or reported as dropped
        const written = new Set(r.brief.lines.map((l) => JSON.stringify(l)))
        const ticked = compose({ prefs, extras, form, asOf }).lines.filter((l) => l.on)
        const dropped = new Set(r.dropped.map((d) => d.key))
        for (const t of ticked) expect(written.has(JSON.stringify(t.line)) || dropped.has(t.key) || r.dropped.length > 0, t.key).toBe(true)
        if (r.dropped.length === 0) expect(r.brief.lines).toEqual(ticked.map((t) => t.line))
      }),
      { numRuns: runs },
    )
  })

  it('is deterministic: the same settings, extras, form and month always give the same bytes', () => {
    fc.assert(
      fc.property(arbPrefs, arbExtras, arbForm, arbMonth, (prefs, extras, form, asOf) => {
        const a = buildBrief({ prefs, extras, form, asOf })
        const b = buildBrief({ prefs: JSON.parse(JSON.stringify(prefs)) as ContextPrefs, extras: JSON.parse(JSON.stringify(extras)) as typeof extras, form, asOf })
        expect(a.text).toBe(b.text)
        expect(renderJson(a.brief)).toBe(renderJson(b.brief))
      }),
      { numRuns: 200 },
    )
  })

  it('keeps the header and fixed clauses first, and only lines that have wording in the form', () => {
    fc.assert(
      fc.property(arbPrefs, arbExtras, arbForm, (prefs, extras, form) => {
        const r = buildBrief({ prefs, extras, form, asOf: '2026-11' })
        expect(ids(r).slice(0, 5)).toEqual(['H', 'F1', 'F2', 'F3', 'F4'])
        expect(ids(r).includes('CC')).toBe(PRESET_INFO[prefs.preset].coding)
        for (const l of r.brief.lines) {
          const t = TEMPLATE_BY_ID.get(l.id)!
          expect(t.header === true || wording(t, form) !== null, `${l.id} in ${form}`).toBe(true)
          expect(l.id === 'K2').toBe(false)
        }
        expect(r.text.startsWith(form === 'skill' ? '---\nname: working-with-me' : form === 'long' ? '# How I like explanations' : 'How I like explanations: my own')).toBe(true)
      }),
      { numRuns: runs },
    )
  })

  it('writes no digits except the two months (as-of and revisit)', () => {
    fc.assert(
      fc.property(arbPrefs, arbExtras, arbForm, arbMonth, (prefs, extras, form, asOf) => {
        const r = buildBrief({ prefs, extras, form, asOf })
        const digitRuns = r.text.match(/[0-9]+/g) ?? []
        expect(digitRuns.every((d) => d.length === 4 || d.length === 2)).toBe(true)
        expect(r.text.match(/\d{4}-\d{2}/g) ?? []).toEqual([asOf, r.brief.revisit])
      }),
      { numRuns: 300 },
    )
  })

  it('never lets an unticked line, an off topic, or a refused custom line into the notes', () => {
    fc.assert(
      fc.property(arbPrefs, arbExtras, (prefs, extras) => {
        const r = buildBrief({ prefs, extras, form: 'long', asOf: '2026-11' })
        for (const t of prefs.topics_off) if (prefs.topics[t] !== undefined) expect(r.brief.lines.flatMap((l) => l.topics ?? [])).not.toContain(t)
        for (const l of r.brief.lines) if (l.id === 'X1') expect(lintNotes(`- ${l.text}`)).toEqual([])
        for (const k of prefs.lines_off) {
          // a base id ticked off never appears (U1 also covers U1c, so compare by tick key)
          if (['U3', 'U5', 'U7', 'U8', 'LANG'].includes(k)) expect(ids(r)).not.toContain(k)
        }
      }),
      { numRuns: 300 },
    )
  })
})
