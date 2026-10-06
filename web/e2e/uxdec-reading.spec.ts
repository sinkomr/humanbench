/// <reference lib="dom" />
/**
 * Reading passages drawn as display paragraphs (web/UX-REVIEW.md D11 option A, a provisional default;
 * ROADMAP A14; `src/render/reading/split.ts`). An authored paragraph of more than 150 words is drawn
 * as pieces of about 120 words, cut between sentences, so that a 363-word paragraph is no longer one
 * 1,280 px block of text on a phone. In a real browser, on the production build:
 *
 * - on the review page (dev server, `HB_DEV_SERVER=1`), for every passage of the bank at 390 px: the
 *   height of each display paragraph, against the height the authored paragraph had (measured in the
 *   same place, with the same style), pieces of at most 150 words that add up to the authored
 *   paragraph's height, the same words in the same order, screenshots of three passages before and
 *   after (`web/test-results/ux-review/uxdec-reading/`) and the table of heights as JSON;
 * - in the session itself (`?fast=1`, whichever passage the session drew) at 390 px, with the page
 *   around the passage as a taker has it;
 * - with the wide-font simulation at 320 px, in the session: no sideways scroll, and the pieces are
 *   shorter than the authored paragraph they came from.
 *
 * The unit side is `src/render/reading/split.test.ts` and `reading.dom.test.ts`. The timing of the
 * block is not touched (the reading time still runs from the frame that draws the passage to Done).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { splitParagraph } from '../src/render/reading/split'
import { countPassageWords } from '../src/tasks/reading/text'
import type { RenderBankFile, RenderPassage } from '../src/tasks/reading/types'
import { REVIEW_URL, devServerAbsent } from './dev-server'
import { button, h1 } from './flow'
import { SEGMENT_TITLES } from './routes'
import { SessionDriver, type Screen } from './session-driver'
import { expectWideFont, useWideFont } from './wide-font'

/** Where the screenshots and the table of heights go (kept out of git with the rest of `test-results/`). */
const OUT = fileURLToPath(new URL('../test-results/ux-review/uxdec-reading/', import.meta.url))

/** The runtime bank, read as a file (Node cannot import the JSON module without an import attribute). */
const PASSAGES: readonly RenderPassage[] = (JSON.parse(readFileSync(fileURLToPath(new URL('../src/tasks/reading/passages.render.json', import.meta.url)), 'utf8')) as RenderBankFile).passages

/** The review page lists 30 instances of `reading` (seeds `review-reading-<n>`); all of the bank's passages are among them. */
const REVIEW_INSTANCES = 30

/** The three passages whose paragraphs were the tallest; photographed before and after. */
const PICTURED = ['darwin-beagle-1845', 'dana-hide-curing-1840', 'bird-rocky-mountains-1879']

interface Heights {
  /** Display paragraphs as drawn: words, height and width in CSS px, in order. */
  readonly after: readonly { readonly text: string; readonly height: number; readonly width: number }[]
  /** The authored paragraphs, drawn in the same place with the same style, one at a time. */
  readonly before: readonly { readonly height: number }[]
  readonly lineHeight: number
}

/** With the passage on screen: the heights of the display paragraphs, and of each authored paragraph drawn as one block. */
async function measure(page: Page, authored: readonly string[]): Promise<Heights> {
  return page.evaluate((paragraphs) => {
    const article = document.querySelector('.passage') as HTMLElement
    const shown = [...article.querySelectorAll('p')]
    // A clone keeps the class that scopes the component's style to its paragraphs.
    const proto = shown[0] as HTMLElement
    const before = paragraphs.map((text) => {
      const clone = proto.cloneNode(false) as HTMLElement
      clone.textContent = text
      article.appendChild(clone)
      const height = clone.getBoundingClientRect().height
      clone.remove()
      return { height }
    })
    return {
      after: shown.map((p) => ({ text: p.textContent ?? '', height: p.getBoundingClientRect().height, width: p.getBoundingClientRect().width })),
      before,
      lineHeight: Number.parseFloat(getComputedStyle(proto).lineHeight),
    }
  }, authored)
}

/** The passage on screen drawn as its authored paragraphs (the state before the change), for a picture. */
async function drawAuthored(page: Page, authored: readonly string[]): Promise<void> {
  await page.evaluate((paragraphs) => {
    const article = document.querySelector('.passage') as HTMLElement
    const proto = article.querySelector('p') as HTMLElement
    for (const p of article.querySelectorAll('p')) (p as HTMLElement).hidden = true
    for (const text of paragraphs) {
      const clone = proto.cloneNode(false) as HTMLElement
      clone.hidden = false
      clone.dataset.authored = ''
      clone.textContent = text
      article.appendChild(clone)
    }
  }, authored)
}

