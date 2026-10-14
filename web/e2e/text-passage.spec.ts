/// <reference lib="dom" />
/**
 * Served passages in real browsers (ROADMAP M3.11 phase 2; DESIGN §3 row 4, §7.4, §10, §11.2, §13, R-5.6.x,
 * R-11.1; owner decision 2026-10-12: the passage stays visible while its questions are answered), in
 * Chromium, WebKit and an emulated iPhone:
 *
 * - the passage screen by itself (`#/dev/text-passage`, made-up passages): axe, the names a screen reader
 *   hears, the keyboard alone, side by side on a wide window and held above the question on a narrow one
 *   (the question is reached without losing the passage), the passage kept in place and scrolled where it was
 *   across its questions, a phone's width and a wide font, text at 200%, a short window, and the server's
 *   text shown as text, never as markup;
 * - the session with a fake project (`fake-server.ts`): a pool without passages gives the six-part session
 *   whether or not the page asks for Reading Comprehension, and a pool with them gives the part: two
 *   passages, every question of each, the confidence scale, "Report a problem", the source line, and the skill on the
 *   profile.
 *
 * `e2e-db/` runs the same session against the real local database.
 */

import { expect, test, type Page } from '@playwright/test'
import { DEMO_PASSAGES } from '../src/render/text/demo-passage'
import { expectNoSeriousAxe } from './axe'
import { FakeServer, SERVER_QUERY, passageWire, seriesWire, type Wire } from './fake-server'
import { agreeGate, button, h1 } from './flow'
import { expectNoClippedText, expectNoSidewaysScroll, REFLOW_VIEWPORT, ZOOM_200_VIEWPORT, setTextZoomNow } from './layout'
import { openTextPassage } from './routes'
import { expectWideFont, useWideFont } from './wide-font'

const LAYOUT = '.passage-layout'
const PASSAGE = 'section.passage'
const QUESTION = 'div.hb-render.text-mc'
const WIDE = { width: 1280, height: 800 }
const PHONE = { width: 390, height: 844 }

const passage = (page: Page) => page.getByRole('region', { name: 'Passage' })

interface Box {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
}
const boxOf = (page: Page, selector: string): Promise<Box> =>
  page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
  })

/** How much of the passage's frame is inside the window, in px. */
const passageInView = (page: Page): Promise<number> =>
  page.locator(PASSAGE).evaluate((el) => {
    const r = el.getBoundingClientRect()
    return Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0))
  })

