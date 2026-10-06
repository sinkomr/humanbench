/// <reference lib="dom" />
/**
 * The M1 session flow in real browsers (ROADMAP M1.15; DESIGN §7.4, §10, §13; A15, A18): consent
 * and the 18+ gate (the under-18 path writes nothing to any storage), the privacy notice (no
 * placeholder: UX-REVIEW D1), the honour code, the device check and RT input mode, practice mode, the
 * interstitials, the time-based progress ring and per-cluster checklist, skip axis, finish early,
 * the one break offer before the half-way part and the clock held on "Up next" screens (UX-066; owner
 * decision 2026-10-05, UX-REVIEW D5), the hard stop at 57, the ≥ 3-item coverage floor when the time budget is
 * gone (the known QR issue), the per-axis early stop, the confidence slider, autosave through the
 * save library, and the `?fast=1` dev flag. Rules that depend on minutes run on a fake clock
 * (`page.clock`), so the tests take seconds. Every screen is checked with axe (0 serious or critical
 * issues, WCAG 2.2 AA) and, for the main ones, the language lint (A13) and reflow at 320 px.
 */

import { expect, test, type Locator, type Page } from '@playwright/test'
import { lintText } from '../scripts/language-lint'
import { DISCLAIMER } from '../src/copy'
import { BREAK_OFFER_TEXT } from '../src/session/copy'
import { expectNoSeriousAxe } from './axe'
import { FINISHED_HEADINGS } from './flow'
import { useWideFont } from './wide-font'

const h1 = (page: Page): Locator => page.getByRole('heading', { level: 1 })
const button = (page: Page, name: string | RegExp): Locator => page.getByRole('button', { name, exact: typeof name === 'string' })

// -------------------------------------------------------------------------- navigation

async function agreeGate(page: Page): Promise<void> {
  await page.getByRole('checkbox', { name: /18 or older/ }).check()
  await button(page, 'Continue').click()
}

async function toGate(page: Page): Promise<void> {
  await page.goto('./')
  await button(page, 'Start').click()
  await expect(h1(page)).toHaveText('Before you start')
}

async function toHonour(page: Page): Promise<void> {
  await toGate(page)
  await agreeGate(page)
  await expect(h1(page)).toHaveText('Honour code')
}

async function toDevice(page: Page): Promise<void> {
  await toHonour(page)
  await page.getByRole('checkbox', { name: /honour code/ }).check()
  await button(page, 'Continue').click()
  await expect(h1(page)).toHaveText('Check your device')
}

async function toReady(page: Page, input: 'Keyboard' | 'Tap or click' = 'Keyboard'): Promise<void> {
  await toDevice(page)
  await expect(button(page, 'Continue')).toBeEnabled({ timeout: 20_000 })
  await page.getByRole('radio', { name: input }).check()
  await button(page, 'Continue').click()
  await expect(h1(page)).toHaveText('Ready when you are')
}

async function begin(page: Page): Promise<void> {
  await toReady(page)
  await button(page, 'Begin').click()
  await expect(h1(page)).toHaveText('Up next: Reaction Time')
}

/** Skip the part on the current interstitial; returns the next heading. */
async function skipPart(page: Page): Promise<void> {
  await button(page, 'Skip this part').click()
  // It asks first, like the skip during an item.
  await page.locator('section.confirm').getByRole('button', { name: /^Skip / }).click()
}

/** From Begin to the first Matrix & Series item, with reaction time skipped. */
async function toFirstItem(page: Page): Promise<void> {
  await begin(page)
  await skipPart(page)
  await expect(h1(page)).toHaveText('Up next: Matrix & Series')
  await button(page, 'Start').click()
  await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
}

/** Answer the item on screen (any kind) and rate the confidence; `pct` fills the slider first. */
async function answerItem(page: Page, pct?: number): Promise<void> {
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
      await box.fill('A') // a letter series
      await box.press('Enter')
    }
  }
  await expect(slider).toBeVisible()
  if (pct !== undefined) await slider.fill(String(pct))
  await button(page, 'Continue').click()
}

/** The item on screen has gone (the next screen or item is up). */
async function nextScreen(page: Page): Promise<void> {
  await expect(page.getByRole('slider')).toHaveCount(0)
}

async function storage(page: Page): Promise<{ local: number; session: number; cookie: string; idb: number; caches: number }> {
  return page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    cookie: document.cookie,
    idb: 'databases' in indexedDB ? (await indexedDB.databases()).length : 0,
    caches: 'caches' in window ? (await caches.keys()).length : 0,
  }))
}

async function overflow(page: Page, where: string): Promise<void> {
  const px = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(px, `${where} overflows sideways`).toBeLessThanOrEqual(0)
}

/**
 * Switch the colour scheme and let it settle: motion is switched off first and the scheme second, in two
 * calls, so the buttons' colour transition (`render.css`, only under no-preference) never starts and cannot
 * be caught half way by axe (`flow.ts` has the same helper; `axe.ts` also waits for running transitions).
 */
