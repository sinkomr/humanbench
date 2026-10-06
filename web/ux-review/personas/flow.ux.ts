/**
 * Flow and information-architecture review (package rev-flow, run id `flow`): the entry points and the links
 * between them, the start funnel, orientation during a session, the end sequence, and the edge paths (under 18,
 * the gate error, Back/Forward and hash changes, refresh, two tabs, leaving the results, a bad save, nothing measured).
 *
 *   UX_PORT=4621 UX_RUN=flow npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/flow.ux.ts --project=chromium --grep 'flow: map'
 *
 * One test per stage, so each run is short. Evidence goes to web/test-results/ux-review/<UX_RUN>/<stage>-<project>/.
 */

import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { button, h1, simulatedSave, unloadIsGuarded } from '../../e2e/flow'
import { SessionDriver } from '../../e2e/session-driver'
import { SEGMENT_TITLES } from '../../e2e/routes'
import { playJourney, Shots, tour, trackConsole } from '../lib'

const RUN = process.env.UX_RUN ?? 'flow'

// A step that cannot happen fails in seconds, not at the 15-minute test limit.
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 })

interface LinkInfo {
  readonly text: string
  readonly href: string
  readonly target: string
}

async function links(page: Page): Promise<LinkInfo[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('a')].map((a) => ({ text: (a.textContent ?? '').trim(), href: a.getAttribute('href') ?? '', target: a.getAttribute('target') ?? '' })),
  )
}

async function headings(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('h1, h2, h3, summary')]
      .filter((el) => (el as HTMLElement).offsetParent !== null || el.tagName === 'SUMMARY')
      .map((el) => `${el.tagName.toLowerCase()}: ${(el.textContent ?? '').trim().replace(/\s+/g, ' ')}`),
  )
}

async function storage(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const out: Record<string, number> = {}
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k !== null) out[k] = (localStorage.getItem(k) ?? '').length
      }
    } catch {
      out['<unavailable>'] = 0
    }
    return out
  })
}

async function heading(page: Page): Promise<string> {
  return ((await page.locator('h1').first().textContent({ timeout: 3000 }).catch(() => null)) ?? '').trim()
}

async function ringText(page: Page): Promise<string> {
  return ((await page.locator('.ring, [class*="progress"]').first().textContent({ timeout: 1000 }).catch(() => null)) ?? '').trim().replace(/\s+/g, ' ')
}

async function pageHeight(page: Page): Promise<{ height: number; viewport: number }> {
  return page.evaluate(() => ({ height: document.documentElement.scrollHeight, viewport: window.innerHeight }))
}

async function throughGateToReady(page: Page, touch: boolean): Promise<void> {
  // From the welcome screen: Start, the gate when it is asked, the honour code, the device check.
  await button(page, 'Start').click()
  await expect(h1(page)).toHaveText(/^(Before you start|Honour code)$/)
  if ((await heading(page)) === 'Before you start') {
    await page.getByRole('checkbox', { name: /18 or older/ }).check()
    await button(page, 'Continue').click()
  }
  await expect(h1(page)).toHaveText('Honour code')
  await page.getByRole('checkbox', { name: /honour code/ }).check()
  await button(page, 'Continue').click()
  await expect(h1(page)).toHaveText('Check your device')
  await expect(button(page, 'Continue')).toBeEnabled({ timeout: 20_000 })
  await page.getByRole('radio', { name: touch ? 'Tap or click' : 'Keyboard' }).check()
  await button(page, 'Continue').click()
  await expect(h1(page)).toHaveText('Ready when you are')
}

// --------------------------------------------------------------------------- 1. map

