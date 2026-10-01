/// <reference lib="dom" />
/**
 * The share card in real browsers (ROADMAP M1.18; DESIGN §9.9; R-5.6.4; Phase AI proposal v2 §8
 * "the results-talk helper is linked from the share-card screen"): the card is a 1200 × 630
 * picture that follows the skill toggles, the SVG downloads at exactly that size and the PNG at
 * 2400 × 1260 with the blob really drawn in it, nothing leaves the page, and the panel passes axe,
 * the language lint and 320 px reflow. Chromium, WebKit and the iPhone 13 emulation run the same
 * specs, downloads included (the iPhone emulation reports a download like the desktop engines; the
 * status the page reports after it has drawn and encoded the PNG, `Image saved: 2400 × 1260 px.`, is
 * checked in every browser as well).
 * The simulated person (`scripts/e2e-save.ts`) has no Emotion Reading (it is not measured in M1):
 * that rule is covered by the unit and DOM tests (`viz/card.test.ts`, `ShareCard.dom.test.ts`).
 */

import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { RESOURCE_LINE } from '../src/copy'
import { NOTES_LEAK_MARKERS } from '../src/brief/leak-markers'
import { PREAMBLE, RESULTS_TALK, REVEAL_CARD } from '../src/brief/results-talk'
import { expectNoSeriousAxe } from './axe'
import { button, languageClean, overflow, scheme, toResults, type SimulatedSave } from './flow'

const panel = (page: Page) => page.locator('[data-share-card]')
const preview = (page: Page) => page.locator('img[data-preview]')
const boxes = (page: Page) => panel(page).locator('input[data-skill]')

/** No motion, results, save downloaded: the card panel is there. */
async function toCard(page: Page): Promise<SimulatedSave> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const sim = await toResults(page)
  await button(page, 'Download save file').click()
  await expect(panel(page)).toBeVisible()
  await expect(preview(page)).toBeVisible()
  return sim
}

/** The SVG text behind the preview image. */
async function previewSvg(page: Page): Promise<string> {
  const src = (await preview(page).getAttribute('src'))!
  return decodeURIComponent(src.slice(src.indexOf(',') + 1))
}

