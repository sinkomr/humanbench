/// <reference lib="dom" />
/**
 * Wave 2 of the session fixes of the UX review (web/ux-review/fixes/w2-session.json), in a real browser, on the
 * production build:
 *
 * - VER-01: the checklist never breaks a word, at 320 / 390 / 768 / 1024 / 1280 / 1440 px at 100% and at 320 and 390 px
 *   with the text at 200%, and a row stays short. Each word's line boxes are read (Range.getClientRects), not the
 *   style: a word whose rects are on two lines was split.
 * - VER-02: one "Privacy and terms" link on the welcome screen (its own, under Start); the footer's link is on every
 *   other screen, and a 44 px target on a phone.
 * - UX-017a: a question the browser cannot draw says so once, in the visible text, in the accessibility tree and in
 *   the live regions; Skip is the primary button and inside the first screen; nothing of the item is drawn.
 * - UX-012a: a failure to load a save is an alert of its own, tied to its field; what went well stays in the status line;
 *   the "Last saved ..." line of the autosave is still there. Pasted text that is not a save is worded as text.
 *
 * The unit side is in `src/session/Checklist` (components.dom.test.ts), `SessionScreen.dom.test.ts`, `Ready.dom.test.ts`,
 * `App.dom.test.ts` and `src/save/parse.test.ts`; the wave 1 checks of the same items are in `ux-session.spec.ts`.
 */

import { expect, test, type Page } from '@playwright/test'
import { ROTATION_UNAVAILABLE } from '../src/render/rotation/copy'
import { expectNoSeriousAxe } from './axe'
import { button, h1, simulatedSave, toReady, toResults } from './flow'
import { expectNoSidewaysScroll, setTextZoomNow } from './layout'
import { ROUTES, skipPart } from './routes'
import { SessionDriver } from './session-driver'
import { useWideFont } from './wide-font'

const SE = { width: 320, height: 568 } as const
const PHONE = { width: 390, height: 664 } as const

// ===================================================================================== VER-01

/** What the page says about the checklist at the size it has now. */
interface ChecklistFacts {
  /** Words whose letters are on more than one line. */
  readonly broken: string[]
  /** Rows (li) with their height in lines of their name's font, and how far right they reach. */
  readonly rows: { text: string; lines: number; right: number }[]
  readonly innerWidth: number
  readonly breakAfterSlash: boolean
}

/** Runs in the page. A word is a run of letters and digits inside one text node (a slash ends one: the name is split there on purpose). */
function measureChecklist(): ChecklistFacts {
  const list = document.querySelector('.checklist')!
  const broken: string[] = []
  const walker = document.createTreeWalker(list, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent ?? ''
    for (const m of text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)) {
      const range = document.createRange()
      range.setStart(node, m.index)
      range.setEnd(node, m.index + m[0].length)
      const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0)
      if (rects.length < 2) continue
      const tops = rects.map((r) => r.top)
      const smallest = Math.min(...rects.map((r) => r.height))
      if (Math.max(...tops) - Math.min(...tops) > smallest / 2) broken.push(m[0])
    }
  }
  const rows = [...list.querySelectorAll('li')].map((li) => {
    const name = li.querySelector('.name') as HTMLElement
    const box = li.getBoundingClientRect()
    const font = parseFloat(getComputedStyle(name).fontSize)
    return { text: (li.textContent ?? '').replace(/\s+/g, ' ').trim(), lines: box.height / (font * 1.2), right: box.right }
  })
  const breakAfterSlash = [...list.querySelectorAll('.name')].some((n) => n.textContent?.includes('/') === true && n.querySelector('wbr') !== null)
  return { broken, rows, innerWidth: window.innerWidth, breakAfterSlash }
}

/** The sizes of the review's acceptance: a window width and the text size. */
const SIZES: readonly { width: number; zoom: 100 | 200 }[] = [
  { width: 320, zoom: 100 },
  { width: 390, zoom: 100 },
  { width: 768, zoom: 100 },
  { width: 1024, zoom: 100 },
  { width: 1280, zoom: 100 },
  { width: 1440, zoom: 100 },
  { width: 320, zoom: 200 },
  { width: 390, zoom: 200 },
]

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

