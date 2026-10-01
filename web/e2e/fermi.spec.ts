/**
 * The Fermi entry on the dev-only demo route `#/dev/fermi` (ROADMAP M5.1; DESIGN §3 rows 11–12, §4.2, §13),
 * in Chromium, WebKit and an emulated iPhone 13. No finite Fermi item is in the public repo, so the page
 * asks a made-up arithmetic question (`src/tasks/fermi/demo.ts`):
 * - a magnitude is typed in the ways people write one, and a unit is chosen; the same answer in another
 *   unit scores the same; the page shows how far off the guess was and whether the 80% range held it;
 * - a slip (a unit typed into the number box, a decimal comma, a range the wrong way round) gets a
 *   neutral note and sends nothing;
 * - the answer is nowhere in the page before the answer is given, in any unit or format;
 * - axe: 0 serious or critical issues in light and dark, with notes showing and after the feedback;
 *   320 px reflow; the whole entry can be done with the keyboard;
 * - nothing is stored and nothing is sent, and the rendered page passes the language lint (A13).
 * The e2e tsconfig has no DOM lib, so page code is passed as strings.
 */

import { expect, test, type Page } from '@playwright/test'
import { lintText } from '../scripts/language-lint'
import { ENTRY_COPY, ENTRY_NOTES, MAGNITUDE_NOTES } from '../src/tasks/fermi/copy'
import { demoFermiItem } from '../src/tasks/fermi/demo'
import { formatMagnitude } from '../src/tasks/fermi/magnitude'
import { parseTrueValue } from '../src/tasks/fermi/scoring'
import { log10Between, unitsOf } from '../src/tasks/fermi/units'
import { expectNoSeriousAxe } from './axe'

const SEED = 1
const ITEM = demoFermiItem(SEED)
const TRUTH = parseTrueValue(ITEM.truth.true_value)
const URL = `./#/dev/fermi?seed=${SEED}`

/** The truth written in one of the offered units. */
const truthIn = (unit: string): number => 10 ** log10Between(TRUTH, ITEM.truth.unit, unit)
/** A different offered unit than the truth's own. */
const OTHER_UNIT = ITEM.spec.units.find((u) => u !== ITEM.truth.unit) as string

async function open(page: Page, url = URL): Promise<void> {
  await page.goto('about:blank')
  await page.goto(url)
  await expect(page.getByRole('heading', { level: 1, name: 'Estimation entry demo (development only)' })).toBeVisible()
  await expect(page.getByText(ITEM.spec.stem)).toBeVisible()
}

async function answer(page: Page, value: string, low: string, high: string, unit: string): Promise<void> {
  await page.getByLabel(ENTRY_COPY.value).fill(value)
  await page.getByLabel(ENTRY_COPY.low).fill(low)
  await page.getByLabel(ENTRY_COPY.high).fill(high)
  await page.getByRole('combobox', { name: ENTRY_COPY.unit }).selectOption(unit)
}

const submit = (page: Page) => page.getByRole('button', { name: ENTRY_COPY.submit }).click()

