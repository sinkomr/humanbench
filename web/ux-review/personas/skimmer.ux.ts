/// <reference lib="dom" />
/**
 * Persona "Riley, the impatient skimmer" (UX review package rev-skimmer, run id `skimmer`): skims, presses the
 * biggest button, wants the result fast, uses Back and Refresh freely, double-clicks, and may leave and come back.
 *
 *   UX_PORT=4614 UX_RUN=skimmer npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/skimmer.ux.ts --project=chromium --grep 'funnel'
 *
 * Five short tests (run one at a time with --grep): funnel cost, exits (finish early at once, one part then finish,
 * leaving the results), back and refresh, double clicks and key mashing, and speed (chromium only). Every test writes
 * its evidence under web/test-results/ux-review/skimmer/<test>-<project>/ and a JSON of the numbers it measured; the
 * findings file (ux-review/findings/skimmer.json) cites those paths. Nothing here asserts product behaviour as right
 * or wrong beyond what it needs to keep going: the numbers are evidence, the verdicts are in the findings.
 */

import { expect, test, type Locator, type Page } from '@playwright/test'
import { button, h1, toResults, unloadIsGuarded } from '../../e2e/flow'
import { SessionDriver } from '../../e2e/session-driver'
import { pageMetrics, Shots, trackConsole, wordsOf } from '../lib'

const RUN = (): string => process.env.UX_RUN ?? 'skimmer'

/** What a skimmer sees on one screen: the heading, the words in the main column and on the whole page, the buttons. */
interface ScreenStats {
  readonly h1: string
  readonly wordsMain: number
  readonly wordsPage: number
  readonly wordsFooter: number
  readonly buttons: string[]
  readonly links: string[]
  readonly scrollHeight: number
  readonly viewportHeight: number
}

async function screenStats(page: Page): Promise<ScreenStats> {
  const raw = await page.evaluate(() => {
    const text = (el: Element | null): string => ((el as HTMLElement | null)?.innerText ?? '').trim()
    const main = document.querySelector('main')
    const footer = document.querySelector('#app > footer')
    const visible = (el: Element): boolean => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }
    return {
      h1: text(document.querySelector('h1')),
      main: text(main),
      page: text(document.body),
      footer: text(footer),
      buttons: [...document.querySelectorAll('button')].filter(visible).map((b) => text(b)),
      links: [...document.querySelectorAll('a[href]')].filter(visible).map((a) => text(a)),
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
    }
  })
  return {
    h1: raw.h1,
    wordsMain: wordsOf(raw.main).length,
    wordsPage: wordsOf(raw.page).length,
    wordsFooter: wordsOf(raw.footer).length,
    buttons: raw.buttons,
    links: raw.links,
    scrollHeight: raw.scrollHeight,
    viewportHeight: raw.viewportHeight,
  }
}

const since = (t0: number): number => Math.round(performance.now() - t0)

