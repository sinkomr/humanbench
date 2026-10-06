/**
 * The unusual uses entry on the dev-only demo route `#/dev/aut` (ROADMAP M6.4; DESIGN §5.4, §8, §10, §13), in Chromium,
 * WebKit and an emulated iPhone 13. The round is run with the test scorer (`?embedder=mock`: no model, no download) and a
 * 5 s clock (`?seconds=5`), so a whole round takes seconds:
 * - the warning "Don't type personal info" and the experimental label are on screen before any typing, and the outside
 *   scoring service is a single sentence with no control;
 * - NO request leaves this machine: every request to a host other than 127.0.0.1 is aborted by the test and none may even be
 *   attempted (not Hugging Face, not the outside service), through a whole round and its results;
 * - ideas are added with Enter, an idea that looks like contact details is not added and says so, an idea is removed, Done or
 *   the end of the clock ends the round once, and the results carry the three labelled measures and the experimental note;
 * - the whole round can be done with the keyboard alone, and the entry starts with focus in the box;
 * - axe: 0 serious or critical issues in light and dark at the start, while the round runs, and on the results; 320 px
 *   reflow and 44 px targets; nothing is stored.
 * The e2e tsconfig has no DOM lib, so page code is passed as strings.
 */

import { expect, test as base, type Locator, type Page } from '@playwright/test'
import { lintText } from '../scripts/language-lint'
import { ENTRY_COPY, EXPERIMENTAL_NOTE, OCSAI_COPY, RESULT_LABELS, SCORER_COPY } from '../src/tasks/aut/copy'
import { demoAutItem } from '../src/tasks/aut/demo'
import { createMockEmbedder } from '../src/tasks/aut/embedder'
import { scoreResponses } from '../src/tasks/aut/run'
import { expectNoAriaAttributeIssues, expectNoSeriousAxe } from './axe'
import { focusIsOnPlainTarget, press as pressOn, tabTo } from './keyboard'
import { expectNoClippedText, expectNoSidewaysScroll, setTextZoomNow } from './layout'

const SEED = 1
const SECONDS = 5
const ITEM = demoAutItem(SEED, SECONDS)
const PAGE_URL = `./#/dev/aut?seed=${SEED}&embedder=mock&seconds=${SECONDS}`
const LONG_URL = `./#/dev/aut?seed=${SEED}&embedder=mock&seconds=600`

/**
 * Every test: requests to any host but 127.0.0.1 are aborted and recorded, and the test fails if one was attempted. The model's
 * host and the outside scoring service would show up here; nothing in this page may so much as try them.
 */
const test = base.extend<{ offsite: string[] }>({
  offsite: [
    async ({ page }, use) => {
      const attempts: string[] = []
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url())
        if (/^https?:$/.test(url.protocol) && url.hostname !== '127.0.0.1') {
          attempts.push(url.href)
          await route.abort()
        } else await route.continue()
      })
      await use(attempts)
      expect(attempts, 'requests the page tried to send off this machine').toEqual([])
    },
    { auto: true },
  ],
})

const box = (page: Page): Locator => page.getByRole('textbox', { name: ENTRY_COPY.inputLabel, exact: true })
const startButton = (page: Page): Locator => page.getByRole('button', { name: ENTRY_COPY.start, exact: true })
const addButton = (page: Page): Locator => page.getByRole('button', { name: ENTRY_COPY.add, exact: true })
const doneButton = (page: Page): Locator => page.getByRole('button', { name: ENTRY_COPY.done, exact: true })
const removeButton = (page: Page, idea: string): Locator => page.getByRole('button', { name: `${ENTRY_COPY.remove} ${idea}`, exact: true })
const entry = (page: Page): Locator => page.locator('section.hb-render.aut')
const ideaTexts = (page: Page): Locator => page.locator('section.hb-render.aut .idea-text')

async function open(page: Page, url = PAGE_URL): Promise<void> {
  await page.goto('about:blank')
  await page.goto(url)
  await expect(page.getByRole('heading', { level: 1, name: 'Unusual uses entry demo (development only)', exact: true })).toBeVisible()
  await expect(entry(page)).toBeVisible()
  await expect(startButton(page)).toBeEnabled()
}

