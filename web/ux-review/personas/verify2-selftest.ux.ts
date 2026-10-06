/// <reference lib="dom" />
/**
 * Verification package 2 (run id `verify2`): the RT self-test page after the dev merge (self-test v3 with the UX-054 and
 * UX-055 fixes). At 320, 390 and 1280 px: the results table (no digit stacking, no mid-word break, the event-lag rows and
 * their verdicts), Start's focus, and plain wording. A second run emulates press time stamps 205 ms behind the timer, so
 * the longer verdict ('Fail: offset time stamps') and the note above the table are on the page and measured too. The
 * timing values themselves are not judged. Evidence under web/test-results/ux-review/verify2/selftest/<project>/.
 *
 *   UX_PORT=4773 UX_RUN=verify2 npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/verify2-selftest.ux.ts --project=webkit
 */

import { expect, test, type Page } from '@playwright/test'
import { chordFor } from '../../e2e/keyboard'
import { pageMetrics, Shots, trackConsole } from '../lib'

const RUN = process.env.UX_RUN ?? 'verify2'

test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 })

const QUICK = './rt-selftest.html?quick=1'
const DEVELOPER_TERMS = /event\.timeStamp|performance\.now|dispatch|handler|rAF\b|requestAnimationFrame|Informational|null|undefined|NaN|quantile|boolean|\bAPI\b|callback/

const what = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return 'nothing (body)'
    const label = el.getAttribute('aria-label') || el.textContent || ''
    return `${el.tagName.toLowerCase()}.${[...el.classList].filter((c) => !c.startsWith('svelte-')).join('.')} "${label.replace(/\s+/g, ' ').trim().slice(0, 60)}"${el.getAttribute('aria-disabled') === 'true' ? ' (aria-disabled)' : ''}`
  })

/** The results table as laid out now: headers, number cells and the lines their text takes, words broken inside, verdict placement. */
const TABLE = `(() => {
  const t = document.querySelector('table')
  if (!t) return null
  const shown = (el) => getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0
  const linesOf = (el) => { const range = document.createRange(); range.selectNodeContents(el); return new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size }
  const nums = [...t.querySelectorAll('td.num, th.num')].filter(shown).map((c) => ({ text: (c.textContent || '').trim(), lines: linesOf(c), w: Math.round(c.getBoundingClientRect().width) }))
  const headers = [...t.querySelectorAll('thead th')].filter(shown).map((c) => (c.textContent || '').trim())
  const broken = []
  for (const cell of t.querySelectorAll('tbody th.name, tbody td.result, tbody td.num')) {
    if (!shown(cell)) continue
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const m of (node.textContent || '').matchAll(/\\S+/g)) {
        const range = document.createRange()
        range.setStart(node, m.index)
        range.setEnd(node, m.index + m[0].length)
        const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)))
        if (tops.size > 1) broken.push(m[0])
      }
    }
  }
  const rows = [...t.querySelectorAll('tbody tr')].map((tr) => { const th = tr.querySelector('th.name'); const v = th ? th.querySelector('.verdict') : null; const res = tr.querySelector('td.result'); return { name: th ? (th.childNodes[0] ? (th.childNodes[0].textContent || '').trim() : '') : '', verdictUnderName: v && shown(v) ? (v.textContent || '').trim() : null, resultColumn: res && shown(res) ? (res.textContent || '').trim() : null, nameWidth: th ? Math.round(th.getBoundingClientRect().width) : null, rowHeight: Math.round(tr.getBoundingClientRect().height) } })
  return { headers, numberCells: nums, multiLineNumbers: nums.filter((c) => c.lines > 1 && /\\d/.test(c.text)).map((c) => c.text), broken, rows, tableWidth: Math.round(t.getBoundingClientRect().width), innerWidth, overflow: document.documentElement.scrollWidth - innerWidth, caption: ((t.querySelector('caption') || {}).textContent || '').trim(), warn: [...document.querySelectorAll('section .warn, p.warn')].map((p) => (p.textContent || '').trim()), overall: ((document.querySelector('.overall') || {}).textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120) }
})()`

interface TableFacts {
  readonly headers: string[]
  readonly multiLineNumbers: string[]
  readonly broken: string[]
  readonly rows: { name: string; verdictUnderName: string | null; resultColumn: string | null }[]
  readonly overflow: number
  readonly warn: string[]
}

async function emulateOffset(page: Page): Promise<void> {
  await page.addInitScript(`(() => {
    const d = Object.getOwnPropertyDescriptor(Event.prototype, 'timeStamp')
    Object.defineProperty(Event.prototype, 'timeStamp', { configurable: true, get() { return d.get.call(this) - 205 } })
  })()`)
}