/** Back to the display paragraphs after {@link drawAuthored}. */
async function drawDisplayed(page: Page): Promise<void> {
  await page.evaluate(() => {
    const article = document.querySelector('.passage') as HTMLElement
    for (const p of article.querySelectorAll('p[data-authored]')) p.remove()
    for (const p of article.querySelectorAll('p')) (p as HTMLElement).hidden = false
  })
}

/** The assertions every passage must meet, wherever and however wide it is drawn. */
function checkHeights(p: RenderPassage, h: Heights, where: string): void {
  // The same words in the same order, in pieces of at most 150 words.
  expect(h.after.map((x) => x.text).join(' '), `${where}: words and order`).toBe(p.paragraphs.join(' '))
  for (const piece of h.after) expect(countPassageWords(piece.text), `${where}: ${piece.text.slice(0, 40)}`).toBeLessThanOrEqual(150)
  // Piece by piece: each authored paragraph's pieces add up to its height, give or take a line per piece (text wrapping at the cut).
  let k = 0
  p.paragraphs.forEach((para, i) => {
    const pieces = splitParagraph(para)
    const mine = h.after.slice(k, k + pieces.length)
    k += pieces.length
    const before = h.before[i]?.height ?? 0
    const sum = mine.reduce((a, b) => a + b.height, 0)
    expect(Math.abs(sum - before), `${where}: paragraph ${i + 1} of ${p.id}: ${pieces.length} pieces add up to ${sum.toFixed(0)} px, drawn whole ${before.toFixed(0)} px`).toBeLessThanOrEqual(h.lineHeight * (pieces.length + 1))
    if (pieces.length > 1) for (const x of mine) expect(x.height, `${where}: a piece of ${p.id} is as tall as the whole paragraph`).toBeLessThan(before * 0.75)
  })
  expect(k).toBe(h.after.length)
}

function record(name: string, rows: unknown): void {
  mkdirSync(OUT, { recursive: true })
  writeFileSync(path.join(OUT, name), `${JSON.stringify(rows, null, 2)}\n`)
}

/** The "Up next" screen of segment `index`; a break offered on the way (once, between two parts) is declined as a taker does. */
async function upNext(page: Page, driver: SessionDriver, index: number): Promise<void> {
  const want = `Up next: ${SEGMENT_TITLES[index]}`
  await expect(h1(page)).toHaveText(new RegExp(`^(?:${want}|Time for a break\\?)$`))
  if ((await driver.screen()) === 'break') await driver.step()
  await expect(h1(page)).toHaveText(want)
}

/** Played into the reading block of the session on `?fast=1` (as `routes.ts` does). */
async function playIntoReading(page: Page): Promise<void> {
  const driver = new SessionDriver(page, { touch: test.info().project.use.isMobile === true })
  await driver.toReady('./?fast=1')
  await driver.begin()
  for (let i = 0; i < 5; i++) {
    await upNext(page, driver, i)
    await driver.skipPart()
  }
  await upNext(page, driver, 5)
  await driver.press(button(page, 'Start'))
  const until: Screen = 'reading'
  for (let step = 0; step < 40 && (await driver.screen()) !== until; step++) await driver.step()
  expect(await driver.screen(), 'played on in the last segment and never reached the reading block').toBe(until)
}

/** The bank passage the page shows (by the opening words of its first piece). */
async function shownPassage(page: Page): Promise<RenderPassage> {
  const first = (await page.locator('.passage p').first().textContent()) ?? ''
  const p = PASSAGES.find((x) => (x.paragraphs[0] ?? '').startsWith(first.slice(0, 60)))
  expect(p, `no passage of the bank opens with "${first.slice(0, 60)}"`).toBeDefined()
  return p as RenderPassage
}

const projectName = (): string => test.info().project.name