/** Press Start and wait for the round to be running (the first frame after the press). */
async function begin(page: Page): Promise<void> {
  await startButton(page).click()
  await expect(page.locator('section.hb-render.aut[data-phase="running"]')).toBeVisible()
}

async function addIdea(page: Page, text: string): Promise<void> {
  await box(page).fill(text)
  await page.keyboard.press('Enter')
}

/** The three measures of a finished round, as the page shows them. */
async function measures(page: Page): Promise<{ count: string; distance: string; groups: string }> {
  return {
    count: (await page.getByTestId('aut-count').textContent()) ?? '',
    distance: (await page.getByTestId('aut-distance').textContent()) ?? '',
    groups: (await page.getByTestId('aut-groups').textContent()) ?? '',
  }
}

/** What the mock scorer gives for these ideas (it is the same code in Node as in the page). */
async function expectedMeasures(ideas: string[]): Promise<{ count: string; distance: string; groups: string }> {
  const score = await scoreResponses(createMockEmbedder(), ITEM.spec.object, ideas)
  return { count: String(score.fluency), distance: score.originality === null ? 'Not available' : score.originality.toFixed(2), groups: String(score.flexibility) }
}

const IDEAS = ['prop open a door', 'crush it into red pigment', 'bookend for paperbacks', 'garden edging']

test.describe('before the round', () => {
  test('shows the warning, the experimental label and the object before any typing, and nothing to type into', async ({ page }) => {
    await open(page)
    await expect(page.getByText("Don't type personal info", { exact: true })).toBeVisible()
    await expect(page.getByText(ENTRY_COPY.warningBody, { exact: true })).toBeVisible()
    await expect(entry(page).getByText(ENTRY_COPY.experimental, { exact: true })).toBeVisible()
    await expect(page.getByText(ENTRY_COPY.instructions, { exact: true })).toBeVisible()
    await expect(entry(page).locator('.object-word')).toHaveText(ITEM.spec.object)
    await expect(page.getByTestId('aut-practice-id')).toHaveText(`Practice id demo:aut:${SEED}`)
    await expect(page.getByRole('textbox')).toHaveCount(0)
    await expect(page.getByRole('timer')).toHaveCount(0)
    await expect(entry(page)).toHaveAccessibleName(/^Unusual uses\s+Experimental$/)
  })

  test('says where scoring runs, and the outside scoring service is a notice with no control', async ({ page }) => {
    await open(page)
    await expect(page.getByText(SCORER_COPY.note, { exact: true })).toBeVisible()
    await expect(page.getByTestId('aut-scorer-state')).toHaveText(SCORER_COPY.mock)
    const notice = page.getByTestId('ocsai-note')
    await expect(notice).toHaveText(OCSAI_COPY.off)
    expect(await notice.locator('input, button, select, textarea, [role="switch"], [disabled]').count()).toBe(0)
    await expect(page.getByTestId('ocsai-consent')).toHaveCount(0)
    await expect(page.getByRole('checkbox')).toHaveCount(0)
  })

  test('without the mock the page offers a button to load the scorer, and does not load it by itself', async ({ page }) => {
    await open(page, `./#/dev/aut?seed=${SEED}&seconds=${SECONDS}`)
    await expect(page.getByRole('button', { name: SCORER_COPY.load, exact: true })).toBeVisible()
    await page.waitForTimeout(500)
    await expect(page.getByTestId('aut-scorer-state')).toHaveCount(0)
  })
})

