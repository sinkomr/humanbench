/// <reference lib="dom" />
/**
 * A whole session by keyboard alone (ROADMAP M1.21; DESIGN §13 "keyboard navigation for everything";
 * WCAG 2.1.1 keyboard, 2.1.2 no keyboard trap, 2.4.3 focus order, 2.4.7 focus visible): from the start
 * page through the gate, the honour code and the device check, the six parts of the session (reaction
 * time, matrix and series, spatial, working memory, quantitative, coding and reading) to the results,
 * the save, the share card and back to the start, on `?fast=1` so the 25 minutes take a couple of real
 * ones. The test never clicks, taps or types into anything it did not reach with Tab:
 *
 * - controls are reached with Tab (`keyboard.ts` picks the chord that reaches buttons in Safari) and
 *   used with Enter, Space, the arrow keys or typed text; a pointer guard in the page counts any real
 *   pointer event, and the test fails if there was one;
 * - after every screen change, focus is somewhere on the page (not on the body) and shows a focus
 *   indicator; a screen that drops focus is named in the failure;
 * - blocks are played the way a screen-reader user would: the reaction target is read from the live
 *   region the page announces, not from the picture.
 *
 * Desktop engines only: a touch phone has no Tab key (`reveal.spec.ts` and `session.spec.ts` cover its
 * taps). The M1.22 session e2e (WebKit save and upload) builds on the same `?fast=1` flow.
 */

import { expect, test, type Locator, type Page } from '@playwright/test'
import { focusInfo, focusIsOnPlainTarget, press, tabTo } from './keyboard'
import { partsPlayedProblems } from './parts'
import { SEGMENT_TITLES } from './routes'
import { useWideFont } from './wide-font'

/** A control by role and exact name. */
const control = (page: Page, role: 'button' | 'checkbox' | 'radio' | 'textbox' | 'slider', name: string | RegExp): Locator =>
  page.getByRole(role, { name, exact: typeof name === 'string' })

const heading = (page: Page): Locator => page.getByRole('heading', { level: 1 })

/** Counts real pointer events in the page: a keyboard-only run must leave it at 0. */
const POINTER_GUARD = `(() => {
  window.__hbPointer = 0
  for (const t of ['pointerdown', 'mousedown', 'touchstart', 'click', 'dblclick', 'wheel']) {
    addEventListener(t, (e) => { if (e.isTrusted && !(t === 'click' && e.detail === 0)) window.__hbPointer++ }, true)
  }
})()`

/** Progress lines for a failing run on CI or a slow machine: `KB_DEBUG=1 npm run e2e:a11y`. */
function debug(...parts: unknown[]): void {
  if (process.env.KB_DEBUG) console.log(new Date().toISOString().slice(14, 23), ...parts)
}

type Kind = 'finished' | 'confidence' | 'choice' | 'entry' | 'rt' | 'span' | 'corsi' | 'coding' | 'reading' | 'interstitial' | 'break' | 'other'

/** What is on screen, as far as the driver needs to know. */
const SCREEN = `(() => {
  const h1 = (document.querySelector('h1') || {}).textContent || ''
  const text = h1.trim()
  if (text === 'Session complete' || text === 'Session ended') return 'finished'
  if (document.querySelector('input[type=range]')) return 'confidence'
  if (document.querySelector('form.choice:not(:has(fieldset:disabled))')) return 'choice'
  if (document.querySelector('form.entry')) return 'entry'
  for (const k of ['rt', 'span', 'corsi', 'coding', 'reading']) if (document.querySelector('section.hb-render.' + k)) return k
  if (/^Up next:/.test(text)) return 'interstitial'
  if (text === 'Time for a break?') return 'break'
  return 'other'
})()`

class Taker {
  /** Screens that left no element with focus, with the heading they were on. */
  readonly lostFocus: string[] = []
  /** Screens whose focused control showed no focus indicator. */
  readonly noIndicator: string[] = []
  /** The kinds of screen visited, in order (no repeats in a row). */
  readonly visited: string[] = []
  /** The parts of the session, by the title of the interstitial that announced each, in the order they came. */
  readonly segments: string[] = []
  /** The kinds of screen played in each part, by the part's title. */
  readonly played = new Map<string, Set<string>>()

