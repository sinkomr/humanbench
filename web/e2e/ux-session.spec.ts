/// <reference lib="dom" />
/**
 * The fixes of the fresh-eyes review for the start funnel, the chrome of a running session, the finished
 * screen and the app shell (web/ux-review/triage.json, items UX-001 .. UX-018a of area "session"). What each
 * test pins is named by its item; the dom tests next to the components check the same rules without a
 * browser. Phone checks run on the `iphone` project (iPhone 13, 390 x 664) and, where the small screen is the
 * point, at 320 x 568 (an iPhone SE); the rest on the desktop engines.
 */

import { readFileSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { ROTATION_UNAVAILABLE } from '../src/render/rotation/copy'
import { expectNoSeriousAxe } from './axe'
import { button, h1, loadSave, overflow, simulatedSave, toReady, unloadIsGuarded } from './flow'

const SE = { width: 320, height: 568 } as const

// ----------------------------------------------------------------------------- navigation

async function begin(page: Page): Promise<void> {
  await toReady(page)
  await button(page, 'Begin').click()
  await expect(h1(page)).toHaveText('Up next: Reaction Time')
}

/** Skip the part on the interstitial (it asks first). */
async function skipPart(page: Page): Promise<void> {
  await button(page, 'Skip this part').click()
  await page.locator('section.confirm').getByRole('button', { name: /^Skip / }).click()
}

/** Tap on a phone, click otherwise. */
async function press(target: Locator, mobile: boolean): Promise<void> {
  if (mobile) await target.tap()
  else await target.click()
}

/** From Begin to the first Matrix & Series question, with reaction time skipped. */
async function toFirstItem(page: Page): Promise<void> {
  await begin(page)
  await skipPart(page)
  await expect(h1(page)).toHaveText('Up next: Matrix & Series')
  await button(page, 'Start').click()
  await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
}

/**
 * Answer the question on screen, as far as the confidence slider (which is then on screen). `low`: the Confirm
 * button is at the bottom edge of the screen when it is pressed, as it is for a person who has just read a tall
 * question, so the slider and its Continue button are laid out below the fold.
 */
async function answerUntilSlider(page: Page, low = false): Promise<void> {
  const choice = page.locator('form.choice')
  const entry = page.locator('form.entry')
  await expect(choice.or(entry)).toBeVisible()
  const slider = page.getByRole('slider')
  if ((await choice.count()) > 0) {
    await choice.getByRole('radio').first().check()
    if (low) await button(page, 'Confirm').evaluate((el) => el.scrollIntoView({ block: 'end' }))
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
}

const scrollY = (page: Page): Promise<number> => page.evaluate(() => window.scrollY)

// ============================================================================ UX-001, UX-014

test.describe('a new question opens at its heading, and its Continue is in reach (UX-001, UX-014)', () => {
  for (const [name, size] of [['iPhone 13', undefined], ['iPhone SE', SE]] as const) {
    test.describe(name, () => {
      if (size !== undefined) test.use({ viewport: size })

      test('after Continue on the confidence panel the next question has its heading in view, at the top of the page', async ({ page, isMobile }) => {
        test.skip(isMobile !== true, 'the phone engines are where a new screen kept the old scroll offset')
        await toFirstItem(page)
        await answerUntilSlider(page)
        // The page sits at the bottom, as it does after a tap on a button low on the screen.
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        await button(page, 'Continue').tap()
        await expect(page.getByRole('slider')).toHaveCount(0)
        await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
        await expect(h1(page)).toBeInViewport()
        await expect.poll(() => scrollY(page)).toBe(0)
        await expect(h1(page)).toBeFocused()
      })

      test('the Spatial interstitial’s Start opens the part at its heading', async ({ page, isMobile }) => {
        test.skip(isMobile !== true, 'the phone engines are where a new screen kept the old scroll offset')
        await begin(page)
        for (const next of ['Up next: Matrix & Series', 'Up next: Spatial']) {
          await skipPart(page)
          await expect(h1(page)).toHaveText(next)
        }
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        await button(page, 'Start').tap()
        await expect(h1(page)).toHaveText('Spatial')
        await expect(h1(page)).toBeInViewport()
        await expect.poll(() => scrollY(page)).toBe(0)
      })

      test('"Continue" is in the viewport as soon as the slider has focus, whatever the question', async ({ page, isMobile }) => {
        test.skip(isMobile !== true, 'a phone is where the form fell below the fold')
        await toFirstItem(page)
        for (let n = 0; n < 3; n++) {
          await answerUntilSlider(page, true)
          // The whole button, not a corner of it.
          await expect(button(page, 'Continue')).toBeInViewport({ ratio: 1 })
          await expect(page.getByRole('slider')).toBeFocused()
          await button(page, 'Continue').tap()
          await expect(page.getByRole('slider')).toHaveCount(0)
          await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
        }
        await answerUntilSlider(page)
        await expectNoSeriousAxe(page)
      })
    })
  }

  test('a held Enter does not rate the question; the slider’s track is an edge you can see', async ({ page, isMobile }) => {
    test.skip(isMobile === true, 'a phone has no held keys')
    await toFirstItem(page)
    await answerUntilSlider(page)
    const slider = page.getByRole('slider')
    await expect(slider).toBeFocused()
    // Auto-repeat of the key that answered the question: the rating is not submitted by it (a fresh press is).
    const prevented = await slider.evaluate((el) => {
      const repeat = new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true })
      el.dispatchEvent(repeat)
      return repeat.defaultPrevented
    })
    expect(prevented).toBe(true)
    await expect(slider).toBeVisible()
    // The track has a border of at least 3:1 against the page (WCAG 1.4.11). The track is a pseudo-element, and the browsers do
    // not report its computed style (Chromium answers with its defaults: a black "none" border), so the check reads the
    // author rule for the track from the style sheets, resolves its colour variable on the slider as the scheme has it, and
    // compares that with the page colour behind the slider. Reading the pseudo's computed style passed by accident on macOS.
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      const edge = await slider.evaluate((el) => {
        const rules: CSSStyleRule[] = []
        const visit = (list: CSSRuleList): void => {
          for (const rule of Array.from(list)) {
            if (rule instanceof CSSStyleRule && /slider-runnable-track/.test(rule.selectorText) && el.matches(rule.selectorText.replace(/::[\w-]+$/, ''))) rules.push(rule)
            else if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules)
          }
        }
        for (const sheet of Array.from(document.styleSheets)) visit(sheet.cssRules)
        const own = getComputedStyle(el)
        const css = rules.at(-1)?.style
        // `border: 1px solid var(--r-border)`: with a variable in it the browser keeps the shorthand whole, so read it as text.
        const border = (css?.getPropertyValue('border') || css?.getPropertyValue('border-top') || '').trim()
        const parts = /^(\S+)\s+(\S+)\s+(.+)$/.exec(border)
        const width = parts?.[1] ?? css?.getPropertyValue('border-top-width') ?? ''
        const style = parts?.[2] ?? css?.getPropertyValue('border-top-style') ?? ''
        let color = parts?.[3] ?? css?.getPropertyValue('border-top-color') ?? ''
        const variable = /^var\((--[\w-]+)/.exec(color)
        if (variable !== null) color = own.getPropertyValue(variable[1]!).trim()
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 1
        const ctx = canvas.getContext('2d')!
        const rgb = (c: string): number[] => {
          ctx.clearRect(0, 0, 1, 1)
          ctx.fillStyle = '#000'
          ctx.fillStyle = c
          ctx.fillRect(0, 0, 1, 1)
          return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3)
        }
        const lum = (c: number[]): number => {
          const [r, g, b] = c.map((v) => {
            const x = v / 255
            return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
          })
          return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
        }
        let behind: Element | null = el
        let bg = 'rgba(0, 0, 0, 0)'
        while (behind !== null && /rgba\(.*,\s*0\)$|transparent/.test(bg)) {
          bg = getComputedStyle(behind).backgroundColor
          behind = behind.parentElement
        }
        const [a, b] = [lum(rgb(color)), lum(rgb(bg))]
        return { found: rules.length, width, style, color, bg, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }
      })
      expect(edge.found, 'the author rule for the slider track is in the style sheets').toBeGreaterThan(0)
      expect(edge.style, 'the track has a drawn edge').toBe('solid')
      expect(Number.parseFloat(edge.width), 'the track edge is at least 1 px').toBeGreaterThanOrEqual(1)
      expect(edge.ratio, `track edge ${edge.color} against the page ${edge.bg} in ${scheme}`).toBeGreaterThanOrEqual(3)
    }
  })
})

