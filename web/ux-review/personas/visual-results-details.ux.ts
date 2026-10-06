/// <reference lib="dom" />
/**
 * Visual designer B, detail runs (package rev-visual-results; run id `visual-results`): chart close-ups at 2x, a colour-vision
 * simulation of the blob, the drill-down with motion allowed, the share-card downloads (PNG and SVG, light and dark), the
 * results printed (screenshot in print media and a PDF), the results of two sessions with every disclosure open, and computed
 * styles of the headings, cards and buttons. Chromium only; each test is short:
 *
 *   UX_PORT=4620 UX_RUN=visual-results npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/visual-results-details.ux.ts --project=chromium --grep 'vr-details: charts$'
 */

import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import { button, openDetails, scheme, toResults } from '../../e2e/flow'
import { openRoute, PREVIEW_ROUTES } from '../../e2e/routes'
import { setTextZoomNow } from '../../e2e/layout'
import { REPO_ROOT, Shots, trackConsole, UX_ROOT } from '../lib'

const RUN = process.env.UX_RUN ?? 'visual-results'
const SCHEMES = ['light', 'dark'] as const

const route = (id: string) => {
  const r = PREVIEW_ROUTES.find((x) => x.id === id)
  if (r === undefined) throw new Error(`no route ${id}`)
  return r
}

/** A context at 2x pixel density for close-ups (the project's own context is 1x). */
async function hiDpi(browser: Browser, testInfo: TestInfo, width = 1280): Promise<BrowserContext> {
  return browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true })
}

async function resultsBuilt(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await toResults(page)
  await expect(button(page, 'Download save file')).toBeVisible()
}

async function resultsSaved(page: Page): Promise<void> {
  await resultsBuilt(page)
  const dl = page.waitForEvent('download')
  await button(page, 'Download save file').click()
  await (await dl).cancel().catch(() => undefined)
  await expect(page.locator('[data-share-card]')).toBeVisible()
}

async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(250)
}

/** Computed styles of what a visual review compares across the results page. */
const STYLE_PROBE = `(() => {
  const pick = (el) => {
    const s = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return {
      sel: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).slice(0, 4).join('.') : ''),
      text: (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60),
      x: Math.round(r.left), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height),
      font: s.fontSize + '/' + s.lineHeight + ' ' + s.fontWeight, color: s.color, bg: s.backgroundColor,
      border: s.borderTopWidth + ' ' + s.borderTopStyle + ' ' + s.borderTopColor, radius: s.borderTopLeftRadius, margin: s.margin, padding: s.padding,
    }
  }
  const q = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().width > 0).map(pick)
  return {
    html: getComputedStyle(document.documentElement).backgroundColor, body: pick(document.body),
    h1: q('h1'), h2: q('h2'), h3: q('h3'), sections: q('main > *, .hb-reveal > *, section, article, details, fieldset, figure, footer'),
    buttons: q('button'), links: q('a'), notes: q('p.note, .note, figcaption p, [data-pending]'), status: q('[role=status]'), imgs: q('img, svg.hb-blob, svg.lollipop'),
  }
})()`

async function probe(page: Page, shots: Shots, name: string): Promise<void> {
  try {
    shots.json(name, await page.evaluate(STYLE_PROBE))
  } catch (error) {
    shots.json(name, { error: String(error) })
  }
}

// ------------------------------------------------------------------------------- results of two sessions

