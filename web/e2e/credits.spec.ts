/**
 * The credits of the word resources, in real browsers (owner decision of 2026-10-06; the Remote Associates items are
 * checked against Google Books Ngram data, Open English WordNet, the Moby Word Lists and VarCon, and against wordfreq as
 * a second signal). The app has no page of its own for credits: they are the last section of "Privacy and terms"
 * (`#/privacy`), in the static version and in the online one (`?hb_backend=`, the fake project of `fake-server.ts`).
 *
 * What is checked, in Chromium, WebKit and the emulated iPhone 13 (the three projects of `playwright.config.ts`):
 * - the notice ends with an h2 "Credits" under the h1 "Privacy and terms", after every section it had before, and the
 *   two paragraphs follow it: the memo's line (the Google Books line among it) and the wordfreq line;
 * - the footer link of the page and its heading are as they were;
 * - axe: 0 serious or critical issues in light and dark, 320 px reflow without sideways scroll, and the rendered page
 *   passes the language lint (A13).
 */

import { expect, test, type Locator, type Page } from '@playwright/test'
import { SERVER_PRIVACY_SECTIONS } from '../src/backend/copy'
import { PRIVACY_SECTIONS } from '../src/session/copy'
import { expectNoSeriousAxe } from './axe'
import { SERVER_QUERY } from './fake-server'
import { h1, languageClean, overflow, scheme } from './flow'

/** The part of the first paragraph that names Google Books, as the memo words it. */
const GOOGLE_BOOKS = 'Google Books Ngram Viewer data (https://books.google.com/ngrams, CC BY 3.0)'
const MEMO_LINE =
  'Remote-associates items are original to HumanBench. They were checked against Google Books Ngram Viewer data (https://books.google.com/ngrams, CC BY 3.0), Open English WordNet (CC BY 4.0, based on Princeton WordNet), the Moby Word Lists by Grady Ward (public domain) and VarCon by Kevin Atkinson.'
const WORDFREQ_LINE =
  'Word frequencies were also checked with wordfreq by Robyn Speer (data CC BY-SA 4.0), which draws on Google Books Ngram Viewer data, Wikipedia, the Leeds Internet Corpus, ParaCrawl, OpenSubtitles and the SUBTLEX word lists by Marc Brysbaert, Boris New and colleagues (SUBTLEX is freely available data).'

const credits = (page: Page): Locator => page.getByRole('heading', { level: 2, name: 'Credits', exact: true })
/** The paragraphs that follow the Credits heading, in order (the notice's own, then the status line and the links). */
const afterCredits = (page: Page): Locator => credits(page).locator('xpath=following-sibling::p')

/** The Credits section as a person meets it: the last heading of the notice, with its two paragraphs. */
async function expectCredits(page: Page, headings: readonly string[]): Promise<void> {
  await expect(h1(page)).toHaveText('Privacy and terms')
  await expect(credits(page)).toBeVisible()
  await expect(credits(page)).toHaveCount(1)

  // Every section it had before, in the same order, and Credits after them.
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([...headings])
  await expect(page.getByRole('heading', { level: 2 }).last()).toHaveText('Credits')

  // The two paragraphs, and the Google Books line inside the first.
  await expect(afterCredits(page).nth(0)).toHaveText(MEMO_LINE)
  await expect(afterCredits(page).nth(1)).toHaveText(WORDFREQ_LINE)
  await expect(page.getByText(GOOGLE_BOOKS, { exact: false })).toBeVisible()
  await expect(page.getByText(GOOGLE_BOOKS, { exact: false })).toHaveCount(1)
}

test.describe('the credits in the privacy notice', () => {
  test('the static notice ends with Credits, with the Google Books line and the wordfreq line', async ({ page }) => {
    await page.goto('./#/privacy')
    await expectCredits(page, PRIVACY_SECTIONS.map((s) => s.heading))
    // The delete button and the link back still come after it.
    await expect(page.getByRole('button', { name: 'Delete the data this site keeps in this browser', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back', exact: true })).toBeVisible()
  })

  test('the online notice ends with the same Credits section', async ({ page }) => {
    await page.goto(`./${SERVER_QUERY}#/privacy`)
    await expectCredits(page, SERVER_PRIVACY_SECTIONS.map((s) => s.heading))
    await expect(page.getByRole('heading', { level: 2, name: 'What is sent to the server', exact: true })).toBeVisible()
    await expect(page.locator('footer').getByRole('link', { name: 'Your data on the server' })).toBeVisible()
  })

  test('passes axe in light and dark (0 serious or critical), without sideways scroll at 320 px, and the language lint', async ({ page }) => {
    for (const colorScheme of ['light', 'dark'] as const) {
      await scheme(page, colorScheme)
      await page.goto('./#/privacy')
      await expect(credits(page)).toBeVisible()
      await expectNoSeriousAxe(page)
    }
    await page.setViewportSize({ width: 320, height: 800 })
    await credits(page).scrollIntoViewIfNeeded()
    await expect(page.getByText(GOOGLE_BOOKS, { exact: false })).toBeVisible()
    await overflow(page, 'the privacy notice with its credits at 320 px')
    await expectNoSeriousAxe(page)
    await languageClean(page)
  })

  test('the online notice passes axe in light and dark too', async ({ page }) => {
    for (const colorScheme of ['light', 'dark'] as const) {
      await scheme(page, colorScheme)
      await page.goto(`./${SERVER_QUERY}#/privacy`)
      await expect(credits(page)).toBeVisible()
      await expectNoSeriousAxe(page)
    }
    await languageClean(page)
  })
})