test.describe('a round', () => {
  test('starts with the box focused, counts down, adds ideas with Enter and shows them in order', async ({ page }) => {
    await open(page, LONG_URL)
    await begin(page)
    await expect(box(page)).toBeFocused()
    await expect(page.getByRole('timer')).toContainText('Time left')
    await expect(page.getByRole('timer')).toContainText(/^Time left\s*(9:5\d|10:00)$/)
    await addIdea(page, '  prop open a door ')
    await addIdea(page, 'garden edging')
    await expect(ideaTexts(page)).toHaveText(['prop open a door', 'garden edging'])
    await expect(box(page)).toHaveValue('')
    await expect(box(page)).toBeFocused()
    await expect(page.getByText('Your ideas (2)', { exact: true })).toBeVisible()
    await expect(startButton(page)).toHaveCount(0)
  })

  test('does not add an idea that looks like contact details, says so, and keeps the text to edit', async ({ page }) => {
    await open(page, LONG_URL)
    await begin(page)
    await addIdea(page, 'mail me at jo.smith@example.com')
    await expect(ideaTexts(page)).toHaveCount(0)
    await expect(page.getByText(ENTRY_COPY.personalInfoNote, { exact: true })).toBeVisible()
    await expect(box(page)).toHaveAttribute('aria-invalid', 'true')
    await expect(box(page)).toHaveAccessibleDescription(ENTRY_COPY.personalInfoNote)
    await expect(box(page)).toHaveValue('mail me at jo.smith@example.com')
    await box(page).fill('mail me')
    await expect(page.getByText(ENTRY_COPY.personalInfoNote, { exact: true })).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect(ideaTexts(page)).toHaveText(['mail me'])
  })

  test('removes an idea, and Done ends the round with the three measures, the experimental note and each idea', async ({ page }) => {
    await open(page, LONG_URL)
    await begin(page)
    for (const idea of IDEAS) await addIdea(page, idea)
    await removeButton(page, IDEAS[1] as string).click()
    const kept = [IDEAS[0] as string, IDEAS[2] as string, IDEAS[3] as string]
    await expect(ideaTexts(page)).toHaveText(kept)
    await doneButton(page).click()
    const results = page.getByTestId('aut-results')
    await expect(results).toBeVisible()
    await expect(results.getByTestId('aut-count')).toBeVisible()
    for (const label of Object.values(RESULT_LABELS)) await expect(results.getByText(label, { exact: true })).toBeVisible()
    expect(await measures(page)).toEqual(await expectedMeasures(kept))
    await expect(page.getByTestId('aut-experimental')).toHaveText(EXPERIMENTAL_NOTE)
    await expect(results.locator('.idea-text')).toHaveText(kept)
    await expect(page.locator('section.hb-render.aut .hb-status')).toHaveText(ENTRY_COPY.finished)
    // the entry is locked: no box, no buttons that change the list
    await expect(box(page)).toHaveCount(0)
    await expect(doneButton(page)).toHaveCount(0)
    await expect(page.locator('section.hb-render.aut button.remove')).toHaveCount(0)
    await expect(page.getByTestId('aut-results')).toHaveCount(1)
  })

  test('the end of the clock ends the round once, with what was added, and does not keep what was only typed', async ({ page }) => {
    await open(page)
    await begin(page)
    await addIdea(page, 'prop open a door')
    await addIdea(page, 'garden edging')
    await box(page).fill('typed but not added')
    await expect(page.locator('section.hb-render.aut .hb-status')).toHaveText(ENTRY_COPY.timeUp, { timeout: 15_000 })
    await expect(page.getByTestId('aut-count')).toBeVisible()
    expect(await measures(page)).toEqual(await expectedMeasures(['prop open a door', 'garden edging']))
    await expect(page.getByTestId('aut-results').locator('.idea-text')).toHaveText(['prop open a door', 'garden edging'])
    await expect(page.getByRole('timer')).toContainText('0:00')
    await page.waitForTimeout(500)
    await expect(page.getByTestId('aut-results')).toHaveCount(1)
  })

  test('a round ended before the scorer is loaded waits for it, with the experimental note, and sends nothing', async ({ page }) => {
    await open(page, `./#/dev/aut?seed=${SEED}&seconds=600`)
    await begin(page)
    await addIdea(page, 'prop open a door')
    await doneButton(page).click()
    await expect(page.getByTestId('aut-waiting')).toHaveText(SCORER_COPY.waiting)
    await expect(page.getByTestId('aut-experimental')).toHaveText(EXPERIMENTAL_NOTE)
    await expect(page.getByTestId('aut-count')).toHaveCount(0)
    await expect(page.getByRole('button', { name: SCORER_COPY.load, exact: true })).toBeVisible()
    await page.waitForTimeout(300)
  })

  test('another object starts a fresh page of the demo', async ({ page }) => {
    await open(page, LONG_URL)
    await begin(page)
    await addIdea(page, 'garden edging')
    await doneButton(page).click()
    await expect(page.getByTestId('aut-count')).toBeVisible()
    await page.getByTestId('aut-another').click()
    await expect(page.getByTestId('aut-results')).toHaveCount(0)
    await expect(page.getByTestId('aut-practice-id')).toHaveText(`Practice id demo:aut:${SEED + 1}`)
    await expect(startButton(page)).toBeEnabled()
    await expect(page.getByRole('textbox')).toHaveCount(0)
  })
})