  constructor(
    readonly page: Page,
    readonly browserName: string,
  ) {}

  /** Reach a control with Tab and press Enter (or Space). */
  async activate(target: Locator, key: 'Enter' | 'Space' = 'Enter'): Promise<void> {
    await press(this.page, target, this.browserName, key)
  }

  async tabTo(target: Locator): Promise<void> {
    await tabTo(this.page, target, this.browserName)
  }

  /** Focus is on the page and shows where it is. Recorded, and reported at the end, with the screen it was on. */
  async checkFocus(where: string): Promise<void> {
    let info = await focusInfo(this.page)
    // A screen moves focus a frame after it is drawn: give it a moment before calling it lost.
    for (let wait = 0; wait < 10 && info.none; wait++) {
      await this.page.waitForTimeout(50)
      info = await focusInfo(this.page)
    }
    if (info.none) this.lostFocus.push(where)
    // A heading or container a screen moved focus to (tabindex -1) is the one place without a ring; a control is not exempt.
    else if (!info.indicator && !(await focusIsOnPlainTarget(this.page))) this.noIndicator.push(`${where}: ${info.what}`)
  }

  async screen(): Promise<Kind> {
    return this.page.evaluate<Kind>(SCREEN)
  }

  /** The part of the session on screen now (the last interstitial's title), or '' before the first. */
  private segment = ''

  private note(kind: string): void {
    if (this.visited[this.visited.length - 1] !== kind) this.visited.push(kind)
    if (this.segment !== '') this.played.get(this.segment)?.add(kind)
  }

  // ------------------------------------------------------------------ the start

  /** From the start page to the ready screen; `url` is `?fast=1` unless a test needs the real timeline. */
  async toReadyScreen(url = './?fast=1'): Promise<void> {
    const { page } = this
    await page.goto(url)
    await expect(heading(page)).toHaveText('HumanBench')
    await this.activate(control(page, 'button', 'Start'))
    await expect(heading(page)).toHaveText('Before you start')
    await expect(heading(page)).toBeFocused()
    await this.activate(control(page, 'checkbox', /18 or older/), 'Space')
    await this.activate(control(page, 'button', 'Continue'))
    await expect(heading(page)).toHaveText('Honour code')
    await expect(heading(page)).toBeFocused()
    await this.activate(control(page, 'checkbox', /honour code/), 'Space')
    await this.activate(control(page, 'button', 'Continue'))
    await expect(heading(page)).toHaveText('Check your device')
    await expect(control(page, 'button', 'Continue')).toBeEnabled({ timeout: 20_000 })
    // Keyboard is the default way to respond; the radio is reachable and already chosen.
    await expect(control(page, 'radio', 'Keyboard')).toBeChecked()
    await this.tabTo(control(page, 'radio', 'Keyboard'))
    await this.checkFocus('device check')
    await this.activate(control(page, 'button', 'Continue'))
    await expect(heading(page)).toHaveText('Ready when you are')
    await this.checkFocus('ready')
  }

  /** From the start page into the first part. */
  async toReady(url?: string): Promise<void> {
    const { page } = this
    await this.toReadyScreen(url)
    await this.activate(control(page, 'button', 'Begin'))
    await expect(heading(page)).toHaveText(/^Up next:/)
  }

  /** The practice question on screen: a choice or a typed answer, by keys, as far as the confidence slider. */
  async answerPractice(): Promise<void> {
    // A figure question keeps its options locked until the figures are drawn (the 3D view loads first): wait until it takes an answer.
    await expect.poll(() => this.screen(), { timeout: 15_000 }).toMatch(/^(choice|entry)$/)
    if ((await this.screen()) === 'choice') await this.answerChoice()
    else await this.answerEntry()
  }

