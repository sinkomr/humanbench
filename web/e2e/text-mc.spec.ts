/// <reference lib="dom" />
/**
 * Served text multiple choice in real browsers (ROADMAP M3.11 phase 1; DESIGN §3, §7.4, §10, §11.2, §13,
 * R-5.6.x, R-11.1), in Chromium, WebKit and an emulated iPhone:
 *
 * - the renderer by itself (`#/dev/text-mc`, made-up questions): axe, the keyboard alone, a phone's width
 *   and a wide font (the Linux CI's), text at 200%, and the server's text shown as text, never as markup;
 * - the session with a fake project (`fake-server.ts`, which reads `p_axes` as the real server does):
 *   a pool without the text skills gives the six-part session whether or not the page asks for them, and a
 *   pool with them gives the parts, the questions, the confidence scale, "Report a problem", and a profile with the
 *   skill on it.
 *
 * `e2e-db/` runs the same session against the real local database.
 */

import { expect, test, type Page } from '@playwright/test'
import { DEMO_TEXT_ITEMS } from '../src/render/text/demo'
import { expectNoSeriousAxe } from './axe'
import { FakeServer, SERVER_QUERY, seriesWire, textWire, type Wire } from './fake-server'
import { agreeGate, button, h1 } from './flow'
import { expectNoClippedText, expectNoSidewaysScroll, REFLOW_VIEWPORT, setTextZoomNow } from './layout'
import { openTextMc } from './routes'
import { expectWideFont, useWideFont } from './wide-font'

const ROOT = 'div.hb-render.text-mc'

test.describe('the text question screen (made-up questions)', () => {
  test('has no accessibility findings, in light and dark, with a text to read and an option chosen', async ({ page }) => {
    for (const item of [0, 1, 2]) {
      await openTextMc(page, item)
      await expectNoSeriousAxe(page)
    }
    await page.getByRole('radio').nth(2).check()
    await expectNoSeriousAxe(page)
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await openTextMc(page, 2)
    await page.getByRole('radio').nth(1).check()
    await expectNoSeriousAxe(page)
  })

  test('names the group by the question and each option by its letter and text', async ({ page }) => {
    await openTextMc(page, 1)
    const demo = DEMO_TEXT_ITEMS[1]!.payload
    const [argument, question] = demo.stem.split('\n\n') as [string, string]
    await expect(page.getByRole('group', { name: question })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Text for this question' })).toHaveText(argument)
    for (const [i, option] of demo.options.entries()) await expect(page.getByRole('radio', { name: `${'ABCDE'[i]}. ${option}`, exact: true })).toBeVisible()
    await expect(page.getByRole('radio')).toHaveCount(5)
  })

  test('is answered with the keyboard alone: a digit or a letter picks, the arrows move, Enter confirms', async ({ page, isMobile }) => {
    test.skip(isMobile, 'a hardware keyboard: desktop engines')
    await openTextMc(page, 2)
    const radios = page.getByRole('radio')
    await radios.first().focus()
    await page.keyboard.press('4')
    await expect(radios.nth(3)).toBeChecked()
    await expect(radios.nth(3)).toBeFocused()
    await page.keyboard.press('b')
    await expect(radios.nth(1)).toBeChecked()
    await page.keyboard.press('ArrowDown')
    await expect(radios.nth(2)).toBeChecked()
    await page.keyboard.press('9') // no ninth option
    await expect(radios.nth(2)).toBeChecked()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('text-mc-feedback')).toHaveAttribute('data-response', '2')
    await expect(radios.first()).toBeDisabled() // answered once: the group is locked
  })

  test('shows a visible focus ring on the option, and the chosen one is marked by more than colour', async ({ page, isMobile }) => {
    test.skip(isMobile, 'a hardware keyboard: desktop engines')
    await openTextMc(page, 0)
    await page.getByRole('radio').first().focus()
    await page.keyboard.press('2')
    const option = page.locator(`${ROOT} label.option`).nth(1)
    const style = await option.evaluate((el) => {
      const s = getComputedStyle(el)
      return { outline: s.outlineStyle, width: parseFloat(s.outlineWidth), weight: getComputedStyle(el.querySelector('.words')!).fontWeight }
    })
    expect(style.outline).toBe('solid')
    expect(style.width).toBeGreaterThanOrEqual(3)
    expect(Number(style.weight)).toBeGreaterThanOrEqual(600)
  })

  test('accepts a choice only once the question is on screen, and reports that frame', async ({ page }) => {
    await openTextMc(page, 0)
    const onset = await page.getByTestId('text-mc-onset').getAttribute('data-onset')
    expect(Number(onset)).toBeGreaterThan(0)
  })

  test('shows the server’s text as text: markup in it makes no element and runs nothing', async ({ page }) => {
    await openTextMc(page, 2)
    await expect(page.locator(`${ROOT} fieldset:not([data-confidence]) > legend`)).toContainText('<b>placeholder</b>')
    await expect(page.locator(`${ROOT} .reading`)).toContainText('<script>window.__hb_text_mc_injected = true</script>')
    await expect(page.getByRole('radio').last()).toHaveAccessibleName(/<img src=x onerror=/)
    expect(await page.locator(`${ROOT} script, ${ROOT} img, ${ROOT} b, ${ROOT} i`).count()).toBe(0)
    expect(await page.evaluate(() => (window as unknown as { __hb_text_mc_injected?: boolean }).__hb_text_mc_injected)).toBeUndefined()
  })

  for (const width of [320, 360]) {
    test(`fits ${width} px in a wide font: long options and a word with no place to break wrap inside the column`, async ({ page }) => {
      await useWideFont(page)
      await page.setViewportSize({ width, height: 800 })
      for (const item of [0, 1, 2, 3]) {
        await openTextMc(page, item)
        await expectWideFont(page)
        await expectNoSidewaysScroll(page, `text question ${item} at ${width} px`)
        await expectNoClippedText(page, `text question ${item} at ${width} px`, ROOT)
      }
      // Every option row is a touch target of at least 44 px, and no option is wider than the screen.
      const boxes = await page.locator(`${ROOT} label.option`).evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ h: r.height, right: r.right })))
      for (const b of boxes) {
        expect(b.h).toBeGreaterThanOrEqual(44)
        expect(b.right).toBeLessThanOrEqual(width)
      }
    })
  }

  test('fits a phone’s width with the text at 200%', async ({ page }) => {
    await page.setViewportSize(REFLOW_VIEWPORT)
    await openTextMc(page, 3)
    await setTextZoomNow(page, 200)
    await expectNoSidewaysScroll(page, 'text question at 200%')
    await expectNoClippedText(page, 'text question at 200%', ROOT)
    await page.getByRole('radio').nth(1).check()
    await page.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(page.getByTestId('text-mc-feedback')).toBeVisible()
  })
})

