/// <reference lib="dom" />
/**
 * A hard quant item (generator 1.4.0, strata 5–6; ROADMAP M3.12) renders and takes its typed answer
 * on a 320 CSS px wide screen (WCAG 1.4.10 reflow; DESIGN §13). On the review page (dev server,
 * `review.html`), whose instances are fixed: instance 14 of quant (seed `review-quant-14`) is a
 * stratum 6 integral, "What is the value of the integral of x^5(1 − x)^3 with respect to x, from
 * x = 0 to x = 1?", key 1/504, whose powers render as superscripts. The question fits the width with
 * nothing scrolled sideways, says "to the power" to a screen reader, and a fraction typed with the
 * keyboard is accepted in one press.
 */

import { expect, test } from '@playwright/test'
import { REVIEW_URL, devServerAbsent } from './dev-server'

test.describe('hard quant item at 320 px (M3.12)', () => {
  test('a stratum 6 item renders its powers, fits 320 px and takes a fraction', async ({ page }) => {
    test.skip(devServerAbsent(), 'a page of the Vite dev server, which this run does not start (run with HB_DEV_SERVER=1)')
    await page.setViewportSize({ width: 320, height: 720 })
    await page.goto(`${REVIEW_URL}?family=quant&page=14&per=1`)
    const card = page.locator('article.card').filter({ hasText: 'stratum 6' }).first()
    await expect(card).toBeVisible({ timeout: 30_000 })

    const question = card.locator('section.hb-render.quant')
    const stem = question.locator('.stem')
    await expect(stem).toContainText('What is the value of the integral of x')
    await expect(stem.locator('sup')).toHaveCount(2)
    await expect(stem).toContainText('to the power')

    // Nothing of the question is wider than the screen or scrolled inside it.
    await question.scrollIntoViewIfNeeded()
    const fit = await question.evaluate((el) => ({ right: el.getBoundingClientRect().right, scroll: el.scrollWidth, client: el.clientWidth }))
    expect(fit.right).toBeLessThanOrEqual(320)
    expect(fit.scroll).toBeLessThanOrEqual(fit.client)

    const box = question.locator('form.entry').getByRole('textbox')
    await expect(question.locator('form.entry .hint')).toHaveText('Enter a fraction such as 3/8, or a whole number.')
    await box.fill('1/504')
    await box.press('Enter')
    await expect(question.locator('.hb-status')).toHaveText('Answer recorded.')
  })
})