  // ------------------------------------------------------------------ the parts

  /** One step of the session: whatever is on screen, done by keyboard. Returns false when the session is over. */
  async step(): Promise<boolean> {
    const { page } = this
    const kind = await this.screen()
    debug('screen', kind, (await heading(page).textContent().catch(() => '')) ?? '')
    const where = `${kind} (${((await heading(page).textContent()) ?? '').trim()})`
    if (kind === 'interstitial') {
      this.segment = ((await heading(page).textContent()) ?? '').replace(/^Up next:\s*/, '').trim()
      this.segments.push(this.segment)
      this.played.set(this.segment, new Set())
    }
    this.note(kind)
    // Every screen of the session, on arrival: focus is on the page and shows where it is (the results are checked below).
    if (kind !== 'finished' && kind !== 'other') await this.checkFocus(where)
    switch (kind) {
      case 'finished':
        return false
      case 'interstitial':
        await this.activate(control(page, 'button', 'Start'))
        break
      case 'break':
        await this.activate(control(page, 'button', 'Keep going'))
        break
      case 'choice':
        await this.answerChoice()
        break
      case 'entry':
        await this.answerEntry()
        break
      case 'confidence':
        await this.rateConfidence()
        break
      case 'rt':
        await this.playRt()
        break
      case 'span':
        await this.playDigits()
        break
      case 'corsi':
        await this.playCorsi()
        break
      case 'coding':
        await this.playCoding()
        break
      case 'reading':
        await this.playReading()
        break
      default:
        await page.waitForTimeout(100)
    }
    return true
  }

  /** A multiple-choice item: Tab to the options, pick B with its key, Enter to answer. */
  private async answerChoice(): Promise<void> {
    const { page } = this
    // The heading holds focus when the item appears; one Tab reaches the options (a radio group is one stop).
    await this.tabTo(page.locator('form.choice input[type=radio]').first())
    await this.checkFocus('multiple choice item')
    await page.keyboard.press('b')
    await expect(page.locator('form.choice input[type=radio]:checked')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('slider')).toBeVisible()
  }

  /** A typed item (series or quant): Tab to the box, type, Enter; a letter series wants a letter. */
  private async answerEntry(): Promise<void> {
    const { page } = this
    const box = page.locator('form.entry input[type=text]')
    await this.tabTo(box)
    await this.checkFocus('typed item')
    await page.keyboard.type('1')
    await page.keyboard.press('Enter')
    if (!(await page.getByRole('slider').isVisible({ timeout: 1500 }).catch(() => false))) {
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.type('A')
      await page.keyboard.press('Enter')
    }
    await expect(page.getByRole('slider')).toBeVisible()
  }

  /** The confidence slider has focus on arrival; nudge it with the arrow keys, then Tab to Continue. */
  private async rateConfidence(): Promise<void> {
    const { page } = this
    await expect(page.getByRole('slider')).toBeFocused()
    await this.checkFocus('confidence slider')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('PageUp')
    await this.activate(control(page, 'button', 'Continue'))
    await expect(page.getByRole('slider')).toHaveCount(0)
  }

  /**
   * A mounted block's own id (each mount of a renderer gets a fresh `aria-labelledby`), so a block can tell
   * that it is over when the session replaces it with the next one of the same kind.
   */
  private async blockId(kind: string): Promise<string> {
    return (await this.page.locator(`section.hb-render.${kind}`).getAttribute('aria-labelledby')) ?? ''
  }

  /** Wait until the block with this id has been replaced (by the next block, or the next screen). */
  private async blockOver(kind: string, id: string): Promise<void> {
    await this.page.waitForFunction(`(() => { const r = document.querySelector('section.hb-render.${kind}'); return !r || r.getAttribute('aria-labelledby') !== ${JSON.stringify(id)} })()`, undefined, { polling: 'raf', timeout: 20_000 })
  }