test('flow: map', async ({ page }, info) => {
  const shots = new Shots(page, RUN, `map-${info.project.name}`)
  const log = trackConsole(page)
  const map: Record<string, unknown> = {}

  await page.goto('./')
  await expect(h1(page)).toHaveText('HumanBench')
  await shots.all('index-welcome')
  map.welcome = { links: await links(page), footer: await page.locator('footer').innerText(), title: await page.title() }

  await page.getByRole('link', { name: 'Privacy and terms' }).click()
  await expect(h1(page)).toHaveText('Privacy and terms')
  await shots.all('privacy-from-welcome')
  map.privacy = { url: page.url(), links: await links(page), headings: await headings(page) }
  await page.getByRole('link', { name: 'Back', exact: true }).click()
  await shots.all('privacy-back-link')
  map.privacyBack = { url: page.url(), h1: await heading(page) }
  await page.goBack()
  map.afterHistoryBack1 = { url: page.url(), h1: await heading(page) }
  await page.goBack()
  map.afterHistoryBack2 = { url: page.url(), h1: await heading(page) }

  await page.goto('./notes.html')
  await page.waitForLoadState('networkidle')
  await shots.all('notes-direct')
  map.notes = { url: page.url(), title: await page.title(), links: await links(page), headings: await headings(page), height: await pageHeight(page) }

  await page.goto('./rt-selftest.html')
  await page.waitForLoadState('networkidle')
  await shots.all('rt-selftest-direct')
  map.selftest = { url: page.url(), title: await page.title(), links: await links(page), headings: await headings(page) }

  await page.goto('./#/privacy')
  await expect(h1(page)).toHaveText('Privacy and terms')
  await shots.all('privacy-direct')
  await page.getByRole('link', { name: 'Back', exact: true }).click()
  map.privacyDirectBack = { url: page.url(), h1: await heading(page) }

  await page.goto('./#/data')
  await page.waitForTimeout(500)
  await shots.all('data-hash-static')
  map.dataHash = { url: page.url(), h1: await heading(page), text: (await page.locator('body').innerText()).slice(0, 400) }

  await page.goto('./#/nonsense')
  await page.waitForTimeout(500)
  map.unknownHash = { url: page.url(), h1: await heading(page) }

  shots.json('map', map)
  shots.json('console', log)
})

// --------------------------------------------------------------------------- 2. the start funnel

test('flow: funnel', async ({ page, context }, info) => {
  const touch = info.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `funnel-${info.project.name}`)
  const log = trackConsole(page)
  const notes: Record<string, unknown> = {}

  await page.goto('./')
  await shots.all('welcome')
  notes.welcomeHeight = await pageHeight(page)
  await button(page, 'Start').click()
  await expect(h1(page)).toHaveText('Before you start')
  await shots.all('gate')
  await button(page, 'Continue').click()
  await shots.all('gate-error')
  await button(page, 'I am under 18').click()
  await shots.all('under-18')
  notes.blocked = { h1: await heading(page), buttons: await page.getByRole('button').allInnerTexts(), links: await links(page), storage: await storage(page) }
  await page.reload()
  await shots.all('under-18-after-reload')
  notes.blockedAfterReload = { h1: await heading(page), storage: await storage(page) }

  // The gate's link to the notice opens a second tab.
  await button(page, 'Start').click()
  const popupWait = context.waitForEvent('page', { timeout: 5000 }).catch(() => null)
  await page.getByRole('link', { name: /privacy notice/ }).click()
  const popup = await popupWait
  if (popup !== null) {
    await popup.waitForLoadState()
    const ps = new Shots(popup, RUN, `funnel-${info.project.name}-popup`)
    await ps.shot('gate-privacy-new-tab')
    notes.gatePrivacyTab = { url: popup.url(), h1: ((await popup.locator('h1').first().textContent()) ?? '').trim() }
    await popup.getByRole('link', { name: 'Back', exact: true }).click()
    notes.gatePrivacyTabBack = { url: popup.url(), h1: ((await popup.locator('h1').first().textContent()) ?? '').trim() }
    await popup.close()
  }

  await page.getByRole('checkbox', { name: /18 or older/ }).check()
  await button(page, 'Continue').click()
  await expect(h1(page)).toHaveText('Honour code')
  await shots.all('honour')
  notes.storageAfterGate = await storage(page)
  await page.getByRole('checkbox', { name: /honour code/ }).check()
  await button(page, 'Continue').click()
  await expect(h1(page)).toHaveText('Check your device')
  const t0 = Date.now()
  await shots.all('device-measuring')
  await expect(button(page, 'Continue')).toBeEnabled({ timeout: 20_000 })
  notes.deviceWaitMs = Date.now() - t0
  await shots.all('device-done')
  await page.getByRole('radio', { name: touch ? 'Tap or click' : 'Keyboard' }).check()
  await button(page, 'Continue').click()
  await expect(h1(page)).toHaveText('Ready when you are')
  await shots.all('ready-first-visit')
  notes.ready = { headings: await headings(page), buttons: await page.getByRole('button').allInnerTexts(), height: await pageHeight(page) }

  // Load: nothing chosen, a bad file, JSON that is not a save.
  await button(page, 'Load').click()
  notes.loadNothing = await page.getByRole('status').last().innerText()
  await page.getByLabel('Save file').setInputFiles({ name: 'holiday.txt', mimeType: 'text/plain', buffer: Buffer.from('not a save at all') })
  await button(page, 'Load').click()
  await page.waitForTimeout(300)
  notes.loadGarbage = await page.getByRole('status').last().innerText()
  await shots.shot('ready-bad-file')
  await page.getByLabel('Save file').setInputFiles({ name: 'other.json', mimeType: 'application/json', buffer: Buffer.from('{"hello": 1}') })
  await button(page, 'Load').click()
  await page.waitForTimeout(300)
  notes.loadForeignJson = await page.getByRole('status').last().innerText()

  // Practice: the way in and the way back.
  await button(page, 'Try practice questions first').click()
  await expect(h1(page)).toHaveText('Practice')
  await shots.all('practice')
  notes.practiceButtons = await page.getByRole('button').allInnerTexts()
  await button(page, 'Stop practice').click()
  notes.practiceBack = await heading(page)
  await shots.shot('practice-back')

  // Refresh at the ready screen: what does a returning person see?
  await page.reload()
  notes.reloadAtReady = await heading(page)
  await shots.all('reload-at-ready')
  await button(page, 'Start').click()
  notes.afterReloadStart = await heading(page)
  await shots.all('returning-start')
  shots.json('funnel', notes)
  shots.json('console', log)
})

