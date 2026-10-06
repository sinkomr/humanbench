/// <reference lib="dom" />
/**
 * Verification package (run id `verify`), notes and self-test areas: the original scenarios of UX-049 to UX-055 on the
 * FIXED build. Evidence under web/test-results/ux-review/verify/<item id>/<project>/.
 *
 *   UX_REUSE=1 UX_PORT=4653 UX_RUN=verify npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/verify-notes.ux.ts --project=chromium
 */

import { expect, test, type Page } from '@playwright/test'
import { COPY as NOTES_COPY } from '../../src/brief/copy'
import { chordFor } from '../../e2e/keyboard'
import { openRoute, PREVIEW_ROUTES, type Route } from '../../e2e/routes'
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
    return `${el.tagName.toLowerCase()}${el.getAttribute('type') ? `[${el.getAttribute('type')}]` : ''}${el.getAttribute('tabindex') ? `[tabindex=${el.getAttribute('tabindex')}]` : ''} "${label.replace(/\s+/g, ' ').trim().slice(0, 60)}"${(el as HTMLButtonElement).disabled ? ' (disabled)' : ''}${el.getAttribute('aria-disabled') === 'true' ? ' (aria-disabled)' : ''}`
  })

const bodyText = (page: Page): Promise<string> => page.locator('body').innerText()

// ------------------------------------------------------------------------------------------------ UX-049 / UX-050 / UX-051 / UX-052 / UX-053

