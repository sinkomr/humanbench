/**
 * UX review fixes for the RT timing self-test page (`rt-selftest.html`; UX-054, UX-055; DESIGN §13, §11.6):
 * the results table keeps every number on one line at phone widths, Start keeps the focus while a run is
 * going, the page says what it means in plain words, links back to the app, and has no-JavaScript text
 * that says what to do. The measurements and the report shape are `rt-selftest.spec.ts`'s business.
 */

import { expect, test, type Page } from '@playwright/test'
import { expectNoSidewaysScroll } from './layout'

const PAGE = './rt-selftest.html'
const QUICK = `${PAGE}?quick=1`

/** Widths from the narrowest reflow case (WCAG 1.4.10) to an iPhone 13. */
const PHONE_WIDTHS = [320, 360, 390] as const

async function startAndWaitForKeys(page: Page): Promise<void> {
  await page.goto(QUICK)
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByRole('heading', { name: 'Key presses' })).toBeVisible({ timeout: 45_000 })
}

/** A complete quick run: three Space presses, three taps, and the results. */
async function runToResults(page: Page): Promise<void> {
  await startAndWaitForKeys(page)
  for (let i = 0; i < 3; i++) await page.keyboard.press('Space')
  await expect(page.getByRole('heading', { name: 'Pointer presses' })).toBeFocused()
  const target = page.getByRole('button', { name: 'Tap target' })
  for (let i = 0; i < 3; i++) await target.click()
  await expect(page.getByRole('heading', { name: 'Results' })).toBeFocused()
}

interface CellLines {
  readonly cell: string
  readonly text: string
  /** Lines its text is set in (a cell is as tall as the tallest cell of its row, so the text itself is measured). */
  readonly lines: number
}

/** Every visible number cell (and number column head) of the results table with the number of lines its text takes. */
async function numberCellLines(page: Page): Promise<CellLines[]> {
  return page.evaluate<CellLines[]>(`(() => {
    const out = []
    for (const el of document.querySelectorAll('table td.num, table th.num')) {
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden') continue
      const range = document.createRange()
      range.selectNodeContents(el)
      const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size
      out.push({ cell: el.tagName.toLowerCase() + '.' + [...el.classList].filter((c) => !c.startsWith('svelte-')).join('.'), text: (el.textContent || '').trim(), lines })
    }
    return out
  })()`)
}

/** Width of the first (check name) column's cells, narrowest first. */
async function nameColumnWidth(page: Page): Promise<number> {
  return page.evaluate<number>(`Math.min(...[...document.querySelectorAll('tbody th[scope="row"]')].map((el) => el.getBoundingClientRect().width))`)
}

/** The names of the key and pointer press-delay rows, the longest check names. */
const DELAY_ROW_NAMES = [
  'Key press handling delay (checked only if press time stamps are offset)',
  'Pointer press handling delay (checked only if press time stamps are offset)',
] as const

/** The short verdict of a press delay whose time stamps are offset, and the plain notes the page and the report give. */
const OFFSET_VERDICT = 'Fail: offset time stamps'
const OFFSET_NOTE =
  "This browser's press time stamps are offset from its timer by more than 25 ms. So reaction times are timed when the page handles the press, and this delay is checked like the other timing checks."
const IN_TIME_NOTE = 'For information only: reaction times use the time stamp of the key press or tap itself, so this delay is not part of them.'
const OTHER_CLOCK_NOTE = "This browser's event time stamps use a different clock, so reaction times are timed when the page handles the press, which is less precise."

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Every input event's time stamp 205 ms behind the page's timer: the constant offset Safari was measured with (M1.23). */
async function emulateOffsetTimeStamps(page: Page): Promise<void> {
  await page.addInitScript(`(() => {
    const d = Object.getOwnPropertyDescriptor(Event.prototype, 'timeStamp')
    Object.defineProperty(Event.prototype, 'timeStamp', { configurable: true, get() { return d.get.call(this) - 205 } })
  })()`)
}

/** Words of the visible check names and results that are set across two lines (broken inside the word). */
async function wordsBrokenInside(page: Page): Promise<string[]> {
  return page.evaluate<string[]>(`(() => {
    const out = []
    for (const cell of document.querySelectorAll('tbody td.result, tbody th.name')) {
      if (getComputedStyle(cell).display === 'none') continue
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const m of (node.textContent || '').matchAll(/\\S+/g)) {
          const range = document.createRange()
          range.setStart(node, m.index)
          range.setEnd(node, m.index + m[0].length)
          const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)))
          if (tops.size > 1) out.push(m[0])
        }
      }
    }
    return out
  })()`)
}