// ================================================================================== UX-003

test.describe('the header of a running session is small, and its notices do not linger (UX-003)', () => {
  test.describe('iPhone SE', () => {
    test.use({ viewport: SE })

    test('on every kind of screen the header ends within 120 px, and the buttons keep their full names', async ({ page, isMobile }) => {
      test.skip(isMobile !== true, 'the 320 px header is the phone’s')
      const header = page.locator('header.top')
      const bottom = async (): Promise<number> => (await header.boundingBox())!.y + (await header.boundingBox())!.height
      await begin(page)
      expect(await bottom(), 'interstitial').toBeLessThanOrEqual(120)
      await skipPart(page)
      await button(page, 'Start').click()
      await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
      expect(await bottom(), 'question').toBeLessThanOrEqual(120)
      // The names are those the drivers and voice control use, though a phone shows only their first word.
      await expect(page.getByRole('button', { name: 'Skip Matrix & Series', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Finish early', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Skip Matrix & Series', exact: true })).toHaveText(/^Skip/)
      await answerUntilSlider(page)
      expect(await bottom(), 'confidence').toBeLessThanOrEqual(120)
      await overflow(page, 'the header at 320 px')
    })
  })

  test('"Reaction Time skipped" is told on the next screen and not on the one after it', async ({ page }) => {
    await begin(page)
    await skipPart(page)
    await expect(h1(page)).toHaveText('Up next: Matrix & Series')
    await expect(page.getByRole('status').first()).toContainText('Reaction Time skipped')
    await button(page, 'Start').click()
    await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
    await expect(page.getByRole('status').first()).toHaveText('')
  })
})

