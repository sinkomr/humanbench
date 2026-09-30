/**
 * The share card (ROADMAP M1.18; DESIGN §9.9; R-5.6.1, R-5.6.4; Phase AI proposal v2 §8 "M1.18:
 * notes text never appears on the card (test)"): the size, which skills are on it, the emotion rule,
 * that a hidden skill leaves no trace, that only known words are on it, that the blob rules hold
 * (linear radius, uncertainty shown, no total), and that it stays legible and inside its frame.
 * The picture is a string, so all of it is checked in Node; `card.dom.test.ts` parses it as XML and
 * compares it with the on-page chart.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DISCLAIMER, RESOURCE_LINE } from '../copy'
import { AXIS_CODES, axis, type AxisCode } from '../engine/axes'
import { NOTES_LEAK_MARKERS } from '../brief/leak-markers'
import { PREAMBLE, RESULTS_TALK, RESULTS_TALK_TEXT, REVEAL_CARD } from '../brief/results-talk'
import { distinctivePeaks } from '../reveal/peaks'
import { DEFAULT_R, MIN_TEXT_PX, N_FUZZ } from './blob'
import {
  buildCard,
  CARD_COLUMN_W,
  CARD_H,
  CARD_MAX_PEAKS,
  CARD_W,
  cardAxes,
  cardPeaks,
  cardSvg,
  cardTextWidth,
  columnTexts,
  EMO_MIN_THETA,
  isWithheld,
  MIN_CARD_SKILLS,
  PNG_SCALE,
  type CardModel,
  type CardPeak,
} from './card'
import { CARD_BRAND, CARD_NO_PEAKS, CARD_NOTE_READING, CARD_NOTE_SCALE, CARD_PEAKS_HEADING, CARD_PEAKS_SUB, CARD_PURPOSE, CARD_TITLE, cardSessions } from './card-copy'
import { RING_NOTE } from './copy'
import { formatTheta, radiusScale, RING_THETAS, ringLabel } from './geometry'
import { THEMES } from './palette'
import { axisEstimates, measuredFields, type AxisEstimate } from './profile'
import { syntheticProfile } from './synthetic'

// ---------------------------------------------------------------------------------- fixtures

const estimatesOf = (id: string): AxisEstimate[] => axisEstimates(syntheticProfile(id)!.input)
const peaksOf = (id: string): CardPeak[] => {
  const input = syntheticProfile(id)!.input
  const measured = axisEstimates(input)
    .filter((e) => e.measured)
    .map((e) => e.code)
  return distinctivePeaks(input.score, measured, { max: AXIS_CODES.length })
}
/** `est` with one skill measured at `theta` ± `sd`. */
const withSkill = (est: readonly AxisEstimate[], code: AxisCode, theta: number, sd = 0.4): AxisEstimate[] =>
  est.map((e) => (e.code === code ? { ...e, ...measuredFields(theta, sd), reason: undefined } : e))

const FULL = estimatesOf('full')
const FULL_PEAKS = peaksOf('full')

// ------------------------------------------------------------------------- reading the SVG

const unesc = (s: string): string => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]!)

/** The text of every leaf `<text>`, `<tspan>`, `<title>` and `<desc>`, unescaped, in document order. */
function textsOf(svg: string): string[] {
  return [...svg.matchAll(/<(text|tspan|title|desc)\b[^>]*>([^<]+)<\/\1>/g)].map((m) => unesc(m[2]!))
}

/** One string per spoke label (its lines joined by a space, tier glyphs removed), in spoke order. */
function spokeLabels(svg: string): string[] {
  return [...svg.matchAll(/<text class="label[^"]*"[^>]*>(.*?)<\/text>/g)].map((m) =>
    [...m[1]!.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)]
      .map((t) => unesc(t[1]!).replace(/ [○◇]$/, ''))
      .join(' '),
  )
}

/** Every label form an axis can have on a card: full lines joined, or the compact one-liner. */
function labelForms(e: AxisEstimate): string[] {
  return [e.shortLabel.join(' '), e.compactLabel ?? '']
}

