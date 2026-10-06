/// <reference lib="dom" />
/**
 * The accessibility-sweep routes of the word links entry (ROADMAP M6.3), kept apart from `routes.ts` so the RAT
 * feature package edits no shared file. `routes.ts` spreads RAT_ROUTES into ROUTES; `scripts/a11y-routes.test.ts`
 * spreads RAT_PINNED_STATES into its STATES. The contract of the scaffold (wf10-m6 pub-scaffold):
 *
 * - renderer: `src/render/rat/RatRenderer.svelte`, root exactly `section.hb-render.rat` (the entry in `RENDERER_ROOTS`
 *   in `routes.ts`; the sweep checks that a route claiming the file draws that element). It is the only file under
 *   `src/render/rat/` whose name ends in `Renderer.svelte`: every other component there is a part with another name
 *   (`routes.ts` names the root of each `*Renderer.svelte`, and the feature package does not edit it).
 * - demo: `src/dev/RatDemo.svelte`, hash route `#/dev/rat` (`?seed=N` picks the made-up practice item), a
 *   `<main class="hb-render demo">` whose h1 is exactly "Word links entry demo (development only)" and which shows
 *   the practice id `demo:rat:<seed>`. Both strings are dev-build markers (`scripts/dev-routes.test.ts`).
 * - routes: add entries to RAT_ROUTES below, and only here. Each entry's `covers` must name every `.svelte` file the
 *   feature adds under `src/` (a file no route covers fails `scripts/a11y-routes.test.ts`), and `#/dev/rat`.
 * - pins: a route that shares every claim with another rat route (a second state of the same screen) goes in
 *   RAT_PINNED_STATES by id, so it cannot be dropped unseen. The three routes are three states of one screen and
 *   claim the same things between them (the sweep checks that each claim has a route, and that a route sharing
 *   every claim is pinned), so all three are pinned, as the emotion routes are.
 * - types only: this file imports `Route` as a type from `./routes`, which imports this file at run time.
 */

import { expect, type Page } from '@playwright/test'
import { ENTRY_COPY } from '../src/tasks/rat/copy'
import type { Route } from './routes'

/** The word links demo on its first made-up practice puzzle, once its box has unlocked (the first drawn frame). */
async function openRat(page: Page): Promise<void> {
  await page.goto('./#/dev/rat?seed=1')
  await expect(page.getByRole('heading', { level: 1, name: 'Word links entry demo (development only)', exact: true })).toBeVisible()
  await expect(page.locator('section.hb-render.rat').first()).toBeVisible()
  await expect(page.getByRole('textbox', { name: ENTRY_COPY.inputLabel, exact: true })).toBeEnabled()
}

export const RAT_ROUTES: readonly Route[] = [
  {
    id: 'dev-rat',
    group: 'dev',
    state: '#/dev/rat: the word links entry on a made-up practice puzzle',
    phone: true,
    covers: ['#/dev/rat', 'dev/RatDemo.svelte', 'render/rat/RatRenderer.svelte'],
    open: openRat,
  },
  {
    id: 'dev-rat-note',
    group: 'dev',
    state: '#/dev/rat: Confirm pressed with the box empty, with the note about it under the box',
    phone: true,
    covers: ['#/dev/rat', 'render/rat/RatRenderer.svelte'],
    open: async (page) => {
      await openRat(page)
      await page.getByRole('button', { name: ENTRY_COPY.submit, exact: true }).click()
      await expect(page.getByText(ENTRY_COPY.emptyNote, { exact: true })).toBeVisible()
    },
  },
  {
    id: 'dev-rat-feedback',
    group: 'dev',
    state: '#/dev/rat: a word typed and confirmed, with the demo feedback under the entry',
    covers: ['#/dev/rat', 'dev/RatDemo.svelte'],
    open: async (page) => {
      await openRat(page)
      await page.getByRole('textbox', { name: ENTRY_COPY.inputLabel, exact: true }).fill('Brush ')
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('rat-feedback')).toBeVisible()
    },
  },
]

/** Ids of rat routes that other rat routes also cover: dropping one is a decision made in `scripts/a11y-routes.test.ts`. */
export const RAT_PINNED_STATES: readonly string[] = ['dev-rat', 'dev-rat-note', 'dev-rat-feedback']