test.describe('reading passages as display paragraphs at 390 px (D11 option A)', () => {
  test.skip(devServerAbsent(), 'the review page lives on the dev server (HB_DEV_SERVER=1)')

  test('every passage of the bank: pieces of at most 150 words, whose heights add up to the authored paragraphs', async ({ page }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width: 390, height: 844 })
    const table: unknown[] = []
    const done = new Set<string>()
    // The review page shows one instance at a time here (per=1); walk them until every passage of the bank has been measured.
    for (let n = 1; n <= REVIEW_INSTANCES && done.size < PASSAGES.length; n++) {
      await page.goto(`${REVIEW_URL}?family=reading&page=${n}&per=1`)
      const article = page.locator('article').first()
      await article.getByRole('button', { name: 'Show the passage' }).click()
      await expect(article.locator('.passage')).toBeVisible()
      const p = await shownPassage(page)
      if (done.has(p.id)) continue
      done.add(p.id)
      const h = await measure(page, p.paragraphs)
      checkHeights(p, h, `${projectName()} 390 px`)
      const px = (x: number): number => Math.round(x)
      table.push({
        passage: p.id,
        review_instance: n,
        words: p.word_count,
        width_px: px(h.after[0]?.width ?? 0),
        authored: p.paragraphs.map((para, i) => ({ words: countPassageWords(para), height_px: px(h.before[i]?.height ?? 0) })),
        displayed: h.after.map((x) => ({ words: countPassageWords(x.text), height_px: px(x.height) })),
        tallest_before_px: px(Math.max(...h.before.map((x) => x.height))),
        tallest_after_px: px(Math.max(...h.after.map((x) => x.height))),
      })
      if (PICTURED.includes(p.id)) {
        const passage = article.locator('.passage')
        await drawAuthored(page, p.paragraphs)
        await passage.screenshot({ path: path.join(OUT, `${projectName()}-${p.id}-before.png`) })
        await drawDisplayed(page)
        await passage.screenshot({ path: path.join(OUT, `${projectName()}-${p.id}-after.png`) })
      }
    }
    expect([...done].sort(), 'the review instances do not draw every passage of the bank').toEqual(PASSAGES.map((p) => p.id).sort())
    record(`heights-${projectName()}-390.json`, table)
    // Darwin's paragraph (363 words) was the tallest block; no display paragraph is now more than half of that.
    const darwin = table.find((r) => (r as { passage: string }).passage === 'darwin-beagle-1845') as { tallest_before_px: number; tallest_after_px: number }
    expect(darwin.tallest_before_px).toBeGreaterThan(1000)
    expect(darwin.tallest_after_px).toBeLessThan(darwin.tallest_before_px * 0.5)
  })
})

test.describe('reading passages in the session (D11 option A)', () => {
  test('390 px: the passage the session drew is drawn as display paragraphs of at most 150 words', async ({ page }) => {
    test.setTimeout(150_000)
    await page.setViewportSize({ width: 390, height: 844 })
    await playIntoReading(page)
    const section = page.locator('section.hb-render.reading')
    await section.getByRole('button', { name: 'Show the passage' }).click()
    await expect(section.getByRole('button', { name: 'Done reading' })).toBeEnabled()
    const p = await shownPassage(page)
    const h = await measure(page, p.paragraphs)
    checkHeights(p, h, `${projectName()} session 390 px`)
    record(`session-${projectName()}-390.json`, {
      passage: p.id,
      width_px: Math.round(h.after[0]?.width ?? 0),
      authored: p.paragraphs.map((para, i) => ({ words: countPassageWords(para), height_px: Math.round(h.before[i]?.height ?? 0) })),
      displayed: h.after.map((x) => ({ words: countPassageWords(x.text), height_px: Math.round(x.height) })),
    })
    await page.screenshot({ path: path.join(OUT, `${projectName()}-session-${p.id}-after.png`), fullPage: true })
    await drawAuthored(page, p.paragraphs)
    await page.screenshot({ path: path.join(OUT, `${projectName()}-session-${p.id}-before.png`), fullPage: true })
    await drawDisplayed(page)
    // Done reading still works, and the questions follow.
    await section.getByRole('button', { name: 'Done reading' }).click()
    await expect(section.locator('fieldset.question')).toHaveCount(3)
  })

  test('wide fonts at 320 px (WCAG 1.4.10): no sideways scroll, and the pieces are shorter than the authored paragraph', async ({ page }) => {
    test.setTimeout(150_000)
    await useWideFont(page)
    await page.setViewportSize({ width: 320, height: 568 })
    await playIntoReading(page)
    await expectWideFont(page)
    const section = page.locator('section.hb-render.reading')
    await section.getByRole('button', { name: 'Show the passage' }).click()
    await expect(section.getByRole('button', { name: 'Done reading' })).toBeEnabled()
    const p = await shownPassage(page)
    const h = await measure(page, p.paragraphs)
    checkHeights(p, h, `${projectName()} wide font 320 px`)
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(over, 'the page scrolls sideways').toBeLessThanOrEqual(0)
    for (const piece of h.after) expect(piece.width, 'a display paragraph is wider than the window').toBeLessThanOrEqual(320)
    await page.screenshot({ path: path.join(OUT, `${projectName()}-wide-font-320-${p.id}.png`), fullPage: true })
  })
})