async function scheme(page: Page, colorScheme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.emulateMedia({ colorScheme })
}

async function languageClean(page: Page): Promise<void> {
  const html = (await page.content()).replace(/\/assets\/[^"'\s)]+/g, '/assets/')
  expect(lintText(html, 'rendered.html')).toEqual([])
}

// -------------------------------------------------------------------------------- gate

test.describe('consent and the 18+ gate (§13)', () => {
  test('the start screen and the gate have no serious axe issues, light and dark, and pass the language lint', async ({ page }) => {
    for (const colorScheme of ['light', 'dark'] as const) {
      await scheme(page, colorScheme)
      await page.goto('./')
      await expect(h1(page)).toHaveText('HumanBench')
      await expectNoSeriousAxe(page)
      await button(page, 'Start').click()
      await expect(h1(page)).toHaveText('Before you start')
      await expect(page.locator('ul.points li')).toHaveCount(3)
      await expectNoSeriousAxe(page)
    }
    await languageClean(page)
  })

  test('shows the three points and a privacy link that opens the notice in this tab, and Back returns to the gate as it was (UX-011)', async ({ page }) => {
    await toGate(page)
    const link = page.getByRole('link', { name: /privacy notice and terms/ })
    await expect(link).toHaveAttribute('href', '#/privacy')
    await expect(link).not.toHaveAttribute('target', /.+/)
    await expect(page.getByText('You must be 18 or older to take part.')).toBeVisible()
    await page.getByRole('checkbox', { name: /18 or older/ }).check()
    await link.click()
    await expect(h1(page)).toHaveText('Privacy and terms')
    expect(page.context().pages()).toHaveLength(1)
    await expect(page).toHaveTitle('Privacy and terms · HumanBench')
    await page.getByRole('link', { name: 'Back' }).click()
    await expect(h1(page)).toHaveText('Before you start')
    await expect(h1(page)).toBeFocused()
    await expect(page.getByRole('checkbox', { name: /18 or older/ })).toBeChecked()
    await expect(page).toHaveTitle('Before you start · HumanBench')
  })

  test('does not go on without agreeing, and says so', async ({ page }) => {
    await toGate(page)
    await button(page, 'Continue').click()
    await expect(page.getByRole('alert')).toContainText('Tick the box')
    await expect(h1(page)).toHaveText('Before you start')
    expect((await storage(page)).local).toBe(0)
  })

  test('the under-18 path writes nothing: no localStorage, sessionStorage, cookie, IndexedDB or cache entry', async ({ page }) => {
    await page.goto('./')
    await button(page, 'Start').click()
    await button(page, 'I am under 18').click()
    await expect(h1(page)).toHaveText('HumanBench is for adults')
    await expect(page.getByText('Nothing has been stored')).toBeVisible()
    expect(await storage(page)).toEqual({ local: 0, session: 0, cookie: '', idb: 0, caches: 0 })
    await expectNoSeriousAxe(page)
    // Nothing on the screen goes further: its one button, "I chose this by mistake", goes back to the gate (UX-REVIEW
    // D24, uxdec-funnel.spec.ts). A reload starts over with nothing kept.
    await expect(page.getByRole('button')).toHaveCount(1)
    await expect(button(page, 'I chose this by mistake')).toBeVisible()
    await page.reload()
    await expect(h1(page)).toHaveText('HumanBench')
    expect(await storage(page)).toEqual({ local: 0, session: 0, cookie: '', idb: 0, caches: 0 })
  })

  test('agreeing keeps only the consent record; the next visit skips the gate but still asks for the honour code', async ({ page }) => {
    await toHonour(page)
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['hb:consent:v1'])
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hb:consent:v1') ?? 'null'))).toMatchObject({ v: 1, adult: true })
    await page.reload()
    await button(page, 'Start').click()
    await expect(h1(page)).toHaveText('Honour code')
  })

  test('the gate, honour code and device check work by keyboard alone', async ({ page, browserName }) => {
    // Safari does not put buttons and links in the Tab order unless the system asks for it; the full keyboard-only session is M1.21.
    test.skip(browserName !== 'chromium', 'WebKit skips buttons and links when tabbing by default')
    await page.goto('./')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter') // Start
    await expect(h1(page)).toHaveText('Before you start')
    // The heading has focus; the privacy link, the box and the buttons follow in order.
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: /privacy notice/ })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('checkbox')).toBeFocused()
    await page.keyboard.press('Space')
    await page.keyboard.press('Tab')
    await expect(button(page, 'Continue')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(h1(page)).toHaveText('Honour code')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Space')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await expect(h1(page)).toHaveText('Check your device')
  })
})