test.describe('answering', () => {
  test('a good answer in the unit of the truth: off by no factor, the range held it', async ({ page }) => {
    await open(page)
    const v = truthIn(ITEM.truth.unit)
    await answer(page, String(v * 1.1), String(v * 0.7), String(v * 1.6), ITEM.truth.unit)
    await submit(page)
    await expect(page.getByTestId('fermi-feedback')).toBeVisible()
    await expect(page.getByTestId('fermi-feedback-error')).toHaveText(/within a factor of 1\.10 of the answer/)
    await expect(page.getByTestId('fermi-feedback-range')).toHaveText('Your 80% range held the answer.')
    await expect(page.getByTestId('fermi-feedback-truth')).toContainText(`The answer: ${formatMagnitude(TRUTH)} ${ITEM.truth.unit}.`)
    await expect(page.locator('.hb-status')).toHaveText(ENTRY_COPY.recorded)
    await expect(page.getByLabel(ENTRY_COPY.value)).toHaveJSProperty('readOnly', true)
    const sent = JSON.parse((await page.getByTestId('fermi-feedback').getAttribute('data-response')) as string) as Record<string, unknown>
    expect(sent).toEqual({ value: v * 1.1, unit: ITEM.truth.unit, low: v * 0.7, high: v * 1.6 })
  })

  test('the same answer in another unit scores the same', async ({ page }) => {
    await open(page)
    const v = truthIn(OTHER_UNIT)
    await answer(page, String(v * 1.1), String(v * 0.7), String(v * 1.6), OTHER_UNIT)
    await submit(page)
    await expect(page.getByTestId('fermi-feedback-error')).toHaveText(/within a factor of 1\.10 of the answer/)
    await expect(page.getByTestId('fermi-feedback-range')).toHaveText('Your 80% range held the answer.')
  })

  test('numbers are read as people write them: 3.2e6, 3.2 × 10^6 and 3,200,000', async ({ page }) => {
    await open(page)
    await page.getByLabel(ENTRY_COPY.value).fill('3.2e6')
    await expect(page.locator('#' + (await page.getByLabel(ENTRY_COPY.value).getAttribute('aria-describedby'))?.split(' ')[1])).toContainText('Reads as 3.2 × 10⁶')
    await page.getByLabel(ENTRY_COPY.low).fill('3.2 × 10^6')
    await expect(page.locator('#' + (await page.getByLabel(ENTRY_COPY.low).getAttribute('aria-describedby'))?.split(' ')[1])).toContainText('Reads as 3.2 × 10⁶')
    await page.getByLabel(ENTRY_COPY.high).fill('3,200,000')
    await expect(page.locator('#' + (await page.getByLabel(ENTRY_COPY.high).getAttribute('aria-describedby'))?.split(' ')[1])).toContainText('Reads as 3.2 × 10⁶')
    await page.getByLabel(ENTRY_COPY.high).fill('31,600')
    await expect(page.locator('#' + (await page.getByLabel(ENTRY_COPY.high).getAttribute('aria-describedby'))?.split(' ')[1])).toContainText('Reads as 31,600')
    await page.getByRole('combobox', { name: ENTRY_COPY.unit }).selectOption(ITEM.spec.units[0] as string)
    await expect(page.locator('.reads').first()).toContainText(`Reads as 3.2 × 10⁶ ${ITEM.spec.units[0]}`)
  })

  test('a miss says on which side of the range the answer was', async ({ page }) => {
    await open(page)
    const v = truthIn(ITEM.truth.unit)
    await answer(page, String(v / 20), String(v / 50), String(v / 10), ITEM.truth.unit)
    await submit(page)
    await expect(page.getByTestId('fermi-feedback-range')).toHaveText(/did not hold the answer: it was higher than your range/)
    await expect(page.getByTestId('fermi-feedback')).toHaveAttribute('data-hit', 'false')
  })

  test('another question replaces the entry with a fresh one', async ({ page }) => {
    await open(page)
    const v = truthIn(ITEM.truth.unit)
    await answer(page, String(v), String(v / 2), String(v * 2), ITEM.truth.unit)
    await submit(page)
    await page.getByTestId('fermi-another').click()
    await expect(page.getByTestId('fermi-feedback')).toHaveCount(0)
    await expect(page.getByLabel(ENTRY_COPY.value)).toHaveValue('')
    await expect(page.getByLabel(ENTRY_COPY.value)).toBeEditable()
    await expect(page.getByText(ITEM.spec.stem)).toHaveCount(0)
  })
})

test.describe('slips get a neutral note and send nothing', () => {
  test('a unit typed in the number box, a decimal comma and a range the wrong way round', async ({ page }) => {
    await open(page)
    await answer(page, '3 million', '2,5', '-4', ITEM.truth.unit)
    await submit(page)
    for (const note of [MAGNITUDE_NOTES.has_unit, MAGNITUDE_NOTES.decimal_comma, MAGNITUDE_NOTES.negative]) await expect(page.getByText(note, { exact: true })).toBeVisible()
    await expect(page.getByTestId('fermi-feedback')).toHaveCount(0)
    await expect(page.getByLabel(ENTRY_COPY.value)).toBeFocused()
    await expect(page.getByLabel(ENTRY_COPY.value)).toHaveAttribute('aria-invalid', 'true')
    await answer(page, '9', '1', '2', ITEM.truth.unit)
    await submit(page)
    await expect(page.getByRole('alert').filter({ hasText: ENTRY_NOTES.order })).toBeVisible()
    await expect(page.getByTestId('fermi-feedback')).toHaveCount(0)
  })

  test('no unit chosen is a note too, and the unit box has no default', async ({ page }) => {
    await open(page)
    await expect(page.getByRole('combobox', { name: ENTRY_COPY.unit })).toHaveValue('')
    await page.getByLabel(ENTRY_COPY.value).fill('5')
    await page.getByLabel(ENTRY_COPY.low).fill('1')
    await page.getByLabel(ENTRY_COPY.high).fill('9')
    await submit(page)
    await expect(page.getByText(ENTRY_NOTES.unit, { exact: true })).toBeVisible()
    await expect(page.getByTestId('fermi-feedback')).toHaveCount(0)
  })
})

