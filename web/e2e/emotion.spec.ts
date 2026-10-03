/**
 * The emotion vignette entry on the dev-only demo route `#/dev/emotion` (ROADMAP M6.1; DESIGN §3 row 16, §5.1,
 * §13, R-5.6.2), in Chromium, WebKit and an emulated iPhone 13. No finite vignette is in the public repo, so the
 * page shows a made-up practice situation (`src/tasks/emotion/demo.ts`):
 * - the skill is named "Emotion Reading (text scenarios)" and its tooltip is the sentence of R-5.6.2, word for
 *   word, opened from a button (click, Enter, a mouse hovering) and closed with Escape or a press outside;
 * - a feeling is chosen and confirmed once; what is sent is its position; the page says only "Answer recorded";
 * - the intended answer is nowhere in the page before the answer is given, and nothing in the markup marks it;
 * - axe: 0 serious or critical issues in light and dark, with the tooltip open and after the answer; 320 px
 *   reflow with the tooltip open; 44 px targets; the whole entry can be done with the keyboard;
 * - nothing is stored and nothing is sent, and the rendered page passes the language lint (A13) with the
 *   tooltip in it.
 * The e2e tsconfig has no DOM lib, so page code is passed as strings.
 */

import { expect, test, type Locator, type Page } from '@playwright/test'
import { lintText } from '../scripts/language-lint'
import { EMO_AXIS_NAME, EMO_TOOLTIP } from '../src/copy'
import { CONFIRM_LABEL } from '../src/render/choice/keys'
import { ENTRY_COPY } from '../src/tasks/emotion/copy'
import { demoEmotionItem } from '../src/tasks/emotion/demo'
import { expectNoAriaAttributeIssues, expectNoSeriousAxe } from './axe'

const SEED = 1
const ITEM = demoEmotionItem(SEED)
const URL = `./#/dev/emotion?seed=${SEED}`
const OTHER = (ITEM.answer_index + 1) % ITEM.spec.options.length

async function open(page: Page, url = URL): Promise<void> {
  await page.goto('about:blank')
  await page.goto(url)
  await expect(page.getByRole('heading', { level: 1, name: 'Emotion reading entry demo (development only)' })).toBeVisible()
  await expect(page.getByText(ITEM.spec.stem.split(' How is ')[0] as string)).toBeVisible()
  // The options unlock on the first drawn frame; the Confirm button follows a choice.
  await expect(page.getByRole('radio').first()).toBeEnabled()
}

const option = (page: Page, i: number): Locator => page.getByRole('radio', { name: ITEM.spec.options[i] as string, exact: true })
const confirm = (page: Page): Locator => page.getByRole('button', { name: CONFIRM_LABEL, exact: true })
const tipButton = (page: Page): Locator => page.getByRole('button', { name: new RegExp(`^${ENTRY_COPY.tipButton}`) })
const tipText = (page: Page): Locator => page.getByText(EMO_TOOLTIP, { exact: true })

async function answer(page: Page, i: number): Promise<void> {
  await option(page, i).check()
  await confirm(page).click()
}

test.describe('answering', () => {
  test('shows the skill name, the situation and five feelings in the order of the spec, none chosen', async ({ page }) => {
    await open(page)
    await expect(page.getByText(EMO_AXIS_NAME, { exact: true })).toBeVisible()
    await expect(page.getByRole('group', { name: `How is ${ITEM.spec.stem.split('How is ')[1]?.split(' most likely')[0]} most likely to feel?` })).toBeVisible()
    const radios = page.getByRole('radio')
    await expect(radios).toHaveCount(5)
    for (let i = 0; i < 5; i++) await expect(radios.nth(i)).toHaveAccessibleName(ITEM.spec.options[i] as string)
    await expect(radios.nth(0)).not.toBeChecked()
    await expect(confirm(page)).toBeDisabled()
  })

  test('a chosen feeling is confirmed once, and what is sent is its position', async ({ page }) => {
    await open(page)
    await answer(page, OTHER)
    await expect(page.getByTestId('emotion-feedback')).toBeVisible()
    await expect(page.getByTestId('emotion-feedback')).toHaveAttribute('data-response', String(OTHER))
    await expect(page.getByTestId('emotion-feedback-choice')).toHaveText(`You chose ${ITEM.spec.options[OTHER]}.`)
    await expect(page.locator('.hb-status')).toHaveText(ENTRY_COPY.recorded)
    await expect(confirm(page)).toBeDisabled()
    await expect(option(page, 0)).toBeDisabled()
  })

  test('the renderer itself never says whether a choice was right', async ({ page }) => {
    await open(page)
    await answer(page, ITEM.answer_index)
    const entry = await page.locator('section.hb-render.emotion').innerText()
    expect(entry).not.toMatch(/\b(wrong|incorrect|correct|right|mistake|score|well done)\b/i)
  })

  test('another situation replaces the entry with a fresh one', async ({ page }) => {
    await open(page)
    await answer(page, 0)
    await page.getByTestId('emotion-another').click()
    await expect(page.getByTestId('emotion-feedback')).toHaveCount(0)
    await expect(page.getByRole('radio').first()).toBeEnabled()
    await expect(page.getByRole('radio').first()).not.toBeChecked()
    await expect(confirm(page)).toBeDisabled()
  })
})

