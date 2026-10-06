/// <reference lib="dom" />
/**
 * The start funnel after the UX-review decisions D22, D23 and D24 (`web/UX-REVIEW.md` §2; provisional defaults),
 * in Chromium, WebKit and the iPhone 13 emulation:
 *
 * - **D22**: a browser that already holds HumanBench data shows a row under Start on the welcome screen: "See my
 *   results" (the earlier results with no new session, as from the ready screen) and, when notes settings are kept,
 *   "Notes for your AI". A first visit sees no change; Start stays the one primary button. An adult record of older
 *   terms opens the row but not the results: the 18+ gate comes first. The row fits 320 px, 200% text and a wide
 *   font, and its targets are 44 px.
 * - **D23**: the refresh-rate measurement runs while the 18+ gate is shown, so the device check has its facts when it
 *   opens and does not measure again; it stops, and stores nothing, when the person says they are under 18.
 * - **D24**: "I chose this by mistake" on the under-18 screen returns to the gate with the box unticked, focus on the
 *   gate's heading and nothing stored.
 *
 * The unit side is in `src/session/SessionApp.dom.test.ts`, `components.dom.test.ts`, `DeviceCheck.dom.test.ts`,
 * `device.test.ts` and `gate.test.ts`. The e2e tsconfig has no DOM lib here, so page code is passed as functions or
 * strings, as in the other specs.
 */

import { expect, test, type Page } from '@playwright/test'
import { AUTOSAVE_PREFIX } from '../src/save/autosave'
import { CONSENT_KEY, TERMS_VERSION } from '../src/session/constants'
import { expectNoSeriousAxe } from './axe'
import { button, h1, simulatedSave } from './flow'
import { expectNoSidewaysScroll, setTextZoomNow } from './layout'
import { expectWideFont, useWideFont } from './wide-font'

const SE = { width: 320, height: 568 } as const
const PHONE = { width: 390, height: 664 } as const

/** Notes settings as the notes page keeps them (`BriefPrefsV1`), added to the simulated save so the browser "keeps notes". */
const NOTES_PREFS = {
  v: 1,
  topics: 'topics-v1',
  groups: 'g1',
  notes_as_of: '2026-11',
  contexts: [
    { slot: 1, preset: 'reading', destination: 'chatgpt_instructions', tier: 'T1', mode: 'do', length: 'standard', topics: {}, lines_on: [], lines_off: [], rev: 1 },
  ],
  fit_log: [],
}

/**
 * Put what a browser that was used before holds into its storage before any page script runs: the adult consent
 * record (of the current terms unless `terms` says otherwise) and one earlier session as an autosave, with notes
 * settings when asked. Set once per browser context, so a record the app rewrites is not overwritten by a reload.
 */
async function holdEarlierUse(page: Page, opts: { terms?: string; notes?: boolean } = {}): Promise<void> {
  const { save } = simulatedSave(1)
  const doc = save as { sessions: { session_id: string }[] }
  const text = JSON.stringify(opts.notes === true ? { ...doc, brief_prefs: NOTES_PREFS } : doc)
  await page.addInitScript(
    (a) => {
      try {
        if (localStorage.getItem(a.consentKey) !== null) return
        localStorage.setItem(a.consentKey, JSON.stringify({ v: 1, terms: a.terms, adult: true }))
        localStorage.setItem(a.saveKey, a.text)
      } catch {
        // Storage blocked: the page then has nothing to show, which is what the tests would see.
      }
    },
    { consentKey: CONSENT_KEY, terms: opts.terms ?? TERMS_VERSION, saveKey: AUTOSAVE_PREFIX + doc.sessions[0]!.session_id, text },
  )
}

interface StorageFacts {
  readonly local: number
  readonly session: number
  readonly cookie: string
  readonly idb: number
  readonly caches: number
}

/** Everything a page can keep in this browser. */
async function storage(page: Page): Promise<StorageFacts> {
  return page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    cookie: document.cookie,
    idb: 'databases' in indexedDB ? (await indexedDB.databases()).length : 0,
    caches: 'caches' in window ? (await caches.keys()).length : 0,
  }))
}
const NOTHING: StorageFacts = { local: 0, session: 0, cookie: '', idb: 0, caches: 0 }