for (const mode of ['plain', 'offset'] as const) {
  test(`verify2 self-test after the merge (${mode} time stamps): table at 320/390/1280, Start focus, wording`, async ({ page, browserName }, testInfo) => {
    test.setTimeout(8 * 60_000)
    const touch = testInfo.project.use.hasTouch === true
    const shots = new Shots(page, RUN, `selftest/${testInfo.project.name}/${mode}`)
    const log = trackConsole(page)
    const facts: Record<string, unknown> = { project: testInfo.project.name, mode }
    if (mode === 'offset') await emulateOffset(page)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(QUICK)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('RT timing self-test')
    const introText = await page.locator('body').innerText()
    facts['intro wording'] = { developerTerms: introText.match(DEVELOPER_TERMS) ?? [], rtOutsideTitle: introText.replace('RT timing self-test', '').match(/\bRT\b/g) ?? [], longSentences: introText.split(/(?<=[.!?])\s+/).filter((s) => s.split(/\s+/).length > 25).slice(0, 3), spaceBar: introText.match(/[^.\n]*space bar[^.\n]*/i)?.[0] ?? null, offsetSentence: introText.match(/[^.\n]*offset[^.\n]*\./gi) }
    // Start's focus.
    if (!touch) {
      const chord = await chordFor(page, browserName)
      await page.keyboard.press(chord)
      facts['first Tab'] = await what(page)
      facts.chord = chord
    }
    const start = page.getByRole('button', { name: 'Start' })
    await start.focus()
    if (touch) await start.tap()
    else await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    facts['after Start'] = { focus: await what(page), focusIsStart: await start.evaluate((el) => el === document.activeElement).catch(() => false), ariaDisabled: await start.getAttribute('aria-disabled').catch(() => null), status: await page.locator('#selftest-status').innerText(), shot: await shots.shot('after-start', { fullPage: false }) }
    await expect(page.getByRole('heading', { name: 'Key presses' })).toBeVisible({ timeout: 45_000 })
    await page.waitForTimeout(200)
    facts['key phase'] = { focus: await what(page), zoneText: await page.locator('p.zone').innerText().catch(() => null) }
    if (mode === 'offset' || !touch) {
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Space')
        await page.waitForTimeout(120)
      }
      await expect(page.getByRole('heading', { name: 'Pointer presses' })).toBeVisible({ timeout: 10_000 })
      facts['pointer phase'] = { focus: await what(page) }
      const target = page.getByRole('button', { name: 'Tap target' })
      for (let i = 0; i < 3; i++) {
        if (touch) await target.tap()
        else await target.click()
        await page.waitForTimeout(120)
      }
    } else {
      await (touch ? page.getByRole('button', { name: 'Skip: no keyboard' }).tap() : page.getByRole('button', { name: 'Skip: no keyboard' }).click())
      await (touch ? page.getByRole('button', { name: 'Skip: no mouse or touch' }).tap() : page.getByRole('button', { name: 'Skip: no mouse or touch' }).click())
    }
    await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(300)
    facts['results focus'] = await what(page)
    const resultsText = await page.locator('main').innerText()
    facts['results wording'] = { developerTerms: resultsText.match(DEVELOPER_TERMS) ?? [], rtOutsideTitle: resultsText.replace('RT timing self-test', '').match(/\bRT\b/g) ?? [], overall: resultsText.match(/Overall:[^\n]*/)?.[0] ?? null, notes: (await page.getByLabel('JSON report').inputValue().catch(() => '')).match(/"note": ?"[^"]*"/g)?.slice(0, 4) ?? null }
    const report = JSON.parse(await page.getByLabel('JSON report').inputValue().catch(() => '{}')) as { report_version?: string; event_lag?: unknown; pass?: boolean }
    facts['report'] = { version: report.report_version ?? null, eventLag: report.event_lag ?? null, pass: report.pass ?? null }
    const problems: string[] = []
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 844 })
      await page.waitForTimeout(300)
      const t = (await page.evaluate(TABLE)) as TableFacts | null
      const m = await pageMetrics(page, { touch })
      facts[`table ${width}`] = { ...t, clipped: m.clipped, overflowX: m.overflowX.px, shot: await shots.shot(`results-${width}`, { fullPage: true }), tableShot: await shots.shot(`table-${width}`, { locator: page.locator('table') }) }
      if (t === null) problems.push(`${width}: no table`)
      else {
        if (t.multiLineNumbers.length > 0) problems.push(`${width}: numbers on two lines ${t.multiLineNumbers.join(', ')}`)
        if (t.broken.length > 0) problems.push(`${width}: broken ${t.broken.join(', ')}`)
        if (t.overflow > 0) problems.push(`${width}: overflow ${t.overflow}px`)
        if (m.clipped.length > 0) problems.push(`${width}: clipped ${m.clipped.join(' | ')}`)
      }
    }
    await page.setViewportSize({ width: 1280, height: 800 })
    const mm = await pageMetrics(page, { touch, axe: true })
    facts['axe 1280'] = mm.axe?.serious.map((v) => `${v.id} x${v.nodes}`)
    const t1280 = facts['table 1280'] as TableFacts
    const t320 = facts['table 320'] as TableFacts
    facts.summary = { problems, verdicts1280: t1280.rows.map((r) => `${r.name.slice(0, 24)}: ${r.resultColumn}`), verdicts320: t320.rows.map((r) => `${r.name.slice(0, 24)}: ${r.verdictUnderName}`), warn: t1280.warn, afterStart: (facts['after Start'] as { focus: string }).focus, keyPhaseFocus: (facts['key phase'] as { focus: string }).focus, developerTerms: [...((facts['intro wording'] as { developerTerms: string[] }).developerTerms), ...((facts['results wording'] as { developerTerms: string[] }).developerTerms)], reportVersion: (facts['report'] as { version: string | null }).version }
    shots.json('facts', facts)
    shots.json('console', log)
    console.log(`[verify2 selftest ${mode}] ${JSON.stringify(facts.summary)}`)
  })
}