test('vr-details: results2', async ({ page }) => {
  const shots = new Shots(page, RUN, 'details-results2')
  const log = trackConsole(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await toResults(page, 2)
  await expect(button(page, 'Download save file')).toBeVisible()
  await openDetails(page)
  for (const width of [390, 1280, 1440]) {
    for (const s of SCHEMES) {
      await page.setViewportSize({ width, height: 900 })
      await scheme(page, s)
      await settle(page)
      await shots.shot(`results2-${width}-${s}`)
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  for (const s of SCHEMES) {
    await scheme(page, s)
    await settle(page)
    await probe(page, shots, `styles-results2-1280-${s}`)
  }
  shots.json('console', log)
})

// ------------------------------------------------------------------------------- charts at 2x

test('vr-details: charts', async ({ browser }, testInfo) => {
  const context = await hiDpi(browser, testInfo)
  const page = await context.newPage()
  const shots = new Shots(page, RUN, 'details-charts')
  trackConsole(page)
  await resultsBuilt(page)
  const blob = page.locator('svg.hb-blob').first()
  for (const width of [320, 390, 768, 1280]) {
    for (const s of SCHEMES) {
      await page.setViewportSize({ width, height: 900 })
      await scheme(page, s)
      await settle(page)
      await blob.scrollIntoViewIfNeeded()
      await shots.shot(`blob-${width}-${s}`, { locator: page.locator('figure.blob-figure').first() })
    }
  }
  // The bar view.
  await button(page, 'Bar view').click()
  for (const width of [320, 390, 1280]) {
    for (const s of SCHEMES) {
      await page.setViewportSize({ width, height: 900 })
      await scheme(page, s)
      await settle(page)
      await shots.shot(`bars-${width}-${s}`, { locator: page.locator('section.hb-profile').first() })
    }
  }
  await button(page, 'Blob view').click()
  // The drill-down open (reduced motion) at 390 and 1280.
  await page.getByRole('button', { name: 'Speed', exact: true }).click()
  await expect(page.locator('section.facet-panel')).toBeVisible()
  for (const width of [390, 1280]) {
    for (const s of SCHEMES) {
      await page.setViewportSize({ width, height: 900 })
      await scheme(page, s)
      await settle(page)
      await shots.shot(`facets-speed-${width}-${s}`, { locator: page.locator('section.facet-panel').first() })
    }
  }
  await context.close()
})

test('vr-details: dev-blob', async ({ browser }, testInfo) => {
  const context = await hiDpi(browser, testInfo)
  const page = await context.newPage()
  const shots = new Shots(page, RUN, 'details-devblob')
  trackConsole(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const profile of ['full', 'm1']) {
    await page.goto(`./#/dev/blob?profile=${profile}`)
    await expect(page.locator('svg.hb-blob').first()).toBeVisible()
    for (const width of [320, 390, 1280]) {
      for (const s of SCHEMES) {
        await page.setViewportSize({ width, height: 900 })
        await scheme(page, s)
        await settle(page)
        await shots.shot(`blob-${profile}-${width}-${s}`, { locator: page.locator('svg.hb-blob').first() })
      }
    }
  }
  await context.close()
})

// ------------------------------------------------------------------------------- colour-vision simulation

/** Machado, Oliveira & Fernandes (2009) matrices at full severity, applied in linear RGB (feColorMatrix's default space). */
const CVD: Readonly<Record<string, string>> = {
  protanopia: '0.152286 1.052583 -0.204868 0 0  0.114503 0.786281 0.099216 0 0  -0.003882 -0.048116 1.051998 0 0  0 0 0 1 0',
  deuteranopia: '0.367322 0.860646 -0.227968 0 0  0.280085 0.672501 0.047413 0 0  -0.011820 0.042940 0.968881 0 0  0 0 0 1 0',
  tritanopia: '1.255528 -0.076749 -0.178779 0 0  -0.078411 0.930809 0.147602 0 0  0.004733 0.691367 0.303900 0 0  0 0 0 1 0',
  achromatopsia: '0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0',
}

async function simulate(page: Page, kind: string | null): Promise<void> {
  await page.evaluate(
    ([k, matrix]) => {
      if (document.getElementById('hb-cvd-defs') === null) {
        const svg: Element = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        svg.id = 'hb-cvd-defs'
        svg.setAttribute('width', '0')
        svg.setAttribute('height', '0')
        svg.setAttribute('style', 'position:absolute')
        svg.innerHTML = '<filter id="hb-cvd"><feColorMatrix id="hb-cvd-m" type="matrix" values=""/></filter>'
        document.body.appendChild(svg)
      }
      document.getElementById('hb-cvd-m')?.setAttribute('values', matrix ?? '')
      document.documentElement.style.filter = k === null ? '' : 'url(#hb-cvd)'
    },
    [kind, kind === null ? null : (CVD[kind] ?? null)] as const,
  )
}

test('vr-details: colour-vision', async ({ browser }, testInfo) => {
  const context = await hiDpi(browser, testInfo, 1280)
  const page = await context.newPage()
  const shots = new Shots(page, RUN, 'details-cvd')
  trackConsole(page)
  await resultsBuilt(page)
  const fig = page.locator('figure.blob-figure').first()
  for (const s of SCHEMES) {
    await scheme(page, s)
    for (const kind of Object.keys(CVD)) {
      await simulate(page, kind)
      await settle(page)
      await fig.scrollIntoViewIfNeeded()
      await shots.shot(`results-${kind}-${s}`, { fullPage: false })
    }
    await simulate(page, null)
  }
  // The full synthetic profile: tier (c) hatch and every mark kind (a hash change alone does not leave the results).
  await page.goto('./#/dev/blob?profile=full')
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Blob demo (development only)' })).toBeVisible()
  await expect(page.locator('svg.hb-blob').first()).toBeVisible()
  for (const s of SCHEMES) {
    await scheme(page, s)
    for (const kind of [null, ...Object.keys(CVD)]) {
      await simulate(page, kind)
      await settle(page)
      await shots.shot(`devblob-${kind ?? 'normal'}-${s}`, { locator: page.locator('svg.hb-blob').first() })
    }
    await simulate(page, null)
  }
  await context.close()
})

// ------------------------------------------------------------------------------- motion

test('vr-details: motion', async ({ page }) => {
  const shots = new Shots(page, RUN, 'details-motion')
  trackConsole(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' })
  await toResults(page)
  // The build-up, a few frames.
  await expect(button(page, 'Skip animation')).toBeVisible()
  for (let i = 0; i < 6; i++) {
    await shots.shot(`buildup-${i}`, { fullPage: false })
    await page.waitForTimeout(500)
  }
  if (await button(page, 'Skip animation').isVisible().catch(() => false)) await button(page, 'Skip animation').click()
  await expect(button(page, 'Download save file')).toBeVisible({ timeout: 30_000 })
  await shots.shot('after-skip', { fullPage: false })
  // The drill-down opening with motion allowed (220 ms scale animation).
  const speed = page.getByRole('button', { name: 'Speed', exact: true })
  await speed.scrollIntoViewIfNeeded()
  await speed.click()
  // Freeze the panel's animation and step through it (Web Animations API), so each frame is where it says it is.
  const frozen = await page.evaluate(() => {
    const anims = document.getAnimations()
    for (const a of anims) a.pause()
    return anims.length
  })
  shots.json('drill-animations', { frozen })
  await page.locator('section.facet-panel').scrollIntoViewIfNeeded()
  for (const ms of [0, 55, 110, 165, 220]) {
    await page.evaluate((t) => {
      for (const a of document.getAnimations()) a.currentTime = t
    }, ms)
    await shots.shot(`drill-${ms}ms`, { fullPage: false })
  }
  await page.evaluate(() => {
    for (const a of document.getAnimations()) a.finish()
  })
  await page.locator('section.facet-panel').scrollIntoViewIfNeeded()
  await shots.shot('drill-open', { fullPage: false })
  // The mouse shortcut: hover and click a wedge of the blob.
  await page.locator('svg.hb-blob').first().scrollIntoViewIfNeeded()
  const wedge = page.locator('svg.hb-blob path.wedge').nth(2)
  await wedge.hover({ force: true })
  await shots.shot('wedge-hover', { fullPage: false })
  await wedge.click({ force: true })
  await page.waitForTimeout(300)
  await shots.shot('wedge-click', { fullPage: false })
})

// ------------------------------------------------------------------------------- share card

test('vr-details: share-card', async ({ page }) => {
  const shots = new Shots(page, RUN, 'details-share')
  trackConsole(page)
  const dir = path.join(UX_ROOT, RUN, 'details-share', 'downloads')
  mkdirSync(dir, { recursive: true })
  await page.setViewportSize({ width: 1280, height: 900 })
  await resultsSaved(page)
  const panel = page.locator('[data-share-card]')
  const files: Record<string, string> = {}
  for (const theme of ['Light', 'Dark'] as const) {
    await panel.getByRole('radio', { name: theme }).check()
    const png = panel.getByRole('button', { name: 'Download image (PNG)' })
    await expect(png).toBeEnabled({ timeout: 15_000 })
    let dl = page.waitForEvent('download')
    await png.click()
    let d = await dl
    const pngPath = path.join(dir, `card-${theme.toLowerCase()}.png`)
    await d.saveAs(pngPath)
    files[`png-${theme}`] = path.relative(REPO_ROOT, pngPath)
    dl = page.waitForEvent('download')
    await panel.getByRole('button', { name: 'Download vector image (SVG)' }).click()
    d = await dl
    const svgPath = path.join(dir, `card-${theme.toLowerCase()}.svg`)
    await d.saveAs(svgPath)
    files[`svg-${theme}`] = path.relative(REPO_ROOT, svgPath)
    for (const s of SCHEMES) {
      await scheme(page, s)
      await settle(page)
      await shots.shot(`panel-${theme.toLowerCase()}-card-${s}-page`, { locator: page.locator('[data-slot="share-card"]') })
    }
  }
  // The panel at phone width.
  await page.setViewportSize({ width: 390, height: 844 })
  for (const s of SCHEMES) {
    await scheme(page, s)
    await settle(page)
    await shots.shot(`panel-390-${s}`, { locator: page.locator('[data-slot="share-card"]') })
  }
  shots.json('files', files)
})

// ------------------------------------------------------------------------------- print

test('vr-details: print', async ({ page }, testInfo) => {
  const shots = new Shots(page, RUN, 'details-print')
  trackConsole(page)
  const dir = path.join(UX_ROOT, RUN, 'details-print')
  mkdirSync(dir, { recursive: true })
  await page.setViewportSize({ width: 1280, height: 900 })
  await resultsBuilt(page)
  for (const s of SCHEMES) {
    await page.emulateMedia({ media: 'print', colorScheme: s, reducedMotion: 'reduce' })
    await settle(page)
    await shots.shot(`print-before-save-${s}`)
  }
  await page.emulateMedia({ media: 'print', colorScheme: 'light' })
  if (testInfo.project.name === 'chromium') await page.pdf({ path: path.join(dir, 'results-before-save-a4.pdf'), format: 'A4', printBackground: true })
  // After the save, every disclosure open: what a person who prints to keep a copy gets.
  await page.emulateMedia({ media: 'screen' })
  const dl = page.waitForEvent('download')
  await button(page, 'Download save file').click()
  await (await dl).cancel().catch(() => undefined)
  await expect(page.locator('[data-share-card]')).toBeVisible()
  await openDetails(page)
  await page.emulateMedia({ media: 'print', colorScheme: 'dark' })
  await settle(page)
  await shots.shot('print-after-save-dark-os')
  await page.emulateMedia({ media: 'print', colorScheme: 'light' })
  await settle(page)
  await shots.shot('print-after-save-light')
  if (testInfo.project.name === 'chromium') {
    await page.pdf({ path: path.join(dir, 'results-after-save-a4.pdf'), format: 'A4', printBackground: true })
    await page.emulateMedia({ media: 'print', colorScheme: 'dark' })
    await page.pdf({ path: path.join(dir, 'results-after-save-a4-dark-os.pdf'), format: 'A4', printBackground: true })
  }
})

// ------------------------------------------------------------------------------- computed styles

test('vr-details: styles', async ({ page }) => {
  const shots = new Shots(page, RUN, 'details-styles')
  trackConsole(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await resultsSaved(page)
  for (const s of SCHEMES) {
    await scheme(page, s)
    await settle(page)
    await probe(page, shots, `results-saved-1280-${s}`)
  }
  for (const id of ['notes-filled', 'rt-selftest-results']) {
    await openRoute(page, route(id))
    for (const s of SCHEMES) {
      await scheme(page, s)
      await settle(page)
      await probe(page, shots, `${id}-1280-${s}`)
    }
  }
})

// ------------------------------------------------------------------------------- print, second look

test('vr-details: print2', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'page.pdf is Chromium only')
  const dir = path.join(UX_ROOT, RUN, 'details-print2')
  mkdirSync(dir, { recursive: true })
  await page.setViewportSize({ width: 1280, height: 900 })
  await resultsSaved(page)
  await openDetails(page)
  // What Chrome's print dialog gives by default: background graphics off. A person whose system is in dark mode.
  await page.emulateMedia({ media: 'print', colorScheme: 'dark', reducedMotion: 'reduce' })
  await page.pdf({ path: path.join(dir, 'dark-os-no-backgrounds.pdf'), format: 'A4', printBackground: false })
  await page.emulateMedia({ media: 'print', colorScheme: 'light', reducedMotion: 'reduce' })
  await page.pdf({ path: path.join(dir, 'light-no-backgrounds.pdf'), format: 'A4', printBackground: false })
  // A candidate fix for the footer overlap: the app shell as a plain block in print.
  await page.addStyleTag({ content: '@media print { #app { display: block !important; min-height: 0 !important; } }' })
  await page.pdf({ path: path.join(dir, 'light-shell-block.pdf'), format: 'A4', printBackground: false })
})

// ------------------------------------------------------------------------------- chart text sizes

const CHART_TEXT = `(() => {
  return [...document.querySelectorAll('svg.hb-blob')].map((svg) => {
    const vb = svg.viewBox.baseVal
    const scale = svg.getBoundingClientRect().width / vb.width
    const size = (sel) => { const g = svg.querySelector(sel); return g ? Number(g.getAttribute('font-size')) : null }
    const label = size('g.labels'), small = size('g.ring-labels')
    return { svgWidth: Math.round(svg.getBoundingClientRect().width), viewBox: vb.width + 'x' + vb.height, scale: +scale.toFixed(3),
      labelAttr: label, smallAttr: small, labelPx: label && +(label * scale).toFixed(1), smallPx: small && +(small * scale).toFixed(1),
      bodyPx: parseFloat(getComputedStyle(document.body).fontSize), rootPx: parseFloat(getComputedStyle(document.documentElement).fontSize) }
  })
})()`

test('vr-details: chart-text', async ({ page }) => {
  const shots = new Shots(page, RUN, 'details-chart-text')
  const out: Record<string, unknown> = {}
  await resultsBuilt(page)
  for (const zoom of [100, 200]) {
    await setTextZoomNow(page, zoom === 100 ? null : zoom)
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(300)
      out[`${zoom}%-${width}`] = await page.evaluate(CHART_TEXT)
      if (width === 390) await shots.shot(`blob-390-zoom${zoom}`, { locator: page.locator('figure.blob-figure').first() })
    }
  }
  shots.json('chart-text', out)
})