test.describe('privacy and terms (§13)', () => {
  test('the notice says no personally identifiable information is collected, has no placeholder, passes axe and the language lint', async ({ page }) => {
    for (const colorScheme of ['light', 'dark'] as const) {
      await scheme(page, colorScheme)
      await page.goto('./#/privacy')
      await expect(h1(page)).toHaveText('Privacy and terms')
      await expectNoSeriousAxe(page)
    }
    // Owner decision 2026-10-05 (UX-REVIEW D1): said plainly, with no controller or contact named and no "TODO" anywhere.
    await expect(page.getByText('HumanBench collects no personally identifiable information, and all responses are anonymous.')).toBeVisible()
    await expect(page.locator('body')).not.toContainText('TODO')
    await expect(page.locator('body')).not.toContainText('Controller:')
    await expect(page.getByText('Nothing is sent to a server')).toBeVisible()
    await expect(page.locator('footer .disclaimer')).toHaveText(DISCLAIMER)
    await languageClean(page)
  })

  test('the delete button removes what the site keeps in this browser', async ({ page }) => {
    await toHonour(page)
    await page.goto('./#/privacy')
    await expect(h1(page)).toHaveText('Privacy and terms')
    await button(page, 'Delete the data this site keeps in this browser').click()
    await expect(page.getByRole('status')).toContainText('Deleted')
    expect((await storage(page)).local).toBe(0)
  })

  test('going back returns to the start screen', async ({ page }) => {
    await page.goto('./#/privacy')
    await page.getByRole('link', { name: 'Back' }).click()
    await expect(h1(page)).toHaveText('HumanBench')
  })
})

// --------------------------------------------------------------- honour and device check

test.describe('honour code and device check (§13)', () => {
  test('the honour code is DESIGN §13’s wording, needs its box, and passes axe', async ({ page }) => {
    await toHonour(page)
    await expect(page.getByText("No AI tools, search, calculators (except where provided), or help. Your blob is only meaningful if it's yours.")).toBeVisible()
    // A lead-in that says what the blob is (UX-REVIEW D26), and paper yes, calculators and AI chatbots no (owner decision, D10).
    await expect(page.getByText(/your results are drawn as a shape we call your blob/)).toBeVisible()
    await expect(page.getByText(/scratch paper and a pencil ready.*calculator or an AI chatbot/)).toBeVisible()
    await expect(page.locator('body')).not.toContainText('TODO')
    await expectNoSeriousAxe(page)
    await button(page, 'Continue').click()
    await expect(page.getByRole('alert')).toContainText('honour code')
    await expect(h1(page)).toHaveText('Honour code')
  })

  test('the device check lists coarse facts, measures the refresh rate and offers the RT input mode; axe passes', async ({ page }) => {
    await toDevice(page)
    await expect(button(page, 'Continue')).toBeEnabled({ timeout: 20_000 })
    const facts = page.locator('dl.facts')
    await expect(facts).toContainText('Device')
    await expect(facts).toContainText('Screen refresh rate')
    await expect(facts).toContainText(/\d+(\.\d)? Hz|not measured/)
    await expect(facts).toContainText('Timer precision')
    await expect(page.getByRole('radio', { name: 'Keyboard' })).toBeVisible()
    await expect(page.getByRole('radio', { name: 'Tap or click' })).toBeVisible()
    await expectNoSeriousAxe(page)
  })

  test('the chosen input mode fixes the reaction-time controls (no second choice on the block)', async ({ page }) => {
    await toReady(page, 'Tap or click')
    await button(page, 'Begin').click()
    await button(page, 'Start').click()
    await expect(page.getByText('tap or click the box')).toBeVisible()
    await expect(page.getByRole('group', { name: 'Respond with' })).toHaveCount(0)
    await expectNoSeriousAxe(page)
  })
})

// ------------------------------------------------------------------- practice and start

test.describe('ready and practice (§10)', () => {
  test('the ready screen passes axe and offers practice, earlier saves and Begin', async ({ page }) => {
    await toReady(page)
    await expect(button(page, 'Begin')).toBeVisible()
    await expect(button(page, 'Try practice questions first')).toBeVisible()
    await expect(page.getByLabel('Save file')).toBeVisible()
    await expect(page.getByLabel('Or paste a save code')).toBeVisible()
    await expectNoSeriousAxe(page)
    await languageClean(page)
  })

  test('practice gives feedback after the answer, is never counted and writes nothing', async ({ page }) => {
    await toReady(page)
    await button(page, 'Try practice questions first').click()
    await expect(h1(page)).toHaveText('Practice')
    await expect(page.getByText('Practice question 1 of 4')).toBeVisible()
    // Before answering there is no verdict anywhere.
    await expect(page.getByText(/That was (not )?correct/)).toHaveCount(0)
    await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
    await expectNoSeriousAxe(page)
    await answerItem(page, 80)
    await expect(page.getByText(/That was (not )?correct\./)).toBeVisible()
    await expect(page.getByText(/The answer was [A-F]\./)).toBeVisible()
    await expectNoSeriousAxe(page)
    await button(page, 'Next practice question').click()
    await expect(page.getByText('Practice question 2 of 4')).toBeVisible()
    // "Stop practice" leaves at once (UX-004): there is no second "Back" to press.
    await button(page, 'Stop practice').click()
    await expect(h1(page)).toHaveText('Ready when you are')
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['hb:consent:v1'])
  })

  test('practice to its end: "Practice complete" goes on to the ready screen with "Continue"', async ({ page }) => {
    await toReady(page)
    await button(page, 'Try practice questions first').click()
    for (let n = 1; n <= 4; n++) {
      await expect(page.getByText(`Practice question ${n} of 4`)).toBeVisible()
      await answerItem(page)
      await expect(page.getByText(/That was (not )?correct\./)).toBeVisible()
      await button(page, n < 4 ? 'Next practice question' : 'Finish practice').click()
    }
    await expect(h1(page)).toHaveText('Practice complete')
    await expectNoSeriousAxe(page)
    await button(page, 'Continue').click()
    await expect(h1(page)).toHaveText('Ready when you are')
  })
})

