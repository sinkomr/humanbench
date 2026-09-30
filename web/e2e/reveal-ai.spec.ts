/**
 * The "Working with AI" card and the results-talk helper on the dev-only demo route
 * `#/dev/reveal-ai` (ROADMAP AI.6b; requirement R-17.13; proposal §3.3, §8 AI.6b), in Chromium,
 * WebKit and an emulated iPhone 13. M1.R and M1.18 wire the same components into the real reveal
 * and share-card screens and add their own checks there.
 * - the card appears only after the save download; before it, none of its text is on the page;
 * - on the reveal screen (after the download) and on the share-card screen, the copy button for the
 *   preamble and the "never paste your save file" line are visible, and copying puts exactly the
 *   preamble on the clipboard and announces it;
 * - the real share card contains none of the notes strings (`leak-markers.ts`): checked on the M1.18
 *   renderer's output in `share-card.spec.ts` and `viz/card.test.ts`; E22 in the smoke gate is AI.12a (bank);
 * - axe: 0 serious or critical issues in light and dark; 320 px reflow; keyboard use;
 * - nothing is stored and nothing is sent, and the rendered page passes the language lint (A13).
 * The e2e tsconfig has no DOM lib, so page code is passed as strings.
 */

import { expect, test, type Page } from '@playwright/test'
import { lintText } from '../scripts/language-lint'
import { PREAMBLE, RESULTS_TALK, REVEAL_CARD } from '../src/brief/results-talk'
import { expectNoSeriousAxe } from './axe'

const REVEAL = './#/dev/reveal-ai'
const SHARE = './#/dev/reveal-ai?screen=share'

async function open(page: Page, url: string): Promise<void> {
  await page.goto('about:blank')
  await page.goto(url)
  await expect(page.getByRole('heading', { level: 1, name: 'Reveal screens demo (development only)' })).toBeVisible()
}

test.describe('the card appears only after the save download', () => {
  test('nothing of it is on the page before the download, all of it after', async ({ page }) => {
    await open(page, REVEAL)
    await expect(page.getByTestId('reveal-card')).toHaveCount(0)
    await expect(page.getByTestId('copy-preamble')).toHaveCount(0)
    await expect(page.getByTestId('never-paste')).toHaveCount(0)
    for (const text of [REVEAL_CARD.heading, RESULTS_TALK.heading, 'rough, uncertain', REVEAL_CARD.link]) await expect(page.locator('body')).not.toContainText(text)
    await page.getByTestId('demo-download').click()
    await expect(page.getByTestId('demo-saved')).toHaveText('Save downloaded.')
    await expect(page.getByRole('heading', { level: 2, name: REVEAL_CARD.heading })).toBeVisible()
    await expect(page.getByTestId('copy-preamble')).toBeVisible()
    await expect(page.getByTestId('never-paste')).toBeVisible()
    await expect(page.getByTestId('never-paste')).toHaveText(RESULTS_TALK.neverPaste)
    await expect(page.getByTestId('notes-link')).toHaveAttribute('href', '/humanbench/notes.html')
  })
})

test.describe('the preamble and the warning are visible on both screens', () => {
  for (const [name, url] of [
    ['reveal', `${REVEAL}?saved=1`],
    ['share-card', SHARE],
  ] as const) {
    test(`${name} screen: the copy button and the "never paste your save file" line are visible; copying puts exactly the preamble on the clipboard`, async ({ page, context, browserName }) => {
      if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await open(page, url)
      const button = page.getByRole('button', { name: RESULTS_TALK.copyButton })
      await expect(button).toBeVisible()
      await expect(page.getByText(RESULTS_TALK.neverPaste)).toBeVisible()
      await expect(page.getByTestId('preamble')).toHaveText(PREAMBLE)
      const status = page.getByTestId('results-talk-status')
      await expect(status).toHaveAttribute('role', 'status')
      await expect(status).toHaveAttribute('aria-live', 'polite')
      await button.click()
      await expect(status).toHaveText(RESULTS_TALK.copied)
      if (browserName === 'chromium') expect((await page.evaluate(`navigator.clipboard.readText()`)) as string).toBe(PREAMBLE)
    })
  }

  test('the share-card screen says what to paste first, under its own heading', async ({ page }) => {
    await open(page, SHARE)
    await expect(page.getByRole('heading', { level: 2, name: RESULTS_TALK.heading })).toBeVisible()
  })

  // The demo's card is a placeholder box with fixed text, so the check of the real card against the notes strings
  // (leak-markers.ts) is on the M1.18 renderer's output: share-card.spec.ts ("has no notes text …") and viz/card.test.ts.
})

test.describe('accessibility, keyboard, storage and language', () => {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`has no serious or critical axe violations on either screen (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme })
      await open(page, REVEAL)
      await expectNoSeriousAxe(page)
      await page.getByTestId('demo-download').click()
      await expect(page.getByTestId('reveal-card')).toBeVisible()
      await page.getByTestId('copy-preamble').click()
      await expect(page.getByTestId('results-talk-status')).not.toHaveText('')
      await expectNoSeriousAxe(page)
      await open(page, SHARE)
      await expectNoSeriousAxe(page)
    })
  }

  test('reflows at 320 px with no horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await open(page, `${REVEAL}?saved=1`)
    expect(await page.evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)).toBeLessThanOrEqual(0)
    await expectNoSeriousAxe(page)
  })

  test('the card can be reached and the copy button pressed with the keyboard', async ({ page, isMobile }) => {
    test.skip(isMobile === true, 'keyboard use is for desktop browsers')
    await open(page, REVEAL)
    await page.getByTestId('demo-download').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('reveal-card')).toBeVisible()
    await page.getByTestId('copy-preamble').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('results-talk-status')).not.toHaveText('')
  })

  test('stores nothing, sends nothing, and the rendered page passes the language lint (A13)', async ({ page }) => {
    const requests: string[] = []
    await open(page, `${REVEAL}?saved=1`)
    page.on('request', (r) => requests.push(r.url()))
    await page.getByTestId('copy-preamble').click()
    await page.waitForTimeout(200)
    const snapshot = await page.evaluate(`(async () => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie, caches: typeof caches === 'undefined' ? 0 : (await caches.keys()).length }))()`)
    expect(snapshot).toEqual({ local: 0, session: 0, cookie: '', caches: 0 })
    expect(requests.filter((u) => !u.startsWith('blob:'))).toEqual([])
    expect(lintText(await page.content(), 'rendered.html')).toEqual([])
  })
})
