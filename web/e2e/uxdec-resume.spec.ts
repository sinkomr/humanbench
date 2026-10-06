/// <reference lib="dom" />
/**
 * Continuing an unfinished session (UX-064; provisional default, UX-REVIEW D6 option B; `src/session/resume.ts`):
 * a `?fast=1` session answered into its second part, the tab reloaded, "Continue your unfinished session" on the
 * ready screen, the continuation played to its end. The save then holds two sessions, the second flagged as a
 * continuation and started after the first, and the profile counts them as one session: no "combines" line, no
 * practice adjustment, and the share card says "Based on 1 session".
 *
 * The driver only looks at what a person sees (`session-driver.ts`); the autosave is read from localStorage to
 * know when the answer is kept before the reload. The e2e tsconfig has no DOM lib, so page code is passed as strings.
 */

import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import type { SaveFileV1 } from '../src/save/types'
import { validateSave } from '../src/save/validate'
import { PRACTICE_ADJUSTED_FIRST } from '../src/reveal/copy'
import { READY_CONTINUE } from '../src/session/copy'
import { expectNoSeriousAxe } from './axe'
import { button, h1, languageClean } from './flow'
import { SessionDriver } from './session-driver'

/** Every autosave in this browser (`hb:save:v1:<session id>`), parsed. */
const AUTOSAVES = `(() => {
  const out = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith('hb:save:v1:s_')) out.push(JSON.parse(localStorage.getItem(k)))
  }
  return out
})()`

async function autosaves(page: Page): Promise<SaveFileV1[]> {
  return page.evaluate<SaveFileV1[]>(AUTOSAVES)
}

/** The text of every drawn label of an SVG, unescaped (the share card's preview). */
function svgTexts(svg: string): string[] {
  return [...svg.matchAll(/<(?:text|tspan|title|desc)\b[^>]*>([^<]+)<\//g)].map((m) => m[1]!.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"))
}

/** From the start page (after a reload) to the ready screen: the consent kept here skips the gate. */
async function backToReady(page: Page, driver: SessionDriver): Promise<void> {
  await expect(h1(page)).toHaveText('HumanBench')
  await driver.press(button(page, 'Start'))
  await expect(h1(page)).toHaveText('Honour code')
  await driver.tick(page.getByRole('checkbox', { name: /honour code/ }))
  await driver.press(button(page, 'Continue'))
  await expect(h1(page)).toHaveText('Check your device')
  await expect(button(page, 'Continue')).toBeEnabled({ timeout: 20_000 })
  await driver.tick(page.getByRole('radio', { name: driver.opts.touch ? 'Tap or click' : 'Keyboard' }))
  await driver.press(button(page, 'Continue'))
  await expect(h1(page)).toHaveText('Ready when you are')
}

test.describe('continuing an unfinished session (UX-064)', () => {
  test('reload in the second part, continue, finish: two sessions in the save, the second a continuation, one session on the profile', async ({ page, isMobile }) => {
    test.setTimeout(10 * 60_000)
    const driver = new SessionDriver(page, { touch: isMobile === true })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    // The reload is a real one: the page asks before leaving a run with answers (UX-011), and the person says leave.
    page.on('dialog', (d) => void d.accept())

    await driver.toReady('./?fast=1')
    await driver.begin()
    // The first part (reaction time) to its end, then one question of the second part, with its rating.
    for (let i = 0; i < 400 && ((await h1(page).textContent()) ?? '').trim() !== 'Up next: Matrix & Series'; i++) await driver.step()
    await expect(h1(page)).toHaveText('Up next: Matrix & Series')
    await driver.press(button(page, 'Start'))
    await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
    await driver.step() // the question
    await driver.step() // its rating
    // The answer is in the autosave: reaction time done, no end recorded.
    await expect
      .poll(async () => {
        const [save] = await autosaves(page)
        const s = save?.sessions.at(-1)
        return s === undefined ? 'none' : `${String(s.flags.done_rt)} ${String(s.flags.completed)} ${s.responses.length >= 3}`
      })
      .toBe('true undefined true')

    await page.reload()
    // A driver of its own for what comes after the reload, so its record of parts starts there.
    const again = new SessionDriver(page, { touch: isMobile === true })
    await backToReady(page, again)
    // What the interrupted session holds as the page comes back (a question may have timed out before the reload).
    const kept = await autosaves(page)
    expect(kept).toHaveLength(1)
    const interrupted = kept[0]!.sessions.at(-1)!

    // The offer: the one primary button, with a plain line on what it does; Begin is still there.
    const go = button(page, READY_CONTINUE)
    await expect(go).toBeVisible()
    await expect(go).toHaveClass(/hb-primary/)
    await expect(button(page, 'Begin')).not.toHaveClass(/hb-primary/)
    await expect(page.locator('main .hb-primary')).toHaveCount(1)
    await expect(page.getByText(/was not finished\. Continue it to go on from the start of Matrix & Series and keep what you have done so far\./)).toBeVisible()
    const box = await go.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
    await expectNoSeriousAxe(page)
    await languageClean(page)

    // Continuing: reaction time is done, the interrupted part starts again from its "Up next" screen.
    await again.press(go)
    await expect(h1(page)).toHaveText('Up next: Matrix & Series')
    await again.playToResults()
    expect(again.segments).toEqual(['Matrix & Series', 'Spatial', 'Working Memory', 'Quantitative Reasoning', 'Processing & Reading Speed'])
    await again.resultsReady()

    // The profile counts one session: no "combines" line, nothing practice-adjusted.
    await expect(page.locator('main')).not.toContainText('This profile combines')
    await expect(page.locator('[data-practice-adjusted]')).toContainText(PRACTICE_ADJUSTED_FIRST)

    // The save: two sessions, the second flagged as a continuation, after the first, which it leaves as it was.
    const [download] = await Promise.all([page.waitForEvent('download'), again.press(button(page, 'Download save file'))])
    const file = JSON.parse(readFileSync((await download.path())!, 'utf8')) as SaveFileV1
    const checked = validateSave(file)
    expect(checked.ok, checked.ok ? '' : checked.errors.join('; ')).toBe(true)
    expect(file.sessions).toHaveLength(2)
    const [first, second] = file.sessions
    expect(first!.session_id).toBe(interrupted.session_id)
    expect(first!.flags.continuation).toBeUndefined()
    expect(first!.flags.completed).toBeUndefined()
    expect(first!.responses).toEqual(interrupted.responses)
    expect(second!.flags.continuation).toBe(true)
    expect(second!.flags.completed).toBe(true)
    expect(second!.flags.done_rt).toBeUndefined()
    expect(second!.flags.done_matrix_series).toBe(true)
    expect(second!.started_utc > first!.started_utc).toBe(true)

    // The share card rests on one session.
    const preview = page.locator('img[data-preview]')
    await expect(preview).toBeVisible()
    const src = (await preview.getAttribute('src'))!
    expect(svgTexts(decodeURIComponent(src.slice(src.indexOf(',') + 1)))).toContain('Based on 1 session')

    // The device keeps one autosave, holding both sessions.
    const after = await autosaves(page)
    expect(after).toHaveLength(1)
    expect(after[0]!.sessions.map((s) => s.session_id)).toEqual([first!.session_id, second!.session_id])
  })
})