test.describe('the checklist does not break a word (VER-01)', () => {
  test('on the interstitial, after a skip and inside a part, at every size, with the status never squeezing the name', async ({ page }) => {
    test.setTimeout(4 * 60_000)
    await page.setViewportSize({ width: 1280, height: 800 })
    await toReady(page)
    await button(page, 'Begin').click()
    await expect(h1(page)).toHaveText('Up next: Reaction Time')

    const states: readonly [string, () => Promise<void>][] = [
      ['the first interstitial', async () => undefined],
      [
        'after a part was skipped',
        async () => {
          await skipPart(page)
          await expect(h1(page)).toHaveText('Up next: Matrix & Series')
        },
      ],
      [
        'inside a part',
        async () => {
          await button(page, 'Start').click()
          await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
        },
      ],
    ]
    for (const [label, go] of states) {
      await go()
      for (const { width, zoom } of SIZES) {
        const where = `${label}, ${width} px, text ${zoom}%`
        await setTextZoomNow(page, zoom === 200 ? 200 : null)
        await page.setViewportSize({ width, height: 800 })
        await settle(page)
        const facts = await page.evaluate(measureChecklist)
        expect(facts.broken, `a word split across lines: ${where}`).toEqual([])
        expect(facts.rows.length, where).toBeGreaterThanOrEqual(5)
        expect(facts.breakAfterSlash, `the break after "/" is kept: ${where}`).toBe(true)
        for (const row of facts.rows) {
          expect(row.right, `${where}: "${row.text}" stays inside the window`).toBeLessThanOrEqual(facts.innerWidth)
        }
        if (width <= 390 && zoom === 200) {
          // Rows stay short: the status sits under the name now, not one letter wide beside it (it was 1,530 px for one row).
          for (const row of facts.rows) expect(row.lines, `${where}: "${row.text}" is ${row.lines.toFixed(1)} lines tall`).toBeLessThanOrEqual(8)
        }
      }
      await setTextZoomNow(page, null)
      await page.setViewportSize({ width: 1280, height: 800 })
    }
  })

  test('"Up next" is still said once, the list is still a named region and the separators are still read (UX-007a unchanged)', async ({ page }) => {
    await page.setViewportSize(SE)
    await toReady(page)
    await button(page, 'Begin').click()
    const list = page.getByRole('region', { name: 'Session checklist' })
    await expect(list.getByText('Up next', { exact: true })).toHaveCount(1)
    await expect(list.getByRole('listitem').first()).toContainText('Reaction Time')
    // The mark is decoration; the row reads as "Speed: Reaction Time, Processing & Reading Speed. Up next." (hidden separators).
    const rows = await list.getByRole('listitem').evaluateAll((items) => items.map((li) => li.querySelector('.name')?.textContent?.replace(/\s+/g, ' ').trim() ?? ''))
    expect(rows.length).toBeGreaterThanOrEqual(5)
    for (const t of rows) {
      expect(t, 'a row reads as a sentence').toMatch(/^[^:]+: .+\.$/)
    }
    await expect(page.locator('nav[aria-label="Session checklist"]')).toHaveCount(0)
  })
})

// ===================================================================================== VER-02

/** The link every screen but the welcome has in its footer. */
const footerLink = (page: Page) => page.getByRole('contentinfo').getByRole('link', { name: /^Privacy and terms/ })

