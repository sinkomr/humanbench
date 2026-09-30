/**
 * The share card panel in jsdom (ROADMAP M1.18; DESIGN §9.9; R-5.6.4; Phase AI proposal v2 §8): a
 * toggle for every measured skill, the preview that is exactly the exported card, PNG and SVG
 * exports (the browser objects are injected: jsdom has no canvas), the share sheet, and that
 * nothing of the notes, the results-talk helper, the resource line or a hidden skill reaches it.
 */

import { flushSync } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RESOURCE_LINE } from '../copy'
import { AXIS_CODES, axis, type AxisCode } from '../engine/axes'
import { buttonByText, click, render } from '../render/common/testing'
import { buildCard, cardAxes, cardSvg, type CardPeak } from '../viz/card'
import type { ImageShareOutcome, Raster } from '../viz/export'
import { axisEstimates, measuredFields, type AxisEstimate } from '../viz/profile'
import { syntheticProfile } from '../viz/synthetic'
import { distinctivePeaks } from './peaks'
import { NOTES_HEADING, NOTES_TEXT, TALK_PREAMBLE, TALK_TEXT } from './copy'
import ShareCard from './ShareCard.svelte'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  document.body.innerHTML = ''
})

const estimatesOf = (id: string): AxisEstimate[] => axisEstimates(syntheticProfile(id)!.input)
const peaksOf = (id: string): CardPeak[] => {
  const input = syntheticProfile(id)!.input
  const measured = axisEstimates(input)
    .filter((e) => e.measured)
    .map((e) => e.code)
  return distinctivePeaks(input.score, measured, { max: AXIS_CODES.length })
}
const withSkill = (est: readonly AxisEstimate[], code: AxisCode, theta: number, sd = 0.4): AxisEstimate[] =>
  est.map((e) => (e.code === code ? { ...e, ...measuredFields(theta, sd), reason: undefined } : e))

const TODAY = new Date(Date.UTC(2026, 8, 30, 12))

interface Mounted {
  readonly c: HTMLElement
  readonly makePng: ReturnType<typeof vi.fn>
  readonly saved: { blob: Blob; name: string }[]
  readonly shared: { blob: Blob; name: string }[]
}

function mountCard(over: Record<string, unknown> = {}): Mounted {
  const saved: Mounted['saved'] = []
  const shared: Mounted['shared'] = []
  const makePng = vi.fn(async (svg: string, width: number, height: number): Promise<Raster> => ({ blob: new Blob([svg], { type: 'image/png' }), width, height }))
  const r = render(ShareCard, {
    estimates: estimatesOf('full'),
    peaks: peaksOf('full'),
    sessions: 2,
    makePng,
    download: (blob: Blob, name: string) => void saved.push({ blob, name }),
    shareFile: async (blob: Blob, name: string): Promise<ImageShareOutcome> => (shared.push({ blob, name }), 'shared'),
    canShare: true,
    prepareMs: 0,
    today: () => TODAY,
    ...over,
  })
  cleanup = r.destroy
  return { c: r.container, makePng, saved, shared }
}

const checkbox = (c: HTMLElement, code: string): HTMLInputElement | null => c.querySelector<HTMLInputElement>(`input[data-skill="${code}"]`)
const codes = (c: HTMLElement): string[] => [...c.querySelectorAll<HTMLInputElement>('input[data-skill]')].map((i) => i.getAttribute('data-skill')!)
const preview = (c: HTMLElement): HTMLImageElement | null => c.querySelector<HTMLImageElement>('img[data-preview]')
const svgOf = (c: HTMLElement): string => {
  const src = preview(c)!.getAttribute('src')!
  return decodeURIComponent(src.slice(src.indexOf(',') + 1))
}
const status = (c: HTMLElement, which: 'count' | 'message'): string => c.querySelector(`[data-${which}]`)!.textContent ?? ''
const ready = (c: HTMLElement, name: string): Promise<void> => vi.waitFor(() => expect(buttonByText(c, name).disabled).toBe(false))

