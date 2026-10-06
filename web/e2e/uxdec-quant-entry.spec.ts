/// <reference lib="dom" />
/**
 * The number-entry grammar of the quant box (web/UX-REVIEW.md D8 option A, a provisional default;
 * UX-079; DESIGN §4.2, §7.8; `src/tasks/quant/numeric.ts`): a decimal comma is read as a decimal point
 * ("3,5" is 3.5), a number written with thousands commas ("1,500") is refused before it is submitted
 * with "Write thousands without a comma (1500) and decimals with a point (1.5).", and the hints say
 * "whole number". In a real browser, on the production build:
 *
 * - in the session, in the Quantitative part (whichever items it draws): played on to the first item
 *   whose hint names whole numbers (a whole-number or a fraction item), where "1,500" and "12,345.5"
 *   get the thousands note and are not submitted, and a decimal comma is accepted ("3,5" on a fraction
 *   item; on a whole-number item "3,5" gets the whole-number note and "35,0" goes through);
 * - on the review page (dev server, `HB_DEV_SERVER=1`), whose quant items are fixed: "3,5" is accepted
 *   on a decimal or fraction item, and "1,500" is refused on a whole-number item.
 *
 * The unit side is `src/tasks/quant/numeric.test.ts`, `hints.test.ts` and
 * `src/render/quant/entry-grammar.dom.test.ts`.
 */

import { expect, test, type Locator, type Page } from '@playwright/test'
import { FORMAT_HINTS, FORMAT_NOTES, THOUSANDS_NOTE } from '../src/render/common/entry-copy'
import { REVIEW_URL, devServerAbsent } from './dev-server'
import { button, h1 } from './flow'
import { SEGMENT_TITLES, intoSegment } from './routes'

/** Index of the Quantitative part in the session (`routes.ts` SEGMENT_TITLES). */
const QUANT = SEGMENT_TITLES.indexOf('Quantitative Reasoning')
/** Items played on, at most, to reach one whose hint names whole numbers (about 4 in 5 quant items do). */
const MAX_ITEMS = 8

type WholeFormat = 'integer' | 'fraction'

/** Submit what is in the box with the keyboard, as a person does. */
async function enter(box: Locator, text: string): Promise<void> {
  await box.fill(text)
  await box.press('Enter')
}

/** The format of the item on screen, told by its hint; null for a decimal item (its hint names no whole numbers). */
async function formatOnScreen(page: Page): Promise<WholeFormat | null> {
  const hint = ((await page.locator('form.entry .hint').textContent()) ?? '').trim()
  if (hint === FORMAT_HINTS.integer) return 'integer'
  if (hint === FORMAT_HINTS.fraction) return 'fraction'
  expect(hint, 'a quant hint this spec does not know').toBe(FORMAT_HINTS.decimal)
  return null
}

/** Answer the item on screen with "1", rate it, and wait for the next item of the part. */
async function answerAndGoOn(page: Page): Promise<void> {
  const box = page.locator('form.entry').getByRole('textbox')
  await enter(box, '1')
  const slider = page.getByRole('slider')
  await expect(slider).toBeVisible()
  await slider.fill('60')
  await button(page, 'Continue').click()
  await expect(slider).toHaveCount(0)
  await expect(h1(page), 'the Quantitative part ended before an item whose hint names whole numbers').toHaveText(SEGMENT_TITLES[QUANT]!)
  await expect(page.locator('form.entry')).toBeVisible()
}

test.describe('quant number entry (UX-079)', () => {
  test('in the session: "1,500" gets the thousands note, a decimal comma is read, and the hint says whole number', async ({ page }) => {
    await intoSegment(page, QUANT)
    const entry = page.locator('form.entry')
    await expect(entry).toBeVisible()
    let format: WholeFormat | null = await formatOnScreen(page)
    for (let i = 1; format === null && i < MAX_ITEMS; i++) {
      await answerAndGoOn(page)
      format = await formatOnScreen(page)
    }
    expect(format, `no whole-number or fraction item in the first ${MAX_ITEMS} quant items`).not.toBeNull()
    const hint = entry.locator('.hint')
    await expect(hint).toHaveText(FORMAT_HINTS[format!])
    await expect(hint).toContainText('whole number')
    await expect(hint).not.toContainText(/integer/i)

    const box = entry.getByRole('textbox')
    const note = entry.locator('.hb-note')
    for (const text of ['1,500', '12,345.5']) {
      await enter(box, text)
      await expect(note, text).toHaveText(THOUSANDS_NOTE)
      await expect(box, text).toHaveAttribute('aria-invalid', 'true')
      await expect(box, text).toHaveValue(text)
      await expect(page.getByRole('slider'), `${text} was submitted`).toHaveCount(0)
    }

    if (format === 'integer') {
      // "3,5" is read as 3.5, which a whole-number item does not take; "35,0" is 35.
      await enter(box, '3,5')
      await expect(note).toHaveText(FORMAT_NOTES.integer)
      await expect(page.getByRole('slider')).toHaveCount(0)
      await enter(box, '35,0')
    } else {
      await enter(box, '3,5')
    }
    await expect(page.getByRole('slider')).toBeVisible()
    await expect(note).toHaveText('')
  })

  test('on the review page (fixed items): "3,5" is accepted on a decimal or fraction item, "1,500" refused on a whole-number item', async ({ page }) => {
    test.skip(devServerAbsent(), 'a page of the Vite dev server, which this run does not start (run with HB_DEV_SERVER=1)')
    await page.goto(`${REVIEW_URL}?family=quant&page=1&per=30`)
    await expect(page.getByRole('heading', { level: 2, name: /^quant\b/ })).toBeVisible({ timeout: 30_000 })
    const forms = page.locator('form.entry')
    await expect(forms.first()).toBeVisible({ timeout: 30_000 })

    const decimalOrFraction = forms.filter({ has: page.locator('.hint', { hasText: /^(Enter a number; decimals are fine|Enter a fraction)/ }) }).first()
    await expect(decimalOrFraction, 'no decimal or fraction item among the 30 review items').toBeVisible()
    await expect(decimalOrFraction.locator('.hint')).not.toContainText(/integer/i)
    await enter(decimalOrFraction.getByRole('textbox'), '3,5')
    await expect(decimalOrFraction.locator('.hb-status')).toHaveText('Answer recorded.')
    await expect(decimalOrFraction.locator('.hb-note')).toHaveText('')

    const whole = forms.filter({ has: page.locator('.hint', { hasText: FORMAT_HINTS.integer }) }).first()
    await expect(whole, 'no whole-number item among the 30 review items').toBeVisible()
    await enter(whole.getByRole('textbox'), '1,500')
    await expect(whole.locator('.hb-note')).toHaveText(THOUSANDS_NOTE)
    await expect(whole.locator('.hb-status')).toHaveText('')
    await enter(whole.getByRole('textbox'), '1500')
    await expect(whole.locator('.hb-status')).toHaveText('Answer recorded.')
  })
})
