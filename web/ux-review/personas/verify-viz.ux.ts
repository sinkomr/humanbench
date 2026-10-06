/// <reference lib="dom" />
/**
 * Verification package (run id `verify`), viz area: the original scenarios of UX-037 to UX-048a and the integration item
 * UX-048b on the FIXED build. Evidence under web/test-results/ux-review/verify/<item id>/.
 *
 *   UX_REUSE=1 UX_PORT=4653 UX_RUN=verify npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/verify-viz.ux.ts --project=chromium
 */

import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { button, scheme, toResults } from '../../e2e/flow'
import { setTextZoomNow } from '../../e2e/layout'
import { openRoute, PREVIEW_ROUTES, type Route } from '../../e2e/routes'
import { pageMetrics, REPO_ROOT, Shots, trackConsole, UX_ROOT } from '../lib'

const RUN = process.env.UX_RUN ?? 'verify'

test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 })

function routeOf(id: string): Route {
  const r = PREVIEW_ROUTES.find((x) => x.id === id)
  if (r === undefined) throw new Error(`no route ${id}`)
  return r
}

async function open(page: Page, id: string): Promise<void> {
  await page.goto('./favicon.svg')
  await page.evaluate('localStorage.clear(); sessionStorage.clear()')
  const r = routeOf(id)
  await r.prepare?.(page)
  if (r.motion !== 'allow') await page.emulateMedia({ reducedMotion: 'reduce' })
  await openRoute(page, r)
}

async function press(touch: boolean, target: Locator): Promise<void> {
  if (touch) await target.tap()
  else await target.click()
}

const PROFILE = 'section.hb-profile'
const MAIN_BLOB = `${PROFILE} figure.blob-figure svg.hb-blob`

/** The blob as drawn: marks, arrows, labels, the paint order of the ring labels, the band outline. */
const BLOB = `((sel) => {
  const svg = document.querySelector(sel)
  if (!svg) return null
  const order = [...svg.children].map((c) => c.tagName.toLowerCase() + (c.getAttribute('class') ? '.' + c.getAttribute('class') : ''))
  const marks = [...svg.querySelectorAll('g.mark')].map((m) => ({ id: m.getAttribute('data-spoke'), unmeasured: m.classList.contains('unmeasured'), muted: m.classList.contains('muted'), arrow: m.querySelector('path.arrow') ? m.querySelector('path.arrow').getAttribute('data-off-scale') : null, hasMarker: m.querySelector('circle.marker') !== null, hasWhisker: m.querySelector('line.whisker') !== null, whiskerLen: (() => { const w = m.querySelector('line.whisker'); if (!w) return null; const dx = +w.getAttribute('x2') - +w.getAttribute('x1'), dy = +w.getAttribute('y2') - +w.getAttribute('y1'); return Math.round(Math.hypot(dx, dy) * 10) / 10 })(), markerR: (() => { const c = m.querySelector('circle.marker'); if (!c) return null; return Math.round(Math.hypot(+c.getAttribute('cx'), +c.getAttribute('cy')) * 10) / 10 })(), hasStub: m.querySelector('line.stub') !== null }))
  const labels = [...svg.querySelectorAll('g.labels text')].map((t) => ({ text: (t.textContent || '').replace(/\\s+/g, ' ').trim(), unmeasured: t.classList.contains('unmeasured'), lines: t.querySelectorAll('tspan').length, note: [...t.querySelectorAll('tspan')].map((s) => (s.textContent || '').trim()).filter((s) => /off scale|not measured|skipped|not offered/i.test(s)) }))
  const ringLabels = [...svg.querySelectorAll('g.ring-labels text')].map((t) => (t.textContent || '').trim())
  const band = svg.querySelector('path.band')
  const bcs = band ? getComputedStyle(band) : null
  const vb = svg.viewBox.baseVal
  const scale = svg.getBoundingClientRect().width / vb.width
  const fs = (s) => { const g = svg.querySelector(s); return g ? Math.round(+g.getAttribute('font-size') * scale * 10) / 10 : null }
  return { order, marks, labels, ringLabels, ringNote: [...svg.querySelectorAll('text.ring-note')].map((t) => (t.textContent || '').trim()), band: bcs ? { fill: bcs.fill, fillOpacity: bcs.fillOpacity, stroke: bcs.stroke, strokeWidth: bcs.strokeWidth, strokeOpacity: bcs.strokeOpacity } : null, labelPx: fs('g.labels'), ringLabelPx: fs('g.ring-labels'), svgWidth: Math.round(svg.getBoundingClientRect().width), aria: { labelledby: svg.getAttribute('aria-labelledby'), describedby: svg.getAttribute('aria-describedby'), role: svg.getAttribute('role') } }
})`

