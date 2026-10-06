/// <reference lib="dom" />
/**
 * Visual designer B (package rev-visual-results; run id `visual-results`): the results page (reveal, blob, bar view,
 * drill-down, save panel, after-save cards, share card), the notes builder and the RT self-test, photographed at
 * 320-1440 px in light and dark, on an iPhone, and at 200% text, with metrics. Each test is one chunk so a run stays short:
 *
 *   UX_PORT=4620 UX_RUN=visual-results npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/visual-results.ux.ts --project=chromium --grep 'visual-results: tour results-a$'
 *
 * Output: web/test-results/ux-review/visual-results/<sub>/... (tour-<project>, tour-zoom200-<project>, tour-axe-<project>).
 * The detail tests (charts, share card, print) live in visual-results-details.ux.ts.
 */

import { test } from '@playwright/test'
import { tour } from '../lib'

const RUN = process.env.UX_RUN ?? 'visual-results'

const CHUNKS: Readonly<Record<string, readonly string[]>> = {
  'results-a': ['results-building', 'results', 'results-drilldown'],
  'results-b': ['results-bars', 'results-open', 'results-leave'],
  'results-c': ['results-saved', 'share-card-dark', 'share-card-too-few'],
  'notes-a': ['notes', 'notes-filled', 'notes-checker', 'notes-fit'],
  'notes-b': ['notes-keep-error', 'notes-kept', 'notes-returning'],
  selftest: ['rt-selftest', 'rt-selftest-keys', 'rt-selftest-results'],
  dev: ['dev-blob', 'dev-blob-m1'],
}

const DESKTOP_WIDTHS = [320, 390, 768, 1024, 1280, 1440] as const

for (const [chunk, routes] of Object.entries(CHUNKS)) {
  test(`visual-results: tour ${chunk}`, async ({ context }, testInfo) => {
    const project = testInfo.project.name
    const touch = testInfo.project.use.hasTouch === true
    await tour(context, {
      runId: RUN,
      sub: `tour-${project}`,
      routes,
      widths: touch ? undefined : DESKTOP_WIDTHS,
      schemes: ['light', 'dark'],
      touch,
      metrics: true,
    })
  })

  test(`visual-results: zoom ${chunk}`, async ({ context }, testInfo) => {
    test.skip(testInfo.project.use.hasTouch === true, 'text zoom is sampled on desktop Chromium at 390 and 1280')
    await tour(context, { runId: RUN, sub: `tour-zoom200-${testInfo.project.name}`, routes, widths: [390, 1280], schemes: ['light'], textZoom: 200, metrics: true })
  })

  test(`visual-results: axe-dark ${chunk}`, async ({ context }, testInfo) => {
    test.skip(testInfo.project.use.hasTouch === true, 'dark-mode axe is run on desktop')
    await tour(context, { runId: RUN, sub: `tour-axe-${testInfo.project.name}`, routes, widths: [1280], schemes: ['dark'], axe: true, metrics: true })
  })
}
