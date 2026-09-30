/**
 * The reveal in jsdom (ROADMAP M1.R; DESIGN §10): mounted through `Finished`, on finished bot
 * sessions (real families, selector, scorer and save library). Covers the order of the flow, the
 * build-up (a fake display), the required save with its leave-guard, the cards that wait for the
 * save, the worked examples, the retest advice, the norms and pace, the hidden taker wording and
 * the results footer.
 */

import { flushSync } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RESOURCE_LINE } from '../copy'
import { AXIS_CODES, type AxisCode } from '../engine/axes'
import { buttonByText, click, fakeDisplay } from '../render/common/testing'
import type { ShareOutcome } from '../save/io'
import type { SaveFileV1 } from '../save/types'
import Finished from '../session/Finished.svelte'
import { buildCard } from '../viz/card'
import { axisEstimates } from '../viz/profile'
import NumbersSection from './NumbersSection.svelte'
import { render } from '../render/common/testing'
import { NOTES_TEXT, PEAKS_HEADING, TAKER_COMPARISON_TEXT, TALK_COPIED, TALK_PREAMBLE } from './copy'
import { REVEAL_AXIS_MS } from './frames'
import { distinctivePeaks, withinPersonContrasts } from './peaks'
import { buildResults } from './results'
import { TALK_ANCHOR_ID, TALK_PREAMBLE_MAX_CHARS } from './slots'
import { DAY_MS, T0_MS, botSave, type BotSave } from './test-support'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  document.body.innerHTML = ''
})

interface Mounted {
  readonly c: HTMLElement
  readonly b: BotSave
  readonly downloads: SaveFileV1[]
  readonly restarts: number[]
  readonly seen: string[][]
  readonly focus: string[][]
  readonly copied: string[]
}

function mountFinished(b: BotSave, over: Record<string, unknown> = {}): Mounted {
  const downloads: SaveFileV1[] = []
  const restarts: number[] = []
  const seen: string[][] = []
  const focus: string[][] = []
  const copied: string[] = []
  const r = render(Finished, {
    result: b.result,
    sessionId: b.bot.run.sessionId,
    makeSave: () => b.save,
    autosave: 'ok',
    motion: 'reduce',
    onrestart: () => restarts.push(1),
    onseen: (ids: string[]) => seen.push(ids),
    onfocus: (axes: string[]) => focus.push(axes),
    download: (s: SaveFileV1) => (downloads.push(s), 'file.json'),
    copyText: async (t: string) => (copied.push(t), true),
    ...over,
  })
  cleanup = r.destroy
  return { c: r.container, b, downloads, restarts, seen, focus, copied }
}

const unloadPrevented = (): boolean => {
  const e = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(e)
  return e.defaultPrevented
}

const section = (c: HTMLElement, name: string): HTMLElement | null => c.querySelector(`[data-section="${name}"]`)
const before = (a: Element, b: Element): boolean => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

const bot = (id: string, level = 0.8): BotSave => botSave(id, { level })

describe('the order of the reveal (§10)', () => {
  it('build-up → peaks → drill-down → save → (after saving) cards; then worked examples, retest, numbers, footer', () => {
    const m = mountFinished(bot('s_REVEALDOM0000001'))
    const svg = m.c.querySelector('svg.hb-blob')!
    const peaks = section(m.c, 'peaks')!
    const drill = m.c.querySelector('.drill')!
    const save = section(m.c, 'save')!
    const worked = section(m.c, 'worked')!
    const retest = section(m.c, 'retest')!
    const numbers = section(m.c, 'numbers')!
    const footer = section(m.c, 'results-footer')!
    const order = [svg, peaks, drill, save, worked, retest, numbers, footer]
    for (let i = 1; i < order.length; i++) expect(before(order[i - 1]!, order[i]!), `section ${i}`).toBe(true)
    expect(m.c.querySelector('h1')?.textContent).toBe('Session complete')
    expect(peaks.querySelector('h2')?.textContent).toBe(PEAKS_HEADING)
    // The bar table is always in the page (the screen-reader default), and it is before the chart.
    expect(m.c.querySelector('table')).not.toBeNull()
  })

  it('shows the label "practice-adjusted" with the first-session wording, and the later one for a returning person', () => {
    const one = mountFinished(bot('s_REVEALDOM0000002'))
    const badge = one.c.querySelector('[data-practice-adjusted]')!
    expect(badge.textContent).toContain('Practice-adjusted')
    expect(badge.textContent).toContain('nothing to adjust yet')
    cleanup?.()
    const a = bot('s_REVEALDOM0000003')
    const b = botSave('s_REVEALDOM0000004', { base: a.save, startedMs: T0_MS + 8 * DAY_MS })
    const two = mountFinished(b)
    expect(two.c.querySelector('[data-practice-adjusted]')!.textContent).toContain('each later session is credited')
  })

  it('shows all sessions of the save, not only the last (M1.Q): the returning person’s table covers both', () => {
    const a = bot('s_REVEALDOM0000005')
    const b = botSave('s_REVEALDOM0000006', { base: a.save, startedMs: T0_MS + 8 * DAY_MS })
    const m = mountFinished(b)
    expect(b.save.sessions).toHaveLength(2)
    const rows = m.c.querySelectorAll('table.hb-bars tbody tr')
    expect(rows.length).toBe(17)
  })
})

