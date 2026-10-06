/// <reference lib="dom" />
/**
 * Persona "Alex" (keyboard only), follow-up experiments that confirm or size what `keyboard.ux.ts` found:
 *
 *   - `extra: welcome ...`         Privacy and terms -> Back -> Tab -> Start -> Enter (WebKit failed to leave the welcome screen).
 *   - `extra: share card ...`      the PNG button is disabled for a moment after any change to the card: does a quick Tab skip it?
 *   - `extra: keep going ...`      after "Keep going" focus is on the opener; do the block's keys still reach the block?
 *   - `extra: practice ...`        Next practice question -> Tab -> Enter (where does focus go; what does Enter do)?
 *   - `extra: device ...`          Continue is disabled while the device is measured: a quick Tab skips it?
 *
 *   UX_REUSE=1 UX_PORT=4612 UX_RUN=keyboard npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/keyboard-extra.ux.ts --project=webkit --grep 'extra: welcome'
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { button, h1, toReady } from '../../e2e/flow'
import { chordFor } from '../../e2e/keyboard'
import { openRoute, PREVIEW_ROUTES } from '../../e2e/routes'
import { SessionDriver } from '../../e2e/session-driver'
import { REPO_ROOT, Shots, UX_ROOT } from '../lib'

const RUN = process.env.UX_RUN ?? 'keyboard'

const what = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return 'nothing (body)'
    const label = el.getAttribute('aria-label') || ((el as HTMLInputElement).labels?.[0]?.textContent ?? '') || el.textContent || ''
    return `${el.tagName.toLowerCase()}${el.getAttribute('type') ? `[${el.getAttribute('type')}]` : ''} "${label.replace(/\s+/g, ' ').trim().slice(0, 48)}"${(el as HTMLButtonElement).disabled ? ' (disabled)' : ''}`
  })

function out(project: string, name: string, data: unknown): void {
  const dir = path.join(UX_ROOT, RUN, `extra-${project}`)
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${name}.json`)
  writeFileSync(file, JSON.stringify(data, null, 2))
  console.log(`[kbd-extra ${project}] ${name} -> ${path.relative(REPO_ROOT, file)}\n${JSON.stringify(data, null, 1).slice(0, 3500)}`)
}

async function tabUntil(page: Page, chord: string, target: Locator, max = 60, shift = false): Promise<number> {
  const handle = await target.first().elementHandle({ timeout: 5000 })
  if (!handle) return -1
  const has = (): Promise<boolean> => page.evaluate((el) => el === document.activeElement, handle)
  if (await has()) return 0
  const key = shift ? (chord.includes('+') ? chord.replace('Tab', 'Shift+Tab') : `Shift+${chord}`) : chord
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press(key)
    if (await has()) return i
  }
  return -1
}

test.describe('extra', () => {
  test.beforeEach(async ({ page, browserName }, testInfo) => {
    test.skip(testInfo.project.use.hasTouch === true, 'a touch phone has no Tab key')
    await chordFor(page, browserName)
  })

  test('extra: welcome -> privacy -> Back -> Start by keyboard', async ({ page, browserName }, testInfo) => {
    const project = testInfo.project.name
    const chord = await chordFor(page, browserName)
    const shots = new Shots(page, RUN, `extra-welcome-${project}`)
    const log: unknown[] = []
    const step = async (label: string, wait = 300): Promise<void> => {
      await page.waitForTimeout(wait)
      log.push({ label, focus: await what(page), h1: ((await h1(page).textContent().catch(() => '')) ?? '').trim(), url: page.url().replace(/^.*humanbench/, '') })
    }
    await page.goto('./')
    await step('welcome loaded')
    const link = page.getByRole('link', { name: 'Privacy and terms' })
    log.push({ label: 'tabs to the privacy link', n: await tabUntil(page, chord, link) })
    await page.keyboard.press('Enter')
    await step('Enter on the privacy link')
    const back = page.getByRole('link', { name: 'Back', exact: true })
    log.push({ label: 'tabs to Back', n: await tabUntil(page, chord, back) })
    await page.keyboard.press('Enter')
    await step('Enter on Back (the welcome screen again)')
    log.push({ label: 'screenshot', path: await shots.shot('welcome-after-back', { fullPage: false }) })
    // Tab one press at a time and say where focus goes
    for (let i = 1; i <= 4; i++) {
      await page.keyboard.press(chord)
      await step(`Tab ${i}`, 100)
    }
    const start = button(page, 'Start')
    const n = await tabUntil(page, chord, start)
    log.push({ label: 'tabs to Start (from wherever focus was)', n })
    if (n < 0) {
      // stuck: what gets focus moving again?
      for (const key of [chord.includes('+') ? chord.replace('Tab', 'Shift+Tab') : `Shift+${chord}`, 'Shift+Tab', 'Tab', 'Alt+Tab', 'ArrowDown', 'Home', 'Space']) {
        await page.keyboard.press(key)
        await step(`stuck: pressed ${key}`, 100)
      }
      // the same page after a reload: does Tab work at all there?
      await page.reload()
      await page.waitForTimeout(400)
      await page.keyboard.press(chord)
      await step('after reload + Tab', 100)
    }
    await step('on Start?', 100)
    await page.keyboard.press('Enter')
    await step('Enter on Start', 1200)
    log.push({ label: 'screenshot', path: await shots.shot('welcome-after-start-enter', { fullPage: false }) })
    out(project, 'welcome', log)
  })

  test('extra: share card PNG button is skipped by a quick Tab after a change', async ({ page, browserName }, testInfo) => {
    const project = testInfo.project.name
    const chord = await chordFor(page, browserName)
    const route = PREVIEW_ROUTES.find((r) => r.id === 'results-saved')
    if (!route) throw new Error('no results-saved route')
    await route.prepare?.(page)
    if (route.motion !== 'allow') await page.emulateMedia({ reducedMotion: 'reduce' })
    await openRoute(page, route)
    await page.waitForTimeout(500)
    const shots = new Shots(page, RUN, `extra-share-${project}`)
    const card = page.locator('[data-share-card]')
    const png = card.getByRole('button', { name: 'Download image (PNG)' })
    const radio = card.locator('input[type=radio]').first()
    const log: unknown[] = []
    log.push({ label: 'tabs to the first colour radio from the page top', n: await tabUntil(page, chord, radio, 80) })
    const state = (): Promise<{ disabled: boolean; preparing: boolean }> => png.evaluate((b) => ({ disabled: (b as HTMLButtonElement).disabled, preparing: !!document.querySelector('[data-preparing]') }))
    log.push({ label: 'PNG state at rest', ...(await state()) })
    // 1. ArrowDown then an immediate Tab
    await page.keyboard.press('ArrowDown')
    const t0 = Date.now()
    const samples: string[] = []
    await page.keyboard.press(chord)
    log.push({ label: 'focus right after ArrowDown + Tab (no pause)', focus: await what(page), ms: Date.now() - t0 })
    // when does PNG come back?
    let ms = -1
    for (let i = 0; i < 80; i++) {
      const s = await state()
      if (i % 4 === 0) samples.push(`${Date.now() - t0}ms disabled=${s.disabled}`)
      if (!s.disabled) {
        ms = Date.now() - t0
        break
      }
      await page.waitForTimeout(25)
    }
    log.push({ label: 'PNG enabled again after (ms from the key press)', ms, samples })
    await shots.shot('after-colour-change', { fullPage: false })
    // 2. a pause of 100 ms between the two keys (a fast typist)
    await tabUntil(page, chord, card.locator('input[type=radio]:checked'), 20, true)
    await page.keyboard.press('ArrowUp')
    await page.waitForTimeout(100)
    await page.keyboard.press(chord)
    log.push({ label: 'focus after ArrowUp, 100 ms, Tab', focus: await what(page) })
    await page.waitForTimeout(800)
    // 3. a pause of 400 ms
    await tabUntil(page, chord, card.locator('input[type=radio]:checked'), 20, true)
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(400)
    await page.keyboard.press(chord)
    log.push({ label: 'focus after ArrowDown, 400 ms, Tab', focus: await what(page) })
    await page.waitForTimeout(1500)
    await tabUntil(page, chord, card.locator('input[type=radio]:checked'), 20, true)
    await page.keyboard.press('ArrowUp')
    await page.waitForTimeout(1500)
    await page.keyboard.press(chord)
    log.push({ label: 'focus after ArrowUp, 1500 ms, Tab', focus: await what(page) })
    // 4. what a disabled PNG does to a person already ON it: Space on a skill checkbox far above, then Shift+Tab back
    out(project, 'share-card-png', log)
  })

  test('extra: keep going returns focus to the opener, then the block keys', async ({ page, browserName }, testInfo) => {
    const project = testInfo.project.name
    const chord = await chordFor(page, browserName)
    const shots = new Shots(page, RUN, `extra-keepgoing-${project}`)
    const driver = new SessionDriver(page, { touch: false })
    await driver.toReady('./?fast=1')
    await driver.begin()
    for (let i = 0; i < 3; i++) await driver.skipPart()
    await driver.press(button(page, 'Start'))
    const span = page.locator('section.hb-render.span')
    const log: unknown[] = []
    await span.getByRole('button', { name: 'Start' }).waitFor()
    await page.waitForTimeout(300)
    log.push({ label: 'span intro, focus', focus: await what(page) })
    await tabUntil(page, chord, span.getByRole('button', { name: 'Start' }))
    await page.keyboard.press('Enter')
    await page.waitForFunction(`/^Enter \\d+ digits/.test(((document.querySelector('section.hb-render.span .hb-status') || {}).textContent) || '')`, undefined, { polling: 'raf', timeout: 20_000 })
    await page.waitForTimeout(200)
    const slots = (): Promise<string> => span.locator('ol.slots').evaluate((ol) => `${ol.getAttribute('aria-label')}`).catch(() => '(no entry list)')
    log.push({ label: 'entry begins', focus: await what(page), slots: await slots() })
    await page.keyboard.type('12')
    log.push({ label: 'typed 1 2 on the stage', slots: await slots() })
    const opener = page.locator('.actions').getByRole('button', { name: /^Skip / })
    const sh = await tabUntil(page, chord, opener, 6, true)
    log.push({ label: 'Shift+Tab presses to the Skip opener', n: sh })
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    log.push({ label: 'panel open', focus: await what(page) })
    await shots.shot('span-skip-panel', { fullPage: false })
    await tabUntil(page, chord, page.locator('section.confirm').getByRole('button', { name: 'Keep going' }))
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    log.push({ label: 'after Keep going', focus: await what(page), slots: await slots() })
    await page.keyboard.type('34')
    await page.waitForTimeout(200)
    log.push({ label: 'typed 3 4 with focus on the opener', slots: await slots(), focus: await what(page) })
    await shots.shot('span-after-keep-going-typed', { fullPage: false })
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    log.push({ label: 'Enter (Done?) with focus on the opener', focus: await what(page), panelOpen: (await page.locator('section.confirm').count()) > 0, slots: await slots() })
    await shots.shot('span-enter-on-opener', { fullPage: false })
    out(project, 'keep-going-span', log)
  })

  test('extra: practice Next then Tab then Enter', async ({ page, browserName }, testInfo) => {
    const project = testInfo.project.name
    const chord = await chordFor(page, browserName)
    await toReady(page)
    const shots = new Shots(page, RUN, `extra-practice-${project}`)
    const log: unknown[] = []
    await tabUntil(page, chord, button(page, 'Try practice questions first'))
    await page.keyboard.press('Enter')
    await expect(h1(page)).toHaveText('Practice')
    await page.waitForTimeout(300)
    const field = page.locator('form.choice input[type=radio], form.entry input[type=text]').first()
    for (let q = 1; q <= 2; q++) {
      await tabUntil(page, chord, field)
      if ((await page.locator('form.choice').count()) > 0) {
        await page.keyboard.press('b')
        await page.keyboard.press('Enter')
      } else {
        await page.keyboard.type('1')
        await page.keyboard.press('Enter')
        if (!(await page.getByRole('slider').isVisible({ timeout: 1500 }).catch(() => false))) {
          await page.keyboard.press('ControlOrMeta+A')
          await page.keyboard.type('A')
          await page.keyboard.press('Enter')
        }
      }
      await expect(page.getByRole('slider')).toBeVisible()
      await page.keyboard.press('Enter')
      await expect(page.locator('section.feedback')).toBeVisible()
      await page.waitForTimeout(200)
      log.push({ label: `Q${q}: feedback shown, focus`, focus: await what(page) })
      await shots.shot(`q${q}-feedback`, { fullPage: false })
      await page.keyboard.press(chord)
      log.push({ label: `Q${q}: Tab -> Next practice question?`, focus: await what(page) })
      await page.keyboard.press('Enter')
      await page.waitForTimeout(400)
      log.push({ label: `Q${q}: after Enter on Next`, focus: await what(page), h1: ((await h1(page).textContent().catch(() => '')) ?? '').trim(), question: (await page.locator('.muted[role=status]').first().innerText().catch(() => '')) })
      if (q === 1) break
    }
    await shots.shot('q2-arrived-no-focus', { fullPage: false })
    // one Tab from the lost focus: the new question, or something else?
    await page.keyboard.press(chord)
    log.push({ label: 'Tab #1 on the new question', focus: await what(page) })
    await shots.shot('q2-first-tab', { fullPage: false })
    // a person who presses Enter here
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
    log.push({ label: 'Enter on whatever has focus', focus: await what(page), h1: ((await h1(page).textContent().catch(() => '')) ?? '').trim(), practiceStillOn: (await page.getByText(/Practice question \d of \d/).count()) > 0 })
    await shots.shot('after-enter', { fullPage: false })
    out(project, 'practice-next', log)
  })

  test('extra: device check Continue skipped by a quick Tab', async ({ page, browserName }, testInfo) => {
    const project = testInfo.project.name
    const chord = await chordFor(page, browserName)
    const shots = new Shots(page, RUN, `extra-device-${project}`)
    const log: unknown[] = []
    await page.goto('./?fast=1')
    await expect(h1(page)).toHaveText('HumanBench')
    await tabUntil(page, chord, button(page, 'Start'))
    await page.keyboard.press('Enter')
    await expect(h1(page)).toHaveText('Before you start')
    await tabUntil(page, chord, page.getByRole('checkbox', { name: /18 or older/ }))
    await page.keyboard.press('Space')
    await tabUntil(page, chord, button(page, 'Continue'))
    await page.keyboard.press('Enter')
    await expect(h1(page)).toHaveText('Honour code')
    await tabUntil(page, chord, page.getByRole('checkbox', { name: /honour code/ }))
    await page.keyboard.press('Space')
    await tabUntil(page, chord, button(page, 'Continue'))
    await page.keyboard.press('Enter')
    await expect(h1(page)).toHaveText('Check your device')
    const t0 = Date.now()
    // as fast as a keyboard user can: Tab, Tab, Tab, with no wait
    const seen: string[] = []
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press(chord)
      seen.push(`${Date.now() - t0}ms ${await what(page)}`)
    }
    log.push({ label: 'three quick Tabs on arrival', seen })
    await shots.shot('device-after-quick-tabs', { fullPage: false })
    let enabledAt = -1
    for (let i = 0; i < 200; i++) {
      if (await button(page, 'Continue').isEnabled()) {
        enabledAt = Date.now() - t0
        break
      }
      await page.waitForTimeout(25)
    }
    log.push({ label: 'Continue enabled after (ms from arrival)', ms: enabledAt })
    out(project, 'device', log)
  })
})
