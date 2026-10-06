/// <reference lib="dom" />
/**
 * Verification package, regression sweep (run id `verify`): every product route on the FIXED build, photographed and
 * measured at 390 and 1280 px in both colour schemes on desktop Chromium, and at the device width on the iPhone 13
 * project, plus one whole `?fast=1` journey per project (touch on the phone, mouse and keys on the desktop). The
 * summaries are compared with the baseline tour (web/test-results/ux-review/baseline/tour/summary.json) by
 * `verify-compare.ts` after the runs.
 *
 *   UX_REUSE=1 UX_PORT=4653 UX_RUN=verify npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/verify-tour.ux.ts --project=chromium --grep 'verify tour: start'
 *
 * Output: web/test-results/ux-review/verify/tour-<project>/<route>/<width>-<scheme>.png (+ summary.json) and
 * web/test-results/ux-review/verify/journey-<project>/.
 */

import { expect, test } from '@playwright/test'
import { button } from '../../e2e/flow'
import { pageMetrics, playJourney, PRODUCT_ROUTES, Shots, tour, trackConsole } from '../lib'

const RUN = process.env.UX_RUN ?? 'verify'

const GROUPS = [...new Set(PRODUCT_ROUTES.map((r) => r.group))]

for (const group of GROUPS) {
  test(`verify tour: ${group}`, async ({ context }, testInfo) => {
    const project = testInfo.project.name
    const touch = testInfo.project.use.hasTouch === true
    const routes = PRODUCT_ROUTES.filter((r) => r.group === group).map((r) => r.id)
    const entries = await tour(context, {
      runId: RUN,
      sub: `tour-${project}`,
      routes,
      widths: touch ? undefined : [390, 1280],
      schemes: ['light', 'dark'],
      touch,
    })
    const failed = entries.filter((e) => !e.ok).map((e) => `${e.route}: ${(e.error ?? '').split('\n')[0]}`)
    console.log(`[verify] tour ${group} ${project}: ${entries.length - failed.length}/${entries.length} ok${failed.length === 0 ? '' : `; failed: ${failed.join(' | ')}`}`)
    expect(entries.length).toBe(routes.length)
  })
}

test('verify journey', async ({ page }, testInfo) => {
  const project = testInfo.project.name
  const touch = testInfo.project.use.hasTouch === true
  const log = trackConsole(page)
  const shots = new Shots(page, RUN, `journey-${project}`)
  const journey = await playJourney(page, { runId: RUN, touch, practice: false, shots, limitMs: 12 * 60_000 })
  if (journey.completed) {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const skip = button(page, 'Skip animation')
    if (await skip.isVisible().catch(() => false)) await (touch ? skip.tap() : skip.click())
    await expect(button(page, 'Download save file')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.reveal[data-building="false"]')).toBeVisible({ timeout: 60_000 }).catch(() => undefined)
    shots.json('results-metrics', await pageMetrics(page, { touch, axe: true }))
    await shots.all('results-final')
    // The lines above the profile (UX-009a) and any off-scale marks (UX-037) of a real session.
    shots.json('results-facts', {
      lead: await page.locator('.hb-screen > p, main p').first().innerText().catch(() => ''),
      headerText: await page.evaluate<string>(`(() => { const h = document.querySelector('h1'); let t = ''; let n = h && h.nextElementSibling; for (let i = 0; n && i < 6; i++, n = n.nextElementSibling) t += (n.innerText || '') + '\\n'; return t.trim() })()`),
      offScaleLabels: await page.locator('svg.hb-blob text').filter({ hasText: /off scale/i }).count(),
      offScaleCaption: await page.locator('figure.blob-figure figcaption').innerText().then((t) => /off scale|beyond/i.test(t)).catch(() => false),
    })
    await page.getByRole('button', { name: 'Bar view' }).click().catch(() => undefined)
    await page.waitForTimeout(300)
    await shots.all('results-bars')
    shots.json('bars-text', { text: await page.locator('table.hb-bars').first().innerText().catch(() => '') })
  }
  shots.json('console', log)
  console.log(`[verify] journey ${project}: ${JSON.stringify({ completed: journey.completed, error: journey.error, segments: journey.segments, answered: journey.answered, realMs: journey.realMs, steps: journey.steps.length })}`)
  expect(journey.steps.length).toBeGreaterThan(0)
})