  /** Reaction Time, simple or four positions: read the target from the live region and press its key. */
  private async playRt(): Promise<void> {
    const { page } = this
    const rt = page.locator('section.hb-render.rt')
    const id = await this.blockId('rt')
    await this.activate(rt.getByRole('button', { name: 'Start practice' }))
    for (const stage of ['practice', 'counted']) {
      // After the practice trials the block waits for a button; after the counted ones it says it is complete.
      for (let guard = 0; guard < 400; guard++) {
        const seen = await page
          .waitForFunction(
            `(() => {
              const root = document.querySelector('section.hb-render.rt')
              if (!root || root.getAttribute('aria-labelledby') !== ${JSON.stringify(id)}) return 'gone'
              if (/Block complete/.test((root.querySelector('.hb-status') || {}).textContent || '')) return 'done'
              if ([...root.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Start')) return 'ready'
              const live = root.querySelector('[aria-live=assertive]')
              return (live && live.textContent.trim()) || ''
            })()`,
            undefined,
            { polling: 'raf', timeout: 8000 },
          )
          .then((h) => h.jsonValue() as Promise<string>)
        debug(stage, 'rt saw', seen)
        if (seen === 'gone' || seen === 'done' || seen === 'ready') break
        const position = /position (\d)/.exec(seen)
        // Simple: Space. Four positions: D F J K by the announced position.
        await page.keyboard.press(position === null ? 'Space' : ['d', 'f', 'j', 'k'][Number(position[1]) - 1]!)
        // Let the announcement clear before the next one is read.
        await page.waitForFunction(`!((document.querySelector('section.hb-render.rt [aria-live=assertive]') || {}).textContent || '').trim()`, undefined, { polling: 'raf', timeout: 3000 }).catch(() => undefined)
      }
      if (stage === 'practice') {
        await this.checkFocus('reaction time, practice done')
        await this.activate(rt.getByRole('button', { name: 'Start' }))
      }
    }
    // The block hands over to the next one (or the next interstitial) on its own.
    await this.blockOver('rt', id)
  }

  /** Digit span: type digits (the block ends after two misses at a length), Enter is Done. */
  private async playDigits(): Promise<void> {
    const { page } = this
    const span = page.locator('section.hb-render.span')
    const id = await this.blockId('span')
    await this.activate(span.getByRole('button', { name: 'Start' }))
    for (let guard = 0; guard < 40; guard++) {
      const phase = await page
        .waitForFunction(
          `(() => {
            const root = document.querySelector('section.hb-render.span')
            if (!root || root.getAttribute('aria-labelledby') !== ${JSON.stringify(id)}) return 'gone'
            const t = (root.querySelector('.hb-status') || {}).textContent || ''
            if (/Block complete/.test(t)) return 'done'
            if (/^Enter \\d+ digits/.test(t)) return 'entry'
            return ''
          })()`,
          undefined,
          { polling: 'raf', timeout: 20_000 },
        )
        .then((h) => h.jsonValue() as Promise<string>)
      if (phase !== 'entry') break
      await this.checkFocus('digit span, entry')
      await page.keyboard.type('123456789')
      await page.keyboard.press('Enter')
      // The entry is over once the status leaves "Enter ..." (the next sequence, or the end).
      await page.waitForFunction(`!/^Enter \\d+ digits/.test(((document.querySelector('section.hb-render.span .hb-status') || {}).textContent) || '')`, undefined, { polling: 'raf', timeout: 5000 }).catch(() => undefined)
    }
    await this.blockOver('span', id)
  }

