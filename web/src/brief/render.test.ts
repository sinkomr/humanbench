/** Writing a brief out: the forms' structure (proposal §3.2) and the JSON that mirrors the text (R-17.3). */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { buildBrief } from './build'
import { TEMPLATE_BY_ID, wording } from './grammar'
import { PROFILE_A, PROFILE_B_LONG, PROFILE_B_SHORT, PROFILE_C, PROFILES } from './profiles'
import { asFile, briefObject, groupOf, headingFor, lineText, renderJson, renderText } from './render'
import { arbExtras, arbForm, arbMonth, arbPrefs } from './testing'
import type { Brief } from './types'

const build = (p: (typeof PROFILES)[number]) => buildBrief({ prefs: p.prefs, extras: p.extras, form: p.form, asOf: p.asOf })

describe('the forms', () => {
  it('writes short notes as plain text: one header line and "- " bullets, no headings, no Markdown', () => {
    const t = build(PROFILE_B_SHORT).text
    const lines = t.split('\n')
    expect(lines[0]).toMatch(/^How I like explanations: my own preferences, not an assessment of me\. Written 2026-11\./)
    expect(lines.slice(1).every((l) => l.startsWith('- '))).toBe(true)
    expect(t).not.toMatch(/^#|\n#|\n\n|\*|`|\|/)
  })

  it('writes long notes with only "#" headings and "-" lists, and blank lines between sections', () => {
    const t = build(PROFILE_B_LONG).text
    expect(t.startsWith('# How I like explanations\nMy own preferences')).toBe(true)
    for (const l of t.split('\n')) expect(l === '' || /^#{1,2} \S/.test(l) || l.startsWith('- ') || l.startsWith('My own preferences'), l).toBe(true)
    expect(t.match(/^## .+$/gm)).toEqual(['## Always', '## Style', '## By topic', '## Modes', '## Examples'])
  })

  it('writes a Skill file as front matter, then the long form', () => {
    const t = build(PROFILE_A).text
    const [fence, name, description, fence2, blank, title] = t.split('\n')
    expect([fence, name, fence2, blank, title]).toEqual(['---', 'name: working-with-me', '---', '', '# How I like explanations'])
    expect(description).toMatch(/^description: How I like explanations\. Use when explaining a concept, code or an error to me/)
    expect(t.match(/^## .+$/gm)).toEqual(['## Always', '## Style', '## By topic', '## Working together'])
  })

  it('names the style block by its job in a reading context, and the last blocks by what they hold', () => {
    const c = build(PROFILE_C)
    expect(c.text).toContain('## Reading and summarising')
    expect(c.text).toContain('## Modes')
    const brief = c.brief
    expect(headingFor('work', brief.lines, brief)).toBe('Modes')
    expect(headingFor('work', [{ id: 'AC1' }], brief)).toBe('Working together')
    expect(headingFor('extras', [{ id: 'X1' }], brief)).toBe('My additions')
    expect(headingFor('extras', [{ id: 'I1' }], brief)).toBe('Examples')
    expect(groupOf({ id: 'DS' })).toBe('topic')
    expect(groupOf({ id: 'nope' })).toBe('extras')
  })

  it('writes a line by its form: short wording where it differs, and nothing where a line is long-form only', () => {
    expect(lineText({ id: 'U1' }, 'short')).not.toEqual(lineText({ id: 'U1' }, 'long'))
    expect(lineText({ id: 'U1' }, 'skill')).toEqual(lineText({ id: 'U1' }, 'long'))
    expect(lineText({ id: 'DA', topics: ['quant/linear'] }, 'short')).toBeNull()
    expect(lineText({ id: 'nope' }, 'long')).toBeNull()
    expect(lineText({ id: 'K1F', topics: ['quant/linear', 'kst/physics'] }, 'long')).toBe('On linear equations and systems and physics, show one worked example, then give me a similar one to finish myself.')
    expect(lineText({ id: 'X1', text: 'Use metric units.', custom: true }, 'long')).toBe('Use metric units.')
  })

  it('adds one final newline for a file, and none to the text', () => {
    const t = build(PROFILE_A).text
    expect(t.endsWith('\n')).toBe(false)
    expect(asFile(t)).toBe(`${t}\n`)
  })

  it('renders the same brief to the same bytes every time', () => {
    for (const p of PROFILES) expect(renderText(build(p).brief)).toBe(renderText(build(p).brief))
  })
})

describe('the JSON mirrors the text (R-17.3; proposal §5.5)', () => {
  it('has the documented keys in order and no zone, basis or estimate field', () => {
    const doc = JSON.parse(renderJson(build(PROFILE_A).brief)) as Record<string, unknown>
    expect(Object.keys(doc)).toEqual(['format', 'templates', 'topics', 'groups', 'as_of', 'revisit', 'context', 'form', 'tier', 'mode_default', 'length', 'lines', 'keywords', 'generator'])
    const keys = new Set<string>()
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk)
      else if (typeof v === 'object' && v !== null) for (const [k, x] of Object.entries(v)) (keys.add(k), walk(x))
    }
    walk(doc)
    // `zone_rule` names the rule the generator would use in Part 2; no zone value is ever written.
    keys.delete('zone_rule')
    expect([...keys].filter((k) => /zone|basis|estimate|score|level|percentile|theta|axis|axes|band|hidden|curriculum|ask_first/.test(k))).toEqual([])
    expect(doc.format).toBe('hb-brief/1')
    expect(doc.lines).toEqual(expect.arrayContaining([{ id: 'DS', topics: ['other/programming', 'other/statistics'], status: 'experimental' }, { id: 'H' }, { id: 'CC' }]))
  })

  it('carries a custom line as its text plus a custom flag, and interests as a list', () => {
    const b = buildBrief({ prefs: PROFILE_B_SHORT.prefs, extras: { interests: 'chess', custom: [{ text: 'Use metric units', on: true }] }, form: 'long', asOf: '2026-11' }).brief
    expect(briefObject(b).lines).toEqual(expect.arrayContaining([{ id: 'I1', interests: ['chess'], status: 'experimental' }, { id: 'X1', text: 'Use metric units.', custom: true }]))
  })

  it('has exactly one JSON line for each header, bullet and line of the text, in the same order', () => {
    fc.assert(
      fc.property(arbPrefs, arbExtras, arbForm, arbMonth, (prefs, extras, form, asOf) => {
        const brief: Brief = buildBrief({ prefs, extras, form, asOf }).brief
        const text = renderText(brief)
        const written = brief.lines.map((l) => lineText(l, form)).filter((t) => t !== null)
        const bullets = text.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2))
        expect(bullets).toEqual(written)
        // the header line is the one JSON line that is not a bullet
        const headers = brief.lines.filter((l) => TEMPLATE_BY_ID.get(l.id)?.header === true)
        expect(headers).toEqual([{ id: 'H' }])
        expect(brief.lines.length).toBe(bullets.length + headers.length)
        for (const l of brief.lines) expect(TEMPLATE_BY_ID.get(l.id)?.header === true || wording(TEMPLATE_BY_ID.get(l.id)!, form) !== null).toBe(true)
        // the JSON is the brief: same lines, same order
        expect(briefObject(brief).lines).toEqual(JSON.parse(renderJson(brief)).lines)
      }),
      { numRuns: 300 },
    )
  })
})
