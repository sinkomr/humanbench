/// <reference lib="dom" />
/**
 * What the results page shows, measured in a real browser (UX-REVIEW D16: the compact top, one column).
 * Shared by `uxdec-reveal.spec.ts`, whose "measure" block writes the before and after figures of the package, and
 * whose checks read the same numbers. The e2e tsconfig has the DOM lib only through this reference; the page code
 * still goes through `page.evaluate` as a string so it runs in the page, not in Node.
 */

import type { Page } from '@playwright/test'

/** A box on the page, CSS px, from the top of the document (not of the window). */
export interface Box {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly bottom: number
}

/** What stands in the first window-height of the page: every heading, paragraph, button, link and the chart, in order. */
export interface FirstScreenItem {
  readonly what: string
  readonly top: number
  readonly bottom: number
}

export interface ResultsMeasure {
  readonly viewport: { readonly w: number; readonly h: number }
  readonly rootPx: number
  readonly pageHeight: number
  /** Left edge (x, CSS px) of the blocks that should share one: the h1, the lead line, the pointer, the practice note, the h2, the view toggle, the chart caption and the save panel (and its heading, inside the panel's padding). */
  readonly leftEdges: Readonly<Record<string, number | null>>
  /** The width of the content box of the page's main column. */
  readonly column: { readonly x: number; readonly w: number }
  readonly h1: Box | null
  readonly pointer: Box | null
  readonly practice: (Box & { readonly lines: number; readonly text: string }) | null
  readonly animButton: (Box & { readonly name: string }) | null
  readonly status: (Box & { readonly text: string; readonly clipped: boolean }) | null
  readonly profileHeading: Box | null
  readonly toolbar: Box | null
  readonly chart: Box | null
  readonly chartBox: Box | null
  readonly saveHeading: Box | null
  /** How much of the chart is inside the first window-height (CSS px, and as a share of its height). */
  readonly chartInFirstScreen: { readonly px: number; readonly share: number; readonly starts: boolean }
  readonly firstScreen: readonly FirstScreenItem[]
  readonly sidewaysOverflow: number
}

/** The measuring script: one expression, run in the page. */
const SCRIPT = `(() => {
  const round = (n) => Math.round(n * 10) / 10
  const box = (el) => {
    if (!el) return null
    const b = el.getBoundingClientRect()
    return { x: round(b.left + scrollX), y: round(b.top + scrollY), w: round(b.width), h: round(b.height), bottom: round(b.bottom + scrollY) }
  }
  const lines = (el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const tops = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0).map((r) => r.top).sort((a, b) => a - b)
    let n = 0
    let last = -1e9
    for (const t of tops) {
      if (t - last > 8) n++
      last = t
    }
    return n
  }
  const first = (sel, root = document) => root.querySelector(sel)
  const byText = (sel, re) => [...document.querySelectorAll(sel)].find((el) => re.test((el.textContent || '').trim())) || null
  const h1 = first('main h1')
  const lead = first('main > p')
  const pointer = first('[data-save-pointer]')
  const practice = first('[data-practice-adjusted]')
  const anim = [...document.querySelectorAll('.reveal button')].find((b) => /^(Replay|Skip) animation$/.test((b.textContent || '').trim())) || null
  const status = first('.reveal [role="status"]')
  const profileHeading = byText('.hb-profile h2', /^Profile by skill$/)
  const toolbar = first('.hb-profile .toolbar')
  const chart = first('svg.hb-blob')
  const chartBox = chart ? chart.closest('.chart-box') : null
  const saveHeading = byText('h2', /^Save your results$/)
  const caption = first('figcaption')
  const savePanel = first('[data-section="save"]')
  const main = first('main')
  const mainStyle = main ? getComputedStyle(main) : null
  const mainBox = main ? main.getBoundingClientRect() : null
  const vh = window.innerHeight
  const chartBoxRect = chart ? chart.getBoundingClientRect() : null
  const inView = chartBoxRect ? Math.max(0, Math.min(chartBoxRect.bottom, vh) - Math.max(chartBoxRect.top, 0)) : 0
  const items = []
  for (const el of document.querySelectorAll('main h1, main h2, main p, main button, main a, main summary, main svg.hb-blob')) {
    if (el.closest('svg') && !el.matches('svg')) continue
    const r = el.getBoundingClientRect()
    if (r.width <= 2 || r.height <= 2) continue
    if (r.top >= vh || r.bottom <= 0) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    items.push({ what: el.matches('svg') ? 'chart (blob)' : el.tagName.toLowerCase() + ': ' + (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 48), top: round(r.top + scrollY), bottom: round(r.bottom + scrollY) })
  }
  items.sort((a, b) => a.top - b.top)
  const left = (el) => (el ? round(el.getBoundingClientRect().left + scrollX) : null)
  const clipped = status ? (() => { const b = status.getBoundingClientRect(); return b.width <= 2 && b.height <= 2 })() : false
  return {
    viewport: { w: window.innerWidth, h: vh },
    rootPx: parseFloat(getComputedStyle(document.documentElement).fontSize),
    pageHeight: document.documentElement.scrollHeight,
    leftEdges: { h1: left(h1), lead: left(lead), pointer: left(pointer), practice: left(practice), profileHeading: left(profileHeading), toolbar: left(toolbar), caption: left(caption), savePanel: left(savePanel), saveHeading: left(saveHeading) },
    column: mainBox && mainStyle ? { x: round(mainBox.left + parseFloat(mainStyle.paddingLeft)), w: round(mainBox.width - parseFloat(mainStyle.paddingLeft) - parseFloat(mainStyle.paddingRight)) } : { x: 0, w: 0 },
    h1: box(h1),
    pointer: box(pointer),
    practice: practice ? { ...box(practice), lines: lines(practice), text: (practice.textContent || '').trim().replace(/\\s+/g, ' ') } : null,
    animButton: anim ? { ...box(anim), name: (anim.textContent || '').trim() } : null,
    status: status ? { ...box(status), text: (status.textContent || '').trim(), clipped } : null,
    profileHeading: box(profileHeading),
    toolbar: box(toolbar),
    chart: box(chart),
    chartBox: box(chartBox),
    saveHeading: box(saveHeading),
    chartInFirstScreen: { px: round(inView), share: chartBoxRect && chartBoxRect.height > 0 ? Math.round((inView / chartBoxRect.height) * 100) / 100 : 0, starts: !!chartBoxRect && chartBoxRect.top < vh },
    firstScreen: items,
    sidewaysOverflow: document.documentElement.scrollWidth - window.innerWidth,
  }
})()`

/** Measure the results page as it stands (scrolled to the top first, so "the first screen" is what a person sees on arrival). */
export async function measureResults(page: Page): Promise<ResultsMeasure> {
  await page.evaluate('window.scrollTo(0, 0)')
  return page.evaluate<ResultsMeasure>(SCRIPT)
}