// --------------------------------------------------------------------- the session screens

test.describe('the session: interstitials, ring, checklist, controls (§10, A15)', () => {
  test('starts with the interstitial for reaction time, the progress ring at 0 and the cluster checklist', async ({ page }) => {
    await begin(page)
    await expect(page.getByText(/About \d+ minutes?\./)).toBeVisible()
    const ring = page.getByRole('progressbar', { name: 'Session time' })
    await expect(ring).toHaveAttribute('aria-valuetext', '0 of about 30 min')
    const list = page.getByRole('region', { name: 'Session checklist' })
    await expect(list.getByRole('listitem')).toHaveCount(5)
    await expect(list.getByRole('listitem').nth(1)).toContainText('Reasoning')
    // Estimation is measured by the confidence slider, so it has a row and is not listed as missing.
    await expect(list.getByRole('listitem').nth(4)).toContainText('Estimation')
    await expect(list.getByRole('listitem').nth(4)).toContainText('With each answer')
    await expect(list).toContainText('Not in this version')
    await expect(list.locator('.later')).not.toContainText('Estimation')
    await expect(page.locator('footer .disclaimer')).toHaveText(DISCLAIMER)
    for (const colorScheme of ['light', 'dark'] as const) {
      await scheme(page, colorScheme)
      await expectNoSeriousAxe(page)
    }
    await languageClean(page)
  })

  test('the reaction-time block opens with its instructions; axe passes on it', async ({ page }) => {
    await begin(page)
    await button(page, 'Start').click()
    await expect(h1(page)).toHaveText('Reaction Time')
    await expect(button(page, 'Start practice')).toBeVisible()
    await expectNoSeriousAxe(page)
  })

  test('skipping a part from its interstitial passes over it, and the checklist says where things stand', async ({ page }) => {
    await begin(page)
    await skipPart(page)
    await expect(h1(page)).toHaveText('Up next: Matrix & Series')
    const list = page.getByRole('region', { name: 'Session checklist' })
    // Speed still has processing and reading speed ahead, but that is not what comes next: Spatial/Memory is (UX-007a).
    await expect(list.getByRole('listitem').nth(0)).toContainText('Later')
    await expect(list.getByRole('listitem').nth(1)).toContainText('Now')
    await expect(list.getByRole('listitem').nth(2)).toContainText('Up next')
    await expect(list.getByText('Up next', { exact: true })).toHaveCount(1)
    await expect(page.getByRole('status').first()).toContainText('Reaction Time skipped')
  })

  test('a counted item: no key and no verdict in the page, the slider comes after the answer, and axe passes throughout', async ({ page }) => {
    await toFirstItem(page)
    const html = await page.content()
    expect(html).not.toMatch(/data-(key|correct|answer)|is_correct|correctIndex|"key"/i)
    await expect(page.getByText(/correct|incorrect|wrong/i)).toHaveCount(0)
    await expect(page.getByRole('slider')).toHaveCount(0)
    await expectNoSeriousAxe(page)
    // Answer: the slider appears, keeps the item on screen, starts on the keyboard.
    const choice = page.locator('form.choice')
    if ((await choice.count()) > 0) {
      await choice.getByRole('radio').first().check()
      await button(page, 'Confirm').click()
    } else {
      await page.getByRole('textbox').fill('1')
      await page.getByRole('textbox').press('Enter')
      if (!(await page.getByRole('slider').isVisible({ timeout: 1500 }).catch(() => false))) {
        await page.getByRole('textbox').fill('A')
        await page.getByRole('textbox').press('Enter')
      }
    }
    const slider = page.getByRole('slider')
    await expect(slider).toBeVisible()
    await expect(slider).toBeFocused()
    await expect(page.getByText('How sure are you that your answer is right?')).toBeVisible()
    await expect(page.getByText(/correct|incorrect|wrong/i)).toHaveCount(0)
    await expectNoSeriousAxe(page)
    for (const colorScheme of ['dark', 'light'] as const) {
      await scheme(page, colorScheme)
      await expectNoSeriousAxe(page)
    }
  })

  test('the confidence slider can be set, and is stored with the answer (Brier input)', async ({ page }) => {
    await toFirstItem(page)
    await answerItem(page, 73)
    await nextScreen(page)
    const stored = (): Promise<unknown[][]> =>
      page.evaluate(() => {
        const key = Object.keys(localStorage).find((k) => k.startsWith('hb:save:v1:')) ?? ''
        return (JSON.parse(localStorage.getItem(key) ?? '{}') as { sessions?: { responses: unknown[][] }[] }).sessions?.[0]?.responses ?? []
      })
    await expect.poll(async () => (await stored()).length).toBe(1)
    const responses = await stored()
    expect(responses[0]?.[5]).toBe(73)
    expect(String(responses[0]?.[0])).toMatch(/^i:(matrices|series):/)
  })

  test('autosave writes a valid save after each answer, keyed by the session, through the save library', async ({ page }) => {
    await toFirstItem(page)
    await answerItem(page)
    await nextScreen(page)
    await answerItem(page)
    await nextScreen(page)
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const key = Object.keys(localStorage).find((k) => k.startsWith('hb:save:v1:')) ?? ''
          return (JSON.parse(localStorage.getItem(key) ?? '{}') as { sessions?: { responses: unknown[] }[] }).sessions?.[0]?.responses.length ?? 0
        }),
      )
      .toBe(2)
    const save = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('hb:save:v1:')) ?? '') ?? '{}') as Record<string, unknown>)
    expect(save.schema_version).toBe('1.0.0')
    expect(String(save.anon_id)).toMatch(/^hb_[0-9A-Za-z]{17}$/)
    expect((save.sessions as { device: { class: string }; flags: object }[])[0]?.device.class).toMatch(/desktop|tablet|phone|other/)
    expect((save.seen_families as string[]).length).toBe(2)
  })

  test('skip this skill asks first; keeping going returns focus; skipping moves on and shows "not measured" later', async ({ page }) => {
    await toFirstItem(page)
    const skip = button(page, 'Skip Matrix & Series')
    await skip.click()
    await expect(page.getByRole('heading', { level: 2, name: 'Skip Matrix & Series?' })).toBeVisible()
    await expectNoSeriousAxe(page)
    await button(page, 'Keep going').click()
    await expect(skip).toBeFocused()
    await skip.click()
    await page.locator('section.confirm').getByRole('button', { name: 'Skip Matrix & Series' }).click()
    await expect(h1(page)).toHaveText('Up next: Spatial')
  })

  test('finish early asks first, ends with what there is, and shows the profile with a save file to download', async ({ page }) => {
    await toFirstItem(page)
    await answerItem(page, 60)
    await nextScreen(page)
    await button(page, 'Finish early').click()
    await expect(page.getByRole('heading', { level: 2, name: 'Finish now?' })).toBeVisible()
    await expectNoSeriousAxe(page)
    await button(page, 'Keep going').click()
    await expect(button(page, 'Finish early')).toBeFocused()
    await button(page, 'Finish early').click()
    await button(page, 'Finish now').click()
    await expect(h1(page)).toHaveText('Session complete')
    await expect(page.getByText('You finished early')).toBeVisible()
    await expect(page.locator('svg.hb-blob').first()).toBeVisible()
    await expect(page.getByRole('table', { name: /Estimates by skill/ })).toBeVisible()
    await expectNoSeriousAxe(page)
    await languageClean(page)
    const download = page.waitForEvent('download')
    await button(page, 'Download save file').click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/^humanbench-[0-9A-Za-z]{6}-\d{4}-\d{2}-\d{2}\.hbsave\.json$/)
  })

  test('a save from one session is loaded by content on the ready screen and the next session is added to it (R-8.1, M1.17 wiring)', async ({ page }) => {
    await toFirstItem(page)
    await answerItem(page, 60)
    await nextScreen(page)
    await button(page, 'Finish early').click()
    await button(page, 'Finish now').click()
    await expect(h1(page)).toHaveText('Session complete')
    // The autosave is a complete save file: keep its text, wipe the browser's storage, and load the text as an upload.
    const text = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.startsWith('hb:save:v1:')) ?? ''
      return localStorage.getItem(key) ?? ''
    })
    expect(JSON.parse(text).sessions).toHaveLength(1)
    const anon = JSON.parse(text).anon_id as string
    await page.evaluate(() => localStorage.clear())
    await toReady(page)
    // A name and a type that do not say "JSON": it is read by content (DESIGN §8: iOS may add .txt).
    await page.getByLabel('Save file').setInputFiles({ name: 'humanbench-save.txt', mimeType: 'text/plain', buffer: Buffer.from(text) })
    await button(page, 'Load').click()
    await expect(page.getByText('Loaded 1 earlier session')).toBeVisible()
    await button(page, 'Begin').click()
    // A session with no answer yet is not written (a start that is abandoned leaves nothing behind):
    // its first answer writes the save of both sessions.
    await expect(h1(page)).toHaveText('Up next: Reaction Time')
    await skipPart(page)
    await button(page, 'Start').click()
    await answerItem(page)
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const keys = Object.keys(localStorage).filter((k) => k.startsWith('hb:save:v1:'))
          const save = keys.length === 0 ? null : (JSON.parse(localStorage.getItem(keys[0] ?? '') ?? '{}') as { anon_id?: string; sessions?: unknown[] })
          return save === null ? null : [save.anon_id, save.sessions?.length]
        }),
      )
      .toEqual([anon, 2])
  })

  test('finishing at once shows that nothing was measured, and offers a fresh start', async ({ page }) => {
    await begin(page)
    await button(page, 'Finish early').click()
    await button(page, 'Finish now').click()
    await expect(h1(page)).toHaveText('Session ended')
    await expect(page.getByText('Nothing was measured')).toBeVisible()
    await expectNoSeriousAxe(page)
    await button(page, 'Back to the start').click()
    await expect(h1(page)).toHaveText('HumanBench')
  })
})