// --------------------------------------------------------------------------- 3. the session (orientation)

test('flow: session', async ({ page }, info) => {
  const touch = info.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `session-${info.project.name}`)
  const log = trackConsole(page)
  const result = await playJourney(page, { runId: RUN, touch, shots, skipParts: ['Spatial'] })
  shots.json('console', log)
  expect(result.steps.length).toBeGreaterThan(3)
})

// --------------------------------------------------------------------------- 4. idle: time-outs, the break, the hard stop

test('flow: idle', async ({ page }, info) => {
  const touch = info.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `idle-${info.project.name}`)
  const driver = new SessionDriver(page, { touch })
  await driver.toReady('./?fast=1')
  await driver.begin()
  await driver.skipPart()
  await expect(h1(page)).toHaveText(`Up next: ${SEGMENT_TITLES[1]}`)
  await shots.all('interstitial-after-skip')
  await driver.press(button(page, 'Start'))
  const t0 = Date.now()
  const timeline: { t: number; h1: string; ring: string; notice: string }[] = []
  let lastSig = ''
  let tookBreak = false
  for (let i = 0; i < 60; i++) {
    const h = await heading(page)
    const ring = await ringText(page)
    const notice = ((await page.locator('.notice, [role="status"]').first().textContent({ timeout: 500 }).catch(() => null)) ?? '').trim().replace(/\s+/g, ' ')
    const sig = `${h}|${notice}`
    if (sig !== lastSig) {
      timeline.push({ t: Math.round((Date.now() - t0) / 1000), h1: h, ring, notice })
      await shots.shot(`idle-${h}-${notice.slice(0, 30)}`, { fullPage: false })
      lastSig = sig
    }
    if (h === 'Time for a break?' && !tookBreak) {
      await shots.all('break-offer')
      await button(page, 'Take a break').click()
      await expect(h1(page)).toHaveText('Break')
      const before = await ringText(page)
      await shots.all('on-break')
      await page.waitForTimeout(6000)
      timeline.push({ t: Math.round((Date.now() - t0) / 1000), h1: 'Break (after 6 s)', ring: `${before} -> ${await ringText(page)}`, notice: '' })
      await button(page, 'Resume').click()
      tookBreak = true
      continue
    }
    if (h === 'Session complete' || h === 'Session ended') {
      await shots.all('hard-stop-finished')
      break
    }
    await page.waitForTimeout(1000)
  }
  shots.json('timeline', timeline)
})