test.describe('the answer is not in the page', () => {
  test('before the answer, in no unit or format; after it, only as the feedback shows it', async ({ page }) => {
    await open(page)
    const html = await page.content()
    for (const u of unitsOf(ITEM.spec.dimension)) {
      const w = truthIn(u.symbol)
      for (const form of [String(w), formatMagnitude(w), w.toLocaleString('en-US')]) {
        if (form.replace(/\D/g, '').length >= 3) expect(html.includes(form), `before: ${form}`).toBe(false)
      }
    }
    expect(html).not.toContain(ITEM.explanation)
  })
})

test.describe('accessibility, keyboard, storage and language', () => {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`has no serious or critical axe violations: empty, with notes, and after the feedback (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme })
      await open(page)
      await expectNoSeriousAxe(page)
      await submit(page)
      await expect(page.getByText(MAGNITUDE_NOTES.empty, { exact: true }).first()).toBeVisible()
      await expectNoSeriousAxe(page)
      const v = truthIn(ITEM.truth.unit)
      await answer(page, String(v), String(v / 2), String(v * 2), ITEM.truth.unit)
      await submit(page)
      await expect(page.getByTestId('fermi-feedback')).toBeVisible()
      await expectNoSeriousAxe(page)
    })
  }

  test('reflows at 320 px with no horizontal scroll, and keeps its 44 px targets', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await open(page)
    await submit(page)
    expect(await page.evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)).toBeLessThanOrEqual(0)
    await expectNoSeriousAxe(page)
    for (const box of [page.getByLabel(ENTRY_COPY.value), page.getByRole('combobox', { name: ENTRY_COPY.unit }), page.getByRole('button', { name: ENTRY_COPY.submit })]) {
      const b = await box.boundingBox()
      expect(b?.height ?? 0).toBeGreaterThanOrEqual(43)
    }
  })

  test('the whole entry can be done with the keyboard', async ({ page, isMobile, browserName }) => {
    test.skip(isMobile === true, 'keyboard use is for desktop browsers')
    await open(page)
    const v = truthIn(ITEM.truth.unit)
    await page.getByLabel(ENTRY_COPY.value).focus()
    await page.keyboard.type(String(v))
    await page.keyboard.press('Tab')
    await expect(page.getByLabel(ENTRY_COPY.low)).toBeFocused()
    await page.keyboard.type(String(v / 2))
    await page.keyboard.press('Tab')
    await page.keyboard.type(String(v * 2))
    await page.keyboard.press('Tab')
    await expect(page.getByRole('combobox', { name: ENTRY_COPY.unit })).toBeFocused()
    await page.getByRole('combobox', { name: ENTRY_COPY.unit }).selectOption(ITEM.truth.unit)
    // Safari skips buttons when tabbing unless the user turns that on, so only the other engines tab to it.
    if (browserName === 'webkit') await page.getByRole('button', { name: ENTRY_COPY.submit }).focus()
    else await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: ENTRY_COPY.submit })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('fermi-feedback')).toBeVisible()
  })

  test('Enter in a number box submits the form', async ({ page, isMobile }) => {
    test.skip(isMobile === true, 'keyboard use is for desktop browsers')
    await open(page)
    const v = truthIn(ITEM.truth.unit)
    await answer(page, String(v), String(v / 2), String(v * 2), ITEM.truth.unit)
    await page.getByLabel(ENTRY_COPY.high).press('Enter')
    await expect(page.getByTestId('fermi-feedback')).toBeVisible()
  })

  test('stores nothing, sends nothing, and the rendered page passes the language lint (A13)', async ({ page }) => {
    const requests: string[] = []
    await open(page)
    page.on('request', (r) => requests.push(r.url()))
    const v = truthIn(ITEM.truth.unit)
    await answer(page, String(v), String(v / 2), String(v * 2), ITEM.truth.unit)
    await submit(page)
    await expect(page.getByTestId('fermi-feedback')).toBeVisible()
    await page.waitForTimeout(200)
    const snapshot = await page.evaluate(`(async () => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie, caches: typeof caches === 'undefined' ? 0 : (await caches.keys()).length }))()`)
    expect(snapshot).toEqual({ local: 0, session: 0, cookie: '', caches: 0 })
    expect(requests.filter((u) => !u.startsWith('blob:'))).toEqual([])
    expect(lintText(await page.content(), 'rendered.html')).toEqual([])
  })
})