/** The text of every drawn label / text of an SVG, unescaped. */
function svgTexts(svg: string): string[] {
  return [...svg.matchAll(/<(?:text|tspan|title|desc)\b[^>]*>([^<]+)<\//g)].map((m) => m[1]!.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"))
}

/** Width and height in the IHDR chunk of PNG bytes, or null when they are not a PNG. */
function pngSize(bytes: Buffer): { width: number; height: number } | null {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(sig) || bytes.subarray(12, 16).toString('latin1') !== 'IHDR') return null
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

test.describe('the card and its toggles', () => {
  test('is a 1200 × 630 picture of the person\'s own measured skills, one toggle each', async ({ page }) => {
    const sim = await toCard(page)
    const img = preview(page)
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(1200)
    expect(await img.evaluate((el: HTMLImageElement) => el.naturalHeight)).toBe(630)
    const svg = await previewSvg(page)
    expect(svg).toContain('width="1200" height="630" viewBox="0 0 1200 630"')
    const labels = await panel(page).locator('fieldset.skills label').allInnerTexts()
    expect(labels.map((l) => l.trim())).toEqual(sim.measured)
    for (const box of await boxes(page).all()) await expect(box).toBeChecked()
    await expect(panel(page).locator('[data-count]')).toHaveText(`${sim.measured.length} skills are on the card.`)
    // The card names the person's peaks and the sessions it rests on, in the picture itself.
    const texts = svgTexts(svg)
    for (const name of sim.peaks) expect(texts).toContain(name)
    expect(texts).toContain('Based on 1 session')
    expect(texts).toContain('Rings: SD units, provisional')
  })

  test('unticking a skill takes its name, spoke and marker off the picture; ticking it puts it back', async ({ page }) => {
    const sim = await toCard(page)
    const before = await previewSvg(page)
    const spokes = (s: string): number => (s.match(/class="spoke"/g) ?? []).length
    expect(spokes(before)).toBe(sim.measured.length)
    // Hide the person's strongest peak: it must leave the peaks list too.
    const top = sim.peaks[0]!
    await panel(page).getByRole('checkbox', { name: top, exact: true }).uncheck()
    const after = await previewSvg(page)
    expect(spokes(after)).toBe(sim.measured.length - 1)
    expect(svgTexts(after)).not.toContain(top)
    expect(after).not.toBe(before)
    await expect(panel(page).locator('[data-count]')).toHaveText(`${sim.measured.length - 1} skills are on the card.`)
    await panel(page).getByRole('checkbox', { name: top, exact: true }).check()
    expect(await previewSvg(page)).toBe(before)
  })

  test('hiding all but two skills asks for a third and turns the downloads off; "Show all" restores them', async ({ page }) => {
    await toCard(page)
    await button(page, 'Hide all').click()
    await expect(preview(page)).toHaveCount(0)
    await expect(button(page, 'Download image (PNG)')).toBeDisabled()
    await expect(button(page, 'Download vector image (SVG)')).toBeDisabled()
    await expect(panel(page).locator('[data-count]')).toContainText('Tick at least 3 skills')
    await expectNoSeriousAxe(page)
    await button(page, 'Show all').click()
    await expect(preview(page)).toBeVisible()
    await expect(button(page, 'Download image (PNG)')).toBeEnabled()
  })

  test('dark colours redraw the card', async ({ page }) => {
    await toCard(page)
    await panel(page).getByRole('radio', { name: 'Dark' }).check()
    expect(await previewSvg(page)).toContain('fill="#15151a"')
    await panel(page).getByRole('radio', { name: 'Light' }).check()
    expect(await previewSvg(page)).toContain('fill="#ffffff"')
  })
})

test.describe('the exports', () => {
  test('the PNG is made in the browser at 2400 × 1260 and reported (every browser)', async ({ page }) => {
    await toCard(page)
    // Enabled only once the browser has drawn and encoded it.
    await expect(button(page, 'Download image (PNG)')).toBeEnabled()
    await expect(panel(page).locator('[data-preparing]')).toHaveCount(0)
    await expect(panel(page).getByRole('alert')).toHaveCount(0)
    await button(page, 'Download image (PNG)').click()
    await expect(panel(page).locator('[data-message]')).toHaveText('Image saved: 2400 × 1260 px.')
  })

  test('the downloaded PNG is 2400 × 1260 with the blob drawn in it on a white card', async ({ page }) => {
    await toCard(page)
    await expect(button(page, 'Download image (PNG)')).toBeEnabled()
    const download = page.waitForEvent('download')
    await button(page, 'Download image (PNG)').click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/^humanbench-card-\d{4}-\d{2}-\d{2}\.png$/)
    const bytes = readFileSync((await file.path())!)
    expect(pngSize(bytes)).toEqual({ width: 2400, height: 1260 })
    // Decode it: the corner is the card's white, and the blob colour (Okabe–Ito blue) is drawn.
    const px = await page.evaluate(async (b64: string) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const d = ctx.getImageData(0, 0, c.width, c.height).data
      let blue = 0
      for (let i = 0; i < d.length; i += 4) if (d[i]! < 70 && d[i + 1]! > 90 && d[i + 1]! < 140 && d[i + 2]! > 150) blue++
      return { corner: [d[0]!, d[1]!, d[2]!], blue }
    }, bytes.toString('base64'))
    expect(px.corner).toEqual([255, 255, 255])
    expect(px.blue).toBeGreaterThan(400)
  })

  test('the downloaded SVG is the previewed card, 1200 × 630, and has no scripts, links or images', async ({ page }, testInfo) => {
    await toCard(page)
    const shown = await previewSvg(page)
    const download = page.waitForEvent('download')
    await button(page, 'Download vector image (SVG)').click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/^humanbench-card-\d{4}-\d{2}-\d{2}\.svg$/)
    const svg = readFileSync((await file.path())!, 'utf8')
    expect(svg).toBe(shown)
    expect(svg).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>\n<svg [^>]*width="1200" height="630" viewBox="0 0 1200 630"/)
    expect(svg).not.toMatch(/<script|<image|<a\b|href=|foreignObject/i)
    // Opens as an SVG document in the browser, at its own size (Playwright's temp name has no extension).
    const saved = testInfo.outputPath(file.suggestedFilename())
    await file.saveAs(saved)
    await page.goto(`file://${saved}`)
    // The size is 1200 × 630 CSS px; at a device pixel ratio of 3 (the phone) the engine reports it to within a rounding error.
    const [tag, width, height] = await page.evaluate(() => [document.documentElement.localName, document.documentElement.getBoundingClientRect().width, document.documentElement.getBoundingClientRect().height] as const)
    expect(tag).toBe('svg')
    expect(width).toBeCloseTo(1200, 2)
    expect(height).toBeCloseTo(630, 2)
  })

  test('the SVG button reports its save (every browser)', async ({ page }) => {
    await toCard(page)
    await button(page, 'Download vector image (SVG)').click()
    await expect(panel(page).locator('[data-message]')).toHaveText('Vector image saved.')
  })

  test('makes no request other than data and blob URLs while the card is used', async ({ page }) => {
    await toCard(page)
    const requests: string[] = []
    page.on('request', (r) => requests.push(r.url()))
    await panel(page).locator('input[data-skill]').first().uncheck()
    await panel(page).getByRole('radio', { name: 'Dark' }).check()
    await expect(button(page, 'Download image (PNG)')).toBeEnabled()
    await button(page, 'Download image (PNG)').click()
    await button(page, 'Download vector image (SVG)').click()
    await expect(panel(page).locator('[data-message]')).toHaveText('Vector image saved.')
    expect(requests.filter((u) => !/^(data|blob):/.test(u))).toEqual([])
  })
})

