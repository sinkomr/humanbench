/**
 * The situational judgment entry on the dev-only demo route `#/dev/sjt` (ROADMAP M6.2; DESIGN §3 row 16, §5.2, §5.3, §13,
 * R-5.6.2), in Chromium, WebKit and an emulated iPhone 13. No finite situation is in the public repo, so the page shows a
 * made-up practice situation (`src/tasks/sjt/demo.ts`):
 * - the skill is named "Emotion Reading (text scenarios)" and its tooltip is the sentence of R-5.6.2, word for word, then the
 *   note of the facet (agreement with typical and expert judgments, conventional choices, overlap with reading and
 *   vocabulary), opened from a button (click, Enter, a mouse hovering) and closed with Escape or a press outside;
 * - rate mode: four responses A to D, each rated 1 to 4 with native radios; Confirm is off until all four are rated;
 *   what is sent is the four ratings in display order, once; the page says only "Answer recorded" while the item counts,
 *   and the demo's comparison and its "Closeness to the demo's ratings" come only after the answer;
 * - most/least mode: two questions, Confirm off until both are chosen and different (with a note when they are the same);
 * - the demo's ratings are nowhere in the page before the answer, and nothing in the markup marks a response;
 * - axe: 0 serious or critical issues in light and dark, empty, with the tooltip, part way, complete and after the answer;
 *   320 px reflow with the tooltip open; 44 px targets; the whole entry can be done with the keyboard, in both modes;
 * - nothing is stored and nothing is sent, and the rendered page passes the language lint (A13) with the tooltip in it.
 * The e2e tsconfig has no DOM lib, so page code is passed as strings.
 */

import { expect, test, type Locator, type Page } from '@playwright/test'
import { lintText } from '../scripts/language-lint'
import { EMO_AXIS_NAME, EMO_TOOLTIP } from '../src/copy'
import { ENTRY_COPY, FACET_NOTE, progressText, SCALE_LABELS } from '../src/tasks/sjt/copy'
import { demoSjtItem } from '../src/tasks/sjt/demo'
import { mostLeastScore, ratingScore } from '../src/tasks/sjt/scoring'
import { expectNoAriaAttributeIssues, expectNoSeriousAxe } from './axe'

const SEED = 1
const ITEM = demoSjtItem(SEED)
const RATE_URL = `./#/dev/sjt?seed=${SEED}`
const MOST_LEAST_URL = `${RATE_URL}&mode=most_least`
const LETTERS = 'ABCD'
/** The ratings the tests give, in display order. */
const LEVELS = [3, 1, 4, 2]

async function open(page: Page, url = RATE_URL): Promise<void> {
  await page.goto('about:blank')
  await page.goto(url)
  await expect(page.getByRole('heading', { level: 1, name: 'Situational judgment entry demo (development only)', exact: true })).toBeVisible()
  await expect(page.getByText(ITEM.spec.scenario, { exact: true })).toBeVisible()
  // The inputs unlock on the first drawn frame; Confirm follows a complete answer.
  await expect(page.getByRole('radio').first()).toBeEnabled()
}

const responseGroup = (page: Page, i: number): Locator => page.getByRole('group', { name: `${LETTERS[i]}. ${ITEM.spec.responses[i]}`, exact: true })
const level = (page: Page, i: number, n: number): Locator => responseGroup(page, i).getByRole('radio', { name: `${n} ${SCALE_LABELS[n - 1]}`, exact: true })
const question = (page: Page, which: 'most' | 'least'): Locator => page.getByRole('group', { name: ENTRY_COPY[which], exact: true })
const choice = (page: Page, which: 'most' | 'least', i: number): Locator => question(page, which).getByRole('radio').nth(i)
const confirm = (page: Page): Locator => page.getByRole('button', { name: ENTRY_COPY.submit, exact: true })
const tipButton = (page: Page): Locator => page.getByRole('button', { name: new RegExp(`^${ENTRY_COPY.tipButton}`) })
const tipText = (page: Page): Locator => page.locator('[role="tooltip"] .text')
const feedback = (page: Page): Locator => page.getByTestId('sjt-feedback')
const TIP_FULL = `${EMO_TOOLTIP} ${FACET_NOTE}`

async function rateAll(page: Page, levels: readonly number[] = LEVELS): Promise<void> {
  for (const [i, n] of levels.entries()) await level(page, i, n).check()
}