test.describe('keyboard, storage, network and language', () => {
  test('the whole round can be done with the keyboard alone', async ({ page, isMobile, browserName }) => {
    test.skip(isMobile === true, 'keyboard use is for desktop browsers')
    await open(page, LONG_URL)
    await tabTo(page, startButton(page), browserName)
    await page.keyboard.press('Enter')
    await expect(page.locator('section.hb-render.aut[data-phase="running"]')).toBeVisible()
    await expect(box(page)).toBeFocused()
    for (const idea of IDEAS.slice(0, 3)) {
      await page.keyboard.type(idea)
      await page.keyboard.press('Enter')
    }
    await expect(ideaTexts(page)).toHaveText(IDEAS.slice(0, 3))
    await pressOn(page, removeButton(page, IDEAS[1] as string), browserName)
    await expect(ideaTexts(page)).toHaveText([IDEAS[0] as string, IDEAS[2] as string])
    await expect(box(page)).toBeFocused()
    await pressOn(page, doneButton(page), browserName)
    await expect(page.getByTestId('aut-count')).toBeVisible()
    expect(await measures(page)).toEqual(await expectedMeasures([IDEAS[0] as string, IDEAS[2] as string]))
    // focus went to the list of ideas, which is a plain target (nothing to operate), not lost to the page
    expect(await focusIsOnPlainTarget(page)).toBe(true)
    await expect(page.locator('section.hb-render.aut .ideas-title')).toBeFocused()
  })

  test('sends nothing, stores nothing, and the rendered page passes the language lint (A13) in every state', async ({ page, offsite }) => {
    const requests: string[] = []
    page.on('request', (r) => requests.push(r.url()))
    await open(page, LONG_URL)
    const states: string[] = [await page.content()]
    const texts: string[] = [await page.locator('body').innerText()]
    await begin(page)
    await addIdea(page, 'mail me at jo.smith@example.com')
    await addIdea(page, 'prop open a door')
    states.push(await page.content())
    texts.push(await page.locator('body').innerText())
    await doneButton(page).click()
    await expect(page.getByTestId('aut-count')).toBeVisible()
    states.push(await page.content())
    texts.push(await page.locator('body').innerText())
    await page.waitForTimeout(300)
    const snapshot = await page.evaluate(`(async () => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie, caches: typeof caches === 'undefined' ? 0 : (await caches.keys()).length }))()`)
    expect(snapshot).toEqual({ local: 0, session: 0, cookie: '', caches: 0 })
    expect(offsite).toEqual([])
    const hosts = new Set(requests.filter((u) => /^https?:/.test(u)).map((u) => new URL(u).hostname))
    expect([...hosts]).toEqual(['127.0.0.1'])
    for (const html of states) {
      // no address of the model's host or the outside service anywhere in the page (a test id may be named for the notice)
      expect(html).not.toMatch(/huggingface\.co|openscoring/i)
      expect(lintText(html, 'rendered.html')).toEqual([])
    }
    // and the outside service is not named to the person (the model is, as the note says)
    for (const text of texts) expect(text).not.toMatch(/ocsai|openscoring/i)
  })

  test('does not keep an idea that looks like contact details anywhere in the page after the round', async ({ page }) => {
    await open(page, LONG_URL)
    await begin(page)
    await addIdea(page, 'call 555 123 4567')
    await addIdea(page, 'prop open a door')
    await box(page).fill('')
    await doneButton(page).click()
    await expect(page.getByTestId('aut-count')).toBeVisible()
    expect(await page.content()).not.toContain('555 123 4567')
  })
})

