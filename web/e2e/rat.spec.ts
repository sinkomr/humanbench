/**
 * The word links entry on the dev-only demo route `#/dev/rat` (ROADMAP M6.3; DESIGN §3 row 17, §5.4, §13), in Chromium,
 * WebKit and an emulated iPhone 13. No finite puzzle is in the public repo, so the page shows a made-up practice puzzle
 * (`src/tasks/rat/demo.ts`):
 * - three cue words as a list, one labelled box that asks the browser for no help (no autocomplete, correction,
 *   capitalisation or spell check; at most 40 characters), and Confirm;
 * - a word is confirmed once, with Enter or the button; what is sent is the typed text, trimmed; the page says only
 *   "Answer recorded"; an empty entry is not sent, and a note says so;
 * - the demo's word and its compounds are nowhere in the page before the answer, and nothing in the markup depends on them;
 * - axe: 0 serious or critical issues in light and dark, empty, with the note, with a word typed and after the answer;
 *   320 px reflow; 44 px targets; the whole entry can be done with the keyboard;
 * - nothing is stored and nothing is sent, and the rendered page passes the language lint (A13).
 * The e2e tsconfig has no DOM lib, so page code is passed as strings.
 */

import { expect, test, type Locator, type Page } from '@playwright/test'
import { lintText } from '../scripts/language-lint'
import { ENTRY_COPY } from '../src/tasks/rat/copy'
import { DEMO_NOTE, demoRatItem } from '../src/tasks/rat/demo'
import { MAX_ANSWER_CHARS } from '../src/tasks/rat/spec'
import { expectNoAriaAttributeIssues, expectNoSeriousAxe } from './axe'

const SEED = 1
const ITEM = demoRatItem(SEED)
const URL = `./#/dev/rat?seed=${SEED}`
const OTHER_WORD = 'zebra'

async function open(page: Page, url = URL): Promise<void> {
  await page.goto('about:blank')
  await page.goto(url)
  await expect(page.getByRole('heading', { level: 1, name: 'Word links entry demo (development only)', exact: true })).toBeVisible()
  await expect(page.locator('section.hb-render.rat')).toBeVisible()
  // The box unlocks on the first drawn frame.
  await expect(box(page)).toBeEnabled()
}

const box = (page: Page): Locator => page.getByRole('textbox', { name: ENTRY_COPY.inputLabel, exact: true })
const confirm = (page: Page): Locator => page.getByRole('button', { name: ENTRY_COPY.submit, exact: true })
const feedback = (page: Page): Locator => page.getByTestId('rat-feedback')

async function answer(page: Page, text: string): Promise<void> {
  await box(page).fill(text)
  await confirm(page).click()
}