/** Centre of an element, for a double click or two taps at one spot. */
async function centre(target: Locator): Promise<{ x: number; y: number }> {
  // A missing element must not wait for the test timeout (there is no action timeout in the harness config).
  const box = await target.boundingBox({ timeout: 2000 })
  if (box === null) throw new Error('no bounding box')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** Two presses at one spot in quick succession: a mouse double click, or two taps on a phone. */
async function twice(page: Page, touch: boolean, at: { x: number; y: number }, gapMs = 80): Promise<void> {
  if (touch) {
    await page.touchscreen.tap(at.x, at.y)
    await page.waitForTimeout(gapMs)
    await page.touchscreen.tap(at.x, at.y)
  } else {
    await page.mouse.dblclick(at.x, at.y, { delay: gapMs })
  }
}

/** The driver's way through the start screens, timing each screen and counting the words on it. */
async function walkStart(page: Page, driver: SessionDriver, shots: Shots, out: Record<string, unknown>): Promise<void> {
  const t0 = performance.now()
  const screens: Array<ScreenStats & { t: number; clicksSoFar: number }> = []
  let clicks = 0
  const note = async (name: string): Promise<void> => {
    const s = await screenStats(page)
    screens.push({ ...s, t: since(t0), clicksSoFar: clicks })
    await shots.all(name)
  }
  await page.goto('./?fast=1')
  await expect(h1(page)).toHaveText('HumanBench')
  await note('welcome')
  await driver.press(button(page, 'Start'))
  clicks++
  await expect(h1(page)).toHaveText(/^(Before you start|Honour code)$/)
  if (((await h1(page).textContent()) ?? '').trim() === 'Before you start') {
    await note('gate')
    await driver.tick(page.getByRole('checkbox', { name: /18 or older/ }))
    clicks++
    await driver.press(button(page, 'Continue'))
    clicks++
  } else {
    out['gateSkipped'] = true
  }
  await expect(h1(page)).toHaveText('Honour code')
  await note('honour')
  await driver.tick(page.getByRole('checkbox', { name: /honour code/ }))
  clicks++
  await driver.press(button(page, 'Continue'))
  clicks++
  await expect(h1(page)).toHaveText('Check your device')
  const tDevice = performance.now()
  await note('device-measuring')
  await expect(button(page, 'Continue')).toBeEnabled({ timeout: 20_000 })
  const deviceWaitMs = since(tDevice)
  await note('device-ready')
  await driver.tick(page.getByRole('radio', { name: driver.opts.touch ? 'Tap or click' : 'Keyboard' }))
  clicks++
  await driver.press(button(page, 'Continue'))
  clicks++
  await expect(h1(page)).toHaveText('Ready when you are')
  await note('ready')
  out['startScreens'] = screens
  out['clicksToReady'] = clicks
  out['msToReady'] = since(t0)
  out['deviceCheckWaitMs'] = deviceWaitMs
}

// =====================================================================================================================

test('skimmer: funnel', async ({ page }, testInfo) => {
  const project = testInfo.project.name
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN(), `funnel-${project}`)
  const log = trackConsole(page)
  const driver = new SessionDriver(page, { touch })
  const out: Record<string, unknown> = { project, touch, viewport: page.viewportSize() }

  // 1. Landing to ready: clicks, words, seconds.
  await walkStart(page, driver, shots, out)
  const ready = await screenStats(page)
  out['readySaysMinutes'] = /about 30 minutes/.test(await page.locator('main').innerText())

  // 2. Practice path: ready → first practice item.
  const tPractice = performance.now()
  await driver.press(button(page, 'Try practice questions first'))
  await expect(h1(page)).toHaveText('Practice')
  await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
  out['msReadyToFirstPractice'] = since(tPractice)
  out['practiceScreen'] = await screenStats(page)
  await shots.all('practice-first')
  out['readyButtons'] = ready.buttons

  // 3. Back to the start of the session (a fresh page: the practice is optional, the skimmer never takes it).
  const page2 = await page.context().newPage()
  await page2.goto('./favicon.svg')
  await page2.evaluate(() => localStorage.clear())
  const driver2 = new SessionDriver(page2, { touch })
  const shots2 = new Shots(page2, RUN(), `funnel-${project}-begin`)
  const out2: Record<string, unknown> = {}
  await walkStart(page2, driver2, shots2, out2)
  const tBegin = performance.now()
  await driver2.press(button(page2, 'Begin'))
  await expect(h1(page2)).toHaveText('Up next: Reaction time')
  const interstitial = await screenStats(page2)
  await shots2.all('interstitial-rt')
  await driver2.press(button(page2, 'Start'))
  await expect(page2.locator('section.hb-render.rt')).toBeVisible()
  const rtIntro = await screenStats(page2)
  await shots2.all('rt-intro')
  out['msReadyToFirstCountedScreen'] = since(tBegin)
  out['clicksReadyToFirstCountedScreen'] = 2
  out['interstitialScreen'] = interstitial
  out['rtIntroScreen'] = rtIntro
  out['secondWalk'] = out2
  // The counted screen itself asks for one more press ("Start practice") before anything happens.
  out['rtIntroButtons'] = rtIntro.buttons
  const clicksToReady = out2['clicksToReady'] as number
  out['totalClicksLandingToFirstCountedScreen'] = clicksToReady + 2 + 1
  out['totalWordsLandingToReady'] = (out2['startScreens'] as ScreenStats[]).reduce((n, s) => n + s.wordsMain, 0)
  await page2.close()

  out['console'] = log
  shots.json('funnel', out, { counter: false })
  console.log(`[skimmer funnel ${project}] ${JSON.stringify({ clicksToReady, msToReady: out2['msToReady'], msReadyToFirstPractice: out['msReadyToFirstPractice'], msReadyToFirstCountedScreen: out['msReadyToFirstCountedScreen'], words: out['totalWordsLandingToReady'] })}`)
})

// =====================================================================================================================

