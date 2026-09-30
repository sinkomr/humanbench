/**
 * The blob and bar views on the dev-only demo route `#/dev/blob` (ROADMAP M1.16, M1.A; DESIGN §9,
 * §13; A12, A15): axe (0 serious/critical) in light and dark, blob and bar view, and with a
 * drill-down open; the table is the screen-reader default; all 17 spokes; no aggregate text; the
 * rendered page passes the language lint; and a real-browser render time for K = 17 with 20 fuzz
 * curves. The route exists because the e2e build sets VITE_HB_DEV_ROUTES=1 (playwright.config.ts).
 */

import { expect, test, type Page } from '@playwright/test'
import { lintText } from '../scripts/language-lint'
import { DISCLAIMER, HEADING } from '../src/copy'
import { expectNoSeriousAxe } from './axe'

const CI = Boolean(process.env.CI)
/** ROADMAP M1.16: render < 50 ms for K = 17 with 20 fuzz curves; CI-lenient on shared runners. */
const RENDER_BUDGET_MS = CI ? 150 : 50

async function open(page: Page, profile: string): Promise<void> {
  await page.goto(`./#/dev/blob?profile=${profile}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Blob demo (development only)' })).toBeVisible()
  await expect(page.locator('svg.hb-blob').first()).toBeVisible()
}

const table = (page: Page) => page.getByRole('table', { name: /Estimates by skill/ })

interface ChartText {
  readonly text: string
  /** Rendered font size, CSS px. */
  readonly px: number
  readonly paintOrder: string
  readonly haloWidth: number
  readonly fontSize: number
  /** Contrast of the text fill against its halo. */
  readonly contrast: number
  readonly haloIsBg: boolean
  /** The text's box lies inside its SVG's viewBox (text elements only; null for tspans). */
  readonly inside: boolean | null
}

/**
 * Every text of every blob on the page (M1.16 review): rendered size, halo and containment. A
 * string expression: the e2e tsconfig has no DOM lib.
 */
const AUDIT_CHART_TEXT = `(() => {
  const rgb = (s) => (s.match(/[\\d.]+/g) || []).slice(0, 3).map(Number)
  const lum = (c) => { const l = c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2] }
  const ratio = (a, b) => { const x = lum(rgb(a)), y = lum(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const out = []
  for (const svg of document.querySelectorAll('svg.hb-blob')) {
    const scale = svg.getScreenCTM().a
    const [vx, vy, vw, vh] = svg.getAttribute('viewBox').split(' ').map(Number)
    const bg = getComputedStyle(svg.closest('.hb-profile')).backgroundColor
    for (const el of svg.querySelectorAll('text, tspan')) {
      if (!el.textContent.trim()) continue
      const cs = getComputedStyle(el)
      let inside = null
      if (el.tagName === 'text') {
        const b = el.getBBox()
        inside = b.x >= vx - 1 && b.y >= vy - 1 && b.x + b.width <= vx + vw + 1 && b.y + b.height <= vy + vh + 1
      }
      out.push({ text: el.textContent, px: parseFloat(cs.fontSize) * scale, paintOrder: cs.paintOrder, haloWidth: parseFloat(cs.strokeWidth), fontSize: parseFloat(cs.fontSize), contrast: ratio(cs.fill, cs.stroke), haloIsBg: rgb(cs.stroke).join() === rgb(bg).join(), inside })
    }
  }
  return out
})()`

const auditChartText = (page: Page): Promise<ChartText[]> => page.evaluate<ChartText[]>(AUDIT_CHART_TEXT)

/**
 * Pairs of chart labels (spoke and ring labels) whose rendered boxes overlap. A text box spans the
 * font's full line height, taller than the ink, so each is trimmed by 0.2 em at the top and 0.1 em
 * at the bottom first.
 */
const LABEL_OVERLAPS = `(() => {
  const out = []
  for (const svg of document.querySelectorAll('svg.hb-blob')) {
    const boxes = [...svg.querySelectorAll('text.label, text.ring-label')].map((t) => {
      const b = t.getBBox()
      const fs = parseFloat(getComputedStyle(t).fontSize)
      return { text: t.textContent, x0: b.x, x1: b.x + b.width, y0: b.y + 0.2 * fs, y1: b.y + b.height - 0.1 * fs }
    })
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j]
      if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) out.push(a.text + ' / ' + b.text)
    }
  }
  return out
})()`

test.describe('blob demo route (M1.16)', () => {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`blob view, bar view and drill-down have no serious axe violations (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme })
      await open(page, 'full')
      await expectNoSeriousAxe(page)
      await page.getByRole('button', { name: 'Bar view' }).click()
      await expect(table(page)).toBeVisible()
      await expectNoSeriousAxe(page)
      await page.getByRole('button', { name: 'Knowledge', exact: true }).click()
      await expect(page.getByRole('heading', { level: 3, name: 'Knowledge: facets' })).toBeVisible()
      await expectNoSeriousAxe(page)
    })
  }

  test('an M1-like profile (mostly not measured) has no serious axe violations', async ({ page }) => {
    await open(page, 'm1')
    await page.getByRole('button', { name: 'Quantitative', exact: true }).click()
    await expect(page.getByRole('heading', { level: 3, name: 'Quantitative: facets' })).toBeVisible()
    await expectNoSeriousAxe(page)
  })

  test('shows all 17 spokes, stubs for the unmeasured, and the table as the screen-reader default', async ({ page }) => {
    await open(page, 'm1')
    const blob = page.getByRole('img', { name: 'Skill profile blob' })
    await expect(blob).toBeVisible()
    await expect(blob.locator('g.mark')).toHaveCount(17)
    const stubs = await blob.locator('g.mark.unmeasured').count()
    expect(stubs).toBeGreaterThanOrEqual(10)
    await expect(blob.locator('text.label', { hasText: 'not measured' })).toHaveCount(stubs)
    // Blob view: the table is visually hidden yet exposed to assistive tech, with row headers.
    await expect(table(page)).toBeAttached()
    await expect(table(page).getByRole('rowheader')).toHaveCount(17)
    await expect(table(page).getByRole('columnheader')).toHaveCount(5)
    await expect(table(page).getByRole('cell', { name: 'Not measured' }).first()).toBeAttached()
    // Its wrapper is the 1 px clipped box (a table cannot shrink below its content).
    const box = await table(page).locator('xpath=..').boundingBox()
    expect((box?.width ?? 0) * (box?.height ?? 0)).toBeLessThanOrEqual(1)
    // Bar view: visible, with the same rows; a narrow screen drops the cluster column (reflow).
    await page.getByRole('button', { name: 'Bar view' }).click()
    await expect(page.getByRole('button', { name: 'Bar view' })).toHaveAttribute('aria-pressed', 'true')
    await expect(table(page)).toBeVisible()
    await expect(table(page).getByRole('rowheader')).toHaveCount(17)
    await expect(table(page).getByRole('columnheader')).toHaveCount((page.viewportSize()?.width ?? 1280) < 640 ? 4 : 5)
    await expect(blob).toHaveCount(0)
    await expect(page.locator('svg.lollipop').first()).toBeVisible()
  })

  test('drill-down shows facet estimates only at ≥ 5 items (A12)', async ({ page }) => {
    await open(page, 'm1')
    const btn = page.getByRole('button', { name: 'Quantitative', exact: true })
    await btn.click()
    await expect(btn).toHaveAttribute('aria-expanded', 'true')
    const panel = page.locator('.facet-panel')
    await expect(panel.getByRole('cell', { name: 'Insufficient data (3 items; 5 needed)' })).toBeVisible()
    await expect(panel.getByRole('cell', { name: 'Insufficient data (2 items; 5 needed)' })).toBeVisible()
    await expect(panel.getByRole('rowheader', { name: /^Percent/ })).toBeVisible()
    await expect(panel.locator('tr[data-row="QR:percent"] td').nth(1)).toHaveText(/^[+−]?\d\.\d\d/)
    await expect(panel.getByRole('img', { name: 'Quantitative: facets' })).toBeVisible()
    await btn.click()
    await expect(panel).toHaveCount(0)
  })

  test('the page names no aggregate, stays in SD units, and passes the language lint (§9.5 a, A12, A13)', async ({ page }) => {
    await open(page, 'm1')
    for (const profile of ['m1', 'full', 'skipped', 'sparse']) {
      // Switching profile remounts the view (blob view again); a hash-only goto would not reload.
      await page.locator(`button[data-profile="${profile}"]`).click()
      await expect(page.locator(`button[data-profile="${profile}"]`)).toHaveAttribute('aria-pressed', 'true')
      for (const view of ['Blob view', 'Bar view']) {
        await page.getByRole('button', { name: view }).click()
        const text = await page.locator('body').innerText()
        expect(text, `${profile} ${view}`).not.toMatch(/\b(areas?|totals?|overall|sum|composite|aggregate|average|mean|combined|percentiles?|IQ score)\b/i)
        expect(text).toContain('provisional')
        expect(text).toContain(DISCLAIMER)
        const html = (await page.content()).replace(/\/assets\/[^"'\s)]+/g, '/assets/')
        expect(lintText(html, `blob-${profile}.html`)).toEqual([])
      }
    }
  })

  test('reflows at 320 CSS px with no sideways scrolling, in every view (WCAG 1.4.10)', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 })
    await open(page, 'full')
    // A string expression: the e2e tsconfig has no DOM lib.
    const overflow = (): Promise<number> => page.evaluate<number>('document.documentElement.scrollWidth - window.innerWidth')
    expect(await overflow()).toBeLessThanOrEqual(0)
    await page.getByRole('button', { name: 'Bar view' }).click()
    expect(await overflow()).toBeLessThanOrEqual(0)
    for (const c of ['Knowledge', 'Quantitative']) {
      await page.getByRole('button', { name: c, exact: true }).click()
      await expect(page.getByRole('heading', { level: 3, name: `${c}: facets` })).toBeVisible()
      expect(await overflow(), c).toBeLessThanOrEqual(0)
    }
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`chart text sits on a background halo (≥ 4.5:1), inside the viewBox, without overlaps, and ≥ 11 px on a phone (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme })
      // 1280: full width; 360: a common phone (the chart gets 328 px); 320: the WCAG reflow width.
      for (const [width, minPx] of [
        [1280, 11],
        [360, 11],
        [320, 10],
      ] as const) {
        await page.setViewportSize({ width, height: 900 })
        // A fresh load each time: a hash-only goto would keep the open drill-down.
        await page.goto('about:blank')
        await open(page, 'full')
        await page.getByRole('button', { name: 'Knowledge', exact: true }).click()
        await expect(page.locator('.facet-panel svg.hb-blob')).toBeVisible()
        // The text layout follows the rendered width (ResizeObserver), so poll until it settles.
        await expect.poll(async () => Math.min(...(await auditChartText(page)).map((t) => t.px)), { message: `${width}px: smallest chart text` }).toBeGreaterThanOrEqual(minPx - 0.05)
        const texts = await auditChartText(page)
        expect(texts.length).toBeGreaterThan(40)
        for (const t of texts) {
          const where = `${width}px ${colorScheme} "${t.text}"`
          expect(t.paintOrder, where).toMatch(/^stroke/)
          expect(t.haloIsBg, where).toBe(true)
          expect(t.haloWidth, where).toBeGreaterThanOrEqual(0.2 * t.fontSize)
          expect(t.contrast, where).toBeGreaterThanOrEqual(4.5)
          if (t.inside !== null) expect(t.inside, where).toBe(true)
        }
        expect(await page.evaluate<string[]>(LABEL_OVERLAPS), `${width}px overlapping labels`).toEqual([])
        expect(await page.evaluate<number>('document.documentElement.scrollWidth - window.innerWidth'), `${width}px overflow`).toBeLessThanOrEqual(0)
      }
    })
  }

  // Post-merge audit: re-laying the chart out inside the ResizeObserver callback made WebKit and
  // iOS raise "ResizeObserver loop completed with undelivered notifications" on every narrowing
  // resize or rotation; the width now reaches the layout a frame later (src/viz/width.ts).
  test('resizing and rotating the view raises no page errors, with a drill-down open too', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    // Two animation frames: long enough for an observer notification and the layout it triggers.
    const settle = (): Promise<unknown> => page.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))')
    const start = page.viewportSize()!
    for (const profile of ['m1', 'full', 'skipped', 'sparse']) {
      await page.setViewportSize(start)
      await page.goto('about:blank')
      await open(page, profile)
      if (profile === 'full') await page.getByRole('button', { name: 'Knowledge', exact: true }).click()
      await settle()
      for (const size of [
        { width: 360, height: 800 },
        { width: 844, height: 390 },
        { width: 320, height: 640 },
        { width: 1024, height: 768 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(size)
        await settle()
        await settle()
      }
    }
    expect(errors).toEqual([])
  })

  test('the mean curve is muted around muted spokes (§9.5)', async ({ page }) => {
    await open(page, 'full')
    const blob = page.locator('figure svg.hb-blob')
    const muted = blob.locator('path.crisp-muted')
    await expect(muted).toHaveCount(1)
    const ids = (await muted.getAttribute('data-spokes'))!.split(' ')
    const markers = await Promise.all((await blob.locator('g.mark.muted').all()).map((m) => m.getAttribute('data-spoke')))
    expect(markers.length).toBeGreaterThan(0)
    expect(new Set(ids)).toEqual(new Set(markers))
    // Computed strokes: the muted run in the muted token, the rest in the blob colour.
    const strokes = await page.evaluate<{ muted: string; crisp: string; mutedToken: string; blobToken: string }>(`(() => {
      const svg = document.querySelector('figure svg.hb-blob')
      const probe = document.createElement('div')
      svg.closest('.hb-profile').appendChild(probe)
      probe.style.color = 'var(--hb-muted)'
      const mutedToken = getComputedStyle(probe).color
      probe.style.color = 'var(--hb-blob)'
      const blobToken = getComputedStyle(probe).color
      probe.remove()
      return { muted: getComputedStyle(svg.querySelector('path.crisp-muted')).stroke, crisp: getComputedStyle(svg.querySelector('path.crisp')).stroke, mutedToken, blobToken }
    })()`)
    expect(strokes.muted).toBe(strokes.mutedToken)
    expect(strokes.crisp).toBe(strokes.blobToken)
    expect(strokes.muted).not.toBe(strokes.crisp)
  })

  test(`renders K = 17 with 20 fuzz curves in < ${RENDER_BUDGET_MS} ms`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'timed in Chromium; WebKit emulation timing is not representative')
    await open(page, 'm1')
    const main = page.locator('main')
    await expect(main).toHaveAttribute('data-render-seq', '1')
    const times: number[] = [Number(await main.getAttribute('data-render-ms'))]
    let seq = 1
    for (const profile of ['full', 'm1', 'full', 'skipped', 'full']) {
      await page.locator(`button[data-profile="${profile}"]`).click()
      // Wait on the render counter, not the time: two renders can print the same time.
      await expect(main).toHaveAttribute('data-render-seq', String(++seq))
      await expect(page.locator('svg.hb-blob .fuzz path')).toHaveCount(20)
      times.push(Number(await main.getAttribute('data-render-ms')))
    }
    console.info(`blob render ms (first mount, then profile switches): ${times.join(', ')}`)
    // Best of several, so a busy machine does not fail a fast renderer.
    expect(Math.min(...times)).toBeLessThan(RENDER_BUDGET_MS)
  })
})

test('an unknown dev route falls back to the home page', async ({ page }) => {
  await page.goto('./#/dev/nope')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADING)
})
