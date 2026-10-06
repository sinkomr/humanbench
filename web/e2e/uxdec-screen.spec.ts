/// <reference lib="dom" />
/**
 * The focus target of a new question and one primary action per screen (web/UX-REVIEW.md D21 and D27, both
 * provisional defaults; DESIGN §10, §13; WCAG 2.4.3, 4.1.3), in a real browser on the production build, in Chromium,
 * WebKit and an emulated iPhone 13:
 *
 * - D21, option B: the part's heading takes focus on the first question of a part and on every screen that is not a
 *   question; on a later question of the same part focus goes to the question's own group, named "Question 2",
 *   "Question 3" ..., which is a script target and not a tab stop, so one Tab from it still reaches the answer field.
 *   The page title and the scroll-to-top of a new question on a phone (UX-001) are kept. After a skip, a break offer
 *   and a part's "Up next" screen, the next part's first question has the heading again and numbers from 1.
 * - D27, option A: the Skip and Finish panels make "Keep going" the first and only primary button (Escape keeps
 *   meaning it), and the focus-session start and the results-talk copy button are plain buttons.
 *
 * The unit side is `src/session/question-focus.test.ts`, `SessionScreen.dom.test.ts`, `Screen.dom.test.ts`,
 * `ConfirmPanel.dom.test.ts`, `src/reveal/FocusPicker.dom.test.ts` and `src/brief/ResultsTalk.dom.test.ts`; the whole
 * session by keyboard is `keyboard-session.spec.ts`.
 */

import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectNoSeriousAxe } from './axe'
import { answerItem, button, h1, loadSave, overflow, scheme, simulatedSave, toReady, toResults } from './flow'
import { focusTarget, press, tabTo } from './keyboard'
import { intoSegment, toInterstitial, SEGMENT_TITLES } from './routes'

const MAT = SEGMENT_TITLES.indexOf('Matrix & Series')
const SE = { width: 320, height: 568 } as const

/** A question's own group, by its exact name (a name match is a substring match unless it is exact: "Question 1" is in "Question 10"). */
const question = (page: Page, n: number): Locator => page.getByRole('group', { name: `Question ${n}`, exact: true })

/** The answer field of the question on screen: its first option, or its box. */
const field = (page: Page): Locator => page.locator('form.choice input[type=radio], form.entry input[type=text]').first()

const scrollY = (page: Page): Promise<number> => page.evaluate(() => window.scrollY)

/** Skip the part on the current "Up next" screen (it asks first) and stop there: what comes next, a break offer included, is the test's to meet. */
async function skipThisPart(page: Page): Promise<void> {
  await button(page, 'Skip this part').click()
  await page.locator('section.confirm').getByRole('button', { name: /^Skip / }).click()
}

/** Answer the question on screen with the keys a keyboard user presses, as far as the confidence slider: Tab to the field first. */
async function answerByKeys(page: Page, browserName: string): Promise<number> {
  await expect(field(page)).toBeVisible()
  const tabs = await tabTo(page, field(page), browserName)
  const slider = page.getByRole('slider')
  if ((await page.locator('form.choice').count()) > 0) {
    await page.keyboard.press('b')
    await page.keyboard.press('Enter')
  } else {
    await page.keyboard.type('1')
    await page.keyboard.press('Enter')
    if (!(await slider.isVisible({ timeout: 1500 }).catch(() => false))) {
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.type('A') // a letter series
      await page.keyboard.press('Enter')
    }
  }
  await expect(slider).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await tabTo(page, button(page, 'Continue'), browserName)
  await page.keyboard.press('Enter')
  await expect(slider).toHaveCount(0)
  return tabs
}

// ================================================================================================ D21

