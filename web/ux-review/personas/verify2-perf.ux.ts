/// <reference lib="dom" />
/**
 * Verification package 2 (run id `verify2`), UX-100: the static welcome shell and the results code split.
 *
 * - speed (Chromium only: throttling needs CDP): Fast 3G plus a 4x slower CPU, as `skimmer: speed` measured the build
 *   before the fix; the time to the first heading text, the blank time (first contentful paint by the page's own clock),
 *   the app's mount, the entry script's raw and gzip size and every resource of the landing page;
 * - shell to app: with every script held, the boxes and colours of the heading, tagline, intro and footer before and after
 *   the mount, light and dark, at 390 and 1280 px (device width on a phone), with screenshots where the engine allows;
 * - one h1, one main, one footer after the mount, the shell gone;
 * - deep links #/privacy and #/data: no welcome text before the app, then the page's own heading;
 * - the results chunk blocked: a `?fast=1` session with one answer ends on the fallback, the save file downloads and is
 *   valid, and once the chunk is reachable "Try again" shows the results.
 *
 *   UX_PORT=4772 UX_RUN=verify2 npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/verify2-perf.ux.ts --project=chromium
 */

import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { expect, test, type Page, type Route } from '@playwright/test'
import { WELCOME_HEADING, WELCOME_INTRO, WELCOME_TAGLINE } from '../../src/session/copy'
import { RESULTS_DOWNLOAD, RESULTS_FAILED, RESULTS_PENDING_HEADING, RESULTS_RETRY } from '../../src/session/results-loader'
import { button, h1, unloadIsGuarded } from '../../e2e/flow'
import { SessionDriver } from '../../e2e/session-driver'
import { pageMetrics, Shots, trackConsole } from '../lib'

const RUN = process.env.UX_RUN ?? 'verify2'

test.use({ actionTimeout: 20_000, navigationTimeout: 60_000 })

const SCRIPTS = /\/assets\/[^/?]+\.js(\?.*)?$/
const RESULTS_CHUNK = /\/assets\/Finished-[^/?]+\.(js|css)(\?.*)?$/
const PARTS = { heading: 'main h1', tagline: 'main p.lead', intro: 'main p.lead + p', disclaimer: 'footer p' } as const
type Part = keyof typeof PARTS

interface Look {
  readonly boxes: Record<Part, { x: number; y: number; width: number; height: number } | null>
  readonly colours: Record<string, string>
  readonly texts: Record<Part, string>
}