// ------------------------------------------------------------------ rules on a fake clock

test.describe('the time rules, on a fake clock (§7.4, §10, A15)', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install()
  })

  /** From the reaction-time interstitial, skip Reaction Time, Matrix & Series and Spatial: the next part is Working Memory, the half-way one. */
  async function skipToHalfWay(page: Page): Promise<void> {
    for (const next of ['Up next: Matrix & Series', 'Up next: Spatial']) {
      await skipPart(page)
      await expect(h1(page)).toHaveText(next)
    }
    await skipPart(page)
  }

  test('the break is offered at the part boundary nearest half-way (before Working Memory); taking it holds the clock (the time on it does not count)', async ({ page }) => {
    await begin(page)
    await skipToHalfWay(page)
    await expect(h1(page)).toHaveText('Time for a break?')
    await expect(page.getByText(BREAK_OFFER_TEXT)).toBeVisible()
    await expectNoSeriousAxe(page)
    await button(page, 'Take a break').click()
    await expect(h1(page)).toHaveText('Break')
    await expect(button(page, 'Finish early')).toHaveCount(0)
    await expectNoSeriousAxe(page)
    // An hour on a break: were it counted, the 57-minute hard stop would end the session.
    await page.clock.fastForward('01:00:00')
    await button(page, 'Resume').click()
    await expect(h1(page)).toHaveText('Up next: Working Memory')
    await expect(page.getByRole('progressbar', { name: 'Session time' })).toHaveAttribute('aria-valuenow', '0')
    await page.clock.runFor(2000)
    await expect(h1(page)).toHaveText('Up next: Working Memory')
  })

  test('the offer is made once: declining it carries on, and it does not come back', async ({ page }) => {
    await begin(page)
    await skipToHalfWay(page)
    await expect(h1(page)).toHaveText('Time for a break?')
    await button(page, 'Keep going').click()
    await expect(h1(page)).toHaveText('Up next: Working Memory')
    for (const next of ['Up next: Quantitative Reasoning', 'Up next: Processing & Reading Speed']) {
      await skipPart(page)
      await expect(h1(page)).toHaveText(next)
    }
  })

  test('the offer never comes in the middle of a part, however long it has run; past the planned time the ring says so', async ({ page }) => {
    await toFirstItem(page)
    // 31 minutes on the first Matrix & Series question: it runs past its cap, and the part's time budget is gone.
    await page.clock.fastForward('31:00')
    await page.clock.runFor(1000)
    await expect(h1(page)).not.toHaveText('Time for a break?')
    // The part keeps its coverage floor of 3 questions (the timed-out one counts), then the next part is announced.
    for (let i = 0; i < 6 && !((await h1(page).textContent()) ?? '').startsWith('Up next'); i++) {
      await expect(h1(page)).not.toHaveText('Time for a break?')
      await answerItem(page)
    }
    await expect(h1(page)).toHaveText('Up next: Spatial')
    // Past the planned time with parts still to do: "Almost there" is for the last part only (UX-008).
    await expect(page.getByRole('progressbar', { name: 'Session time' })).toHaveAttribute('aria-valuetext', 'Over the planned time')
    // The offer still comes where the plan put it: after Spatial, before Working Memory.
    await skipPart(page)
    await expect(h1(page)).toHaveText('Time for a break?')
  })

  test('the hard stop ends the session at 57 minutes, wherever it is: not at 56, and by 57:01', async ({ page }) => {
    await toFirstItem(page)
    // The clock runs on by itself a few seconds while the page is set up, so the bounds are 56:00 (a stop at 56 would already have ended it) and 57:01 (a stop at 58 would not have).
    await page.clock.fastForward('56:00')
    await page.clock.runFor(1000)
    await expect(page.getByText('The session reached its time limit')).toHaveCount(0)
    await expect(h1(page)).not.toHaveText(FINISHED_HEADINGS)
    await page.clock.fastForward('01:01')
    // Either end heading (UX-009b): the 56-minute jump runs the open question past its cap and records it as timed out
    // (§7.4), so there is usually a profile ("Session complete"); what is tested here is when the stop comes.
    await expect(h1(page)).toHaveText(FINISHED_HEADINGS, { timeout: 15_000 })
    await expect(page.getByText('The session reached its time limit')).toBeVisible()
    await expectNoSeriousAxe(page)
  })

  test('an item with no answer by its cap is recorded as not correct, and the next one comes', async ({ page }) => {
    await toFirstItem(page)
    await page.clock.fastForward('03:10')
    await expect(page.getByRole('status').first()).toContainText('ran out of time', { timeout: 15_000 })
    await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const key = Object.keys(localStorage).find((k) => k.startsWith('hb:save:v1:')) ?? ''
          const r = (JSON.parse(localStorage.getItem(key) ?? '{}') as { sessions?: { responses: unknown[][] }[] }).sessions?.[0]?.responses ?? []
          return r.length === 1 ? [r[0]?.[2], r[0]?.[3], r[0]?.[5]] : null
        }),
      )
      .toEqual([null, 0, null])
  })

  /**
   * From the reaction-time interstitial: skip to Quantitative Reasoning (declining the break offer before Working
   * Memory), start it, and let its time budget be gone on its first question (a jump past the 27.5-minute target:
   * the clock waits on "Up next" screens, so the jump is made inside the part; the question runs past its cap and
   * counts as not correct). Then answer what it serves. Returns the families of the answers saved for the session.
   */
  async function quantWithoutBudget(page: Page): Promise<string[]> {
    for (const next of ['Up next: Matrix & Series', 'Up next: Spatial', 'Time for a break?', 'Up next: Working Memory', 'Up next: Quantitative Reasoning']) {
      if (next === 'Up next: Working Memory') await button(page, 'Keep going').click()
      else await skipPart(page)
      await expect(h1(page)).toHaveText(next)
    }
    await button(page, 'Start').click()
    await expect(page.locator('form.entry')).toBeVisible()
    await page.clock.fastForward('28:00')
    await expect(page.getByRole('status').first()).toContainText('ran out of time', { timeout: 15_000 })
    for (let n = 2; n <= 3; n++) {
      await answerItem(page)
      if (n < 3) await expect(page.locator('form.entry')).toBeVisible()
    }
    await expect(h1(page)).toHaveText('Up next: Processing & Reading Speed')
    let families: string[] = []
    await expect
      .poll(async () => {
        families = await page.evaluate(() => {
          const key = Object.keys(localStorage).find((k) => k.startsWith('hb:save:v1:')) ?? ''
          const sessions = (JSON.parse(localStorage.getItem(key) ?? '{}') as { sessions?: { responses: unknown[][] }[] }).sessions ?? []
          return (sessions.at(-1)?.responses ?? []).map((t) => String(t[0]).split(':')[1] ?? '')
        })
        return families.length
      })
      .toBe(3)
    return families
  }

  test('QR keeps its coverage floor of 3 items when the time budget is gone (the known issue), and gets no more', async ({ page }) => {
    await begin(page)
    expect(await quantWithoutBudget(page)).toEqual(['quant', 'quant', 'quant'])
  })

  test('a start that was abandoned before any answer is not an earlier session: after a reload QR still gets its floor (M1.15 review, §7.4)', async ({ page }) => {
    await begin(page) // Begin pressed, nothing answered
    // Nothing is kept for a session without an answer, neither at once nor when the page goes away.
    const saves = (): Promise<string[]> => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('hb:save:v1:')))
    await page.clock.fastForward('00:05')
    expect(await saves()).toEqual([])
    await page.reload()
    expect(await saves()).toEqual([])
    // Back through the (short) second visit: the consent is kept, no earlier session is offered.
    await button(page, 'Start').click()
    await expect(h1(page)).toHaveText('Honour code')
    await page.getByRole('checkbox', { name: /honour code/ }).check()
    await button(page, 'Continue').click()
    await expect(button(page, 'Continue')).toBeEnabled({ timeout: 20_000 })
    await page.getByRole('radio', { name: 'Keyboard' }).check()
    await button(page, 'Continue').click()
    await expect(h1(page)).toHaveText('Ready when you are')
    await expect(page.getByText('Earlier saves on this device')).toHaveCount(0)
    await button(page, 'Begin').click()
    await expect(h1(page)).toHaveText('Up next: Reaction Time')
    // Counted as session 2, QR would have had no floor (0 items after long span blocks).
    expect(await quantWithoutBudget(page)).toEqual(['quant', 'quant', 'quant'])
  })

  test('the ring follows session time once a part runs', async ({ page }) => {
    // The clock waits on "Up next" screens (UX-066), so the time is spent inside Matrix & Series: each question
    // runs past its 3-minute cap and the next one comes.
    await toFirstItem(page)
    const ring = page.getByRole('progressbar', { name: 'Session time' })
    await page.clock.fastForward('10:00')
    await page.clock.runFor(1000)
    await expect(ring).toHaveAttribute('aria-valuetext', '10 of about 30 min')
    await page.clock.fastForward('05:00')
    await page.clock.runFor(1000)
    await expect(ring).toHaveAttribute('aria-valuetext', '15 of about 30 min')
  })
})

