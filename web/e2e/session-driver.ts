/// <reference lib="dom" />
/**
 * Playing a whole `?fast=1` session with a pointer or a finger (ROADMAP M1.22; DESIGN §14.3, M1
 * acceptance 4). `keyboard-session.spec.ts` plays the same session with Tab, Enter and the arrow keys
 * to prove it can be done without a pointer; this driver plays it the way most people do:
 *
 * - a desktop taker clicks (choices, Submit, Continue, Done) and types the digit keys and the reaction
 *   keys, with the keyboard as the response mode of the reaction tasks (the device check's default);
 * - a phone taker taps, with "Tap or click" as the response mode, and uses the on-screen keypads and
 *   boards instead of any key. Playwright's `tap()` sends touch events, so the renderers see
 *   `pointerType: 'touch'` as they would on an iPhone.
 *
 * The driver only looks at what a person sees (headings, buttons, the renderers' own regions); it
 * never reads or sets session state. Answers are not chosen to score well: the point is that every
 * part of the session runs, in the order of the plan (A15), and ends in the results and the save.
 * The e2e tsconfig has no DOM lib, so page code that waits for a renderer is passed as strings.
 */

import { expect, type Locator, type Page } from '@playwright/test'
import { button, h1 } from './flow'

/** What is on screen, as far as the driver needs to know. */
export type Screen = 'finished' | 'confidence' | 'choice' | 'entry' | 'rt' | 'span' | 'corsi' | 'coding' | 'reading' | 'interstitial' | 'break' | 'other'

const SCREEN = `(() => {
  const text = ((document.querySelector('h1') || {}).textContent || '').trim()
  if (text === 'Session complete') return 'finished'
  if (document.querySelector('input[type=range]')) return 'confidence'
  if (document.querySelector('form.choice:not(:has(fieldset:disabled))')) return 'choice'
  if (document.querySelector('form.entry')) return 'entry'
  for (const k of ['rt', 'span', 'corsi', 'coding', 'reading']) if (document.querySelector('section.hb-render.' + k)) return k
  if (/^Up next:/.test(text)) return 'interstitial'
  if (text === 'Time for a break?') return 'break'
  return 'other'
})()`

export interface DriverOptions {
  /** A finger on a phone: taps, and the on-screen keypads. Otherwise a mouse and the keyboard. */
  readonly touch: boolean
}

export class SessionDriver {
  /** The parts of the session, by the title of the interstitial that announced each, in the order they came. */
  readonly segments: string[] = []
  /** The kinds of screen played in each part, by the part's title. */
  readonly played = new Map<string, Set<string>>()
  /** Items answered (a choice or a typed answer, each followed by its confidence rating). */
  answered = 0
  #segment = ''

  constructor(
    readonly page: Page,
    readonly opts: DriverOptions,
  ) {}

  /** Tap (a finger) or click (a mouse). */
  async press(target: Locator): Promise<void> {
    if (this.opts.touch) await target.tap()
    else await target.click()
  }

  /** Tick a checkbox or choose a radio button, and see that it took. */
  async tick(box: Locator): Promise<void> {
    if (this.opts.touch) await box.tap()
    else await box.check()
    await expect(box).toBeChecked()
  }

  // ------------------------------------------------------------------ the start

  /**
   * From the start page to the ready screen, through the gate (skipped on a device that already holds the
   * consent record), the honour code and the device check, choosing the response mode of this taker.
   */
  async toReady(url = './?fast=1'): Promise<void> {
    const { page } = this
    await page.goto(url)
    await expect(h1(page)).toHaveText('HumanBench')
    await this.press(button(page, 'Start'))
    await expect(h1(page)).toHaveText(/^(Before you start|Honour code)$/)
    if (((await h1(page).textContent()) ?? '').trim() === 'Before you start') {
      await this.tick(page.getByRole('checkbox', { name: /18 or older/ }))
      await this.press(button(page, 'Continue'))
    }
    await expect(h1(page)).toHaveText('Honour code')
    await this.tick(page.getByRole('checkbox', { name: /honour code/ }))
    await this.press(button(page, 'Continue'))
    await expect(h1(page)).toHaveText('Check your device')
    await expect(button(page, 'Continue')).toBeEnabled({ timeout: 20_000 })
    await this.tick(page.getByRole('radio', { name: this.opts.touch ? 'Tap or click' : 'Keyboard' }))
    await this.press(button(page, 'Continue'))
    await expect(h1(page)).toHaveText('Ready when you are')
  }