test('verify UX-049 to UX-053 notes page: links, skip link, keep focus, names, copy', async ({ page, browserName }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `UX-049-053/${testInfo.project.name}`)
  const log = trackConsole(page)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  await open(page, 'notes')
  // UX-049: links home and to the privacy notice; the skip link and the Tab count to Copy.
  facts['UX-049 links'] = await page.evaluate(() => [...document.querySelectorAll('a')].map((a) => ({ text: (a.textContent ?? '').trim().slice(0, 50), href: a.getAttribute('href'), target: a.getAttribute('target'), cls: a.className })).filter((a) => /HumanBench|Privacy|Skip/.test(a.text)))
  facts['UX-049 page height'] = await page.evaluate(() => document.documentElement.scrollHeight)
  facts['UX-049 top note'] = await page.getByTestId('not-saved').innerText().catch(() => null)
  await shots.shot('notes-top', { fullPage: false })
  if (!touch) {
    const chord = await chordFor(page, browserName)
    await page.keyboard.press(chord)
    facts['UX-049 first Tab'] = await what(page)
    await shots.shot('notes-first-tab', { fullPage: false })
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
    facts['UX-049 after Enter on the skip link'] = { focus: await what(page), scrollY: await page.evaluate(() => Math.round(scrollY)), copyInView: await page.getByRole('button', { name: 'Copy the notes' }).evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight }) }
    await shots.shot('notes-after-skip-link', { fullPage: false })
    let n = -1
    for (let i = 1; i <= 8; i++) {
      await page.keyboard.press(chord)
      if (await page.getByRole('button', { name: 'Copy the notes' }).evaluate((el) => el === document.activeElement)) {
        n = i
        break
      }
    }
    facts['UX-049 Tabs from the skip target to Copy the notes'] = n
    // From the top of the page without the skip link: how many stops to Copy?
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.evaluate(() => scrollTo(0, 0))
    let m = -1
    await page.keyboard.press(chord)
    for (let i = 2; i <= 120; i++) {
      await page.keyboard.press(chord)
      if (await page.getByRole('button', { name: 'Copy the notes' }).evaluate((el) => el === document.activeElement)) {
        m = i
        break
      }
    }
    facts['UX-049 Tabs from the page top to Copy the notes (skip link not used)'] = m
  }
  // UX-051: radio names and descriptions.
  facts['UX-051 where radios'] = await page.evaluate(() => [...document.querySelectorAll('input[type=radio]')].slice(0, 6).map((r) => { const by = r.getAttribute('aria-labelledby'); const desc = r.getAttribute('aria-describedby'); return { name: by ? (document.getElementById(by)?.textContent ?? '').trim() : ((r as HTMLInputElement).labels?.[0]?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80), description: desc ? (document.getElementById(desc)?.textContent ?? '').trim().slice(0, 80) : null } }))
  // UX-052: topic labels, hint wording, checker line refs.
  const text = await bodyText(page)
  facts['UX-052 copy'] = { maths: /Maths and numbers/.test(text), math: /\bMath and numbers/.test(text), pitch: /\bpitch\b/i.test(text), adjust: /how to adjust its explanations/.test(text), skillForm: text.match(/\((Skill|skill) form\)/g), shortForm: text.match(/\(short form\)/g) }
  await open(page, 'notes-checker')
  facts['UX-052 checker line refs'] = (await bodyText(page)).match(/\(lines? [^)]*\)/g)
  await shots.shot('checker', { locator: page.getByTestId('check-summary') })
  // UX-050: keep my settings: focus and the 18+ error.
  await open(page, 'notes-keep-error')
  facts['UX-050 keep error'] = { focus: await what(page), adult: await page.getByTestId('adult').evaluate((el) => ({ invalid: el.getAttribute('aria-invalid'), describedby: el.getAttribute('aria-describedby') })), error: await page.getByTestId('adult-error').innerText() }
  await shots.shot('keep-error', { fullPage: false })
  await page.getByTestId('adult').check()
  if (!touch) {
    await page.getByTestId('keep-button').focus()
    await page.keyboard.press('Enter')
  } else await page.getByTestId('keep-button').tap()
  await expect(page.getByTestId('keep-status')).toHaveText(NOTES_COPY.keepNow)
  await page.waitForTimeout(300)
  facts['UX-050 after keep'] = { focus: await what(page), keepState: await page.getByTestId('keep-state').innerText().catch(() => null), topNote: await page.getByTestId('not-saved').innerText().catch(() => null), keepStatusVisible: await page.getByTestId('keep-status').evaluate((el) => !el.classList.contains('visually-hidden')), keepStatusText: await page.getByTestId('keep-status').innerText() }
  await shots.shot('after-keep', { fullPage: false })
  // UX-052: the returning page.
  await open(page, 'notes-returning')
  facts['UX-052 returning'] = { message: await page.getByTestId('returning-message').first().innerText(), topNote: await page.getByTestId('not-saved').innerText().catch(() => null), dueForAnotherLook: /due for another look/.test(await bodyText(page)) }
  await shots.shot('returning', { locator: page.getByTestId('returning') })
  // UX-053: the two after-save cards on the results page, and the notes styles in print.
  await open(page, 'results-saved')
  facts['UX-053 cards'] = await page.evaluate(() => {
    const pick = (el: Element | null): unknown => { if (!el) return null; const cs = getComputedStyle(el); const h = el.querySelector('h3'); const hcs = h ? getComputedStyle(h) : null; return { bg: cs.backgroundColor, border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`, padding: cs.padding, margin: cs.margin, headingColor: hcs?.color ?? null, headingMarginTop: hcs?.marginTop ?? null, headingSize: hcs?.fontSize ?? null, x: Math.round(el.getBoundingClientRect().left), w: Math.round(el.getBoundingClientRect().width) } }
    const share = document.querySelector('[data-slot="share-card"]')
    const ai = document.querySelector('[data-testid="reveal-card"]')
    const warn = document.querySelector('[data-testid="never-paste"]')
    return { share: pick(share), ai: pick(ai), warnWidth: warn ? Math.round(warn.getBoundingClientRect().width) : null, aiWidth: ai ? Math.round(ai.getBoundingClientRect().width) : null }
  })
  await shots.shot('after-save-cards', { locator: page.locator('[data-section="after-save"]') })
  if (!touch) {
    await page.emulateMedia({ media: 'print', colorScheme: 'dark' })
    await page.waitForTimeout(300)
    facts['UX-053 print dark'] = await page.evaluate(() => { const pick = (el: Element | null): unknown => (el ? { color: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor } : null); return { ai: pick(document.querySelector('[data-testid="reveal-card"]')), talk: pick(document.querySelector('[data-testid="results-talk"]')), warn: pick(document.querySelector('[data-testid="never-paste"]')) } })
    await shots.shot('after-save-cards-print-dark', { locator: page.locator('[data-section="after-save"]') })
    await page.emulateMedia({ media: 'screen', colorScheme: 'light' })
    await open(page, 'notes-filled')
    await page.emulateMedia({ media: 'print', colorScheme: 'dark' })
    await page.waitForTimeout(300)
    facts['UX-053 notes print dark'] = await page.evaluate(() => ({ body: { color: getComputedStyle(document.body).color, bg: getComputedStyle(document.body).backgroundColor }, main: (() => { const m = document.querySelector('main'); return m ? { color: getComputedStyle(m).color, bg: getComputedStyle(m).backgroundColor } : null })() }))
    await shots.shot('notes-print-dark', { fullPage: false })
  }
  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[verify UX-049..053] ${JSON.stringify(facts).slice(0, 3500)}`)
})

// ------------------------------------------------------------------------------------------------ UX-054 / UX-055

test('verify UX-054 UX-055 RT self-test: table on phones, Start focus, copy, link home', async ({ page, browserName }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `UX-054-055/${testInfo.project.name}`)
  const log = trackConsole(page)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  await page.goto('./rt-selftest.html?quick=1')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('RT timing self-test')
  const text = await bodyText(page)
  facts['UX-055 copy'] = { homeLink: await page.locator('a.home').evaluate((a) => ({ text: (a.textContent ?? '').trim(), href: a.getAttribute('href'), h: Math.round(a.getBoundingClientRect().height) })).catch(() => null), rtAbbrev: text.match(/[^.\n]*\bRT\b[^.\n]*/g), timestamp: /timeStamp|performance\.now|event\./.test(text), spaceBar: text.match(/[^.\n]*space bar[^.\n]*/gi), longSentences: text.split(/(?<=[.!?])\s+/).filter((s) => s.split(/\s+/).length > 25).slice(0, 3) }
  if (!touch) {
    const chord = await chordFor(page, browserName)
    await page.keyboard.press(chord)
    facts['UX-055 first Tab'] = await what(page)
  }
  const start = page.getByRole('button', { name: 'Start' })
  await start.focus()
  if (touch) await start.tap()
  else await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  facts['UX-055 after Start'] = { focus: await what(page), startAria: await page.getByRole('button', { name: 'Start' }).getAttribute('aria-disabled').catch(() => null), status: await page.locator('#selftest-status').innerText() }
  await shots.shot('after-start', { fullPage: false })
  await expect(page.getByRole('heading', { name: 'Key presses' })).toBeVisible({ timeout: 45_000 })
  facts['UX-055 key phase focus'] = await what(page)
  await (touch ? page.getByRole('button', { name: 'Skip: no keyboard' }).tap() : page.getByRole('button', { name: 'Skip: no keyboard' }).click())
  await (touch ? page.getByRole('button', { name: 'Skip: no mouse or touch' }).tap() : page.getByRole('button', { name: 'Skip: no mouse or touch' }).click())
  await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible()
  await page.waitForTimeout(300)
  // UX-054: the table at this width and at 320.
  const TABLE = `(() => { const t = document.querySelector('table'); if (!t) return null; const cells = [...t.querySelectorAll('td.num, th.num')].filter((c) => c.getBoundingClientRect().height > 0).map((c) => { const cs = getComputedStyle(c); return { text: (c.textContent || '').trim(), lines: Math.round(c.getBoundingClientRect().height / parseFloat(cs.lineHeight)), w: Math.round(c.getBoundingClientRect().width) } }); const headers = [...t.querySelectorAll('th')].filter((c) => c.getBoundingClientRect().height > 0).map((c) => (c.textContent || '').trim().slice(0, 40)); const broken = []; const range = document.createRange(); const walker = document.createTreeWalker(t, NodeFilter.SHOW_TEXT); for (let n = walker.nextNode(); n; n = walker.nextNode()) { for (const m of n.data.matchAll(/[A-Za-z0-9.]{3,}/g)) { range.setStart(n, m.index); range.setEnd(n, m.index + m[0].length); const rs = range.getClientRects(); if (rs.length > 1 && new Set([...rs].map((r) => Math.round(r.top))).size > 1) broken.push(m[0]) } } return { headers, cells: cells.slice(0, 12), multiLineNumbers: cells.filter((c) => c.lines > 1 && /\\d/.test(c.text)).map((c) => c.text), broken, tableWidth: Math.round(t.getBoundingClientRect().width), innerWidth, overflow: document.documentElement.scrollWidth - innerWidth, caption: (t.querySelector('caption') || {}).textContent || '' } })()`
  facts[`UX-054 table ${page.viewportSize()?.width}`] = await page.evaluate(TABLE)
  await shots.shot('results-table', { locator: page.locator('table') })
  if (!touch) {
    for (const w of [390, 320]) {
      await page.setViewportSize({ width: w, height: 844 })
      await page.waitForTimeout(300)
      facts[`UX-054 table ${w}`] = await page.evaluate(TABLE)
      await shots.shot(`results-table-${w}`, { locator: page.locator('table') })
    }
    await page.setViewportSize({ width: 1280, height: 800 })
  }
  const m = await pageMetrics(page, { touch, axe: true })
  facts['metrics'] = { overflowX: m.overflowX.px, clipped: m.clipped, axeSerious: m.axe?.serious.map((v) => `${v.id} x${v.nodes}`) }
  // Copy the report.
  const copy = page.getByRole('button', { name: /Copy/ }).first()
  await (touch ? copy.tap() : copy.click())
  await page.waitForTimeout(500)
  facts['UX-055 copy status'] = await page.locator('[role=status]').allInnerTexts().then((ts) => ts.filter((t) => t !== ''))
  facts['UX-055 report notes'] = (await page.locator('pre, textarea, code').first().innerText().catch(() => '')).match(/"note": ?"[^"]*"/g)?.slice(0, 3) ?? null
  facts['UX-055 Run again'] = await page.getByRole('button', { name: 'Run again' }).evaluate((b) => ({ disabled: (b as HTMLButtonElement).disabled, aria: b.getAttribute('aria-disabled') })).catch(() => null)
  await shots.all('results')
  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[verify UX-054/055] ${JSON.stringify(facts).slice(0, 3000)}`)
})
