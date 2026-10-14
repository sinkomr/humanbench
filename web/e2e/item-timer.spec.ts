/// <reference lib="dom" />
/**
 * The timer of the question on screen (owner feedback 2026-10-13; DESIGN §10, §13; `src/session/ItemTimer.svelte`):
 * every question that can run out of time shows how long is left, warns before it does with words and a mark, says
 * so once to a screen reader, and animates nothing. The dom tests (`ItemTimer.dom.test.ts`, `item-timer.test.ts`)
 * hold the rules; this file sees them in the three browsers, on a phone and with reduced motion. The session runs
 * with `?fast=1` (virtual time 20 times faster), so a three-minute limit is nine seconds.
 */

import { expect, test, type Page } from '@playwright/test'
import { ITEM_TIMER_LABEL, ITEM_TIMER_WARN } from '../src/session/copy'
import { expectNoAriaAttributeIssues, expectNoSeriousAxe } from './axe'
import { answerItem, button, h1 } from './flow'
import { SessionDriver } from './session-driver'

const TIMER = '[data-item-timer]'

/** To the first Matrix & Series question (reaction time skipped), in fast time. */
async function toFirstQuestion(page: Page, touch: boolean): Promise<void> {
  const d = new SessionDriver(page, { touch })
  await d.toReady('./?fast=1')
  await d.begin()
  await d.skipPart()
  await expect(h1(page)).toHaveText('Up next: Matrix & Series')
  await expect(page.locator(TIMER)).toHaveCount(0) // nothing is timed on an "Up next" screen
  await d.press(button(page, 'Start'))
  await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
}

