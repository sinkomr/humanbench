/// <reference lib="dom" />
/**
 * Navigation helpers of the session flow for the Playwright suite (ROADMAP M1.15, M1.R): the gate,
 * honour code and device check, loading a simulated earlier session (`scripts/e2e-save.ts`, since a
 * browser test cannot sit through a 25-minute session) and finishing at once to reach the results,
 * answering an item, and the checks shared by the specs.
 */

import { execFileSync } from 'node:child_process'
import { expect, type Locator, type Page } from '@playwright/test'
import { lintText } from '../scripts/language-lint'

export const h1 = (page: Page): Locator => page.getByRole('heading', { level: 1 })
export const button = (page: Page, name: string | RegExp): Locator => page.getByRole('button', { name, exact: typeof name === 'string' })
/** The heading of the end of a session: "Session complete" over a profile, "Session ended" when nothing was measured (UX-009b). */
export const FINISHED_HEADINGS = /^Session (complete|ended)$/

export async function agreeGate(page: Page): Promise<void> {
  await page.getByRole('checkbox', { name: /18 or older/ }).check()
  await button(page, 'Continue').click()
}

export async function toReady(page: Page, input: 'Keyboard' | 'Tap or click' = 'Keyboard'): Promise<void> {
  await page.goto('./')
  await button(page, 'Start').click()
  await agreeGate(page)
  await page.getByRole('checkbox', { name: /honour code/ }).check()
  await button(page, 'Continue').click()
  await expect(button(page, 'Continue')).toBeEnabled({ timeout: 20_000 })
  await page.getByRole('radio', { name: input }).check()
  await button(page, 'Continue').click()
  await expect(h1(page)).toHaveText('Ready when you are')
}

/** A simulated save: one session, or two a week apart (`scripts/e2e-save.ts`). */
export interface SimulatedSave {
  readonly save: unknown
  /** The peaks the results model finds in it (names). */
  readonly peaks: readonly string[]
  /** The skills it measured (names). */
  readonly measured: readonly string[]
}

const cache = new Map<string, SimulatedSave>()

/**
 * Run the simulation once per worker (a few seconds). `rt` gives the reaction-time blocks that input
 * type and a median exactly at its own reference (`scripts/e2e-save.ts --rt`).
 */
export function simulatedSave(sessions: 1 | 2 = 1, rt?: 'touch' | 'keyboard'): SimulatedSave {
  const key = `${sessions}-${rt ?? 'default'}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const args = ['tsx', 'scripts/e2e-save.ts', '--sessions', String(sessions), ...(rt === undefined ? [] : ['--rt', rt])]
  const out = execFileSync('npx', args, { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const parsed = JSON.parse(out) as SimulatedSave
  cache.set(key, parsed)
  return parsed
}

/** On the ready screen: load a save by content (a name and type that do not say "JSON": DESIGN §8). */
export async function loadSave(page: Page, save: unknown): Promise<void> {
  await page.getByLabel('Save file').setInputFiles({ name: 'humanbench-save.txt', mimeType: 'text/plain', buffer: Buffer.from(JSON.stringify(save)) })
  await button(page, 'Load').click()
  await expect(page.getByText(/Loaded \d+ earlier sessions?/)).toBeVisible()
}

/** Load a simulated earlier session and finish at once: the results of that person. */
export async function toResults(page: Page, sessions: 1 | 2 = 1, rt?: 'touch' | 'keyboard'): Promise<SimulatedSave> {
  const sim = simulatedSave(sessions, rt)
  await toReady(page)
  await loadSave(page, sim.save)
  await button(page, 'Begin').click()
  await expect(h1(page)).toHaveText('Up next: Reaction Time')
  await button(page, 'Finish early').click()
  await button(page, 'Finish now').click()
  await expect(h1(page)).toHaveText('Session complete')
  return sim
}

/**
 * Answer the question on screen (any kind) with one press of its own button (owner decision 2026-10-13: no step after
 * the answer). `point`: the optional confidence scale's point to set first (0 = the lowest, "a guess"; 4 = 100%,
 * "certain"); left out, the scale stays unset. Returns the confidence sent: the point's percent, or null. Waits until
 * the question has left the page (the scale's points share a name that is new with every question).
 */
export async function answerItem(page: Page, point?: number): Promise<number | null> {
  const form = page.locator('form.choice, form.entry').first()
  await expect(form).toBeVisible()
  const points = form.locator('fieldset[data-confidence] input[type=radio]')
  await expect(points).toHaveCount(5)
  await expect(form.locator('fieldset[data-confidence] input[type=radio]:checked')).toHaveCount(0) // it starts unset
  const name = (await points.first().getAttribute('name')) ?? ''
  expect(name).not.toBe('')
  let pct: number | null = null
  if (point !== undefined) {
    await points.nth(point).check()
    pct = Number(await points.nth(point).getAttribute('value'))
  }
  if ((await form.getAttribute('class'))?.split(/\s+/).includes('choice')) {
    await form.locator('.options input[type=radio]').first().check()
    await form.getByRole('button', { name: 'Confirm', exact: true }).click()
  } else {
    const box = form.getByRole('textbox')
    await box.fill((await box.getAttribute('class'))?.split(/\s+/).includes('letter') ? 'A' : '1') // a letter series wants a letter
    await box.press('Enter')
  }
  await expect(page.locator(`input[name="${name}"]`)).toHaveCount(0)
  return pct
}

export async function overflow(page: Page, where: string): Promise<void> {
  const px = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(px, `${where} overflows sideways`).toBeLessThanOrEqual(0)
}

/**
 * Switch the colour scheme and let it settle: motion is switched off first and the scheme second,
 * in two calls, so the colour change never starts a transition that axe could catch half way
 * (one call let a loaded WebKit run scan a button between its light and dark colours). `axe.ts`
 * also waits for running transitions before it scans.
 */
export async function scheme(page: Page, colorScheme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.emulateMedia({ colorScheme })
}

/** The rendered page passes the language lint (A13; the two allow-listed sentences aside). */
export async function languageClean(page: Page): Promise<void> {
  const html = (await page.content()).replace(/\/assets\/[^"'\s)]+/g, '/assets/')
  expect(lintText(html, 'rendered.html')).toEqual([])
}

/** Open every disclosure on the page (worked solutions, pace, focus). */
export async function openDetails(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const d of document.querySelectorAll('details')) d.setAttribute('open', '')
  })
}

/** Would the page ask the browser to confirm leaving now? (Dispatches a cancelable beforeunload and reads the result.) */
export async function unloadIsGuarded(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(e)
    return e.defaultPrevented
  })
}