function markerRadii(svg: string): number[] {
  return [...svg.matchAll(/<circle class="marker" cx="(-?[\d.]+)" cy="(-?[\d.]+)" r="4.5"\/>/g)].map((m) => Math.hypot(Number(m[1]), Number(m[2])))
}

const NOTES_PROBES: readonly string[] = [
  // The "Working with AI" card and the results-talk helper (AI.6b), and the notes module's own list
  // of what a share card must not contain (leak-markers.ts).
  PREAMBLE,
  RESULTS_TALK_TEXT,
  RESULTS_TALK.heading,
  RESULTS_TALK.neverPaste,
  REVEAL_CARD.heading,
  REVEAL_CARD.body,
  REVEAL_CARD.link,
  ...NOTES_LEAK_MARKERS,
  RESOURCE_LINE,
  DISCLAIMER,
  // The notes grammar (Phase AI proposal v2 §3.4, §4): header and fixed clauses.
  'my own preferences, not an assessment of me',
  'My requests in the chat win over these notes',
  'Keep full accuracy',
  'Tell me plainly when I',
  "don't save them",
  'hb-brief',
  'SKILL.md',
]

// ------------------------------------------------------------------------------------ tests

describe('the card is exactly 1200 × 630 CSS px (2400 × 1260 at 2×)', () => {
  const card = buildCard({ estimates: FULL, peaks: FULL_PEAKS, sessions: 2 })

  it('has those constants', () => {
    expect([CARD_W, CARD_H, PNG_SCALE]).toEqual([1200, 630, 2])
    expect([CARD_W * PNG_SCALE, CARD_H * PNG_SCALE]).toEqual([2400, 1260])
  })

  it('the SVG export is a 1200 × 630 document with that viewBox', () => {
    expect(card.svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"')).toBe(true)
    expect(card.svg.match(/<svg\b/g)).toHaveLength(1)
    expect(card.svg).toContain('<rect width="1200" height="630"')
  })

  it('the PNG source is the same picture at 2400 × 1260: the viewBox and content do not change', () => {
    const big = cardSvg(card, PNG_SCALE)
    expect(big).toContain('width="2400" height="1260" viewBox="0 0 1200 630"')
    expect(big.replace('width="2400" height="1260"', 'width="1200" height="630"')).toBe(card.svg)
  })

  it('is deterministic: the same inputs give the same bytes', () => {
    expect(buildCard({ estimates: FULL, peaks: FULL_PEAKS, sessions: 2 }).svg).toBe(card.svg)
  })

  it('needs at least three skills and a positive whole number of sessions', () => {
    const hide = AXIS_CODES.slice(0, AXIS_CODES.length - (MIN_CARD_SKILLS - 1))
    expect(() => buildCard({ estimates: FULL, hidden: hide, sessions: 1 })).toThrow(RangeError)
    expect(buildCard({ estimates: FULL, hidden: hide.slice(1), sessions: 1 }).shown).toHaveLength(MIN_CARD_SKILLS)
    for (const sessions of [0, -1, 1.5, Number.NaN]) expect(() => buildCard({ estimates: FULL, sessions })).toThrow(RangeError)
  })
})

describe('which skills are on the card', () => {
  it('draws measured skills only, in spoke order, and leaves not-measured ones out entirely', () => {
    const est = estimatesOf('m1')
    const card = buildCard({ estimates: est, peaks: peaksOf('m1'), sessions: 1 })
    const measured = est.filter((e) => e.measured)
    expect(measured.length).toBeGreaterThan(0)
    expect(measured.length).toBeLessThan(est.length)
    expect(card.shown).toEqual(measured.map((e) => e.code))
    expect(cardAxes(est).map((a) => a.status)).toEqual(est.map((e) => (e.measured ? 'shown' : 'unmeasured')))
    // No stub, no "not measured" note, no dashed spoke.
    expect(card.svg).not.toMatch(/not measured|insufficient data|class="stub"|class="gap"/i)
    for (const e of est.filter((x) => !x.measured)) expect(spokeLabels(card.svg).some((l) => labelForms(e).includes(l))).toBe(false)
  })

  it('a hidden skill has no label, no spoke, no marker, no peak and no mention in the description', () => {
    const hidden = FULL_PEAKS[0]!.code
    const card = buildCard({ estimates: FULL, peaks: FULL_PEAKS, hidden: [hidden, 'KHU'], sessions: 2 })
    const gone = FULL.filter((e) => e.code === hidden || e.code === 'KHU')
    expect(card.shown).toHaveLength(FULL.length - 2)
    const labels = spokeLabels(card.svg)
    expect(labels).toHaveLength(card.shown.length)
    expect((card.svg.match(/class="spoke"/g) ?? []).length).toBe(card.shown.length)
    expect(markerRadii(card.svg)).toHaveLength(card.shown.length)
    for (const e of gone) {
      expect(labels.some((l) => labelForms(e).includes(l)), e.name).toBe(false)
      expect(textsOf(card.svg), e.name).not.toContain(e.name)
      expect(card.alt).not.toContain(e.name)
    }
    expect(card.peaks.map((p) => p.code)).not.toContain(hidden)
    // The desc lists exactly the shown skills' names.
    const desc = /<desc[^>]*>([^<]*)<\/desc>/.exec(card.svg)![1]!
    const skills = unesc(desc).split(' Skills: ')[1]!.replace(/\.$/, '').split(', ')
    expect(skills).toEqual(card.shown.map((c) => axis(c).name))
  })

  it('is byte-identical, for the same peaks, whatever a hidden skill estimates: nothing of a hidden value reaches the picture (property)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: AXIS_CODES.length - 1 }), { minLength: 1, maxLength: AXIS_CODES.length - MIN_CARD_SKILLS }),
        fc.array(fc.tuple(fc.double({ min: -3, max: 3, noNaN: true }), fc.double({ min: 0.05, max: 1.5, noNaN: true })), { minLength: AXIS_CODES.length, maxLength: AXIS_CODES.length }),
        fc.constantFrom<'light' | 'dark'>('light', 'dark'),
        (idx, vals, theme) => {
          const hidden = idx.map((i) => AXIS_CODES[i]!)
          const changed = FULL.map((e) => {
            const v = vals[AXIS_CODES.indexOf(e.code)]!
            return hidden.includes(e.code) ? { ...e, ...measuredFields(v[0], v[1]) } : e
          })
          const a = buildCard({ estimates: FULL, hidden, peaks: FULL_PEAKS, sessions: 2, theme })
          const b = buildCard({ estimates: changed, hidden, peaks: FULL_PEAKS, sessions: 2, theme })
          expect(b.svg).toBe(a.svg)
        },
      ),
      { numRuns: 150 },
    )
  })

  it('a hidden skill\'s name never appears as a text of the card, for any subset (property)', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 0, max: AXIS_CODES.length - 1 }), { minLength: 1, maxLength: AXIS_CODES.length - MIN_CARD_SKILLS }), (idx) => {
        const hidden = idx.map((i) => AXIS_CODES[i]!)
        const card = buildCard({ estimates: FULL, hidden, peaks: FULL_PEAKS, sessions: 1 })
        const texts = textsOf(card.svg)
        const labels = spokeLabels(card.svg)
        for (const code of hidden) {
          const e = FULL.find((x) => x.code === code)!
          expect(texts).not.toContain(e.name)
          expect(labels.some((l) => labelForms(e).includes(l)), e.name).toBe(false)
        }
        expect(card.shown.every((c) => !hidden.includes(c))).toBe(true)
      }),
      { numRuns: 100 },
    )
  })
})

