/**
 * The baseline every reviewer starts from: all product routes (`PRODUCT_ROUTES`) on a desktop, at 1280 px in the
 * light scheme, each photographed and measured. One test per route group, so a group can be run (and re-run) on its own:
 *
 *   UX_PORT=4606 UX_RUN=baseline npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/baseline.ux.ts --project=chromium --grep "baseline: start"
 *
 * Output: web/test-results/ux-review/baseline/tour/<route>/1280-light.png and .../tour/summary.json (all groups merged).
 * On a phone project it tours at the device's own width instead.
 */

import { test } from '@playwright/test'
import { PRODUCT_ROUTES, tour } from '../lib'

const GROUPS = [...new Set(PRODUCT_ROUTES.map((r) => r.group))]

for (const group of GROUPS) {
  test(`baseline: ${group}`, async ({ context }, testInfo) => {
    const touch = testInfo.project.use.hasTouch === true
    await tour(context, {
      runId: 'baseline',
      routes: PRODUCT_ROUTES.filter((r) => r.group === group).map((r) => r.id),
      widths: touch ? undefined : [1280],
      schemes: ['light'],
      touch,
    })
  })
}