// ------------------------------------------------------------------------------ the session

/** Every served skill the app knows (`plan-table.ts` TEXT_AXES): what a server that has questions for all of them lists. */
const ALL_SERVED = ['LR', 'LG', 'RC', 'VOC', 'FER', 'KST', 'KHU', 'KAP', 'EMO', 'CRE']

/** Made-up text questions for a skill: ids that say what they are. */
const textPool = (axis: string, n: number): Wire[] => Array.from({ length: n }, (_, i) => textWire(i + 1, `i:tst:${axis.toLowerCase()}:e2e${i + 1}`, DEMO_TEXT_ITEMS[i % DEMO_TEXT_ITEMS.length]!.payload))

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

/** The break is offered once, between two parts: decline it. */
async function pastBreak(page: Page): Promise<void> {
  await expect(h1(page)).toHaveText(/^(Up next: |Time for a break\?|Session )/, { timeout: 20_000 })
  if ((await h1(page).textContent()) === 'Time for a break?') await button(page, 'Keep going').click()
}

async function skipPart(page: Page): Promise<void> {
  await button(page, 'Skip this part').click()
  await page.locator('section.confirm').getByRole('button', { name: /^Skip / }).click()
}

/** Answer the text question on screen with option `index`, set the optional confidence scale on every other one, and confirm: one press. */
async function answerText(page: Page, index = 0): Promise<void> {
  const radio = page.locator(`${ROOT} .options input[type="radio"]`).nth(index)
  await expect(radio).toBeEnabled()
  await radio.check()
  const points = page.locator(`${ROOT} fieldset[data-confidence] input[type="radio"]`)
  const name = (await points.first().getAttribute('name')) ?? ''
  if (index % 2 === 0) await points.nth(3).check()
  await page.locator(ROOT).getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.locator(`input[name="${name}"]`)).toHaveCount(0)
}

const axesAsked = (server: FakeServer): string[] => server.of('next_item').map((c) => (c.body.p_axes as string[]).join('+'))

