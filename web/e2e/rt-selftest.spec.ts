/**
 * Smoke e2e of the RT timing self-test page (ROADMAP M1.23; DESIGN §11.6, §13): the page loads
 * under the Pages base path, runs a quick measurement end to end (frames, timer, onsets, key and
 * pointer presses), produces a parseable JSON report with p50/p95/max per metric and a verdict,
 * handles skipped input phases, passes the rendered language lint (A13), and has no serious or
 * critical axe violations before and after a run, in light and dark mode. The verdict itself is
 * not asserted: headless browsers are not the display under test (the user runs it on a 120 Hz Mac).
 */

import { expect, test, type Page } from '@playwright/test'
import { lintText } from '../scripts/language-lint'
import { expectNoSeriousAxe } from './axe'

const PAGE = './rt-selftest.html'
const QUICK = `${PAGE}?quick=1`

interface Summary {
  n: number
  p50: number
  p95: number
  max: number
}
interface Metric {
  summary: Summary | null
  pass: boolean | null
  note?: string
}
interface Report {
  report_version: string
  threshold_ms: number
  gate_quantile: number
  quick: boolean
  refresh: { hz: number; raw_hz: number; snapped: boolean; n_deltas: number }
  metrics: Record<string, Metric>
  pass: boolean
  event_lag: { max_ms: number; key_rt_source: string | null; pointer_rt_source: string | null }
}

/** Start a quick run and wait for the key-press phase (the automatic part is done). */
async function runAutomaticPart(page: Page): Promise<void> {
  await page.goto(QUICK)
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByRole('heading', { name: 'Key presses' })).toBeVisible({ timeout: 45_000 })
}

async function readReport(page: Page): Promise<Report> {
  const box = page.getByLabel('JSON report')
  await expect(box).toBeVisible()
  return JSON.parse(await box.inputValue()) as Report
}