test.describe('the question timer', () => {
  test('shows the time left on a question from its first moment, as a named timer inside the question’s region, and passes axe', async ({ page, isMobile }) => {
    await toFirstQuestion(page, isMobile)
    const box = page.locator(TIMER)
    await expect(box).toBeVisible()
    await expect(box).toContainText(ITEM_TIMER_LABEL)
    const timer = box.getByRole('timer')
    await expect(timer).toHaveText(/^[0-9]+:[0-5][0-9]$/)
    await expect(timer).toHaveAccessibleName(new RegExp(`^${ITEM_TIMER_LABEL}: `))
    // in the question's own region, above the question
    expect(await page.evaluate(() => document.querySelector('.item-region')!.contains(document.querySelector('[data-item-timer]')))).toBe(true)
    const above = await page.evaluate(() => {
      const t = document.querySelector('[data-item-timer]')!.getBoundingClientRect()
      const q = document.querySelector('form.choice, form.entry')!.getBoundingClientRect()
      return t.bottom <= q.top + 1
    })
    expect(above).toBe(true)
    // small, and inside the page
    const size = await box.evaluate((el) => ({ h: el.getBoundingClientRect().height, right: el.getBoundingClientRect().right, vw: window.innerWidth }))
    expect(size.h).toBeLessThan(80)
    expect(size.right).toBeLessThanOrEqual(size.vw + 1)
    await expectNoSeriousAxe(page)
    await expectNoAriaAttributeIssues(page)
  })

  test('warns before the time is up with words and a mark, announces it once, then the question runs out and the next one starts afresh', async ({ page, isMobile }) => {
    await toFirstQuestion(page, isMobile)
    const box = page.locator(TIMER)
    await expect(box).toHaveAttribute('data-warn', 'false')
    const status = page.locator('[data-item-timer-status]')
    await expect(status).toHaveText('')
    // record every announcement the status line makes while this question is on screen
    await page.evaluate(() => {
      const w = window as unknown as { __said: string[] }
      w.__said = []
      const el = document.querySelector('[data-item-timer-status]')!
      new MutationObserver(() => w.__said.push(el.textContent ?? '')).observe(el, { childList: true, characterData: true, subtree: true })
    })
    // the warning (the last 30 virtual seconds: 1.5 s of real time at 20 times)
    await expect(box).toHaveAttribute('data-warn', 'true', { timeout: 20_000 })
    await expect(box.locator('.flag')).toContainText(ITEM_TIMER_WARN)
    await expect(box.locator('.mark')).toHaveText('!')
    await expect(status).toHaveText(/^30 seconds left for this question\./)
    // not colour alone: the warning has a frame the calm line does not
    expect(await box.locator('.line').evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth))).toBeGreaterThanOrEqual(2)
    await expectNoSeriousAxe(page)
    const said = await page.evaluate(() => (window as unknown as { __said: string[] }).__said)
    expect(new Set(said.filter((x) => x !== '')).size).toBe(1)
    // the time-out: said in the header, and the next question has a calm timer again
    await expect(page.locator('header .status').first()).toHaveText(/ran out of time/, { timeout: 20_000 })
    await expect(page.locator(TIMER)).toHaveAttribute('data-warn', 'false')
    await expect(page.locator('[data-item-timer-status]')).toHaveText('')
  })

  test('one press sends the answer (and the optional confidence) and the next question shows a fresh timer of its own', async ({ page, isMobile }) => {
    await toFirstQuestion(page, isMobile)
    await expect(page.locator(TIMER)).toBeVisible()
    const first = await page.locator('fieldset[data-confidence] input[type=radio]').first().getAttribute('name')
    await answerItem(page, 2)
    // no step in between: the next question is up, with its own scale (unset) and its timer
    await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
    await expect(page.locator(`input[name="${first}"]`)).toHaveCount(0)
    await expect(page.locator('fieldset[data-confidence] input[type=radio]:checked')).toHaveCount(0)
    await expect(page.locator(TIMER)).toBeVisible()
    await expect(page.locator(TIMER)).toHaveAttribute('data-warn', 'false')
  })

  test('at the time-out, what is chosen or typed is sent as the answer, with the confidence if set; with nothing chosen or typed, nothing is sent (owner decision 2026-10-13)', async ({ page, isMobile }) => {
    await toFirstQuestion(page, isMobile)
    const stored = (): Promise<unknown[][]> =>
      page.evaluate(() => {
        const key = Object.keys(localStorage).find((k) => k.startsWith('hb:save:v1:')) ?? ''
        return (JSON.parse(localStorage.getItem(key) ?? '{}') as { sessions?: { responses: unknown[][] }[] }).sessions?.[0]?.responses ?? []
      })
    // the first question: an answer given and not sent, the confidence set; then the time runs out
    const form = page.locator('form.choice, form.entry').first()
    const choice = (await form.getAttribute('class'))?.split(/\s+/).includes('choice') === true
    if (choice) await form.locator('.options input[type=radio]').first().check()
    else {
      const box = form.getByRole('textbox')
      await box.fill((await box.getAttribute('class'))?.split(/\s+/).includes('letter') ? 'A' : '1')
    }
    await form.locator('fieldset[data-confidence] input[type=radio]').nth(4).check()
    await expect(page.locator(TIMER)).toHaveAttribute('data-warn', 'true', { timeout: 20_000 })
    await expect(page.locator('[data-item-timer-hint]')).toHaveText('When the time is up, what you have chosen or typed is sent as your answer.')
    await expect(page.locator('header .status').first()).toHaveText('That question ran out of time. Your answer was sent as it stood.', { timeout: 20_000 })
    await expect.poll(async () => (await stored()).length).toBe(1)
    const first = (await stored())[0]!
    expect(first[2]).not.toBeNull() // the answer as it stood
    expect(first[3] === 0 || first[3] === 1).toBe(true) // scored as any answer
    expect(first[5]).toBe(100) // the confidence set
    expect(first[6]).toEqual({ submitted_at_timeout: true })
    // the next question: nothing chosen or typed, so its time-out sends nothing
    await expect(page.locator(TIMER)).toHaveAttribute('data-warn', 'false')
    await expect.poll(async () => (await stored()).length, { timeout: 30_000 }).toBe(2)
    const second = (await stored())[1]!
    expect(second[2]).toBeNull()
    expect(second[5]).toBeNull()
    expect(second.length).toBe(6)
  })

  test('nothing about it moves: no animation and no transition, with or without reduced motion', async ({ page, isMobile }) => {
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      await page.emulateMedia({ reducedMotion })
      if (reducedMotion === 'no-preference') await toFirstQuestion(page, isMobile)
      const moving = await page.locator(TIMER).evaluate((root) =>
        [root, ...root.querySelectorAll('*')].filter((el) => {
          const cs = getComputedStyle(el)
          return cs.animationName !== 'none' || cs.transitionDuration.split(',').some((d) => parseFloat(d) > 0)
        }).length,
      )
      expect(moving, reducedMotion).toBe(0)
    }
  })

  test('fits a 320 px wide screen with text at 200%: the time is still readable and the page does not scroll sideways', async ({ page, isMobile }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await toFirstQuestion(page, isMobile)
    await page.evaluate(() => (document.documentElement.style.fontSize = '200%'))
    await expect(page.locator(TIMER).getByRole('timer')).toBeVisible()
    const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(o).toBeLessThanOrEqual(1)
  })
})