/** The measured skills of a save and the model's peaks (what the page must show, and nothing else). */
function peaksOf(b: BotSave): { measured: AxisCode[]; results: NonNullable<ReturnType<typeof buildResults>> } {
  const results = buildResults(b.save)!
  const measured = axisEstimates(results.input)
    .filter((e) => e.measured)
    .map((e) => e.code)
  return { measured, results }
}

describe('distinctive peaks', () => {
  it('a flat profile has none: a contrast above the person’s own mean is not shown unless its 90% range is clear of 0', () => {
    const b = bot('s_REVEALDOM0000007', 0.6)
    const { measured, results } = peaksOf(b)
    // The test bites: some skill sits above the person's own mean, only not clearly.
    expect(withinPersonContrasts(results.rescore, measured).some((c) => c.contrast > 0 && c.lo90 <= 0)).toBe(true)
    expect(distinctivePeaks(results.rescore, measured)).toEqual([])
    const peaks = section(mountFinished(b).c, 'peaks')!
    expect(peaks.querySelectorAll('li[data-peak]')).toHaveLength(0)
    expect(peaks.textContent).toContain('No skill stands out clearly')
  })

  it('lists exactly the credible peaks, each with a range that starts above 0; never a mean or total', () => {
    // High on three skills, low on the rest: a person with peaks.
    const high = new Set<AxisCode>(['MAT', 'QR', 'VOC'])
    const level = Object.fromEntries(AXIS_CODES.map((k) => [k, high.has(k) ? 2 : -1])) as Record<AxisCode, number>
    const b = botSave('s_REVEALDOM0000042', { level })
    const { measured, results } = peaksOf(b)
    const model = distinctivePeaks(results.rescore, measured)
    expect(model.length).toBeGreaterThan(0)
    const peaks = section(mountFinished(b).c, 'peaks')!
    const items = [...peaks.querySelectorAll('li[data-peak]')]
    expect(items.map((li) => li.getAttribute('data-peak'))).toEqual(model.map((c) => c.code))
    expect(items.length).toBeLessThanOrEqual(3)
    for (const li of items) {
      const m = /stands out by about (\d\.\d) SD from your profile as a whole \(90% range \+(\d\.\d) to \+(\d\.\d) SD\)/.exec(li.textContent ?? '')
      expect(m, li.textContent ?? '').not.toBeNull()
      expect(Number(m![2])).toBeGreaterThanOrEqual(0)
    }
    expect(peaks.textContent).toContain('It is not a comparison with other people')
    expect(peaks.textContent).not.toMatch(/\b(total|overall|average|mean|score)\b/i)
  })

  it('says so when a session measured only one part', () => {
    const b = botSave('s_REVEALDOM0000008', {
      drive: (bot) => {
        bot.until((v) => v.phase === 'block')
        bot.step()
        bot.run.finishEarly()
      },
    })
    const m = mountFinished(b)
    expect(section(m.c, 'peaks')!.textContent).toContain('Too few skills were measured')
  })
})

