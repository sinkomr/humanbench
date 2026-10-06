/// <reference lib="dom" />
/**
 * Verification package 2 (run id `verify2`), regression sweep of the merged build: every product route photographed and
 * measured with axe (chromium at 390 and 1280 px in light and dark, iphone at its width, webkit at 1280 light), plus one
 * whole `?fast=1` session per project that ends in the results, downloads the save, reloads, loads the file on the ready
 * screen, opens "See my results" and compares the profile with the one the session showed. The tour summaries are
 * compared with the wave-1 verify tours by `verify2-compare.ts` afterwards.
 *
 *   UX_PORT=4774 UX_RUN=verify2 npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/verify2-tour.ux.ts --project=chromium --grep 'tour'
 *
 * Output: web/test-results/ux-review/verify2/tour-<project>/<route>/<width>-<scheme>.png (+ summary.json) and
 * web/test-results/ux-review/verify2/journey-<project>/.
 */

import { readFileSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { button, h1 } from '../../e2e/flow'
import { pageMetrics, playJourney, PRODUCT_ROUTES, Shots, tour, trackConsole, type Scheme } from '../lib'

const RUN = process.env.UX_RUN ?? 'verify2'

const GROUPS = [...new Set(PRODUCT_ROUTES.map((r) => r.group))]

for (const group of GROUPS) {
  test(`verify2 tour: ${group}`, async ({ context }, testInfo) => {
    const project = testInfo.project.name
    const touch = testInfo.project.use.hasTouch === true
    const routes = PRODUCT_ROUTES.filter((r) => r.group === group).map((r) => r.id)
    const widths = touch ? undefined : project === 'webkit' ? [1280] : [390, 1280]
    const schemes: Scheme[] = project === 'webkit' ? ['light'] : ['light', 'dark']
    const entries = await tour(context, { runId: RUN, sub: `tour-${project}`, routes, widths, schemes, touch, axe: true })
    const failed = entries.filter((e) => !e.ok).map((e) => `${e.route}: ${(e.error ?? '').split('\n')[0]}`)
    console.log(`[verify2] tour ${group} ${project}: ${entries.length - failed.length}/${entries.length} ok${failed.length === 0 ? '' : `; failed: ${failed.join(' | ')}`}`)
    expect(entries.length).toBe(routes.length)
  })
}

const press = async (touch: boolean, target: Locator): Promise<void> => {
  if (touch) await target.tap()
  else await target.click()
}

/** The profile as the page states it: the names, estimates and relations of the bar-view table, and the blob's marks. */
async function profileOf(page: Page): Promise<{ rows: string[]; marks: string[] }> {
  const rows = await page.evaluate(() => [...document.querySelectorAll('table.hb-bars tbody tr')].map((tr) => `${(tr.querySelector('th')?.textContent ?? '').replace(/\s+/g, ' ').trim()} | ${(tr.querySelector('td.stub')?.textContent ?? tr.querySelector('td.estimate')?.textContent ?? '').replace(/\s+/g, ' ').trim()} | ${(tr.querySelector('td.relation')?.textContent ?? '').replace(/\s+/g, ' ').trim()}`))
  const marks = await page.evaluate(() => [...document.querySelectorAll('section.hb-profile figure.blob-figure svg.hb-blob g.mark')].map((m) => `${m.getAttribute('data-spoke')}:${m.classList.contains('unmeasured') ? 'unmeasured' : m.classList.contains('muted') ? 'muted' : 'measured'}${m.querySelector('path.arrow') ? ':arrow' : ''}`))
  return { rows, marks }
}

test('verify2 journey: whole session, save, reload, load, See my results', async ({ page }, testInfo) => {
  test.setTimeout(20 * 60_000)
  const project = testInfo.project.name
  const touch = testInfo.project.use.hasTouch === true
  const log = trackConsole(page)
  const shots = new Shots(page, RUN, `journey-${project}`)
  const facts: Record<string, unknown> = { project }
  const journey = await playJourney(page, { runId: RUN, touch, practice: false, shots, limitMs: 12 * 60_000 })
  facts.journey = { completed: journey.completed, error: journey.error, segments: journey.segments, answered: journey.answered, steps: journey.steps.length, realMs: journey.realMs, played: journey.played }
  if (journey.completed) {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const skip = button(page, 'Skip animation')
    if (await skip.isVisible().catch(() => false)) await press(touch, skip)
    await expect(button(page, 'Download save file')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.reveal[data-building="false"]')).toBeVisible({ timeout: 60_000 }).catch(() => undefined)
    await page.waitForTimeout(500)
    const m = await pageMetrics(page, { touch, axe: true })
    shots.json('results-metrics', m)
    facts['results'] = { h1: (await h1(page).innerText()).trim(), lead: await page.locator('p.lead').allInnerTexts(), overflowX: m.overflowX.px, clipped: m.clipped, axeSerious: m.axe?.serious.map((v) => `${v.id} x${v.nodes}`), offScaleLabels: await page.locator('svg.hb-blob text').filter({ hasText: /off scale/i }).count() }
    await shots.all('results-final')
    const before = await profileOf(page)
    await press(touch, page.getByRole('button', { name: 'Bar view' }))
    await page.waitForTimeout(300)
    const beforeRows = await profileOf(page)
    await shots.all('results-bars')
    // The save: download, then the file.
    await press(touch, page.getByRole('button', { name: 'Blob view' }))
    const panel = page.locator('[data-section="save"]')
    await panel.scrollIntoViewIfNeeded()
    const [dl] = await Promise.all([page.waitForEvent('download'), press(touch, button(page, 'Download save file'))])
    const name = dl.suggestedFilename()
    const file = await dl.path()
    const text = readFileSync(file ?? '', 'utf8')
    const doc = JSON.parse(text) as { sessions?: { responses?: { family?: string }[] }[]; anon_id?: string }
    const rtSources = text.match(/"rt_timestamp_source":"[a-z]+"/g) ?? []
    await expect(panel).toHaveAttribute('data-saved', 'true')
    await page.waitForTimeout(300)
    facts['save'] = { name, sessions: doc.sessions?.length ?? null, responses: doc.sessions?.map((s) => s.responses?.length ?? 0), rtResponses: doc.sessions?.map((s) => (s.responses ?? []).filter((r) => /^rt_/.test(r.family ?? '')).length), rtTimestampSources: [...new Set(rtSources)], savedLine: await panel.locator('[data-saved-as]').innerText().catch(() => null), shot: await shots.shot('after-save', { fullPage: false }) }
    // Reload: the welcome, the way back to Ready, the file on the ready screen, See my results.
    await page.reload()
    await expect(h1(page)).toHaveText('HumanBench', { timeout: 30_000 })
    facts['after reload'] = { h1: (await h1(page).innerText()).trim(), shot: await shots.shot('after-reload', { fullPage: false }) }
    await press(touch, button(page, 'Start'))
    await expect(h1(page)).toHaveText(/^(Before you start|Honour code)$/)
    if (((await h1(page).textContent()) ?? '').trim() === 'Before you start') {
      await press(touch, page.getByRole('checkbox', { name: /18 or older/ }))
      await press(touch, button(page, 'Continue'))
    }
    await expect(h1(page)).toHaveText('Honour code')
    await press(touch, page.getByRole('checkbox', { name: /honour code/ }))
    await press(touch, button(page, 'Continue'))
    await expect(h1(page)).toHaveText('Check your device')
    await expect(button(page, 'Continue')).toBeEnabled({ timeout: 20_000 })
    await press(touch, page.getByRole('radio', { name: touch ? 'Tap or click' : 'Keyboard' }))
    await press(touch, button(page, 'Continue'))
    await expect(h1(page)).toHaveText('Ready when you are')
    const readyText = await page.locator('main').innerText()
    facts['ready after reload'] = { earlierSaves: /Earlier saves on this device/.test(readyText), lastSaved: readyText.match(/Last saved [^\n]*/)?.[0] ?? null, seeMyResultsBeforeLoad: await button(page, 'See my results').count(), shot: await shots.shot('ready-after-reload', { fullPage: true }) }
    // The autosave of this device is left out, so the file alone makes the profile.
    const found = page.getByRole('checkbox', { name: /earlier|found|this device/i }).first()
    if ((await found.count()) > 0 && (await found.isChecked())) await press(touch, found)
    await page.getByLabel('Save file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) })
    await expect(page.getByText(/Loaded \d+ earlier sessions?/)).toBeVisible({ timeout: 15_000 })
    facts['file loaded'] = { status: await page.locator('[role=status]').allInnerTexts().then((ts) => ts.filter((t) => t !== '')), alerts: await page.locator('[role=alert]').allInnerTexts(), seeMyResults: await button(page, 'See my results').count(), shot: await shots.shot('file-loaded', { fullPage: false }) }
    await press(touch, button(page, 'See my results'))
    await expect(h1(page)).toHaveText('Your results', { timeout: 30_000 })
    const skip2 = button(page, 'Skip animation')
    if (await skip2.isVisible().catch(() => false)) await press(touch, skip2)
    await expect(button(page, 'Download save file')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.reveal[data-building="false"]')).toBeVisible({ timeout: 60_000 }).catch(() => undefined)
    await page.waitForTimeout(500)
    const after = await profileOf(page)
    await press(touch, page.getByRole('button', { name: 'Bar view' }))
    await page.waitForTimeout(300)
    const afterRows = await profileOf(page)
    await shots.all('see-my-results-bars')
    const sameMarks = JSON.stringify(before.marks) === JSON.stringify(after.marks)
    const sameRows = JSON.stringify(beforeRows.rows) === JSON.stringify(afterRows.rows)
    facts['see my results'] = { h1: 'Your results', lead: await page.locator('p.lead').allInnerTexts(), sameMarks, sameRows, marksBefore: before.marks, marksAfter: after.marks, rowsBefore: beforeRows.rows, rowsAfter: afterRows.rows, differingRows: beforeRows.rows.filter((r, i) => r !== afterRows.rows[i]) }
  }
  shots.json('console', log)
  shots.json('facts', facts)
  console.log(`[verify2] journey ${project}: ${JSON.stringify({ completed: journey.completed, error: journey.error, answered: journey.answered, realMs: journey.realMs, save: (facts['save'] as { name: string } | undefined)?.name, same: facts['see my results'] === undefined ? null : { marks: (facts['see my results'] as { sameMarks: boolean }).sameMarks, rows: (facts['see my results'] as { sameRows: boolean }).sameRows } })}`)
  expect(journey.steps.length).toBeGreaterThan(0)
})