// ------------------------------------------------------------------------ early stop (SD)

test.describe('per-axis early stop (SD < 0.3, §7.4)', () => {
  test('Matrix & Series runs until its estimate is precise, then the session moves on to the next part', async ({ page, browserName, isMobile }) => {
    test.skip(browserName !== 'chromium' || isMobile, 'a long run of about 30 items: one engine is enough')
    test.setTimeout(240_000)
    // The clock runs in step with the real one here (a few minutes at most), well inside the segment's budget,
    // so only precision can end the segment.
    await page.clock.install()
    await toFirstItem(page)
    let answered = 0
    for (let i = 0; i < 120; i++) {
      await answerItem(page)
      answered++
      await expect(page.getByRole('slider')).toHaveCount(0)
      if ((await h1(page).textContent())?.startsWith('Up next')) break
    }
    await expect(h1(page)).toHaveText('Up next: Spatial')
    expect(answered).toBeGreaterThan(14) // a time budget alone would end it after about 7
    expect(answered).toBeLessThan(120)
  })
})

// --------------------------------------------------------------------- unavailable renderer

test.describe('an item the browser cannot draw (§13)', () => {
  test('without WebGL the Spatial item offers the skip right there, and skipping is safe', async ({ page }) => {
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null
        return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest) as never
      } as typeof orig
    })
    await begin(page)
    for (const next of ['Up next: Matrix & Series', 'Up next: Spatial']) {
      await skipPart(page)
      await expect(h1(page)).toHaveText(next)
    }
    await button(page, 'Start').click()
    await expect(page.getByText('cannot be shown in your browser').first()).toBeVisible({ timeout: 20_000 })
    await expectNoSeriousAxe(page)
    await page.locator('.unavailable').getByRole('button', { name: 'Skip Spatial' }).click()
    // Spatial ends the first half of the plan: the one break offer comes before Working Memory (UX-066, D5).
    await expect(h1(page)).toHaveText('Time for a break?')
    await button(page, 'Keep going').click()
    await expect(h1(page)).toHaveText('Up next: Working Memory')
  })
})

