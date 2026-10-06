/**
 * One form for part and skill names (provisional default, UX-REVIEW D25: option A with option C's
 * display names): Title Case everywhere, plain display names for the two research names, and every
 * screen takes its names from `axis-names.ts` (the engine registry keeps the DESIGN §3 names).
 */

import { describe, expect, it } from 'vitest'
import { AXIS_NAMES, axisName, PLAIN_AXIS_NAMES } from './axis-names'
import { EMO_AXIS_NAME } from './copy'
import { AXES, AXIS_CODES, axis } from './engine/axes'
import { SEGMENT_INFO, skipTargetName } from './session/segments'
import { COMPACT_LABELS, SHORT_LABELS } from './viz/profile'

/** The research names that never reach a screen (UX-060). */
const JARGON = ['Calibration/Metacognition', 'Analytical/Logic Games'] as const

/**
 * Title Case: every word starts with a capital letter (or a digit), "&" may join two words, and a
 * cut word keeps its full stop ("Comp."). The emotion skill's R-5.6.2 name keeps its lower-case
 * "(text scenarios)" word for word, so that part is checked as the pinned text instead.
 */
function titleCase(name: string): boolean {
  const rest = name.replace(/\s*\(text scenarios\)$/, '')
  return rest === '' || rest.split(/[\s/-]+/).every((w) => w === '&' || /^[A-Z0-9]/.test(w))
}

describe('the on-screen skill names', () => {
  it('give the two research names plain display names and keep every other registry name', () => {
    expect(axisName('LG')).toBe('Logic Games')
    expect(axisName('CAL')).toBe('Confidence Calibration')
    expect(Object.keys(PLAIN_AXIS_NAMES).sort()).toEqual(['CAL', 'LG'])
    for (const a of AXES) if (!(a.code in PLAIN_AXIS_NAMES)) expect(axisName(a.code), a.code).toBe(a.name)
    expect(Object.keys(AXIS_NAMES)).toEqual([...AXIS_CODES])
  })

  it('keep the DESIGN §3 names in the engine registry (the shared axis spec with the bank)', () => {
    expect(axis('LG').name).toBe('Analytical/Logic Games')
    expect(axis('CAL').name).toBe('Calibration/Metacognition')
  })

  it('keep the R-5.6.2 name of the emotion skill word for word', () => {
    expect(axisName('EMO')).toBe(EMO_AXIS_NAME)
  })

  it('are all Title Case, all different, and none is a research name or has a slash', () => {
    const names = Object.values(AXIS_NAMES)
    for (const n of names) {
      expect(titleCase(n), n).toBe(true)
      expect(n, n).not.toMatch(/\/|Metacognition|Analytical/)
    }
    expect(new Set(names).size).toBe(names.length)
    for (const j of JARGON) expect(names).not.toContain(j)
  })

  it('are what the chart labels cut, in the same Title Case', () => {
    for (const code of AXIS_CODES) {
      for (const line of [...SHORT_LABELS[code], COMPACT_LABELS[code]]) expect(titleCase(line), `${code}: ${line}`).toBe(true)
    }
    // The two-line label is the whole display name; the one-line label keeps the thing measured.
    expect(SHORT_LABELS.CAL.join(' ')).toBe('Confidence Calibration')
    expect(SHORT_LABELS.LG.join(' ')).toBe('Logic Games')
    expect(COMPACT_LABELS.CAL).toBe('Calibration')
    expect(COMPACT_LABELS.LG).toBe('Logic Games')
  })
})

describe('the session parts', () => {
  it('are titled with the name of the skill they measure, in Title Case', () => {
    for (const s of Object.values(SEGMENT_INFO)) {
      expect(s.title).toBe(axisName(s.axes[0]!))
      expect(titleCase(s.title), s.title).toBe(true)
    }
    expect(Object.values(SEGMENT_INFO).map((s) => s.title)).toEqual(['Reaction Time', 'Matrix & Series', 'Spatial', 'Working Memory', 'Quantitative Reasoning', 'Processing & Reading Speed'])
  })

  it('skip buttons, notices and the checklist use the same names', () => {
    for (const code of AXIS_CODES) expect(skipTargetName(code)).toBe(axisName(code))
  })
})

// ------------------------------------------------------------------------- source scan

/** Every non-test `.ts` and `.svelte` file under src/, by its path from src/ ("session/segments.ts"). */
const SOURCES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(import.meta.glob<string>(['./**/*.ts', './**/*.svelte', '!./**/*.test.ts', '!./**/__fixtures__/**'], { query: '?raw', import: 'default', eager: true })).map(([k, v]) => [k.slice(2), v]),
)

describe('no screen spells a research name or reads a registry name directly', () => {
  /** The places that draw or say a skill's name: session, results, charts, share card, server panels. */
  const UI_DIRS = ['session', 'reveal', 'viz', 'backend', 'brief', 'render', 'dev']

  it('the research names are spelled only in the engine registry and in the module that replaces them', () => {
    expect(Object.keys(SOURCES)).toContain('session/Checklist.svelte')
    const allowed = new Set(['engine/axes.ts', 'axis-names.ts'])
    const hits = Object.entries(SOURCES).filter(([f, text]) => !allowed.has(f) && JARGON.some((j) => text.includes(j)))
    expect(hits.map(([f]) => f)).toEqual([])
  })

  it('UI code takes a skill name from axis-names.ts, never from the registry', () => {
    // A registry entry's name: `axis(code).name`, or `def.name` / `a.name` in a file that imports the registry.
    const registryName = /\b(?:axis|axisDef)\([^()]*\)\.name\b|\b(?:def|a)\.name\b/
    const ui = Object.entries(SOURCES).filter(([f]) => UI_DIRS.some((d) => f.startsWith(`${d}/`)))
    expect(ui.length).toBeGreaterThan(100)
    const hits = ui.filter(([, text]) => /from '(?:\.\.?\/)+engine\/axes'/.test(text) && registryName.test(text))
    expect(hits.map(([f]) => f)).toEqual([])
  })
})
