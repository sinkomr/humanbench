/**
 * Template of a reviewer's spec: copy this file to personas/<name>.ux.ts, keep the three habits (one `Shots` per
 * directory, `trackConsole` from the start, evidence paths relative to the repo root) and replace the body.
 *
 *   UX_PORT=4606 UX_RUN=harness npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/smoke.ux.ts --project=chromium
 *
 * `UX_RUN` names the run and so the output folder (web/test-results/ux-review/<UX_RUN>/): give each device its own,
 * or pass `sub` to `tour` and `Shots`, so two projects do not overwrite each other's files.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { playJourney, REPO_ROOT, Shots, tour, trackConsole } from '../lib'

const onDisk = (rel: string): boolean => rel !== '' && existsSync(path.join(REPO_ROOT, rel))

test('harness smoke', async ({ page, context }, testInfo) => {
  const run = process.env.UX_RUN ?? 'smoke'
  const project = testInfo.project.name
  const touch = testInfo.project.use.hasTouch === true
  const log = trackConsole(page)

  // 1. Evidence of one page: a screenshot, its text, its accessibility tree.
  const shots = new Shots(page, run, `smoke-${project}`)
  await page.goto('./')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('HumanBench')
  const all = await shots.all('welcome')
  for (const rel of [all.png, all.txt, all.aria, await shots.shot('welcome-viewport', { fullPage: false }), shots.json('console', log)]) expect(onDisk(rel), rel).toBe(true)
  expect(all.png).toBe(`web/test-results/ux-review/${run}/smoke-${project}/001-welcome.png`)

  // 2. A tour of a few routes, at two widths and both colour schemes (a phone: its own width only).
  const entries = await tour(context, { runId: run, sub: `tour-${project}`, routes: ['welcome', 'gate', 'results'], widths: touch ? undefined : [320, 1280], schemes: ['light', 'dark'], touch })
  expect(entries.map((e) => `${e.route}:${e.ok}`)).toEqual(['welcome:true', 'gate:true', 'results:true'])
  const perRoute = touch ? 2 : 4
  for (const e of entries) {
    expect(e.shots, e.route).toHaveLength(perRoute)
    expect(Object.keys(e.metrics), e.route).toHaveLength(perRoute)
    for (const rel of e.shots) expect(onDisk(rel), rel).toBe(true)
  }
  const summary = path.join(REPO_ROOT, 'web', 'test-results', 'ux-review', run, `tour-${project}`, 'summary.json')
  expect(existsSync(summary)).toBe(true)
  expect((JSON.parse(readFileSync(summary, 'utf8')) as unknown[]).length).toBeGreaterThanOrEqual(3)

  // 3. The start of a session: three steps, then finish early.
  const journey = await playJourney(page, { runId: run, touch, maxSteps: 3, shots: new Shots(page, run, `journey-${project}`) })
  expect(journey.error).toBeUndefined()
  expect(journey.completed).toBe(true)
  expect(journey.finishedEarly).toBe(true)
  expect(journey.steps.length).toBeGreaterThanOrEqual(1)
  expect(existsSync(path.join(REPO_ROOT, 'web', 'test-results', 'ux-review', run, `journey-${project}`, 'journey.json'))).toBe(true)
  for (const s of journey.steps) if (s.shot !== '') expect(onDisk(s.shot), s.shot).toBe(true)
})