describe('the build-up, axis by axis', () => {
  it('starts with the profile at the centre, announces once, can be skipped, and ends as the static profile', () => {
    const display = fakeDisplay()
    const b = bot('s_REVEALDOM0000009')
    const anim = mountFinished(b, { motion: 'full', timing: display })
    const root = anim.c.querySelector('.reveal')!
    expect(root.getAttribute('data-building')).toBe('true')
    expect(anim.c.querySelector('.reveal [role="status"]')?.textContent).toBe('Building your profile, one skill at a time.')
    // The later sections wait for the profile.
    expect(section(anim.c, 'peaks')).toBeNull()
    expect(section(anim.c, 'save')).toBeNull()
    const crisp0 = anim.c.querySelector('svg.hb-blob path.crisp')!.getAttribute('d')
    display.advance(60)
    expect(anim.c.querySelector('.reveal .now')?.textContent).toMatch(/^Now showing: .+ \(1 of \d+\)$/)
    display.advance(1500)
    expect(anim.c.querySelector('svg.hb-blob path.crisp')!.getAttribute('d')).not.toBe(crisp0)
    click(buttonByText(anim.c, 'Skip animation'))
    expect(root.getAttribute('data-building')).toBe('false')
    expect(anim.c.querySelector('.reveal [role="status"]')?.textContent).toBe('Your profile is ready.')
    expect(section(anim.c, 'peaks')).not.toBeNull()
    expect(section(anim.c, 'save')).not.toBeNull()
    const finalD = anim.c.querySelector('svg.hb-blob path.crisp')!.getAttribute('d')
    cleanup?.()
    // The static profile (no animation) is the same picture.
    const still = mountFinished(b)
    expect(still.c.querySelector('svg.hb-blob path.crisp')!.getAttribute('d')).toBe(finalD)
  })

  it('finishes by itself after about 400 ms per measured skill, then offers a replay', () => {
    const display = fakeDisplay()
    const m = mountFinished(bot('s_REVEALDOM0000010'), { motion: 'full', timing: display })
    const n = Number(m.c.querySelector('svg.hb-blob')!.getAttribute('data-spokes'))
    expect(n).toBe(17)
    // n skills at REVEAL_AXIS_MS each, plus a little: no need for more frames than the build-up takes.
    const buildMs = n * REVEAL_AXIS_MS + 500
    display.advance(buildMs)
    expect(m.c.querySelector('.reveal')!.getAttribute('data-building')).toBe('false')
    expect(section(m.c, 'peaks')).not.toBeNull()
    click(buttonByText(m.c, 'Replay animation'))
    expect(m.c.querySelector('.reveal')!.getAttribute('data-building')).toBe('true')
    // The sections that appeared stay: replaying is only the picture.
    expect(section(m.c, 'save')).not.toBeNull()
    display.advance(buildMs)
    expect(m.c.querySelector('.reveal')!.getAttribute('data-building')).toBe('false')
  })

  it('keeps keyboard focus on the button that stands in for the one just pressed (Skip ↔ Replay)', async () => {
    const display = fakeDisplay()
    const m = mountFinished(bot('s_REVEALDOM0000046'), { motion: 'full', timing: display })
    const skip = buttonByText(m.c, 'Skip animation')
    skip.focus()
    expect(document.activeElement).toBe(skip)
    click(skip)
    await vi.waitFor(() => expect(document.activeElement?.textContent?.trim()).toBe('Replay animation'))
    click(document.activeElement as HTMLElement)
    await vi.waitFor(() => expect(document.activeElement?.textContent?.trim()).toBe('Skip animation'))
    // A build-up that ends by itself does not steal focus from somewhere else.
    const other = m.c.querySelector<HTMLElement>('.reveal')!
    other.tabIndex = -1
    other.focus()
    display.advance(20 * REVEAL_AXIS_MS + 500)
    expect(m.c.querySelector('.reveal')!.getAttribute('data-building')).toBe('false')
    expect(document.activeElement).toBe(other)
  })

  it('with reduced motion (or no matchMedia) there is no animation at all: the profile is complete at once, and no replay', () => {
    const m = mountFinished(bot('s_REVEALDOM0000011'), { motion: 'reduce' })
    expect(m.c.querySelector('.reveal')!.getAttribute('data-building')).toBe('false')
    expect(section(m.c, 'save')).not.toBeNull()
    expect(() => buttonByText(m.c, 'Skip animation')).toThrow()
    expect(() => buttonByText(m.c, 'Replay animation')).toThrow()
    cleanup?.()
    // Default 'auto': jsdom has no matchMedia, so the animation is skipped rather than assumed.
    const auto = mountFinished(bot('s_REVEALDOM0000012'), { motion: 'auto' })
    expect(auto.c.querySelector('.reveal')!.getAttribute('data-building')).toBe('false')
  })

  it('a taker who honours prefers-reduced-motion sees no motion even if the page asks for it', () => {
    const original = window.matchMedia
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener: () => undefined, removeEventListener: () => undefined })) as never
    try {
      const display = fakeDisplay()
      const m = mountFinished(bot('s_REVEALDOM0000013'), { motion: 'auto', timing: display })
      expect(m.c.querySelector('.reveal')!.getAttribute('data-building')).toBe('false')
    } finally {
      window.matchMedia = original
    }
  })
})