async function chooseMostLeast(page: Page, most: number, least: number): Promise<void> {
  await choice(page, 'most', most).check()
  await choice(page, 'least', least).check()
}

test.describe('rating each response', () => {
  test('shows the skill name, the situation, the question and four responses A to D in the order of the spec, none rated', async ({ page }) => {
    await open(page)
    await expect(page.getByText(EMO_AXIS_NAME, { exact: true })).toBeVisible()
    await expect(page.getByRole('group', { name: ENTRY_COPY.scenarioLabel, exact: true })).toBeVisible()
    await expect(page.getByRole('group', { name: ITEM.spec.question, exact: true })).toBeVisible()
    await expect(page.locator('.hb-instructions')).toHaveText(ENTRY_COPY.instructions)
    await expect(page.locator('fieldset.response')).toHaveCount(4)
    for (let i = 0; i < 4; i++) {
      await expect(responseGroup(page, i)).toBeVisible()
      await expect(responseGroup(page, i).getByRole('radio')).toHaveCount(4)
      for (let n = 1; n <= 4; n++) await expect(level(page, i, n)).not.toBeChecked()
    }
    await expect(confirm(page)).toBeDisabled()
    await expect(page.locator('.progress')).toHaveText(progressText(0, 4))
  })

  test('Confirm comes on when the fourth response is rated, and the four ratings are sent once, in display order', async ({ page }) => {
    await open(page)
    for (const [i, n] of LEVELS.slice(0, 3).entries()) await level(page, i, n).check()
    await expect(confirm(page)).toBeDisabled()
    await expect(page.locator('.progress')).toHaveText(progressText(3, 4))
    await level(page, 3, LEVELS[3] as number).check()
    await expect(confirm(page)).toBeEnabled()
    await expect(feedback(page)).toHaveCount(0) // rating alone sends nothing
    await confirm(page).click()
    await expect(feedback(page)).toBeVisible()
    await expect(feedback(page)).toHaveAttribute('data-response', LEVELS.join(','))
    await expect(page.locator('.hb-status')).toHaveText(ENTRY_COPY.recorded)
    await expect(confirm(page)).toBeDisabled()
    await expect(level(page, 0, 1)).toBeDisabled()
  })

  test('a rating can be changed before Confirm', async ({ page }) => {
    await open(page)
    await rateAll(page, [1, 1, 1, 1])
    await level(page, 2, 4).check()
    await expect(level(page, 2, 1)).not.toBeChecked()
    await confirm(page).click()
    await expect(feedback(page)).toHaveAttribute('data-response', '1,1,4,1')
  })

  test('the feedback compares the answer with the demo ratings, from the scoring functions', async ({ page }) => {
    await open(page)
    await rateAll(page)
    await confirm(page).click()
    const closeness = ratingScore(LEVELS, ITEM.ratings)
    await expect(page.getByTestId('sjt-feedback-closeness')).toHaveText(`Closeness to the demo's ratings: ${closeness.toFixed(2)} of 1`)
    await expect(feedback(page)).toHaveAttribute('data-closeness', String(closeness))
    const rows = page.getByTestId('sjt-feedback-row')
    await expect(rows).toHaveCount(4)
    for (let i = 0; i < 4; i++) {
      await expect(rows.nth(i)).toContainText(`${LETTERS[i]}. ${ITEM.spec.responses[i]}`)
      await expect(rows.nth(i)).toContainText(`Your rating: ${LEVELS[i]} (${SCALE_LABELS[(LEVELS[i] as number) - 1]}).`)
      await expect(rows.nth(i)).toContainText(`The demo's rating: ${ITEM.ratings[i]}.`)
    }
  })

  test('the renderer itself never says whether a rating was right', async ({ page }) => {
    await open(page)
    await rateAll(page, ITEM.ratings.map((r) => Math.round(r)))
    await confirm(page).click()
    const entry = await page.locator('section.hb-render.sjt').innerText()
    expect(entry).not.toMatch(/\b(wrong|incorrect|correct|right|mistake|score|well done)\b/i)
  })

  test('another situation replaces the entry with a fresh one', async ({ page }) => {
    await open(page)
    await rateAll(page)
    await confirm(page).click()
    await page.getByTestId('sjt-another').click()
    await expect(feedback(page)).toHaveCount(0)
    await expect(page.getByTestId('sjt-practice-id')).toHaveText(`Practice id demo:sjt:${SEED + 1}`)
    await expect(page.getByRole('radio').first()).toBeEnabled()
    await expect(page.getByRole('radio').first()).not.toBeChecked()
    await expect(confirm(page)).toBeDisabled()
    await expect(page.locator('.progress')).toHaveText(progressText(0, 4))
  })
})