describe('the skills toggles', () => {
  it('offers one checkbox per measured skill, in spoke order, all ticked; not-measured skills get none', () => {
    const est = estimatesOf('m1')
    const m = mountCard({ estimates: est, peaks: peaksOf('m1') })
    const measured = est.filter((e) => e.measured).map((e) => e.code)
    expect(codes(m.c)).toEqual(measured)
    expect(measured.length).toBeLessThan(est.length)
    for (const box of m.c.querySelectorAll<HTMLInputElement>('input[data-skill]')) expect(box.checked).toBe(true)
    // Each is labelled with the skill's full name.
    for (const code of measured) expect(checkbox(m.c, code)!.closest('label')!.textContent!.trim()).toBe(axis(code).name)
    expect(status(m.c, 'count')).toBe(`${measured.length} skills are on the card.`)
  })

  it('unticking a skill takes it off the card at once; ticking it brings it back', () => {
    const est = estimatesOf('full')
    const m = mountCard()
    expect(svgOf(m.c)).toBe(buildCard({ estimates: est, peaks: peaksOf('full'), sessions: 2 }).svg)
    click(checkbox(m.c, 'MAT'))
    const without = buildCard({ estimates: est, peaks: peaksOf('full'), hidden: ['MAT'], sessions: 2 })
    expect(svgOf(m.c)).toBe(without.svg)
    expect(checkbox(m.c, 'MAT')!.checked).toBe(false)
    expect(status(m.c, 'count')).toBe(`${AXIS_CODES.length - 1} skills are on the card.`)
    expect(preview(m.c)!.getAttribute('alt')).toBe(without.alt)
    click(checkbox(m.c, 'MAT'))
    expect(svgOf(m.c)).toBe(buildCard({ estimates: est, peaks: peaksOf('full'), sessions: 2 }).svg)
    expect(status(m.c, 'count')).toBe(`${AXIS_CODES.length} skills are on the card.`)
  })

  it('"Hide all" leaves nothing to draw and says how many are needed; "Show all" brings the card back', async () => {
    const m = mountCard()
    click(buttonByText(m.c, 'Hide all'))
    expect(preview(m.c)).toBeNull()
    expect(status(m.c, 'count')).toBe('Tick at least 3 skills to make a card (0 ticked).')
    expect(buttonByText(m.c, 'Download image (PNG)').disabled).toBe(true)
    expect(buttonByText(m.c, 'Download vector image (SVG)').disabled).toBe(true)
    expect(m.c.querySelector('[data-preparing]')).toBeNull()
    for (const code of ['MAT', 'QR']) click(checkbox(m.c, code))
    expect(status(m.c, 'count')).toContain('(2 ticked)')
    expect(preview(m.c)).toBeNull()
    click(checkbox(m.c, 'SPA'))
    expect(preview(m.c)).not.toBeNull()
    expect(status(m.c, 'count')).toBe('3 skills are on the card.')
    click(buttonByText(m.c, 'Show all'))
    expect(codes(m.c).every((code) => checkbox(m.c, code)!.checked)).toBe(true)
    expect(svgOf(m.c)).toBe(buildCard({ estimates: estimatesOf('full'), peaks: peaksOf('full'), sessions: 2 }).svg)
    await ready(m.c, 'Download image (PNG)')
  })

  it('a hidden skill\'s name is nowhere in the preview, its description or the picture\'s peaks', () => {
    const m = mountCard()
    const top = peaksOf('full')[0]!
    click(checkbox(m.c, top.code))
    click(checkbox(m.c, 'KHU'))
    const svg = svgOf(m.c)
    for (const code of [top.code, 'KHU'] as const) {
      expect(svg).not.toContain(`>${axis(code).name}<`)
      expect(preview(m.c)!.getAttribute('alt')).not.toContain(axis(code).name)
    }
  })

  it('choosing dark colours redraws the card with the dark palette', () => {
    const m = mountCard()
    expect(svgOf(m.c)).toContain('fill="#ffffff"')
    click(m.c.querySelector('input[type="radio"][value="dark"]'))
    expect(svgOf(m.c)).toBe(buildCard({ estimates: estimatesOf('full'), peaks: peaksOf('full'), sessions: 2, theme: 'dark' }).svg)
    expect(svgOf(m.c)).toContain('fill="#15151a"')
  })
})