test('flow: break', async ({ page }, info) => {
  // A slower taker: a pause between steps, so the session clock passes 30 minutes (the break offer) before the end.
  const touch = info.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `break-${info.project.name}`)
  const driver = new SessionDriver(page, { touch })
  const notes: Record<string, unknown>[] = []
  await driver.toReady('./?fast=1')
  await driver.begin()
  // Does the clock run on an interstitial nobody has started?
  const r0 = await ringText(page)
  await page.waitForTimeout(6000)
  notes.push({ what: 'interstitial idle 6 s', before: r0, after: await ringText(page) })
  const t0 = Date.now()
  let lastH = ''
  for (let i = 0; i < 400 && Date.now() - t0 < 200_000; i++) {
    const screen = await driver.screen()
    const h = await heading(page)
    if (h !== lastH) {
      notes.push({ t: Math.round((Date.now() - t0) / 1000), h1: h, ring: await ringText(page) })
      lastH = h
    }
    if (screen === 'finished') {
      await shots.all('finished')
      break
    }
    if (screen === 'break') {
      await shots.all('break-offer')
      await button(page, 'Take a break').click()
      await expect(h1(page)).toHaveText('Break')
      const before = await ringText(page)
      await shots.all('on-break')
      await page.waitForTimeout(6000)
      notes.push({ what: 'on break 6 s', before, after: await ringText(page) })
      await button(page, 'Resume').click()
      await shots.shot('after-resume', { fullPage: false })
      notes.push({ what: 'after resume', h1: await heading(page), ring: await ringText(page) })
      continue
    }
    if (screen === 'interstitial') await shots.shot(`interstitial-${h}`, { fullPage: false })
    await driver.step()
    await page.waitForTimeout(screen === 'choice' || screen === 'entry' ? 2500 : 300)
  }
  shots.json('break', notes)
})

test('flow: tour', async ({ context }, info) => {
  // States that need a fake clock or a prepared save: opened the way the accessibility sweep opens them.
  const routes = ['break-offer', 'on-break', 'ready-returning', 'results-leave', 'notes-returning', 'notes-kept']
  const entries = await tour(context, { runId: RUN, sub: `tour-${info.project.name}`, routes, metrics: false, touch: info.project.use.hasTouch === true })
  expect(entries.filter((e) => !e.ok).map((e) => `${e.route}: ${e.error ?? ''}`)).toEqual([])
})

// --------------------------------------------------------------------------- 5. the end sequence