test.describe('one privacy link on the welcome, and a footer link on the other screens (VER-02)', () => {
  test('the welcome has its own link and the footer has none: a link of that name resolves to exactly one', async ({ page }) => {
    await page.goto('./')
    await expect(h1(page)).toHaveText('HumanBench')
    const links = page.getByRole('link', { name: 'Privacy and terms' })
    await expect(links).toHaveCount(1)
    await expect(links).toHaveAttribute('href', '#/privacy')
    await expect(page.locator('main').getByRole('link', { name: 'Privacy and terms' })).toHaveCount(1)
    await expect(page.getByRole('contentinfo').getByRole('link')).toHaveCount(0)
    // The disclaimer is still there, on its own.
    await expect(page.getByRole('contentinfo')).toContainText('Not an IQ test')
    await expectNoSeriousAxe(page)
  })

  test('the footer link is on the gate, honour code, device check, ready, the run and the results, and opens a new tab during the run', async ({ page }) => {
    await page.goto('./')
    await button(page, 'Start').click()
    await expect(h1(page)).toHaveText('Before you start')
    await expect(footerLink(page)).toHaveCount(1)
    await expect(footerLink(page)).toHaveAttribute('href', '#/privacy')
    await expect(footerLink(page)).not.toHaveAttribute('target', /.+/)

    await page.getByRole('checkbox', { name: /18 or older/ }).check()
    await button(page, 'Continue').click()
    await expect(h1(page)).toHaveText('Honour code')
    await expect(footerLink(page)).toHaveCount(1)

    await page.getByRole('checkbox', { name: /honour code/ }).check()
    await button(page, 'Continue').click()
    await expect(h1(page)).toHaveText('Check your device')
    await expect(footerLink(page)).toHaveCount(1)

    await expect(button(page, 'Continue')).toBeEnabled({ timeout: 20_000 })
    await page.getByRole('radio', { name: 'Keyboard' }).check()
    await button(page, 'Continue').click()
    await expect(h1(page)).toHaveText('Ready when you are')
    await expect(footerLink(page)).toHaveCount(1)
    await expect(footerLink(page)).not.toHaveAttribute('target', /.+/)

    await button(page, 'Begin').click()
    await expect(h1(page)).toHaveText('Up next: Reaction Time')
    await expect(footerLink(page)).toHaveCount(1)
    await expect(footerLink(page)).toHaveAccessibleName('Privacy and terms (opens in a new tab)')
    await expect(footerLink(page)).toHaveAttribute('target', '_blank')

    await button(page, 'Finish early').click()
    await button(page, 'Finish now').click()
    await expect(h1(page)).toHaveText(/^Session (complete|ended)$/)
    await expect(footerLink(page)).toHaveCount(1)
    await expect(footerLink(page)).not.toHaveAttribute('target', /.+/)
    // Back to the start: the welcome has its own link again, and the footer's is gone.
    await button(page, 'Back to the start').click()
    await expect(h1(page)).toHaveText('HumanBench')
    await expect(page.getByRole('link', { name: 'Privacy and terms' })).toHaveCount(1)
    await expect(page.getByRole('contentinfo').getByRole('link')).toHaveCount(0)
  })

  test('the footer link is there on the results of a loaded save', async ({ page }) => {
    await toResults(page)
    await expect(h1(page)).toHaveText(/^Session (complete|ended)$/)
    await expect(footerLink(page)).toHaveCount(1)
  })

  test('opening the notice from the welcome keeps a way to it in the footer, and closing it takes the footer link away again', async ({ page }) => {
    await page.goto('./#/privacy')
    await expect(h1(page)).toHaveText('Privacy and terms')
    await expect(footerLink(page)).toHaveCount(1)
    await page.getByRole('link', { name: 'Back' }).click()
    await expect(h1(page)).toHaveText('HumanBench')
    await expect(page.getByRole('contentinfo').getByRole('link')).toHaveCount(0)
  })

  test.describe('on a phone', () => {
    test.use({ viewport: PHONE })

    test('every footer link is a target of 44 px or more, with the small text kept', async ({ page }) => {
      const tall = async (where: string): Promise<void> => {
        const link = footerLink(page)
        await expect(link, where).toHaveCount(1)
        const box = (await link.boundingBox())!
        expect(box.height, `the footer link on ${where}`).toBeGreaterThanOrEqual(43.9)
        const size = await link.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
        expect(size, `its text on ${where} is not enlarged`).toBeLessThanOrEqual(16)
      }
      await page.goto('./')
      await button(page, 'Start').click()
      await expect(h1(page)).toHaveText('Before you start')
      await tall('the gate')
      await page.getByRole('checkbox', { name: /18 or older/ }).check()
      await button(page, 'Continue').click()
      await expect(h1(page)).toHaveText('Honour code')
      await tall('the honour code')
      await page.getByRole('checkbox', { name: /honour code/ }).check()
      await button(page, 'Continue').click()
      await expect(button(page, 'Continue')).toBeEnabled({ timeout: 20_000 })
      await tall('the device check')
      await page.getByRole('radio', { name: 'Keyboard' }).check()
      await button(page, 'Continue').click()
      await expect(h1(page)).toHaveText('Ready when you are')
      await tall('the ready screen')
      await button(page, 'Begin').click()
      await expect(h1(page)).toHaveText('Up next: Reaction Time')
      await tall('the run (the link that opens a new tab)')
      await button(page, 'Finish early').click()
      await button(page, 'Finish now').click()
      await expect(h1(page)).toHaveText(/^Session (complete|ended)$/)
      await tall('the end')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  })
})

// ===================================================================================== UX-017a

/** Records which live regions were on screen with something in them at the end of any frame (what a screen reader is told). */
const LIVE_LOG = `(() => {
  const seen = new Map()
  window.__liveSeen = seen
  const selector = '[role=status], [role=alert], [role=log], [aria-live=polite], [aria-live=assertive]'
  const frame = () => {
    for (const el of document.querySelectorAll(selector)) {
      const text = (el.textContent || '').trim()
      if (text === '' || el.closest('[hidden], [aria-hidden=true]') !== null || el.getClientRects().length === 0) continue
      if (!seen.has(el)) seen.set(el, text)
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
})()`

const UNAVAILABLE_ROUTE = ROUTES.find((r) => r.id === 'item-spatial-no-webgl')!

async function noWebGlSpatial(page: Page): Promise<void> {
  await UNAVAILABLE_ROUTE.prepare?.(page)
  await page.addInitScript(LIVE_LOG)
  // Not `openRoute`: it also waits for the renderer the route claims to be visible, and this one is parked on purpose.
  await UNAVAILABLE_ROUTE.open(page)
}

function occurrences(text: string, part: string): number {
  return text.split(part).length - 1
}

async function expectSaidOnce(page: Page, where: string): Promise<void> {
  const panel = page.locator('.unavailable')
  await expect(panel, where).toBeVisible()
  // The visible text.
  const seen = await page.locator('body').innerText()
  expect(occurrences(seen, 'cannot be shown in your browser'), `the message in the visible text (${where})`).toBe(1)
  expect(seen, `the renderer's own note is not drawn (${where})`).not.toContain(ROTATION_UNAVAILABLE)
  // The accessibility tree.
  const tree = await page.locator('body').ariaSnapshot()
  expect(occurrences(tree, 'cannot be shown in your browser'), `the message in the accessibility tree (${where})`).toBe(1)
  expect(tree, `the renderer's own note is not in the tree (${where})`).not.toContain('could not be drawn')
  // The live regions: let a few frames pass, then read the log.
  await settle(page)
  await settle(page)
  const log = await page.evaluate(() => [...(window as unknown as { __liveSeen: Map<Element, string> }).__liveSeen.values()])
  const about = log.filter((t) => /cannot be shown|could not be drawn/.test(t))
  expect(about, `one announcement of the message (${where})`).toHaveLength(1)
  expect(about[0]).toContain('cannot be shown in your browser')
  // The renderer reported the condition and is still there, parked: not seen, not read, no frames, no options, no Confirm.
  await expect(page.locator('div.rotation'), where).toBeAttached()
  await expect(page.locator('div.rotation'), where).toBeHidden()
  await expect(page.locator('div.rotation canvas').filter({ visible: true })).toHaveCount(0)
  await expect(page.getByRole('img'), where).toHaveCount(0)
  await expect(page.getByRole('radio'), where).toHaveCount(0)
  await expect(button(page, 'Confirm'), where).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: ROTATION_UNAVAILABLE }), where).toHaveCount(0)
}

