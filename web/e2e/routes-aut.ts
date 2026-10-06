/// <reference lib="dom" />
/**
 * The accessibility-sweep routes of the unusual uses entry (ROADMAP M6.4), kept apart from `routes.ts` so the AUT
 * feature package edits no shared file. `routes.ts` spreads AUT_ROUTES into ROUTES; `scripts/a11y-routes.test.ts`
 * spreads AUT_PINNED_STATES into its STATES. The contract of the scaffold (wf10-m6 pub-scaffold):
 *
 * - renderer: `src/render/aut/AutRenderer.svelte`, root exactly `section.hb-render.aut` (the entry in `RENDERER_ROOTS`
 *   in `routes.ts`; the sweep checks that a route claiming the file draws that element). It is the only file under
 *   `src/render/aut/` whose name ends in `Renderer.svelte`: every other component there is a part with another name
 *   (`routes.ts` names the root of each `*Renderer.svelte`, and the feature package does not edit it).
 * - demo: `src/dev/AutDemo.svelte`, hash route `#/dev/aut` (`?seed=N` picks the made-up practice item), a
 *   `<main class="hb-render demo">` whose h1 is exactly "Unusual uses entry demo (development only)" and which shows
 *   the practice id `demo:aut:<seed>`. Both strings are dev-build markers (`scripts/dev-routes.test.ts`).
 * - routes: add entries to AUT_ROUTES below, and only here. Each entry's `covers` must name every `.svelte` file the
 *   feature adds under `src/` (a file no route covers fails `scripts/a11y-routes.test.ts`), and `#/dev/aut`.
 * - pins: a route that shares every claim with another aut route (a second state of the same screen) goes in
 *   AUT_PINNED_STATES by id, so it cannot be dropped unseen. The three routes are three states of one page (before the
 *   round, while it runs, after it) and claim the same page and renderer between them, so the second and third are pinned.
 * - the states: the round is started with the test scorer (`?embedder=mock`, no download) and a long clock
 *   (`?seconds=600`, so the sweep, which can be slow, never meets the end of the round); the first state keeps the
 *   page's default (the scorer's load button, 90 s). The results state ends the round with Done and waits for the score.
 * - types only: this file imports `Route` as a type from `./routes`, which imports this file at run time.
 */

import { expect, type Page } from '@playwright/test'
import { ENTRY_COPY } from '../src/tasks/aut/copy'
import type { Route } from './routes'

const HEADING = 'Unusual uses entry demo (development only)'
const IDEAS = ['prop open a door', 'crush it into red pigment', 'bookend for paperbacks']

/** The unusual uses demo on its first practice object, drawn and settled (the round not started). */
async function openAut(page: Page, query = ''): Promise<void> {
  await page.goto(`./#/dev/aut?seed=1${query}`)
  await expect(page.getByRole('heading', { level: 1, name: HEADING, exact: true })).toBeVisible()
  await expect(page.locator('section.hb-render.aut').first()).toBeVisible()
  await expect(page.getByRole('button', { name: ENTRY_COPY.start, exact: true })).toBeEnabled()
}

/** The round started with the test scorer and a 10 minute clock, with one idea added. */
async function openRunning(page: Page): Promise<void> {
  await openAut(page, '&embedder=mock&seconds=600')
  await page.getByRole('button', { name: ENTRY_COPY.start, exact: true }).click()
  await expect(page.locator('section.hb-render.aut[data-phase="running"]')).toBeVisible()
  const box = page.getByRole('textbox', { name: ENTRY_COPY.inputLabel, exact: true })
  await box.fill(IDEAS[0] as string)
  await page.keyboard.press('Enter')
  await expect(page.locator('.idea-text')).toHaveText([IDEAS[0] as string])
}

export const AUT_ROUTES: readonly Route[] = [
  {
    id: 'dev-aut',
    group: 'dev',
    state: '#/dev/aut: the unusual uses entry on a practice object, before the round, with the warning and the scorer load button',
    phone: true,
    covers: ['#/dev/aut', 'dev/AutDemo.svelte', 'render/aut/AutRenderer.svelte', 'render/aut/OcsaiConsent.svelte'],
    open: async (page) => {
      await openAut(page)
      await expect(page.getByText(ENTRY_COPY.warningTitle, { exact: true })).toBeVisible()
    },
  },
  {
    id: 'dev-aut-running',
    group: 'dev',
    state: '#/dev/aut: the round running, with the timer, one idea in the list and the warning in view',
    phone: true,
    covers: ['#/dev/aut', 'render/aut/AutRenderer.svelte'],
    open: openRunning,
  },
  {
    id: 'dev-aut-results',
    group: 'dev',
    state: '#/dev/aut: the round ended with Done, with the results panel (three measures, the experimental note, each idea)',
    covers: ['#/dev/aut', 'dev/AutDemo.svelte', 'render/aut/AutRenderer.svelte', 'render/aut/AutResults.svelte'],
    open: async (page) => {
      await openRunning(page)
      const box = page.getByRole('textbox', { name: ENTRY_COPY.inputLabel, exact: true })
      for (const idea of IDEAS.slice(1)) {
        await box.fill(idea)
        await page.keyboard.press('Enter')
      }
      await page.getByRole('button', { name: ENTRY_COPY.done, exact: true }).click()
      await expect(page.getByTestId('aut-results')).toBeVisible()
      await expect(page.getByTestId('aut-count')).toBeVisible()
    },
  },
]

/** Ids of aut routes that other aut routes also cover: dropping one is a decision made in `scripts/a11y-routes.test.ts`. */
export const AUT_PINNED_STATES: readonly string[] = ['dev-aut-running', 'dev-aut-results']