test.describe('a pool without the text skills gives the six-part session', () => {
  test('a page that does not ask for them: the words, the parts and the requests of today', async ({ page }) => {
    const server = new FakeServer({ pools: { MAT: [seriesWire(1)] } })
    await server.attach(page)
    await page.goto(`./${SERVER_QUERY}`)
    await expect(page.locator('main')).toContainText('The session has six parts and takes about 30 minutes.')
    await toReadyOnline(page, SERVER_QUERY)
    await expect(page.locator('main')).toContainText('Six short parts, about 30 minutes.')
    await button(page, 'Begin').click()
    const seen: string[] = []
    for (let i = 0; i < 6; i++) {
      await pastBreak(page)
      await expect(h1(page)).toHaveText(/^Up next: /)
      seen.push((await h1(page).textContent())!.replace('Up next: ', ''))
      await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '0 of about 30 min')
      await skipPart(page)
    }
    expect(seen).toEqual(['Reaction Time', 'Matrix & Series', 'Spatial', 'Working Memory', 'Quantitative Reasoning', 'Processing & Reading Speed'])
    await expect(h1(page)).toHaveText(/^Session /, { timeout: 20_000 })
    expect(axesAsked(server)).toEqual([]) // every part was skipped on its "Up next" screen: nothing was asked for, and never a text skill
  })

  test('a server that lists every served skill but has nothing left for this person: one question per skill of the first turn, and then the same six parts with nothing said', async ({ page }) => {
    const server = new FakeServer({ pools: { MAT: [seriesWire(1)] }, live: ALL_SERVED })
    await server.attach(page)
    await page.goto(`./${SERVER_QUERY}`)
    // the parts take turns (plan-table.ts ROTATION): the first turn is Logical Reasoning and Reading Comprehension; the words
    // state the longest turn (Fermi, Emotion Reading, word links and Arts & Practical: ten parts)
    await expect(page.locator('main')).toContainText('The session has up to ten parts and takes about 45 minutes.')
    await toReadyOnline(page, SERVER_QUERY)
    await expect(page.locator('main')).toContainText('Up to eight short parts, about 45 minutes.') // this session's own turn
    await button(page, 'Begin').click()
    const seen: string[] = []
    for (let i = 0; i < 6; i++) {
      await pastBreak(page)
      await expect(h1(page)).toHaveText(/^Up next: /)
      seen.push((await h1(page).textContent())!.replace('Up next: ', ''))
      await expect(page.locator('header .status').first()).not.toContainText(/Logical|Vocabulary|Knowledge|Reading Comprehension/)
      await skipPart(page)
    }
    expect(seen).toEqual(['Reaction Time', 'Matrix & Series', 'Spatial', 'Working Memory', 'Quantitative Reasoning', 'Processing & Reading Speed'])
    await expect(h1(page)).toHaveText(/^Session /, { timeout: 20_000 })
    expect(axesAsked(server)).toEqual(['LR', 'RC'])
    expect(server.served).toEqual([])
    // The profile reads the five as not measured; nothing about them was skipped or failed.
    await expect(page.locator('body')).not.toContainText(/Logical Reasoning skipped|cannot be shown/)
  })
})