test('skimmer: exits', async ({ page, context }, testInfo) => {
  const project = testInfo.project.name
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN(), `exits-${project}`)
  const log = trackConsole(page)
  const out: Record<string, unknown> = { project, touch, viewport: page.viewportSize() }

  // A. Finish early at once, on the first interstitial: what is there, and is it a dead end?
  {
    const driver = new SessionDriver(page, { touch })
    await driver.toReady('./?fast=1')
    await driver.begin()
    await shots.all('interstitial-before-finish')
    await driver.press(button(page, 'Finish early'))
    await shots.all('confirm-finish')
    out['confirmFinish'] = await screenStats(page)
    await driver.press(button(page, 'Finish now'))
    await expect(h1(page)).toHaveText('Session ended')
    await page.waitForTimeout(300)
    const s = await screenStats(page)
    out['finishedNothing'] = { ...s, guarded: await unloadIsGuarded(page), autosaveKeys: await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('hb:save:v1:'))) }
    await shots.all('finished-nothing')
    // The download of an empty session (behind the closed "Keep a file of this visit anyway"): what does the file hold?
    await driver.press(page.getByText('Keep a file of this visit anyway'))
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10_000 }).catch(() => null), driver.press(button(page, 'Download save file'))])
    if (dl !== null) {
      const path = await dl.path().catch(() => null)
      out['finishedNothingDownload'] = { suggested: dl.suggestedFilename(), path }
    }
    await page.waitForTimeout(200)
    await shots.all('finished-nothing-after-download')
    out['finishedNothingAfterDownload'] = await screenStats(page)
    await driver.press(button(page, 'Back to the start'))
    await expect(h1(page)).toHaveText('HumanBench')
    out['finishedNothingBackToStart'] = { autosaveKeys: await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('hb:save:v1:'))) }
  }

  // B. Skip the reaction tasks, answer one part (a few items of Matrix & Series), finish early: the partial profile.
  {
    const p = await context.newPage()
    await p.evaluate(() => localStorage.clear()).catch(() => undefined)
    await p.goto('./favicon.svg').catch(() => undefined)
    await p.evaluate(() => localStorage.clear()).catch(() => undefined)
    const driver = new SessionDriver(p, { touch })
    const sh = new Shots(p, RUN(), `exits-${project}-partial`)
    await driver.toReady('./?fast=1')
    await driver.begin()
    await driver.skipPart()
    await expect(h1(p)).toHaveText('Up next: Matrix & Series')
    await sh.all('interstitial-after-skip')
    out['skipNotice'] = await p.locator('header .status').first().innerText().catch(() => '')
    await driver.press(button(p, 'Start'))
    await expect(p.locator('form.choice, form.entry').first()).toBeVisible()
    // A handful of items of this one part (never past its end).
    for (let i = 0; i < 12; i++) {
      const kind = await driver.screen()
      if (kind !== 'choice' && kind !== 'entry' && kind !== 'confidence') break
      await driver.step()
    }
    await sh.all('after-some-items')
    await driver.press(button(p, 'Finish early'))
    await driver.press(button(p, 'Finish now'))
    await expect(h1(p)).toHaveText('Session complete')
    await driver.resultsReady()
    const s = await screenStats(p)
    const lead = await p.locator('main > p.lead').first().innerText().catch(() => '')
    const summary = await p.locator('main > p').nth(1).innerText().catch(() => '')
    const notMeasured = await p.getByText(/^Not measured/).count()
    const measuredRows = await p.locator('table tbody tr').count()
    const peaks = await p.locator('[data-section="peaks"], section:has(h2:text("Your most distinctive peaks"))').first().innerText().catch(() => '')
    out['partial'] = { ...s, lead, summary, notMeasured, measuredRows, peaks: peaks.slice(0, 600), answered: driver.answered, guarded: await unloadIsGuarded(p) }
    await sh.all('partial-results')
    await sh.shot('partial-results-viewport', { fullPage: false })
    // What is above the fold at this viewport.
    out['partialAboveFold'] = await p.evaluate(() => {
      const h = window.innerHeight
      return [...document.querySelectorAll('h1, h2, h3, button, [role=status]')].filter((e) => e.getBoundingClientRect().top < h && e.getBoundingClientRect().height > 0).map((e) => `${e.tagName.toLowerCase()}: ${(e as HTMLElement).innerText.trim().slice(0, 60)}`)
    })
    out['partialSaveTop'] = await p.evaluate(() => {
      const save = document.querySelector('[data-section="save"]') as HTMLElement | null
      const headings = [...document.querySelectorAll('h2')].map((e) => ({ text: (e as HTMLElement).innerText.trim(), top: Math.round(e.getBoundingClientRect().top + window.scrollY) }))
      return { saveTop: save === null ? null : Math.round(save.getBoundingClientRect().top + window.scrollY), scrollHeight: document.documentElement.scrollHeight, viewport: window.innerHeight, headings }
    })

    // C. Closing the results without saving: "Back to the start" asks; the tab is guarded.
    await driver.press(button(p, 'Back to the start'))
    await expect(p.getByText('Leave without saving?')).toBeVisible()
    await sh.all('results-leave')
    await sh.shot('results-leave-viewport', { fullPage: false })
    out['leavePanelInView'] = await p.evaluate(() => {
      const el = [...document.querySelectorAll('h2')].find((e) => e.textContent?.trim() === 'Leave without saving?')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { top: Math.round(r.top), inViewport: r.top >= 0 && r.bottom <= window.innerHeight, scrollY: Math.round(window.scrollY) }
    })
    await driver.press(button(p, 'Stay and save'))
    await expect(p.getByText('Leave without saving?')).toHaveCount(0)
    // Reload without saving: the browser asks (beforeunload); the skimmer accepts.
    const dialogs: string[] = []
    p.on('dialog', (d) => {
      dialogs.push(`${d.type()}: ${d.message()}`)
      void d.accept()
    })
    await p.reload()
    await expect(h1(p)).toHaveText('HumanBench')
    out['reloadOnResults'] = { dialogs, h1After: await h1(p).innerText(), autosaveKeys: await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('hb:save:v1:'))) }
    await sh.all('after-reload-on-results')
    // How does the skimmer get their results back? Count the presses.
    const t0 = performance.now()
    let presses = 0
    await driver.press(button(p, 'Start'))
    presses++
    await expect(h1(p)).toHaveText('Honour code')
    await driver.tick(p.getByRole('checkbox', { name: /honour code/ }))
    presses++
    await driver.press(button(p, 'Continue'))
    presses++
    await expect(button(p, 'Continue')).toBeEnabled({ timeout: 20_000 })
    await driver.tick(p.getByRole('radio', { name: touch ? 'Tap or click' : 'Keyboard' }))
    presses++
    await driver.press(button(p, 'Continue'))
    presses++
    await expect(h1(p)).toHaveText('Ready when you are')
    await sh.all('ready-returning-after-reload')
    out['readyReturning'] = { ...(await screenStats(p)), earlierSaves: await p.getByText('Earlier saves on this device').count(), focusOffered: await p.getByText('Or a 20-minute focus session').count() }
    await driver.press(button(p, 'Begin'))
    presses++
    await expect(h1(p)).toHaveText('Up next: Reaction time')
    await driver.press(button(p, 'Finish early'))
    presses++
    await driver.press(button(p, 'Finish now'))
    presses++
    await expect(h1(p)).toHaveText('Session complete')
    await driver.resultsReady()
    out['resultsAgain'] = { presses, ms: since(t0), lead: await p.locator('main > p.lead').first().innerText().catch(() => ''), summary: await p.locator('main > p').nth(1).innerText().catch(() => ''), measuredRows: await p.locator('table tbody tr').count(), notMeasured: await p.getByText(/^Not measured/).count() }
    await sh.all('results-again')
    await p.close()
  }

  out['console'] = log
  shots.json('exits', out, { counter: false })
  console.log(`[skimmer exits ${project}] ${JSON.stringify({ finishedNothing: (out['finishedNothing'] as ScreenStats).buttons, partial: (out['partial'] as { summary: string }).summary, resultsAgain: out['resultsAgain'] })}`)
})