  /** Corsi: pick blocks with their number keys, then Tab to Done. */
  private async playCorsi(): Promise<void> {
    const { page } = this
    const corsi = page.locator('section.hb-render.corsi')
    const id = await this.blockId('corsi')
    await this.activate(corsi.getByRole('button', { name: 'Start' }))
    for (let guard = 0; guard < 40; guard++) {
      const phase = await page
        .waitForFunction(
          `(() => {
            const root = document.querySelector('section.hb-render.corsi')
            if (!root || root.getAttribute('aria-labelledby') !== ${JSON.stringify(id)}) return 'gone'
            const t = (root.querySelector('.hb-status') || {}).textContent || ''
            if (/Block complete/.test(t)) return 'done'
            if (/^Selected \\d+ of \\d+/.test(t)) return 'entry'
            return ''
          })()`,
          undefined,
          { polling: 'raf', timeout: 20_000 },
        )
        .then((h) => h.jsonValue() as Promise<string>)
      if (phase !== 'entry') break
      await this.checkFocus('Corsi, entry')
      for (const k of ['1', '2', '3']) await page.keyboard.press(k)
      await this.activate(corsi.getByRole('button', { name: 'Done' }))
      await page.waitForFunction(`!/^Selected \\d+ of \\d+/.test(((document.querySelector('section.hb-render.corsi .hb-status') || {}).textContent) || '')`, undefined, { polling: 'raf', timeout: 5000 }).catch(() => undefined)
    }
    await this.blockOver('corsi', id)
  }

  /** Symbol-digit coding: press digits until the 90 (virtual) seconds are up. */
  private async playCoding(): Promise<void> {
    const { page } = this
    const coding = page.locator('section.hb-render.coding')
    const id = await this.blockId('coding')
    await this.activate(coding.getByRole('button', { name: 'Start' }))
    await expect(coding.getByRole('timer')).toBeVisible()
    await this.checkFocus('coding, running')
    for (let i = 0; i < 4000; i++) {
      await page.keyboard.press(String(1 + (i % 9)))
      // The status line says so when the window closes; if the block is already gone, so is the line.
      if (i % 25 === 0 && (await coding.locator('.hb-status').innerText({ timeout: 300 }).catch(() => 'over')).trim() !== '') break
    }
    await this.blockOver('coding', id)
  }

  /** Reading: show the passage, read it (a moment), Done reading, answer each question with the arrow keys, Submit. */
  private async playReading(): Promise<void> {
    const { page } = this
    const reading = page.locator('section.hb-render.reading')
    await this.activate(reading.getByRole('button', { name: 'Show the passage' }))
    await this.checkFocus('reading, passage')
    await expect(reading.getByRole('button', { name: 'Done reading' })).toBeEnabled()
    await this.activate(reading.getByRole('button', { name: 'Done reading' }))
    for (const group of await reading.locator('fieldset.question').all()) {
      await this.tabTo(group.locator('input[type=radio]').first())
      await page.keyboard.press('Space')
    }
    await this.checkFocus('reading, questions')
    await this.activate(reading.getByRole('button', { name: 'Submit answers' }))
  }
}

test.describe('the keyboard-only guards are not vacuous', () => {
  test('the pointer guard sees a real click, and not an Enter on a button', async ({ page, browserName, isMobile }) => {
    test.skip(isMobile === true, 'a touch phone has no Tab key')
    await page.addInitScript(POINTER_GUARD)
    await page.goto('./')
    await press(page, control(page, 'button', 'Start'), browserName)
    await expect(heading(page)).toHaveText('Before you start')
    expect(await page.evaluate<number>('window.__hbPointer'), 'a key press that activates a button is not a pointer event').toBe(0)
    await control(page, 'button', 'Continue').click()
    expect(await page.evaluate<number>('window.__hbPointer'), 'a real click is counted').toBeGreaterThan(0)
  })

  test('a heading or container that a screen moved focus to needs no ring, a control with tabindex -1 does', async ({ page, isMobile }) => {
    test.skip(isMobile === true, 'a touch phone has no Tab key')
    await page.setContent('<h1 tabindex="-1">Title</h1><div tabindex="-1" id="box">Box</div><button tabindex="-1">Press</button><input tabindex="-1" aria-label="Field"><div role="slider" tabindex="-1" aria-label="Level" aria-valuenow="1"></div><button>Plain</button>')
    for (const [selector, plain] of [['h1', true], ['#box', true], ['button[tabindex]', false], ['input', false], ['[role=slider]', false], ['button:not([tabindex])', false]] as const) {
      await page.locator(selector).focus()
      expect(await focusIsOnPlainTarget(page), selector).toBe(plain)
    }
  })

  test('the focus check notices a control whose focus indicator is hidden', async ({ page, browserName, isMobile }) => {
    test.skip(isMobile === true, 'a touch phone has no Tab key')
    await page.goto('./')
    const start = control(page, 'button', 'Start')
    await tabTo(page, start, browserName)
    expect((await focusInfo(page)).indicator).toBe(true)
    await page.addStyleTag({ content: '*:focus, *:focus-visible { outline: none !important; box-shadow: none !important; }' })
    expect((await focusInfo(page)).indicator).toBe(false)
  })
})

