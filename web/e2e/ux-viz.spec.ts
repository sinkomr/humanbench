/**
 * UX review fixes for the profile view (ROADMAP UX workstream, fix-viz; DESIGN §9, §13; A12, A13), on the
 * dev-only demo route `#/dev/blob`: estimates beyond the scale are marked and never read as "not measured"
 * (UX-037), the bar view keeps whole words and a readable lollipop at phone widths (UX-043), chart text follows
 * the page's text size or points to the bar view (UX-044), a click on a wedge brings its panel into view
 * (UX-046), the facet panel shows no empty chart (UX-040, UX-041), the copy says "90% range" and puts the
 * warning about the shape first (UX-039), and a printed chart is light (UX-047). The unit and jsdom tests of
 * `src/viz` hold the rest (card text sizes, geometry, label placement).
 */

import { expect, test, type Page } from '@playwright/test'
import { expectNoSeriousAxe } from './axe'
import { expectNoSidewaysScroll, useTextZoom } from './layout'

async function open(page: Page, profile: string): Promise<void> {
  await page.goto(`./#/dev/blob?profile=${profile}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Blob demo (development only)' })).toBeVisible()
  await expect(page.locator('svg.hb-blob').first()).toBeVisible()
}

const table = (page: Page) => page.getByRole('table', { name: /Estimates by skill/ })

/**
 * Words of the visible table cells that a browser has set across two lines (a word cut in two), and the
 * widths of the lollipops. A string expression: the e2e tsconfig has no DOM lib. A zero-width space after "/"
 * is a place a word may break on purpose.
 */
const BROKEN_WORDS = `(() => {
  const broken = []
  const root = document.querySelector('.hb-bars-wrap:not(.visually-hidden) table')
  if (!root) return { broken: ['no visible table'], words: 0 }
  let words = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement
    if (!el || el.closest('thead') || el.closest('.visually-hidden') || getComputedStyle(el).visibility === 'hidden') continue
    for (const m of n.textContent.matchAll(/[^\\s\\u200b-]+/g)) {
      const r = document.createRange()
      r.setStart(n, m.index)
      r.setEnd(n, m.index + m[0].length)
      const rects = [...r.getClientRects()].filter((q) => q.width > 0)
      if (rects.length === 0) continue
      words++
      // One word on two lines: its rects stack (different tops) instead of sitting side by side.
      const tops = new Set(rects.map((q) => Math.round(q.top)))
      if (tops.size > 1) broken.push(m[0])
    }
  }
  return { broken, words }
})()`

interface WordReport {
  readonly broken: string[]
  readonly words: number
}

test.describe('estimates beyond the scale (UX-037)', () => {
  test('are marked with an arrowhead on the chart, never drawn as a stub, and explained', async ({ page }) => {
    await open(page, 'offscale')
    const blob = page.locator('figure svg.hb-blob')
    await expect(blob.locator('path.arrow')).toHaveCount(2)
    await expect(blob.locator('g.mark[data-spoke="PS"] path.arrow')).toHaveAttribute('data-off-scale', 'low')
    await expect(blob.locator('g.mark[data-spoke="RT"] path.arrow')).toHaveAttribute('data-off-scale', 'high')
    // Measured, not a stub: no grey stub line, no gap ring, and its label says "off scale", not "not measured".
    await expect(blob.locator('g.mark[data-spoke="PS"]')).not.toHaveClass(/unmeasured/)
    await expect(blob.locator('g.mark[data-spoke="PS"] line.stub')).toHaveCount(0)
    await expect(blob.locator('text.label', { hasText: 'off scale' })).toHaveCount(2)
    await expect(page.locator('figcaption')).toContainText('An arrow at the centre or the rim of the chart marks an estimate at or past the end of the scale (−3 or +3 SD); the table gives the number.')
    // The arrow sits at the rim for a high estimate and at the centre for a low one (radius stays linear: it is an extra mark).
    const radii = await page.evaluate<{ low: number; high: number; R: number }>(`(() => {
      const tip = (id) => { const d = document.querySelector('figure svg.hb-blob g.mark[data-spoke="' + id + '"] path.arrow').getAttribute('d'); const m = /^M(-?[\\d.]+),(-?[\\d.]+)L/.exec(d); return Math.hypot(+m[1], +m[2]) }
      return { low: tip('PS'), high: tip('RT'), R: 180 }
    })()`)
    expect(radii.low).toBeCloseTo(0.04 * radii.R, 0)
    expect(radii.high).toBeCloseTo(radii.R, 0)
    await expectNoSeriousAxe(page)
  })

  test('are marked at the end of the line in the bar view, with the words "(off scale)" in the cell', async ({ page }) => {
    await open(page, 'offscale')
    await page.getByRole('button', { name: 'Bar view' }).click()
    await expect(table(page)).toBeVisible()
    await expect(page.locator('svg.lollipop path.arrow')).toHaveCount(2)
    await expect(page.locator('tr[data-row="PS"] td.estimate')).toContainText('(off scale)')
    await expect(page.locator('tr[data-row="PS"] td.estimate')).toHaveText(/^−\d\.\d\d\s±\s\d\.\d\d\s\(off scale\)$/)
    await expect(page.locator('tr[data-row="QR"] td.estimate')).not.toContainText('off scale')
    await expect(page.locator('p.note', { hasText: 'An arrow at the end of a line marks an estimate' })).toBeVisible()
    await expectNoSeriousAxe(page)
  })

  test('an ordinary profile shows no arrow and no such sentence', async ({ page }) => {
    await open(page, 'm1')
    await expect(page.locator('figure svg.hb-blob path.arrow')).toHaveCount(0)
    await expect(page.locator('figcaption')).not.toContainText('An arrow')
  })
})

test.describe('the bar view keeps whole words and a readable lollipop (UX-043)', () => {
  for (const width of [320, 390, 1280]) {
    test(`at ${width} px: no word is cut in two, no sideways scrolling, a lollipop of readable width, axe is clean`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await open(page, 'full')
      await page.getByRole('button', { name: 'Bar view' }).click()
      await expect(table(page)).toBeVisible()
      const report = await page.evaluate<WordReport>(BROKEN_WORDS)
      expect(report.words).toBeGreaterThan(60)
      expect(report.broken, `${width}px: words set across two lines`).toEqual([])
      await expectNoSidewaysScroll(page, `bar view ${width}px`)
      const widths = await page.locator('svg.lollipop').evaluateAll((els) => els.map((e) => (e as unknown as { getBoundingClientRect(): { width: number } }).getBoundingClientRect().width))
      expect(widths.length).toBeGreaterThan(5)
      // A phone gives each lollipop a line of its own (up to 15 rem); a desktop keeps it beside the numbers.
      const least = width < 640 ? 200 : 72
      for (const w of widths) expect(w, `${width}px lollipop`).toBeGreaterThanOrEqual(least)
      await expectNoSeriousAxe(page)
    })
  }

  test('the table keeps its roles on a phone, where each row is laid out as a card', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 })
    await open(page, 'full')
    await page.getByRole('button', { name: 'Bar view' }).click()
    await expect(table(page)).toBeVisible()
    await expect(table(page).getByRole('row')).toHaveCount(18)
    await expect(table(page).getByRole('rowheader')).toHaveCount(17)
    await expect(table(page).getByRole('columnheader')).toHaveCount(4)
    // The first estimate row, read the way a screen reader reads it: name, estimate, range, comparison.
    const row = table(page).getByRole('row').nth(1)
    await expect(row.getByRole('rowheader')).toBeVisible()
    await expect(row.getByRole('cell')).toHaveCount(3)
    // Each part of the row is on screen and inside the window: name, estimate, range, comparison.
    // (The range cell gives its box away to the range text and the lollipop, which are checked below.)
    for (const cell of await row.locator('th, td.estimate, td.relation, .range-text, svg.lollipop').all()) {
      const box = await cell.boundingBox()
      expect(box, 'a part of the card row has a box').not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(321)
    }
  })

  test('the numbers stay together on their line: the estimate, its ±, and "0 SD"', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 })
    await open(page, 'm1')
    await page.getByRole('button', { name: 'Bar view' }).click()
    const cell = page.locator('tr[data-row="MAT"] td.estimate')
    await expect(cell).toHaveText(/^[+−]\d\.\d\d\s±\s\d\.\d\d$/)
    const lines = await cell.evaluate((el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size
    })
    expect(lines).toBe(1)
  })
})

test.describe('chart text follows the page text size (UX-044)', () => {
  test('at 200% text on a wide screen the chart labels grow with it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await open(page, 'm1')
    const smallest = (): Promise<number> =>
      page.evaluate<number>(`(() => {
        const svg = document.querySelector('figure svg.hb-blob'); const s = svg.getScreenCTM().a
        return Math.min(...[...svg.querySelectorAll('text.ring-label, text.label')].map((t) => parseFloat(getComputedStyle(t).fontSize) * s))
      })()`)
    const normal = await smallest()
    expect(normal).toBeGreaterThanOrEqual(10.9)
    await useTextZoom(page, 200)
    await page.goto('about:blank')
    await page.goto('./#/dev/blob?profile=m1')
    await expect(page.locator('svg.hb-blob').first()).toBeVisible()
    await expect.poll(smallest, { message: 'smallest chart text at 200% text' }).toBeGreaterThanOrEqual(2 * 11 - 0.5)
    await expect(page.locator('[data-large-text-hint]')).toHaveCount(0)
  })

  test('on a phone at 200% text the page points to the bar view, beside the toggle, and the bar view fits', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await useTextZoom(page, 200)
    await open(page, 'full')
    const hint = page.locator('[data-large-text-hint]')
    await expect(hint).toBeVisible()
    await expect(hint).toHaveText('Large text: the bar view shows the same data in text.')
    await page.getByRole('button', { name: 'Bar view' }).click()
    await expect(hint).toHaveCount(0)
    await expect(table(page)).toBeVisible()
    await expectNoSidewaysScroll(page, 'bar view at 200% text, 390 px')
  })

  test('at the default text size there is no such hint, even on the narrowest phone', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 })
    await open(page, 'full')
    await expect(page.locator('[data-large-text-hint]')).toHaveCount(0)
  })
})

test.describe('the facet panel (UX-040, UX-041, UX-046)', () => {
  test('a cluster with no facet that has enough data says so in one line and lists the names, with no chart and no table', async ({ page }) => {
    await open(page, 'm1')
    await page.getByRole('button', { name: 'Speed', exact: true }).click()
    const panel = page.locator('.facet-panel')
    await expect(panel.getByRole('heading', { level: 3, name: 'Speed: facets' })).toBeVisible()
    await expect(panel.locator('.facet-none')).toHaveText('None of the 4 facets of Speed has enough data yet: each needs 5 scored questions or timed tasks. Facets fill in over several sessions.')
    await expect(panel.locator('svg')).toHaveCount(0)
    await expect(panel.getByRole('table')).toHaveCount(0)
    await expect(panel.getByRole('listitem')).toHaveText(['Simple reaction time', 'Choice reaction time', 'Shape to digit', 'Reading speed'])
    await expect(panel).not.toContainText(/Simple rt|Insufficient data|_/)
    await expectNoSeriousAxe(page)
  })

  test('the quantitative facets read as words, in questions and timed tasks', async ({ page }) => {
    await open(page, 'full')
    await page.getByRole('button', { name: 'Spatial/Memory', exact: true }).click()
    const panel = page.locator('.facet-panel')
    await expect(panel.getByRole('rowheader', { name: 'Mental rotation (3D)' })).toBeVisible()
    await expect(panel).not.toContainText(/3d rotation|Digits forward|\bitems?\b|\bblocks?\b/)
    await expect(panel.getByRole('rowheader', { name: /^Digits, same order/ })).toBeVisible()
  })

  test('a click on a wedge brings the panel into view and puts focus on its heading', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 700 })
    await open(page, 'm1')
    const wedge = page.locator('figure path.wedge[data-group="Speed"]')
    const panel = page.locator('.facet-panel')
    await expect(panel).toHaveCount(0)
    // A synthetic click: the wedge is a thin slice, and what is tested is the handler, not where a pointer lands.
    await wedge.dispatchEvent('click')
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('heading', { level: 3, name: 'Speed: facets' })).toBeFocused()
    // The page scrolled (smooth, so poll): the heading is inside the window.
    await expect
      .poll(async () => {
        const box = await panel.getByRole('heading', { level: 3 }).boundingBox()
        const height = page.viewportSize()!.height
        return box !== null && box.y >= 0 && box.y + box.height <= height
      }, { message: 'the facet heading is on screen' })
      .toBe(true)
  })

  test('the cluster buttons behave as before: they open the panel where it is, and do not move the focus to it', async ({ page }) => {
    await open(page, 'm1')
    const btn = page.getByRole('button', { name: 'Speed', exact: true })
    await btn.click()
    await expect(page.locator('.facet-panel')).toBeVisible()
    // (Safari does not focus a button it was clicked on, so the button itself is not asserted.)
    await expect(page.getByRole('heading', { level: 3, name: 'Speed: facets' })).not.toBeFocused()
    await expect(btn).toHaveAttribute('aria-expanded', 'true')
  })
})

test.describe('copy that means one thing (UX-039)', () => {
  test('"90% range" everywhere, the estimate as "±", and the warning about the shape comes first', async ({ page }) => {
    await open(page, 'full')
    const first = page.locator('figcaption p').first()
    await expect(first).toContainText('Compare spokes one at a time: the size of the shape means nothing on its own.')
    await page.getByRole('button', { name: 'Bar view' }).click()
    const text = await page.locator('main').innerText()
    expect(text).not.toMatch(/interval|consensus-keyed|provisional norms|whisker/i)
    expect(text).toContain('90% range (SD)')
    await expect(table(page).getByRole('columnheader', { name: /Estimate \(SD units\)/ })).toBeVisible()
    for (const cell of await page.locator('tbody td.estimate').allInnerTexts()) expect(cell).not.toMatch(/\(SD \d/)
  })

  test('the tier legend uses plain words', async ({ page }) => {
    await open(page, 'full')
    const legend = page.locator('figcaption')
    await expect(legend).toContainText('timed, memory or estimation tasks, compared with provisional typical values')
    await expect(legend).toContainText('answers scored by how most people respond, so less certain')
  })
})

test.describe('small things (UX-045, UX-047)', () => {
  test('the chart is named by its title alone and the figure by the same title', async ({ page }) => {
    await open(page, 'm1')
    await expect(page.getByRole('img', { name: 'Skill profile blob', exact: true })).toBeVisible()
    await expect(page.getByRole('figure', { name: 'Skill profile blob', exact: true })).toBeVisible()
    await expect(page.locator('figure svg.hb-blob')).toHaveAttribute('aria-describedby', /desc$/)
  })

  test('the ring labels are painted under the curve, the markers and the whiskers', async ({ page }) => {
    await open(page, 'full')
    const order = await page.locator('figure svg.hb-blob').evaluate((svg) => [...svg.children].map((c) => (c.getAttribute('class') ?? c.localName).split(' ')[0]))
    const at = (c: string): number => order.indexOf(c)
    expect(at('ring-labels')).toBeGreaterThan(at('grid'))
    for (const later of ['band', 'fuzz', 'crisp', 'marks', 'labels']) expect(at('ring-labels'), later).toBeLessThan(at(later))
  })

  test('the ±1 SD band is outlined so it shows against the page', async ({ page }) => {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await open(page, 'm1')
      const edge = await page.locator('figure svg.hb-blob path.band').evaluate((el) => {
        const cs = getComputedStyle(el)
        return { stroke: cs.stroke, opacity: parseFloat(cs.strokeOpacity), width: parseFloat(cs.strokeWidth) }
      })
      expect(edge.stroke, colorScheme).not.toBe('none')
      expect(edge.opacity, colorScheme).toBeGreaterThanOrEqual(0.4)
      expect(edge.width, colorScheme).toBeGreaterThan(0)
    }
  })

  test('the results heading is the size of the other headings', async ({ page }) => {
    await open(page, 'm1')
    const size = await page.getByRole('heading', { level: 2, name: 'Profile by skill' }).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    expect(size).toBe(20)
  })

  test('printed on paper the chart takes the light colours, whatever the screen scheme', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'print emulation is read from Chromium only; the query itself is unit-tested')
    await page.emulateMedia({ colorScheme: 'dark' })
    await open(page, 'm1')
    const bg = (): Promise<string> => page.locator('section.hb-profile').evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(await bg()).toBe('rgb(21, 21, 26)')
    await page.emulateMedia({ media: 'print', colorScheme: 'dark' })
    await expect.poll(bg, { message: 'the chart goes light for print' }).toBe('rgb(255, 255, 255)')
  })
})