// ------------------------------------------------------------------------------------------------ UX-037

test('verify UX-037 off-scale estimates', async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `UX-037/${testInfo.project.name}`)
  const log = trackConsole(page)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  if (!touch) await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('./#/dev/blob?profile=offscale')
  await expect(page.locator(MAIN_BLOB)).toBeVisible()
  await page.waitForTimeout(400)
  const blob = (await page.evaluate(`${BLOB}(${JSON.stringify(MAIN_BLOB)})`)) as { marks: { id: string; arrow: string | null; whiskerLen: number | null; markerR: number | null; hasStub: boolean; unmeasured: boolean }[]; labels: { text: string; note: string[] }[] }
  facts['dev offscale blob'] = blob
  facts['dev offscale arrows'] = blob.marks.filter((m) => m.arrow !== null)
  facts['dev offscale not-measured stub radius vs arrow'] = { stubs: blob.marks.filter((m) => m.hasStub).length, arrows: blob.marks.filter((m) => m.arrow !== null).length }
  facts['dev offscale caption'] = await page.locator('figure.blob-figure figcaption').innerText().then((t) => t.match(/[^.\n]*(off scale|beyond|arrow)[^.\n]*\./gi))
  await shots.shot('dev-offscale-chart', { locator: page.locator(`${PROFILE} figure.blob-figure`) })
  await press(touch, page.getByRole('button', { name: 'Bar view' }))
  await expect(page.locator('svg.lollipop').first()).toBeVisible()
  await page.waitForTimeout(200)
  facts['dev offscale bars'] = await page.evaluate(() => [...document.querySelectorAll('table.hb-bars tbody tr')].map((tr) => ({ name: (tr.querySelector('th')?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30), estimate: (tr.querySelector('td.estimate')?.textContent ?? '').replace(/\s+/g, ' ').trim(), arrow: tr.querySelector('path.arrow')?.getAttribute('data-off-scale') ?? null, dot: tr.querySelector('circle.dot') !== null, rangeLen: (() => { const l = tr.querySelector('line.range'); return l ? Math.round(Math.abs(+l.getAttribute('x2')! - +l.getAttribute('x1')!)) : null })() })))
  facts['dev offscale bars note'] = await page.locator(`${PROFILE} p.note`).allInnerTexts().then((ts) => ts.filter((t) => /arrow|off scale|end of the scale/i.test(t)))
  await shots.shot('dev-offscale-bars', { locator: page.locator(PROFILE) })
  // A real results page: a one-session profile and the share card both carry the same marks (card mirrors the chart).
  await page.goto('./favicon.svg')
  await page.evaluate('localStorage.clear(); sessionStorage.clear()')
  await toResults(page, 1)
  await expect(button(page, 'Download save file')).toBeVisible()
  await page.waitForTimeout(300)
  facts['results blob (sim 1 session)'] = (await page.evaluate(`${BLOB}(${JSON.stringify(MAIN_BLOB)})`)) as object
  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[verify UX-037] ${JSON.stringify(facts['dev offscale arrows'])} ${JSON.stringify(facts['dev offscale bars']).slice(0, 800)}`)
})

// ------------------------------------------------------------------------------------------------ UX-038 / UX-045 / UX-047 (card)

test('verify UX-038 share card legibility at feed size', async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.hasTouch === true, 'desktop downloads')
  const shots = new Shots(page, RUN, `UX-038/${testInfo.project.name}`)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  const dir = path.join(UX_ROOT, RUN, 'UX-038', 'downloads')
  mkdirSync(dir, { recursive: true })
  await page.setViewportSize({ width: 1280, height: 900 })
  await open(page, 'results-saved')
  const panel = page.locator('[data-share-card]')
  for (const theme of ['Light', 'Dark'] as const) {
    await panel.getByRole('radio', { name: theme }).check()
    await expect(panel.getByRole('button', { name: 'Download image (PNG)' })).toBeEnabled({ timeout: 15_000 })
    await page.waitForTimeout(300)
    let dl = page.waitForEvent('download')
    await panel.getByRole('button', { name: 'Download vector image (SVG)' }).click()
    const svgFile = path.join(dir, `card-${theme.toLowerCase()}.svg`)
    await (await dl).saveAs(svgFile)
    dl = page.waitForEvent('download')
    await panel.getByRole('button', { name: 'Download image (PNG)' }).click()
    const pngFile = path.join(dir, `card-${theme.toLowerCase()}.png`)
    await (await dl).saveAs(pngFile)
    const { readFileSync } = await import('node:fs')
    const svg = readFileSync(svgFile, 'utf8')
    // Every text of the card with its font size (card px, 1200 wide): at 600 px wide each is half.
    const texts = await page.evaluate((src) => {
      const doc = new DOMParser().parseFromString(src, 'image/svg+xml')
      const out: { text: string; px: number }[] = []
      const walk = (el: Element, inherited: number): void => {
        const own = el.getAttribute('font-size')
        const size = own !== null && own !== '' ? parseFloat(own) : inherited
        if (el.tagName === 'text' || el.tagName === 'tspan') {
          const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
          if (t !== '' && el.tagName === 'text') out.push({ text: t.slice(0, 70), px: Math.round(size * 10) / 10 })
        }
        for (const c of el.children) walk(c, size)
      }
      walk(doc.documentElement, 16)
      // Styled text (CSS in the card): font sizes in <style>
      const style = doc.querySelector('style')?.textContent ?? ''
      return { out, style: style.slice(0, 1500) }
    }, svg)
    const sizes = texts.out.map((t) => t.px).filter((n) => Number.isFinite(n))
    facts[`${theme} card texts`] = texts.out
    facts[`${theme} smallest card text px (at 1200 wide)`] = Math.min(...sizes)
    facts[`${theme} smallest at 600 wide`] = Math.round((Math.min(...sizes) / 2) * 10) / 10
    facts[`${theme} key present`] = { filled: /Filled:/.test(svg), hollow: /Hollow:/.test(svg), sdSpelled: /SD means standard deviation/.test(svg), ringNote: /Rings: SD units, provisional/.test(svg), centre: /Centre: .3 SD/.test(svg), overlapCaveatCount: (svg.match(/Ranges that overlap are not real differences\./g) ?? []).length, roughEstimates: /Rough estimates/.test(svg) }
    facts[`${theme} ring label order`] = await page.evaluate((src) => { const doc = new DOMParser().parseFromString(src, 'image/svg+xml'); const svg = doc.querySelector('svg.hb-blob, svg [class*=blob], g.blob') ?? doc.documentElement; const ids = [...svg.querySelectorAll('g')].map((g) => g.getAttribute('class') ?? '').filter((c) => c !== ''); return ids.slice(0, 20) }, svg)
    facts[`${theme} files`] = { svg: path.relative(REPO_ROOT, svgFile), png: path.relative(REPO_ROOT, pngFile) }
    // The preview on the page, and a 600 px wide rendering of the PNG (what a feed shows).
    await shots.shot(`${theme.toLowerCase()}-panel`, { locator: page.locator('[data-slot="share-card"]') })
    const img = page.locator('img[data-preview]')
    facts[`${theme} preview css width`] = await img.evaluate((el) => Math.round(el.getBoundingClientRect().width))
  }
  // Render the light PNG at 600 px wide on a blank page for a look at feed size.
  const { readFileSync } = await import('node:fs')
  const png = readFileSync(path.join(dir, 'card-light.png')).toString('base64')
  await page.setViewportSize({ width: 640, height: 400 })
  await page.setContent(`<body style="margin:20px;background:#eee"><img src="data:image/png;base64,${png}" width="600" style="display:block"></body>`)
  await page.waitForTimeout(200)
  await shots.shot('light-png-at-600', { fullPage: false })
  const dark = readFileSync(path.join(dir, 'card-dark.png')).toString('base64')
  await page.setContent(`<body style="margin:20px;background:#eee"><img src="data:image/png;base64,${dark}" width="600" style="display:block"></body>`)
  await page.waitForTimeout(200)
  await shots.shot('dark-png-at-600', { fullPage: false })
  shots.json('facts', facts)
  console.log(`[verify UX-038] ${JSON.stringify({ light: facts['Light smallest at 600 wide'], dark: facts['Dark smallest at 600 wide'], key: facts['Light key present'] })}`)
})

// ------------------------------------------------------------------------------------------------ UX-039 / UX-040 / UX-041 / UX-042 / UX-043 / UX-048b

test('verify UX-039 to UX-043 UX-048b chart copy, drill-down, bar view, narrow labels', async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `UX-039-043/${testInfo.project.name}`)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  if (!touch) await page.setViewportSize({ width: 1280, height: 900 })
  await toResults(page, 1)
  await expect(button(page, 'Download save file')).toBeVisible()
  await page.waitForTimeout(300)
  const profile = page.locator(PROFILE)
  // UX-039: captions and table copy.
  facts['UX-039 figcaption paragraphs'] = await page.locator('figure.blob-figure figcaption p').allInnerTexts()
  facts['UX-039 interval word'] = { interval: (await profile.innerText()).match(/\binterval\b/gi)?.length ?? 0, range: (await profile.innerText()).match(/90% range/g)?.length ?? 0 }
  await press(touch, page.getByRole('button', { name: 'Bar view' }))
  await expect(page.locator('svg.lollipop').first()).toBeVisible()
  await page.waitForTimeout(200)
  facts['UX-039 table headers'] = await page.locator('table.hb-bars thead th').allInnerTexts()
  facts['UX-039 table caption'] = await page.locator('table.hb-bars caption').innerText().catch(() => null)
  facts['UX-039 estimate cells'] = await page.locator('table.hb-bars td.estimate').allInnerTexts().then((ts) => ts.slice(0, 4))
  facts['UX-039 notes under bars'] = await profile.locator('p.note').allInnerTexts()
  facts['UX-048b not-measured cells'] = await page.locator('table.hb-bars td.stub').allInnerTexts()
  facts['UX-048b rows'] = await page.evaluate(() => [...document.querySelectorAll('table.hb-bars tbody tr')].map((tr) => `${(tr.querySelector('th')?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 28)} | ${(tr.querySelector('td.stub')?.textContent ?? tr.querySelector('td.estimate')?.textContent ?? '').replace(/\s+/g, ' ').trim()}`))
  await shots.shot('bars-1280', { locator: profile })
  await press(touch, page.getByRole('button', { name: 'Blob view' }))
  // UX-040 / UX-041: the drill-down of every cluster.
  const clusters = await profile.locator('.drill-buttons button').allInnerTexts()
  const drill: Record<string, unknown> = {}
  for (const c of clusters) {
    await press(touch, profile.locator('.drill-buttons button', { hasText: c }).first())
    await expect(page.locator('section.facet-panel')).toBeVisible()
    await page.waitForTimeout(200)
    const panel = page.locator('section.facet-panel')
    drill[c] = {
      heading: await panel.locator('h3').innerText(),
      hasChart: (await panel.locator('svg.hb-blob').count()) > 0,
      hasTable: (await panel.locator('table').count()) > 0,
      none: await panel.locator('.facet-none').innerText().catch(() => null),
      facetNames: await panel.locator('.facet-names li, table tbody th').allInnerTexts().then((ts) => ts.map((t) => t.replace(/\s+/g, ' ').trim())),
      stubs: await panel.locator('table td.stub').allInnerTexts().then((ts) => [...new Set(ts)]),
      chartLabels: await panel.locator('svg.hb-blob g.labels text').allInnerTexts().then((ts) => ts.map((t) => t.replace(/\s+/g, ' ').trim())),
      caption: await panel.locator('p').first().innerText().catch(() => null),
      shot: await shots.shot(`drill-${c.toLowerCase().replace(/\W+/g, '-')}`, { locator: panel }),
    }
    await press(touch, profile.locator('.drill-buttons button', { hasText: c }).first())
  }
  facts['UX-040/041 drill-down'] = drill
  const allFacetText = JSON.stringify(drill)
  facts['UX-040 generator codes visible'] = ['Simple rt', 'Linear eq', 'Recip', '3d rotation', 'Arith', 'Fraction of', 'System', 'needed)', 'block;'].filter((w) => allFacetText.includes(w))
  // UX-042 / UX-043: the narrow chart and the bar view at 390 and 320.
  for (const w of touch ? [page.viewportSize()?.width ?? 390] : [390, 320]) {
    if (!touch) await page.setViewportSize({ width: w, height: 844 })
    await page.waitForTimeout(400)
    await press(touch, page.getByRole('button', { name: 'Blob view' }))
    await page.waitForTimeout(300)
    const narrow = (await page.evaluate(`${BLOB}(${JSON.stringify(MAIN_BLOB)})`)) as { labels: { text: string; lines: number }[]; labelPx: number }
    const tableNames = await page.locator('table.hb-bars tbody th').allInnerTexts().then((ts) => ts.map((t) => t.replace(/\s+/g, ' ').trim()))
    facts[`UX-042 ${w} blob labels`] = { labels: narrow.labels.map((l) => l.text), labelPx: narrow.labelPx, tableNames, overlaps: await page.evaluate(`(() => { const svg = document.querySelector(${JSON.stringify(MAIN_BLOB)}); const items = [...svg.querySelectorAll('g.labels text')].map((t) => { const r = t.getBoundingClientRect(); return { t: (t.textContent || '').trim().slice(0, 24), x: r.left, y: r.top, w: r.width, h: r.height } }); const out = []; for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) { const a = items[i], b = items[j]; const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); if (ox > 1 && oy > 1) out.push(a.t + ' / ' + b.t) } return out })()`), shot: await shots.shot(`${w}-blob`, { locator: page.locator(`${PROFILE} figure.blob-figure`) }) }
    await press(touch, page.getByRole('button', { name: 'Bar view' }))
    await expect(page.locator('svg.lollipop').first()).toBeVisible()
    await page.waitForTimeout(300)
    const m = await pageMetrics(page, { touch, scope: PROFILE })
    facts[`UX-043 ${w} bars`] = {
      overflowX: m.overflowX.px,
      clipped: m.clipped,
      brokenWords: await page.evaluate(() => {
        const out: string[] = []
        const root = document.querySelector('table.hb-bars')
        if (!root) return out
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        const range = document.createRange()
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const data = (n as Text).data
          for (const mm of data.matchAll(/[A-Za-z]{4,}/g)) {
            range.setStart(n, mm.index)
            range.setEnd(n, mm.index + mm[0].length)
            const rects = range.getClientRects()
            if (rects.length > 1 && new Set([...rects].map((r) => Math.round(r.top))).size > 1) out.push(mm[0])
          }
        }
        return out
      }),
      numberUnitSplits: await page.evaluate(() => [...document.querySelectorAll('table.hb-bars td.relation, table.hb-bars td.estimate')].map((td) => ({ text: (td.textContent ?? '').replace(/\s+/g, ' ').trim(), lines: Math.round(td.getBoundingClientRect().height / parseFloat(getComputedStyle(td).lineHeight)) })).filter((x) => x.lines > 1).slice(0, 5)),
      lollipopWidth: await page.locator('svg.lollipop').first().evaluate((el) => Math.round(el.getBoundingClientRect().width)),
      rowLayout: await page.locator('table.hb-bars tbody tr').first().evaluate((tr) => ({ display: getComputedStyle(tr).display, h: Math.round(tr.getBoundingClientRect().height) })),
      shot: await shots.shot(`${w}-bars`, { locator: profile }),
    }
  }
  shots.json('facts', facts)
  console.log(`[verify UX-039..043] ${JSON.stringify({ headers: facts['UX-039 table headers'], codes: facts['UX-040 generator codes visible'], rows: facts['UX-048b rows'] })}`)
})

// ------------------------------------------------------------------------------------------------ UX-044 / UX-045 / UX-046 / UX-047

test('verify UX-044 to UX-047 chart text zoom, ring labels, wedge click, chart polish', async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.hasTouch === true, 'desktop scenarios')
  const shots = new Shots(page, RUN, `UX-044-047/${testInfo.project.name}`)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await toResults(page, 1)
  await expect(button(page, 'Download save file')).toBeVisible()
  // UX-044: label sizes at 100% and 200% text on a 390 px viewport.
  for (const zoom of [100, 200]) {
    await setTextZoomNow(page, zoom === 100 ? null : zoom)
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(400)
      const b = (await page.evaluate(`${BLOB}(${JSON.stringify(MAIN_BLOB)})`)) as { labelPx: number; ringLabelPx: number; svgWidth: number }
      facts[`UX-044 ${zoom}% ${width}`] = { labelPx: b.labelPx, ringLabelPx: b.ringLabelPx, svgWidth: b.svgWidth, bodyPx: await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize)), hint: await page.locator('[data-large-text-hint]').innerText().catch(() => null), shot: width === 390 ? await shots.shot(`blob-390-zoom${zoom}`, { locator: page.locator(`${PROFILE} figure.blob-figure`) }) : '' }
    }
  }
  await setTextZoomNow(page, null)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.waitForTimeout(300)
  // UX-045 / UX-047: paint order, band outline, figure names, h2 style.
  const b = (await page.evaluate(`${BLOB}(${JSON.stringify(MAIN_BLOB)})`)) as { order: string[]; band: unknown; aria: unknown }
  facts['UX-045 paint order'] = b.order
  facts['UX-045 ring labels before band/curve/marks'] = (() => { const i = b.order.findIndex((o) => /ring-labels/.test(o)); const j = b.order.findIndex((o) => /^path\.band|^path\.crisp|g\.marks/.test(o)); return i >= 0 && j >= 0 && i < j })()
  facts['UX-047 band'] = b.band
  facts['UX-047 svg aria'] = b.aria
  facts['UX-047 figure'] = await page.locator('figure.blob-figure').evaluate((f) => ({ ariaLabel: f.getAttribute('aria-label'), ariaLabelledby: f.getAttribute('aria-labelledby'), titleText: f.querySelector('title')?.textContent ?? null, descLength: (f.querySelector('desc')?.textContent ?? '').length }))
  facts['UX-047 h2 styles'] = await page.locator('h2').evaluateAll((hs) => hs.filter((h) => h.getBoundingClientRect().height > 0).map((h) => ({ text: (h.textContent ?? '').trim().slice(0, 36), color: getComputedStyle(h).color, size: getComputedStyle(h).fontSize })))
  facts['UX-047 print theme'] = await (async () => {
    await page.emulateMedia({ media: 'print', colorScheme: 'dark' })
    await page.waitForTimeout(300)
    const r = await page.evaluate(`(() => { const svg = document.querySelector(${JSON.stringify(MAIN_BLOB)}); const cs = getComputedStyle(svg); const halo = svg.querySelector('g.labels'); return { color: cs.color, bg: getComputedStyle(svg.parentElement).backgroundColor, haloStroke: halo ? getComputedStyle(halo).stroke : null, crisp: getComputedStyle(svg.querySelector('path.crisp')).stroke } })()`)
    await shots.shot('print-dark-chart', { locator: page.locator(`${PROFILE} figure.blob-figure`) })
    await page.emulateMedia({ media: 'screen', colorScheme: 'light' })
    return r
  })()
  await scheme(page, 'dark')
  await page.waitForTimeout(300)
  facts['UX-047 band dark'] = ((await page.evaluate(`${BLOB}(${JSON.stringify(MAIN_BLOB)})`)) as { band: unknown }).band
  await shots.shot('chart-dark', { locator: page.locator(`${PROFILE} figure.blob-figure`) })
  await scheme(page, 'light')
  await shots.shot('chart-light', { locator: page.locator(`${PROFILE} figure.blob-figure`) })
  // UX-046: a wedge click brings the drill-down into view.
  await page.locator(MAIN_BLOB).scrollIntoViewIfNeeded()
  await page.evaluate(() => scrollTo(0, Math.max(0, scrollY - 100)))
  const wedge = page.locator(`${MAIN_BLOB} path.wedge`).nth(2)
  const group = await wedge.getAttribute('data-group')
  await wedge.click({ force: true })
  await page.waitForTimeout(700)
  facts['UX-046 after wedge click'] = { group, panel: await page.locator('section.facet-panel').evaluate((el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), inView: r.top >= 0 && r.top < innerHeight, cluster: el.getAttribute('data-cluster') } }).catch(() => null), focus: await page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName.toLowerCase()} ${(a.textContent ?? '').trim().slice(0, 40)}` : '' }), shot: await shots.shot('after-wedge-click', { fullPage: false }) }
  shots.json('facts', facts)
  console.log(`[verify UX-044..047] ${JSON.stringify(facts).slice(0, 2500)}`)
})