test.describe('the passage screen (made-up passages)', () => {
  test('has no accessibility findings, wide and narrow, in light and dark, with an option chosen and the whole passage shown', async ({ page }) => {
    for (const viewport of [WIDE, PHONE]) {
      await page.setViewportSize(viewport)
      for (const item of [0, 1, 2]) {
        await openTextPassage(page, item)
        await expectNoSeriousAxe(page)
      }
    }
    await page.getByRole('radio').nth(1).check()
    await page.getByRole('button', { name: 'Show the whole passage' }).click()
    await expectNoSeriousAxe(page)
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await openTextPassage(page, 1, 1)
    await page.getByRole('radio').nth(2).check()
    await expectNoSeriousAxe(page)
    await page.setViewportSize(WIDE)
    await expectNoSeriousAxe(page)
  })

  test('is a named region with a heading before the question; the question is a group named by its words, and says which of the passage\'s questions it is', async ({ page }) => {
    await openTextPassage(page, 0, 1)
    const demo = DEMO_PASSAGES[0]!
    await expect(passage(page).getByRole('heading', { level: 2, name: 'Passage' })).toBeVisible()
    await expect(page.locator(`${PASSAGE} .text p`)).toHaveText([...demo.media.passage])
    await expect(page.getByRole('group', { name: demo.questions[1]!.stem })).toBeVisible()
    await expect(page.locator('[data-set-position]')).toHaveText('Question 2 of 4 about this passage')
    await expect(page.getByRole('radio')).toHaveCount(5)
    // the passage comes before the question in the document: a screen reader meets it first
    expect(await page.evaluate(([p, q]) => Boolean(document.querySelector(p!)!.compareDocumentPosition(document.querySelector(q!)!) & Node.DOCUMENT_POSITION_FOLLOWING), [PASSAGE, QUESTION])).toBe(true)
    // one h1, and the passage's heading under it
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  })

  test('shows the source line with the passage, small and quiet, and none when the passage has none', async ({ page }) => {
    await openTextPassage(page, 0)
    const line = page.locator(`${PASSAGE} .attribution`)
    await expect(line).toContainText(DEMO_PASSAGES[0]!.media.attribution!)
    const sizes = await page.evaluate(([p]) => {
      const text = document.querySelector(`${p} .text p`)!
      const source = document.querySelector(`${p} .attribution`)!
      return { text: parseFloat(getComputedStyle(text).fontSize), source: parseFloat(getComputedStyle(source).fontSize), below: source.getBoundingClientRect().top >= text.getBoundingClientRect().bottom }
    }, [PASSAGE])
    expect(sizes.source).toBeLessThan(sizes.text)
    expect(sizes.source).toBeGreaterThanOrEqual(12)
    await openTextPassage(page, 2)
    await expect(page.locator(`${PASSAGE} .attribution`)).toHaveCount(0)
  })

  test('shows the server\'s text as text: markup in the passage, its title and its source line makes no element and runs nothing', async ({ page }) => {
    await openTextPassage(page, 1)
    await expect(page.locator(`${PASSAGE} .title`)).toContainText('<b>Snorkweavers</b>')
    await expect(page.locator(`${PASSAGE} .text`)).toContainText('<script>window.__hb_text_passage_injected = true</script>')
    await expect(page.locator(`${PASSAGE} .attribution`)).toContainText('<img src=x onerror=')
    await expect(page.locator(`${PASSAGE} .attribution`)).toContainText('https://example.invalid/')
    expect(await page.locator(`${LAYOUT} script, ${LAYOUT} img, ${LAYOUT} b, ${LAYOUT} i, ${LAYOUT} a`).count()).toBe(0)
    expect(await page.evaluate(() => (window as unknown as { __hb_text_passage_injected?: boolean }).__hb_text_passage_injected)).toBeUndefined()
  })

  test('on a wide window the passage is beside the question, both in view, and a long passage scrolls inside its own frame', async ({ page, isMobile }) => {
    test.skip(isMobile, 'a wide window: desktop engines')
    await page.setViewportSize(WIDE)
    await openTextPassage(page, 1)
    const p = await boxOf(page, PASSAGE)
    const q = await boxOf(page, QUESTION)
    expect(p.right).toBeLessThanOrEqual(q.left)
    expect(Math.abs(p.top - q.top)).toBeLessThan(120)
    expect(p.bottom).toBeLessThanOrEqual(WIDE.height)
    // the frame is no taller than the window, and the text in it is: it scrolls inside
    const scroll = await page.locator(PASSAGE).evaluate((el) => ({ client: el.clientHeight, content: el.scrollHeight }))
    expect(scroll.content).toBeGreaterThan(scroll.client)
    await expect(page.getByRole('button', { name: 'Show the whole passage' })).toBeHidden()
    await expectNoSidewaysScroll(page, 'the passage beside the question')
    // with the page scrolled to the Confirm button the passage is still in view
    await page.locator(QUESTION).getByRole('button', { name: 'Confirm', exact: true }).scrollIntoViewIfNeeded()
    expect(await passageInView(page)).toBeGreaterThan(200)
  })

  test('on a phone the passage is above the question and stays in view while the page scrolls to the options and the Confirm button', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await openTextPassage(page, 1)
    const p = await boxOf(page, PASSAGE)
    const q = await boxOf(page, QUESTION)
    expect(p.bottom).toBeLessThanOrEqual(q.top + 1)
    // held to a part of the window, with the text scrolling inside it
    const frame = await page.locator(PASSAGE).evaluate((el) => ({ h: el.getBoundingClientRect().height, client: el.clientHeight, content: el.scrollHeight, position: getComputedStyle(el).position }))
    expect(frame.position).toBe('sticky')
    expect(frame.h).toBeLessThanOrEqual(PHONE.height * 0.45)
    expect(frame.h).toBeGreaterThanOrEqual(PHONE.height * 0.25)
    expect(frame.content).toBeGreaterThan(frame.client)
    // the question is reached without losing the passage: scroll to the last option and to Confirm
    const confirm = page.locator(QUESTION).getByRole('button', { name: 'Confirm', exact: true })
    await page.getByRole('radio').last().scrollIntoViewIfNeeded()
    expect(await passageInView(page)).toBeGreaterThan(PHONE.height * 0.25)
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await expect(confirm).toBeInViewport()
    expect(await passageInView(page)).toBeGreaterThan(PHONE.height * 0.25)
    // and what is under the passage is not what the passage covers: the button is below the frame
    const after = await boxOf(page, PASSAGE)
    const c = await confirm.evaluate((el) => el.getBoundingClientRect().top)
    expect(c).toBeGreaterThanOrEqual(after.bottom - 1)
    await expectNoSidewaysScroll(page, 'the passage above the question')
  })

  test('on a phone a button shows the whole passage and puts the limit back', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await openTextPassage(page, 1)
    const held = await page.locator(PASSAGE).evaluate((el) => el.getBoundingClientRect().height)
    const more = page.getByRole('button', { name: 'Show the whole passage' })
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    await more.click()
    const less = page.getByRole('button', { name: 'Keep the passage small' })
    await expect(less).toHaveAttribute('aria-expanded', 'true')
    const whole = await page.locator(PASSAGE).evaluate((el) => ({ h: el.getBoundingClientRect().height, client: el.clientHeight, content: el.scrollHeight, position: getComputedStyle(el).position }))
    expect(whole.h).toBeGreaterThan(held * 1.5)
    expect(whole.content).toBeLessThanOrEqual(whole.client + 1)
    expect(whole.position).not.toBe('sticky')
    await expectNoSidewaysScroll(page, 'the whole passage')
    await less.click()
    expect(await page.locator(PASSAGE).evaluate((el) => el.getBoundingClientRect().height)).toBeLessThanOrEqual(held + 1)
  })

  test('keeps the passage in place across its questions: the same frame, scrolled where it was left', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await openTextPassage(page, 1)
    await page.locator(PASSAGE).evaluate((el) => {
      el.scrollTop = 180
      ;(el as unknown as { mark: string }).mark = 'kept'
    })
    await page.getByRole('radio').nth(1).check()
    await page.locator(QUESTION).getByRole('button', { name: 'Confirm', exact: true }).click()
    await page.getByTestId('text-passage-next').click()
    await expect(page.locator('[data-set-position]')).toHaveText('Question 2 of 3 about this passage')
    await expect(page.getByRole('radio').first()).toBeEnabled()
    const kept = await page.locator(PASSAGE).evaluate((el) => ({ mark: (el as unknown as { mark?: string }).mark, top: el.scrollTop }))
    expect(kept).toEqual({ mark: 'kept', top: 180 })
    // the next passage is a new one, from its top
    for (const q of [1, 2]) {
      await page.getByRole('radio').nth(q).check()
      await page.locator(QUESTION).getByRole('button', { name: 'Confirm', exact: true }).click()
      await page.getByTestId('text-passage-next').click()
      await expect(page.getByRole('radio').first()).toBeEnabled()
    }
    await expect(page.locator('[data-set-position]')).toHaveText('Question 1 of 3 about this passage')
    expect(await page.locator(PASSAGE).evaluate((el) => ({ mark: (el as unknown as { mark?: string }).mark, top: el.scrollTop }))).toEqual({ top: 0 })
  })

  test('is read and answered with the keyboard alone: the passage takes focus and scrolls, Tab goes on to the options, a digit picks, Enter confirms', async ({ page, isMobile }) => {
    test.skip(isMobile, 'a hardware keyboard: desktop engines')
    await page.setViewportSize(WIDE)
    await openTextPassage(page, 1)
    await passage(page).focus()
    await expect(passage(page)).toBeFocused()
    const ring = await page.locator(PASSAGE).evaluate((el) => ({ style: getComputedStyle(el).outlineStyle, width: parseFloat(getComputedStyle(el).outlineWidth) }))
    expect(ring.style).toBe('solid')
    expect(ring.width).toBeGreaterThanOrEqual(3)
    await page.keyboard.press('End')
    await expect.poll(() => page.locator(PASSAGE).evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
    const radios = page.getByRole('radio')
    await radios.first().focus()
    await page.keyboard.press('3')
    await expect(radios.nth(2)).toBeChecked()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('text-passage-feedback')).toHaveAttribute('data-response', '2')
  })

  for (const width of [320, 360]) {
    test(`fits ${width} px in a wide font: a word with no place to break and a long source line wrap inside the frame`, async ({ page }) => {
      await useWideFont(page)
      await page.setViewportSize({ width, height: 800 })
      for (const item of [0, 1, 2]) {
        await openTextPassage(page, item)
        await expectWideFont(page)
        await expectNoSidewaysScroll(page, `passage ${item} at ${width} px`)
        await expectNoClippedText(page, `passage ${item} at ${width} px`, LAYOUT)
        await page.getByRole('button', { name: 'Show the whole passage' }).click()
        await expectNoSidewaysScroll(page, `the whole passage ${item} at ${width} px`)
      }
      const boxes = await page.locator(`${QUESTION} label.option`).evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ h: r.height, right: r.right })))
      for (const b of boxes) {
        expect(b.h).toBeGreaterThanOrEqual(44)
        expect(b.right).toBeLessThanOrEqual(width)
      }
      // the button of the passage is a target of 44 px too
      expect(await page.getByRole('button', { name: 'Keep the passage small' }).evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
    })
  }

  test('fits a phone\'s width with the text at 200%, and can be answered', async ({ page }) => {
    await page.setViewportSize(REFLOW_VIEWPORT)
    await openTextPassage(page, 1)
    await setTextZoomNow(page, 200)
    await expectNoSidewaysScroll(page, 'the passage at 200%')
    await expectNoClippedText(page, 'the passage at 200%', LAYOUT)
    await page.getByRole('radio').nth(1).check()
    await page.locator(QUESTION).getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(page.getByTestId('text-passage-feedback')).toBeVisible()
    await page.getByRole('button', { name: 'Show the whole passage' }).click()
    await expectNoSidewaysScroll(page, 'the whole passage at 200%')
  })

  test('in a short window (a browser zoomed to 200%, a phone on its side) nothing is held: the passage is above the question, whole, with no button', async ({ page }) => {
    await page.setViewportSize(ZOOM_200_VIEWPORT)
    await openTextPassage(page, 1)
    const frame = await page.locator(PASSAGE).evaluate((el) => ({ client: el.clientHeight, content: el.scrollHeight, position: getComputedStyle(el).position }))
    expect(frame.position).not.toBe('sticky')
    expect(frame.content).toBeLessThanOrEqual(frame.client + 1)
    await expect(page.getByRole('button', { name: 'Show the whole passage' })).toBeHidden()
    const p = await boxOf(page, PASSAGE)
    const q = await boxOf(page, QUESTION)
    expect(p.bottom).toBeLessThanOrEqual(q.top + 1)
    await expectNoSidewaysScroll(page, 'the passage in a short window')
    await expectNoSeriousAxe(page)
  })

  test('accepts a choice only once the question is on screen, and reports that frame', async ({ page }) => {
    await openTextPassage(page, 0)
    expect(Number(await page.getByTestId('text-passage-onset').getAttribute('data-onset'))).toBeGreaterThan(0)
  })
})