describe('Emotion Reading and the card (R-5.6.4)', () => {
  it('a low estimate gets no toggle, no mention on the card, and a plain note on the page', () => {
    const est = withSkill(estimatesOf('full'), 'EMO', -1.2)
    expect(cardAxes(est).find((a) => a.estimate.code === 'EMO')!.status).toBe('withheld')
    const m = mountCard({ estimates: est })
    expect(checkbox(m.c, 'EMO')).toBeNull()
    const note = m.c.querySelector('[data-emo-rule][data-withheld="EMO"]')!
    expect(note.textContent).toContain('Emotion Reading (text scenarios)')
    expect(note.textContent).toContain('Only put on a card when it is at or above the 0 SD ring')
    expect(svgOf(m.c)).not.toMatch(/Emotion|scenarios/)
    expect(preview(m.c)!.getAttribute('alt')).not.toMatch(/Emotion/)
    // "Show all" and "Hide all" cannot put it on.
    click(buttonByText(m.c, 'Show all'))
    expect(svgOf(m.c)).not.toMatch(/Emotion/)
    expect(status(m.c, 'count')).toBe(`${AXIS_CODES.length - 1} skills are on the card.`)
  })

  it('a high estimate is a toggle like any other', () => {
    const est = withSkill(estimatesOf('full'), 'EMO', 1.1)
    const m = mountCard({ estimates: est })
    // The same rule is stated whatever the estimate is; only a withheld skill lacks its toggle.
    expect(m.c.querySelector('[data-emo-rule]')).not.toBeNull()
    expect(m.c.querySelector('[data-withheld]')).toBeNull()
    expect(checkbox(m.c, 'EMO')!.checked).toBe(true)
    expect(svgOf(m.c)).toContain('Emotion Reading')
    click(checkbox(m.c, 'EMO'))
    expect(svgOf(m.c)).not.toContain('Emotion Reading')
  })
})

describe('the Emotion Reading note does not depend on the estimate', () => {
  it('says the same words for a low, a middling and a high estimate, and is absent when it was not measured', () => {
    const noteFor = (theta: number): string => {
      const m = mountCard({ estimates: withSkill(estimatesOf('full'), 'EMO', theta) })
      const t = m.c.querySelector('[data-emo-rule]')!.textContent!
      cleanup?.()
      cleanup = undefined
      return t
    }
    expect(new Set([noteFor(-2), noteFor(0), noteFor(2)]).size).toBe(1)
    const m = mountCard({ estimates: estimatesOf('m1'), peaks: peaksOf('m1') })
    expect(m.c.querySelector('[data-emo-rule]')).toBeNull()
  })
})

