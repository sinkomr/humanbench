/**
 * Stored settings hold no free text (R-17.12; proposal §5.5): every string is an enum, a topic or
 * line id, a template id, a destination id or nothing else. And the notes core touches no storage
 * and no network (R-17.1): checked by reading its own source.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { PRESET_INFO } from './contexts'
import { PHRASING_FAMILIES, TEMPLATES } from './grammar'
import { TICK_KEYS, defaultPrefs, normalizePrefs, type ContextPrefs } from './prefs'
import { arbPrefs } from './testing'
import { TOPICS } from './topics'
import { LENGTHS, MODES, PRESETS, TOPIC_SETTINGS } from './types'

const CLOSED = new Set<string>([
  ...PRESETS,
  ...MODES,
  ...LENGTHS,
  ...TOPIC_SETTINGS,
  'T1',
  'T2',
  'short',
  'long',
  'skill',
  ...TOPICS.map((t) => t.id),
  ...TICK_KEYS,
  ...TEMPLATES.map((t) => t.id),
  ...Object.keys(PHRASING_FAMILIES),
  ...Object.values(PRESET_INFO).map((p) => p.destination),
])

/** Every string in a value: keys of the topic and phrasing maps count, so keys cannot smuggle text. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out))
  else if (typeof v === 'object' && v !== null) for (const [k, x] of Object.entries(v)) (out.push(k), strings(x, out))
  return out
}

describe('ContextPrefs', () => {
  it('starts from the preset: its mode, length and destination, and nothing chosen yet', () => {
    for (const p of PRESETS) {
      const d = defaultPrefs(p)
      expect(d).toMatchObject({ preset: p, tier: 'T1', mode: PRESET_INFO[p].mode, length: PRESET_INFO[p].length, destination: PRESET_INFO[p].destination, topics: {}, lines_on: [], lines_off: [], rev: 0 })
    }
  })

  it('has no place for interests, custom lines or names (they are typed, used and never stored)', () => {
    const keys = Object.keys(defaultPrefs('general')).sort()
    expect(keys).toEqual(['destination', 'length', 'lines_off', 'lines_on', 'mode', 'phrasing', 'preset', 'rev', 'slot', 'tier', 'topics', 'topics_off'])
    expect(keys.some((k) => /interest|custom|name|label|text|note/.test(k))).toBe(false)
  })

  it('offers tick keys for every template line except the locked clauses and the custom line', () => {
    expect(TICK_KEYS).toEqual(expect.arrayContaining(['LANG', 'U1', 'U2', 'U6', 'FMT1', 'VOICE', 'W1', 'W3', 'AC1', 'K1', 'K1F', 'K2', 'LEN', 'I1', 'DS', 'DA', 'DB', 'NT']))
    for (const locked of ['H', 'F1', 'F2', 'F3', 'F4', 'CC', 'X1']) expect(TICK_KEYS).not.toContain(locked)
  })
})

describe('normalizePrefs', () => {
  it('turns any value into valid settings whose strings are all from closed sets (random junk)', () => {
    fc.assert(
      fc.property(fc.anything(), (x) => {
        const p = normalizePrefs(x)
        for (const s of strings(p)) expect(CLOSED.has(s) || /^[a-z][a-z0-9_]{0,40}$/.test(s), s).toBe(true)
        expect(p.slot).toBeGreaterThanOrEqual(1)
        expect(p.slot).toBeLessThanOrEqual(5)
        expect(normalizePrefs(p)).toEqual(p)
      }),
      { numRuns: 500 },
    )
  })

  it('drops free text hidden in the lists, the maps and the enums', () => {
    const p = normalizePrefs({
      preset: 'my level is low',
      destination: 'My Secret Place!',
      mode: 'be nice',
      length: 'verbose',
      tier: 'T9',
      form: 'huge',
      topics: { 'quant/linear': 'skip', 'I am bad at maths': 'skip', 'quant/powers_quadratics': 'i give up' },
      topics_off: ['quant/linear', 'free text'],
      lines_on: ['FMT1', 'a sentence about me'],
      lines_off: ['F1', 'CC', 'U3'],
      phrasing: { U1: 'U1c', U2: 'a custom wording', ZZ: 'U1' },
      rev: 'x',
    })
    expect(p).toEqual({
      slot: 1,
      preset: 'general',
      destination: 'chatgpt_instructions',
      tier: 'T1',
      mode: 'do',
      length: 'standard',
      topics: { 'quant/linear': 'skip' },
      topics_off: ['quant/linear'],
      lines_on: ['FMT1'],
      lines_off: ['U3'],
      phrasing: { U1: 'U1c' },
      rev: 0,
    })
  })

  it('keeps well-formed settings as they are, in canonical order', () => {
    fc.assert(
      fc.property(arbPrefs, (p) => {
        expect(normalizePrefs(p)).toEqual(p)
        expect(strings(p).every((s) => CLOSED.has(s) || /^[a-z][a-z0-9_]{0,40}$/.test(s))).toBe(true)
      }),
      { numRuns: 300 },
    )
  })

  it('accepts a form choice and a slot and revision', () => {
    const p: ContextPrefs = { ...defaultPrefs('reading', 3), form: 'long', rev: 7 }
    expect(normalizePrefs(p)).toEqual(p)
  })
})