describe('the required save (§10)', () => {
  it('guards the tab with beforeunload until the file is downloaded, then lets go', () => {
    const m = mountFinished(bot('s_REVEALDOM0000014'))
    expect(unloadPrevented()).toBe(true)
    click(buttonByText(m.c, 'Download save file'))
    expect(m.downloads).toHaveLength(1)
    expect(m.downloads[0]!.sessions[0]!.session_id).toBe('s_REVEALDOM0000014')
    expect(unloadPrevented()).toBe(false)
    expect(section(m.c, 'save')!.querySelector('[role="status"]')?.textContent).toBe('Save file downloaded.')
    expect(section(m.c, 'save')!.textContent).toContain('You can leave this page safely')
  })

  it('removes the guard when the screen goes away, saved or not', () => {
    mountFinished(bot('s_REVEALDOM0000015'))
    expect(unloadPrevented()).toBe(true)
    cleanup?.()
    cleanup = undefined
    expect(unloadPrevented()).toBe(false)
  })

  it('copying the save code alone does not count as saved: the guard stays and the cards stay away', async () => {
    const m = mountFinished(bot('s_REVEALDOM0000016'), { copyCode: async () => ({ code: 'H4sIAAAA', copied: true }) })
    click(buttonByText(m.c, 'Copy save code'))
    await vi.waitFor(() => expect(section(m.c, 'save')!.querySelector('[role="status"]')?.textContent).toContain('Downloading the file is still the safest way'))
    expect(unloadPrevented()).toBe(true)
    expect(section(m.c, 'after-save')).toBeNull()
  })

  it('offers the code by hand when the clipboard is refused', async () => {
    const m = mountFinished(bot('s_REVEALDOM0000017'), { copyCode: async () => ({ code: 'H4sIAAAA', copied: false }) })
    click(buttonByText(m.c, 'Copy save code'))
    await vi.waitFor(() => expect(m.c.querySelector('textarea')?.value).toBe('H4sIAAAA'))
    expect(section(m.c, 'save')!.querySelector('[role="status"]')?.textContent).toContain('could not be copied automatically')
  })

  it('the share sheet is offered where the browser has one; sharing saves, cancelling does not', async () => {
    let outcome: ShareOutcome = 'cancelled'
    const m = mountFinished(bot('s_REVEALDOM0000018'), { canShare: true, share: async () => outcome })
    click(buttonByText(m.c, 'Share or save to an app'))
    await vi.waitFor(() => expect(section(m.c, 'save')!.querySelector('[role="status"]')?.textContent).toContain('cancelled'))
    expect(unloadPrevented()).toBe(true)
    outcome = 'shared'
    click(buttonByText(m.c, 'Share or save to an app'))
    await vi.waitFor(() => expect(section(m.c, 'after-save')).not.toBeNull())
    expect(unloadPrevented()).toBe(false)
    cleanup?.()
    const none = mountFinished(bot('s_REVEALDOM0000019'), { canShare: false })
    expect(() => buttonByText(none.c, 'Share or save to an app')).toThrow()
  })

  it('a share that fell back to a download counts as saved', async () => {
    const m = mountFinished(bot('s_REVEALDOM0000020'), { canShare: true, share: async () => 'downloaded' })
    click(buttonByText(m.c, 'Share or save to an app'))
    await vi.waitFor(() => expect(section(m.c, 'after-save')).not.toBeNull())
  })

  it('leaving through "Back to the start" asks first while unsaved, and does not once saved', async () => {
    const m = mountFinished(bot('s_REVEALDOM0000021'))
    click(buttonByText(m.c, 'Back to the start'))
    expect(m.restarts).toHaveLength(0)
    expect(m.c.querySelector('.confirm h2')?.textContent).toBe('Leave without saving?')
    click(buttonByText(m.c, 'Stay and save'))
    await vi.waitFor(() => expect(document.activeElement?.textContent?.trim()).toBe('Back to the start'))
    click(buttonByText(m.c, 'Back to the start'))
    click(buttonByText(m.c, 'Leave anyway'))
    expect(m.restarts).toHaveLength(1)
    cleanup?.()
    const saved = mountFinished(bot('s_REVEALDOM0000022'))
    click(buttonByText(saved.c, 'Download save file'))
    click(buttonByText(saved.c, 'Back to the start'))
    expect(saved.restarts).toHaveLength(1)
  })
})