test.describe('practice by keyboard alone (UX-004, WCAG 2.4.3, 4.1.3)', () => {
  test('no step of the practice drops focus to the page, the feedback is where focus is, and one press leaves', async ({ page, browserName, isMobile }) => {
    test.skip(isMobile === true, 'a touch phone has no Tab key')
    test.setTimeout(3 * 60_000)
    await page.addInitScript(POINTER_GUARD)
    const taker = new Taker(page, browserName)
    await taker.toReadyScreen()
    await taker.activate(control(page, 'button', 'Try practice questions first'))
    for (let n = 1; n <= 4; n++) {
      await expect(heading(page)).toHaveText('Practice')
      await expect(page.getByText(`Practice question ${n} of 4`)).toBeVisible()
      // A new question is a new screen: its heading has focus, and one Tab reaches the field.
      await expect(heading(page)).toBeFocused()
      await taker.checkFocus(`practice question ${n}`)
      await taker.answerPractice()
      await expect(page.getByRole('slider')).toBeFocused()
      await taker.checkFocus(`practice confidence ${n}`)
      await taker.activate(control(page, 'button', 'Continue'))
      // The feedback arrives with focus on it (and a status line tells a screen reader the verdict).
      await expect(page.locator('section.feedback')).toBeFocused()
      await expect(page.locator('p.hb-sr-only[role="status"]')).toHaveText(/^Your answer was (not )?correct\./)
      await taker.checkFocus(`practice feedback ${n}`)
      await taker.activate(control(page, 'button', n < 4 ? 'Next practice question' : 'Finish practice'))
    }
    await expect(heading(page)).toHaveText('Practice complete')
    await expect(heading(page)).toBeFocused()
    await taker.activate(control(page, 'button', 'Continue'))
    await expect(heading(page)).toHaveText('Ready when you are')
    await expect(heading(page)).toBeFocused()
    // Leaving a practice by keys is one press, whichever question it is on.
    await taker.activate(control(page, 'button', 'Try practice questions first'))
    await expect(heading(page)).toBeFocused()
    await taker.activate(control(page, 'button', 'Stop practice'))
    await expect(heading(page)).toHaveText('Ready when you are')
    await expect(heading(page)).toBeFocused()
    expect(await page.evaluate<number>('window.__hbPointer')).toBe(0)
    expect(taker.lostFocus, 'screens where nothing had focus').toEqual([])
    expect(taker.noIndicator, 'focused controls with no focus indicator').toEqual([])
  })

  test('Keep going in a running block gives the keys back to the block, and Escape closes the panel', async ({ page, browserName, isMobile }) => {
    test.skip(isMobile === true, 'a touch phone has no Tab key')
    const taker = new Taker(page, browserName)
    // Real time, not ?fast=1: the practice block keeps running while the panel is open (an owner decision, D30), and at
    // 20 times speed its three trials can end before "Keep going" under machine load, taking the stage away. In real
    // time they last about ten seconds, far longer than these few presses.
    await taker.toReady('./')
    await taker.activate(control(page, 'button', 'Start'))
    await expect(heading(page)).toHaveText('Reaction Time')
    await taker.activate(control(page, 'button', 'Start practice'))
    const stage = page.locator('section.hb-render.rt .stage')
    await expect(stage).toBeVisible()
    await taker.activate(control(page, 'button', 'Skip Reaction Time'))
    await expect(page.getByRole('heading', { level: 2, name: 'Skip Reaction Time?' })).toBeFocused()
    await taker.activate(control(page, 'button', 'Keep going'))
    await expect(stage).toBeFocused()
    await taker.checkFocus('reaction time, after Keep going')
    await taker.activate(control(page, 'button', 'Skip Reaction Time'))
    await page.keyboard.press('Escape')
    await expect(page.locator('section.confirm')).toHaveCount(0)
    await expect(stage).toBeFocused()
    expect(taker.lostFocus).toEqual([])
    expect(taker.noIndicator).toEqual([])
  })
})