test.describe('a later question of a part takes its own region, not the part’s heading (D21, WCAG 2.4.3, 4.1.3)', () => {
  test('the first question has the heading in focus, the second and third their groups "Question 2" and "Question 3"; the tab and the heading still name the part', async ({ page }) => {
    await intoSegment(page, MAT)
    await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
    await expect(h1(page)).toBeFocused()
    await expect(page).toHaveTitle('Matrix & Series · HumanBench')
    // The first question has its group too, and focus is not on it.
    await expect(question(page, 1)).toBeVisible()
    await expect(question(page, 1)).not.toBeFocused()
    await expect(question(page, 1).locator('form.choice, form.entry')).toBeVisible()

    for (const n of [2, 3]) {
      await answerItem(page)
      await expect(question(page, n)).toBeFocused()
      expect(await focusTarget(page)).toEqual({ kind: 'group', name: `Question ${n}` })
      await expect(h1(page)).toHaveText('Matrix & Series')
      await expect(h1(page)).not.toBeFocused()
      await expect(page).toHaveTitle('Matrix & Series · HumanBench')
      // A script target that holds the question and is not a tab stop of its own.
      await expect(question(page, n)).toHaveAttribute('tabindex', '-1')
      await expect(question(page, n).locator('form.choice, form.entry')).toBeVisible()
      await expect(page.getByRole('group', { name: /^Question \d+$/ })).toHaveCount(1)
    }
    await expectNoSeriousAxe(page)
  })

  test('one Tab from the heading, and one from a later question’s group, reaches the answer field; no pointer is used', async ({ page, browserName, isMobile }) => {
    test.skip(isMobile === true, 'a touch phone has no Tab key')
    test.setTimeout(90_000)
    // Into the part by its Start button, reached and pressed by keys (a click would leave Safari's Tab starting from where the pointer was).
    await toInterstitial(page, MAT)
    await press(page, button(page, 'Start'), browserName)
    await expect(h1(page)).toHaveText('Matrix & Series')
    await expect(h1(page)).toBeFocused()
    expect(await answerByKeys(page, browserName), 'Tabs from the heading of the first question').toBe(1)
    for (const n of [2, 3, 4]) {
      await expect(question(page, n)).toBeFocused()
      expect(await answerByKeys(page, browserName), `Tabs from the group of question ${n}`).toBe(1)
    }
    await expect(question(page, 5)).toBeFocused()
  })

  for (const [name, size] of [['iPhone 13', undefined], ['iPhone SE', SE]] as const) {
    test.describe(name, () => {
      if (size !== undefined) test.use({ viewport: size })

      test('after Continue on the confidence panel the next question opens at the top of the page, its group in focus and its heading in view (UX-001)', async ({ page, isMobile }) => {
        test.skip(isMobile !== true, 'the phone engines are where a new screen kept the old scroll offset')
        await intoSegment(page, MAT)
        // The first question, answered as far as its slider ...
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
            await box.fill('A')
            await box.press('Enter')
          }
        }
        await expect(slider).toBeVisible()
        // ... then the page sits at the bottom, as it does after a tap on a button low on the screen.
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        await button(page, 'Continue').tap()
        await expect(slider).toHaveCount(0)
        await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
        await expect(question(page, 2)).toBeFocused()
        await expect(h1(page)).toBeInViewport()
        await expect.poll(() => scrollY(page)).toBe(0)
        await overflow(page, `${name}, a later question`)
        await expectNoSeriousAxe(page)
      })
    })
  }

  test('after a skip and after a break offer the next part’s first question has the heading again, and its numbering starts from 1', async ({ page }) => {
    test.setTimeout(90_000)
    await intoSegment(page, MAT)
    await answerItem(page)
    await expect(question(page, 2)).toBeFocused()
    // Skip the rest of Matrix & Series: its "Up next" successor takes the heading, and has no question group.
    await button(page, 'Skip Matrix & Series').click()
    await page.locator('section.confirm').getByRole('button', { name: 'Skip Matrix & Series' }).click()
    await expect(h1(page)).toHaveText('Up next: Spatial')
    await expect(h1(page)).toBeFocused()
    await expect(page.getByRole('group', { name: /^Question \d+$/ })).toHaveCount(0)
    // The break is offered once, between two parts, at the half-way one (before Working Memory): the offer takes the heading too.
    await skipThisPart(page)
    await expect(h1(page)).toHaveText('Time for a break?')
    await expect(h1(page)).toBeFocused()
    await button(page, 'Keep going').click()
    await expect(h1(page)).toHaveText('Up next: Working Memory')
    await expect(h1(page)).toBeFocused()
    await skipThisPart(page)
    await expect(h1(page)).toHaveText('Up next: Quantitative Reasoning')
    await expect(h1(page)).toBeFocused()
    await button(page, 'Start').click()
    await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
    await expect(h1(page)).toHaveText('Quantitative Reasoning')
    await expect(h1(page)).toBeFocused()
    await expect(page).toHaveTitle('Quantitative Reasoning · HumanBench')
    await expect(question(page, 1)).not.toBeFocused()
    // ... and the second question of that part takes its group, numbered 2 (not 3: Matrix & Series is another part).
    await answerItem(page)
    await expect(question(page, 2)).toBeFocused()
    await expect(h1(page)).not.toBeFocused()
  })
})

// ================================================================================================ D27