test.describe('a question the browser cannot draw says so once (UX-017a)', () => {
  test('the message is in the visible text, the accessibility tree and the live regions once, with Skip first', async ({ page }, info) => {
    await noWebGlSpatial(page)
    await expectSaidOnce(page, info.project.name)
    const panel = page.locator('.unavailable')
    const skip = panel.getByRole('button', { name: 'Skip Spatial' })
    await expect(skip).toHaveClass(/hb-primary/)
    await expect(skip).toBeInViewport()
    await expect(panel.getByRole('button', { name: 'Finish early' })).not.toHaveClass(/hb-primary/)
    await expect(page.locator('header.top p.status')).toHaveText('')
    await expectNoSeriousAxe(page)
  })

  test.describe('on an iPhone SE sized screen', () => {
    test.use({ viewport: SE })

    test('one message, one announcement, and Skip is primary inside the first screen', async ({ page }) => {
      await noWebGlSpatial(page)
      await expectSaidOnce(page, '320 x 568')
      const skip = page.locator('.unavailable').getByRole('button', { name: 'Skip Spatial' })
      await expect(skip).toHaveClass(/hb-primary/)
      await expect(skip).toBeInViewport({ ratio: 1 })
      const box = (await skip.boundingBox())!
      expect(box.y + box.height, 'Skip is above the bottom of the first screen').toBeLessThanOrEqual(SE.height)
      expect(await page.evaluate(() => window.scrollY)).toBe(0)
      await expectNoSeriousAxe(page)
    })
  })

  test.describe('with the text at 200% on a small screen', () => {
    test.use({ viewport: SE })

    // The second run is set in a wide face (Verdana; the Linux CI fonts are wider than macOS's), so a layout that fits only narrow fonts fails anywhere.
    for (const wide of [false, true]) {
      test(`the message and its way out still fit the width, and are said once${wide ? ' (wide font)' : ''}`, async ({ page }) => {
        if (wide) await useWideFont(page)
        await noWebGlSpatial(page)
        await setTextZoomNow(page, 200)
        await settle(page)
        await expectNoSidewaysScroll(page, `the question the browser cannot draw, text at 200%${wide ? ', wide font' : ''}`)
        const skip = page.locator('.unavailable').getByRole('button', { name: 'Skip Spatial' })
        await expect(skip).toBeVisible()
        await skip.scrollIntoViewIfNeeded()
        await expect(skip).toBeInViewport()
        expect(occurrences(await page.locator('body').innerText(), 'cannot be shown in your browser')).toBe(1)
        expect(occurrences(await page.locator('body').ariaSnapshot(), 'cannot be shown in your browser')).toBe(1)
      })
    }
  })

  test('the keyboard reaches Skip and Finish early, and nothing of the parked question', async ({ page, isMobile, browserName }) => {
    test.skip(isMobile === true, 'a touch screen has no Tab key to walk with')
    test.skip(browserName === 'webkit', 'Safari’s Tab skips buttons and links unless a system setting is on (the keyboard suite runs on Chromium)')
    await noWebGlSpatial(page)
    await expect(h1(page)).toBeFocused()
    const names: string[] = []
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab')
      names.push(await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        return el === null ? '' : `${el.tagName.toLowerCase()}:${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}`
      }))
    }
    // From the heading: the panel's two buttons straight after it, then the footer's link; the parked question is in none of the stops.
    expect(names.slice(0, 3)).toEqual(['button:Skip Spatial', 'button:Finish early', 'a:Privacy and terms (opens in a new tab)'])
    expect(names.filter((n) => n.startsWith('input:') || n.startsWith('canvas:')), 'no option or canvas of the parked question takes focus').toEqual([])
  })

  test('Skip leaves for the next part; the parked renderer goes with the screen', async ({ page }) => {
    await noWebGlSpatial(page)
    await page.locator('.unavailable').getByRole('button', { name: 'Skip Spatial' }).click()
    await expect(h1(page)).toHaveText('Up next: Working Memory')
    await expect(page.locator('.unavailable')).toHaveCount(0)
    await expect(page.locator('div.rotation')).toHaveCount(0)
  })
})