test.describe('a whole session by keyboard alone (?fast=1)', () => {
  test('start page to results, save, share card and back, with no pointer and focus always on the page', async ({ page, browserName, isMobile }) => {
    test.skip(isMobile === true, 'a touch phone has no Tab key')
    test.setTimeout(8 * 60_000)
    await useWideFont(page)
    await page.addInitScript(POINTER_GUARD)
    const taker = new Taker(page, browserName)

    await taker.toReady()

    // The session: until the results come up (or the 57-minute hard stop of the session clock).
    const t0 = Date.now()
    let steps = 0
    while (await taker.step()) {
      steps++
      expect(steps, 'the session did not finish').toBeLessThan(3000)
      expect(Date.now() - t0, 'the session took too long').toBeLessThan(6 * 60_000)
    }
    // Every part of the session was played, in the order of the plan (A15), and each one showed its own kind of screen.
    expect(taker.segments, 'the parts of the session, by their interstitials').toEqual([...SEGMENT_TITLES])
    // Each part showed the kinds of screen it cannot do without (`parts.ts`: the Matrix & Series part serves both a matrix and a series item, because the selector balances the two families).
    expect(partsPlayedProblems(taker.played), 'screens a part of the session did not show').toEqual([])

    // The results.
    debug('results')
    await expect(heading(page)).toHaveText('Session complete')
    await expect(heading(page)).toBeFocused()
    // The build-up runs by itself (fast mode makes it brief); "Skip animation" by keyboard is `reveal.spec.ts`.
    await expect(page.locator('.reveal [role="status"]').first()).toHaveText('Your profile is ready.', { timeout: 30_000 })
    await taker.checkFocus('results')

    // The save is required: reach it with the keyboard and take it (a download on desktop engines).
    const download = page.waitForEvent('download')
    await taker.activate(control(page, 'button', 'Download save file'))
    expect((await download).suggestedFilename()).toMatch(/\.hbsave\.json$/)
    const card = page.locator('[data-share-card]')
    await expect(card).toBeVisible()

    // The share card: turn a skill off and on with Space, take the vector image.
    const skills = card.locator('fieldset.skills input[type=checkbox]')
    const first = skills.first()
    await taker.activate(first, 'Space')
    await expect(first).not.toBeChecked()
    await taker.activate(first, 'Space')
    await expect(first).toBeChecked()
    const svg = page.waitForEvent('download')
    await taker.activate(control(page, 'button', 'Download vector image (SVG)'))
    expect((await svg).suggestedFilename()).toMatch(/\.svg$/)

    // A disclosure opens with Enter on its summary; the way back goes to the start.
    const worked = page.locator('[data-section="worked"] details').first()
    await taker.tabTo(worked.locator('summary'))
    await taker.checkFocus('worked solution')
    await page.keyboard.press('Enter')
    await expect(worked).toHaveAttribute('open', '')
    await taker.activate(control(page, 'button', 'Back to the start'))
    await expect(heading(page)).toHaveText('HumanBench')

    // Nobody touched a pointer, and no screen dropped focus or hid it.
    expect(await page.evaluate<number>('window.__hbPointer')).toBe(0)
    expect(taker.lostFocus, 'screens where nothing had focus').toEqual([])
    expect(taker.noIndicator, 'focused controls with no focus indicator').toEqual([])
  })
})