test('flow: end', async ({ page }, info) => {
  const touch = info.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `end-${info.project.name}`)
  const log = trackConsole(page)
  const notes: Record<string, unknown> = {}
  const sim = simulatedSave(1)

  await page.goto('./?fast=1')
  await throughGateToReady(page, touch)
  await page.getByLabel('Save file').setInputFiles({ name: 'humanbench-save.txt', mimeType: 'text/plain', buffer: Buffer.from(JSON.stringify(sim.save)) })
  await button(page, 'Load').click()
  await expect(page.getByText(/Loaded \d+ earlier sessions?/)).toBeVisible()
  await shots.all('ready-loaded')
  notes.readyLoaded = await headings(page)
  await button(page, 'Begin').click()
  await expect(h1(page)).toHaveText('Up next: Reaction time')
  await button(page, 'Finish early').click()
  await shots.all('confirm-finish')
  await button(page, 'Finish now').click()
  await expect(h1(page)).toHaveText('Session complete')
  await shots.shot('results-building', { fullPage: false })
  await expect(page.locator('.reveal [role="status"]').first()).toHaveText('Your profile is ready.', { timeout: 30_000 })
  await shots.shot('results-top', { fullPage: false })
  await shots.all('results-full-before-save')
  notes.beforeSave = { headings: await headings(page), height: await pageHeight(page), guarded: await unloadIsGuarded(page) }
  const saveTop = await page.getByRole('button', { name: 'Download save file' }).evaluate((el) => el.getBoundingClientRect().top + window.scrollY)
  notes.saveButtonY = saveTop

  await button(page, 'Back to the start').click()
  await shots.shot('leave-confirm', { locator: page.locator('.hb-reveal-panel.leave') })
  await button(page, 'Stay and save').click()

  const downloadWait = page.waitForEvent('download')
  await button(page, 'Download save file').click()
  const dl = await downloadWait
  const file = await dl.path()
  const saved = JSON.parse(readFileSync(file, 'utf8')) as { sessions: { responses: unknown[] }[] }
  notes.download = { name: dl.suggestedFilename(), sessions: saved.sessions.length, responsesPerSession: saved.sessions.map((s) => s.responses.length) }
  await page.waitForTimeout(500)
  await shots.all('results-full-after-save')
  notes.afterSave = { headings: await headings(page), height: await pageHeight(page), guarded: await unloadIsGuarded(page) }

  // Back to the start after the save, and back to the ready screen: can the results be seen again?
  await button(page, 'Back to the start').click()
  notes.afterBack = await heading(page)
  await shots.all('after-back-to-start')
  await throughGateToReady(page, touch)
  await shots.all('ready-after-results')
  notes.readyAfter = { headings: await headings(page), buttons: await page.getByRole('button').allInnerTexts(), text: await page.locator('main, body').first().innerText() }

  shots.json('end-part1', notes)

  // The only way back to the profile: load the file again, Begin, and finish at once.
  await page.getByLabel('Save file').setInputFiles({ name: dl.suggestedFilename(), mimeType: 'application/json', buffer: readFileSync(file) })
  await button(page, 'Load').click()
  await expect(page.getByText(/Loaded \d+ earlier sessions?/)).toBeVisible()
  await shots.all('ready-reloaded-file')
  await button(page, 'Begin').click()
  await button(page, 'Finish early').click()
  await button(page, 'Finish now').click()
  await expect(h1(page)).toHaveText('Session complete')
  await expect(page.locator('.reveal [role="status"]').first()).toHaveText('Your profile is ready.', { timeout: 30_000 })
  await shots.shot('results-again-top', { fullPage: false })
  const dl2Wait = page.waitForEvent('download')
  await button(page, 'Download save file').click()
  const dl2 = await dl2Wait
  const saved2 = JSON.parse(readFileSync(await dl2.path(), 'utf8')) as { sessions: { responses: unknown[] }[] }
  notes.secondDownload = { name: dl2.suggestedFilename(), sessions: saved2.sessions.length, responsesPerSession: saved2.sessions.map((s) => s.responses.length) }
  notes.secondShareCount = await page.getByText(/sessions?/).allInnerTexts().catch(() => [])
  shots.json('end', notes)
  shots.json('console', log)
})

// --------------------------------------------------------------------------- 6. edge paths

test('flow: edge refresh', async ({ page }, info) => {
  const touch = info.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `edge-refresh-${info.project.name}`)
  const notes: Record<string, unknown> = {}
  const driver = new SessionDriver(page, { touch })
  await driver.toReady('./?fast=1')
  await driver.begin()
  await driver.answerOne()
  await driver.step()
  await driver.step()
  notes.beforeReload = { h1: await heading(page), ring: await ringText(page), guarded: await unloadIsGuarded(page), storage: await storage(page) }
  await shots.shot('mid-session-before-reload', { fullPage: false })
  await page.reload()
  notes.afterReload = await heading(page)
  await shots.all('mid-session-after-reload')
  await throughGateToReady(page, touch)
  await shots.all('ready-after-mid-session-reload')
  notes.ready = await page.locator('body').innerText()
  shots.json('refresh', notes)
})