// =====================================================================================================================

test('skimmer: back and refresh', async ({ page, context }, testInfo) => {
  const project = testInfo.project.name
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN(), `back-${project}`)
  const log = trackConsole(page)
  const out: Record<string, unknown> = { project, touch }

  // A. Privacy from the start page, then browser Back.
  await page.goto('./?fast=1')
  await expect(h1(page)).toHaveText('HumanBench')
  await page.getByRole('link', { name: 'Privacy and terms' }).click()
  await expect(h1(page)).toHaveText('Privacy and terms')
  const privacy = await screenStats(page)
  await shots.all('privacy')
  await page.goBack()
  await expect(h1(page)).toHaveText('HumanBench')
  out['privacyThenBack'] = { privacyWords: privacy.wordsMain, privacyScroll: privacy.scrollHeight, backLandsOn: await h1(page).innerText(), url: page.url() }

  // B. Privacy from the gate (a new tab), then Back in the first tab.
  const driver = new SessionDriver(page, { touch })
  await driver.press(button(page, 'Start'))
  await expect(h1(page)).toHaveText('Before you start')
  const [popup] = await Promise.all([context.waitForEvent('page', { timeout: 5000 }).catch(() => null), page.getByRole('link', { name: /privacy notice/ }).click()])
  out['gatePrivacyOpensNewTab'] = popup !== null
  if (popup !== null) {
    await popup.waitForLoadState().catch(() => undefined)
    out['gatePrivacyTabH1'] = await popup.locator('h1').first().innerText().catch(() => '')
    await popup.close()
  }
  const back = await page.goBack()
  out['backFromGate'] = { navigated: back !== null, url: page.url(), h1: await page.locator('h1').first().innerText({ timeout: 2000 }).catch(() => '(none)') }
  await shots.all('after-back-from-gate')
  if (back !== null) {
    await page.goForward().catch(() => undefined)
    await expect(h1(page)).toHaveText('HumanBench')
    out['forwardAfterBack'] = await h1(page).innerText()
  }

  // C. Browser Back mid-session: after one answered item.
  {
    const p = await context.newPage()
    const d = new SessionDriver(p, { touch })
    const sh = new Shots(p, RUN(), `back-${project}-mid`)
    await d.toReady('./?fast=1')
    await d.begin()
    await d.answerOne()
    await sh.all('mid-session-item')
    const keysBefore = await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('hb:save:v1:')))
    const nav = await p.goBack()
    await p.waitForTimeout(500)
    out['backMidSession'] = { navigated: nav !== null, url: p.url(), h1: await p.locator('h1').first().innerText({ timeout: 2000 }).catch(() => '(none)'), autosaveKeys: keysBefore }
    await sh.all('after-back-mid-session')
    const fwd = await p.goForward().catch(() => null)
    await p.waitForTimeout(800)
    out['forwardMidSession'] = { navigated: fwd !== null, h1: await p.locator('h1').first().innerText({ timeout: 2000 }).catch(() => '(none)'), resumeOffered: await p.getByText(/resume|continue where you left|in progress/i).count() }
    await sh.all('after-forward-mid-session')
    await p.close()
  }

  // D. Refresh mid-item: what comes back, and what the start page says about it.
  {
    const p = await context.newPage()
    const d = new SessionDriver(p, { touch })
    const sh = new Shots(p, RUN(), `back-${project}-refresh`)
    await d.toReady('./?fast=1')
    await d.begin()
    await d.answerOne()
    await d.step() // a second item on screen, answered
    await d.step()
    const answered = d.answered
    await sh.all('before-refresh')
    const elapsed = await p.getByRole('progressbar').getAttribute('aria-valuetext')
    await p.reload()
    await expect(h1(p)).toHaveText('HumanBench')
    const welcome = await screenStats(p)
    await sh.all('after-refresh')
    out['refreshMidItem'] = {
      answeredBefore: answered,
      progressBefore: elapsed,
      h1After: welcome.h1,
      welcomeMentionsSession: /progress|resume|earlier|saved|continue/i.test(await p.locator('main').innerText()),
      autosaveKeys: await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('hb:save:v1:'))),
    }
    // Through the start again: the ready screen offers the earlier session, but as what?
    await d.press(button(p, 'Start'))
    await expect(h1(p)).toHaveText('Honour code')
    await d.tick(p.getByRole('checkbox', { name: /honour code/ }))
    await d.press(button(p, 'Continue'))
    await expect(button(p, 'Continue')).toBeEnabled({ timeout: 20_000 })
    await d.press(button(p, 'Continue'))
    await expect(h1(p)).toHaveText('Ready when you are')
    await sh.all('ready-after-refresh')
    out['readyAfterRefresh'] = { text: (await p.locator('main').innerText()).slice(0, 1200), earlierSaves: await p.getByText('Earlier saves on this device').count(), checkboxLabel: await p.locator('label[for$="-found"]').innerText({ timeout: 2000 }).catch(() => '') }
    await d.press(button(p, 'Begin'))
    await expect(h1(p)).toHaveText('Up next: Reaction time')
    await sh.all('interstitial-after-refresh')
    out['checklistAfterRefresh'] = await p.locator('aside').innerText().catch(() => '')
    // Finish at once: the results merge the refreshed-away session with this empty one.
    await d.finishEarly()
    await d.resultsReady()
    out['resultsAfterRefresh'] = { lead: await p.locator('main > p.lead').first().innerText().catch(() => ''), summary: await p.locator('main > p').nth(1).innerText().catch(() => ''), measuredRows: await p.locator('table tbody tr').count() }
    await sh.all('results-after-refresh')
    await p.close()
  }

  // E. Returning later with an earlier session on this device (a new tab, same storage): the person answered one
  //    question, finished, downloaded the file and closed the tab. (A session with no answer leaves no autosave,
  //    e2e/session.spec.ts "a start that was abandoned before any answer", so one answer is the least that returns.)
  {
    const p = await context.newPage()
    await p.goto('./favicon.svg')
    await p.evaluate(() => localStorage.clear())
    const d = new SessionDriver(p, { touch })
    await d.toReady('./?fast=1')
    await d.begin()
    await d.answerOne()
    await d.finishEarly()
    await d.resultsReady()
    await d.press(button(p, 'Download save file'))
    await expect(p.getByText('Your results are saved in your file.')).toBeVisible()
    await p.close()
    const p2 = await context.newPage()
    const d2 = new SessionDriver(p2, { touch })
    const sh2 = new Shots(p2, RUN(), `back-${project}-return`)
    const t0 = performance.now()
    await p2.goto('./?fast=1')
    await expect(h1(p2)).toHaveText('HumanBench')
    await sh2.all('welcome-returning')
    const welcomeMain = await p2.locator('main').innerText()
    await d2.toReady('./?fast=1')
    await sh2.all('ready-returning')
    await sh2.shot('ready-returning-viewport', { fullPage: false })
    const stats = await screenStats(p2)
    out['readyReturning'] = {
      ...stats,
      welcomeMentionsEarlier: /earlier|saved|your results|last time|continue/i.test(welcomeMain),
      earlierSaves: await p2.getByText('Earlier saves on this device').count(),
      checkboxLabel: await p2.locator('label[for$="-found"]').innerText({ timeout: 2000 }).catch(() => ''),
      checked: await p2.locator('input[id$="-found"]').isChecked({ timeout: 2000 }).catch(() => null),
      focusOffered: await p2.getByText('Or a 20-minute focus session').count(),
      positions: await p2.evaluate(() => {
        const h = window.innerHeight
        const find = (tag: string, text: string): Element | undefined => [...document.querySelectorAll(tag)].find((x) => x.textContent?.trim() === text)
        const where = (el: Element | undefined): { top: number; aboveFold: boolean } | null => {
          if (el === undefined) return null
          const r = el.getBoundingClientRect()
          return { top: Math.round(r.top + window.scrollY), aboveFold: r.bottom <= h }
        }
        return { viewport: h, begin: where(find('button', 'Begin')), earlierSaves: where(find('h2', 'Earlier saves on this device')), focus: where(find('summary', 'Or a 20-minute focus session')) }
      }),
      metrics: await pageMetrics(p2, { touch }).catch(() => null),
    }
    // The shortest way back to the earlier results: Begin, Finish early, Finish now (there is no "see my results").
    await d2.begin()
    await d2.finishEarly()
    await d2.resultsReady()
    out['returningToResults'] = {
      pressesFromLanding: 5 + 1 + 2,
      ms: since(t0),
      lead: await p2.locator('main > p.lead').first().innerText({ timeout: 2000 }).catch(() => ''),
      summary: await p2.locator('main > p').nth(1).innerText({ timeout: 2000 }).catch(() => ''),
      measuredRows: await p2.locator('table tbody tr').filter({ hasNotText: /Not measured/ }).count(),
      sessionsNote: await p2.locator('main').innerText().then((t) => (t.match(/[^.]*\b(sessions?)\b[^.]*\./i) ?? [''])[0].trim().slice(0, 200)),
    }
    await sh2.all('results-returning')
    await p2.close()
  }

  out['console'] = log
  shots.json('back', out, { counter: false })
  console.log(`[skimmer back ${project}] ${JSON.stringify({ backFromGate: out['backFromGate'], backMidSession: out['backMidSession'], refresh: out['refreshMidItem'] })}`)
})