test.describe('the tooltip (R-5.6.2)', () => {
  test('is closed to start, and the button opens it with the sentence of the spec, word for word', async ({ page }) => {
    await open(page)
    await expect(tipButton(page)).toHaveAttribute('aria-expanded', 'false')
    await expect(tipText(page)).toBeHidden()
    await tipButton(page).click()
    await expect(tipButton(page)).toHaveAttribute('aria-expanded', 'true')
    await expect(tipText(page)).toBeVisible()
    expect(EMO_TOOLTIP).toBe('Measures agreement with appraisal-theory and consensus keys. Not a diagnostic or clinical measure; scores are strongly affected by vocabulary, culture and test familiarity.')
    await expect(tipButton(page)).toHaveAccessibleName(`${ENTRY_COPY.tipButton}: ${EMO_AXIS_NAME}`)
    await expect(tipButton(page)).toHaveAccessibleDescription(new RegExp(EMO_TOOLTIP.slice(0, 40)))
  })

  test('closes with Escape (focus back on the button), with a second press and with a press outside', async ({ page }) => {
    await open(page)
    // From the keyboard, focus is on the button and Escape returns it there (a click does not focus a button in Safari).
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
    await page.getByRole('heading', { level: 1 }).click() // outside it (the panel covers the situation below)
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

  test('opening it does not move the situation or the options', async ({ page }) => {
    await open(page)
    const before = await page.locator('.scenario').boundingBox()
    await tipButton(page).click()
    await expect(tipText(page)).toBeVisible()
    const after = await page.locator('.scenario').boundingBox()
    expect(after).toEqual(before)
    await answer(page, 2) // the panel does not cover the options' controls (it ends above them)
    await expect(page.getByTestId('emotion-feedback')).toBeVisible()
  })
})

test.describe('the intended answer is not in the page', () => {
  test('before the answer, not as text and not as a mark on any option', async ({ page }) => {
    await open(page)
    const html = await page.content()
    expect(html).not.toContain(ITEM.explanation)
    expect(html).not.toMatch(/intended/i)
    const root = `document.querySelector('section.hb-render.emotion')`
    const attrs = (await page.evaluate(`[...${root}.querySelectorAll('*')].flatMap((e) => [...e.attributes].map((a) => a.name))`)) as string[]
    expect(attrs.filter((a) => a.startsWith('data-'))).toEqual([])
    const classes = (await page.evaluate(`[...${root}.querySelectorAll('label.option')].map((e) => e.className + '|' + e.querySelector('input').className)`)) as string[]
    expect(classes).toHaveLength(5)
    expect(new Set(classes).size).toBe(1)
  })
})

test.describe('accessibility, keyboard, storage and language', () => {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`has no serious or critical axe violations: empty, with the tooltip, with a choice and after the answer (${colorScheme})`, async ({ page }) => {
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
      await option(page, 1).check()
      await expectNoSeriousAxe(page)
      await confirm(page).click()
      await expect(page.getByTestId('emotion-feedback')).toBeVisible()
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
    for (const box of [page.locator('label.option').first(), confirm(page), tipButton(page)]) {
      const b = await box.boundingBox()
      expect(b?.height ?? 0).toBeGreaterThanOrEqual(43)
    }
  })

  test('the whole entry can be done with the keyboard', async ({ page, isMobile, browserName }) => {
    test.skip(isMobile === true, 'keyboard use is for desktop browsers')
    await open(page)
    // Safari skips buttons when tabbing unless the user turns that on, so only the other engines tab to them.
    if (browserName === 'webkit') await tipButton(page).focus()
    else {
      await page.keyboard.press('Tab')
      await expect(tipButton(page)).toBeFocused()
    }
    await page.keyboard.press('Enter')
    await expect(tipText(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(tipText(page)).toBeHidden()
    await option(page, 0).focus()
    await page.keyboard.press('3')
    await expect(option(page, 2)).toBeChecked()
    await page.keyboard.press('ArrowUp')
    await expect(option(page, 1)).toBeChecked()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('emotion-feedback')).toHaveAttribute('data-response', '1')
  })

  test('stores nothing, sends nothing, and the rendered page (tooltip included) passes the language lint (A13)', async ({ page }) => {
    const requests: string[] = []
    await open(page)
    page.on('request', (r) => requests.push(r.url()))
    await tipButton(page).click()
    await answer(page, 3)
    await expect(page.getByTestId('emotion-feedback')).toBeVisible()
    await page.waitForTimeout(200)
    const snapshot = await page.evaluate(`(async () => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie, caches: typeof caches === 'undefined' ? 0 : (await caches.keys()).length }))()`)
    expect(snapshot).toEqual({ local: 0, session: 0, cookie: '', caches: 0 })
    expect(requests.filter((u) => !u.startsWith('blob:'))).toEqual([])
    const html = await page.content()
    expect(html).toContain(EMO_TOOLTIP)
    expect(lintText(html, 'rendered.html')).toEqual([])
  })
})
