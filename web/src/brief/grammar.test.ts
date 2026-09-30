/**
 * The closed grammar `hb-brief/1` (ADR A20; R-17.2, R-17.3): every template is ASCII, digit-free,
 * lint-clean and A13-clean once its slots are filled; wording never repeats inside a form (so a
 * written line has one reading); and the documented long-form-only lines are exactly those.
 */

import { describe, expect, it } from 'vitest'
import pins from './__fixtures__/wording-pins.json'
import {
  HEADINGS,
  KNOWN_HEADINGS,
  PHRASING_FAMILIES,
  SKILL_DESCRIPTIONS,
  SKILL_NAME,
  TEMPLATES,
  TEMPLATE_BY_ID,
  familyOf,
  headerBody,
  headerLines,
  parseHeaderBody,
  skillFrontMatter,
  slotsOf,
  template,
  wording,
} from './grammar'
import { lintLine, lintNotes } from './lint'
import { lineText } from './render'
import { BENEFIT_RE } from './testing'
import { PRESETS, type Form } from './types'

const FORMS: Form[] = ['short', 'long', 'skill']
const SAMPLE = { topics: ['other/programming', 'other/statistics'], interests: ['cooking', 'football'], text: 'Use metric units.' }

describe('templates', () => {
  it('have unique ids, ASCII ids and a versioned wording', () => {
    const ids = TEMPLATES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const t of TEMPLATES) {
      expect(t.id, t.id).toMatch(/^[A-Za-z][A-Za-z0-9.]{0,15}$/)
      expect(t.v, t.id).toMatch(/^[0-9]+$/)
      expect(TEMPLATE_BY_ID.get(t.id)).toBe(t)
      expect(template(t.id)).toBe(t)
    }
    expect(() => template('nope')).toThrow(RangeError)
  })

  it('write every line in plain ASCII with no digits, no URLs and nothing the lints ban, in every form', () => {
    for (const t of TEMPLATES) {
      for (const form of FORMS) {
        const line = { id: t.id, ...(slotsOf(t.long ?? '').some((s) => s === 'Topics' || s === 'topics') ? { topics: SAMPLE.topics } : {}), ...(t.id === 'I1' ? { interests: SAMPLE.interests } : {}), ...(t.id === 'X1' ? { text: SAMPLE.text, custom: true as const } : {}) }
        const text = lineText(line, form)
        if (text === null) continue
        expect(lintLine(text), `${t.id} (${form}): ${text}`).toEqual([])
        expect(text, t.id).not.toMatch(/[{}]/)
        expect(text.startsWith('-') || text.startsWith('#'), t.id).toBe(false)
        expect(text, t.id).not.toContain('\n')
      }
    }
  })

  it('never share wording in one form, so a written line reads as one template', () => {
    for (const form of ['short', 'long'] as const) {
      const seen = new Map<string, string>()
      for (const t of TEMPLATES) {
        const w = wording(t, form)
        if (w === null || t.id === 'X1') continue
        const prior = seen.get(w)
        expect(prior, `${t.id} repeats ${prior} in ${form}`).toBeUndefined()
        seen.set(w, t.id)
      }
    }
  })

  it('use at most one slot each, and only the four known slots', () => {
    for (const t of TEMPLATES) {
      for (const w of [t.long, t.short]) {
        if (w == null) continue
        expect(slotsOf(w).length, t.id).toBeLessThanOrEqual(1)
        expect(w.replace(/\{(?:Topics|topics|interests|custom)\}/g, ''), t.id).not.toMatch(/[{}]/)
      }
    }
  })

  it('write the long-form-only lines only in the long form and the Skill, as documented', () => {
    const longOnly = TEMPLATES.filter((t) => t.short === null).map((t) => t.id)
    expect(longOnly.sort()).toEqual(['DA', 'DA.p', 'K1C', 'K1D', 'K1F', 'K2', 'U4.t'].sort())
    // The one line whose short wording differs: the default-teach line carries "just do it" in the short form.
    expect(template('K1L').short).toContain('"just do it"')
    expect(template('K1L').long).not.toContain('just do it')
    expect(template('U1').short).not.toEqual(template('U1').long)
  })

  it('keep the header, the fixed clauses and CC locked, and nothing else', () => {
    expect(TEMPLATES.filter((t) => t.locked === true).map((t) => t.id).sort()).toEqual(['CC', 'F1', 'F2', 'F3', 'F4', 'H'])
    expect(TEMPLATES.filter((t) => t.header === true).map((t) => t.id)).toEqual(['H'])
  })

  it('give every line a drawer text that does not overclaim benefit (A22 copy-claim rule)', () => {
    for (const t of TEMPLATES) {
      expect(t.research.length, t.id).toBeGreaterThan(10)
      // The same pattern as the page copy: "helps", "can help", "easier" and the like imply benefit too (A22).
      expect(t.research, t.id).not.toMatch(BENEFIT_RE)
      expect(lintLine(t.research).filter((h) => h.rule === 'a13' || h.rule === 'ascii'), t.id).toEqual([])
    }
  })

  it('order the sections and groups sensibly: fixed clauses first, custom lines last', () => {
    const order = (id: string): number => template(id).order
    expect(order('F1')).toBeLessThan(order('F2'))
    expect(order('U1')).toBeLessThan(order('U6'))
    expect(order('X1')).toBeGreaterThan(order('I1'))
    expect(template('W1').section).toBe('S6')
    expect(template('K1').section).toBe('S4')
    expect(template('AC1').section).toBe('S5')
    expect(template('DS').section).toBe('S3')
  })

  it('mark U3, U6 and VOICE as short-form "if it fits" lines, and no fixed clause', () => {
    expect(TEMPLATES.filter((t) => t.fit === true).map((t) => t.id).sort()).toEqual(['U3', 'U6', 'U6c', 'VOICE'])
  })

  it('define the phrasing families over real templates with a shared tick key', () => {
    for (const [base, members] of Object.entries(PHRASING_FAMILIES)) {
      expect(members).toContain(base)
      for (const id of members) {
        expect(template(id).base, id).toBe(base)
        expect(familyOf(id)).toBe(members)
      }
    }
    expect(familyOf('F1')).toBeUndefined()
  })
})