test.describe('what is on the card, and what is not', () => {
  test('has no notes text, results-talk helper, resource line, save-file content or total', async ({ page }) => {
    await toCard(page)
    const svg = await previewSvg(page)
    for (const probe of [PREAMBLE, REVEAL_CARD.body, ...NOTES_LEAK_MARKERS, RESOURCE_LINE, 'Notes for your AI', 'Never paste your save file', 'anon_id']) expect(svg).not.toContain(probe)
    expect(svgTexts(svg).join('\n')).not.toMatch(/\b(total|overall|average|score|rank|percentile)\b/i)
    await expect(panel(page)).not.toContainText(RESOURCE_LINE)
  })
})

test.describe('the results-talk helper is linked from the card (proposal §8)', () => {
  test('the link takes keyboard focus to the helper, whose copy button and "never paste your save file" line are visible', async ({ page }) => {
    await toCard(page)
    const link = page.locator('[data-slot="share-card"]').getByRole('link', { name: 'Talking about your results with an AI' })
    await expect(link).toBeVisible()
    await link.click()
    const talk = page.getByTestId('results-talk')
    await expect(talk).toBeFocused()
    await expect(talk).toBeInViewport()
    await expect(talk).toContainText('Never paste your save file')
    await expect(talk.getByRole('button', { name: RESULTS_TALK.copyButton })).toBeVisible()
    // Following the link did not navigate away or open another route.
    expect(new URL(page.url()).hash).toBe('')
  })

  test('is reachable by keyboard from the toggles', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard navigation is checked on the desktop projects')
    await toCard(page)
    const link = page.getByRole('link', { name: 'Talking about your results with an AI' })
    await link.focus()
    await expect(link).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('results-talk')).toBeFocused()
  })
})

test.describe('accessibility, language and reflow of the card panel', () => {
  test('passes axe (0 serious or critical), in light and dark, with the card and after a download', async ({ page }) => {
    await toCard(page)
    await expect(button(page, 'Download image (PNG)')).toBeEnabled()
    await button(page, 'Download vector image (SVG)').click()
    for (const colorScheme of ['light', 'dark'] as const) {
      await scheme(page, colorScheme)
      await expectNoSeriousAxe(page)
    }
    await panel(page).getByRole('radio', { name: 'Dark' }).check()
    await expectNoSeriousAxe(page)
    await languageClean(page)
  })

  test('fits at 320 CSS px without sideways scrolling, and the preview shrinks with the screen', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 })
    await toCard(page)
    await overflow(page, 'the share card panel')
    const w = await preview(page).evaluate((el: HTMLImageElement) => el.getBoundingClientRect().width)
    expect(w).toBeLessThanOrEqual(320)
    expect(w).toBeGreaterThan(200)
    await expectNoSeriousAxe(page)
  })
})
