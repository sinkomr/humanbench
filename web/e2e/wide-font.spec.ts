/**
 * Reflow under wide fonts (WCAG 1.4.10; ROADMAP M1.16, M1.A) on the blob demo route. The font
 * simulation itself is `wide-font.ts` (shared with the M1.21 route sweep, `a11y.spec.ts`): a layout
 * that only fits narrow fonts must fail on any machine, the Linux CI runners included.
 */

import { expect, test, type Page } from '@playwright/test'
import { expectWideFont, useWideFont } from './wide-font'

/**
 * Horizontal overflow of the page in CSS px (0 = no sideways scrolling), and on overflow the
 * elements that stick out furthest, to name the culprit. A string expression: no DOM lib.
 */
async function overflow(page: Page, where: string): Promise<void> {
  const r = await page.evaluate<{ px: number; culprits: string[] }>(`(() => {
    const px = document.documentElement.scrollWidth - window.innerWidth
    const culprits = px <= 0 ? [] : [...document.querySelectorAll('body *')]
      .map((el) => ({ el, right: el.getBoundingClientRect().right }))
      .filter((x) => x.right > window.innerWidth + 0.5 && !x.el.closest('.visually-hidden'))
      .sort((a, b) => b.right - a.right)
      .slice(0, 6)
      .map((x) => x.el.tagName.toLowerCase() + '.' + [...x.el.classList].join('.') + ' "' + (x.el.textContent || '').trim().slice(0, 30) + '" right=' + x.right.toFixed(1))
    return { px, culprits }
  })()`)
  expect(r.px, `${where}: ${r.culprits.join(' | ')}`).toBeLessThanOrEqual(0)
}

test.describe('wide fonts: the blob demo route reflows at 320 CSS px (WCAG 1.4.10)', () => {
  for (const width of [320, 360]) {
    test(`blob view, bar view and drill-downs fit ${width} px`, async ({ page }) => {
      await useWideFont(page)
      await page.setViewportSize({ width, height: 900 })
      await page.goto('./#/dev/blob?profile=full')
      await expect(page.locator('svg.hb-blob').first()).toBeVisible()
      await expectWideFont(page)
      await overflow(page, 'blob view')
      for (const c of ['Knowledge', 'Quantitative']) {
        await page.getByRole('button', { name: c, exact: true }).click()
        await expect(page.getByRole('heading', { level: 3, name: `${c}: facets` })).toBeVisible()
        await overflow(page, `blob view, ${c}`)
      }
      await page.getByRole('button', { name: 'Bar view' }).click()
      await expect(page.locator('svg.lollipop').first()).toBeVisible()
      await overflow(page, 'bar view')
      for (const c of ['Knowledge', 'Quantitative']) {
        await page.getByRole('button', { name: c, exact: true }).click()
        await expect(page.getByRole('heading', { level: 3, name: `${c}: facets` })).toBeVisible()
        await overflow(page, `bar view, ${c}`)
      }
    })
  }
})