test.describe('choosing the response that would work best and the one that would work least well', () => {
  test('asks two questions of four responses each, with Confirm off until both are chosen', async ({ page }) => {
    await open(page, MOST_LEAST_URL)
    await expect(page.locator('.hb-instructions')).toHaveText(ENTRY_COPY.instructionsMostLeast)
    for (const which of ['most', 'least'] as const) {
      await expect(question(page, which)).toBeVisible()
      await expect(question(page, which).getByRole('radio')).toHaveCount(4)
      for (let i = 0; i < 4; i++) await expect(choice(page, which, i)).toHaveAccessibleName(`${LETTERS[i]}. ${ITEM.spec.responses[i]}`)
    }
    await expect(confirm(page)).toBeDisabled()
    await choice(page, 'most', 2).check()
    await expect(confirm(page)).toBeDisabled()
    await choice(page, 'least', 0).check()
    await expect(confirm(page)).toBeEnabled()
  })

  test('sends the two positions once, and the feedback scores them against the demo ratings', async ({ page }) => {
    await open(page, MOST_LEAST_URL)
    await chooseMostLeast(page, 1, 3)
    await confirm(page).click()
    await expect(feedback(page)).toHaveAttribute('data-response', 'most=1,least=3')
    await expect(page.getByTestId('sjt-feedback-closeness')).toHaveText(`Closeness to the demo's ratings: ${mostLeastScore(1, 3, ITEM.ratings).toFixed(2)} of 1`)
    await expect(page.getByTestId('sjt-feedback-row').nth(1)).toContainText('You chose it as the one that would work best.')
    await expect(page.getByTestId('sjt-feedback-row').nth(3)).toContainText('You chose it as the one that would work least well.')
    await expect(page.locator('.hb-status')).toHaveText(ENTRY_COPY.recorded)
    await expect(confirm(page)).toBeDisabled()
  })

  test('says so, in a live region, and keeps Confirm off when one response is chosen for both; choosing another clears it', async ({ page }) => {
    await open(page, MOST_LEAST_URL)
    const note = page.locator('.hb-note')
    await expect(note).toHaveAttribute('aria-live', 'polite')
    await expect(note).toHaveText('')
    await chooseMostLeast(page, 2, 2)
    await expect(note).toHaveText(ENTRY_COPY.mostLeastSame)
    await expect(confirm(page)).toBeDisabled()
    await choice(page, 'least', 3).check()
    await expect(note).toHaveText('')
    await expect(confirm(page)).toBeEnabled()
  })
})

