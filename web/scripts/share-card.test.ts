/**
 * Source-level guards of the share card (ROADMAP M1.18; DESIGN §9.9 "Everything happens
 * client-side; no image server"; R-5.6.1, R-17.12; Phase AI proposal v2 §8 "notes text never
 * appears on the card"):
 * - the card's modules make no request, store nothing, and do not import the notes module;
 * - the language lint scans them, and what they render passes it (A13);
 * - the card is not given the R-5.6.5 resource sentence or the §13 disclaimer.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DISCLAIMER, RESOURCE_LINE } from '../src/copy'
import { AXIS_CODES } from '../src/engine/axes'
import { distinctivePeaks } from '../src/reveal/peaks'
import { buildCard, cardSvg } from '../src/viz/card'
import * as cardCopy from '../src/viz/card-copy'
import { axisEstimates, measuredFields } from '../src/viz/profile'
import { SYNTHETIC_PROFILES } from '../src/viz/synthetic'
import { collectFiles, lintText } from './language-lint'

/** The files that make, draw or export the card. */
const CARD_FILES = ['src/viz/card.ts', 'src/viz/card-copy.ts', 'src/viz/export.ts', 'src/reveal/ShareCard.svelte'] as const

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8')

/** Code without comments (block, line and HTML), so a comment may say "no fetch" without failing. */
function code(rel: string): string {
  return read(rel)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
}

describe('the card makes no request and stores nothing (DESIGN §9.9)', () => {
  const FORBIDDEN: readonly [string, RegExp][] = [
    ['fetch', /\bfetch\s*\(/],
    ['XMLHttpRequest', /XMLHttpRequest/],
    ['sendBeacon', /sendBeacon/],
    ['WebSocket', /WebSocket|EventSource/],
    ['dynamic import', /\bimport\s*\(/],
    ['storage', /localStorage|sessionStorage|indexedDB|document\.cookie/],
    ['raw HTML', /innerHTML|outerHTML|@html|insertAdjacentHTML|document\.write/],
    ['a link out', /https?:\/\/(?!www\.w3\.org\/2000\/svg)/],
  ]
  for (const rel of CARD_FILES) {
    it(`${rel} has none of: ${FORBIDDEN.map(([n]) => n).join(', ')}`, () => {
      const src = code(rel)
      for (const [name, re] of FORBIDDEN) expect(re.test(src), `${rel}: ${name}`).toBe(false)
    })
  }

  it('does not import the notes module, the reveal slots of the notes, or the save file\'s content', () => {
    for (const rel of CARD_FILES) {
      const imports = [...code(rel).matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!)
      for (const spec of imports) {
        expect(spec, `${rel} imports ${spec}`).not.toMatch(/brief|notes|talk|slots/i)
      }
    }
    // The card and export code never read the save either; the panel only takes estimates and the score.
    for (const rel of ['src/viz/card.ts', 'src/viz/card-copy.ts', 'src/viz/export.ts']) {
      const imports = [...code(rel).matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!)
      for (const spec of imports) expect(spec, `${rel} imports ${spec}`).not.toMatch(/reveal|session|save\/(?!io)/)
    }
  })

  it('the panel takes no save, no notes and no copy from the reveal beyond its own share strings', () => {
    const imports = [...code('src/reveal/ShareCard.svelte').matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!)
    expect(imports.filter((s) => s.startsWith('.')).sort()).toEqual(['../engine/axes', '../save/clock', '../viz/card', '../viz/export', '../viz/palette', '../viz/profile', './copy', './peaks'].sort())
    const names = [...code('src/reveal/ShareCard.svelte').matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/copy'/g)].flatMap((m) => m[1]!.split(',').map((x) => x.trim()).filter((x) => x !== ''))
    expect(names.length).toBeGreaterThan(10)
    for (const n of names) expect(n, n).toMatch(/^SHARE_|^share/)
    // The label of the downloads that arrived with the UX-review answers (D15 C) is one of them.
    expect(names).toContain('SHARE_SAVE_COPY')
  })
})

describe('language lint (A13, R-5.6.1)', () => {
  it('scans the card\'s source files', () => {
    const files = collectFiles()
    for (const f of ['viz/card.ts', 'viz/card-copy.ts', 'viz/export.ts', 'reveal/ShareCard.svelte', 'reveal/copy.ts']) expect(files).toContain(`web/src/${f}`)
  })

  it('every string of the card copy passes the lint', () => {
    const strings: string[] = [
      ...(Object.values(cardCopy).filter((v) => typeof v === 'string') as string[]),
      cardCopy.cardSessions(1),
      cardCopy.cardSessions(3),
      cardCopy.cardPeakStands('0.9'),
      cardCopy.cardPeakRange('+0.1', '+1.0'),
      cardCopy.cardAlt(3, []),
      cardCopy.cardAlt(3, ['Matrix & Series', 'Spatial']),
    ]
    expect(strings.length).toBeGreaterThan(12)
    expect(lintText(strings.join('\n'), 'card-copy.txt')).toEqual([])
  })

  it('every card the app can draw passes the lint as an .svg file, in both schemes and both sizes', () => {
    for (const p of SYNTHETIC_PROFILES) {
      const estimates = axisEstimates(p.input)
      const measured = estimates.filter((e) => e.measured).map((e) => e.code)
      const peaks = measured.length >= 3 ? distinctivePeaks(p.input.score, measured, { max: AXIS_CODES.length }) : []
      for (const theme of ['light', 'dark'] as const) {
        const card = buildCard({ estimates, peaks, sessions: 2, theme })
        expect(lintText(card.svg, `${p.id}.svg`)).toEqual([])
        expect(lintText(cardSvg(card, 2), `${p.id}@2x.svg`)).toEqual([])
      }
    }
  })

  it('the resource sentence and the disclaimer are not on any card', () => {
    for (const p of SYNTHETIC_PROFILES) {
      const svg = buildCard({ estimates: axisEstimates(p.input), sessions: 1 }).svg
      expect(svg).not.toContain(RESOURCE_LINE)
      expect(svg).not.toContain(DISCLAIMER)
      expect(svg).not.toMatch(/clinic|diagnos|IQ\b|autis|ADHD/i)
    }
  })

  it('even a card whose Emotion Reading is measured low or high passes', () => {
    const base = axisEstimates(SYNTHETIC_PROFILES.find((p) => p.id === 'full')!.input)
    for (const theta of [-2, 0, 1.5]) {
      const est = base.map((e) => (e.code === 'EMO' ? { ...e, ...measuredFields(theta, 0.4) } : e))
      expect(lintText(buildCard({ estimates: est, sessions: 1 }).svg, 'emo.svg')).toEqual([])
    }
  })
})