test.describe('RT timing self-test page (M1.23)', () => {
  test('loads under /humanbench/ with every asset and no errors', async ({ page }) => {
    const problems: string[] = []
    page.on('response', (r) => {
      if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`)
    })
    page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`console error: ${m.text()}`)
    })
    const response = await page.goto(PAGE, { waitUntil: 'networkidle' })
    expect(response?.status()).toBe(200)
    expect(new URL(page.url()).pathname).toBe('/humanbench/rt-selftest.html')
    await expect(page).toHaveTitle(/RT timing self-test/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('RT timing self-test')
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex')
    expect(problems).toEqual([])
  })

  test('the main page does not link to it (it is linked from nowhere prominent)', async ({ page }) => {
    await page.goto('./')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.locator('a[href*="rt-selftest"]')).toHaveCount(0)
  })

  test('a quick run measures every metric and reports p50/p95/max with a verdict', async ({ page }) => {
    await runAutomaticPart(page)
    // Focus moves to the key-press instructions (the Start button is disabled during the run).
    await expect(page.getByText(/^Press the space bar/)).toBeFocused()
    for (let i = 0; i < 3; i++) await page.keyboard.press('Space')
    // Each new section takes the focus (the old one, with the focused element, is removed).
    await expect(page.getByRole('heading', { name: 'Pointer presses' })).toBeFocused()
    const target = page.getByRole('button', { name: 'Tap target' })
    for (let i = 0; i < 3; i++) await target.click()
    await expect(page.getByRole('heading', { name: 'Results' })).toBeFocused()
    await expect(page.getByRole('table')).toContainText('Stimulus onset error')

    const r = await readReport(page)
    expect(r.report_version).toBe('rt_selftest_v3')
    expect(r).toMatchObject({ threshold_ms: 5, gate_quantile: 0.95, quick: true })
    expect(typeof r.pass).toBe('boolean')
    expect(r.refresh.n_deltas).toBeGreaterThanOrEqual(60)
    expect(r.refresh.hz).toBeGreaterThan(0)
    for (const k of ['raf_interval_ms', 'raf_jitter_ms', 'timer_resolution_ms', 'onset_error_ms', 'onset_lag_ms', 'key_latency_ms', 'pointer_latency_ms']) {
      const s = r.metrics[k]?.summary
      expect(s, k).toBeTruthy()
      expect(s!.p50, k).toBeLessThanOrEqual(s!.p95)
      expect(s!.p95, k).toBeLessThanOrEqual(s!.max)
    }
    expect(r.metrics.onset_error_ms?.summary?.n).toBe(8)
    expect(r.metrics.key_latency_ms?.summary?.n).toBe(3)
    expect(r.metrics.pointer_latency_ms?.summary?.n).toBe(3)
    for (const k of ['raf_jitter_ms', 'timer_resolution_ms', 'onset_error_ms']) {
      expect(typeof r.metrics[k]?.pass, k).toBe('boolean')
    }
    // Input lag is informational while RT uses the event timestamp (§11.6); a p50 lag over the bound fails it.
    expect(r.event_lag.max_ms).toBe(25)
    for (const [k, src] of [['key_latency_ms', r.event_lag.key_rt_source], ['pointer_latency_ms', r.event_lag.pointer_rt_source]] as const) {
      expect(src, k).toMatch(/^(event|handler)$/)
      if (src === 'event') expect(r.metrics[k]?.pass, k).toBeNull()
      else expect(r.metrics[k]?.pass, k).toBe(false)
    }
    await expect(page.getByText(/^Overall:/)).toContainText(r.pass ? 'Pass' : 'Fail')
    await expect(page.getByRole('button', { name: 'Run again' })).toBeEnabled()
    // The results fit the viewport (iPhone 13 too): no sideways page scroll.
    const overflow = (await page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')) as number
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('input phases can be skipped (keyboard-only or touch-only devices)', async ({ page }) => {
    await runAutomaticPart(page)
    await page.getByRole('button', { name: 'Skip: no keyboard' }).click()
    await page.getByRole('button', { name: 'Skip: no mouse or touch' }).click()
    const r = await readReport(page)
    expect(r.metrics.key_latency_ms).toEqual({ summary: null, pass: null, note: 'skipped' })
    expect(r.metrics.pointer_latency_ms).toEqual({ summary: null, pass: null, note: 'skipped' })
    await expect(page.getByRole('table')).toContainText('Skipped')
  })

  test('keyboard only: Enter on a Skip button skips (it is not a key-press sample), focus follows', async ({ page }) => {
    await runAutomaticPart(page)
    await page.getByRole('button', { name: 'Skip: no keyboard' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Pointer presses' })).toBeFocused()
    await expect(page.getByRole('status').first()).toHaveText(/^Pointer presses: 0 of 3$/)
    await page.getByRole('button', { name: 'Skip: no mouse or touch' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Results' })).toBeFocused()
    const r = await readReport(page)
    expect(r.metrics.key_latency_ms).toEqual({ summary: null, pass: null, note: 'skipped' })
    expect(r.metrics.pointer_latency_ms).toEqual({ summary: null, pass: null, note: 'skipped' })
  })

  test('the rendered page passes the language lint (A13)', async ({ page }) => {
    await runAutomaticPart(page)
    await page.getByRole('button', { name: 'Skip: no keyboard' }).click()
    await page.getByRole('button', { name: 'Skip: no mouse or touch' }).click()
    await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible()
    const html = (await page.content()).replace(/\/assets\/[^"'\s)]+/g, '/assets/')
    expect(lintText(html, 'rt-selftest.rendered.html')).toEqual([])
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`has no serious or critical axe violations before and after a run (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme })
      await page.goto(QUICK)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expectNoSeriousAxe(page)
      await page.getByRole('button', { name: 'Start' }).click()
      await expect(page.getByRole('heading', { name: 'Key presses' })).toBeVisible({ timeout: 45_000 })
      await expectNoSeriousAxe(page)
      await page.keyboard.press('Space')
      await page.getByRole('button', { name: 'Skip: no keyboard' }).click()
      await expect(page.getByRole('button', { name: 'Tap target' })).toBeVisible()
      await expectNoSeriousAxe(page)
      await page.getByRole('button', { name: 'Skip: no mouse or touch' }).click()
      await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible()
      await expectNoSeriousAxe(page)
    })
  }
})