// ------------------------------------------------------------------------------------------------ phone: blob labels and bars (regression spot check)

test('verify viz phone', async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.hasTouch !== true, 'phone only')
  const shots = new Shots(page, RUN, `viz-phone/${testInfo.project.name}`)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await toResults(page, 1)
  await expect(button(page, 'Download save file')).toBeVisible()
  await page.waitForTimeout(300)
  const b = (await page.evaluate(`${BLOB}(${JSON.stringify(MAIN_BLOB)})`)) as { labels: { text: string }[]; labelPx: number; ringLabelPx: number }
  facts['blob'] = { labels: b.labels.map((l) => l.text), labelPx: b.labelPx, ringLabelPx: b.ringLabelPx, shot: await shots.shot('blob', { locator: page.locator(`${PROFILE} figure.blob-figure`) }) }
  await page.getByRole('button', { name: 'Speed', exact: true }).tap()
  await expect(page.locator('section.facet-panel')).toBeVisible()
  await page.waitForTimeout(300)
  facts['drill speed'] = { panelTop: await page.locator('section.facet-panel').evaluate((el) => Math.round(el.getBoundingClientRect().top)), inView: await page.locator('section.facet-panel').evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight }), shot: await shots.shot('drill-speed-viewport', { fullPage: false }) }
  await page.getByRole('button', { name: 'Bar view' }).tap()
  await expect(page.locator('svg.lollipop').first()).toBeVisible()
  await page.waitForTimeout(300)
  const m = await pageMetrics(page, { touch: true, scope: PROFILE })
  facts['bars'] = { overflowX: m.overflowX.px, clipped: m.clipped, lollipopWidth: await page.locator('svg.lollipop').first().evaluate((el) => Math.round(el.getBoundingClientRect().width)), shot: await shots.shot('bars', { locator: page.locator(PROFILE) }) }
  shots.json('facts', facts)
  console.log(`[verify viz phone] ${JSON.stringify(facts)}`)
})