// ------------------------------------------------------------------------------ the session

/** A pool of made-up passages: the questions of each one after the other, as the server serves a set. */
function passagePool(passages: readonly number[]): Wire[] {
  const out: Wire[] = []
  for (const [k, p] of passages.entries()) {
    const demo = DEMO_PASSAGES[p]!
    for (let q = 0; q < demo.questions.length; q++) out.push(passageWire(out.length + 1, `i:tst:rc:e2e-p${k + 1}-q${q + 1}`, demo, q))
  }
  return out
}

async function toReadyOnline(page: Page, query: string): Promise<void> {
  await page.goto(`./${query}`)
  await button(page, 'Start').click()
  await agreeGate(page)
  await page.getByRole('checkbox', { name: /honour code/ }).check()
  await button(page, 'Continue').click()
  await expect(button(page, 'Continue')).toBeEnabled({ timeout: 20_000 })
  await button(page, 'Continue').click()
  await expect(h1(page)).toHaveText('Ready when you are')
}

async function pastBreak(page: Page): Promise<void> {
  await expect(h1(page)).toHaveText(/^(Up next: |Time for a break\?|Session )/, { timeout: 20_000 })
  if ((await h1(page).textContent()) === 'Time for a break?') await button(page, 'Keep going').click()
}

async function skipPart(page: Page): Promise<void> {
  await button(page, 'Skip this part').click()
  await page.locator('section.confirm').getByRole('button', { name: /^Skip / }).click()
}

