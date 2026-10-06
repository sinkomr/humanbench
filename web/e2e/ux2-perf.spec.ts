/// <reference lib="dom" />
/**
 * UX-100 in the browser (DESIGN §8 save, §10 flow and reveal, §13 accessibility): the static welcome shell of
 * index.html and the results code as a chunk of its own.
 *
 * - **The shell**: with every script blocked the page shows the welcome heading, tagline, intro and footer
 *   disclaimer, nothing to press, and no serious axe finding, in light and dark. When the app mounts nothing
 *   moves (390 and 1280 px, light and dark; screenshots before and after are attached), there is one h1 and one
 *   main, and a deep link (#/privacy, a dev route) never shows the welcome text.
 * - **Speed** (Chromium: throttling needs CDP): Fast 3G (562.5 ms, 1.44 Mbps down, as `skimmer: speed` of the
 *   UX review) and a 4x slower CPU. The numbers are attached as perf.json; the test asserts loose ceilings: the
 *   heading paints from the HTML before the app mounts, and the entry chunk stays under its gzip bound.
 * - **The results chunk never loses a session's results**: blocked (`page.route` abort), a `?fast=1` session ends
 *   on "Try again" and "Download my save file" with the tab guarded; the file downloads and loads; unblocked,
 *   "Try again" brings the results with their stylesheet. Offline from the ready screen on, nothing is asked for
 *   (a failed module fetch would stay failed), and back online "Try again" brings the results.
 */

import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { expect, test, type BrowserContext, type Page, type Route, type TestInfo } from '@playwright/test'
import { DISCLAIMER } from '../src/copy'
import { parseSaveText } from '../src/save/parse'
import { WELCOME_HEADING, WELCOME_INTRO, WELCOME_TAGLINE } from '../src/session/copy'
import { RESULTS_DOWNLOAD, RESULTS_FAILED, RESULTS_PENDING_HEADING, RESULTS_RETRY, resultsDownloaded } from '../src/session/results-loader'
import { expectNoSeriousAxe } from './axe'
import { agreeGate, button, FINISHED_HEADINGS, h1, unloadIsGuarded } from './flow'
import { SessionDriver } from './session-driver'

/** Every script of the build. */
const SCRIPTS = /\/assets\/[^/?]+\.js(\?.*)?$/
/** The results chunk and its stylesheet, with or without the loader's cache-busting query. */
const RESULTS_CHUNK = /\/assets\/Finished-[^/?]+\.(js|css)(\?.*)?$/
/** The entry chunk's gzip bound (the same as scripts/results-split.test.ts, which says why). */
const ENTRY_GZIP_MAX = 135_000
const FILE_NAME = /^humanbench-[0-9A-Za-z]{6}-\d{4}-\d{2}-\d{2}\.hbsave\.json$/

// -------------------------------------------------------------------------- the shell

/** Where the four texts are, in the shell and in the mounted welcome screen alike. */
const PARTS = { heading: 'main h1', tagline: 'main p.lead', intro: 'main p.lead + p', disclaimer: 'footer p' } as const
type Part = keyof typeof PARTS

interface Look {
  readonly boxes: Record<Part, { x: number; y: number; width: number; height: number } | null>
  readonly colours: Record<string, string>
}