/** Count the animation frames the page asks for, from the first script on (the measurement asks for one per frame). */
async function countFrames(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __hbFrames: number }
    w.__hbFrames = 0
    const ask = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (cb) => {
      w.__hbFrames++
      return ask(cb)
    }
  })
}
const frames = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __hbFrames: number }).__hbFrames)

const row = (page: Page) => page.getByTestId('welcome-returning')
const notesLink = (page: Page) => page.getByRole('link', { name: 'Notes for your AI (opens in a new tab)' })

// ======================================================================================= D22

test.describe('the welcome screen for a returning visitor (D22)', () => {
  test('a first visit has no row: Start, the privacy link and nothing else; axe finds nothing serious', async ({ page }) => {
    await page.goto('./')
    await expect(h1(page)).toHaveText('HumanBench')
    await expect(row(page)).toHaveCount(0)
    await expect(page.locator('main').getByRole('button')).toHaveCount(1)
    await expect(page.locator('main').getByRole('link')).toHaveCount(1)
    expect(await storage(page)).toEqual(NOTHING)
    await expectNoSeriousAxe(page)
  })

  test('a browser that holds results: "See my results" under Start shows them at once, with no gate, honour code or new session', async ({ page }) => {
    await holdEarlierUse(page)
    await page.goto('./')
    await expect(h1(page)).toHaveText('HumanBench')
    await expect(row(page)).toBeVisible()
    await expect(row(page)).toHaveAccessibleName('Earlier results and notes on this device')
    // Start is the one primary button, and it comes first.
    await expect(page.locator('main .hb-primary')).toHaveCount(1)
    await expect(page.locator('main .hb-primary')).toHaveText('Start')
    await expect(notesLink(page)).toHaveCount(0)
    await expectNoSeriousAxe(page)
    const before = await page.evaluate(() => localStorage.length)

    await button(page, 'See my results').click()
    await expect(h1(page)).toHaveText('Your results')
    await expect(page.locator('svg.hb-blob').first()).toBeVisible()
    await expect(page.getByRole('checkbox')).toHaveCount(0)
    // Nothing was added to this browser: no new autosave, the consent as it was.
    expect(await page.evaluate(() => localStorage.length)).toBe(before)
    await expectNoSeriousAxe(page)
  })

  test('"Start" still goes the usual way for a returning visitor: the honour code, as the consent is kept', async ({ page }) => {
    await holdEarlierUse(page)
    await page.goto('./')
    await button(page, 'Start').click()
    await expect(h1(page)).toHaveText('Honour code')
  })

  test('a record of older terms opens the row, and "See my results" shows the 18+ gate first', async ({ page }) => {
    await holdEarlierUse(page, { terms: 'terms-2026-09-draft' })
    await page.goto('./')
    await expect(row(page)).toBeVisible()
    await button(page, 'See my results').click()
    await expect(h1(page)).toHaveText('Before you start')
    // Nothing is kept until the gate is passed: the old record is as it was.
    expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null').terms, CONSENT_KEY)).toBe('terms-2026-09-draft')
    await page.getByRole('checkbox', { name: /18 or older/ }).check()
    await button(page, 'Continue').click()
    // Straight to the results: no honour code or device check for a look.
    await expect(h1(page)).toHaveText('Your results')
    await expect(page.locator('svg.hb-blob').first()).toBeVisible()
    expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null').terms, CONSENT_KEY)).toBe(TERMS_VERSION)
  })

  test('"Notes for your AI" is a link to the notes page, which opens in a new tab', async ({ page }) => {
    await holdEarlierUse(page, { notes: true })
    await page.goto('./')
    await expect(notesLink(page)).toBeVisible()
    await expect(notesLink(page)).toHaveAttribute('target', '_blank')
    await expect(notesLink(page)).toHaveAttribute('href', /notes\.html$/)
    const [popup] = await Promise.all([page.waitForEvent('popup'), notesLink(page).click()])
    await expect(popup).toHaveURL(/notes\.html$/)
    await expect(popup.getByRole('heading', { level: 1 })).toHaveText('Notes for your AI')
    // The welcome screen is where it was.
    await expect(h1(page)).toHaveText('HumanBench')
  })

  for (const viewport of [SE, PHONE]) {
    test(`on a ${viewport.width} px window the row fits, wraps with text at 200%, and its targets are 44 px`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await holdEarlierUse(page, { notes: true })
      await page.goto('./')
      await expect(row(page)).toBeVisible()
      const targets = [button(page, 'See my results'), notesLink(page)]
      for (const [i, target] of targets.entries()) {
        const box = (await target.boundingBox())!
        expect(box.height, `target ${i} is 44 px tall`).toBeGreaterThanOrEqual(43.9)
        expect(box.width, `target ${i} is 44 px wide`).toBeGreaterThanOrEqual(43.9)
        expect(box.x + box.width, `target ${i} is inside the window`).toBeLessThanOrEqual(viewport.width)
      }
      await expectNoSidewaysScroll(page, `the welcome row at ${viewport.width} px`)
      await setTextZoomNow(page, 200)
      await expectNoSidewaysScroll(page, `the welcome row at ${viewport.width} px, text at 200%`)
      for (const target of targets) {
        const box = (await target.boundingBox())!
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
      }
      await setTextZoomNow(page, null)
    })
  }

  test('in a wide font, at 320 px, the row and the page around it do not overflow', async ({ page }) => {
    await useWideFont(page)
    await page.setViewportSize(SE)
    await holdEarlierUse(page, { notes: true })
    await page.goto('./')
    await expect(row(page)).toBeVisible()
    await expectWideFont(page)
    await expectNoSidewaysScroll(page, 'the welcome row, wide font, 320 px')
    await setTextZoomNow(page, 200)
    await expectNoSidewaysScroll(page, 'the welcome row, wide font, 320 px, text at 200%')
    await expectNoSeriousAxe(page)
  })
})