/** Skips the parts before Reading Comprehension and stops on its "Up next" screen. */
async function toReading(page: Page): Promise<void> {
  await button(page, 'Begin').click()
  for (const part of ['Reaction Time', 'Matrix & Series', 'Spatial']) {
    await pastBreak(page)
    await expect(h1(page)).toHaveText(`Up next: ${part}`)
    await skipPart(page)
  }
  await pastBreak(page)
  await expect(h1(page)).toHaveText('Up next: Reading Comprehension')
}

/** Answer the passage question on screen with option `index`, set the optional confidence scale on every other one, and confirm: one press. */
async function answerQuestion(page: Page, index = 0): Promise<void> {
  const radio = page.locator(`${QUESTION} .options input[type="radio"]`).nth(index)
  await expect(radio).toBeEnabled()
  await radio.check()
  const points = page.locator(`${QUESTION} fieldset[data-confidence] input[type="radio"]`)
  const name = (await points.first().getAttribute('name')) ?? ''
  if (index % 2 === 0) await points.nth(3).check()
  await page.locator(QUESTION).getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.locator(`input[name="${name}"]`)).toHaveCount(0)
}

const axesAsked = (server: FakeServer): string[] => server.of('next_item').map((c) => (c.body.p_axes as string[]).join('+'))
const READING_QUERY = `${SERVER_QUERY}&hb_text=RC`

