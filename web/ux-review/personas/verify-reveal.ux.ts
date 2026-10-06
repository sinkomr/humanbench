/// <reference lib="dom" />
/**
 * Verification package (run id `verify`), reveal area: the original scenarios of UX-028 to UX-036 (UX-012b and UX-018b are
 * in verify-session.ux.ts) and the integration item UX-056 on the FIXED build. Evidence under
 * web/test-results/ux-review/verify/<item id>/.
 *
 *   UX_REUSE=1 UX_PORT=4653 UX_RUN=verify npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/verify-reveal.ux.ts --project=chromium
 */

import { readFileSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { button, h1, toResults } from '../../e2e/flow'
import { chordFor } from '../../e2e/keyboard'
import { openRoute, PREVIEW_ROUTES, type Route } from '../../e2e/routes'
import { SessionDriver } from '../../e2e/session-driver'
import { pageMetrics, Shots, trackConsole } from '../lib'

const RUN = process.env.UX_RUN ?? 'verify'

test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 })

function routeOf(id: string): Route {
  const r = PREVIEW_ROUTES.find((x) => x.id === id)
  if (r === undefined) throw new Error(`no route ${id}`)
  return r
}

async function open(page: Page, id: string): Promise<void> {
  await page.goto('./favicon.svg')
  await page.evaluate('localStorage.clear(); sessionStorage.clear()')
  const r = routeOf(id)
  await r.prepare?.(page)
  if (r.motion !== 'allow') await page.emulateMedia({ reducedMotion: 'reduce' })
  await openRoute(page, r)
}

const what = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return 'nothing (body)'
    const label = el.getAttribute('aria-label') || ((el as HTMLInputElement).labels?.[0]?.textContent ?? '') || el.textContent || ''
    return `${el.tagName.toLowerCase()}${el.getAttribute('type') ? `[${el.getAttribute('type')}]` : ''} "${label.replace(/\s+/g, ' ').trim().slice(0, 60)}"${(el as HTMLButtonElement).disabled ? ' (disabled)' : ''}${el.getAttribute('aria-disabled') === 'true' ? ' (aria-disabled)' : ''}`
  })

async function press(touch: boolean, target: Locator): Promise<void> {
  if (touch) await target.tap()
  else await target.click()
}

const bodyText = (page: Page): Promise<string> => page.locator('body').innerText()
const savePanel = (page: Page): Locator => page.locator('section[data-section="save"]')
const inView = (l: Locator): Promise<{ top: number; bottom: number; inView: boolean }> => l.evaluate((el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), inView: r.bottom > 0 && r.top < innerHeight } })

// ------------------------------------------------------------------------------------------------ UX-028 / UX-029 / UX-030 / UX-031 / UX-056

