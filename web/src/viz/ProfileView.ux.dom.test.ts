/**
 * The profile view after the fresh-eyes review (ROADMAP UX workstream, fix-viz): copy that means one
 * thing (UX-039), plain facet names and no empty facet chart (UX-040, UX-041), estimates beyond the
 * scale marked (UX-037), chart text that follows the page's text size (UX-044), a wedge click that
 * brings its panel into view (UX-046), and the small things (UX-047). The older checks stay in
 * `ProfileView.dom.test.ts`; this file needs a controllable ResizeObserver and matchMedia.
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMO_AXIS_NAME, EMO_TOOLTIP } from '../copy'
import { AXIS_INDEX } from '../engine/axes'
import { fitLayoutDetailed } from './blob'
import {
  BARS_NOTE,
  HATCH_CAPTION,
  LARGE_TEXT_HINT,
  OFF_SCALE_BARS_NOTE,
  OFF_SCALE_CAPTION,
  OFF_SCALE_CELL,
  READING_CAPTION,
  RING_CAPTION,
  TABLE_CAPTION,
  TABLE_ESTIMATE,
  TABLE_INTERVAL,
  TIER_LEGEND,
  UNCERTAINTY_CAPTION,
} from './copy'
import { THEMES } from './palette'
import { axisEstimates } from './profile'
import ProfileView from './ProfileView.svelte'
import { syntheticProfile, type SyntheticProfile } from './synthetic'

/** A ResizeObserver whose notifications the test fires. */
class FakeObserver {
  static all = new Set<FakeObserver>()
  constructor(readonly cb: ResizeObserverCallback) {
    FakeObserver.all.add(this)
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    FakeObserver.all.delete(this)
  }
  fire(): void {
    this.cb([], this as unknown as ResizeObserver)
  }
}

/** What the fake layout reports: the page's root font size and the chart box's width. */
const layout = { rootPx: 16, width: 0 }

const saved = {
  ro: globalThis.ResizeObserver,
  raf: globalThis.requestAnimationFrame,
  caf: globalThis.cancelAnimationFrame,
  matchMedia: window.matchMedia,
  clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'),
  scrollIntoView: Element.prototype.scrollIntoView,
}

let app: ReturnType<typeof mount> | undefined

beforeEach(() => {
  layout.rootPx = 16
  layout.width = 0
  FakeObserver.all.clear()
  globalThis.ResizeObserver = FakeObserver as unknown as typeof ResizeObserver
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    cb(0)
    return 1
  }
  globalThis.cancelAnimationFrame = (): void => {}
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement): number {
      if (this.classList.contains('rem')) return layout.rootPx
      return this.classList.contains('chart-box') ? layout.width : 0
    },
  })
})

afterEach(() => {
  if (app) unmount(app)
  app = undefined
  document.body.innerHTML = ''
  globalThis.ResizeObserver = saved.ro
  globalThis.requestAnimationFrame = saved.raf
  globalThis.cancelAnimationFrame = saved.caf
  window.matchMedia = saved.matchMedia
  Element.prototype.scrollIntoView = saved.scrollIntoView
  if (saved.clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', saved.clientWidth)
  else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
  vi.restoreAllMocks()
})

function render(p: SyntheticProfile, input = p.input): HTMLElement {
  const target = document.createElement('div')
  document.body.appendChild(target)
  app = mount(ProfileView, { target, props: { input, facetObservations: p.facetObservations, facetCatalog: p.catalog } })
  flushSync()
  return target
}

/** Deliver the layout the fakes report to every observer. */
function settle(): void {
  for (const ro of FakeObserver.all) ro.fire()
  flushSync()
}

function click(el: Element | null | undefined): void {
  expect(el).toBeTruthy()
  ;(el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))
  flushSync()
}

/** Let the async open (a tick, then the scroll and the focus) finish. */
async function afterOpen(): Promise<void> {
  for (let i = 0; i < 4; i++) await tick()
}

const button = (root: HTMLElement, text: string): HTMLButtonElement | undefined => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)

/** The profile of `base` with one skill's θ moved (the SD stays whatever the engine found). */
function withTheta(base: SyntheticProfile, code: keyof typeof AXIS_INDEX, theta: number): SyntheticProfile['input'] {
  const score = { ...base.input.score, theta: base.input.score.theta.map((t, i) => (i === AXIS_INDEX[code] ? theta : t)) }
  return { ...base.input, score }
}