describe('emotion lows are never on the card (R-5.6.4)', () => {
  const emo = axis('EMO')

  it('Emotion Reading below the 0 SD ring is withheld, hidden or not; at or above it, it is offered', () => {
    expect(EMO_MIN_THETA).toBe(0)
    for (const [theta, withheld] of [
      [-2.5, true],
      [-0.6, true],
      [-0.01, true],
      [0, false],
      [0.01, false],
      [1.4, false],
    ] as const) {
      const est = withSkill(FULL, 'EMO', theta)
      const row = cardAxes(est).find((a) => a.estimate.code === 'EMO')!
      expect(row.status, `θ = ${theta}`).toBe(withheld ? 'withheld' : 'shown')
      expect(cardAxes(est, ['EMO']).find((a) => a.estimate.code === 'EMO')!.status).toBe(withheld ? 'withheld' : 'hidden')
      expect(isWithheld(est.find((e) => e.code === 'EMO')!)).toBe(withheld)
    }
  })

  it('only Emotion Reading is withheld by that rule, and only when it is measured', () => {
    const low = withSkill(FULL, 'EMO', -2)
    expect(cardAxes(low).filter((a) => a.status === 'withheld').map((a) => a.estimate.code)).toEqual(['EMO'])
    // A very low estimate on any other skill is the person's to hide, not the card's to withhold.
    const lowMat = withSkill(FULL, 'MAT', -2.9)
    expect(cardAxes(lowMat).filter((a) => a.status === 'withheld')).toEqual([])
    // Not measured: nothing to withhold.
    expect(cardAxes(estimatesOf('m1')).find((a) => a.estimate.code === 'EMO')!.status).toBe('unmeasured')
  })

  it('a low Emotion Reading is not drawn, named, listed or described, whatever the person did', () => {
    const est = withSkill(FULL, 'EMO', -1.6)
    // Even as a "credible peak" of a profile whose own mean is far lower.
    const peaks: CardPeak[] = [{ code: 'EMO', name: emo.name, contrast: 1.1, lo90: 0.3, hi90: 1.9 }, ...FULL_PEAKS.filter((p) => p.code !== 'EMO')]
    const card = buildCard({ estimates: est, peaks, sessions: 3 })
    expect(card.shown).not.toContain('EMO')
    expect(card.peaks.map((p) => p.code)).not.toContain('EMO')
    const everything = [textsOf(card.svg).join('\n'), card.alt, card.inner].join('\n')
    expect(everything).not.toMatch(/Emotion|scenarios/)
    // Byte-identical to the card of a person who hid it, and to one whose estimate is even lower.
    expect(buildCard({ estimates: est, peaks, hidden: ['EMO'], sessions: 3 }).svg).toBe(card.svg)
    expect(buildCard({ estimates: withSkill(FULL, 'EMO', -3), peaks, sessions: 3 }).svg).toBe(card.svg)
  })

  it('a high Emotion Reading may be shown, and the person can still hide it', () => {
    const est = withSkill(FULL, 'EMO', 1.2)
    const on = buildCard({ estimates: est, sessions: 1 })
    expect(on.shown).toContain('EMO')
    expect(spokeLabels(on.svg).some((l) => labelForms(est.find((e) => e.code === 'EMO')!).includes(l))).toBe(true)
    const off = buildCard({ estimates: est, hidden: ['EMO'], sessions: 1 })
    expect(off.shown).not.toContain('EMO')
    expect(off.svg).not.toContain('Emotion')
  })

  it('withheld exactly when the estimate is below 0, for any estimate (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: -3, max: 3, noNaN: true }), fc.double({ min: 0.05, max: 1.5, noNaN: true }), (theta, sd) => {
        const est = withSkill(FULL, 'EMO', theta, sd)
        const status = cardAxes(est).find((a) => a.estimate.code === 'EMO')!.status
        expect(status).toBe(theta < 0 ? 'withheld' : 'shown')
        if (theta < 0) expect(buildCard({ estimates: est, sessions: 1 }).shown).not.toContain('EMO')
      }),
    )
  })

  it('no text of the card ever names a skill as a weakness', () => {
    const card = buildCard({ estimates: withSkill(FULL, 'MAT', -2.5), peaks: FULL_PEAKS, sessions: 1 })
    expect(textsOf(card.svg).join('\n')).not.toMatch(/weak|worst|lowest|low score|below average|needs work|struggl/i)
  })
})