// ======================================================================================= D23

test.describe('the device measurement on the gate (D23)', () => {
  test('runs while the gate is shown, so the device check has its facts and measures nothing again', async ({ page }) => {
    test.setTimeout(60_000)
    await countFrames(page)
    await page.addInitScript(() => {
      // Did the words of the wait ever show? (A mutation observer sees them even if they are gone before a poll.)
      const w = window as unknown as { __hbWaited: boolean }
      w.__hbWaited = false
      const watch = (): void => {
        new MutationObserver(() => {
          if (document.body.textContent?.includes('Checking your screen')) w.__hbWaited = true
        }).observe(document.body, { subtree: true, childList: true, characterData: true })
      }
      if (document.body) watch()
      else document.addEventListener('DOMContentLoaded', watch)
    })
    await page.goto('./')
    await expect(h1(page)).toHaveText('HumanBench')
    const idle = await frames(page)
    await button(page, 'Start').click()
    await expect(h1(page)).toHaveText('Before you start')
    // One frame is asked for after the other: about 60 of them in the first second or two, with nothing else going on.
    await expect.poll(async () => (await frames(page)) - idle, { timeout: 20_000 }).toBeGreaterThanOrEqual(55)
    // Nothing has been stored: the gate is not passed.
    expect(await storage(page)).toEqual(NOTHING)

    await page.getByRole('checkbox', { name: /18 or older/ }).check()
    await button(page, 'Continue').click()
    await expect(h1(page)).toHaveText('Honour code')
    await page.getByRole('checkbox', { name: /honour code/ }).check()
    await button(page, 'Continue').click()
    await expect(h1(page)).toHaveText('Check your device')
    // The facts are there and "Continue" works, and the words of the wait never showed.
    const facts = page.locator('dl.facts')
    await expect(facts).toBeVisible({ timeout: 2000 })
    await expect(facts).toContainText(/\d+ Hz \(screen updates per second\)/)
    await expect(button(page, 'Continue')).not.toHaveAttribute('aria-disabled', 'true')
    expect(await page.evaluate(() => (window as unknown as { __hbWaited: boolean }).__hbWaited)).toBe(false)
    // No second measurement: the screen asks for no run of frames of its own.
    const atDevice = await frames(page)
    await page.waitForTimeout(800)
    expect((await frames(page)) - atDevice).toBeLessThan(10)

    await page.getByRole('radio', { name: 'Keyboard' }).check()
    await button(page, 'Continue').click()
    await expect(h1(page)).toHaveText('Ready when you are')
  })

  test('a quick person still gets the same screen: the rest of the measurement is waited for, and Continue then works', async ({ page }) => {
    await page.goto('./')
    await button(page, 'Start').click()
    await page.getByRole('checkbox', { name: /18 or older/ }).check()
    await button(page, 'Continue').click()
    await page.getByRole('checkbox', { name: /honour code/ }).check()
    await button(page, 'Continue').click()
    await expect(h1(page)).toHaveText('Check your device')
    await expect(button(page, 'Continue')).not.toHaveAttribute('aria-disabled', 'true', { timeout: 20_000 })
    await expect(page.locator('dl.facts')).toContainText(/\d+ Hz/)
    await page.getByRole('radio', { name: 'Keyboard' }).check()
    await button(page, 'Continue').click()
    await expect(h1(page)).toHaveText('Ready when you are')
  })

  test('"I am under 18" stops it: no more frames are asked for, and nothing was stored or measured into storage', async ({ page }) => {
    await countFrames(page)
    await page.goto('./')
    await button(page, 'Start').click()
    await expect(h1(page)).toHaveText('Before you start')
    await button(page, 'I am under 18').click()
    await expect(h1(page)).toHaveText('HumanBench is for adults')
    // One frame may still be on its way (the new screen's own scroll); then it is quiet.
    await page.waitForTimeout(300)
    const settled = await frames(page)
    await page.waitForTimeout(1200)
    expect((await frames(page)) - settled).toBeLessThanOrEqual(1)
    expect(await storage(page)).toEqual(NOTHING)
  })
})