describe('after the save: the card slots (Phase AI, M1.18)', () => {
  it('nothing appears before the download, and only a short pointer is shown', () => {
    const m = mountFinished(bot('s_REVEALDOM0000023'))
    expect(section(m.c, 'after-save')).toBeNull()
    expect(m.c.querySelector('[data-slot]')).toBeNull()
    expect(m.c.querySelector('[data-pending]')?.textContent).toBe('Save your file first to see the next steps.')
    expect(m.c.textContent).not.toContain(TALK_PREAMBLE)
  })

  it('after the download: the share card slot, the notes card (placeholder) and the results-talk helper', async () => {
    const m = mountFinished(bot('s_REVEALDOM0000024'))
    click(buttonByText(m.c, 'Download save file'))
    const after = section(m.c, 'after-save')!
    expect(before(section(m.c, 'save')!, after)).toBe(true)
    expect([...after.querySelectorAll('[data-slot]')].map((e) => e.getAttribute('data-slot'))).toEqual(['share-card', 'notes-for-ai', 'results-talk'])
    // M1.18: the share slot holds the card panel (its own tests: ShareCard.dom.test.ts).
    const share = after.querySelector('[data-slot="share-card"]')!
    expect(share.querySelector('[data-share-card]')).not.toBeNull()
    expect(share.querySelector('img[data-preview]')).not.toBeNull()
    expect(share.textContent).not.toContain('not available')
    const notes = after.querySelector('[data-slot="notes-for-ai"]')!
    expect(notes.querySelector('[data-placeholder]')).not.toBeNull()
    expect(notes.querySelector('a')).toBeNull()
    const talk = after.querySelector('[data-slot="results-talk"]')!
    expect(talk.textContent).toContain('Never paste your save file')
    expect(talk.textContent).toContain(TALK_PREAMBLE)
    click(buttonByText(talk as HTMLElement, 'Copy this preamble'))
    await vi.waitFor(() => expect(talk.querySelector('[role="status"]')?.textContent).toBe(TALK_COPIED))
    expect(m.copied).toEqual([TALK_PREAMBLE])
  })

  it('links the notes card to the builder route when there is one', () => {
    const m = mountFinished(bot('s_REVEALDOM0000025'), { notesHref: '#/notes' })
    click(buttonByText(m.c, 'Download save file'))
    const a = m.c.querySelector('[data-slot="notes-for-ai"] a')!
    expect(a.getAttribute('href')).toBe('#/notes')
    // A new tab, said so: the results and their required save stay where they are.
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener')
    expect(a.textContent).toBe('Build your notes (opens in a new tab)')
    expect(m.c.querySelector('[data-placeholder]')).toBeNull()
  })

  it('says so when the preamble cannot be copied', async () => {
    const m = mountFinished(bot('s_REVEALDOM0000026'), { copyText: async () => false })
    click(buttonByText(m.c, 'Download save file'))
    click(buttonByText(m.c, 'Copy this preamble'))
    await vi.waitFor(() => expect(m.c.querySelector('[data-slot="results-talk"] [role="status"]')?.textContent).toContain('could not be copied'))
  })

  it('never puts notes text or the results into the preamble, and keeps the share slot free of the resource line', () => {
    const m = mountFinished(bot('s_REVEALDOM0000027'))
    click(buttonByText(m.c, 'Download save file'))
    const after = section(m.c, 'after-save')!
    expect(after.textContent).not.toContain(RESOURCE_LINE)
    expect(TALK_PREAMBLE.length).toBeLessThanOrEqual(TALK_PREAMBLE_MAX_CHARS)
    expect(TALK_PREAMBLE_MAX_CHARS).toBe(340)
    expect(/\d/.test(TALK_PREAMBLE)).toBe(false)
  })
})

describe('the share card in the reveal (M1.18)', () => {
  const cardProps = { prepareMs: 0, makePng: async (_svg: string, width: number, height: number) => ({ blob: new Blob(['png']), width, height }) }
  const decode = (c: HTMLElement): string => {
    const src = c.querySelector('img[data-preview]')!.getAttribute('src')!
    return decodeURIComponent(src.slice(src.indexOf(',') + 1))
  }

  it('is the card of the person\'s own results: their measured skills, their credible peaks, the sessions that counted', () => {
    const high = new Set<AxisCode>(['MAT', 'QR', 'VOC'])
    const level = Object.fromEntries(AXIS_CODES.map((k) => [k, high.has(k) ? 2 : -1])) as Record<AxisCode, number>
    const b = botSave('s_REVEALDOM0000101', { level })
    const m = mountFinished(b, { card: cardProps })
    click(buttonByText(m.c, 'Download save file'))
    const { measured, results } = peaksOf(b)
    const estimates = axisEstimates(results.input)
    const expected = buildCard({ estimates, peaks: distinctivePeaks(results.rescore, measured, { max: AXIS_CODES.length }), sessions: 1 })
    expect(expected.peaks.length).toBeGreaterThan(0)
    expect(decode(m.c)).toBe(expected.svg)
    const boxes = [...m.c.querySelectorAll('input[data-skill]')].map((i) => i.getAttribute('data-skill'))
    expect(boxes).toEqual(measured)
    expect(decode(m.c)).toContain('Based on 1 session<')
  })

  it('starts from every credible peak: hiding the strongest brings the fourth one up', () => {
    const high = new Set<AxisCode>(['MAT', 'QR', 'SPA', 'WM'])
    const level = Object.fromEntries(AXIS_CODES.map((k) => [k, high.has(k) ? 3 : -3])) as Record<AxisCode, number>
    const b = botSave('s_REVEALDOM0000106', { level })
    const { measured, results } = peaksOf(b)
    const all = distinctivePeaks(results.rescore, measured, { max: AXIS_CODES.length })
    expect(all.length).toBeGreaterThanOrEqual(4) // the page lists three, the card can list the next
    const m = mountFinished(b, { card: cardProps })
    click(buttonByText(m.c, 'Download save file'))
    const estimates = axisEstimates(results.input)
    expect(decode(m.c)).toBe(buildCard({ estimates, peaks: all, sessions: 1 }).svg)
    click(m.c.querySelector(`input[data-skill="${all[0]!.code}"]`))
    const hidden = buildCard({ estimates, peaks: all, hidden: [all[0]!.code], sessions: 1 })
    expect(hidden.peaks.map((p) => p.code)).toEqual(all.slice(1, 4).map((p) => p.code))
    expect(decode(m.c)).toBe(hidden.svg)
  })

  it('states the sessions a returning person\'s profile rests on', () => {
    const a = bot('s_REVEALDOM0000102')
    const b = botSave('s_REVEALDOM0000103', { base: a.save, startedMs: T0_MS + 8 * DAY_MS })
    const m = mountFinished(b, { card: cardProps })
    click(buttonByText(m.c, 'Download save file'))
    expect(decode(m.c)).toContain('Based on 2 sessions<')
  })

  it('does not exist before the save, and never carries the notes card, the helper or the resource line', () => {
    const m = mountFinished(bot('s_REVEALDOM0000104'), { card: cardProps })
    expect(m.c.querySelector('[data-share-card]')).toBeNull()
    click(buttonByText(m.c, 'Download save file'))
    const svg = decode(m.c)
    for (const probe of [TALK_PREAMBLE, NOTES_TEXT, RESOURCE_LINE, 'Notes for your AI', 'Never paste your save file']) expect(svg).not.toContain(probe)
    expect(m.c.querySelector('[data-share-card]')!.textContent).not.toContain(RESOURCE_LINE)
  })

  it('links to the results-talk helper below it, and the link moves focus there', () => {
    const m = mountFinished(bot('s_REVEALDOM0000105'), { card: cardProps })
    click(buttonByText(m.c, 'Download save file'))
    const share = m.c.querySelector('[data-slot="share-card"]')!
    const link = share.querySelector<HTMLAnchorElement>('[data-talk-link] a')!
    expect(link.getAttribute('href')).toBe(`#${TALK_ANCHOR_ID}`)
    expect(link.textContent).toBe('Talking about your results with an AI')
    const talk = m.c.querySelector('[data-slot="results-talk"]') as HTMLElement
    expect(talk.id).toBe(TALK_ANCHOR_ID)
    expect(before(share, talk)).toBe(true)
    // The helper is on the same screen with its copy button and the "never paste" line.
    expect(talk.textContent).toContain('Never paste your save file')
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(talk)
  })

  it('leaves the anchor alone when a replacement for the AI cards has no helper with that id', async () => {
    const { createRawSnippet } = await import('svelte')
    const AfterSave = (await import('./AfterSave.svelte')).default
    const ai = createRawSnippet(() => ({ render: () => '<article data-slot="replacement">Working with AI</article>' }))
    const r = render(AfterSave, { ai })
    cleanup = r.destroy
    const link = r.container.querySelector<HTMLAnchorElement>('[data-talk-link] a')!
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
  })
})