test('flow: edge history', async ({ page }, info) => {
  const touch = info.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `edge-history-${info.project.name}`)
  const notes: Record<string, unknown> = {}
  await page.goto('./?fast=1')
  await page.getByRole('link', { name: 'Privacy and terms' }).click()
  await expect(h1(page)).toHaveText('Privacy and terms')
  await page.getByRole('link', { name: 'Back', exact: true }).click()
  await expect(h1(page)).toHaveText('HumanBench')
  await throughGateToReady(page, touch)
  await button(page, 'Begin').click()
  await expect(h1(page)).toHaveText('Up next: Reaction time')
  await button(page, 'Skip this part').click()
  await page.locator('section.confirm').getByRole('button', { name: /^Skip / }).click()
  await button(page, 'Start').click()
  await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
  notes.inSession = { url: page.url(), h1: await heading(page), ring: await ringText(page) }
  await shots.shot('in-session', { fullPage: false })
  await page.goBack()
  await page.waitForTimeout(300)
  notes.afterBack1 = { url: page.url(), h1: await heading(page) }
  await shots.all('after-browser-back-1')
  await page.waitForTimeout(8000)
  await page.goBack()
  await page.waitForTimeout(300)
  notes.afterBack2 = { url: page.url(), h1: await heading(page), ring: await ringText(page) }
  await shots.all('after-browser-back-2')
  await page.goForward()
  await page.waitForTimeout(300)
  notes.afterForward = { url: page.url(), h1: await heading(page) }
  shots.json('history', notes)
})

test('flow: edge history plain', async ({ page }, info) => {
  // A person who never opened the notice: the session is the only history entry, so Back leaves the site.
  const touch = info.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `edge-history-plain-${info.project.name}`)
  const notes: Record<string, unknown> = {}
  await page.goto('about:blank')
  await page.goto('./?fast=1')
  await throughGateToReady(page, touch)
  await button(page, 'Begin').click()
  await expect(h1(page)).toHaveText('Up next: Reaction time')
  notes.guardedInSession = await unloadIsGuarded(page)
  let dialog = ''
  page.on('dialog', (d) => {
    dialog = d.type()
    void d.dismiss()
  })
  await page.goBack().catch(() => null)
  await page.waitForTimeout(500)
  notes.afterBack = { url: page.url(), dialog }
  await shots.shot('after-back-from-session', { fullPage: false })
  shots.json('history-plain', notes)
})

test('flow: edge tabs', async ({ page, context }, info) => {
  const touch = info.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `edge-tabs-${info.project.name}`)
  const notes: Record<string, unknown> = {}
  const driver = new SessionDriver(page, { touch })
  await driver.toReady('./?fast=1')
  await driver.begin()
  await driver.answerOne()
  const b = await context.newPage()
  await b.goto('./?fast=1')
  await throughGateToReady(b, touch)
  const sb = new Shots(b, RUN, `edge-tabs-${info.project.name}-b`)
  await sb.all('second-tab-ready')
  notes.tabB = await b.locator('body').innerText()
  await b.close()
  shots.json('tabs', notes)
})

test('flow: edge nothing', async ({ page }, info) => {
  const touch = info.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `edge-nothing-${info.project.name}`)
  const notes: Record<string, unknown> = {}
  const driver = new SessionDriver(page, { touch })
  await driver.toReady('./?fast=1')
  await driver.begin()
  for (let i = 0; i < SEGMENT_TITLES.length; i++) {
    await expect(h1(page)).toHaveText(`Up next: ${SEGMENT_TITLES[i]}`)
    if (i === SEGMENT_TITLES.length - 1) await shots.all('last-interstitial')
    await driver.skipPart()
  }
  await expect(h1(page)).toHaveText('Session ended')
  await shots.all('finished-nothing')
  notes.finished = { text: await page.locator('body').innerText(), guarded: await unloadIsGuarded(page) }
  await button(page, 'Back to the start').click()
  notes.afterBack = await heading(page)
  shots.json('nothing', notes)
})

test('flow: edge leave unsaved', async ({ page }, info) => {
  const touch = info.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `edge-leave-${info.project.name}`)
  const notes: Record<string, unknown> = {}
  const driver = new SessionDriver(page, { touch })
  await driver.toReady('./?fast=1')
  await driver.begin()
  await driver.answerOne()
  await driver.finishEarly()
  await expect(page.locator('.reveal [role="status"]').first()).toHaveText('Your profile is ready.', { timeout: 30_000 })
  await shots.shot('results-one-answer', { fullPage: false })
  notes.results = (await page.locator('body').innerText()).slice(0, 1500)
  await button(page, 'Back to the start').click()
  await button(page, 'Leave anyway').click()
  notes.afterLeave = await heading(page)
  await throughGateToReady(page, touch)
  await shots.all('ready-after-leaving-unsaved')
  notes.ready = await page.locator('body').innerText()
  shots.json('leave', notes)
})