describe('the most distinctive peaks on the card', () => {
  it('lists at most three, strongest first, all on the card', () => {
    expect(FULL_PEAKS.length).toBeGreaterThanOrEqual(CARD_MAX_PEAKS)
    const card = buildCard({ estimates: FULL, peaks: FULL_PEAKS, sessions: 2 })
    expect(card.peaks).toHaveLength(CARD_MAX_PEAKS)
    const sorted = [...FULL_PEAKS].sort((a, b) => b.contrast - a.contrast)
    expect(card.peaks.map((p) => p.code)).toEqual(sorted.slice(0, CARD_MAX_PEAKS).map((p) => p.code))
    const names = textsOf(card.svg)
    for (const p of card.peaks) expect(names).toContain(axis(p.code).name)
  })

  it('leaves out the peak of a hidden skill and lists the next one; a hidden skill is never listed (property over any subset)', () => {
    const [first, ...rest] = [...FULL_PEAKS].sort((a, b) => b.contrast - a.contrast)
    const card = buildCard({ estimates: FULL, peaks: FULL_PEAKS, hidden: [first!.code], sessions: 2 })
    expect(card.peaks.map((p) => p.code)).toEqual(rest.slice(0, CARD_MAX_PEAKS).map((p) => p.code))
    const peakArb = fc.record({
      code: fc.constantFrom(...AXIS_CODES),
      contrast: fc.double({ min: 0.1, max: 3, noNaN: true }),
      lo90: fc.double({ min: 0.01, max: 1, noNaN: true }),
      hi90: fc.double({ min: 1, max: 4, noNaN: true }),
    })
    fc.assert(
      fc.property(fc.array(peakArb, { maxLength: 8 }), fc.uniqueArray(fc.constantFrom(...AXIS_CODES), { maxLength: 6 }), (peaks, shown) => {
        const listed = cardPeaks(peaks, shown)
        expect(listed.length).toBeLessThanOrEqual(CARD_MAX_PEAKS)
        for (const p of listed) expect(shown).toContain(p.code)
        for (let i = 1; i < listed.length; i++) expect(listed[i - 1]!.contrast).toBeGreaterThanOrEqual(listed[i]!.contrast)
      }),
    )
  })

  it('states each peak\'s 90% range, like the results page, and writes the name from the registry only', () => {
    const p: CardPeak = { code: 'MAT', name: 'ZZ caller-supplied name', contrast: 0.94, lo90: 0.38, hi90: 1.5 }
    const card = buildCard({ estimates: FULL, peaks: [p], sessions: 1 })
    const texts = textsOf(card.svg)
    expect(texts).toContain(axis('MAT').name)
    expect(texts).toContain('Stands out by about 0.9 SD')
    expect(texts).toContain(`90% range ${formatTheta(0.38, 1)} to ${formatTheta(1.5, 1)} SD`)
    expect(card.svg).not.toContain('ZZ caller-supplied')
  })

  it('drops a peak with a non-finite number, and says so plainly when there is none', () => {
    const bad: CardPeak = { code: 'MAT', contrast: Number.NaN, lo90: 0.1, hi90: 0.9 }
    expect(cardPeaks([bad], ['MAT'])).toEqual([])
    const card = buildCard({ estimates: estimatesOf('sparse'), peaks: [], sessions: 1 })
    expect(card.peaks).toEqual([])
    expect(textsOf(card.svg).join(' ')).toContain(CARD_NO_PEAKS)
    expect(textsOf(card.svg)).not.toContain(CARD_PEAKS_HEADING)
    // The sentence about overlapping ranges is in the small print, once; the peaks line does not repeat it.
    expect(textsOf(card.svg).join(' ').split('Ranges that overlap are not real differences.')).toHaveLength(2)
  })

  it('never lists a low, or a peak whose range does not clear 0, whatever it is given (R-5.6.4)', () => {
    const low: CardPeak = { code: 'MAT', contrast: -1.2, lo90: -1.8, hi90: -0.6 }
    const unclear: CardPeak = { code: 'QR', contrast: 0.4, lo90: -0.2, hi90: 1.0 }
    const zero: CardPeak = { code: 'SPA', contrast: 0.5, lo90: 0, hi90: 1.0 }
    expect(cardPeaks([low, unclear, zero], ['MAT', 'QR', 'SPA'])).toEqual([])
    const card = buildCard({ estimates: FULL, peaks: [low, unclear, zero], sessions: 1 })
    expect(card.peaks).toEqual([])
    const texts = textsOf(card.svg).join(' ')
    expect(texts).not.toMatch(/Stands out|90% range/)
    expect(texts).toContain(CARD_NO_PEAKS)
    // A credible peak next to them is the only one listed, with its own numbers.
    const good: CardPeak = { code: 'WM', contrast: 0.8, lo90: 0.3, hi90: 1.3 }
    expect(cardPeaks([low, good, unclear], ['MAT', 'QR', 'WM']).map((p) => p.code)).toEqual(['WM'])
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            code: fc.constantFrom(...AXIS_CODES),
            contrast: fc.double({ min: -3, max: 3, noNaN: true }),
            lo90: fc.double({ min: -3, max: 3, noNaN: true }),
            hi90: fc.double({ min: -3, max: 3, noNaN: true }),
          }),
          { maxLength: 8 },
        ),
        (peaks) => {
          for (const p of cardPeaks(peaks, AXIS_CODES)) {
            expect(p.contrast).toBeGreaterThan(0)
            expect(p.lo90).toBeGreaterThan(0)
          }
          const words = textsOf(buildCard({ estimates: FULL, peaks, sessions: 1 }).svg).join(' ')
          expect(words).not.toMatch(/Stands out by about -/)
          expect(words).not.toMatch(/90% range −/)
        },
      ),
      { numRuns: 60 },
    )
  })
})