describe('chart and table copy means one thing (UX-039)', () => {
  const m1 = syntheticProfile('m1')!

  it('says "range" for the 90% quantity everywhere, and SD only as the scale unit', () => {
    const root = render(m1)
    expect([...root.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Skill', 'Cluster', TABLE_ESTIMATE, TABLE_INTERVAL, 'Compared with 0 SD'])
    expect(TABLE_ESTIMATE).toBe('Estimate (SD units)')
    expect(TABLE_INTERVAL).toBe('90% range (SD)')
    expect(TABLE_CAPTION).toBe('Estimates by skill, in standard-deviation (SD) units on a provisional scale, each ± its uncertainty, with 90% ranges.')
    const text = root.textContent!.replace(/\s+/g, ' ')
    expect(text).not.toMatch(/interval/i)
    // Each measured estimate reads "+0.88 ± 0.60", never "+0.88 (SD 0.60)".
    const cells = [...root.querySelectorAll('tbody td.estimate')].map((td) => td.textContent!.trim())
    expect(cells.length).toBe(7)
    for (const c of cells) expect(c).toMatch(/^[+−]\d\.\d\d ± \d\.\d\d$/)
    for (const td of root.querySelectorAll('tbody td')) expect(td.textContent).not.toMatch(/\(SD \d/)
    expect(BARS_NOTE).toContain('the bar its 90% range')
  })

  it('puts the warning about the size of the shape first, ahead of the other captions', () => {
    const root = render(m1)
    const paragraphs = [...root.querySelectorAll('figcaption p')].map((p) => p.textContent)
    expect(paragraphs[0]).toBe(READING_CAPTION)
    expect(paragraphs[0]).toContain('means nothing on its own')
    expect(paragraphs[1]).toBe(RING_CAPTION)
    expect(paragraphs[2]).toBe(UNCERTAINTY_CAPTION)
    expect(paragraphs).toContain(TIER_LEGEND)
    // A12 content kept word for word.
    expect(RING_CAPTION).toBe('Rings are standard-deviation (SD) units on a provisional scale. The dashed ring is 0 SD. The centre is −3 SD, not zero ability.')
  })

  it('explains the band and the marks in plain words, with no research jargon', () => {
    expect(UNCERTAINTY_CAPTION).toBe(
      'The solid line is the most likely profile. The light band shows each estimate ± its uncertainty. The soft edge fades out across each 90% range: the darker the shading, the more likely that value. The thin lines through the markers show the 90% ranges; where one crosses 0 SD, the marker is hollow and the line turns grey.',
    )
    const all = [UNCERTAINTY_CAPTION, READING_CAPTION, TIER_LEGEND, HATCH_CAPTION, BARS_NOTE].join(' ')
    expect(all).not.toMatch(/consensus|norms|whisker|interval|plausible/i)
  })
})

describe('an estimate beyond the scale is marked, never mistaken for not measured (UX-037)', () => {
  const m1 = syntheticProfile('m1')!
  const low = withTheta(m1, 'MAT', -4.6)

  it('draws an arrowhead on the chart and says what it means, only when it is needed', () => {
    const plain = render(m1)
    expect(plain.querySelector('svg.hb-blob path.arrow')).toBeNull()
    expect(plain.querySelector('figcaption')!.textContent).not.toContain(OFF_SCALE_CAPTION)
    unmount(app!)
    app = undefined
    document.body.innerHTML = ''
    const root = render(m1, low)
    const svg = root.querySelector('svg.hb-blob')!
    const arrows = svg.querySelectorAll('g.mark[data-spoke="MAT"] path.arrow')
    expect(arrows).toHaveLength(1)
    expect(arrows[0]!.getAttribute('data-off-scale')).toBe('low')
    expect(svg.querySelector('g.mark[data-spoke="MAT"] circle.marker')).toBeNull()
    // It is measured, not a stub: no stub line, no grey gap ring, no "not measured" label.
    expect(svg.querySelector('g.mark[data-spoke="MAT"]')!.classList.contains('unmeasured')).toBe(false)
    expect(svg.querySelector('g.mark[data-spoke="MAT"] line.stub')).toBeNull()
    expect(svg.querySelectorAll('g.mark.unmeasured')).toHaveLength(10)
    expect([...svg.querySelectorAll('text.label')].find((t) => t.textContent!.startsWith('Matrix'))!.textContent).toContain('off scale')
    expect([...root.querySelectorAll('figcaption p')].map((p) => p.textContent)).toContain(OFF_SCALE_CAPTION)
    expect(OFF_SCALE_CAPTION).toBe('An arrow at the centre or the rim of the chart marks an estimate at or past the end of the scale (−3 or +3 SD); the table gives the number.')
  })

  it('shows the arrow at the end of its line in the bar view, keeps the drawn part of the range, and names it in the cell', () => {
    const root = render(m1, low)
    click(button(root, 'Bar view'))
    const row = root.querySelector('tr[data-row="MAT"]')!
    expect(row.querySelector('svg.lollipop path.arrow')).not.toBeNull()
    expect(row.querySelector('svg.lollipop circle.dot')).toBeNull()
    expect(row.querySelector('td.estimate')!.textContent).toContain(OFF_SCALE_CELL)
    expect(OFF_SCALE_CELL).toBe('(off scale)')
    expect([...root.querySelectorAll('p.note')].map((p) => p.textContent)).toContain(OFF_SCALE_BARS_NOTE)
    // The other rows keep their dot and say nothing of the kind.
    const other = root.querySelector('tr[data-row="QR"]')!
    expect(other.querySelector('svg.lollipop circle.dot')).not.toBeNull()
    expect(other.textContent).not.toContain('off scale')
    // A range wholly beyond the end of the line is not drawn as a dot of its own.
    const far = render(m1, withTheta(m1, 'MAT', -7))
    expect(far.querySelectorAll('tr[data-row="MAT"] svg.lollipop line.range')).toHaveLength(0)
    expect(far.querySelectorAll('tr[data-row="MAT"] svg.lollipop path.arrow')).toHaveLength(1)
  })

  it('high estimates get the rim, and the radius stays linear for the rest', () => {
    const root = render(m1, withTheta(m1, 'QR', 4))
    const arrow = root.querySelector('g.mark[data-spoke="QR"] path.arrow')!
    expect(arrow.getAttribute('data-off-scale')).toBe('high')
    expect(axisEstimates(withTheta(m1, 'QR', 4)).find((e) => e.code === 'QR')!.offScale).toBe('high')
  })
})

describe('plain facet names and no empty facet chart (UX-040, UX-041)', () => {
  it('draws the facet chart only from three measured facets', () => {
    const m1 = render(syntheticProfile('m1')!)
    click(button(m1, 'Quantitative'))
    // 1 of 2 measured (the quant topic groups, UX review D4): the table alone.
    expect(m1.querySelector('.facet-panel svg.hb-blob')).toBeNull()
    expect(m1.querySelectorAll('.facet-panel tbody tr')).toHaveLength(2)
    unmount(app!)
    app = undefined
    document.body.innerHTML = ''
    const full = render(syntheticProfile('full')!)
    click(button(full, 'Knowledge'))
    const sub = full.querySelector('.facet-panel svg.hb-blob')!
    expect(sub).not.toBeNull()
    expect(sub.getAttribute('data-spokes')).toBe('9')
    // Labels in the chart are the plain names too.
    expect([...sub.querySelectorAll('text.label')].map((t) => t.textContent!.replace(/\s+/g, ' ')).join('|')).not.toMatch(/_/)
  })

  it('says in one line why a cluster shows nothing, and lists the facets by name', () => {
    const root = render(syntheticProfile('m1')!)
    click(button(root, 'Spatial/Memory'))
    // Mental rotation has 16 items and WM's three tasks one each: one facet is measured, three are not.
    expect(root.querySelector('.facet-panel .facet-none')).toBeNull()
    click(button(root, 'Spatial/Memory'))
    click(button(root, 'Speed'))
    const panel = root.querySelector('.facet-panel')!
    expect(panel.querySelector('h3')!.textContent).toBe('Speed: facets')
    expect(panel.querySelector('table')).toBeNull()
    expect(panel.querySelector('.facet-none')!.textContent).toMatch(/^None of the 4 facets of Speed has enough data yet: each needs 5 scored questions or timed tasks\./)
    expect(panel.textContent).not.toMatch(/Insufficient data|Simple rt|_/)
  })
})

describe('a wedge click brings its panel into view (UX-046)', () => {
  it('scrolls the panel into view and focuses its heading', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const root = render(syntheticProfile('m1')!)
    click(root.querySelector('path.wedge[data-group="Speed"]'))
    await afterOpen()
    const h3 = root.querySelector('.facet-panel h3') as HTMLElement
    expect(h3.textContent).toBe('Speed: facets')
    expect(h3.getAttribute('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(h3)
    expect(scroll).toHaveBeenCalledTimes(1)
    expect((scroll.mock.instances[0] as Element).classList.contains('facet-panel')).toBe(true)
    expect(scroll.mock.calls[0]![0]).toEqual({ behavior: 'smooth', block: 'nearest' })
    // Closing it by the same wedge scrolls nothing.
    click(root.querySelector('path.wedge[data-group="Speed"]'))
    await afterOpen()
    expect(scroll).toHaveBeenCalledTimes(1)
  })

  it('does not animate for people who ask for less motion', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    window.matchMedia = ((q: string) => ({ matches: q.includes('prefers-reduced-motion'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
    const root = render(syntheticProfile('m1')!)
    click(root.querySelector('path.wedge[data-group="Speed"]'))
    await afterOpen()
    expect(scroll.mock.calls[0]![0]).toEqual({ behavior: 'auto', block: 'nearest' })
  })

  it('opening from a cluster button behaves as before: no scrolling, no focus move', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const root = render(syntheticProfile('m1')!)
    const btn = button(root, 'Speed')!
    btn.focus()
    click(btn)
    await afterOpen()
    expect(root.querySelector('.facet-panel')).not.toBeNull()
    expect(scroll).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(btn)
  })
})

describe('chart text follows the page text size (UX-044)', () => {
  const m1 = syntheticProfile('m1')!
  const labelFont = (root: HTMLElement): number => Number(root.querySelector('svg.hb-blob g.labels')!.getAttribute('font-size'))

  it('measures the page text size and gives larger labels at 200% text', () => {
    layout.width = 1200
    const normal = render(m1)
    settle()
    const base = labelFont(normal)
    unmount(app!)
    app = undefined
    document.body.innerHTML = ''
    layout.rootPx = 32
    const big = render(m1)
    settle()
    expect(labelFont(big)).toBeGreaterThanOrEqual(2 * base - 1e-6)
    expect(big.querySelector('[data-large-text-hint]')).toBeNull() // there is room on a wide screen
  })

  it('points to the bar view, beside the toggle, when large text cannot fit on a phone', () => {
    layout.width = 358
    layout.rootPx = 32
    expect(fitLayoutDetailed(axisEstimates(m1.input), 358, { rootPx: 32 }).legible).toBe(false)
    const root = render(m1)
    settle()
    const hint = root.querySelector('[data-large-text-hint]')!
    expect(hint.textContent).toBe('Large text: the bar view shows the same data in text.')
    expect(LARGE_TEXT_HINT).toBe(hint.textContent)
    expect(hint.parentElement!.querySelector('[role="group"]')).not.toBeNull() // beside the view toggle
    click(button(root, 'Bar view'))
    expect(root.querySelector('[data-large-text-hint]')).toBeNull()
  })

  it('says nothing at the default text size, however narrow the phone', () => {
    layout.width = 288
    layout.rootPx = 16
    const root = render(m1)
    settle()
    expect(root.querySelector('[data-large-text-hint]')).toBeNull()
  })
})

describe('small things (UX-047)', () => {
  it('names the figure by its title, so the caption is content and not a name', () => {
    const root = render(syntheticProfile('m1')!)
    const fig = root.querySelector('figure')!
    expect(fig.getAttribute('aria-label')).toBe('Skill profile blob')
    expect(fig.hasAttribute('aria-labelledby')).toBe(false)
  })

  it('takes the light colours when the page is printed: the dark query is for screens only', () => {
    const queries: string[] = []
    const lists: { matches: boolean; fire: (m: boolean) => void }[] = []
    window.matchMedia = ((q: string) => {
      queries.push(q)
      const handlers = new Set<(e: MediaQueryListEvent) => void>()
      const mql = {
        matches: q.startsWith('screen and (prefers-color-scheme: dark)'),
        media: q,
        addEventListener: (_t: string, h: (e: MediaQueryListEvent) => void) => handlers.add(h),
        removeEventListener: (_t: string, h: (e: MediaQueryListEvent) => void) => handlers.delete(h),
        fire(m: boolean) {
          mql.matches = m
          for (const h of handlers) h({ matches: m } as MediaQueryListEvent)
        },
      }
      lists.push(mql)
      return mql
    }) as unknown as typeof window.matchMedia
    const root = render(syntheticProfile('m1')!)
    expect(queries).toContain('screen and (prefers-color-scheme: dark)')
    const style = (): string => root.querySelector('section.hb-profile')!.getAttribute('style')!
    expect(style()).toContain(`--hb-bg: ${THEMES.dark.bg}`)
    // Printing: the screen query stops matching and the chart goes light.
    lists[0]!.fire(false)
    flushSync()
    expect(style()).toContain(`--hb-bg: ${THEMES.light.bg}`)
    expect(style()).toContain(`--hb-band-edge-opacity: ${THEMES.light.bandEdgeOpacity}`)
  })

  it('keeps the Emotion Reading sentence and the table roles the phone layout depends on', () => {
    const root = render(syntheticProfile('full')!)
    expect(root.querySelector('[data-skill-note="EMO"]')!.textContent).toBe(`${EMO_AXIS_NAME}. ${EMO_TOOLTIP}`)
    const table = root.querySelector('table.hb-bars')!
    expect(table.getAttribute('role')).toBe('table')
    expect(table.querySelectorAll('tr[role="row"]').length).toBe(18)
    expect(table.querySelectorAll('thead th[role="columnheader"]')).toHaveLength(5)
    expect(table.querySelectorAll('tbody th[role="rowheader"]')).toHaveLength(17)
    expect(table.querySelectorAll('[role="rowgroup"]')).toHaveLength(2)
    expect(table.querySelectorAll('tbody td[role="cell"]').length).toBeGreaterThan(17 * 3)
  })
})
