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

const cache = new Map<number, SimulatedSave>()

/** Run the simulation once per worker (a few seconds). */
export function simulatedSave(sessions: 1 | 2 = 1): SimulatedSave {
  const hit = cache.get(sessions)
  if (hit !== undefined) return hit
  const out = execFileSync('npx', ['tsx', 'scripts/e2e-save.ts', '--sessions', String(sessions)], { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const parsed = JSON.parse(out) as SimulatedSave
  cache.set(sessions, parsed)
  return parsed
}

/** On the ready screen: load a save by content (a name and type that do not say "JSON": DESIGN §8). */
export async function loadSave(page: Page, save: unknown): Promise<void> {
  await page.getByLabel('Save file').setInputFiles({ name: 'humanbench-save.txt', mimeType: 'text/plain', buffer: Buffer.from(JSON.stringify(save)) })
  await button(page, 'Load').click()
  await expect(page.getByText(/Loaded \d+ earlier sessions?/)).toBeVisible()
}

/** Load a simulated earlier session and finish at once: the results of that person. */
export async function toResults(page: Page, sessions: 1 | 2 = 1): Promise<SimulatedSave> {
  const sim = simulatedSave(sessions)
  await toReady(page)
  await loadSave(page, sim.save)
  await button(page, 'Begin').click()
  await expect(h1(page)).toHaveText('Up next: Reaction time')
  await button(page, 'Finish early').click()
  await button(page, 'Finish now').click()
  await expect(h1(page)).toHaveText('Session complete')
  return sim
}

/** Answer the item on screen (any kind) and rate the confidence. */
export async function answerItem(page: Page): Promise<void> {
  const choice = page.locator('form.choice')
  const entry = page.locator('form.entry')
  const slider = page.getByRole('slider')
  await expect(choice.or(entry)).toBeVisible()
  if ((await choice.count()) > 0) {
    await choice.getByRole('radio').first().check()
    await button(page, 'Confirm').click()
  } else {
    const box = entry.getByRole('textbox')
    await box.fill('1')
    await box.press('Enter')
    if (!(await slider.isVisible({ timeout: 1500 }).catch(() => false))) {
      await box.fill('A') // a letter series
      await box.press('Enter')
    }
  }
  await expect(slider).toBeVisible()
  await button(page, 'Continue').click()
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