describe('only known words are on the card; notes for an AI never are (proposal §8, M1.18)', () => {
  /** Whether a column text is one of the card\'s own lines. */
  function columnAllowed(t: string, card: CardModel, sessions: number): boolean {
    if ([CARD_BRAND, CARD_TITLE, cardSessions(sessions), CARD_PEAKS_HEADING, CARD_PEAKS_SUB, CARD_PURPOSE].includes(t)) return true
    if (/^Stands out by about \d\.\d SD$/.test(t) || /^90% range [+−]\d\.\d to [+−]\d\.\d SD$/.test(t)) return true
    if (card.peaks.some((p) => axis(p.code).name.includes(t))) return true
    return [CARD_NOTE_SCALE, CARD_NOTE_READING, CARD_NO_PEAKS].some((sentence) => sentence.includes(t))
  }

  const profiles = ['m1', 'full', 'skipped', 'sparse'] as const

  it.each(profiles)('every text of the %s card is an axis label, a ring label, the ring note or a line of the card copy', (id) => {
    const est = estimatesOf(id)
    const sessions = 3
    const card = buildCard({ estimates: est, peaks: peaksOf(id), sessions })
    const shown = est.filter((e) => card.shown.includes(e.code))
    const allowed = new Set<string>([...RING_THETAS.map(ringLabel), ...RING_NOTE, CARD_TITLE])
    for (const e of shown) for (const line of [...e.shortLabel, e.compactLabel!]) [line, `${line} ${e.glyph}`].forEach((x) => allowed.add(x))
    const column = new Set(card.texts.map((t) => t.text))
    const strays: string[] = []
    for (const t of textsOf(card.svg)) {
      if (allowed.has(t) || column.has(t) && columnAllowed(t, card, sessions)) continue
      if (t.startsWith('Skill profile blob with ')) continue // the description, checked in the hidden-skill test
      strays.push(t)
    }
    expect(strays).toEqual([])
    // ...and the column itself is only the card's own lines.
    for (const t of card.texts) expect(columnAllowed(t.text, card, sessions), t.text).toBe(true)
  })

  it('contains none of the notes strings, the results-talk helper, the resource line or the disclaimer', () => {
    for (const id of profiles) {
      for (const theme of ['light', 'dark'] as const) {
        const card = buildCard({ estimates: estimatesOf(id), peaks: peaksOf(id), sessions: 2, theme })
        const svg = card.svg.toLowerCase()
        for (const probe of NOTES_PROBES) expect(svg, probe).not.toContain(probe.toLowerCase())
        expect(svg).not.toMatch(/notes for your ai|preamble|save file|paste/)
      }
    }
  })

  it('has no input that could carry notes: extra fields on the input or on a peak are ignored', () => {
    const marker = 'ZZ-NOTES-MARKER My requests in the chat win over these notes'
    const input = { estimates: FULL, peaks: FULL_PEAKS.map((p) => ({ ...p, note: marker, text: marker })), sessions: 2, notes: marker, brief: marker, caption: marker, title: marker }
    const card = buildCard(input as Parameters<typeof buildCard>[0])
    expect(card.svg).not.toContain('ZZ-NOTES-MARKER')
    expect(card.svg).toBe(buildCard({ estimates: FULL, peaks: FULL_PEAKS, sessions: 2 }).svg)
    // The estimates' free-form fields are not drawn either: labels come from the registry.
    const tainted = FULL.map((e) => ({ ...e, name: marker, shortLabel: [marker], compactLabel: marker, glyph: marker }))
    expect(buildCard({ estimates: tainted, peaks: FULL_PEAKS, sessions: 2 }).svg).toBe(card.svg)
  })

  it('shows no total, mean, area, rank or single score anywhere (CLAUDE.md blob rule, §9.5 a)', () => {
    for (const id of profiles) {
      const card = buildCard({ estimates: estimatesOf(id), peaks: peaksOf(id), sessions: 1 })
      const text = textsOf(card.svg).join('\n')
      expect(text).not.toMatch(/\b(total|overall|average|mean|score|scores|rank|percentile|area|iq)\b/i)
      expect(card.svg).not.toMatch(/data-|<a\b|href=|<script|<image|<foreignObject/i)
    }
  })

  it('says the scale is provisional, in the picture itself (A12)', () => {
    const card = buildCard({ estimates: FULL, sessions: 1 })
    expect(textsOf(card.svg)).toEqual(expect.arrayContaining(RING_NOTE as string[]))
    expect(textsOf(card.svg).join(' ')).toContain('provisional')
  })
})