// ======================================================================================= D24

test.describe('a way back from "I am under 18" (D24)', () => {
  test('"I chose this by mistake" returns to the gate with the box unticked and focus on its heading; nothing is stored', async ({ page }) => {
    await page.goto('./')
    await button(page, 'Start').click()
    // A box that was ticked before the wrong button was pressed comes back unticked.
    await page.getByRole('checkbox', { name: /18 or older/ }).check()
    await button(page, 'I am under 18').click()
    await expect(h1(page)).toHaveText('HumanBench is for adults')
    await expectNoSeriousAxe(page)
    expect(await storage(page)).toEqual(NOTHING)

    await button(page, 'I chose this by mistake').click()
    await expect(h1(page)).toHaveText('Before you start')
    await expect(h1(page)).toBeFocused()
    await expect(page.getByRole('checkbox', { name: /18 or older/ })).not.toBeChecked()
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(await storage(page)).toEqual(NOTHING)

    // The gate is as firm as before: it still needs its box.
    await button(page, 'Continue').click()
    await expect(h1(page)).toHaveText('Before you start')
    await expect(page.getByRole('alert')).toContainText('Tick the box')
    expect(await storage(page)).toEqual(NOTHING)
    await page.getByRole('checkbox', { name: /18 or older/ }).check()
    await button(page, 'Continue').click()
    await expect(h1(page)).toHaveText('Honour code')
    expect((await storage(page)).local).toBe(1)
  })

  test('it can be reached and used from the keyboard', async ({ page }) => {
    await page.goto('./')
    await button(page, 'Start').click()
    await button(page, 'I am under 18').click()
    const back = button(page, 'I chose this by mistake')
    await back.focus()
    await expect(back).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(h1(page)).toHaveText('Before you start')
    await expect(h1(page)).toBeFocused()
  })

  for (const viewport of [SE, PHONE]) {
    test(`on a ${viewport.width} px window it is a target of 44 px, quiet (not a primary button), and fits at 200% text`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('./')
      await button(page, 'Start').click()
      await button(page, 'I am under 18').click()
      const back = button(page, 'I chose this by mistake')
      await expect(back).toBeVisible()
      const box = (await back.boundingBox())!
      expect(box.height).toBeGreaterThanOrEqual(43.9)
      expect(box.width).toBeGreaterThanOrEqual(43.9)
      await expect(page.locator('main .hb-primary')).toHaveCount(0)
      await expectNoSidewaysScroll(page, `the under-18 screen at ${viewport.width} px`)
      await setTextZoomNow(page, 200)
      await expectNoSidewaysScroll(page, `the under-18 screen at ${viewport.width} px, text at 200%`)
      const zoomed = (await back.boundingBox())!
      expect(zoomed.x + zoomed.width).toBeLessThanOrEqual(viewport.width)
      await setTextZoomNow(page, null)
    })
  }
})