test.describe('a pool with made-up text questions', () => {
  test('runs the part: "Up next", the question as text, the confidence scale, a report, six answers, and the skill on the profile', async ({ page }) => {
    const server = new FakeServer({ pools: { VOC: textPool('VOC', 6) }, eap: { VOC: { mean: 0.3, sd: 0.6, n: 6 } } })
    await server.attach(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await toReadyOnline(page, SERVER_QUERY) // the server lists Vocabulary (its pool has questions): no build variable names it
    // six parts and Vocabulary: typically 31.8 minutes since the lengths were re-measured on 2026-10-13 (it read "about 35")
    await expect(page.locator('main')).toContainText('Up to seven short parts, about 30 minutes.')
    await button(page, 'Begin').click()
    for (const part of ['Reaction Time', 'Matrix & Series', 'Spatial']) {
      await pastBreak(page)
      await expect(h1(page)).toHaveText(`Up next: ${part}`)
      await skipPart(page)
    }
    await pastBreak(page)
    await expect(h1(page)).toHaveText('Up next: Vocabulary & Verbal Analogies')
    await expect(page.locator('main')).toContainText('About 2 minutes.')
    await expect(page.locator('main')).toContainText('Questions about what words mean and how they relate.')
    await expectNoSeriousAxe(page)
    expect(axesAsked(server)).toEqual(['VOC']) // asked once, before the part was announced
    await button(page, 'Start').click()

    await expect(h1(page)).toHaveText('Vocabulary & Verbal Analogies')
    await expect(page.locator(`${ROOT} fieldset:not([data-confidence]) > legend`)).toHaveText(DEMO_TEXT_ITEMS[0]!.payload.stem)
    await expect(page.locator(`${ROOT} .words`)).toHaveText([...DEMO_TEXT_ITEMS[0]!.payload.options])
    await expectNoSeriousAxe(page)
    expect(axesAsked(server)).toEqual(['VOC']) // the question shown is the one that was fetched

    // "Report a problem" names the question, as for any served question.
    await button(page, 'Report a problem').click()
    await page.getByRole('radio', { name: /typo/ }).check()
    await page.locator('.report').getByRole('button', { name: 'Send report' }).click()
    await expect(page.locator('.report [role="status"]')).toContainText('Thank you')
    expect(server.of('report_problem')[0]!.body).toMatchObject({ p_kind: 'typo', p_item_id: 'i:tst:voc:e2e1' })

    // The optional scale of a four-option question, in the question, from 25% ("a guess"); one press sends the answer
    // as a position with the confidence, and nothing says right or wrong.
    await page.locator(`${ROOT} .options input[type="radio"]`).nth(2).check()
    const scale = page.locator(`${ROOT} fieldset[data-confidence]`)
    await expect(scale.getByRole('radio')).toHaveCount(5)
    await expect(scale.getByRole('radio', { name: '25%, a guess' })).toBeVisible()
    await scale.getByRole('radio').nth(3).check()
    await expectNoSeriousAxe(page)
    await page.locator(ROOT).getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(page.locator(`${ROOT} fieldset:not([data-confidence]) > legend`)).toHaveText(DEMO_TEXT_ITEMS[1]!.payload.stem.split('\n\n')[1]!)
    expect(server.of('submit')[0]!.body).toMatchObject({ p_item_id: 'i:tst:voc:e2e1', p_response: 2, p_confidence: 81 })
    await expect(page.locator('body')).not.toContainText(/\bincorrect\b|\bcorrect\b|wrong answer/i)

    for (let i = 1; i < 6; i++) await answerText(page, i % 4)
    // Six answered (the part's minimum, `plan-table.ts` PART_MINIMUMS) and the pool is empty: the part is over.
    await pastBreak(page)
    await expect(h1(page)).toHaveText('Up next: Working Memory')
    expect(server.of('submit')).toHaveLength(6)
    expect(server.of('submit').map((c) => typeof c.body.p_response)).toEqual(['number', 'number', 'number', 'number', 'number', 'number'])
    await button(page, 'Finish early').click()
    await button(page, 'Finish now').click()
    await expect(h1(page)).toHaveText(/^Session /, { timeout: 20_000 })

    // The save holds the answers with no verdict; the profile shows the skill the server published.
    await expect(page.locator('[data-section="save"]')).toBeVisible()
    await expect(page.locator('svg.hb-blob').first()).toBeVisible()
    await expect(page.locator('main')).toContainText('Vocabulary')
    expect(server.allBodies()).not.toMatch(/"correct":\s*(0|1|true|false)/)
    await expectNoSeriousAxe(page)
  })

  test('the text part fits a phone’s width in a wide font, from "Up next" to the confidence scale', async ({ page }) => {
    const server = new FakeServer({ pools: { LR: [textWire(1, 'i:tst:lr:e2e1', DEMO_TEXT_ITEMS[3]!.payload), textWire(2, 'i:tst:lr:e2e2', DEMO_TEXT_ITEMS[2]!.payload)] } })
    await server.attach(page)
    await useWideFont(page)
    await page.setViewportSize({ width: 320, height: 720 })
    await toReadyOnline(page, SERVER_QUERY)
    await button(page, 'Begin').click()
    for (const part of ['Reaction Time', 'Matrix & Series']) {
      await pastBreak(page)
      await expect(h1(page)).toHaveText(`Up next: ${part}`)
      await skipPart(page)
    }
    await pastBreak(page)
    await expect(h1(page)).toHaveText('Up next: Logical Reasoning')
    await expectWideFont(page)
    await expectNoSidewaysScroll(page, 'Up next: Logical Reasoning')
    await button(page, 'Start').click()
    await expect(page.locator(`${ROOT} .options input[type="radio"]`).first()).toBeEnabled()
    await expectNoSidewaysScroll(page, 'a text question with long options')
    await expectNoClippedText(page, 'a text question with long options', ROOT)
    await page.locator(`${ROOT} .options input[type="radio"]`).nth(1).check()
    await page.locator(`${ROOT} fieldset[data-confidence] input[type="radio"]`).nth(4).check()
    await expectNoSidewaysScroll(page, 'the confidence scale under a text question')
    await expectNoClippedText(page, 'the confidence scale under a text question', `${ROOT} fieldset[data-confidence]`)
    await page.locator(ROOT).getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(page.locator(`${ROOT} .options input[type="radio"]`)).toHaveCount(6)
    await expectNoSidewaysScroll(page, 'a text question with a text to read')
  })
})