describe('worked examples (§10)', () => {
  it('shows three fresh items with worked solutions behind a disclosure, and reports their families', () => {
    const m = mountFinished(bot('s_REVEALDOM0000028'))
    const worked = section(m.c, 'worked')!
    const cards = worked.querySelectorAll('article[data-worked]')
    expect([...cards].map((x) => x.getAttribute('data-worked'))).toEqual(['matrix', 'series', 'quant'])
    for (const card of cards) {
      const d = card.querySelector('details')!
      expect(d.querySelector('summary')?.textContent).toBe('Show the worked solution')
      expect(d.querySelectorAll('ol.steps li').length).toBeGreaterThanOrEqual(2)
      expect(d.querySelector('.answer strong')?.textContent).toBeTruthy()
    }
    expect(cards[0]!.querySelectorAll('svg').length).toBeGreaterThanOrEqual(9 + 6)
    expect(cards[1]!.querySelector('.terms')?.textContent).toContain(', ?')
    // Their families are handed over to be left out of later sessions (§7.7): the three shown, and
    // the near-isomorph siblings of a grouped quant variant.
    expect(m.seen).toHaveLength(1)
    expect(m.seen[0]!.length).toBeGreaterThanOrEqual(3)
    expect(m.seen[0]!.every((f) => f.startsWith('f:'))).toBe(true)
    for (const card of cards) expect(m.seen[0]).toContain(card.getAttribute('data-family'))
  })

  it('the examples are not the person’s own questions, and the same three come back for the same session', () => {
    const b = bot('s_REVEALDOM0000029')
    const m = mountFinished(b)
    expect(b.save.seen_families.length).toBeGreaterThan(0)
    for (const f of m.seen[0]!) expect(b.save.seen_families).not.toContain(f)
    const ids = (c: HTMLElement): (string | null)[] => [...c.querySelectorAll('article[data-worked]')].map((x) => x.getAttribute('data-family'))
    const first = ids(m.c)
    expect(first).toHaveLength(3)
    cleanup?.()
    expect(ids(mountFinished(b).c)).toEqual(first)
  })
})

