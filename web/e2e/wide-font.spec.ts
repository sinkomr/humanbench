/**
 * A wide-fallback-font regression check (ROADMAP M1.16 post-merge audit): PUB CI on Ubuntu renders
 * with wider system fonts (Linux's Liberation/DejaVu fallback) than macOS's system font, and
 * blob.spec.ts's 320 CSS px reflow checks passed locally on macOS but overflowed by 5-26 px on CI.
 * There is no cheap way to install the CI font stack locally, so this simulates a wider font
 * instead: it forces every element to a very wide fallback (Verdana) plus a little letter-spacing,
 * which is a rougher approximation than real Linux fonts but overflows by more, so passing here is
 * a stronger guarantee than the real font difference requires. It is a layout smoke check, not a
 * pixel-perfect replica of any OS's fonts.
 */

import { expect, test, type Page } from '@playwright/test'

const WIDE_FONT_CSS = `* { font-family: Verdana, sans-serif !important; letter-spacing: 0.02em !important; }`

async function widenFonts(page: Page): Promise<void> {
  await page.addStyleTag({ content: WIDE_FONT_CSS })
}

const overflow = (page: Page): Promise<number> => page.evaluate<number>('document.documentElement.scrollWidth - window.innerWidth')

test.describe('wide-font simulation (Linux CI font metrics)', () => {
  test('blob demo route reflows at 320 CSS px with no sideways scrolling under a wide fallback font', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 })
    await page.goto('./#/dev/blob?profile=full')
    await widenFonts(page)
    await expect(page.getByRole('heading', { level: 1, name: 'Blob demo (development only)' })).toBeVisible()
    expect(await overflow(page), 'blob view').toBeLessThanOrEqual(0)

    await page.getByRole('button', { name: 'Bar view' }).click()
    expect(await overflow(page), 'bar view').toBeLessThanOrEqual(0)

    for (const c of ['Knowledge', 'Quantitative']) {
      await page.getByRole('button', { name: c, exact: true }).click()
      await expect(page.getByRole('heading', { level: 3, name: `${c}: facets` })).toBeVisible()
      expect(await overflow(page), `${c} drill-down, bar view`).toBeLessThanOrEqual(0)
    }

    await page.getByRole('button', { name: 'Blob view' }).click()
    expect(await overflow(page), 'Quantitative drill-down, blob view').toBeLessThanOrEqual(0)
  })
})