describe('header, headings and Skill front matter', () => {
  it('writes the header as one line in the short form and a title plus body in the long forms', () => {
    expect(headerLines('short', '2026-11', '2027-05')).toEqual([
      "How I like explanations: my own preferences, not an assessment of me. Written 2026-11. After 2027-05, or if you can't tell today's date, check with me before relying on the topic lines.",
    ])
    expect(headerLines('long', '2026-11', '2027-05')).toEqual([
      '# How I like explanations',
      "My own preferences, not an assessment of me. Written 2026-11. After 2027-05, or if you can't tell today's date, check with me before relying on the topic lines.",
    ])
    expect(headerLines('skill', '2026-11', '2027-05')).toEqual(headerLines('long', '2026-11', '2027-05'))
  })

  it('reads a header body back, with its capitalisation', () => {
    expect(parseHeaderBody(headerBody('2026-11', '2027-05', true))).toEqual({ asOf: '2026-11', revisit: '2027-05', capital: true })
    expect(parseHeaderBody(headerBody('2026-11', '2027-05', false))).toEqual({ asOf: '2026-11', revisit: '2027-05', capital: false })
    expect(parseHeaderBody('My own preferences.')).toBeNull()
    expect(parseHeaderBody(headerBody('2026-11', '2027-05', true).replace('assessment', 'score'))).toBeNull()
  })

  it('passes the brief lint as a whole, in every form', () => {
    for (const form of FORMS) expect(lintNotes(headerLines(form, '2026-11', '2027-05').join('\n')), form).toEqual([])
  })

  it('has clean headings and one Skill description per context', () => {
    for (const h of Object.values(HEADINGS)) expect(lintLine(h), h).toEqual([])
    expect(KNOWN_HEADINGS.size).toBe(Object.values(HEADINGS).length)
    for (const p of PRESETS) {
      expect(lintLine(SKILL_DESCRIPTIONS[p]), p).toEqual([])
      expect(SKILL_DESCRIPTIONS[p].length, p).toBeLessThan(200)
      expect(lintNotes(skillFrontMatter(p).join('\n')), p).toEqual([])
    }
    expect(SKILL_NAME).toMatch(/^[a-z][a-z-]*$/)
    expect(skillFrontMatter('coding')).toEqual(['---', 'name: working-with-me', `description: ${SKILL_DESCRIPTIONS.coding}`, '---'])
  })
})

describe('wording pins (A22: "the wording is the treatment")', () => {
  // A line type's gate status is keyed by (id, v). If the wording changed and v did not, the old
  // status would silently apply to a new treatment. Each template's text is pinned by hash per
  // version; changing the text needs a new v, which resets the status through gates.lineStatus.
  const table = pins.pins as Record<string, Record<string, string>>
  const hash = async (t: Pick<(typeof TEMPLATES)[number], 'long' | 'short'>): Promise<string> => {
    const bytes = new TextEncoder().encode(JSON.stringify([t.long, t.short === undefined ? 'same' : t.short]))
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  it('fails when a template\'s wording changes without a new version', async () => {
    for (const t of TEMPLATES) {
      const h = await hash(t)
      const pinned = table[t.id]?.[t.v]
      expect(pinned, `${t.id} v${t.v} has no pin: add "${t.v}": "${h}" under "${t.id}" in wording-pins.json`).toBeDefined()
      expect(h, `${t.id} v${t.v}: the wording changed but v did not. Bump v (this resets the gate status) and add the new hash.`).toBe(pinned)
    }
  })

  it('catches a reworded template (mutation check of the pin itself)', async () => {
    const t = template('AC2')
    const reworded = { long: 'Explain each change briefly once you have made it.', short: t.short }
    expect(await hash(reworded)).not.toBe(table.AC2?.[t.v])
    expect(await hash(t)).toBe(table.AC2?.[t.v])
  })

  it('keeps only well-formed hashes, and every pinned version is a plain version string', () => {
    for (const [id, versions] of Object.entries(table)) {
      for (const [v, h] of Object.entries(versions)) {
        expect(v, id).toMatch(/^\d+$/)
        expect(h, `${id} v${v}`).toMatch(/^[0-9a-f]{64}$/)
      }
    }
  })
})
