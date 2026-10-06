/// <reference lib="dom" />
/**
 * uxdec verification, the regression sweep: every product route of `e2e/routes.ts` at 390 and 1280 px (the phone at its
 * own 390), light and dark, with metrics (overflow, clipped text, targets under 44 px, console) and axe; the layout
 * routes again at 320 px and with the text at 200%; the preview dev routes; and a quick run of the RT self-test page.
 * Output: web/test-results/ux-review/uxdec-verify/sweep/<project>/summary.json (+ one folder per route), layout-320/,
 * layout-200/, dev/ and selftest/<project>/facts.json.
 *
 *   UX_PORT=4761 UX_RUN=uxdec-verify UX_DIST=test-results/ux-review/uxdec-verify/_dist \
 *     npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/uxdec-verify-sweep.ux.ts --project=chromium
 */

import { expect, test } from '@playwright/test'
import { PREVIEW_ROUTES } from '../../e2e/routes'
import { PRODUCT_ROUTES, tour, trackConsole } from '../lib'
import { Facts, RUN } from './uxdec-verify-shared.ux'

test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 })

const GROUPS = ['start', 'session', 'results', 'notes', 'selftest'] as const

/** Routes whose layout the decisions touched: checked again at 320 px and with the text at 200%. */
const LAYOUT_ROUTES = ['welcome', 'welcome-returning', 'gate-under-18', 'honour', 'privacy', 'ready-continue', 'interstitial', 'break-offer', 'on-break', 'quant-item', 'coding-intro', 'rt-trial', 'results', 'results-bars', 'results-drilldown', 'results-saved', 'share-card-dark']

for (const group of GROUPS) {
  test(`uxdec-verify sweep: ${group} routes at 390 and 1280 px, light and dark`, async ({ context }, info) => {
    test.setTimeout(15 * 60_000)
    const touch = info.project.use.hasTouch === true
    const ids = PRODUCT_ROUTES.filter((r) => r.group === group).map((r) => r.id)
    const entries = await tour(context, { runId: RUN, routes: ids, widths: touch ? [390] : [390, 1280], schemes: ['light', 'dark'], axe: true, touch: true, sub: `sweep/${info.project.name}` })
    expect(entries.length).toBe(ids.length)
  })
}

test('uxdec-verify sweep: the preview dev routes at 1280 px', async ({ context }, info) => {
  test.setTimeout(15 * 60_000)
  test.skip(info.project.use.hasTouch === true, 'the dev tools are desktop pages')
  const ids = PREVIEW_ROUTES.filter((r) => r.group === 'dev').map((r) => r.id)
  await tour(context, { runId: RUN, routes: ids, widths: [1280], schemes: ['light', 'dark'], axe: true, touch: false, sub: `dev/${info.project.name}` })
})

test('uxdec-verify sweep: the layout routes at 320 px', async ({ context }, info) => {
  test.setTimeout(15 * 60_000)
  await tour(context, { runId: RUN, routes: LAYOUT_ROUTES, widths: [320], schemes: ['light'], axe: false, touch: true, sub: `layout-320/${info.project.name}` })
})

test('uxdec-verify sweep: the layout routes with the text at 200%', async ({ context }, info) => {
  test.setTimeout(15 * 60_000)
  const touch = info.project.use.hasTouch === true
  await tour(context, { runId: RUN, routes: LAYOUT_ROUTES, widths: touch ? [390] : [1280, 390], schemes: ['light'], textZoom: 200, axe: false, touch: true, sub: `layout-200/${info.project.name}` })
})

test('uxdec-verify sweep: the RT self-test page passes a quick run', async ({ page }, info) => {
  test.setTimeout(5 * 60_000)
  const f = new Facts(page, info, 'selftest')
  const log = trackConsole(page)
  await page.goto('./rt-selftest.html?quick=1')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('RT timing self-test')
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByRole('heading', { name: 'Key presses' })).toBeVisible({ timeout: 60_000 })
  if (f.touch) {
    await page.getByRole('button', { name: 'Skip: no keyboard' }).tap()
  } else {
    await expect(page.getByText(/^Press the Space bar/)).toBeFocused()
    for (let i = 0; i < 3; i++) await page.keyboard.press('Space')
  }
  await expect(page.getByRole('heading', { name: 'Pointer presses' })).toBeVisible({ timeout: 30_000 })
  const target = page.getByRole('button', { name: 'Tap target' })
  for (let i = 0; i < 3; i++) {
    if (f.touch) await target.tap()
    else await target.click()
  }
  await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible({ timeout: 30_000 })
  const box = page.getByLabel('JSON report')
  await expect(box).toBeVisible()
  const report = JSON.parse(await box.inputValue()) as { report_version?: string; pass?: boolean; refresh?: { hz?: number }; metrics?: Record<string, { pass?: boolean | null; summary?: { p50?: number; p95?: number; max?: number } }> }
  f.check('report version', null, report.report_version)
  f.check('self-test verdict: pass', report.pass === true, { pass: report.pass, hz: report.refresh?.hz, metrics: Object.fromEntries(Object.entries(report.metrics ?? {}).map(([k, v]) => [k, { pass: v.pass, p95: v.summary?.p95 }])) })
  f.check('no console errors on the self-test page', log.errors.length === 0 && log.pageErrors.length === 0, { errors: log.errors.slice(0, 3), pageErrors: log.pageErrors.slice(0, 3) })
  await f.all('selftest-results')
  await f.axe('self-test results')
  f.save()
})