// ------------------------------------------------------------------------------ dev flag

test.describe('the ?fast=1 dev flag (M1.15)', () => {
  test('the e2e build honours it (the plain production build ignores it: scripts/dev-routes.test.ts): a banner, and the timeline runs faster', async ({ page }) => {
    await page.goto('./?fast=1')
    await button(page, 'Start').click()
    await agreeGate(page)
    await page.getByRole('checkbox', { name: /honour code/ }).check()
    await button(page, 'Continue').click()
    await expect(button(page, 'Continue')).toBeEnabled({ timeout: 20_000 })
    await button(page, 'Continue').click()
    await button(page, 'Begin').click()
    await expect(page.getByText('Fast mode (development only)')).toBeVisible()
    // The clock waits on the "Up next" screen (UX-066): start the part. 20 times faster: a few real seconds are minutes of session time.
    await button(page, 'Start').click()
    await expect(page.getByRole('progressbar', { name: 'Session time' })).toHaveAttribute('aria-valuenow', /^([1-9]\d*)$/, { timeout: 15_000 })
  })

  test('without the parameter there is no banner and time runs at its own speed', async ({ page }) => {
    await begin(page)
    await expect(page.getByText('Fast mode (development only)')).toHaveCount(0)
    await button(page, 'Start').click()
    await page.waitForTimeout(2500)
    await expect(page.getByRole('progressbar', { name: 'Session time' })).toHaveAttribute('aria-valuenow', '0')
  })
})