test.describe('a pool without passages gives the six-part session', () => {
  test('a page that asks for Reading Comprehension: one question to the server, and then the same six parts with nothing said', async ({ page }) => {
    const server = new FakeServer({ pools: { MAT: [seriesWire(1)] } })
    await server.attach(page)
    await toReadyOnline(page, READING_QUERY)
    await expect(page.locator('main')).toContainText('Up to seven short parts, about 40 minutes.')
    await button(page, 'Begin').click()
    const seen: string[] = []
    for (let i = 0; i < 6; i++) {
      await pastBreak(page)
      await expect(h1(page)).toHaveText(/^Up next: /)
      seen.push((await h1(page).textContent())!.replace('Up next: ', ''))
      await expect(page.locator('header .status').first()).not.toContainText(/Reading Comprehension/)
      await skipPart(page)
    }
    expect(seen).toEqual(['Reaction Time', 'Matrix & Series', 'Spatial', 'Working Memory', 'Quantitative Reasoning', 'Processing & Reading Speed'])
    await expect(h1(page)).toHaveText(/^Session /, { timeout: 20_000 })
    expect(axesAsked(server)).toEqual(['RC'])
    expect(server.served).toEqual([])
    await expect(page.locator('body')).not.toContainText(/Reading Comprehension skipped|cannot be shown/)
  })
})