describe('retest motivation (§10, §7.6)', () => {
  it('predicts the shrinkage from §7.6, lists the widest ranges, and advises a week between sessions', () => {
    const m = mountFinished(bot('s_REVEALDOM0000030'))
    const r = section(m.c, 'retest')!
    expect(r.querySelector('[data-shrinkage]')?.textContent).toBe('A second session would typically tighten the ranges in your profile by about 25%.')
    expect(r.querySelectorAll('[data-fuzzy]')).toHaveLength(3)
    expect(r.textContent).toContain('not that the skill is weak')
    expect(r.querySelector('[data-spacing]')?.textContent).toContain('at least 7 days')
    expect(r.textContent).not.toMatch(/\b(total|overall|score)\b/i)
  })

  it('a focus session on one part does not make the whole profile a second-session profile', () => {
    const a = bot('s_REVEALDOM0000044')
    const b = botSave('s_REVEALDOM0000045', {
      base: a.save,
      startedMs: T0_MS + 8 * DAY_MS,
      cfg: { focus: ['MAT', 'LR', 'LG'] },
    })
    const m = mountFinished(b)
    // Most skills have had one session: the next full session is a second one for them.
    expect(section(m.c, 'retest')!.querySelector('[data-shrinkage]')?.textContent).toBe('A second session would typically tighten the ranges in your profile by about 25%.')
  })

  it('a returning person is told about a smaller gain', () => {
    const a = bot('s_REVEALDOM0000031')
    const b = botSave('s_REVEALDOM0000032', { base: a.save, startedMs: T0_MS + 8 * DAY_MS })
    const m = mountFinished(b)
    expect(section(m.c, 'retest')!.querySelector('[data-shrinkage]')?.textContent).toBe('Another session would typically tighten the ranges in your profile by about 15%.')
  })

  it('a focus session leaves the results, so its form waits for the save file (§10) and then opens', () => {
    const m = mountFinished(bot('s_REVEALDOM0000043'))
    const retest = section(m.c, 'retest')!
    expect(retest.querySelector('form')).toBeNull()
    expect(retest.querySelector('[data-focus-locked]')?.textContent).toBe('Save your file above first. Then you can start a focus session.')
    expect(retest.textContent).toContain('A 20-minute focus session')
    expect(m.focus).toHaveLength(0)
    click(buttonByText(m.c, 'Download save file'))
    expect(retest.querySelector('[data-focus-locked]')).toBeNull()
    expect(retest.querySelector('form')).not.toBeNull()
  })

  it('offers a 20-minute focus session on the parts of the widest ranges, and starts it with their skills', () => {
    const m = mountFinished(bot('s_REVEALDOM0000033'))
    click(buttonByText(m.c, 'Download save file'))
    const form = section(m.c, 'retest')!.querySelector('form')!
    const boxes = [...form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    expect(boxes).toHaveLength(6)
    expect(boxes.some((b) => b.checked)).toBe(true)
    // Untick everything: it asks for a choice and starts nothing.
    for (const b of boxes) if (b.checked) click(b)
    click(buttonByText(form, 'Start a 20-minute focus session'))
    expect(form.querySelector('[role="alert"]')?.textContent).toBe('Pick at least one part.')
    expect(m.focus).toHaveLength(0)
    click(boxes.find((b) => b.id.endsWith('spatial'))!)
    click(boxes.find((b) => b.id.endsWith('quant'))!)
    click(buttonByText(form, 'Start a 20-minute focus session'))
    expect(m.focus).toEqual([['SPA', 'QR']])
  })

  it('leaves the focus form out when the flow cannot start one', () => {
    const m = mountFinished(bot('s_REVEALDOM0000034'), { onfocus: undefined })
    expect(section(m.c, 'retest')!.querySelector('form')).toBeNull()
    expect(section(m.c, 'retest')!.textContent).toContain('at least 7 days')
  })
})

describe('about these numbers (§7.3, §7.1)', () => {
  it('shows rough external comparisons for the parts done, the separate Pace note, and no taker wording', () => {
    const m = mountFinished(bot('s_REVEALDOM0000035', 1))
    const n = section(m.c, 'numbers')!
    expect(n.querySelector('[data-norm="rt"]')?.textContent).toMatch(/simple reaction time was about \d+ ms\. Times on the web run tens of milliseconds slower than in a lab/)
    expect(n.querySelector('[data-norm="rt"]')?.textContent).toContain('about 300 ms')
    const pace = n.querySelector('details.pace')!
    expect(pace.querySelector('summary')?.textContent).toBe('Pace')
    expect(pace.textContent).toContain('separate from your skill estimates')
    expect(pace.querySelectorAll('li[data-pace]').length).toBeGreaterThan(0)
    // Hidden until A12 allows percentiles.
    expect(m.c.textContent).not.toContain('vs other HumanBench takers')
    expect(m.c.textContent).not.toContain('self-selected')
  })

  it('says what a reading speed and a digit span are compared with', () => {
    const facts = { readingWpm: 250, digitsForward: 7, digitsBackward: 5, simpleRtMs: null }
    const r = render(NumbersSection, { facts, pace: [] })
    cleanup = r.destroy
    const span = r.container.querySelector('[data-norm="span"]')!
    expect(span.textContent).toContain('You repeated up to 7 digits forwards and 5 digits backwards')
    expect(span.textContent).toContain('Typical adults manage about 6 to 7 digits forwards and 4 to 5 backwards')
    const reading = r.container.querySelector('[data-norm="reading"]')!
    expect(reading.textContent).toContain('about 250 words per minute')
    expect(reading.textContent).toContain('238 words per minute for non-fiction and 260 for fiction')
    expect(r.container.querySelector('[data-norm="rt"]')).toBeNull()
  })

  it('the "vs other HumanBench takers" wording exists, and shows only when asked (A12 allows percentiles after M4 with N ≥ 500)', () => {
    const facts = { readingWpm: null, digitsForward: null, digitsBackward: null, simpleRtMs: null }
    const hidden = render(NumbersSection, { facts, pace: [] })
    expect(hidden.container.querySelector('[data-taker-comparison]')).toBeNull()
    hidden.destroy()
    const shown = render(NumbersSection, { facts, pace: [], takerComparison: true })
    cleanup = shown.destroy
    expect(shown.container.querySelector('[data-taker-comparison]')?.textContent).toBe(TAKER_COMPARISON_TEXT)
    expect(TAKER_COMPARISON_TEXT).toBe('vs other HumanBench takers (a self-selected, likely above-average group)')
    expect(shown.container.textContent).toContain('There are no published comparisons')
  })
})

describe('the results footer (R-5.6.5, A13)', () => {
  it('holds the resource line, once, in the footer only', () => {
    const m = mountFinished(bot('s_REVEALDOM0000037'))
    click(buttonByText(m.c, 'Download save file'))
    const footer = section(m.c, 'results-footer')!
    expect(footer.tagName).toBe('FOOTER')
    expect(footer.textContent).toContain(RESOURCE_LINE)
    expect((m.c.textContent ?? '').split(RESOURCE_LINE).length - 1).toBe(1)
    for (const s of m.c.querySelectorAll('[data-slot]')) expect(s.textContent).not.toContain(RESOURCE_LINE)
  })

  it('shows no total, area, single score or rank for the person anywhere on the page', () => {
    const m = mountFinished(bot('s_REVEALDOM0000039'))
    click(buttonByText(m.c, 'Download save file'))
    const text = (m.c.textContent ?? '').replace(TALK_PREAMBLE, '')
    expect(text).not.toMatch(/\b(overall (score|number|figure)|total score|your score|your rank|percentile|top \d+%)\b/i)
    expect(m.c.innerHTML).not.toMatch(/data-(total|area|score|mean)/i)
  })
})

describe('a session that measured nothing', () => {
  it('shows no profile but still offers the file and a way back', () => {
    const b = botSave('s_REVEALDOM0000040', { drive: (x) => x.run.finishEarly() })
    const m = mountFinished(b)
    expect(m.c.textContent).toContain('Nothing was measured')
    expect(m.c.querySelector('svg.hb-blob')).toBeNull()
    expect(section(m.c, 'worked')).toBeNull()
    expect(section(m.c, 'save')).not.toBeNull()
    expect(m.seen).toHaveLength(0)
    click(buttonByText(m.c, 'Back to the start'))
    expect(m.restarts).toHaveLength(1)
    // Nothing was measured: no results to lose, no leave-guard.
    expect(unloadPrevented()).toBe(false)
  })
})

describe('structure for assistive technology', () => {
  it('every panel is a labelled region under one h1, headings in order, and the profile status is announced once', () => {
    const m = mountFinished(bot('s_REVEALDOM0000041'))
    click(buttonByText(m.c, 'Download save file'))
    expect(m.c.querySelectorAll('h1')).toHaveLength(1)
    for (const s of m.c.querySelectorAll('section[aria-labelledby]')) {
      const id = s.getAttribute('aria-labelledby')!
      expect(m.c.querySelector(`#${CSS.escape(id)}`), id).not.toBeNull()
    }
    const levels = [...m.c.querySelectorAll('h1, h2, h3')].map((h) => Number(h.tagName.slice(1)))
    for (let i = 1; i < levels.length; i++) expect(levels[i]! - levels[i - 1]!, `heading ${i}`).toBeLessThanOrEqual(1)
    flushSync()
  })
})

describe('the AI slot of the cards after the save', () => {
  it('a replacement for the two AI cards (the notes module’s reveal card) takes their place; the share slot stays', async () => {
    const { createRawSnippet } = await import('svelte')
    const AfterSave = (await import('./AfterSave.svelte')).default
    const ai = createRawSnippet(() => ({ render: () => '<article data-slot="replacement">Working with AI</article>' }))
    const r = render(AfterSave, { ai })
    cleanup = r.destroy
    expect([...r.container.querySelectorAll('[data-slot]')].map((e) => e.getAttribute('data-slot'))).toEqual(['share-card', 'replacement'])
    expect(r.container.textContent).not.toContain(TALK_PREAMBLE)
  })
})