  /** From the ready screen into the first part. */
  async begin(): Promise<void> {
    await this.press(button(this.page, 'Begin'))
    await expect(h1(this.page)).toHaveText('Up next: Reaction time')
  }

  /** Skip the part on the interstitial (it asks first, like the skip during an item). */
  async skipPart(): Promise<void> {
    const { page } = this
    await this.press(button(page, 'Skip this part'))
    await this.press(page.locator('section.confirm').getByRole('button', { name: /^Skip / }))
  }

  /**
   * From the first interstitial: skip the reaction tasks and answer one item of Matrix & Series (with its
   * confidence rating), so the session has something to keep: a session with no answer writes no autosave.
   */
  async answerOne(): Promise<void> {
    const { page } = this
    await this.skipPart()
    await expect(h1(page)).toHaveText('Up next: Matrix & Series')
    await this.press(button(page, 'Start'))
    await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
    await this.step() // the item
    await this.step() // its confidence
    await expect(page.getByRole('slider')).toHaveCount(0)
  }

  /** Finish at once (from an interstitial or between items): the results of the save the session started from, plus this session. */
  async finishEarly(): Promise<void> {
    const { page } = this
    await this.press(button(page, 'Finish early'))
    await this.press(button(page, 'Finish now'))
    await expect(h1(page)).toHaveText('Session complete')
  }

  // ------------------------------------------------------------------ the session

  /** Play every part of the session until the results come up (or `limitMs` is used up). */
  async playToResults(limitMs = 6 * 60_000): Promise<void> {
    const t0 = Date.now()
    for (let steps = 0; await this.step(); steps++) {
      expect(steps, 'the session did not finish').toBeLessThan(3000)
      expect(Date.now() - t0, 'the session took too long').toBeLessThan(limitMs)
    }
    await expect(h1(this.page)).toHaveText('Session complete')
  }

  async screen(): Promise<Screen> {
    return this.page.evaluate<Screen>(SCREEN)
  }