test.describe('the tooltip (R-5.6.2, DESIGN §5.2, §5.3)', () => {
  test('is closed to start, and the button opens it with the sentence of the spec word for word, then the note of the facet', async ({ page }) => {
    await open(page)
    await expect(tipButton(page)).toHaveAttribute('aria-expanded', 'false')
    await expect(tipText(page)).toBeHidden()
    await tipButton(page).click()
    await expect(tipButton(page)).toHaveAttribute('aria-expanded', 'true')
    await expect(tipText(page)).toBeVisible()
    await expect(tipText(page)).toHaveText(TIP_FULL)
    expect(EMO_TOOLTIP).toBe('Measures agreement with appraisal-theory and consensus keys. Not a diagnostic or clinical measure; scores are strongly affected by vocabulary, culture and test familiarity.')
    expect(FACET_NOTE).toContain('typical and expert judgments')
    expect(FACET_NOTE).toContain('overlaps with reading and vocabulary skills')
    await expect(tipButton(page)).toHaveAccessibleName(`${ENTRY_COPY.tipButton}: ${EMO_AXIS_NAME}`)
    await expect(tipButton(page)).toHaveAccessibleDescription(new RegExp(EMO_TOOLTIP.slice(0, 40)))
  })

  test('closes with Escape (focus back on the button), with a second press and with a press outside', async ({ page }) => {
    await open(page)
    await tipButton(page).focus()
    await page.keyboard.press('Enter')
    await expect(tipText(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(tipText(page)).toBeHidden()
    await expect(tipButton(page)).toBeFocused()
    await tipButton(page).click()
    await expect(tipText(page)).toBeVisible()
    await page.keyboard.press('Escape') // whether or not the click focused the button
    await expect(tipText(page)).toBeHidden()
    await tipButton(page).click()
    await tipButton(page).click()
    await expect(tipText(page)).toBeHidden()
    await tipButton(page).click()
    await page.getByRole('heading', { level: 1 }).click() // outside it
    await expect(tipText(page)).toBeHidden()
  })

  test('a mouse hovering opens it and leaving closes it; a keyboard opens it with Enter', async ({ page, isMobile }) => {
    test.skip(isMobile === true, 'a phone has no hovering mouse')
    await open(page)
    await tipButton(page).hover()
    await expect(tipText(page)).toBeVisible()
    await page.mouse.move(0, 0)
    await expect(tipText(page)).toBeHidden()
    await tipButton(page).focus()
    await page.keyboard.press('Enter')
    await expect(tipText(page)).toBeVisible()
  })

  test('opening it does not move the situation, and the entry can still be answered', async ({ page }) => {
    await open(page)
    const before = await page.locator('.scenario').boundingBox()
    await tipButton(page).click()
    await expect(tipText(page)).toBeVisible()
    const after = await page.locator('.scenario').boundingBox()
    expect(after).toEqual(before)
    await page.keyboard.press('Escape')
    await rateAll(page)
    await confirm(page).click()
    await expect(feedback(page)).toBeVisible()
  })
})

test.describe('the demo ratings are not in the page', () => {
  for (const [name, url] of [
    ['rate', RATE_URL],
    ['most/least', MOST_LEAST_URL],
  ] as const) {
    test(`before the answer, not as text and not as a mark on any response (${name} mode)`, async ({ page }) => {
      await open(page, url)
      const html = await page.content()
      expect(html).not.toContain(ITEM.explanation)
      expect(html).not.toMatch(/intended/i)
      expect(html).not.toMatch(/Closeness to the demo/i)
      expect(html).not.toMatch(/The demo's rating/i)
      const root = `document.querySelector('section.hb-render.sjt')`
      const attrs = (await page.evaluate(`[...${root}.querySelectorAll('*')].flatMap((e) => [...e.attributes].map((a) => a.name))`)) as string[]
      expect(attrs.filter((a) => a.startsWith('data-'))).toEqual([])
      const classes = (await page.evaluate(`[...${root}.querySelectorAll('label')].map((e) => e.className + '|' + e.querySelector('input').className)`)) as string[]
      expect(classes).toHaveLength(name === 'rate' ? 16 : 8)
      expect(new Set(classes).size).toBe(1)
    })
  }
})

test.describe('accessibility, keyboard, storage and language', () => {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`has no serious or critical axe violations: empty, with the tooltip, part way, complete and after the answer (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme })
      await open(page)
      await expectNoSeriousAxe(page)
      // axe leaves a name on a paragraph "incomplete" (impact serious), which expectNoSeriousAxe does not read
      await expectNoAriaAttributeIssues(page)
      await tipButton(page).click()
      await expect(tipText(page)).toBeVisible()
      await expectNoSeriousAxe(page)
      await expectNoAriaAttributeIssues(page)
      await page.keyboard.press('Escape')
      await level(page, 0, 2).check()
      await level(page, 1, 4).check()
      await expectNoSeriousAxe(page)
      await level(page, 2, 1).check()
      await level(page, 3, 3).check()
      await expectNoSeriousAxe(page)
      await confirm(page).click()
      await expect(feedback(page)).toBeVisible()
      await expectNoSeriousAxe(page)
      await expectNoAriaAttributeIssues(page)
    })

    test(`has no serious or critical axe violations in most/least mode: empty, with one response for both, and after the answer (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme })
      await open(page, MOST_LEAST_URL)
      await expectNoSeriousAxe(page)
      await expectNoAriaAttributeIssues(page)
      await chooseMostLeast(page, 0, 0)
      await expect(page.getByText(ENTRY_COPY.mostLeastSame, { exact: true })).toBeVisible()
      await expectNoSeriousAxe(page)
      await choice(page, 'least', 2).check()
      await confirm(page).click()
      await expect(feedback(page)).toBeVisible()
      await expectNoSeriousAxe(page)
    })
  }

  test('reflows at 320 px with no horizontal scroll, with the tooltip open, and keeps its 44 px targets', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await open(page)
    await tipButton(page).click()
    await expect(tipText(page)).toBeVisible()
    expect(await page.evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)).toBeLessThanOrEqual(0)
    await expectNoSeriousAxe(page)
    const panel = await page.locator('[role="tooltip"]').boundingBox()
    expect((panel?.x ?? 0) + (panel?.width ?? 0)).toBeLessThanOrEqual(320)
    for (const box of [page.locator('label.level').first(), confirm(page), tipButton(page)]) {
      const b = await box.boundingBox()
      expect(b?.height ?? 0).toBeGreaterThanOrEqual(43)
    }
    await page.keyboard.press('Escape')
    await rateAll(page)
    await confirm(page).click()
    await expect(feedback(page)).toBeVisible()
    expect(await page.evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)).toBeLessThanOrEqual(0)
  })

  test('reflows at 320 px in most/least mode, with the note showing', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await open(page, MOST_LEAST_URL)
    await chooseMostLeast(page, 1, 1)
    await expect(page.getByText(ENTRY_COPY.mostLeastSame, { exact: true })).toBeVisible()
    expect(await page.evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)).toBeLessThanOrEqual(0)
    await expectNoSeriousAxe(page)
    for (const box of [page.locator('label.option').first(), confirm(page)]) {
      const b = await box.boundingBox()
      expect(b?.height ?? 0).toBeGreaterThanOrEqual(43)
    }
  })

  test('the whole entry can be rated with the keyboard: a number in a group, the arrow keys, then Enter', async ({ page, isMobile }) => {
    test.skip(isMobile === true, 'keyboard use is for desktop browsers')
    await open(page)
    // Safari skips buttons (and radios) when tabbing unless the user turns that on, so every engine is given focus directly.
    await tipButton(page).focus()
    await page.keyboard.press('Enter')
    await expect(tipText(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(tipText(page)).toBeHidden()
    await level(page, 0, 1).focus()
    await page.keyboard.press('3')
    await expect(level(page, 0, 3)).toBeChecked()
    await expect(level(page, 0, 3)).toBeFocused()
    await level(page, 1, 1).focus()
    await page.keyboard.press('ArrowDown') // the arrow keys move within the group, as in any radio group
    await page.keyboard.press('ArrowDown')
    await expect(level(page, 1, 3)).toBeChecked()
    await page.keyboard.press('ArrowUp')
    await expect(level(page, 1, 2)).toBeChecked()
    await level(page, 2, 1).focus()
    await page.keyboard.press('4')
    await level(page, 3, 1).focus()
    await page.keyboard.press('1')
    await expect(confirm(page)).toBeEnabled()
    await page.keyboard.press('Enter')
    await expect(feedback(page)).toHaveAttribute('data-response', '3,2,4,1')
  })

  test('the whole entry can be answered with the keyboard in most/least mode: A to D and 1 to 4 in each question, then Confirm with the space bar', async ({ page, isMobile }) => {
    test.skip(isMobile === true, 'keyboard use is for desktop browsers')
    await open(page, MOST_LEAST_URL)
    await choice(page, 'most', 0).focus()
    await page.keyboard.press('c')
    await expect(choice(page, 'most', 2)).toBeChecked()
    await choice(page, 'least', 0).focus()
    await page.keyboard.press('1')
    await expect(choice(page, 'least', 0)).toBeChecked()
    await confirm(page).focus()
    await page.keyboard.press('Space')
    await expect(feedback(page)).toHaveAttribute('data-response', 'most=2,least=0')
  })

  test('stores nothing, sends nothing, and the rendered page (tooltip included) passes the language lint (A13)', async ({ page }) => {
    const requests: string[] = []
    await open(page)
    page.on('request', (r) => requests.push(r.url()))
    await tipButton(page).click()
    await expect(tipText(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await rateAll(page)
    await confirm(page).click()
    await expect(feedback(page)).toBeVisible()
    await tipButton(page).click()
    await page.waitForTimeout(200)
    const snapshot = await page.evaluate(`(async () => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie, caches: typeof caches === 'undefined' ? 0 : (await caches.keys()).length }))()`)
    expect(snapshot).toEqual({ local: 0, session: 0, cookie: '', caches: 0 })
    expect(requests.filter((u) => !u.startsWith('blob:'))).toEqual([])
    const html = await page.content()
    expect(html).toContain(EMO_TOOLTIP)
    expect(html).toContain(FACET_NOTE)
    expect(lintText(html, 'rendered.html')).toEqual([])
  })
})