test.describe('a pool with made-up passages', () => {
  test('runs the part: "Up next", two passages with every question of each beside its passage, the confidence scale, a report, and the skill on the profile', async ({ page }) => {
    const pool = passagePool([0, 2, 1])
    const server = new FakeServer({ pools: { RC: pool }, eap: { RC: { mean: 0.2, sd: 0.6, n: 7 } } })
    await server.attach(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await toReadyOnline(page, READING_QUERY)
    await toReading(page)
    await expect(page.locator('main')).toContainText('About 9 minutes.')
    await expect(page.locator('main')).toContainText('The passage stays on screen while you answer, so you can look back at it.')
    await expectNoSeriousAxe(page)
    expect(axesAsked(server)).toEqual(['RC']) // asked once, before the part was announced
    await button(page, 'Start').click()

    // the first question: the passage with its source line, and the question beside or under it
    const demo = DEMO_PASSAGES[0]!
    await expect(h1(page)).toHaveText('Reading Comprehension')
    await expect(passage(page)).toBeVisible()
    await expect(page.locator(`${PASSAGE} .text p`)).toHaveText([...demo.media.passage])
    await expect(page.locator(`${PASSAGE} .attribution`)).toContainText(demo.media.attribution!)
    await expect(page.locator(`${QUESTION} fieldset:not([data-confidence]) > legend`)).toHaveText(demo.questions[0]!.stem)
    await expect(page.locator('[data-set-position]')).toHaveText('Question 1 of 4 about this passage')
    // the question's timer is with the question, beside or under the passage: the time left, as m:ss (owner feedback 2026-10-13)
    const timer = page.locator(".item-region [data-item-timer]").getByRole('timer')
    await expect(timer).toBeVisible()
    await expect(timer).toHaveText(/^\d+:\d\d$/)
    await expect(timer).toHaveAccessibleName(/^Time left for this question: /)
    await expectNoSeriousAxe(page)
    await expectNoSidewaysScroll(page, 'a passage question in the session')
    await page.locator(PASSAGE).evaluate((el) => {
      ;(el as unknown as { mark: string }).mark = 'kept'
    })

    // "Report a problem" names the question, as for any served question
    await button(page, 'Report a problem').click()
    await page.getByRole('radio', { name: /typo/ }).check()
    await page.locator('.report').getByRole('button', { name: 'Send report' }).click()
    await expect(page.locator('.report [role="status"]')).toContainText('Thank you')
    expect(server.of('report_problem')[0]!.body).toMatchObject({ p_kind: 'typo', p_item_id: 'i:tst:rc:e2e-p1-q1' })

    // the optional scale is in the question, beside the same passage (five options: from 20%, "a guess"); one press
    // sends the answer as a position with the confidence, and nothing says right or wrong
    await page.locator(`${QUESTION} .options input[type="radio"]`).nth(2).check()
    const scale = page.locator(`${QUESTION} fieldset[data-confidence]`)
    await expect(scale.getByRole('radio', { name: '20%, a guess' })).toBeVisible()
    await scale.getByRole('radio').nth(1).check()
    await expect(passage(page)).toBeVisible()
    await expectNoSeriousAxe(page)
    await page.locator(QUESTION).getByRole('button', { name: 'Confirm', exact: true }).click()

    // the second question: the same passage element, and the question says which one it is
    await expect(page.locator(`${QUESTION} fieldset:not([data-confidence]) > legend`)).toHaveText(demo.questions[1]!.stem)
    await expect(page.locator('[data-set-position]')).toHaveText('Question 2 of 4 about this passage')
    expect(await page.locator(PASSAGE).evaluate((el) => (el as unknown as { mark?: string }).mark)).toBe('kept')
    expect(server.of('submit')[0]!.body).toMatchObject({ p_item_id: 'i:tst:rc:e2e-p1-q1', p_response: 2 })
    await expect(page.getByRole('group', { name: 'Question 2', exact: true })).toBeFocused()
    await answerQuestion(page, 1)
    await answerQuestion(page, 0)
    await expect(page.locator('[data-set-position]')).toHaveText('Question 4 of 4 about this passage')
    expect(await page.locator(PASSAGE).evaluate((el) => (el as unknown as { mark?: string }).mark)).toBe('kept')
    await answerQuestion(page, 3)

    // the second passage: a new one (no source line), with focus on the passage so a screen reader starts there
    await expect(page.locator('[data-set-position]')).toHaveText('Question 1 of 3 about this passage')
    await expect(page.locator(`${PASSAGE} .text p`)).toHaveText([...DEMO_PASSAGES[2]!.media.passage])
    await expect(page.locator(`${PASSAGE} .attribution`)).toHaveCount(0)
    expect(await page.locator(PASSAGE).evaluate((el) => (el as unknown as { mark?: string }).mark)).toBeUndefined()
    await expect(passage(page)).toBeFocused()
    for (let i = 0; i < 3; i++) await answerQuestion(page, i)

    // two passages read: the part is over, and the third passage of the pool was never asked for
    await pastBreak(page)
    await expect(h1(page)).toHaveText('Up next: Working Memory')
    expect(server.of('submit')).toHaveLength(7)
    expect(server.served).toEqual(pool.slice(0, 7).map((w) => w.item.item_id))
    expect(server.of('submit').map((c) => typeof c.body.p_response)).toEqual(Array<string>(7).fill('number'))
    await expect(page.locator('body')).not.toContainText(/\bincorrect\b|\bcorrect\b|wrong answer/i)
    await button(page, 'Finish early').click()
    await button(page, 'Finish now').click()
    await expect(h1(page)).toHaveText(/^Session /, { timeout: 20_000 })

    // the save holds the answers with no verdict; the profile shows the skill the server published
    await expect(page.locator('[data-section="save"]')).toBeVisible()
    await expect(page.locator('svg.hb-blob').first()).toBeVisible()
    await expect(page.locator('main')).toContainText('Reading')
    expect(server.allBodies()).not.toMatch(/"correct":\s*(0|1|true|false)/)
    await expectNoSeriousAxe(page)
  })

  test('the part fits a phone\'s width in a wide font, from "Up next" to the confidence scale under a long passage, and the passage stays in view', async ({ page }) => {
    const server = new FakeServer({ pools: { RC: passagePool([1, 0]) } })
    await server.attach(page)
    await useWideFont(page)
    await page.setViewportSize({ width: 320, height: 720 })
    await toReadyOnline(page, READING_QUERY)
    await toReading(page)
    await expectWideFont(page)
    await expectNoSidewaysScroll(page, 'Up next: Reading Comprehension')
    await button(page, 'Start').click()
    await expect(page.locator(`${QUESTION} .options input[type="radio"]`).first()).toBeEnabled()
    await expectNoSidewaysScroll(page, 'a passage question with a long passage')
    await expectNoClippedText(page, 'a passage question with a long passage', LAYOUT)
    await page.locator(`${QUESTION} .options input[type="radio"]`).nth(1).check()
    const scale = page.locator(`${QUESTION} fieldset[data-confidence]`)
    await scale.getByRole('radio').nth(4).check()
    await expectNoSidewaysScroll(page, 'the confidence scale under a passage question')
    await expectNoClippedText(page, 'the confidence scale under a passage question', `${QUESTION} fieldset[data-confidence]`)
    await page.locator(QUESTION).getByRole('button', { name: 'Confirm', exact: true }).scrollIntoViewIfNeeded()
    expect(await passageInView(page)).toBeGreaterThan(150)
    await page.locator(QUESTION).getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(page.locator('[data-set-position]')).toHaveText('Question 2 of 3 about this passage')
    await expectNoSidewaysScroll(page, 'the second question of a passage')
    // the new question is in view under the passage, not behind it
    const legend = await page.locator(`${QUESTION} fieldset:not([data-confidence]) > legend`).evaluate((el) => el.getBoundingClientRect().top)
    const frame = await boxOf(page, PASSAGE)
    expect(legend).toBeGreaterThanOrEqual(frame.bottom - 1)
    expect(legend).toBeLessThan(720)
  })
})