async function look(page: Page): Promise<Look> {
  return page.evaluate((parts) => {
    const boxes: Record<string, { x: number; y: number; width: number; height: number } | null> = {}
    const texts: Record<string, string> = {}
    for (const [name, sel] of Object.entries(parts)) {
      const el = document.querySelector(sel)
      const r = el?.getBoundingClientRect()
      boxes[name] = r === undefined ? null : { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
      texts[name] = (el?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
    }
    const cs = (sel: string, prop: string): string => {
      const el = document.querySelector(sel)
      return el === null ? '' : getComputedStyle(el).getPropertyValue(prop)
    }
    return {
      boxes: boxes as Look['boxes'],
      texts: texts as Look['texts'],
      colours: {
        'body background': cs('body', 'background-color'),
        'main background': cs('main', 'background-color'),
        'h1 colour': cs('main h1', 'color'),
        'intro colour': cs('main p.lead + p', 'color'),
        'footer colour': cs('footer p', 'color'),
        'footer border': cs('footer', 'border-top-color'),
        'h1 font': `${cs('main h1', 'font-family')} ${cs('main h1', 'font-size')} ${cs('main h1', 'font-weight')}`,
      },
    }
  }, PARTS)
}

/** Hold every script until `release` is called: the page as it is while its scripts are on their way. */
async function holdScripts(page: Page): Promise<() => Promise<void>> {
  const held: Route[] = []
  let holding = true
  await page.route(SCRIPTS, (route) => {
    if (holding) held.push(route)
    else void route.continue()
  })
  return async () => {
    holding = false
    for (const r of held.splice(0)) await r.continue()
    await page.unroute(SCRIPTS)
  }
}

// ------------------------------------------------------------------------------------------------ speed

test('verify2 UX-100 speed on Fast 3G with a 4x slower CPU', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'network and CPU throttling need a CDP session')
  test.setTimeout(8 * 60_000)
  const facts: Record<string, unknown> = { project: testInfo.project.name, throttling: { latencyMs: 562.5, downMbps: 1.44, upMbps: 0.675, cpuSlowdown: 4 }, skimmerBefore: { fast3gMsToH1: 2401, fast3gDomContentLoaded: 2319, entryRawBytes: 152047, jsBytesOnLanding: 201804, withoutScriptText: '' } }
  const runs: Record<string, unknown>[] = []
  for (let n = 0; n < 3; n++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await ctx.newPage()
    const shots = new Shots(page, RUN, `UX-100/${testInfo.project.name}/speed-${n + 1}`)
    await page.addInitScript(() => {
      const w = window as unknown as { __hbMount?: number }
      new MutationObserver((_, obs) => {
        const app = document.getElementById('app')
        if (app !== null && document.getElementById('hb-shell') === null && app.querySelector('main') !== null) {
          w.__hbMount = performance.now()
          obs.disconnect()
        }
      }).observe(document, { childList: true, subtree: true })
    })
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 562.5, downloadThroughput: (1.44 * 1024 * 1024) / 8, uploadThroughput: (0.675 * 1024 * 1024) / 8 })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    const entry: Buffer[] = []
    page.on('response', (r) => {
      if (/\/assets\/index-[^/]+\.js$/.test(r.url())) void r.body().then((b) => entry.push(b)).catch(() => undefined)
    })
    const t0 = performance.now()
    await page.goto('./', { waitUntil: 'commit' })
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 90_000 })
    const msToHeading = Math.round(performance.now() - t0)
    const headingText = (await page.locator('h1').first().innerText()).trim()
    const startAtHeading = await button(page, 'Start').count()
    const shellShot = n === 0 ? await shots.shot('shell-while-loading', { fullPage: false }) : ''
    await expect(button(page, 'Start')).toBeVisible({ timeout: 120_000 })
    const msToStart = Math.round(performance.now() - t0)
    await page.waitForLoadState('load').catch(() => undefined)
    await expect.poll(() => entry.length, { timeout: 30_000 }).toBeGreaterThan(0)
    const inPage = await page.evaluate(() => {
      const paint = (name: string): number | null => {
        const e = performance.getEntriesByName(name)[0]
        return e === undefined ? null : Math.round(e.startTime)
      }
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
      const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
      return {
        firstPaintMs: paint('first-paint'),
        firstContentfulPaintMs: paint('first-contentful-paint'),
        mountMs: Math.round((window as unknown as { __hbMount?: number }).__hbMount ?? -1),
        htmlResponseEndMs: nav === undefined ? null : Math.round(nav.responseEnd),
        domContentLoadedMs: nav === undefined ? null : Math.round(nav.domContentLoadedEventEnd),
        loadMs: nav === undefined ? null : Math.round(nav.loadEventEnd),
        htmlBytes: nav === undefined ? null : nav.encodedBodySize,
        resources: res.map((r) => ({ name: r.name.replace(/^.*\/assets\//, 'assets/').replace(/^https?:\/\/[^/]+/, ''), bytes: r.encodedBodySize, ms: Math.round(r.duration) })),
      }
    })
    const body = entry[0] as Buffer
    runs.push({ run: n + 1, msToHeadingByPlaywright: msToHeading, headingText, startButtonThereWhenHeadingShowed: startAtHeading > 0, msToStartButton: msToStart, ...inPage, jsBytesOnLanding: inPage.resources.filter((r) => r.name.endsWith('.js')).reduce((s, r) => s + r.bytes, 0), entryRawBytes: body.length, entryGzipBytes: gzipSync(body).length, shellShot })
    if (n === 0) await shots.all('welcome-mounted')
    await ctx.close()
  }
  facts.runs = runs
  const median = (k: string): number | null => { const xs = runs.map((r) => r[k]).filter((v): v is number => typeof v === 'number' && v >= 0).sort((a, b) => a - b); return xs.length === 0 ? null : xs[Math.floor(xs.length / 2)] ?? null }
  facts.summary = { msToHeadingMedian: median('msToHeadingByPlaywright'), firstContentfulPaintMedian: median('firstContentfulPaintMs'), mountMedian: median('mountMs'), msToStartMedian: median('msToStartButton'), entryRawBytes: median('entryRawBytes'), entryGzipBytes: median('entryGzipBytes'), jsBytesOnLanding: median('jsBytesOnLanding'), skimmerFast3gMsToH1: 2401, skimmerEntryRawBytes: 152047 }
  const shots = new Shots((await (await browser.newContext()).newPage()), RUN, `UX-100/${testInfo.project.name}`)
  shots.json('speed-facts', facts)
  console.log(`[verify2 UX-100 speed] ${JSON.stringify(facts.summary)}`)
})

// ------------------------------------------------------------------------------------------------ shell to app

test('verify2 UX-100 shell to app: no jump or flash, light and dark; one h1; deep links', async ({ page, browserName }, testInfo) => {
  test.setTimeout(6 * 60_000)
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `UX-100/${testInfo.project.name}`)
  const log = trackConsole(page)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  const widths = touch ? [page.viewportSize()?.width ?? 390] : [390, 1280]
  const canShotWhileHeld = browserName === 'chromium'
  const moves: string[] = []
  for (const width of widths) {
    for (const colorScheme of ['light', 'dark'] as const) {
      const tag = `${width}-${colorScheme}`
      await page.setViewportSize({ width, height: width === 390 ? 844 : (page.viewportSize()?.height ?? 800) })
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
      const release = await holdScripts(page)
      await page.goto('./', { waitUntil: 'commit' })
      await expect(page.getByText('Loading…', { exact: true })).toBeVisible()
      await expect.poll(() => page.evaluate(() => [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].every((l) => l.sheet !== null)), { timeout: 20_000 }).toBe(true)
      const before = await look(page)
      const focusable = await page.locator('button, a[href], input, select, textarea, [tabindex]').count()
      const beforeShot = canShotWhileHeld ? await shots.shot(`shell-${tag}-before-mount`, { fullPage: false }) : ''
      await release()
      await expect(button(page, 'Start')).toBeVisible({ timeout: 30_000 })
      const after = await look(page)
      const afterShot = await shots.shot(`shell-${tag}-after-mount`, { fullPage: false })
      const deltas: Record<string, number> = {}
      for (const part of Object.keys(PARTS) as Part[]) {
        const a = before.boxes[part], b = after.boxes[part]
        deltas[part] = a === null || b === null ? -1 : Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.width - b.width), Math.abs(a.height - b.height))
      }
      const colourChanges = Object.keys(before.colours).filter((k) => before.colours[k] !== after.colours[k])
      const maxMove = Math.max(...Object.values(deltas))
      if (maxMove > 1 || colourChanges.length > 0) moves.push(`${tag}: move ${maxMove}px, colours ${colourChanges.join(', ')}`)
      facts[tag] = { before, after, deltas, maxMove, colourChanges, focusableInShell: focusable, beforeShot, afterShot }
    }
  }
  // One h1, one main, one footer after the mount; the shell and its marks gone.
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('./')
  await expect(button(page, 'Start')).toBeVisible()
  const m = await pageMetrics(page, { touch, axe: true })
  facts['after mount'] = { h1Count: await page.locator('h1').count(), mainCount: await page.getByRole('main').count(), footerCount: await page.getByRole('contentinfo').count(), shellLeft: await page.locator('#hb-shell, .hb-shell-foot').count(), htmlClass: await page.evaluate(() => document.documentElement.className), headings: m.headings, landmarks: m.landmarks, axeSerious: m.axe?.serious.map((v) => `${v.id} x${v.nodes}`) }
  // Deep links: no welcome text before the app, then the page's own heading.
  for (const hash of ['#/privacy', '#/data']) {
    // From a blank page: a hash-only change on the mounted app is no navigation and fetches no shell.
    await page.goto('about:blank')
    const release = await holdScripts(page)
    await page.goto(`./${hash}`, { waitUntil: 'commit' })
    await expect(page.getByText('Loading…', { exact: true })).toBeVisible()
    const held = { loadingVisible: await page.getByText('Loading…', { exact: true }).isVisible(), shellHeadingHidden: await page.locator('#hb-shell-h').isHidden(), introVisible: await page.getByText(WELCOME_INTRO, { exact: true }).isVisible().catch(() => false), taglineVisible: await page.getByText(WELCOME_TAGLINE, { exact: true }).isVisible().catch(() => false), visibleText: (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim().slice(0, 200), shot: canShotWhileHeld ? await shots.shot(`deep-${hash.replace(/\W+/g, '-')}-held`, { fullPage: false }) : '' }
    await release()
    await expect(h1(page)).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(300)
    facts[`deep link ${hash}`] = { held, h1: (await h1(page).innerText()).trim(), h1IsWelcome: (await h1(page).innerText()).trim() === WELCOME_HEADING, h1Count: await page.locator('h1').count(), shellLeft: await page.locator('#hb-shell').count(), title: await page.title(), url: page.url().replace(/^.*humanbench/, ''), shot: await shots.shot(`deep-${hash.replace(/\W+/g, '-')}-mounted`, { fullPage: false }) }
  }
  facts.summary = { movesOrFlashes: moves, h1AfterMount: (facts['after mount'] as { h1Count: number }).h1Count, deepPrivacy: (facts['deep link #/privacy'] as { h1: string; held: { introVisible: boolean } }), deepData: (facts['deep link #/data'] as { h1: string; held: { introVisible: boolean } }) }
  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[verify2 UX-100 shell] ${JSON.stringify(facts.summary)}`)
})

// ------------------------------------------------------------------------------------------------ the results chunk blocked

test('verify2 UX-100 results chunk blocked: the save still downloads; Try again works', async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000)
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `UX-100/${testInfo.project.name}/blocked`)
  const log = trackConsole(page)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  const driver = new SessionDriver(page, { touch })
  let asked = 0
  await page.route(RESULTS_CHUNK, (route) => {
    asked++
    return route.abort('internetdisconnected')
  })
  await driver.toReady('./?fast=1')
  await driver.begin()
  await driver.answerOne()
  await driver.press(button(page, 'Finish early'))
  await driver.press(button(page, 'Finish now'))
  await expect(h1(page)).toHaveText(RESULTS_PENDING_HEADING)
  facts['pending'] = { h1: (await h1(page).innerText()).trim(), focus: await page.evaluate(() => document.activeElement?.tagName ?? ''), status: await page.locator('[role=status]').allInnerTexts().then((ts) => ts.filter((t) => t !== '')), shot: await shots.shot('pending', { fullPage: false }) }
  await expect(page.getByText(RESULTS_FAILED)).toBeVisible({ timeout: 40_000 })
  await page.waitForTimeout(300)
  const m = await pageMetrics(page, { touch, axe: true })
  facts['failed'] = { asked, guarded: await unloadIsGuarded(page), text: (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 500), buttons: await page.locator('main button').allInnerTexts(), axeSerious: m.axe?.serious.map((v) => `${v.id} x${v.nodes}`), overflowX: m.overflowX.px, jargon: /chunk|module|import|fetch|javascript|script/i.test(await page.locator('main').innerText()), shot: await shots.shot('failed', { fullPage: false }) }
  const [download] = await Promise.all([page.waitForEvent('download'), driver.press(button(page, RESULTS_DOWNLOAD))])
  const name = download.suggestedFilename()
  const file = await download.path()
  const doc = JSON.parse(readFileSync(file ?? '', 'utf8')) as { sessions?: { responses?: unknown[] }[]; schema_version?: string }
  await page.waitForTimeout(300)
  facts['download'] = { name, sessions: doc.sessions?.length ?? null, responses: doc.sessions?.map((s) => s.responses?.length ?? 0) ?? null, schema: doc.schema_version ?? null, guardedAfter: await unloadIsGuarded(page), text: (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 500), shot: await shots.shot('after-download', { fullPage: false }) }
  await page.unroute(RESULTS_CHUNK)
  await driver.press(button(page, RESULTS_RETRY))
  await expect(h1(page)).toHaveText(/^Session (complete|ended)$/, { timeout: 40_000 })
  await expect(page.locator('[data-section="save"]')).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(500)
  facts['after Try again'] = { h1: (await h1(page).innerText()).trim(), sheets: await page.evaluate(() => [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].filter((l) => /\/Finished-/.test(l.href)).map((l) => l.sheet !== null)), profile: await page.locator('svg.hb-blob').count(), savePanel: await page.locator('[data-section="save"]').count(), shot: await shots.shot('after-try-again', { fullPage: false }) }
  facts.summary = { asked, failedButtons: (facts['failed'] as { buttons: string[] }).buttons, download: name, responses: (facts['download'] as { responses: number[] | null }).responses, guardedBefore: (facts['failed'] as { guarded: boolean }).guarded, guardedAfter: (facts['download'] as { guardedAfter: boolean }).guardedAfter, afterRetry: (facts['after Try again'] as { h1: string; sheets: boolean[] }) }
  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[verify2 UX-100 blocked] ${JSON.stringify(facts.summary)}`)
})