test.describe('accessibility and layout', () => {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`has no serious or critical axe violations at the start, while the round runs, with the note and on the results (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme })
      await open(page, LONG_URL)
      await expectNoSeriousAxe(page)
      await expectNoAriaAttributeIssues(page)
      await begin(page)
      await addIdea(page, 'prop open a door')
      await addIdea(page, 'garden edging')
      await expectNoSeriousAxe(page)
      await expectNoAriaAttributeIssues(page)
      await addIdea(page, 'ask jo.smith@example.com')
      await expect(box(page)).toHaveAttribute('aria-invalid', 'true')
      await expectNoSeriousAxe(page)
      await expectNoAriaAttributeIssues(page)
      await box(page).fill('')
      await doneButton(page).click()
      await expect(page.getByTestId('aut-count')).toBeVisible()
      await expectNoSeriousAxe(page)
      await expectNoAriaAttributeIssues(page)
    })
  }

  test('reflows at 320 px with no sideways scroll or clipped text at the start, while running and on the results, and keeps its 44 px targets', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await open(page, LONG_URL)
    const fits = async (where: string): Promise<void> => {
      await expectNoSidewaysScroll(page, `${where} at 320px`)
      await expectNoClippedText(page, `${where} at 320px`)
      await expectNoSeriousAxe(page)
    }
    await fits('the start')
    expect((await startButton(page).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43)
    await begin(page)
    await addIdea(page, 'a very long unusual use that goes on and on and on for many words so it has to wrap')
    await addIdea(page, 'garden edging')
    await fits('the round')
    for (const b of [addButton(page), doneButton(page), removeButton(page, 'garden edging')]) expect((await b.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43)
    expect((await box(page).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43)
    await doneButton(page).click()
    await expect(page.getByTestId('aut-count')).toBeVisible()
    await fits('the results')
  })

  test('fits with the text at 200% at the start, while running and on the results', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await open(page, LONG_URL)
    await setTextZoomNow(page, 200)
    await expectNoSidewaysScroll(page, 'the start at 200% text')
    await expectNoClippedText(page, 'the start at 200% text')
    await begin(page)
    await addIdea(page, 'prop open a door')
    await expectNoSidewaysScroll(page, 'the round at 200% text')
    await expectNoClippedText(page, 'the round at 200% text')
    await doneButton(page).click()
    await expect(page.getByTestId('aut-count')).toBeVisible()
    await expectNoSidewaysScroll(page, 'the results at 200% text')
    await expectNoClippedText(page, 'the results at 200% text')
    await expectNoSeriousAxe(page)
  })

  test('nothing moves under prefers-reduced-motion while the round runs', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await open(page, LONG_URL)
    await begin(page)
    await addIdea(page, 'prop open a door')
    const running = await page.evaluate<string[]>(`document.getAnimations().filter((a) => a.playState === 'running' || a.playState === 'pending').map((a) => a.animationName || a.transitionProperty || 'animation')`)
    expect(running).toEqual([])
  })
})

base.describe('the scorer download', () => {
  // The one test that may try an outside host, and only the model's: it is the page's single request, made after a press.
  base('is the only request the page makes: with the network cut, a press on the button ends in an error that can be retried', async ({ page }) => {
    const attempts: string[] = []
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (/^https?:$/.test(url.protocol) && url.hostname !== '127.0.0.1') {
        attempts.push(url.hostname)
        await route.abort()
      } else await route.continue()
    })
    await open(page, `./#/dev/aut?seed=${SEED}&seconds=${SECONDS}`)
    await page.waitForTimeout(500)
    expect(attempts, 'nothing is requested before the press').toEqual([])
    await page.getByRole('button', { name: SCORER_COPY.load, exact: true }).click()
    await expect(page.getByTestId('aut-scorer-error')).toHaveText(SCORER_COPY.failed, { timeout: 60_000 })
    expect(attempts.length).toBeGreaterThan(0)
    expect(new Set(attempts), 'the model host is the only one tried').toEqual(new Set(['huggingface.co']))
    await expect(page.getByRole('button', { name: SCORER_COPY.retry, exact: true })).toBeVisible()
    await expectNoSeriousAxe(page)
  })
})