test.describe('one primary action per screen: the Skip and Finish panels (D27)', () => {
  /** The panel's buttons, in order, with whether each is a primary. */
  const buttonsOf = (page: Page): Promise<{ text: string; primary: boolean }[]> =>
    page.locator('section.confirm').evaluate((el) => [...el.querySelectorAll('button')].map((b) => ({ text: (b.textContent ?? '').trim(), primary: b.classList.contains('hb-primary') })))

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`the Skip panel on a question: "Keep going" first and the only primary, the skip a plain button; no serious axe issue (${colorScheme})`, async ({ page }) => {
      await intoSegment(page, MAT)
      await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
      await scheme(page, colorScheme)
      await button(page, 'Skip Matrix & Series').click()
      await expect(page.getByRole('heading', { level: 2, name: 'Skip Matrix & Series?' })).toBeFocused()
      expect(await buttonsOf(page)).toEqual([
        { text: 'Keep going', primary: true },
        { text: 'Skip Matrix & Series', primary: false },
      ])
      await overflow(page, 'the Skip panel')
      await expectNoSeriousAxe(page)
    })
  }

  test('the plain button still skips, and Keep going still returns to the question', async ({ page, isMobile }) => {
    await intoSegment(page, MAT)
    await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
    const skip = button(page, 'Skip Matrix & Series')
    await skip.click()
    await page.locator('section.confirm').getByRole('button', { name: 'Keep going' }).click()
    await expect(page.locator('section.confirm')).toHaveCount(0)
    await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
    if (isMobile !== true) await expect(skip).toBeFocused()
    await skip.click()
    await page.locator('section.confirm').getByRole('button', { name: 'Skip Matrix & Series' }).click()
    await expect(h1(page)).toHaveText('Up next: Spatial')
  })

  test('the Skip panel on an "Up next" screen is the same, and so is the Finish panel', async ({ page }) => {
    await toReady(page)
    await button(page, 'Begin').click()
    await expect(h1(page)).toHaveText('Up next: Reaction Time')
    await button(page, 'Skip this part').click()
    expect(await buttonsOf(page)).toEqual([
      { text: 'Keep going', primary: true },
      { text: 'Skip Reaction Time', primary: false },
    ])
    await page.locator('section.confirm').getByRole('button', { name: 'Keep going' }).click()
    await button(page, 'Finish early').click()
    await expect(page.getByRole('heading', { level: 2, name: 'Finish now?' })).toBeFocused()
    expect(await buttonsOf(page)).toEqual([
      { text: 'Keep going', primary: true },
      { text: 'Finish now', primary: false },
    ])
    await expectNoSeriousAxe(page)
    await page.locator('section.confirm').getByRole('button', { name: 'Finish now' }).click()
    await expect(h1(page)).toHaveText('Session ended')
  })

  test('Escape keeps meaning "Keep going" in both panels', async ({ page, isMobile }) => {
    test.skip(isMobile === true, 'a phone has no Escape key')
    await intoSegment(page, MAT)
    await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
    for (const name of ['Skip Matrix & Series', 'Finish early']) {
      const opener = button(page, name)
      await opener.click()
      await expect(page.locator('section.confirm')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.locator('section.confirm')).toHaveCount(0)
      await expect(opener).toBeFocused()
      await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
    }
  })

  test('on a small phone the panel’s two buttons fit without scrolling sideways', async ({ page, isMobile }) => {
    test.skip(isMobile !== true, 'the phone engines are where the width matters')
    await page.setViewportSize(SE)
    await intoSegment(page, MAT)
    await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
    await button(page, 'Skip Matrix & Series').tap()
    await expect(page.locator('section.confirm')).toBeVisible()
    await overflow(page, 'the Skip panel at 320 px')
    for (const b of await page.locator('section.confirm button').all()) {
      const box = (await b.boundingBox())!
      expect(box.x, 'inside the screen on the left').toBeGreaterThanOrEqual(0)
      expect(box.x + box.width, 'inside the screen on the right').toBeLessThanOrEqual(SE.width)
      expect(box.height, 'a target of at least 44 px').toBeGreaterThanOrEqual(43.5)
    }
  })
})

test.describe('one primary action per screen: the focus-session start and the results-talk copy button (D27)', () => {
  /** Run once per worker: a simulated earlier session. */
  const sim = (): ReturnType<typeof simulatedSave> => simulatedSave(1)

  test('on the results after the save, the focus-session start and the copy button are plain buttons, and still work', async ({ page }) => {
    await toResults(page)
    await button(page, 'Download save file').click()
    const form = page.locator('[data-section="retest"] [data-focus-form]')
    const start = form.getByRole('button', { name: 'Start a 20-minute focus session' })
    await expect(start).toBeVisible()
    await expect(start).toHaveClass(/hb-btn/)
    await expect(start).not.toHaveClass(/hb-primary/)
    const copy = page.getByTestId('copy-preamble')
    await expect(copy).toBeVisible()
    await expect(copy).toHaveClass(/hb-btn/)
    await expect(copy).not.toHaveClass(/hb-primary/)
    // Neither is among the buttons the screen draws as its primary.
    const primaries = await page.locator('main button.hb-primary').evaluateAll((els) => els.filter((el) => el.getClientRects().length > 0).map((el) => (el.textContent ?? '').trim()))
    expect(primaries).not.toContain('Start a 20-minute focus session')
    expect(primaries).not.toContain(await copy.innerText())
    await expectNoSeriousAxe(page)
    // Pressing it still starts the session on the ticked parts.
    for (const box of await form.getByRole('checkbox').all()) await box.uncheck()
    await form.getByRole('checkbox', { name: /Matrix & Series/ }).check()
    await start.click()
    await expect(h1(page)).toHaveText('Up next: Matrix & Series')
  })

  test('on the start screen of a returning person the focus-session start is a plain button too', async ({ page }) => {
    await toReady(page)
    await loadSave(page, sim().save)
    const focus = page.locator('details.focus')
    await focus.locator('summary').click()
    const start = focus.getByRole('button', { name: 'Start a 20-minute focus session' })
    await expect(start).toBeVisible()
    await expect(start).not.toHaveClass(/hb-primary/)
    // "Begin" is the screen's primary.
    await expect(button(page, 'Begin')).toHaveClass(/hb-primary/)
    await expectNoSeriousAxe(page)
  })
})