// ============================================================================ UX-004, UX-005a

test.describe('practice and the confirmation panels (UX-004, UX-005a)', () => {
  test('"Stop practice" leaves in one press, to the ready screen with its heading in focus', async ({ page }) => {
    await toReady(page)
    await button(page, 'Try practice questions first').click()
    await expect(h1(page)).toHaveText('Practice')
    await expect(h1(page)).toBeFocused()
    await button(page, 'Stop practice').click()
    await expect(h1(page)).toHaveText('Ready when you are')
    await expect(h1(page)).toBeFocused()
  })

  test('the next practice question is a new screen with its heading in focus; the verdict is told in a status line', async ({ page, isMobile }) => {
    test.skip(isMobile === true, 'the keyboard path is the desktop engines’ (keyboard-session.spec.ts has the whole of it)')
    await toReady(page)
    await button(page, 'Try practice questions first').click()
    await answerUntilSlider(page)
    await button(page, 'Continue').click()
    // The feedback has focus, and the hidden status line holds the verdict (which differs from the visible words).
    await expect(page.locator('section.feedback')).toBeFocused()
    await expect(page.locator('p.hb-sr-only[role="status"]')).toHaveText(/^Your answer was (not )?correct\. The right answer is /)
    await button(page, 'Next practice question').click()
    await expect(page.getByText('Practice question 2 of 4')).toBeVisible()
    await expect(h1(page)).toBeFocused()
    await expect(page.locator('p.hb-sr-only[role="status"]')).toHaveText('')
  })

  test('Escape closes a confirmation, and "Keep going" in a running block gives the block its keys back', async ({ page, isMobile }) => {
    test.skip(isMobile === true, 'needs a keyboard')
    await begin(page)
    await button(page, 'Start').click()
    await expect(h1(page)).toHaveText('Reaction Time')
    await button(page, 'Start practice').click()
    const block = page.locator('section.hb-render.rt')
    await expect(block.locator('.stage')).toBeVisible()
    await button(page, 'Skip Reaction Time').click()
    await expect(page.getByRole('heading', { level: 2, name: 'Skip Reaction Time?' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.locator('section.confirm')).toHaveCount(0)
    // Focus is on the block's own stage, so the next key is a response ...
    await expect(block.locator('.stage')).toBeFocused()
    // ... and Space does not open the panel again, as it did from the Skip button.
    await page.keyboard.press('Space')
    await expect(page.locator('section.confirm')).toHaveCount(0)
    await expect(block.locator('.stage')).toBeFocused()
    // "Keep going" does the same as Escape.
    await button(page, 'Skip Reaction Time').click()
    await button(page, 'Keep going').click()
    await expect(block.locator('.stage')).toBeFocused()
  })

  test('Escape closes the finish panel and returns to the button that opened it', async ({ page, isMobile }) => {
    test.skip(isMobile === true, 'needs a keyboard')
    await begin(page)
    await button(page, 'Finish early').click()
    await expect(page.getByRole('heading', { level: 2, name: 'Finish now?' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.locator('section.confirm')).toHaveCount(0)
    await expect(button(page, 'Finish early')).toBeFocused()
    await expect(h1(page)).toHaveText('Up next: Reaction Time')
  })

  test.describe('a phone', () => {
    test('a double tap on "Finish early" leaves the panel open', async ({ page, isMobile }) => {
      test.skip(isMobile !== true, 'a double tap is a finger’s')
      await begin(page)
      const finish = button(page, 'Finish early')
      const box = (await finish.boundingBox())!
      const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      await page.touchscreen.tap(at.x, at.y)
      await page.waitForTimeout(80)
      await page.touchscreen.tap(at.x, at.y)
      await page.waitForTimeout(400)
      await expect(page.getByRole('heading', { level: 2, name: 'Finish now?' })).toBeVisible()
      // A deliberate tap on "Keep going" a moment later is a decision.
      await button(page, 'Keep going').tap()
      await expect(page.locator('section.confirm')).toHaveCount(0)
    })
  })
})

// ====================================================================================== UX-006

test.describe('focus and the tab title follow the screen (UX-006)', () => {
  test('"Back to the start" lands on the welcome heading, and the tab names every screen it is on', async ({ page }) => {
    await page.goto('./')
    await expect(page).toHaveTitle('HumanBench')
    await expect(page.locator('body')).toBeFocused() // the first screen of a page load leaves focus alone
    await button(page, 'Start').click()
    await expect(page).toHaveTitle('Before you start · HumanBench')
    await page.getByRole('checkbox', { name: /18 or older/ }).check()
    await button(page, 'Continue').click()
    await expect(page).toHaveTitle('Honour code · HumanBench')
    // A missing tick is marked on the box itself.
    await button(page, 'Continue').click()
    const box = page.getByRole('checkbox', { name: /honour code/ })
    await expect(box).toHaveAttribute('aria-invalid', 'true')
    await box.check()
    await expect(box).not.toHaveAttribute('aria-invalid', 'true')
    await button(page, 'Continue').click()
    await expect(h1(page)).toHaveText('Check your device')
    await expect(page).toHaveTitle('Check your device · HumanBench')
    await expect(button(page, 'Continue')).toBeEnabled({ timeout: 20_000 })
    await button(page, 'Continue').click()
    await button(page, 'Begin').click()
    await button(page, 'Finish early').click()
    await button(page, 'Finish now').click()
    await expect(h1(page)).toHaveText('Session ended') // nothing answered, nothing measured (UX-009b)
    await expect(page).toHaveTitle('Session ended · HumanBench')
    await button(page, 'Back to the start').click()
    await expect(h1(page)).toHaveText('HumanBench')
    await expect(h1(page)).toBeFocused()
    await expect(page).toHaveTitle('HumanBench')
    await expect(h1(page)).toHaveAttribute('translate', 'no')
  })

  test('back from the privacy notice, focus is on the screen’s heading', async ({ page }) => {
    await page.goto('./')
    await button(page, 'Start').click()
    await page.getByRole('link', { name: /privacy notice and terms/ }).click()
    await expect(h1(page)).toHaveText('Privacy and terms')
    await page.getByRole('link', { name: 'Back' }).click()
    await expect(h1(page)).toHaveText('Before you start')
    await expect(h1(page)).toBeFocused()
  })
})

// ====================================================================================== UX-007a

test.describe('the checklist (UX-007a)', () => {
  test('one "Up next", and rows that do not split a word at 320 px', async ({ page }) => {
    await page.setViewportSize(SE)
    await begin(page)
    const list = page.getByRole('region', { name: 'Session checklist' })
    await expect(list.getByText('Up next', { exact: true })).toHaveCount(1)
    await expect(list.getByText('Later', { exact: true })).toHaveCount(2)
    // Words wrap at their edges (or at a slash), and a row stays inside the screen.
    const rows = await list.getByRole('listitem').evaluateAll((items) =>
      items.map((li) => {
        const name = li.querySelector('.name') as HTMLElement
        const style = getComputedStyle(name)
        return { right: li.getBoundingClientRect().right, wrap: style.overflowWrap, text: li.textContent ?? '' }
      }),
    )
    for (const row of rows) {
      expect(row.right, row.text).toBeLessThanOrEqual(SE.width)
      expect(row.wrap, row.text).toBe('break-word')
    }
    await overflow(page, 'the checklist')
  })
})

// ================================================================================== UX-008, UX-009a

test.describe('one session length, and a finished screen that says what the profile rests on (UX-008, UX-009a)', () => {
  test('welcome, ready and the ring all say about 30 minutes', async ({ page }) => {
    await page.goto('./')
    await expect(page.getByText(/about 30 minutes/)).toBeVisible()
    await toReady(page)
    await expect(page.getByText(/about 30 minutes/)).toBeVisible()
    await button(page, 'Begin').click()
    await expect(page.getByRole('progressbar', { name: 'Session time' })).toHaveAttribute('aria-valuetext', '0 of about 30 min')
  })

  test('finishing at once: the way back is the first button and the file is behind a disclosure', async ({ page }) => {
    await begin(page)
    await button(page, 'Finish early').click()
    await button(page, 'Finish now').click()
    await expect(h1(page)).toHaveText('Session ended') // UX-009b
    await expect(page.getByText('Nothing was measured')).toBeVisible()
    const main = page.locator('main')
    const first = main.getByRole('button').first()
    await expect(first).toHaveText('Back to the start')
    await expect(first).toHaveClass(/hb-primary/)
    await expect(button(page, 'Download save file')).not.toBeVisible()
    await main.getByText('Keep a file of this visit anyway').click()
    await expect(button(page, 'Download save file')).toBeVisible()
    // The plain column, not the wide one with its indent.
    await expect(main).not.toHaveClass(/wide/)
    await expectNoSeriousAxe(page)
  })

  test('a person with earlier sessions who finishes at once is told this visit added nothing', async ({ page }) => {
    const sim = simulatedSave(1)
    await toReady(page)
    await loadSave(page, sim.save)
    await button(page, 'Begin').click()
    await button(page, 'Finish early').click()
    await button(page, 'Finish now').click()
    await expect(h1(page)).toHaveText('Session complete')
    await expect(page.getByText(/This visit added no new answers\. Your profile below comes from 1 earlier session\./)).toBeVisible()
    await expect(page.getByText(/You answered 0 questions/)).toHaveCount(0)
    await expect(page.locator('svg.hb-blob').first()).toBeVisible()
  })
})

// ====================================================================================== UX-010

test.describe('earlier results without a new session (UX-010)', () => {
  test('"See my results" shows the profile of the loaded file, and the file downloaded from it has the same sessions', async ({ page, isMobile }, info) => {
    const sim = simulatedSave(2)
    const loaded = (sim.save as { sessions: unknown[] }).sessions.length
    await toReady(page)
    expect(await button(page, 'See my results').count()).toBe(0)
    await loadSave(page, sim.save)
    await press(button(page, 'See my results'), isMobile === true)
    await expect(h1(page)).toHaveText('Your results')
    await expect(page.getByText(/Your profile from 2 earlier sessions\./)).toBeVisible()
    await expect(page.locator('svg.hb-blob').first()).toBeVisible()
    // Nothing was written: no session was started, so there is no autosave.
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('hb:save:v1:')))).toEqual([])
    const download = page.waitForEvent('download')
    await press(button(page, 'Download save file'), isMobile === true)
    const file = await download
    const path = info.outputPath('see-my-results.hbsave.json')
    await file.saveAs(path)
    const saved = JSON.parse(readFileSync(path, 'utf8')) as { sessions: unknown[] }
    expect(saved.sessions).toHaveLength(loaded)
    await expectNoSeriousAxe(page)
  })
})

// ====================================================================================== UX-011

test.describe('leaving a session by accident (UX-011)', () => {
  test('the browser’s Back button during an item asks "Finish now?" and stays where it was', async ({ page, isMobile, browserName }) => {
    test.skip(isMobile === true || browserName !== 'chromium', 'one desktop engine is enough for the history')
    await toFirstItem(page)
    const url = page.url()
    await page.goBack()
    await expect(page.getByRole('heading', { level: 2, name: 'Finish now?' })).toBeVisible()
    await expect(h1(page)).toHaveText('Matrix & Series')
    expect(page.url()).toBe(url)
    // Keep going, and the question is still there; a second Back asks again.
    await button(page, 'Keep going').click()
    await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
    await page.goBack()
    await expect(page.getByRole('heading', { level: 2, name: 'Finish now?' })).toBeVisible()
    await button(page, 'Finish now').click()
    await expect(h1(page)).toHaveText('Session ended') // nothing was answered (UX-009b)
  })

  test('closing or reloading the tab asks once the run holds an answer, and not before', async ({ page, isMobile }) => {
    test.skip(isMobile === true, 'a phone does not reload a page from a test')
    const dialogs: string[] = []
    page.on('dialog', (d) => {
      dialogs.push(d.type())
      void d.accept()
    })
    await begin(page)
    expect(await unloadIsGuarded(page)).toBe(false) // an abandoned start leaves nothing behind
    await skipPart(page)
    await button(page, 'Start').click()
    await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
    expect(await unloadIsGuarded(page)).toBe(false)
    await answerUntilSlider(page)
    await button(page, 'Continue').click()
    await expect(page.getByRole('slider')).toHaveCount(0)
    expect(await unloadIsGuarded(page)).toBe(true)
    await page.reload()
    expect(dialogs).toEqual(['beforeunload'])
  })

  test('the footer links the notice from every screen but the welcome (which has its own link); during a run it opens a new tab and the run goes on', async ({ page, context }) => {
    await page.goto('./')
    // The welcome has its own link under Start: one link, not two (VER-02).
    await expect(page.getByRole('link', { name: 'Privacy and terms' })).toHaveCount(1)
    await expect(page.getByRole('contentinfo').getByRole('link')).toHaveCount(0)
    await expect(page.locator('main').getByRole('link', { name: 'Privacy and terms' })).toHaveAttribute('href', '#/privacy')
    await button(page, 'Start').click()
    await expect(h1(page)).toHaveText('Before you start')
    const link = page.getByRole('contentinfo').getByRole('link', { name: 'Privacy and terms' })
    await expect(link).toHaveAttribute('href', '#/privacy')
    await expect(link).not.toHaveAttribute('target', /.+/)
    await begin(page)
    const running = page.getByRole('contentinfo').getByRole('link', { name: 'Privacy and terms (opens in a new tab)' })
    await expect(running).toHaveAttribute('target', '_blank')
    await expect(running).toHaveAttribute('rel', /noopener/)
    const opened = context.waitForEvent('page')
    await running.click()
    const notice = await opened
    await expect(notice.getByRole('heading', { level: 1 })).toHaveText('Privacy and terms')
    await notice.close()
    await expect(h1(page)).toHaveText('Up next: Reaction Time')
    await expect(button(page, 'Finish early')).toBeVisible()
  })
})

// ===================================================================================== UX-012a

test.describe('the ready screen’s save file (UX-012a)', () => {
  test('a file that is chosen is loaded at once, and the new session says it is added to it', async ({ page }) => {
    const sim = simulatedSave(1)
    await toReady(page)
    await page.getByLabel('Save file').setInputFiles({ name: 'humanbench-save.txt', mimeType: 'text/plain', buffer: Buffer.from(JSON.stringify(sim.save)) })
    await expect(page.getByRole('status')).toHaveText('Loaded 1 earlier session. Your new session will be added to it.')
    await expect(page.getByText('Your new session will be added to 1 earlier session.')).toBeVisible()
    await expect(button(page, 'See my results')).toBeVisible()
  })

  test('a file that is not a save says why in one alert, tied to the field, and a valid code pasted after it loads', async ({ page }) => {
    const sim = simulatedSave(1)
    await toReady(page)
    const file = page.getByLabel('Save file')
    await file.setInputFiles({ name: 'photo.txt', mimeType: 'text/plain', buffer: Buffer.from('this is not a save') })
    // The failure is a role=alert element of its own; the status line (a role=status element) stays for what went well (UX-012a).
    const alert = page.getByRole('alert')
    const status = page.getByRole('status')
    await expect(alert).toHaveCount(1)
    await expect(alert).toContainText('not a HumanBench save')
    await expect(alert).toHaveClass(/error/)
    await expect(status).toHaveText('')
    await expect(file).toHaveAttribute('aria-invalid', 'true')
    const id = await alert.getAttribute('id')
    expect(id).toBeTruthy()
    await expect(file).toHaveAttribute('aria-describedby', id ?? 'none')
    // The field is empty again, so Begin is not held up by it, and the code can be pasted.
    await expect(file).toHaveValue('')
    await page.getByLabel('Or paste a save code').fill(JSON.stringify(sim.save))
    await expect(alert).toHaveCount(0)
    await button(page, 'Load').click()
    await expect(status).toContainText('Loaded 1 earlier session.')
    await expect(alert).toHaveCount(0)
  })

  test('a bad code is one alert tied to the code box, and typing again takes it away', async ({ page }) => {
    await toReady(page)
    const box = page.getByLabel('Or paste a save code')
    await box.fill('hello there')
    await button(page, 'Load').click()
    const alert = page.getByRole('alert')
    await expect(alert).toHaveCount(1)
    await expect(alert).toContainText('not a HumanBench save')
    await expect(box).toHaveAttribute('aria-invalid', 'true')
    await expect(box).toHaveAttribute('aria-describedby', (await alert.getAttribute('id')) ?? 'none')
    await expect(page.getByLabel('Save file')).not.toHaveAttribute('aria-invalid', /.*/)
    await expect(page.getByRole('status')).toHaveText('')
    await box.fill('hello there again')
    await expect(alert).toHaveCount(0)
    await expect(box).not.toHaveAttribute('aria-invalid', /.*/)
    await expect(box).not.toHaveAttribute('aria-describedby', /.*/)
  })

  test('a code that is pasted but not loaded keeps Begin from starting a session that would leave it out', async ({ page }) => {
    const sim = simulatedSave(1)
    await toReady(page)
    await page.getByLabel('Or paste a save code').fill(JSON.stringify(sim.save))
    await button(page, 'Begin').click()
    await expect(page.getByRole('alert')).toContainText('You chose a save file or pasted a code, but it is not loaded yet.')
    await expect(h1(page)).toHaveText('Ready when you are')
    await button(page, 'Load').click()
    await expect(page.getByRole('status')).toContainText('Loaded 1 earlier session.')
    await button(page, 'Begin').click()
    await expect(h1(page)).toHaveText('Up next: Reaction Time')
  })
})

// ====================================================================================== UX-013

test.describe('the device check (UX-013)', () => {
  test('"Continue" stays where it is when the facts arrive, and the facts explain their units', async ({ page, isMobile }) => {
    test.skip(isMobile !== true, 'the jump was the phone’s')
    await page.goto('./')
    await button(page, 'Start').click()
    await page.getByRole('checkbox', { name: /18 or older/ }).check()
    await button(page, 'Continue').click()
    await page.getByRole('checkbox', { name: /honour code/ }).check()
    await button(page, 'Continue').click()
    await expect(h1(page)).toHaveText('Check your device')
    const next = button(page, 'Continue')
    const before = (await next.boundingBox())!
    // While it measures the button waits but is a button in the tab order (aria-disabled, not disabled).
    if ((await page.locator('dl.facts').count()) === 0) {
      await expect(next).toHaveAttribute('aria-disabled', 'true')
      expect(await next.isDisabled()).toBe(true) // Playwright reads aria-disabled as disabled
    }
    await expect(page.locator('dl.facts')).toBeVisible({ timeout: 20_000 })
    const after = (await next.boundingBox())!
    expect(Math.abs(after.y - before.y), 'Continue moved').toBeLessThanOrEqual(1)
    await expect(next).not.toHaveAttribute('aria-disabled', 'true')
    await expect(page.locator('dl.facts')).toContainText(/\d+ Hz \(screen updates per second\)|not measured/)
    await expect(page.locator('dl.facts')).toContainText(/\(thousandths of a second\)|not measured/)
    await expect(page.getByText(/keep this browser window open and in front of other windows/)).toBeVisible()
    await expectNoSeriousAxe(page)
  })
})

// ================================================================================ UX-015, UX-016

test.describe('global styles and small copy fixes (UX-015, UX-016)', () => {
  test('a legend of several lines sits inside its frame at 390 px', async ({ page, isMobile }) => {
    test.skip(isMobile === true, 'the 390 px frame is checked on a desktop engine at that width')
    await page.setViewportSize({ width: 390, height: 800 })
    await page.goto('./')
    await button(page, 'Start').click()
    await page.getByRole('checkbox', { name: /18 or older/ }).check()
    await button(page, 'Continue').click()
    await page.getByRole('checkbox', { name: /honour code/ }).check()
    await button(page, 'Continue').click()
    await expect(page.locator('fieldset legend')).toBeVisible()
    const geometry = await page.locator('fieldset').first().evaluate((fs) => {
      const legend = fs.querySelector('legend')!.getBoundingClientRect()
      const first = fs.querySelector('label')!.getBoundingClientRect()
      const box = fs.getBoundingClientRect()
      return { legendTop: legend.top, legendBottom: legend.bottom, firstTop: first.top, boxTop: box.top, boxBottom: box.bottom }
    })
    // Inside the frame (below its top edge) and clear of the first control; the border runs through nothing.
    expect(geometry.legendTop).toBeGreaterThan(geometry.boxTop)
    expect(geometry.legendBottom).toBeLessThanOrEqual(geometry.firstTop + 0.5)
    expect(geometry.legendBottom).toBeLessThan(geometry.boxBottom)
  })

  test('printed on white paper in a dark system theme, the page is one flowing column with dark text', async ({ page, isMobile }) => {
    test.skip(isMobile === true, 'print layout is checked on a desktop engine')
    const sim = simulatedSave(1)
    await toReady(page)
    await loadSave(page, sim.save)
    await button(page, 'Begin').click()
    await button(page, 'Finish early').click()
    await button(page, 'Finish now').click()
    await expect(h1(page)).toHaveText('Session complete')
    await page.emulateMedia({ media: 'print', colorScheme: 'dark' })
    expect(await page.locator('#app').evaluate((el) => getComputedStyle(el).display)).toBe('block')
    const ratio = await page.evaluate(() => {
      const parse = (c: string): number[] => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
      const lum = (rgb: number[]): number => {
        const [r, g, b] = rgb.map((v) => {
          const s = (v ?? 0) / 255
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
      }
      const text = lum(parse(getComputedStyle(document.body).color))
      const paper = lum([255, 255, 255])
      return (Math.max(text, paper) + 0.05) / (Math.min(text, paper) + 0.05)
    })
    expect(ratio, 'the body text on white paper').toBeGreaterThanOrEqual(4.5)
    // The disclaimer and the link under it stay together in the flow, below the content, not over it.
    const footer = await page.getByRole('contentinfo').boundingBox()
    const main = await page.locator('main').boundingBox()
    expect(footer!.y).toBeGreaterThanOrEqual(main!.y + main!.height - 1)
  })

  test('on a phone the privacy link is its own 44 px target, clear of Start', async ({ page, isMobile }) => {
    test.skip(isMobile !== true, 'the crowding was the phone’s')
    await page.goto('./')
    const start = (await button(page, 'Start').boundingBox())!
    // The only link of that name on the page: the footer has none on the welcome screen (VER-02).
    const privacy = page.getByRole('link', { name: 'Privacy and terms' })
    await expect(privacy).toHaveCount(1)
    await expect(page.locator('main').getByRole('link', { name: 'Privacy and terms' })).toHaveCount(1)
    const link = (await privacy.boundingBox())!
    expect(link.y).toBeGreaterThanOrEqual(start.y + start.height + 8)
    expect(link.height).toBeGreaterThanOrEqual(44)
  })

  test('the interstitial and the question use the same nouns', async ({ page }) => {
    await begin(page)
    await skipPart(page)
    await expect(page.getByText('Pick the cell that completes a grid')).toBeVisible()
    await skipPart(page)
    await expect(page.getByText('Turn objects in your mind. Decide which option is the same object as the target, rotated.')).toBeVisible()
  })
})

// ===================================================================================== UX-017a

test.describe('a question the browser cannot draw (UX-017a)', () => {
  test.describe('iPhone SE', () => {
    test.use({ viewport: SE })

    test('its message and its way out are the first things on a 320 x 568 screen, said once', async ({ page, isMobile }) => {
      test.skip(isMobile !== true, 'the phone is where the way out was out of reach')
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
      const panel = page.locator('.unavailable')
      await expect(panel).toBeVisible({ timeout: 20_000 })
      await expect(panel.getByRole('button', { name: 'Skip Spatial' })).toBeInViewport()
      // The header does not say it a second time, and nor does the renderer that reported it: it stays mounted, but parked
      // out of sight and out of the accessibility tree, so the message is in the text a person sees and hears once (UX-017a).
      await expect(page.locator('header.top p.status')).toHaveText('')
      await expect(page.getByText('cannot be shown in your browser')).toHaveCount(1)
      await expect(page.getByText(ROTATION_UNAVAILABLE).filter({ visible: true })).toHaveCount(0)
      const seen = await page.locator('body').innerText()
      expect(seen.split('cannot be shown in your browser'), 'the message in the visible text').toHaveLength(2)
      expect(seen).not.toContain(ROTATION_UNAVAILABLE)
      const tree = await page.locator('body').ariaSnapshot()
      expect(tree.split('cannot be shown in your browser'), 'the message in the accessibility tree').toHaveLength(2)
      expect(tree).not.toContain('could not be drawn')
      await expect(page.locator('div.rotation')).toBeAttached()
      await expect(page.locator('div.rotation')).toBeHidden()
      await expectNoSeriousAxe(page)
      // The way out of the whole session is on the panel too.
      await panel.getByRole('button', { name: 'Finish early' }).click()
      await expect(page.getByRole('heading', { level: 2, name: 'Finish now?' })).toBeVisible()
    })
  })
})

// ====================================================================================== UX-018a

test.describe('the break offer (UX-018a)', () => {
  test('says what the break does to the clock and claims nothing about the person', async ({ page }) => {
    await page.clock.install()
    await begin(page)
    await page.clock.fastForward('31:00')
    await skipPart(page)
    await expect(h1(page)).toHaveText('Time for a break?')
    await expect(page.getByText('You have been working for about 30 minutes. You can take a short break now. The clock pauses while you rest.')).toBeVisible()
    await expect(page.getByText(/sharp|help you/i)).toHaveCount(0)
  })
})
