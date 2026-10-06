/// <reference lib="dom" />
/**
 * The accessibility-sweep routes of the situational judgment entry (ROADMAP M6.2), kept apart from `routes.ts` so the SJT
 * feature package edits no shared file. `routes.ts` spreads SJT_ROUTES into ROUTES; `scripts/a11y-routes.test.ts`
 * spreads SJT_PINNED_STATES into its STATES. The contract of the scaffold (wf10-m6 pub-scaffold):
 *
 * - renderer: `src/render/sjt/SjtRenderer.svelte`, root exactly `section.hb-render.sjt` (the entry in `RENDERER_ROOTS`
 *   in `routes.ts`; the sweep checks that a route claiming the file draws that element). It is the only file under
 *   `src/render/sjt/` whose name ends in `Renderer.svelte`: every other component there is a part with another name
 *   (`routes.ts` names the root of each `*Renderer.svelte`, and the feature package does not edit it).
 * - demo: `src/dev/SjtDemo.svelte`, hash route `#/dev/sjt` (`?seed=N` picks the made-up practice item, `?mode=most_least`
 *   asks for the best and the least effective response), a `<main class="hb-render demo">` whose h1 is exactly
 *   "Situational judgment entry demo (development only)" and which shows the practice id `demo:sjt:<seed>`. Both strings
 *   are dev-build markers (`scripts/dev-routes.test.ts`).
 * - routes: add entries to SJT_ROUTES below, and only here. Each entry's `covers` must name every `.svelte` file the
 *   feature adds under `src/` (a file no route covers fails `scripts/a11y-routes.test.ts`), and `#/dev/sjt`.
 * - pins: a route that shares every claim with another sjt route (a second state of the same screen) goes in
 *   SJT_PINNED_STATES by id, so it cannot be dropped unseen. With six states of one screen, every one of them does.
 * - types only: this file imports `Route` as a type from `./routes`, which imports this file at run time.
 *
 * The SJT feature adds no component besides the renderer and the demo; the skill tooltip is `render/emotion/SkillTip.svelte`
 * (M6.1), which the tooltip route claims as well.
 *
 * States, each an own route so that the sweep (axe in light and dark, the wide font, 320 px, 200% zoom and text, the text
 * spacing, reduced motion, the Tab walk) sees it:
 * - `dev-sjt`: the entry on a practice situation, rate mode, nothing chosen;
 * - `dev-sjt-tip`: the tooltip (R-5.6.2 and the facet note) open over the situation;
 * - `dev-sjt-rated`: all four responses rated and Confirm on;
 * - `dev-sjt-feedback`: the answer recorded, with the demo's comparison under the entry;
 * - `dev-sjt-most-least`: most/least mode, nothing chosen;
 * - `dev-sjt-clash`: most/least mode with one response chosen for both questions, so the note shows.
 */

import { expect, type Page } from '@playwright/test'
import { ENTRY_COPY, SCALE_LABELS } from '../src/tasks/sjt/copy'
import type { Route } from './routes'

/** Opens the demo and waits for the first drawn frame, which unlocks the inputs. */
async function openSjt(page: Page, query = '?seed=1'): Promise<void> {
  await page.goto(`./#/dev/sjt${query}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Situational judgment entry demo (development only)', exact: true })).toBeVisible()
  await expect(page.locator('section.hb-render.sjt').first()).toBeVisible()
  await expect(page.getByRole('radio').first()).toBeEnabled()
}

/** Rates the four responses 3, 1, 4, 2 (rate mode). */
async function rateAll(page: Page): Promise<void> {
  const levels = [3, 1, 4, 2]
  for (const [i, level] of levels.entries()) {
    await page.locator('fieldset.response').nth(i).getByRole('radio', { name: `${level} ${SCALE_LABELS[level - 1]}`, exact: true }).check()
  }
}

export const SJT_ROUTES: readonly Route[] = [
  {
    id: 'dev-sjt',
    group: 'dev',
    state: '#/dev/sjt: the situational judgment entry (situation, four responses to rate 1 to 4, the skill name and its tooltip button) on a made-up practice item',
    phone: true,
    covers: ['#/dev/sjt', 'dev/SjtDemo.svelte', 'render/sjt/SjtRenderer.svelte'],
    open: async (page) => {
      await openSjt(page)
    },
  },
  {
    id: 'dev-sjt-tip',
    group: 'dev',
    state: '#/dev/sjt: the R-5.6.2 tooltip of the skill with the note of the facet open over the situation',
    phone: true,
    covers: ['#/dev/sjt', 'render/sjt/SjtRenderer.svelte', 'render/emotion/SkillTip.svelte'],
    open: async (page) => {
      await openSjt(page)
      await page.getByRole('button', { name: new RegExp(`^${ENTRY_COPY.tipButton}`) }).click()
      await expect(page.locator('[role="tooltip"]')).toBeVisible()
    },
  },
  {
    id: 'dev-sjt-rated',
    group: 'dev',
    state: '#/dev/sjt: all four responses rated, Confirm on',
    phone: true,
    covers: ['#/dev/sjt', 'render/sjt/SjtRenderer.svelte'],
    open: async (page) => {
      await openSjt(page)
      await rateAll(page)
      await expect(page.getByRole('button', { name: ENTRY_COPY.submit, exact: true })).toBeEnabled()
    },
  },
  {
    id: 'dev-sjt-feedback',
    group: 'dev',
    state: '#/dev/sjt: the answer recorded, with the demo comparison under the entry',
    covers: ['#/dev/sjt', 'dev/SjtDemo.svelte'],
    open: async (page) => {
      await openSjt(page)
      await rateAll(page)
      await page.getByRole('button', { name: ENTRY_COPY.submit, exact: true }).click()
      await expect(page.getByTestId('sjt-feedback')).toBeVisible()
    },
  },
  {
    id: 'dev-sjt-most-least',
    group: 'dev',
    state: '#/dev/sjt?mode=most_least: the entry asking for the response that would work best and the one that would work least well',
    phone: true,
    covers: ['#/dev/sjt', 'dev/SjtDemo.svelte', 'render/sjt/SjtRenderer.svelte'],
    open: async (page) => {
      await openSjt(page, '?seed=1&mode=most_least')
      await expect(page.getByRole('group', { name: ENTRY_COPY.most, exact: true })).toBeVisible()
    },
  },
  {
    id: 'dev-sjt-clash',
    group: 'dev',
    state: '#/dev/sjt?mode=most_least: one response chosen for both questions, with the note under the responses',
    phone: true,
    covers: ['#/dev/sjt', 'render/sjt/SjtRenderer.svelte'],
    open: async (page) => {
      await openSjt(page, '?seed=1&mode=most_least')
      await page.getByRole('group', { name: ENTRY_COPY.most, exact: true }).getByRole('radio').nth(1).check()
      await page.getByRole('group', { name: ENTRY_COPY.least, exact: true }).getByRole('radio').nth(1).check()
      await expect(page.getByText(ENTRY_COPY.mostLeastSame, { exact: true })).toBeVisible()
    },
  },
]

/** Ids of sjt routes that other sjt routes also cover: dropping one is a decision made in `scripts/a11y-routes.test.ts`. */
export const SJT_PINNED_STATES: readonly string[] = ['dev-sjt', 'dev-sjt-tip', 'dev-sjt-rated', 'dev-sjt-feedback', 'dev-sjt-most-least', 'dev-sjt-clash']