describe('the blob on the card follows the blob rules (DESIGN §9, CLAUDE.md)', () => {
  it('radius is linear in θ over [−3, 3]: every marker sits at r = R(θ + 3)/6', () => {
    const r = radiusScale(DEFAULT_R)
    for (const id of ['m1', 'full', 'skipped'] as const) {
      const est = estimatesOf(id)
      const card = buildCard({ estimates: est, sessions: 1 })
      const radii = markerRadii(card.svg)
      const measured = est.filter((e) => card.shown.includes(e.code))
      expect(radii).toHaveLength(measured.length)
      radii.forEach((got, i) => expect(got).toBeCloseTo(r(measured[i]!.theta!), 1))
    }
    // The map itself is linear between the clamps.
    expect(r(0)).toBeCloseTo(DEFAULT_R / 2, 9)
    expect(r(1.5) - r(0.5)).toBeCloseTo(r(-0.5) - r(-1.5), 9)
  })

  it('shows uncertainty: the band, the 20-curve fuzz, a whisker per skill, and the hollow muted marks', () => {
    const est = estimatesOf('sparse')
    const card = buildCard({ estimates: est, sessions: 1 })
    expect(card.svg).toContain('class="band"')
    expect((card.svg.match(/<g class="fuzz">(.*?)<\/g>/s)![1]!.match(/<path /g) ?? []).length).toBe(N_FUZZ)
    expect((card.svg.match(/class="whisker"/g) ?? []).length).toBe(card.shown.length)
    // Few items: wide intervals, so some marks are muted (§9.5).
    expect(card.svg).toContain('class="mark muted"')
    expect(card.svg).toContain('class="crisp-muted"')
  })

  it('uses only the palette of the chosen scheme, with the page background as the card background', () => {
    for (const theme of ['light', 'dark'] as const) {
      const t = THEMES[theme]
      const card = buildCard({ estimates: FULL, sessions: 1, theme })
      const allowed = new Set(Object.values(t).map((c) => c.toLowerCase()))
      const used = new Set((card.svg.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((c) => c.toLowerCase()))
      for (const c of used) expect(allowed.has(c), `${theme} ${c}`).toBe(true)
      expect(card.svg).toContain(`<rect width="1200" height="630" fill="${t.bg}"/>`)
      expect(card.svg).not.toMatch(/var\(--/)
    }
    // Same geometry in both schemes.
    const light = buildCard({ estimates: FULL, sessions: 1, theme: 'light' })
    const dark = buildCard({ estimates: FULL, sessions: 1, theme: 'dark' })
    expect(dark.placement.scale).toBe(light.placement.scale)
    expect(dark.svg).not.toBe(light.svg)
  })

  it('the card text (blob and column) has sufficient contrast tokens: only the palette\'s text colours are used for text', () => {
    const t = THEMES.light
    const card = buildCard({ estimates: FULL, peaks: FULL_PEAKS, sessions: 1 })
    const textFills = new Set(card.texts.map((x) => t[x.fill]))
    for (const c of textFills) expect([t.text, t.textStrong, t.textAccent, t.textMuted]).toContain(c)
  })
})

describe('layout: legible and inside the frame', () => {
  const eachShownCount = (): number[] => Array.from({ length: AXIS_CODES.length - MIN_CARD_SKILLS + 1 }, (_, i) => i + MIN_CARD_SKILLS)

  function checkFrame(card: CardModel): void {
    const { model, scale, tx, ty, smallPx } = card.placement
    expect(smallPx).toBeGreaterThanOrEqual(MIN_TEXT_PX - 0.01)
    const boxes = [...model.labelBoxes, model.noteBox]
    for (const b of boxes) {
      expect(b.x0 * scale + tx).toBeGreaterThanOrEqual(0)
      expect(b.x1 * scale + tx).toBeLessThanOrEqual(700)
      expect(b.y0 * scale + ty).toBeGreaterThanOrEqual(0)
      expect(b.y1 * scale + ty).toBeLessThanOrEqual(CARD_H)
    }
    // The circle (with its wedges) is inside the frame too.
    const rim = (DEFAULT_R + 4) * scale
    expect(tx - rim).toBeGreaterThanOrEqual(0)
    expect(tx + rim).toBeLessThanOrEqual(700)
    expect(ty - rim).toBeGreaterThanOrEqual(0)
    expect(ty + rim).toBeLessThanOrEqual(CARD_H)
  }

  it('for any number of skills from 3 to 17 the blob is legible, inside its part of the card, and clear of the column', () => {
    for (const n of eachShownCount()) {
      const hidden = AXIS_CODES.slice(n) // keep the first n in canonical order, hide the rest
      checkFrame(buildCard({ estimates: FULL, hidden, peaks: FULL_PEAKS, sessions: 1 }))
    }
  })

  it('for any subset (property)', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 0, max: AXIS_CODES.length - 1 }), { minLength: 0, maxLength: AXIS_CODES.length - MIN_CARD_SKILLS }), (idx) => {
        checkFrame(buildCard({ estimates: FULL, hidden: idx.map((i) => AXIS_CODES[i]!), peaks: FULL_PEAKS, sessions: 1 }))
      }),
      { numRuns: 100 },
    )
  })

  it('the right column fits its width and its lines do not overlap, with three long-named peaks', () => {
    const long: CardPeak[] = (['EMO', 'PS', 'KAP'] as const).map((code, i) => ({ code, contrast: 1.5 - i * 0.1, lo90: 0.2, hi90: 2.9 }))
    for (const [peaks, sessions] of [[long, 12], [FULL_PEAKS, 1], [[], 99]] as const) {
      const texts = columnTexts(sessions, peaks)
      expect(texts.filter((t) => t.size === 22)).toHaveLength(Math.min(peaks.length, CARD_MAX_PEAKS))
      for (const t of texts) {
        expect(cardTextWidth(t), t.text).toBeLessThanOrEqual(CARD_COLUMN_W)
        expect(t.y + 0.25 * t.size).toBeLessThanOrEqual(CARD_H)
      }
      const sorted = [...texts].sort((a, b) => a.y - b.y)
      for (let i = 1; i < sorted.length; i++) {
        const above = sorted[i - 1]!
        const below = sorted[i]!
        expect(below.y - 0.8 * below.size, `${above.text} / ${below.text}`).toBeGreaterThan(above.y + 0.2 * above.size - 1e-9)
      }
    }
  })
})