  /** Whatever is on screen, done the way this taker would do it. False when the session is over. */
  async step(): Promise<boolean> {
    const { page } = this
    const kind = await this.screen()
    if (kind === 'interstitial') {
      this.#segment = ((await h1(page).textContent()) ?? '').replace(/^Up next:\s*/, '').trim()
      this.segments.push(this.#segment)
      this.played.set(this.#segment, new Set())
    }
    if (this.#segment !== '' && kind !== 'finished') this.played.get(this.#segment)?.add(kind)
    switch (kind) {
      case 'finished':
        return false
      case 'interstitial':
        await this.press(button(page, 'Start'))
        break
      case 'break':
        await this.press(button(page, 'Keep going'))
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

  /** A multiple-choice item: choose an option (not always the first), then Confirm. */
  private async answerChoice(): Promise<void> {
    const { page } = this
    const options = page.locator('form.choice input[type=radio]')
    await this.tick(options.nth(this.answered % Math.max(1, await options.count())))
    await this.press(button(page, 'Confirm'))
    await expect(page.getByRole('slider')).toBeVisible()
    this.answered++
  }

  /** A typed item (series or quant): a letter series wants a letter, the others a number. */
  private async answerEntry(): Promise<void> {
    const { page } = this
    const box = page.locator('form.entry input[type=text]')
    await box.fill((await box.evaluate((el) => el.classList.contains('letter'))) ? 'A' : '1')
    await this.press(page.locator('form.entry').getByRole('button', { name: 'Submit', exact: true }))
    await expect(page.getByRole('slider')).toBeVisible()
    this.answered++
  }

  /** The confidence slider: a value that varies from item to item, then Continue. */
  private async rateConfidence(): Promise<void> {
    const { page } = this
    const slider = page.getByRole('slider')
    await slider.fill(String(55 + ((this.answered * 9) % 40)))
    await this.press(button(page, 'Continue'))
    await expect(slider).toHaveCount(0)
  }

  /** A block's own id (each mount of a renderer gets a fresh `aria-labelledby`), to tell when the next block replaced it. */
  private async blockId(kind: string): Promise<string> {
    return (await this.page.locator(`section.hb-render.${kind}`).getAttribute('aria-labelledby')) ?? ''
  }

  /** Wait until the block with this id has been replaced (by the next block, or the next screen). */
  private async blockOver(kind: string, id: string): Promise<void> {
    await this.page.waitForFunction(`(() => { const r = document.querySelector('section.hb-render.${kind}'); return !r || r.getAttribute('aria-labelledby') !== ${JSON.stringify(id)} })()`, undefined, { polling: 'raf', timeout: 20_000 })
  }

  /** Wait until the renderer's status line matches `entry` (a RegExp source: it wants an entry) or the block is over, and say which. */
  private async phaseOf(kind: string, id: string, entry: string): Promise<'gone' | 'done' | 'entry'> {
    const handle = await this.page.waitForFunction(
      `(() => {
        const root = document.querySelector('section.hb-render.${kind}')
        if (!root || root.getAttribute('aria-labelledby') !== ${JSON.stringify(id)}) return 'gone'
        const t = (root.querySelector('.hb-status') || {}).textContent || ''
        if (/Block complete/.test(t)) return 'done'
        if (new RegExp(${JSON.stringify(entry)}).test(t)) return 'entry'
        return ''
      })()`,
      undefined,
      { polling: 'raf', timeout: 20_000 },
    )
    return (await handle.jsonValue()) as 'gone' | 'done' | 'entry'
  }

  /**
   * Reaction time, simple or four positions: wait for each target (the box that lights up), then press
   * its key or tap it. A target that is gone by the time the press arrives is a miss, as for any taker.
   */
  private async playRt(): Promise<void> {
    const { page } = this
    const rt = page.locator('section.hb-render.rt')
    const id = await this.blockId('rt')
    await this.press(rt.getByRole('button', { name: 'Start practice' }))
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
              const pads = [...root.querySelectorAll('.pad')]
              const on = pads.findIndex((p) => p.classList.contains('on'))
              return on < 0 ? '' : 'pad:' + on + ':' + pads.length
            })()`,
            undefined,
            { polling: 'raf', timeout: 8000 },
          )
          .then((h) => h.jsonValue() as Promise<string>)
        if (seen === 'gone' || seen === 'done' || seen === 'ready') break
        const [, index, count] = seen.split(':').map(Number) as [number, number, number]
        if (this.opts.touch) await rt.locator('button.pad').nth(index).tap({ force: true, timeout: 2000, noWaitAfter: true }).catch(() => undefined)
        else await page.keyboard.press(count === 1 ? 'Space' : ['d', 'f', 'j', 'k'][index]!)
        // The trial is over once the target is gone.
        await page.waitForFunction(`!document.querySelector('section.hb-render.rt .pad.on')`, undefined, { polling: 'raf', timeout: 3000 }).catch(() => undefined)
      }
      if (stage === 'practice') await this.press(rt.getByRole('button', { name: 'Start', exact: true }))
    }
    // The block hands over to the next one (or the next interstitial) on its own.
    await this.blockOver('rt', id)
  }

  /** The digit keys of a keypad (the on-screen one for a finger, the number keys otherwise). */
  private async digits(root: Locator, keys: string): Promise<void> {
    if (!this.opts.touch) {
      await this.page.keyboard.type(keys)
      return
    }
    const keypad = root.getByRole('group', { name: 'Digit keypad' })
    for (const d of keys) await keypad.getByRole('button', { name: d, exact: true }).tap()
  }

  /** Digit span: enter the digits asked for (the block ends after two misses at a length), then Done. */
  private async playDigits(): Promise<void> {
    const { page } = this
    const span = page.locator('section.hb-render.span')
    const id = await this.blockId('span')
    await this.press(span.getByRole('button', { name: 'Start' }))
    for (let guard = 0; guard < 40; guard++) {
      if ((await this.phaseOf('span', id, '^Enter \\d+ digits')) !== 'entry') break
      const length = Number(/^Enter (\d+) digits/.exec(((await span.locator('.hb-status').textContent()) ?? '').trim())?.[1] ?? 3)
      await this.digits(span, '123456789'.slice(0, length))
      await this.press(span.getByRole('button', { name: 'Done' }))
      // The entry is over once the status leaves "Enter ..." (the next sequence, or the end).
      await page.waitForFunction(`!/^Enter \\d+ digits/.test(((document.querySelector('section.hb-render.span .hb-status') || {}).textContent) || '')`, undefined, { polling: 'raf', timeout: 5000 }).catch(() => undefined)
    }
    await this.blockOver('span', id)
  }

  /** Corsi: pick three blocks on the board, then Done. */
  private async playCorsi(): Promise<void> {
    const { page } = this
    const corsi = page.locator('section.hb-render.corsi')
    const id = await this.blockId('corsi')
    await this.press(corsi.getByRole('button', { name: 'Start' }))
    for (let guard = 0; guard < 40; guard++) {
      if ((await this.phaseOf('corsi', id, '^Selected \\d+ of \\d+')) !== 'entry') break
      for (const k of [0, 1, 2]) await this.press(corsi.locator('button.block').nth(k))
      await this.press(corsi.getByRole('button', { name: 'Done' }))
      await page.waitForFunction(`!/^Selected \\d+ of \\d+/.test(((document.querySelector('section.hb-render.corsi .hb-status') || {}).textContent) || '')`, undefined, { polling: 'raf', timeout: 5000 }).catch(() => undefined)
    }
    await this.blockOver('corsi', id)
  }

  /** Symbol-digit coding: press digits until the 90 (virtual) seconds are up. */
  private async playCoding(): Promise<void> {
    const { page } = this
    const coding = page.locator('section.hb-render.coding')
    const id = await this.blockId('coding')
    await this.press(coding.getByRole('button', { name: 'Start' }))
    await expect(coding.getByRole('timer')).toBeVisible()
    const keypad = coding.getByRole('group', { name: 'Digit keypad' })
    for (let i = 0; i < 4000; i++) {
      const d = String(1 + (i % 9))
      // A finger taps the keypad; the block ends under it, so a tap that finds no keypad is not an error.
      if (this.opts.touch) await keypad.getByRole('button', { name: d, exact: true }).tap({ force: true, timeout: 1000, noWaitAfter: true }).catch(() => undefined)
      else await page.keyboard.press(d)
      // The status line says so when the window closes; if the block is already gone, so is the line.
      if (i % 10 === 0 && (await coding.locator('.hb-status').innerText({ timeout: 300 }).catch(() => 'over')).trim() !== '') break
    }
    await this.blockOver('coding', id)
  }

  /** Reading: show the passage, read it (a moment), Done reading, answer each question, Submit. */
  private async playReading(): Promise<void> {
    const { page } = this
    const reading = page.locator('section.hb-render.reading')
    await this.press(reading.getByRole('button', { name: 'Show the passage' }))
    await expect(reading.getByRole('button', { name: 'Done reading' })).toBeEnabled()
    await this.press(reading.getByRole('button', { name: 'Done reading' }))
    for (const group of await reading.locator('fieldset.question').all()) await this.tick(group.locator('input[type=radio]').first())
    await this.press(reading.getByRole('button', { name: 'Submit answers' }))
  }

  // ------------------------------------------------------------------ the results

  /** The results build up (fast mode makes it brief) and the save panel is on the page. */
  async resultsReady(): Promise<void> {
    const { page } = this
    await expect(h1(page)).toHaveText('Session complete')
    await expect(page.locator('.reveal [role="status"]').first()).toHaveText('Your profile is ready.', { timeout: 30_000 })
    await expect(button(page, 'Download save file')).toBeVisible()
  }
}