async function look(page: Page): Promise<Look> {
  return page.evaluate((parts) => {
    const boxes: Record<string, { x: number; y: number; width: number; height: number } | null> = {}
    for (const [name, sel] of Object.entries(parts)) {
      const el = document.querySelector(sel)
      const r = el?.getBoundingClientRect()
      boxes[name] = r === undefined ? null : { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
    }
    const cs = (sel: string, prop: string): string => {
      const el = document.querySelector(sel)
      return el === null ? '' : getComputedStyle(el).getPropertyValue(prop)
    }
    return {
      boxes: boxes as Look['boxes'],
      colours: {
        'body background': cs('body', 'background-color'),
        'main background': cs('main', 'background-color'),
        'h1 colour': cs('main h1', 'color'),
        'intro colour': cs('main p.lead + p', 'color'),
        'footer colour': cs('footer p', 'color'),
        'footer border': cs('footer', 'border-top-color'),
        'h1 font': cs('main h1', 'font-family') + ' ' + cs('main h1', 'font-size') + ' ' + cs('main h1', 'font-weight'),
      },
    }
  }, PARTS)
}

async function blockScripts(page: Page): Promise<void> {
  await page.route(SCRIPTS, (route) => route.abort())
}

/**
 * Hold every script until `release` is called: the page as it is while its scripts are on their way. (Not an
 * abort and a reload: WebKit under Playwright keeps the aborted script failed across the reload.)
 */
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

test.describe('the static welcome shell (UX-100)', () => {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`paints the welcome from the HTML alone, with nothing to press and nothing serious for axe (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
      await blockScripts(page)
      await page.goto('./')
      const main = page.getByRole('main')
      await expect(h1(page)).toHaveText(WELCOME_HEADING)
      await expect(h1(page)).toBeVisible()
      await expect(main.getByText(WELCOME_TAGLINE, { exact: true })).toBeVisible()
      await expect(main.getByText(WELCOME_INTRO, { exact: true })).toBeVisible()
      await expect(main.getByText('Loading…', { exact: true })).toBeVisible()
      await expect(page.getByRole('contentinfo')).toHaveText(DISCLAIMER)
      await expect(page.locator('button, a[href], input, select, textarea, [tabindex]')).toHaveCount(0)
      await expect(page.getByRole('main')).toHaveCount(1)
      await expectNoSeriousAxe(page)
    })
  }

  test('nothing moves or changes colour when the app mounts (390 and 1280 px, light and dark)', async ({ page, browserName }, testInfo) => {
    test.setTimeout(120_000)
    // Screenshots in Chromium only: WebKit under Playwright does not take one while a script request is held.
    const shot = async (p: Page, t: TestInfo, name: string): Promise<void> => {
      if (browserName === 'chromium') await screenshot(p, t, name)
    }
    for (const width of [390, 1280]) {
      for (const colorScheme of ['light', 'dark'] as const) {
        const tag = `${width}-${colorScheme}`
        await page.setViewportSize({ width, height: width === 390 ? 844 : 800 })
        await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
        const release = await holdScripts(page)
        await page.goto('./', { waitUntil: 'commit' })
        await expect(page.getByText('Loading…', { exact: true })).toBeVisible()
        // The stylesheets have arrived (they come before the app's script runs): the shell as it is just before the mount.
        await expect.poll(() => page.evaluate(() => [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].every((l) => l.sheet !== null))).toBe(true)
        const before = await look(page)
        await shot(page, testInfo, `shell-${tag}-before-mount`)
        await release()
        await expect(button(page, 'Start')).toBeVisible()
        const after = await look(page)
        await shot(page, testInfo, `shell-${tag}-after-mount`)
        for (const part of Object.keys(PARTS) as Part[]) {
          const a = before.boxes[part]
          const b = after.boxes[part]
          expect(a, `${tag} ${part} in the shell`).not.toBeNull()
          expect(b, `${tag} ${part} in the app`).not.toBeNull()
          for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(a![k] - b![k]), `${tag} ${part} ${k}: shell ${JSON.stringify(a)}, app ${JSON.stringify(b)}`).toBeLessThanOrEqual(1)
        }
        expect(after.colours, tag).toEqual(before.colours)
      }
    }
  })

  test('after the mount: one h1, one main, one footer; the shell and its marks are gone', async ({ page }) => {
    await page.goto('./')
    await expect(button(page, 'Start')).toBeVisible()
    await expect(page.locator('h1')).toHaveCount(1)
    await expect(page.getByRole('main')).toHaveCount(1)
    await expect(page.getByRole('contentinfo')).toHaveCount(1)
    await expect(page.locator('#hb-shell, .hb-shell-foot')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.className)).toBe('')
  })

  test('a deep link shows no welcome text before the app, then its own page', async ({ page }) => {
    const release = await holdScripts(page)
    await page.goto('./#/privacy', { waitUntil: 'commit' })
    await expect(page.getByText('Loading…', { exact: true })).toBeVisible()
    await expect(page.locator('#hb-shell-h')).toBeHidden()
    await expect(page.getByText(WELCOME_INTRO, { exact: true })).toBeHidden()
    await release()
    await expect(h1(page)).toBeVisible()
    await expect(h1(page)).not.toHaveText(WELCOME_HEADING)
    await expect(page.locator('#hb-shell')).toHaveCount(0)
  })

  test('a dev route (#/dev/blob) still mounts, in place of the shell', async ({ page }) => {
    await page.goto('./#/dev/blob')
    await expect(h1(page)).toHaveText('Blob demo (development only)')
    await expect(page.locator('h1')).toHaveCount(1)
    await expect(page.locator('#hb-shell')).toHaveCount(0)
  })
})

async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: false })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

// -------------------------------------------------------------------------- speed

test('speed on Fast 3G with a 4x slower CPU: the heading paints from the HTML before the app; the entry chunk is under its bound', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'network and CPU throttling need a CDP session')
  test.setTimeout(150_000)
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  try {
    const page = await ctx.newPage()
    // When the app replaces the shell, by the page's own clock (the same as the paint entries').
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
      if (/\/assets\/index-[^/]+\.js$/.test(r.url())) void r.body().then((b) => entry.push(b))
    })
    const t0 = Date.now()
    await page.goto('./', { waitUntil: 'commit' })
    await expect(h1(page)).toHaveText(WELCOME_HEADING, { timeout: 60_000 })
    const msToHeading = Date.now() - t0
    const startAtHeading = await button(page, 'Start').count()
    await expect(button(page, 'Start')).toBeVisible({ timeout: 90_000 })
    const msToStart = Date.now() - t0
    await page.waitForLoadState('load')
    await expect.poll(() => entry.length, { timeout: 30_000 }).toBeGreaterThan(0)
    const inPage = await page.evaluate(() => {
      const paint = (name: string): number | null => {
        const e = performance.getEntriesByName(name)[0]
        return e === undefined ? null : Math.round(e.startTime)
      }
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
      const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
      return {
        firstContentfulPaintMs: paint('first-contentful-paint'),
        firstPaintMs: paint('first-paint'),
        mountMs: Math.round((window as unknown as { __hbMount?: number }).__hbMount ?? -1),
        htmlResponseEndMs: nav === undefined ? null : Math.round(nav.responseEnd),
        resources: res.map((r) => ({ name: r.name.replace(/^.*\/assets\//, 'assets/'), bytes: r.encodedBodySize, ms: Math.round(r.duration) })),
      }
    })
    const body = entry[0] as Buffer
    const numbers = {
      throttling: { latencyMs: 562.5, downMbps: 1.44, upMbps: 0.675, cpuSlowdown: 4 },
      msToHeadingByPlaywright: msToHeading,
      msToStartButton: msToStart,
      startButtonThereWhenHeadingShowed: startAtHeading > 0,
      ...inPage,
      entryRawBytes: body.length,
      entryGzipBytes: gzipSync(body).length,
    }
    await testInfo.attach('perf.json', { body: JSON.stringify(numbers, null, 2), contentType: 'application/json' })
    console.log(`ux2-perf speed: ${JSON.stringify({ ...numbers, resources: undefined })}`)

    // The heading came from the HTML: it painted before the app mounted.
    expect(numbers.firstContentfulPaintMs).not.toBeNull()
    expect(numbers.mountMs).toBeGreaterThan(0)
    expect(numbers.firstContentfulPaintMs!).toBeLessThan(numbers.mountMs)
    // Loose ceilings: on this line the HTML alone takes about two round trips; the app needs every script first.
    expect(numbers.firstContentfulPaintMs!).toBeLessThan(2500)
    expect(numbers.entryGzipBytes).toBeLessThan(ENTRY_GZIP_MAX)
  } finally {
    await ctx.close()
  }
})

// -------------------------------------------------------------------------- the results chunk

/** On the ready screen of a `?fast=1` page; `beforeReady` runs on the device check, before its Continue. */
async function toReady(page: Page, driver: SessionDriver, beforeReady: () => Promise<void>): Promise<void> {
  await page.goto('./?fast=1')
  await expect(h1(page)).toHaveText(WELCOME_HEADING)
  await driver.press(button(page, 'Start'))
  await agreeGate(page)
  await driver.tick(page.getByRole('checkbox', { name: /honour code/ }))
  await driver.press(button(page, 'Continue'))
  await expect(button(page, 'Continue')).toBeEnabled({ timeout: 20_000 })
  await driver.tick(page.getByRole('radio', { name: driver.opts.touch ? 'Tap or click' : 'Keyboard' }))
  await beforeReady()
  await driver.press(button(page, 'Continue'))
  await expect(h1(page)).toHaveText('Ready when you are')
}

/** The stylesheets of the results chunk on the page, and whether each has loaded. */
async function resultsSheets(page: Page): Promise<boolean[]> {
  return page.evaluate(() => [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].filter((l) => /\/Finished-/.test(l.href)).map((l) => l.sheet !== null))
}

test.describe('the results chunk never loses a session’s results (UX-100)', () => {
  test('blocked: retried, then "Try again" and the save file; the file loads; unblocked, "Try again" shows the results', async ({ page, isMobile }) => {
    test.setTimeout(180_000)
    const driver = new SessionDriver(page, { touch: isMobile === true })
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
    await expect(page.getByText(RESULTS_FAILED)).toBeVisible({ timeout: 30_000 })
    expect(asked, 'the chunk was asked for more than once (retries)').toBeGreaterThan(2)
    expect(await unloadIsGuarded(page)).toBe(true)
    await expectNoSeriousAxe(page)

    // The person keeps their file: the save of this session, valid, with its answer.
    const [download] = await Promise.all([page.waitForEvent('download'), driver.press(button(page, RESULTS_DOWNLOAD))])
    const name = download.suggestedFilename()
    expect(name).toMatch(FILE_NAME)
    const parsed = await parseSaveText(readFileSync(await download.path(), 'utf8'))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.save.sessions).toHaveLength(1)
      expect(parsed.save.sessions[0]!.responses.length).toBeGreaterThan(0)
    }
    await expect(page.getByText(resultsDownloaded(name))).toBeVisible()
    expect(await unloadIsGuarded(page)).toBe(false)

    // The connection is back: "Try again" brings the results, styled.
    await page.unroute(RESULTS_CHUNK)
    await driver.press(button(page, RESULTS_RETRY))
    await expect(h1(page)).toHaveText(FINISHED_HEADINGS, { timeout: 30_000 })
    await expect(page.locator('[data-section="save"]')).toBeVisible()
    await expect.poll(() => resultsSheets(page)).toEqual([true])
  })

  test('offline from the ready screen on: nothing is asked for, and back online "Try again" shows the results', async ({ page, context, isMobile }) => {
    test.setTimeout(120_000)
    const driver = new SessionDriver(page, { touch: isMobile === true })
    const asked: string[] = []
    page.on('request', (r) => {
      if (RESULTS_CHUNK.test(r.url())) asked.push(r.url())
    })
    await toReady(page, driver, () => goOffline(context, true))
    await driver.begin()
    await driver.press(button(page, 'Finish early'))
    await driver.press(button(page, 'Finish now'))
    await expect(page.getByText(RESULTS_FAILED)).toBeVisible({ timeout: 30_000 })
    expect(asked, 'no request for the results chunk while offline').toEqual([])
    await goOffline(context, false)
    await driver.press(button(page, RESULTS_RETRY))
    await expect(h1(page)).toHaveText(FINISHED_HEADINGS, { timeout: 30_000 })
    await expect.poll(() => resultsSheets(page)).toEqual([true])
  })
})

async function goOffline(context: BrowserContext, offline: boolean): Promise<void> {
  await context.setOffline(offline)
}
