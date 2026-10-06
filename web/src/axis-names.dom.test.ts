/**
 * The skill and part names on screen (provisional default, UX-REVIEW D25): the session's
 * interstitial and checklist, the results table and chart, and the share card show the Title Case
 * names of `axis-names.ts`, and neither research name ("Calibration/Metacognition", "Analytical/Logic
 * Games") reaches the page, in text, in an attribute or in the card picture.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { axisName } from './axis-names'
import { render } from './render/common/testing'
import ShareCard from './reveal/ShareCard.svelte'
import { Bot } from './session/bot'
import { fakeEnv } from './session/dom-support'
import SessionScreen from './session/SessionScreen.svelte'
import { fakeDisplay } from './render/common/testing'
import type { Raster } from './viz/export'
import { axisEstimates } from './viz/profile'
import ProfileView from './viz/ProfileView.svelte'
import { syntheticProfile } from './viz/synthetic'

const JARGON = /Calibration\/Metacognition|Analytical\/Logic Games|Metacognition|Analytical/

// jsdom has no ResizeObserver (viz/width.ts needs one): a stub that never reports a size.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver
}

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  document.body.innerHTML = ''
})

/** Every text a person can read or hear: the text, and the attributes that name or describe something. */
function readable(root: Element): string {
  const attrs = [...root.querySelectorAll('*')].flatMap((el) => ['aria-label', 'alt', 'title', 'aria-valuetext'].map((a) => el.getAttribute(a) ?? ''))
  return [root.textContent ?? '', ...attrs].join('\n')
}

describe('the session screens', () => {
  it('the interstitial, its heading and the checklist use the Title Case names; the embedded skill is "Confidence Calibration"', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const bot = new Bot({ sessionId: 's_UINAMES000001' })
    const app = mount(SessionScreen, { target: host, props: { env: fakeEnv(fakeDisplay()).env, run: bot.run, autosave: 'ok' } })
    flushSync()
    cleanup = () => void unmount(app)
    expect(host.querySelector('h1')?.textContent?.trim()).toBe('Up next: Reaction Time')
    const checklist = host.querySelector('section.checklist')!
    expect(checklist.textContent).toContain('Reaction Time')
    expect(checklist.textContent).toContain('Confidence Calibration')
    expect(readable(host)).not.toMatch(JARGON)
    expect(readable(host)).not.toContain('Reaction time')
  })
})

describe('the results', () => {
  it('the table rows and the chart labels use the display names; no research name anywhere', () => {
    const p = syntheticProfile('full')!
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(ProfileView, { target, props: { input: p.input, facetObservations: p.facetObservations, facetCatalog: p.catalog } })
    flushSync()
    cleanup = () => void unmount(app)
    const rows = [...target.querySelectorAll('tbody th.name')].map((th) => th.textContent!.replace(/​/g, '').replace(/\s*[○◇].*$/s, '').trim())
    expect(rows).toContain('Confidence Calibration')
    expect(rows).toContain('Logic Games')
    const labels = [...target.querySelectorAll('svg.hb-blob text, svg.hb-blob tspan')].map((t) => t.textContent!.trim())
    // Two lines, the tier glyph after the first: "Confidence ○" over "Calibration".
    expect(labels.some((l) => l.startsWith('Confidence'))).toBe(true)
    expect(labels).toContain('Calibration')
    expect(labels).toContain('Logic')
    expect(labels).toContain('Games')
    expect(readable(target)).not.toMatch(JARGON)
  })

  it('the share card lists, labels and draws the display names', async () => {
    const input = syntheticProfile('full')!.input
    const makePng = vi.fn(async (svg: string, width: number, height: number): Promise<Raster> => ({ blob: new Blob([svg], { type: 'image/png' }), width, height }))
    const r = render(ShareCard, { estimates: axisEstimates(input), score: input.score, sessions: 2, makePng, download: () => {}, shareFile: async () => 'shared', canShare: true, prepareMs: 0, today: () => new Date(2026, 8, 30, 12) })
    cleanup = r.destroy
    const label = (code: string): string => r.container.querySelector(`input[data-skill="${code}"]`)!.closest('label')!.textContent!.trim()
    expect(label('CAL')).toBe(axisName('CAL'))
    expect(label('LG')).toBe(axisName('LG'))
    const img = r.container.querySelector<HTMLImageElement>('img[data-preview]')!
    const svg = decodeURIComponent(img.getAttribute('src')!.slice(img.getAttribute('src')!.indexOf(',') + 1))
    expect(svg).not.toMatch(JARGON)
    expect(readable(r.container)).not.toMatch(JARGON)
  })
})