test('verify UX-028 to UX-031 save panel: stay, pointer, messages, pending note', async ({ page, context }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  const project = testInfo.project.name
  const shots = new Shots(page, RUN, `UX-028-031/${testInfo.project.name}`)
  const log = trackConsole(page)
  const facts: Record<string, unknown> = { project }
  if (project === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await toResults(page, 1)
  await expect(button(page, 'Download save file')).toBeVisible()
  await expect(page.locator('.reveal[data-building="false"]')).toBeVisible({ timeout: 60_000 }).catch(() => undefined)
  await page.waitForTimeout(300)
  const vh = await page.evaluate(() => innerHeight)
  // UX-029: the top of the page before the save.
  await page.evaluate(() => scrollTo(0, 0))
  facts['UX-029 top of page'] = {
    pointer: await page.locator('[data-save-pointer]').evaluate((el) => ({ text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(), visibility: getComputedStyle(el).visibility, role: el.getAttribute('role'), ready: el.getAttribute('data-ready'), top: Math.round(el.getBoundingClientRect().top), inFirstScreen: el.getBoundingClientRect().bottom <= innerHeight })).catch(() => null),
    pointerLink: await page.locator('[data-save-pointer] a').evaluate((a) => ({ text: (a.textContent ?? '').trim(), href: a.getAttribute('href') })).catch(() => null),
    chartTop: await page.locator('figure.blob-figure').evaluate((el) => Math.round(el.getBoundingClientRect().top)).catch(() => null),
    savePanelTop: await savePanel(page).evaluate((el) => Math.round(el.getBoundingClientRect().top + scrollY)),
    savePanelStyle: await savePanel(page).evaluate((el) => { const cs = getComputedStyle(el); return { border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`, bg: cs.backgroundColor, padding: cs.padding } }),
    pageHeight: await page.evaluate(() => document.documentElement.scrollHeight),
    vh,
    shot: await shots.shot('results-top-unsaved', { fullPage: false }),
  }
  // The pointer link: where does it take you?
  const link = page.locator('[data-save-pointer] a')
  if ((await link.count()) > 0) {
    await press(touch, link)
    await page.waitForTimeout(500)
    facts['UX-029 after pointer link'] = { focus: await what(page), savePanel: await inView(savePanel(page)), shot: await shots.shot('after-pointer-link', { fullPage: false }) }
  }
  // UX-031: the pending note.
  facts['UX-031 pending note'] = await page.locator('[data-pending]').evaluate((el) => { const cs = getComputedStyle(el); const panel = el.closest('.hb-reveal-panel'); const sib = document.querySelector('[data-section="save"]'); return { text: (el.textContent ?? '').trim(), x: Math.round(el.getBoundingClientRect().left), panelX: panel ? Math.round(panel.getBoundingClientRect().left) : null, savePanelX: sib ? Math.round(sib.getBoundingClientRect().left) : null, color: cs.color, fontSize: cs.fontSize, classes: el.className, inPanel: panel !== null } }).catch(() => null)
  // UX-028: Back to the start -> Stay and save.
  const back = button(page, 'Back to the start')
  await back.scrollIntoViewIfNeeded()
  await press(touch, back)
  await expect(page.getByRole('heading', { level: 2, name: 'Leave without saving?' })).toBeVisible()
  await press(touch, button(page, 'Stay and save'))
  await page.waitForTimeout(600)
  facts['UX-028 after Stay and save'] = { focus: await what(page), scrollY: await page.evaluate(() => Math.round(scrollY)), download: await inView(button(page, 'Download save file')), savePanel: await inView(savePanel(page)), shot: await shots.shot('after-stay-and-save', { fullPage: false }) }
  // UX-030: copy the save code (one message), then download (status + file name line + done text).
  const panel = savePanel(page)
  await panel.scrollIntoViewIfNeeded()
  await press(touch, button(page, 'Copy save code'))
  await page.waitForTimeout(800)
  const statuses = (): Promise<string[]> => panel.locator('[role=status]').allInnerTexts()
  facts['UX-030 after Copy save code (unsaved)'] = { statuses: await statuses(), messageCount: (await panel.innerText()).match(/Save code copied/g)?.length ?? 0, panelText: (await panel.innerText()).replace(/\s+/g, ' ').slice(0, 600), saved: await panel.getAttribute('data-saved'), shot: await shots.shot('after-copy-code', { locator: panel }) }
  const [download] = await Promise.all([page.waitForEvent('download'), press(touch, button(page, 'Download save file'))])
  const name = download.suggestedFilename()
  const file = await download.path()
  await expect(panel).toHaveAttribute('data-saved', 'true')
  await page.waitForTimeout(400)
  const panelText = (await panel.innerText()).replace(/\s+/g, ' ')
  facts['UX-030 after download'] = {
    fileName: name,
    statuses: await statuses(),
    savedAsLine: await panel.locator('[data-saved-as]').innerText().catch(() => null),
    nameInPanel: panelText.includes(name),
    mentionsDownloadsFolder: /downloads folder|files app/i.test(panelText),
    doneText: await panel.locator('.done').innerText().catch(() => null),
    downloadStillPrimary: await button(page, 'Download save file').evaluate((b) => b.classList.contains('hb-primary')),
    panelStyle: await panel.evaluate((el) => { const cs = getComputedStyle(el); return { border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`, bg: cs.backgroundColor, padding: cs.padding } }),
    pointerGone: (await page.locator('[data-save-pointer]').count()) === 0 || (await page.locator('[data-save-pointer]').evaluate((el) => getComputedStyle(el).display === 'none' || getComputedStyle(el).visibility === 'hidden')),
    shareCardBelowFold: await page.locator('[data-share-card]').evaluate((el) => el.getBoundingClientRect().top > innerHeight).catch(() => null),
    shot: await shots.shot('save-panel-after-download', { locator: panel }),
    viewportShot: await shots.shot('after-download-viewport', { fullPage: false }),
  }
  await press(touch, button(page, 'Copy save code'))
  await page.waitForTimeout(600)
  facts['UX-030 copy after save'] = { statuses: await statuses(), messageCount: (await panel.innerText()).match(/Save code copied/g)?.length ?? 0 }
  // UX-056: the restore copy names the right screen (the results-talk / spacing text and the backend copy both say "Ready when you are").
  const text = await bodyText(page)
  facts['UX-056 / UX-034 screen named for loading'] = { startScreen: text.match(/[^.\n]*start screen[^.\n]*\./gi), readyScreen: text.match(/[^.\n]*Ready when you are[^.\n]*\./g) }
  facts['download file'] = file === null ? null : { sessions: (JSON.parse(readFileSync(file, 'utf8')) as { sessions: unknown[] }).sessions.length }
  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[verify UX-028..031] ${JSON.stringify(facts).slice(0, 3500)}`)
})

// ------------------------------------------------------------------------------------------------ UX-032

test('verify UX-032 share card: too few skills, PNG button, full-size link', async ({ page, browserName }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `UX-032/${testInfo.project.name}`)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  // A. The full profile: hide all (3+ measured, none ticked) keeps the old instruction.
  await open(page, 'share-card-too-few')
  const card = page.locator('[data-share-card]')
  facts['A hide all (7 measured)'] = { count: await card.locator('[data-count]').innerText(), needsMore: await card.locator('[data-needs-more]').count(), buttons: await card.locator('button').evaluateAll((bs) => bs.map((b) => `${(b.textContent ?? '').trim()}${(b as HTMLButtonElement).disabled ? ' (disabled)' : ''}${b.getAttribute('aria-disabled') === 'true' ? ' (aria-disabled)' : ''}`)) }
  await press(touch, button(page, 'Show all'))
  await page.waitForTimeout(300)
  facts['A show all count'] = await card.locator('[data-count]').innerText()
  facts['A count translate spans'] = await card.locator('[data-count] [translate="no"]').count()
  facts['A full-size link'] = await card.locator('[data-fullsize]').evaluate((a) => ({ text: (a.textContent ?? '').trim(), target: a.getAttribute('target'), hrefKind: (a.getAttribute('href') ?? '').slice(0, 5) })).catch(() => null)
  facts['A preview width'] = await page.locator('img[data-preview]').evaluate((img) => Math.round(img.getBoundingClientRect().width))
  await shots.shot('a-card-panel', { locator: card })
  if (!touch) {
    // B. The PNG button while the card is prepared after a change: aria-disabled, still in the Tab order.
    const chord = await chordFor(page, browserName)
    const png = card.getByRole('button', { name: 'Download image (PNG)' })
    const radio = card.locator('fieldset.colours input[type=radio]').first()
    await radio.focus()
    await page.keyboard.press('ArrowDown')
    const t0 = Date.now()
    const samples: string[] = []
    for (let i = 0; i < 60; i++) {
      const s = await png.evaluate((b) => ({ disabled: (b as HTMLButtonElement).disabled, aria: b.getAttribute('aria-disabled'), preparing: document.querySelector('[data-preparing]') !== null }))
      samples.push(`${Date.now() - t0}ms disabled=${s.disabled} aria=${s.aria} preparing=${s.preparing}`)
      if (!s.preparing && i > 2) break
      await page.waitForTimeout(25)
    }
    facts['B PNG state after a colour change'] = samples
    await radio.focus()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press(chord)
    facts['B focus right after ArrowUp + Tab'] = await what(page)
    await page.keyboard.press(chord)
    facts['B next Tab'] = await what(page)
    await page.keyboard.press(chord)
    facts['B next Tab 2'] = await what(page)
    // Tab from the Hide all button onwards: is the PNG button reached?
    let reached = -1
    await button(page, 'Hide all').focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('Space')
    for (let i = 1; i <= 25; i++) {
      await page.keyboard.press(chord)
      if (await png.evaluate((b) => b === document.activeElement)) {
        reached = i
        break
      }
    }
    facts['B Tabs from Hide all to the PNG button'] = reached
    await shots.shot('b-after-colour-change', { fullPage: false })
  }
  // C. A one-skill profile: one answer, finish early, save: what the panel says.
  await page.goto('./favicon.svg')
  await page.evaluate('localStorage.clear(); sessionStorage.clear()')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const driver = new SessionDriver(page, { touch })
  await driver.toReady('./?fast=1')
  await driver.begin()
  await driver.answerOne()
  await driver.finishEarly()
  await driver.resultsReady()
  await expect(page.locator('.reveal[data-building="false"]')).toBeVisible({ timeout: 60_000 }).catch(() => undefined)
  const dl = page.waitForEvent('download')
  await savePanel(page).scrollIntoViewIfNeeded()
  await press(touch, button(page, 'Download save file'))
  await (await dl).cancel().catch(() => undefined)
  await expect(page.locator('[data-share-card]')).toBeVisible()
  await page.waitForTimeout(400)
  facts['C one-skill profile card panel'] = { text: (await card.innerText()).replace(/\s+/g, ' ').slice(0, 500), needsMore: await card.locator('[data-needs-more]').innerText().catch(() => null), checkboxes: await card.locator('input[type=checkbox]').count(), count: await card.locator('[data-count]').innerText().catch(() => null), buttons: await card.locator('button').allInnerTexts(), shot: await shots.shot('c-one-skill-card-panel', { locator: card }) }
  shots.json('facts', facts)
  console.log(`[verify UX-032] ${JSON.stringify(facts).slice(0, 3000)}`)
})

// ------------------------------------------------------------------------------------------------ UX-033

test('verify UX-033 focus-session picker rows', async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `UX-033/${testInfo.project.name}`)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  const ROWS = `[...document.querySelectorAll('.focus-picker label.check, .focus-picker .check')].map((l) => { const r = l.getBoundingClientRect(); const input = l.querySelector('input'); return { text: (l.textContent || '').replace(/\\s+/g, ' ').trim(), name: input ? (input.labels && input.labels[0] ? input.labels[0].textContent.replace(/\\s+/g, ' ').trim() : input.getAttribute('aria-label')) : null, h: Math.round(r.height), top: Math.round(r.top), margin: getComputedStyle(l).margin, tag: l.tagName.toLowerCase(), forAttr: l.getAttribute('for') } })`
  for (const id of ['ready-returning', 'results-saved']) {
    await open(page, id)
    const picker = page.locator('.focus-picker').first()
    await picker.scrollIntoViewIfNeeded()
    await page.waitForTimeout(200)
    const rows = (await page.evaluate(ROWS)) as { text: string; h: number; top: number }[]
    const pitches = rows.slice(1).map((r, i) => r.top - rows[i]!.top)
    facts[id] = { rows, pitches, minHeight: Math.min(...rows.map((r) => r.h)), spaceBeforeWideRange: rows.every((r) => !/\S\(wide range\)/.test(r.text)), fieldsetBorder: await page.locator('.focus-picker fieldset').first().evaluate((el) => getComputedStyle(el).borderTopWidth), text: await picker.innerText().then((t) => t.replace(/\s+/g, ' ').slice(0, 400)), shot: await shots.shot(`${id}-picker`, { locator: picker }) }
    facts[`${id} metrics`] = (await pageMetrics(page, { touch, scope: '.focus-picker' })).smallTargets.map((t) => `${t.role} "${t.name}" ${t.size.w}x${t.size.h}`)
  }
  shots.json('facts', facts)
  console.log(`[verify UX-033] ${JSON.stringify(facts).slice(0, 2500)}`)
})

// ------------------------------------------------------------------------------------------------ UX-034 / UX-035 / UX-036

test('verify UX-034 UX-035 UX-036 reveal copy, worked examples, polish', async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.hasTouch === true, 'desktop copy check')
  const shots = new Shots(page, RUN, `UX-034-036/${testInfo.project.name}`)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  for (const sessions of [1, 2] as const) {
    await page.goto('./favicon.svg')
    await page.evaluate('localStorage.clear(); sessionStorage.clear()')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await toResults(page, sessions)
    await expect(button(page, 'Download save file')).toBeVisible()
    await expect(page.locator('.reveal[data-building="false"]')).toBeVisible({ timeout: 60_000 }).catch(() => undefined)
    await page.evaluate(() => { for (const d of document.querySelectorAll('details')) d.setAttribute('open', '') })
    await page.waitForTimeout(200)
    const text = await bodyText(page)
    facts[`${sessions} sessions copy`] = {
      practiceBadge: await page.locator('[data-practice-adjusted]').innerText().then((t) => t.replace(/\s+/g, ' ')).catch(() => null),
      describeYou: text.match(/[^.\n]*describe you[^.\n]*\./g),
      youGained: text.match(/[^.\n]*you gained[^.\n]*\./g),
      peaksIntro: await page.locator('[data-section="peaks"] p').first().innerText().catch(() => null),
      peaksNote: await page.locator('[data-section="peaks"] p.note').innerText().catch(() => null),
      peaksNoteMentionsColour: /colou?r|blue|grey|gray/i.test((await page.locator('[data-section="peaks"] p.note').innerText().catch(() => '')) ?? ''),
      restOfProfile: text.match(/[^.\n]*rest of your profile[^.\n]*\./g),
      startScreen: text.match(/[^.\n]*start screen[^.\n]*\./gi),
      normsLine: text.match(/[^.\n]*About these numbers[^.\n]*/g) ?? text.match(/[^\n]*norms[^\n]*/gi)?.slice(0, 3),
      numbersHeading: await page.locator('[data-section="numbers"] h2, [data-section="numbers"] summary').first().innerText().catch(() => null),
      numbersFirstLine: await page.locator('[data-section="numbers"] p').first().innerText().catch(() => null),
      paceLine: text.match(/[^.\n]*(seconds? per question|s per question|×|2x)[^.\n]*\./gi),
      shareTalk: await page.locator('[data-talk-link]').innerText().catch(() => null),
      workedHeading: await page.locator('[data-section="worked"] h2').innerText().catch(() => null),
      workedCount: await page.locator('[data-section="worked"] article').count(),
      workedTitles: await page.locator('[data-section="worked"] article h3').allInnerTexts().catch(() => []),
      workedQuestions: await page.locator('[data-section="worked"] article p.terms').allInnerTexts().catch(() => []),
      subtract1x: text.match(/[^.\n]*subtract 1x[^.\n]*/g),
      termOfSeries: text.match(/[^.\n]*(next term|of this series)[^.\n]*/g),
      quantTermsBold: await page.locator('[data-section="worked"] article[data-worked="quant"] p.terms').evaluate((el) => ({ fontWeight: getComputedStyle(el).fontWeight, strong: el.querySelector('strong') !== null })).catch(() => null),
      disclosureInCard: await page.locator('[data-section="worked"] article details').first().evaluate((el) => { const cs = getComputedStyle(el); return { border: `${cs.borderTopWidth} ${cs.borderTopStyle}`, bg: cs.backgroundColor, padding: cs.padding } }).catch(() => null),
      summaryMarkers: await page.locator('.hb-reveal summary, .reveal-sections summary, main summary').evaluateAll((ss) => ss.slice(0, 6).map((s) => { const cs = getComputedStyle(s); const before = getComputedStyle(s, '::before'); const marker = getComputedStyle(s, '::marker'); return { text: (s.textContent ?? '').trim().slice(0, 40), listStyle: cs.listStyleType, display: cs.display, beforeContent: before.content, beforeBorder: `${before.borderTopWidth} ${before.borderRightWidth}`, markerContent: marker.content } })),
      h2Styles: await page.locator('h2').evaluateAll((hs) => hs.filter((h) => h.getBoundingClientRect().height > 0).map((h) => ({ text: (h.textContent ?? '').trim().slice(0, 40), color: getComputedStyle(h).color, size: getComputedStyle(h).fontSize }))),
    }
    await shots.shot(`${sessions}-sessions-results-open`, { fullPage: true })
  }
  // UX-036: the build-up status is announced (mounted empty, then filled).
  await page.goto('./favicon.svg')
  await page.evaluate('localStorage.clear(); sessionStorage.clear()')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await toResults(page, 1)
  const status = page.locator('.reveal [role="status"]').first()
  const seen: string[] = []
  const t0 = Date.now()
  for (let i = 0; i < 30; i++) {
    const t = ((await status.textContent().catch(() => null)) ?? '').trim()
    if (seen.length === 0 || seen[seen.length - 1]!.split('|')[1] !== t) seen.push(`${Date.now() - t0}ms|${t}`)
    if (/ready/i.test(t)) break
    await page.waitForTimeout(100)
  }
  facts['UX-036 build-up status over time'] = seen
  await shots.shot('build-up', { fullPage: false })
  shots.json('facts', facts)
  console.log(`[verify UX-034..036] ${JSON.stringify(facts).slice(0, 4000)}`)
})

// ------------------------------------------------------------------------------------------------ phone: the results page metrics after the fixes (regression spot check)

test('verify reveal phone metrics', async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.hasTouch !== true, 'phone only')
  const shots = new Shots(page, RUN, `reveal-phone/${testInfo.project.name}`)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  await open(page, 'results-saved')
  const m = await pageMetrics(page, { touch: true, axe: true })
  facts['results-saved'] = { overflowX: m.overflowX.px, clipped: m.clipped, smallTargets: m.smallTargets.filter((t) => !t.inline).map((t) => `${t.role} "${t.name}" ${t.size.w}x${t.size.h}`), axeSerious: m.axe?.serious.map((v) => `${v.id} x${v.nodes}`), headings: m.headings.map((h) => `${h.level} ${h.text}`) }
  await shots.all('results-saved')
  facts['card preview'] = await page.locator('img[data-preview]').evaluate((img) => ({ cssW: Math.round(img.getBoundingClientRect().width) }))
  facts['full-size link'] = await page.locator('[data-fullsize]').evaluate((a) => ({ text: (a.textContent ?? '').trim(), h: Math.round(a.getBoundingClientRect().height) })).catch(() => null)
  shots.json('facts', facts)
  console.log(`[verify reveal phone] ${JSON.stringify(facts).slice(0, 2000)}`)
})

// ------------------------------------------------------------------------------------------------ keyboard: results leave by keys (regression of the UX-005b/UX-028 combination)

test('verify results leave by keyboard', async ({ page, browserName }, testInfo) => {
  test.skip(testInfo.project.use.hasTouch === true, 'keyboard scenario')
  const chord = await chordFor(page, browserName)
  const shots = new Shots(page, RUN, `results-leave-keys/${testInfo.project.name}`)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  await open(page, 'results')
  await button(page, 'Back to the start').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 2, name: 'Leave without saving?' })).toBeVisible()
  await page.keyboard.press(chord)
  facts['first Tab'] = await what(page)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  facts['after Enter'] = { focus: await what(page), h1: (await h1(page).innerText()).trim(), download: await inView(button(page, 'Download save file')).catch(() => null) }
  await shots.shot('after-first-tab-enter', { fullPage: false })
  shots.json('facts', facts)
  console.log(`[verify results-leave-keys] ${JSON.stringify(facts)}`)
})