test.describe('RT timing self-test page: results on a phone (UX-054)', () => {
  test('every number stays on one line at 320, 360 and 390 px, and only the check name wraps', async ({ page }) => {
    await runToResults(page)
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 800 })
      const cells = await numberCellLines(page)
      // p50, p95 and Max in the head and in each of the seven rows (the n column leaves the table on a phone).
      expect(cells.length, `${width}px: number cells`).toBe(3 * 8)
      for (const c of cells) expect(c.lines, `${width}px: ${c.cell} "${c.text}" is set in ${c.lines} lines`).toBe(1)
      await expectNoSidewaysScroll(page, `results at ${width}px`)
      expect(await nameColumnWidth(page), `${width}px: the check names still have room`).toBeGreaterThanOrEqual(64)
      await expect(page.getByRole('columnheader', { name: 'n', exact: true })).toBeHidden()
    }
  })

  test('no word of the check names or the results is broken inside the word at 320 px', async ({ page }) => {
    await runToResults(page)
    await page.setViewportSize({ width: 320, height: 800 })
    // The two press-delay rows carry the longest names (they say when the delay is checked); the check covers them.
    for (const name of DELAY_ROW_NAMES) await expect(page.getByRole('rowheader', { name: new RegExp(`^${escapeRe(name)} `) })).toBeVisible()
    expect(await wordsBrokenInside(page)).toEqual([])
  })

  test('press time stamps offset from the timer (as Safari has them): a short Fail, the reason above the table, no word broken at 320 px', async ({
    page,
  }) => {
    await emulateOffsetTimeStamps(page)
    await runToResults(page)
    await page.setViewportSize({ width: 320, height: 800 })
    for (const name of DELAY_ROW_NAMES) await expect(page.getByRole('rowheader', { name: `${name} ${OFFSET_VERDICT}`, exact: true })).toBeVisible()
    expect(await wordsBrokenInside(page)).toEqual([])
    await expectNoSidewaysScroll(page, 'offset results at 320px')
    for (const c of await numberCellLines(page)) expect(c.lines, `320px: ${c.cell} "${c.text}" is set in ${c.lines} lines`).toBe(1)
    await expect(page.locator('section .warn', { hasText: 'press time stamps are offset' })).toHaveText(OFFSET_NOTE)
    await expect(page.locator('.overall strong')).toHaveText('Fail')
    const report = JSON.parse(await page.getByLabel('JSON report').inputValue()) as {
      event_lag: { key_rt_source: string | null; pointer_rt_source: string | null }
      metrics: Record<string, { pass: boolean | null; note?: string }>
    }
    expect(report.event_lag).toMatchObject({ key_rt_source: 'handler', pointer_rt_source: 'handler' })
    for (const k of ['key_latency_ms', 'pointer_latency_ms']) expect(report.metrics[k], k).toMatchObject({ pass: false, note: OFFSET_NOTE })
    expect(await page.locator('main').innerText()).not.toMatch(/event\.timeStamp|performance\.now|dispatch|handler|Informational/)
    await page.setViewportSize({ width: 1024, height: 800 })
    for (const i of [5, 6]) await expect(page.locator('tbody tr').nth(i).locator('td.result')).toHaveText(OFFSET_VERDICT)
  })

  test('on a phone the result sits under the check name and is read once; on a wide window it is the last column', async ({ page }) => {
    await runToResults(page)
    await page.setViewportSize({ width: 360, height: 800 })
    await expect(page.getByRole('columnheader', { name: 'Result', exact: true })).toBeHidden()
    const row = page.getByRole('row', { name: /^Frame interval jitter/ })
    await expect(page.getByRole('rowheader', { name: /^Frame interval jitter (Pass|Over 5 ms)$/ })).toBeVisible()
    await expect(row.getByRole('cell')).toHaveCount(3)
    await page.setViewportSize({ width: 1024, height: 800 })
    await expect(page.getByRole('columnheader', { name: 'Result', exact: true })).toBeVisible()
    await expect(page.getByRole('rowheader', { name: 'Frame interval jitter', exact: true })).toBeVisible()
    await expect(row.getByRole('cell')).toHaveCount(5)
  })

  test('on a wide window the sample count (n) is back in the table', async ({ page }) => {
    await runToResults(page)
    await page.setViewportSize({ width: 1024, height: 800 })
    await expect(page.getByRole('columnheader', { name: 'n', exact: true })).toBeVisible()
    const cells = await numberCellLines(page)
    expect(cells.length).toBe(4 * 8)
    for (const c of cells) expect(c.lines, `${c.cell} "${c.text}"`).toBe(1)
  })
})