// =====================================================================================================================

test('skimmer: double clicks', async ({ page, context }, testInfo) => {
  const project = testInfo.project.name
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN(), `double-${project}`)
  const log = trackConsole(page)
  const out: Record<string, unknown> = { project, touch }

  // A. Double click on the gate's Continue, the honour code's Continue, the device check's Continue.
  {
    const driver = new SessionDriver(page, { touch })
    await page.goto('./?fast=1')
    await driver.press(button(page, 'Start'))
    await expect(h1(page)).toHaveText('Before you start')
    await driver.tick(page.getByRole('checkbox', { name: /18 or older/ }))
    await twice(page, touch, await centre(button(page, 'Continue')))
    await page.waitForTimeout(400)
    out['gateContinueTwice'] = await h1(page).innerText()
    await expect(h1(page)).toHaveText('Honour code')
    await driver.tick(page.getByRole('checkbox', { name: /honour code/ }))
    await twice(page, touch, await centre(button(page, 'Continue')))
    await page.waitForTimeout(400)
    out['honourContinueTwice'] = await h1(page).innerText()
    await expect(h1(page)).toHaveText('Check your device')
    await expect(button(page, 'Continue')).toBeEnabled({ timeout: 20_000 })
    await driver.tick(page.getByRole('radio', { name: touch ? 'Tap or click' : 'Keyboard' }))
    const deviceContinue = await centre(button(page, 'Continue'))
    await twice(page, touch, deviceContinue)
    await page.waitForTimeout(400)
    out['deviceContinueTwice'] = { h1: await h1(page).innerText(), at: deviceContinue, beginAt: await centre(button(page, 'Begin')).catch(() => null) }
    await expect(h1(page)).toHaveText('Ready when you are')
    await shots.all('ready')

    // B. Double click on Begin: does the second press hit "Start" on the interstitial?
    const beginAt = await centre(button(page, 'Begin'))
    await twice(page, touch, beginAt)
    await page.waitForTimeout(600)
    const afterBegin = await h1(page).innerText()
    const startAt = afterBegin.startsWith('Up next') ? await centre(button(page, 'Start')).catch(() => null) : null
    out['beginTwice'] = { h1: afterBegin, beginAt, interstitialStartAt: startAt, screen: await driver.screen() }
    await shots.all('after-begin-twice')
    if (!afterBegin.startsWith('Up next')) {
      // The second press went through: note what is on screen.
      out['beginTwiceWentThrough'] = true
    }
    // Get to an item either way.
    if ((await driver.screen()) === 'rt') {
      // We are in the RT block (the double click pressed Start). Skip it.
      await driver.press(button(page, 'Skip Reaction Time'))
      await driver.press(page.locator('section.confirm').getByRole('button', { name: /^Skip / }))
    } else {
      await driver.skipPart()
    }
    await expect(h1(page)).toHaveText('Up next: Matrix & Series')
    await driver.press(button(page, 'Start'))
    await expect(page.locator('form.choice, form.entry').first()).toBeVisible()

    // C. Double click on Confirm / Submit: is the confidence rating submitted by the second press?
    const choice = page.locator('form.choice')
    const entry = page.locator('form.entry')
    let submitAt: { x: number; y: number }
    if ((await choice.count()) > 0) {
      await driver.tick(choice.getByRole('radio').first())
      submitAt = await centre(button(page, 'Confirm'))
    } else {
      const box = entry.locator('input[type=text]')
      await box.fill((await box.evaluate((el) => el.classList.contains('letter'))) ? 'A' : '1')
      submitAt = await centre(entry.getByRole('button', { name: 'Submit', exact: true }))
    }
    await twice(page, touch, submitAt)
    await page.waitForTimeout(600)
    const sliderCount = await page.getByRole('slider').count()
    const continueAt = sliderCount > 0 ? await centre(button(page, 'Continue')).catch(() => null) : null
    out['submitTwice'] = { submitAt, sliderStillThere: sliderCount > 0, continueAt, screen: await driver.screen(), answered: driver.answered }
    await shots.all('after-submit-twice')
    if (sliderCount > 0) {
      // D. Double click on the confidence Continue: the second press lands on the next item.
      const value = await page.getByRole('slider').inputValue()
      await twice(page, touch, await centre(button(page, 'Continue')))
      await page.waitForTimeout(600)
      const checked = await page.locator('form.choice input[type=radio]:checked').count()
      const typed = await page.locator('form.entry input[type=text]').inputValue().catch(() => '')
      out['continueTwice'] = { confidenceSubmitted: value, screen: await driver.screen(), nextItemRadioChecked: checked, nextItemTyped: typed, continueAt }
      await shots.all('after-continue-twice')
    }

    // E. Double click on Finish early.
    await twice(page, touch, await centre(button(page, 'Finish early')))
    await page.waitForTimeout(400)
    out['finishEarlyTwice'] = { confirmShown: await page.getByText('Finish now?').count(), h1: await h1(page).innerText() }
    await shots.all('after-finish-early-twice')
    await page.close()
  }

  // F. Key mashing (desktop) or rapid tapping (phone) during the reaction-time block.
  {
    const p = await context.newPage()
    const d = new SessionDriver(p, { touch })
    const sh = new Shots(p, RUN(), `double-${project}-rt`)
    await d.toReady('./?fast=1')
    await d.begin()
    await d.press(button(p, 'Start'))
    const rt = p.locator('section.hb-render.rt')
    await expect(rt).toBeVisible()
    await d.press(rt.getByRole('button', { name: 'Start practice' }))
    const notes = new Set<string>()
    const t0 = performance.now()
    for (let i = 0; i < 60 && performance.now() - t0 < 6000; i++) {
      if (touch) {
        const pad = rt.locator('button.pad').first()
        const c = await centre(pad).catch(() => null)
        if (c !== null) await p.touchscreen.tap(c.x, c.y).catch(() => undefined)
      } else {
        await p.keyboard.press('Space')
      }
      const status = (await rt.locator('.hb-status, .note, [role=status]').allInnerTexts().catch(() => [])).join(' | ').trim()
      if (status !== '') notes.add(status)
      await p.waitForTimeout(40)
    }
    await sh.all('rt-after-mashing')
    out['rtMashing'] = { notes: [...notes].slice(0, 12), screen: await d.screen(), blockStillThere: (await rt.count()) > 0, statusNow: await rt.locator('.hb-status').first().innerText().catch(() => '') }
    await p.close()
  }

  out['console'] = log
  shots.json('double', out, { counter: false })
  console.log(`[skimmer double ${project}] ${JSON.stringify({ beginTwice: out['beginTwice'], submitTwice: out['submitTwice'], continueTwice: out['continueTwice'], rt: out['rtMashing'] })}`)
})