// ===================================================================================== UX-012a, PARSE-PASTE

test.describe('the ready screen says why a save did not load (UX-012a)', () => {
  test('a bad file and a bad code are each one alert tied to their field; success stays a status', async ({ page }) => {
    await toReady(page)
    const file = page.getByLabel('Save file')
    const code = page.getByLabel('Or paste a save code')
    const alert = page.getByRole('alert')
    const status = page.getByRole('status')
    await expect(alert).toHaveCount(0)
    await expect(status).toHaveCount(1)

    await file.setInputFiles({ name: 'photo.txt', mimeType: 'text/plain', buffer: Buffer.from('this is not a save') })
    await expect(alert).toHaveCount(1)
    await expect(alert).toContainText('This file is not a HumanBench save')
    await expect(file).toHaveAttribute('aria-describedby', (await alert.getAttribute('id')) ?? 'none')
    await expect(file).toHaveAttribute('aria-invalid', 'true')
    await expect(code).not.toHaveAttribute('aria-invalid', /.*/)
    await expect(status).toHaveText('')
    // Said once in the tree.
    const tree = await page.locator('main').ariaSnapshot()
    expect(occurrences(tree, 'This file is not a HumanBench save')).toBe(1)

    await code.fill('hello there')
    await expect(alert).toHaveCount(0)
    await button(page, 'Load').click()
    await expect(alert).toHaveCount(1)
    await expect(alert).toContainText('This text is not a HumanBench save or save code.')
    await expect(code).toHaveAttribute('aria-describedby', (await alert.getAttribute('id')) ?? 'none')
    await expect(code).toHaveAttribute('aria-invalid', 'true')
    await expect(file).not.toHaveAttribute('aria-invalid', /.*/)
    await expect(status).toHaveText('')
    await expectNoSeriousAxe(page)
  })

  test('pasted raw JSON that is not a save, or is cut off, is worded as text and names the next step', async ({ page }) => {
    await toReady(page)
    const code = page.getByLabel('Or paste a save code')
    const alert = page.getByRole('alert')
    await code.fill('{"hello": "world"}')
    await button(page, 'Load').click()
    await expect(alert).toHaveText('This text is not a HumanBench save or save code. Choose your downloaded save file, or paste the save code you copied.')
    await code.fill('{"schema_version": "1.0.0", "sessions": [')
    await button(page, 'Load').click()
    await expect(alert).toContainText('This pasted save looks cut off or damaged')
    await expect(alert).toContainText('Copy it again in full')
    await expect(alert).not.toContainText('This file')
    await expect(alert).not.toContainText('save file looks')
    // A chosen file keeps the file wording.
    await code.fill('')
    await page.getByLabel('Save file').setInputFiles({ name: 'cut.txt', mimeType: 'text/plain', buffer: Buffer.from('{"schema_version": "1.0.0", "sessions": [') })
    await expect(alert).toContainText('This save file looks cut off or damaged')
  })

  test('a good code is said in the status line with no alert, and the earlier autosave is still told with its time', async ({ page }) => {
    const driver = new SessionDriver(page, { touch: test.info().project.use.isMobile === true })
    await driver.toReady()
    await driver.begin()
    await driver.answerOne()
    await driver.finishEarly()
    // A new visit on the same device finds the autosave and says when it was written (and not as an alert).
    await driver.toReady()
    await expect(page.getByRole('heading', { level: 2, name: 'Earlier saves on this device' })).toBeVisible()
    await expect(page.getByText(/^Last saved today at .+, 1 question answered\.$/)).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByRole('status')).toHaveText('')
    const sim = simulatedSave(1)
    await page.getByLabel('Or paste a save code').fill(JSON.stringify(sim.save))
    await button(page, 'Load').click()
    await expect(page.getByRole('status')).toContainText('Loaded 1 earlier session.')
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByText(/^Last saved today at /)).toBeVisible()
  })
})