describe('the PNG and SVG exports', () => {
  it('the preview is the card at 1200 × 630, and is the SVG that gets exported', () => {
    const m = mountCard()
    const img = preview(m.c)!
    expect([img.getAttribute('width'), img.getAttribute('height')]).toEqual(['1200', '630'])
    expect(img.getAttribute('src')!.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
    expect(img.getAttribute('alt')).toMatch(/^Skill profile blob with 17 skills/)
    expect(svgOf(m.c)).toContain('width="1200" height="630" viewBox="0 0 1200 630"')
  })

  it('makes the PNG from the 2400 × 1260 document a moment after a change, and the PNG button waits for it', async () => {
    const m = mountCard()
    expect(buttonByText(m.c, 'Download image (PNG)').disabled).toBe(true)
    expect(m.c.querySelector('[data-preparing]')?.textContent).toBe('Preparing the PNG…')
    await ready(m.c, 'Download image (PNG)')
    expect(m.c.querySelector('[data-preparing]')).toBeNull()
    expect(m.makePng).toHaveBeenCalledTimes(1)
    const [svg, w, h] = m.makePng.mock.calls[0] as [string, number, number]
    expect([w, h]).toEqual([2400, 1260])
    const card = buildCard({ estimates: estimatesOf('full'), peaks: peaksOf('full'), sessions: 2 })
    expect(svg).toBe(cardSvg(card, 2))
    expect(svg).toContain('width="2400" height="1260" viewBox="0 0 1200 630"')
  })

  it('downloading the PNG hands over the prepared image under a dated name without any id, and says its size', async () => {
    const m = mountCard()
    await ready(m.c, 'Download image (PNG)')
    click(buttonByText(m.c, 'Download image (PNG)'))
    expect(m.saved).toHaveLength(1)
    expect(m.saved[0]!.name).toBe('humanbench-card-2026-09-30.png')
    expect(m.saved[0]!.blob.type).toBe('image/png')
    expect(status(m.c, 'message')).toBe('Image saved: 2400 × 1260 px.')
  })

  it('downloading the SVG hands over exactly the previewed document at once (no wait for the PNG)', async () => {
    const m = mountCard()
    click(buttonByText(m.c, 'Download vector image (SVG)'))
    expect(m.saved).toHaveLength(1)
    expect(m.saved[0]!.name).toBe('humanbench-card-2026-09-30.svg')
    expect(m.saved[0]!.blob.type).toContain('image/svg+xml')
    expect(await m.saved[0]!.blob.text()).toBe(svgOf(m.c))
    expect(status(m.c, 'message')).toBe('Vector image saved.')
  })

  it('a change starts a new PNG, the old one is dropped, and a late old result is ignored', async () => {
    const pending: { svg: string; resolve: (r: Raster) => void }[] = []
    const makePng = vi.fn(
      (svg: string, width: number, height: number) =>
        new Promise<Raster>((resolve) => pending.push({ svg, resolve: (r) => resolve({ ...r, width, height }) })),
    )
    const m = mountCard({ makePng })
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    click(checkbox(m.c, 'MAT'))
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    expect(pending[1]!.svg).not.toBe(pending[0]!.svg)
    // The first (old card) finishes late: the PNG button must not become usable for the new card.
    pending[0]!.resolve({ blob: new Blob(['old']), width: 2400, height: 1260 })
    await new Promise((r) => setTimeout(r, 10))
    flushSync()
    expect(buttonByText(m.c, 'Download image (PNG)').disabled).toBe(true)
    pending[1]!.resolve({ blob: new Blob(['new']), width: 2400, height: 1260 })
    await ready(m.c, 'Download image (PNG)')
    click(buttonByText(m.c, 'Download image (PNG)'))
    expect(await m.saved[0]!.blob.text()).toBe('new')
  })

  it('waits out quick changes: several toggles a few ms apart make one PNG', async () => {
    const m = mountCard({ prepareMs: 80 })
    for (const code of ['MAT', 'QR', 'SPA', 'WM']) {
      click(checkbox(m.c, code))
      await new Promise((r) => setTimeout(r, 15))
    }
    await ready(m.c, 'Download image (PNG)')
    expect(m.makePng).toHaveBeenCalledTimes(1)
    expect((m.makePng.mock.calls[0] as [string])[0]).toBe(cardSvg(buildCard({ estimates: estimatesOf('full'), peaks: peaksOf('full'), hidden: ['MAT', 'QR', 'SPA', 'WM'], sessions: 2 }), 2))
  })

  it('says so when the browser cannot make the PNG, and the SVG still works', async () => {
    const m = mountCard({ makePng: async () => Promise.reject(new Error('no canvas')) })
    await vi.waitFor(() => expect(m.c.querySelector('[role="alert"]')?.textContent).toBe('This browser could not make the PNG. The vector image (SVG) still works.'))
    expect(buttonByText(m.c, 'Download image (PNG)').disabled).toBe(true)
    expect(m.c.querySelector('[data-preparing]')).toBeNull()
    expect(buttonByText(m.c, 'Download vector image (SVG)').disabled).toBe(false)
  })

  it('states both sizes', () => {
    const m = mountCard()
    expect(m.c.textContent).toContain('2400 × 1260 px')
    expect(m.c.textContent).toContain('1200 × 630 px')
  })
})

describe('the share sheet', () => {
  it('is not offered where the browser cannot share image files', () => {
    const m = mountCard({ canShare: false })
    expect(() => buttonByText(m.c, 'Share image')).toThrow()
  })

  it('shares the prepared PNG, and reports shared, dismissed and failed', async () => {
    let outcome: ImageShareOutcome = 'shared'
    const shared: string[] = []
    const m = mountCard({
      shareFile: async (_b: Blob, name: string) => (shared.push(name), outcome),
    })
    expect(buttonByText(m.c, 'Share image').disabled).toBe(true)
    await ready(m.c, 'Share image')
    click(buttonByText(m.c, 'Share image'))
    await vi.waitFor(() => expect(status(m.c, 'message')).toBe('Image shared.'))
    outcome = 'cancelled'
    click(buttonByText(m.c, 'Share image'))
    await vi.waitFor(() => expect(status(m.c, 'message')).toBe('Sharing was cancelled.'))
    outcome = 'failed'
    click(buttonByText(m.c, 'Share image'))
    await vi.waitFor(() => expect(status(m.c, 'message')).toBe('The image could not be shared. Download it instead.'))
    expect(shared).toEqual(['humanbench-card-2026-09-30.png', 'humanbench-card-2026-09-30.png', 'humanbench-card-2026-09-30.png'])
  })
})

describe('what the panel does not carry (M1.18 amendment)', () => {
  it('has no notes text, results-talk preamble, resource line or save-file content, on the page or in the picture', () => {
    const m = mountCard()
    for (const probe of [TALK_PREAMBLE, TALK_TEXT, NOTES_HEADING, NOTES_TEXT, RESOURCE_LINE, 'Never paste your save file']) {
      expect(m.c.textContent).not.toContain(probe)
      expect(svgOf(m.c)).not.toContain(probe)
    }
    expect(m.c.innerHTML).not.toContain('anon_id')
    expect(m.c.querySelector('a')).toBeNull()
  })

  it('has no total, mean, rank or single score in its words', () => {
    const m = mountCard()
    expect(m.c.textContent).not.toMatch(/\b(overall (score|number|figure)|total score|your score|your rank|percentile|top \d+%)\b/i)
  })
})

describe('structure for assistive technology', () => {
  it('has labelled groups, the help linked to the skills group, and announces the count and results politely', () => {
    const m = mountCard()
    const groups = [...m.c.querySelectorAll('fieldset')]
    expect(groups.map((g) => g.querySelector('legend')!.textContent)).toEqual(['Skills on the card', 'Card colours'])
    const help = groups[0]!.getAttribute('aria-describedby')!
    expect(m.c.querySelector(`#${CSS.escape(help)}`)?.textContent).toContain('Untick any skill')
    expect(m.c.querySelector('[data-count]')!.getAttribute('role')).toBe('status')
    expect(m.c.querySelector('[data-message]')!.getAttribute('role')).toBe('status')
    expect(preview(m.c)!.getAttribute('alt')!.length).toBeGreaterThan(30)
    // Every control has an accessible name.
    for (const b of m.c.querySelectorAll('button')) expect((b.textContent ?? '').trim().length).toBeGreaterThan(0)
    for (const i of m.c.querySelectorAll('input')) expect(i.closest('label')?.textContent?.trim().length).toBeGreaterThan(0)
  })
})