test.describe('RT timing self-test page: focus and plain words (UX-055)', () => {
  test('Start keeps the focus while the run goes on, then the key prompt takes it', async ({ page }) => {
    await page.goto(QUICK)
    const start = page.getByRole('button', { name: 'Start' })
    await start.focus()
    await page.keyboard.press('Enter')
    await expect(start).toBeFocused()
    await expect(start).toHaveAttribute('aria-disabled', 'true')
    await expect(start).toHaveJSProperty('disabled', false) // aria-disabled, not disabled: it stays in the Tab order
    expect(await page.evaluate('document.activeElement === document.body')).toBe(false)
    // Pressing it again does nothing: it is still the same run.
    await page.keyboard.press('Enter')
    await expect(start).toBeFocused()
    await expect(page.getByRole('heading', { name: 'Key presses' })).toBeVisible({ timeout: 45_000 })
    await expect(page.getByText(/^Press the Space bar/)).toBeFocused()
    // Back at the end: a plain button again.
    await page.keyboard.press('Space')
    await page.getByRole('button', { name: 'Skip: no keyboard' }).click()
    await page.getByRole('button', { name: 'Skip: no mouse or touch' }).click()
    await expect(page.getByRole('heading', { name: 'Results' })).toBeFocused()
    await expect(page.getByRole('button', { name: 'Run again' })).not.toHaveAttribute('aria-disabled', 'true')
  })

  test('the page links back to the app, and the link works', async ({ page }) => {
    await page.goto(PAGE)
    const link = page.getByRole('banner').getByRole('link', { name: 'HumanBench' })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', '/humanbench/')
    await expect(link).toHaveAttribute('translate', 'no')
    const box = await link.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    await link.click()
    await expect(page).toHaveURL(/\/humanbench\/$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('HumanBench')
  })

  test('the page reads in plain words, with the key name kept out of the translator', async ({ page }) => {
    await page.goto(QUICK)
    const text = await page.locator('main').innerText()
    expect(text).not.toMatch(/event\.timeStamp|performance\.now|dispatch|Informational/)
    expect(text).toContain('Nothing is saved or sent.')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('RT timing self-test')
    for (const sentence of text.split(/(?<=[.;:])\s+/)) expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(25)
    await startAndWaitForKeys(page)
    const kbd = page.locator('.zone kbd')
    await expect(kbd).toHaveText('Space bar')
    await expect(kbd).toHaveAttribute('translate', 'no')
  })

  test('the notes in the copied report are plain words', async ({ page }) => {
    await runToResults(page)
    const report = JSON.parse(await page.getByLabel('JSON report').inputValue()) as { metrics: Record<string, { note?: string }> }
    for (const k of ['key_latency_ms', 'pointer_latency_ms']) {
      // The browser's own time stamps: the first note. A browser whose time stamps use another clock reports the second.
      // A browser whose time stamps are offset from its timer by more than 25 ms reports the third.
      expect([IN_TIME_NOTE, OTHER_CLOCK_NOTE, OFFSET_NOTE], k).toContain(report.metrics[k]?.note)
    }
  })

  test('copying says what was copied; when it is blocked, where the text is and what to do', async ({ page }) => {
    await runToResults(page)
    const status = page.locator('.controls [role="status"]')
    const stubClipboard = (works: boolean): Promise<void> =>
      page.evaluate(
        `Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => (${works} ? Promise.resolve() : Promise.reject(new Error('blocked'))) } })`,
      ) as Promise<void>
    await stubClipboard(true)
    await page.getByRole('button', { name: 'Copy JSON' }).click()
    await expect(status).toHaveText('Report copied.')
    await stubClipboard(false)
    await page.getByRole('button', { name: 'Copy JSON' }).click()
    await expect(status).toHaveText('Copying was blocked. The report is selected: copy it yourself.')
    const selected = await page.evaluate(`(() => { const t = document.getElementById('report-json'); return t.selectionStart === 0 && t.selectionEnd === t.value.length && t.value.length > 0 })()`)
    expect(selected).toBe(true)
  })
})

test.describe('RT timing self-test page without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('says what to do, in one plain sentence pair', async ({ page }) => {
    await page.goto(PAGE)
    // (getByText skips <noscript>.)
    await expect(page.locator('noscript p')).toHaveText('This page needs JavaScript. Turn it on to continue.')
    await expect(page.locator('noscript p')).toBeVisible()
    await expect(page).toHaveTitle(/RT timing self-test/)
  })
})