// =====================================================================================================================

interface LoadTiming {
  readonly msToH1: number
  readonly nav: Record<string, number> | null
  readonly resources: Array<{ name: string; transfer: number; size: number; ms: number }>
  readonly totalTransfer: number
  readonly totalSize: number
  readonly jsTransfer: number
}

async function coldLoad(page: Page, url: string): Promise<LoadTiming> {
  const t0 = performance.now()
  await page.goto(url, { waitUntil: 'commit' })
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 90_000 })
  const msToH1 = since(t0)
  await page.waitForLoadState('load').catch(() => undefined)
  const data = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
    return {
      nav:
        nav === undefined
          ? null
          : {
              ttfb: Math.round(nav.responseStart),
              domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
              load: Math.round(nav.loadEventEnd),
              transfer: nav.transferSize,
            },
      resources: res.map((r) => ({ name: r.name.replace(/^.*\/assets\//, 'assets/').replace(/^https?:\/\/[^/]+/, ''), transfer: r.transferSize, size: r.encodedBodySize, ms: Math.round(r.duration) })),
    }
  })
  const totalTransfer = data.resources.reduce((n, r) => n + r.transfer, 0) + (data.nav?.transfer ?? 0)
  const totalSize = data.resources.reduce((n, r) => n + r.size, 0)
  const jsTransfer = data.resources.filter((r) => r.name.endsWith('.js')).reduce((n, r) => n + r.size, 0)
  return { msToH1, nav: data.nav, resources: data.resources, totalTransfer, totalSize, jsTransfer }
}

test('skimmer: speed', async ({ browser }, testInfo) => {
  const project = testInfo.project.name
  test.skip(project !== 'chromium', 'network throttling needs a CDP session; the rest is measured on chromium')
  const out: Record<string, unknown> = { project }
  const jsonCtx = await browser.newContext()
  const jsonShots = new Shots(await jsonCtx.newPage(), RUN(), `speed-${project}`)

  // A. Cold load, no throttling (a fresh context: nothing cached).
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await ctx.newPage()
    const shots = new Shots(page, RUN(), `speed-${project}`)
    out['coldLoad'] = await coldLoad(page, './')
    await shots.all('welcome-1280x800')
    // What the start page loads versus what the whole app weighs: the chunks requested on the landing page.
    await ctx.close()
  }

  // B. Cold load on Fast 3G (Chrome DevTools' preset: 1.44 Mbps down, 0.675 Mbps up, 562.5 ms RTT).
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await ctx.newPage()
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 562.5, downloadThroughput: (1.44 * 1024 * 1024) / 8, uploadThroughput: (0.675 * 1024 * 1024) / 8 })
    const timing = await coldLoad(page, './')
    // Is anything shown while the script loads (a blank page, or text)?
    out['fast3g'] = timing
    // The second screen on 3G: how long from Start to the gate, and from the gate to a ready device check.
    const t1 = performance.now()
    await page.getByRole('button', { name: 'Start' }).click()
    await expect(h1(page)).toHaveText('Before you start')
    out['fast3gStartToGateMs'] = since(t1)
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    await ctx.close()
  }

  // C. What a blank-script page shows: the HTML before the bundle runs.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await ctx.newPage()
    await page.route('**/assets/*.js', (route) => void route.abort())
    await page.goto('./').catch(() => undefined)
    await page.waitForTimeout(500)
    const shots = new Shots(page, RUN(), `speed-${project}-noscript`)
    out['withoutScript'] = { text: (await page.locator('body').innerText().catch(() => '')).slice(0, 400), shot: await shots.shot('html-before-js', { fullPage: false }) }
    await ctx.close()
  }

  // D. The results build-up at real speed: how long, and where "Skip animation" is.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await ctx.newPage()
    const shots = new Shots(page, RUN(), `speed-${project}-results`)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await toResults(page, 1)
    const t0 = performance.now()
    await expect(h1(page)).toHaveText('Session complete')
    const skip = page.getByRole('button', { name: 'Skip animation' })
    const skipVisible = await skip.isVisible().catch(() => false)
    const skipBox = skipVisible ? await skip.boundingBox() : null
    const fold = await page.evaluate(() => ({ scrollY: window.scrollY, innerHeight: window.innerHeight }))
    await shots.shot('building-viewport', { fullPage: false })
    await expect(page.locator('.reveal [role="status"]').first()).toHaveText('Your profile is ready.', { timeout: 60_000 })
    const buildMs = since(t0)
    const measured = await page.locator('table tbody tr').filter({ hasNotText: /Not measured/ }).count()
    out['buildUp'] = { buildMs, measuredSkills: measured, skipVisibleAtStart: skipVisible, skipBox, fold, replayVisible: await page.getByRole('button', { name: 'Replay animation' }).isVisible().catch(() => false) }
    await shots.shot('built-viewport', { fullPage: false })

    // E. Page length and what comes before the save button, at 1280x800 and 390x844.
    const lengths: Record<string, unknown> = {}
    for (const vp of [
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(vp)
      await page.waitForTimeout(300)
      lengths[`${vp.width}x${vp.height}`] = await page.evaluate(() => {
        const h = window.innerHeight
        const top = (el: Element): number => Math.round(el.getBoundingClientRect().top + window.scrollY)
        const save = document.querySelector('[data-section="save"]')
        const saveButton = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Download save file')
        const headings = [...document.querySelectorAll('h2')].map((e) => ({ text: (e as HTMLElement).innerText.trim().slice(0, 50), top: top(e), screen: Math.round((top(e) / h) * 10) / 10 }))
        const words = (el: Element | null): number => (((el as HTMLElement | null)?.innerText ?? '').match(/[\p{L}\p{N}]+/gu) ?? []).length
        const aboveFold = [...document.querySelectorAll('h1, h2, h3, button, p, summary')].filter((e) => {
          const r = e.getBoundingClientRect()
          return r.height > 0 && r.top + window.scrollY < h
        }).map((e) => `${e.tagName.toLowerCase()}: ${(e as HTMLElement).innerText.trim().slice(0, 50)}`)
        return {
          scrollHeight: document.documentElement.scrollHeight,
          screens: Math.round((document.documentElement.scrollHeight / h) * 10) / 10,
          saveTop: save === null ? null : top(save),
          saveScreens: save === null ? null : Math.round((top(save) / h) * 10) / 10,
          saveButtonTop: saveButton === undefined ? null : top(saveButton),
          headingsBeforeSave: headings.filter((x) => save !== null && x.top < top(save)),
          headings,
          wordsBeforeSave: save === null ? null : [...document.querySelectorAll('main > *, .hb-reveal > *')].filter((e) => top(e) < top(save)).reduce((n, e) => n + words(e), 0),
          wordsPage: words(document.body),
          aboveFold,
        }
      })
      await shots.shot(`results-${vp.width}`, { fullPage: true })
      await shots.shot(`results-${vp.width}-fold`, { fullPage: false })
    }
    out['resultsLength'] = lengths
    // After the save: how much longer the page gets.
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.getByRole('button', { name: 'Download save file' }).click()
    await expect(page.locator('[data-share-card]')).toBeVisible()
    await page.waitForTimeout(500)
    out['resultsSavedLength'] = await page.evaluate(() => ({ scrollHeight: document.documentElement.scrollHeight, screens: Math.round((document.documentElement.scrollHeight / window.innerHeight) * 10) / 10, h2: [...document.querySelectorAll('h2')].length, h3: [...document.querySelectorAll('h3')].length }))
    await shots.shot('results-saved-1280', { fullPage: true })
    await ctx.close()
  }

  jsonShots.json('speed', out, { counter: false })
  await jsonCtx.close()
  console.log(`[skimmer speed] ${JSON.stringify({ cold: (out['coldLoad'] as LoadTiming).msToH1, fast3g: (out['fast3g'] as LoadTiming).msToH1, js: (out['coldLoad'] as LoadTiming).jsTransfer, build: out['buildUp'], lengths: out['resultsLength'] })}`)
})