// ------------------------------------------------------------------------------- reflow

test.describe('reflow at 320 CSS px with a wide font (WCAG 1.4.10)', () => {
  test('every screen of the flow fits without sideways scrolling', async ({ page }) => {
    await useWideFont(page)
    await page.setViewportSize({ width: 320, height: 700 })
    await page.goto('./')
    await overflow(page, 'welcome')
    await button(page, 'Start').click()
    await overflow(page, 'gate')
    await agreeGate(page)
    await overflow(page, 'honour')
    await page.getByRole('checkbox', { name: /honour code/ }).check()
    await button(page, 'Continue').click()
    await expect(button(page, 'Continue')).toBeEnabled({ timeout: 20_000 })
    await overflow(page, 'device')
    await button(page, 'Continue').click()
    await overflow(page, 'ready')
    await button(page, 'Begin').click()
    await expect(h1(page)).toHaveText('Up next: Reaction Time')
    await overflow(page, 'interstitial')
    await skipPart(page)
    await button(page, 'Start').click()
    await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
    await overflow(page, 'item')
    await answerItem(page)
    await button(page, 'Finish early').click()
    await overflow(page, 'finish confirm')
    await button(page, 'Finish now').click()
    await expect(h1(page)).toHaveText('Session complete')
    await overflow(page, 'finished')
    await page.goto('./#/privacy')
    await overflow(page, 'privacy')
  })
})