test.describe('answering', () => {
  test('shows the name, the instruction, the three cues as a list in the order of the puzzle, and an empty labelled box', async ({ page }) => {
    await open(page)
    await expect(page.locator('section.hb-render.rat .title')).toHaveText('Word links')
    await expect(page.getByText(ENTRY_COPY.instructions, { exact: true })).toBeVisible()
    const cues = page.getByRole('list', { name: ENTRY_COPY.cuesLabel }).getByRole('listitem')
    await expect(cues).toHaveCount(3)
    for (let i = 0; i < 3; i++) await expect(cues.nth(i)).toHaveText(ITEM.spec.cues[i] as string)
    await expect(box(page)).toHaveValue('')
    await expect(confirm(page)).toBeEnabled()
    await expect(page.getByTestId('rat-practice-id')).toHaveText(`Practice id ${ITEM.item_id}`)
    await expect(page.getByTestId('rat-practice-note')).toHaveText(DEMO_NOTE)
    await expect(feedback(page)).toHaveCount(0)
  })

  test('the box asks the browser for no help and takes at most 40 characters', async ({ page }) => {
    await open(page)
    const attrs = (await box(page).evaluate((el) => ({
      type: el.getAttribute('type'),
      autocomplete: el.getAttribute('autocomplete'),
      autocorrect: el.getAttribute('autocorrect'),
      autocapitalize: el.getAttribute('autocapitalize'),
      spellcheck: el.getAttribute('spellcheck'),
      maxlength: el.getAttribute('maxlength'),
    }))) as Record<string, string | null>
    expect(attrs).toEqual({ type: 'text', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', maxlength: String(MAX_ANSWER_CHARS) })
    await box(page).pressSequentially('x'.repeat(MAX_ANSWER_CHARS + 20))
    expect((await box(page).inputValue()).length).toBe(MAX_ANSWER_CHARS)
  })

  test('a word is confirmed once with Enter, and what is sent is the typed text, trimmed', async ({ page }) => {
    await open(page)
    await box(page).fill(`  ${ITEM.word.toUpperCase()} `)
    await box(page).press('Enter')
    await expect(feedback(page)).toBeVisible()
    await expect(feedback(page)).toHaveAttribute('data-response', ITEM.word.toUpperCase())
    await expect(feedback(page)).toHaveAttribute('data-match', 'true')
    await expect(page.locator('.hb-status')).toHaveText(ENTRY_COPY.recorded)
    await expect(confirm(page)).toBeDisabled()
    await expect(box(page)).toHaveAttribute('readonly', '')
    // a second Enter, and a try at changing the word, change nothing
    await box(page).press('Enter')
    await box(page).pressSequentially('more', { delay: 5 })
    await box(page).press('Enter')
    await expect(feedback(page)).toHaveAttribute('data-response', ITEM.word.toUpperCase())
    await expect(box(page)).toHaveValue(`  ${ITEM.word.toUpperCase()} `)
  })

  test('the Confirm button answers too, and a word that is not the demo word is shown as such', async ({ page }) => {
    await open(page)
    await answer(page, OTHER_WORD)
    await expect(feedback(page)).toHaveAttribute('data-response', OTHER_WORD)
    await expect(feedback(page)).toHaveAttribute('data-match', 'false')
    await expect(page.getByTestId('rat-feedback-typed')).toHaveText(`You typed “${OTHER_WORD}”. It does not match the demo's word.`)
    await expect(page.getByTestId('rat-feedback-word')).toHaveText(`The demo's word: ${ITEM.word}. ${ITEM.compounds.join(', ')}.`)
  })

  const ACCENTS: Record<string, string> = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú' }
  const VARIANTS: readonly [string, (w: string) => string][] = [
    ['capitals and spaces', (w) => ` ${w.slice(0, 1).toUpperCase()}${w.slice(1)} `],
    ['a hyphen inside the word', (w) => `${w.slice(0, 2)}-${w.slice(2)}`],
    ['an accent on a vowel', (w) => w.replace(/[aeiou]/, (v) => ACCENTS[v] as string)],
  ]
  for (const [name, variant] of VARIANTS) {
    test(`the demo's check ignores case, accents and hyphens: ${name}`, async ({ page }) => {
      await open(page)
      await answer(page, variant(ITEM.word))
      await expect(feedback(page)).toHaveAttribute('data-match', 'true')
    })
  }

  test('an empty entry is not sent: a note says so, the box is marked and focused, and a word can follow', async ({ page }) => {
    await open(page)
    await confirm(page).click()
    await expect(page.getByText(ENTRY_COPY.emptyNote, { exact: true })).toBeVisible()
    await expect(feedback(page)).toHaveCount(0)
    await expect(box(page)).toHaveAttribute('aria-invalid', 'true')
    await expect(box(page)).toBeFocused()
    await expect(box(page)).toHaveAccessibleDescription(ENTRY_COPY.emptyNote)
    await box(page).fill('   ')
    await box(page).press('Enter')
    await expect(feedback(page)).toHaveCount(0)
    await expect(page.getByText(ENTRY_COPY.emptyNote, { exact: true })).toBeVisible()
    await box(page).pressSequentially(ITEM.word)
    await expect(page.getByText(ENTRY_COPY.emptyNote, { exact: true })).toHaveCount(0)
    await expect(box(page)).not.toHaveAttribute('aria-invalid', 'true')
    await box(page).press('Enter')
    await expect(feedback(page)).toHaveAttribute('data-response', ITEM.word)
  })

  test('the renderer itself never says whether a word was right', async ({ page }) => {
    await open(page)
    await answer(page, ITEM.word)
    await expect(feedback(page)).toBeVisible()
    const entry = await page.locator('section.hb-render.rat').innerText()
    expect(entry).not.toMatch(/\b(wrong|incorrect|correct|right|mistake|score|well done)\b/i)
    expect(entry).toContain(ENTRY_COPY.recorded)
  })

  test('another puzzle replaces the entry with a fresh one', async ({ page }) => {
    await open(page)
    await answer(page, 'first')
    await page.getByTestId('rat-another').click()
    await expect(feedback(page)).toHaveCount(0)
    await expect(page.getByTestId('rat-practice-id')).toHaveText(`Practice id ${demoRatItem(SEED + 1).item_id}`)
    await expect(box(page)).toBeEnabled()
    await expect(box(page)).toHaveValue('')
    await expect(box(page)).not.toHaveAttribute('readonly', '')
    await expect(confirm(page)).toBeEnabled()
    const cues = page.getByRole('list', { name: ENTRY_COPY.cuesLabel }).getByRole('listitem')
    for (let i = 0; i < 3; i++) await expect(cues.nth(i)).toHaveText(demoRatItem(SEED + 1).spec.cues[i] as string)
  })

  test('shows the puzzle of another seed', async ({ page }) => {
    const other = demoRatItem(5)
    await open(page, './#/dev/rat?seed=5')
    await expect(page.getByTestId('rat-practice-id')).toHaveText(`Practice id ${other.item_id}`)
    const cues = page.getByRole('list', { name: ENTRY_COPY.cuesLabel }).getByRole('listitem')
    for (let i = 0; i < 3; i++) await expect(cues.nth(i)).toHaveText(other.spec.cues[i] as string)
  })
})

test.describe('the demo word is not in the page', () => {
  test('before the answer, not as text and not as a mark on anything in the entry', async ({ page }) => {
    await open(page)
    const html = await page.locator('main').innerHTML()
    const text = await page.locator('main').innerText()
    for (const needle of [ITEM.word, ...ITEM.compounds]) {
      expect(text.toLowerCase(), needle).not.toContain(needle.toLowerCase())
      expect(html.toLowerCase(), needle).not.toMatch(new RegExp(`\\b${needle.toLowerCase()}\\b`))
    }
    expect(html).not.toMatch(/intended/i)
    const root = `document.querySelector('section.hb-render.rat')`
    const attrs = (await page.evaluate(`[...${root}.querySelectorAll('*')].flatMap((e) => [...e.attributes].map((a) => a.name))`)) as string[]
    expect(attrs.filter((a) => a.startsWith('data-'))).toEqual([])
    const classes = (await page.evaluate(`[...${root}.querySelectorAll('li.cue')].map((e) => e.className)`)) as string[]
    expect(classes).toHaveLength(3)
    expect(new Set(classes).size).toBe(1)
  })
})

test.describe('accessibility, keyboard, storage and language', () => {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`has no serious or critical axe violations: empty, with the note, with a word typed and after the answer (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme })
      await open(page)
      await expectNoSeriousAxe(page)
      await expectNoAriaAttributeIssues(page)
      await confirm(page).click()
      await expect(page.getByText(ENTRY_COPY.emptyNote, { exact: true })).toBeVisible()
      await expectNoSeriousAxe(page)
      await expectNoAriaAttributeIssues(page)
      await box(page).fill(ITEM.word)
      await expectNoSeriousAxe(page)
      await confirm(page).click()
      await expect(feedback(page)).toBeVisible()
      await expectNoSeriousAxe(page)
      await expectNoAriaAttributeIssues(page)
    })
  }

  test('reflows at 320 px with no horizontal scroll, with the note and a long word, and keeps its 44 px targets', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await open(page)
    await confirm(page).click()
    await expect(page.getByText(ENTRY_COPY.emptyNote, { exact: true })).toBeVisible()
    await box(page).pressSequentially('w'.repeat(MAX_ANSWER_CHARS))
    expect(await page.evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)).toBeLessThanOrEqual(0)
    await expectNoSeriousAxe(page)
    for (const target of [box(page), confirm(page)]) {
      const b = await target.boundingBox()
      expect(b?.height ?? 0).toBeGreaterThanOrEqual(43)
      expect((b?.x ?? 0) + (b?.width ?? 0)).toBeLessThanOrEqual(320)
    }
    for (const cue of await page.locator('li.cue').all()) {
      const b = await cue.boundingBox()
      expect((b?.x ?? 0) + (b?.width ?? 0)).toBeLessThanOrEqual(320)
    }
  })

  test('the whole entry can be done with the keyboard', async ({ page, isMobile, browserName }) => {
    test.skip(isMobile === true, 'keyboard use is for desktop browsers')
    await open(page)
    await page.keyboard.press('Tab')
    await expect(box(page)).toBeFocused()
    await page.keyboard.type(ITEM.word)
    await page.keyboard.press('Enter')
    await expect(feedback(page)).toHaveAttribute('data-response', ITEM.word)
    // Safari skips buttons when tabbing unless the user turns that on, so only the other engines tab to them.
    if (browserName !== 'webkit') {
      await page.keyboard.press('Tab')
      await expect(page.getByTestId('rat-another')).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(feedback(page)).toHaveCount(0)
    }
  })

  test('stores nothing, sends nothing, and the rendered page passes the language lint (A13)', async ({ page }) => {
    const requests: string[] = []
    await open(page)
    page.on('request', (r) => requests.push(r.url()))
    await confirm(page).click()
    await answer(page, ITEM.word)
    await expect(feedback(page)).toBeVisible()
    await page.waitForTimeout(200)
    const snapshot = await page.evaluate(`(async () => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie, caches: typeof caches === 'undefined' ? 0 : (await caches.keys()).length }))()`)
    expect(snapshot).toEqual({ local: 0, session: 0, cookie: '', caches: 0 })
    expect(requests.filter((u) => !u.startsWith('blob:'))).toEqual([])
    const html = await page.content()
    expect(lintText(html, 'rendered.html')).toEqual([])
  })
})
