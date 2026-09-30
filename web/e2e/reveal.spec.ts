/// <reference lib="dom" />
/**
 * The reveal and results in real browsers (ROADMAP M1.R; DESIGN §10, §7.3, §7.6, §7.8, §13; Phase
 * AI proposal v2 §3.3): the blob builds up skill by skill and can be skipped, the distinctive peaks,
 * the drill-down, the required save with its `beforeunload` guard, the cards that wait for the save,
 * three worked examples, the retest advice and 20-minute focus sessions, the norms and Pace note,
 * and the results footer. The results are those of a simulated earlier session loaded on the ready
 * screen (`scripts/e2e-save.ts`), so the page shows a rich profile without a 25-minute session.
 * Every state is checked with axe (0 serious or critical, WCAG 2.2 AA), the language lint, and
 * reflow at 320 px. WebKit and iPhone 13 run the same specs (download events are desktop-only).
 */

import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { RESOURCE_LINE } from '../src/copy'
import { TALK_PREAMBLE } from '../src/reveal/copy'
import { expectNoSeriousAxe } from './axe'
import { answerItem, button, h1, languageClean, loadSave, openDetails, overflow, scheme, simulatedSave, toReady, toResults, unloadIsGuarded } from './flow'

const status = (page: Page) => page.locator('.reveal [role="status"]')
const section = (page: Page, name: string) => page.locator(`[data-section="${name}"]`)
const crisp = (page: Page) => page.locator('svg.hb-blob path.crisp').first()

/** No motion: the profile is complete at once. */
async function still(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
}

test.describe('the build-up, axis by axis (§10)', () => {
  test('draws the blob skill by skill, announces once, and can be skipped; the rest waits for the profile', async ({ page }) => {
    await toResults(page)
    await expect(status(page)).toHaveText('Building your profile, one skill at a time.')
    await expect(button(page, 'Skip animation')).toBeVisible()
    await expect(section(page, 'peaks')).toHaveCount(0)
    await expect(section(page, 'save')).toHaveCount(0)
    await expect(page.locator('svg.hb-blob').first()).toBeVisible()
    await button(page, 'Skip animation').click()
    await expect(status(page)).toHaveText('Your profile is ready.')
    await expect(section(page, 'peaks')).toBeVisible()
    await expect(section(page, 'save')).toBeVisible()
    await expect(page.locator('.reveal')).toHaveAttribute('data-building', 'false')
  })

  test('runs by itself, and the last frame is exactly the static profile; replay draws it again', async ({ page }) => {
    await toResults(page)
    await expect(status(page)).toHaveText('Your profile is ready.', { timeout: 20_000 })
    const done = await crisp(page).getAttribute('d')
    await button(page, 'Replay animation').click()
    await expect(page.locator('.reveal')).toHaveAttribute('data-building', 'true')
    await expect(page.locator('.reveal .now')).toContainText('Now showing:')
    await expect(status(page)).toHaveText('Your profile is ready.', { timeout: 20_000 })
    expect(await crisp(page).getAttribute('d')).toBe(done)
    // The sections that appeared stayed while it replayed.
    await expect(section(page, 'save')).toBeVisible()
  })

  test('with prefers-reduced-motion there is no animation, no skip and no replay', async ({ page }) => {
    await still(page)
    await toResults(page)
    await expect(status(page)).toHaveText('Your profile is ready.')
    await expect(page.locator('.reveal')).toHaveAttribute('data-building', 'false')
    await expect(button(page, 'Skip animation')).toHaveCount(0)
    await expect(button(page, 'Replay animation')).toHaveCount(0)
    await expect(section(page, 'peaks')).toBeVisible()
  })

  test('the mid-build page has no serious axe issues either', async ({ page }) => {
    await toResults(page)
    await expect(button(page, 'Skip animation')).toBeVisible()
    await expectNoSeriousAxe(page)
  })
})

test.describe('the flow: peaks → drill-down → save → the rest (§10)', () => {
  test('sections come in the order of the flow', async ({ page }) => {
    await still(page)
    await toResults(page)
    const y = async (sel: string): Promise<number> => {
      const box = await page.locator(sel).first().boundingBox()
      expect(box, sel).not.toBeNull()
      return box!.y + (await page.evaluate(() => window.scrollY))
    }
    const order = ['svg.hb-blob', '[data-section="peaks"]', '.drill', '[data-section="save"]', '[data-section="worked"]', '[data-section="retest"]', '[data-section="numbers"]', '[data-section="results-footer"]']
    const ys: number[] = []
    for (const sel of order) ys.push(await y(sel))
    for (let i = 1; i < ys.length; i++) expect(ys[i]!, `${order[i]} comes after ${order[i - 1]}`).toBeGreaterThan(ys[i - 1]!)
  })

  test('the distinctive peaks are the credible ones the model finds, with their range, and never a total', async ({ page }) => {
    await still(page)
    const sim = await toResults(page)
    const peaks = section(page, 'peaks')
    await expect(peaks.getByRole('heading', { level: 2, name: 'Your most distinctive peaks' })).toBeVisible()
    await expect(peaks.locator('[data-peak]')).toHaveCount(sim.peaks.length)
    for (const name of sim.peaks) await expect(peaks.locator('[data-peak]', { hasText: name })).toContainText(/stands out by about \d\.\d SD from your other skills \(90% range [+−]\d\.\d to [+−]\d\.\d SD\)/)
    await expect(peaks).toContainText('It is not a comparison with other people')
    expect(await peaks.innerText()).not.toMatch(/\b(total|overall|average|score)\b/i)
    await expectNoSeriousAxe(page)
  })

  test('the drill-down opens a cluster below the peaks', async ({ page }) => {
    await still(page)
    await toResults(page)
    await page.getByRole('button', { name: 'Speed', exact: true }).click()
    await expect(page.locator('section.facet-panel')).toBeVisible()
    const peaks = await section(page, 'peaks').boundingBox()
    const facets = await page.locator('section.facet-panel').boundingBox()
    expect(facets!.y).toBeGreaterThan(peaks!.y)
    await expectNoSeriousAxe(page)
  })

  test('shows "practice-adjusted" on the profile, with the one-session wording first', async ({ page }) => {
    await still(page)
    await toResults(page, 1)
    await expect(page.locator('[data-practice-adjusted]')).toContainText('Practice-adjusted')
    await expect(page.locator('[data-practice-adjusted]')).toContainText('nothing to adjust yet')
  })

  test('a returning person with two sessions sees the later wording and all 17 skills of the merged re-score', async ({ page }) => {
    await still(page)
    await toResults(page, 2)
    await expect(page.locator('[data-practice-adjusted]')).toContainText('each later session is credited for the practice')
    await expect(page.locator('table.hb-bars tbody tr')).toHaveCount(17)
  })
})

test.describe('the required save (§10)', () => {
  test('the tab is guarded until the file is downloaded, and the cards wait for it', async ({ page, isMobile }) => {
    await still(page)
    await toResults(page)
    expect(await unloadIsGuarded(page)).toBe(true)
    await expect(section(page, 'save').getByRole('heading', { level: 2, name: 'Save your results' })).toBeVisible()
    await expect(section(page, 'after-save')).toHaveCount(0)
    await expect(page.locator('[data-slot]')).toHaveCount(0)
    await expect(page.getByText(TALK_PREAMBLE)).toHaveCount(0)
    await expect(page.locator('[data-pending]')).toHaveText('Save your file first to see the next steps.')
    if (!isMobile) {
      const download = page.waitForEvent('download')
      await button(page, 'Download save file').click()
      const file = await download
      expect(file.suggestedFilename()).toMatch(/^humanbench-[0-9A-Za-z]{6}-\d{4}-\d{2}-\d{2}\.hbsave\.json$/)
    } else {
      await button(page, 'Download save file').click()
    }
    await expect(section(page, 'save')).toContainText('You can leave this page safely')
    expect(await unloadIsGuarded(page)).toBe(false)
    await expect(section(page, 'after-save')).toBeVisible()
    await expect(page.locator('[data-slot]')).toHaveCount(3)
    await expect(page.locator('[data-slot="share-card"]')).toContainText('not available in this version yet')
    await expect(page.locator('[data-slot="notes-for-ai"]')).toContainText('Notes for your AI')
    await expect(page.locator('[data-placeholder]')).toContainText('not available in this version yet')
    await expectNoSeriousAxe(page)
  })

  test('the downloaded file lists the worked examples’ families, so a later session leaves them out (§7.7)', async ({ page, isMobile }) => {
    test.skip(isMobile, 'a download event cannot be observed on the iOS emulation (M1.22 covers the WebKit save)')
    await still(page)
    const sim = await toResults(page)
    const download = page.waitForEvent('download')
    await button(page, 'Download save file').click()
    const saved = JSON.parse(readFileSync((await (await download).path())!, 'utf8')) as { seen_families: string[]; sessions: unknown[] }
    const before = new Set((sim.save as { seen_families: string[] }).seen_families)
    const added = saved.seen_families.filter((f) => !before.has(f) && /^f:(matrices|series|quant):/.test(f))
    expect(new Set(added.map((f) => f.split(':')[1])).size).toBe(3)
    expect(saved.sessions.length).toBe(2) // the simulated session and this (empty) one
  })

  test('copying the save code alone does not count as saved', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard permissions are granted in Chromium only')
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await still(page)
    await toResults(page)
    await button(page, 'Copy save code').click()
    await expect(section(page, 'save').locator('[role="status"]')).toContainText('Downloading the file is still the safest way')
    expect(await unloadIsGuarded(page)).toBe(true)
    await expect(section(page, 'after-save')).toHaveCount(0)
  })

  test('closing the tab asks the browser to confirm while unsaved, and not once saved (a real beforeunload dialog)', async ({ page, browserName, isMobile }) => {
    test.skip(browserName !== 'chromium' || isMobile, 'the beforeunload dialog is asserted in desktop Chromium; the guard itself is checked in every browser above')
    await still(page)
    await toResults(page)
    const dialog = page.waitForEvent('dialog')
    await page.close({ runBeforeUnload: true })
    const d = await dialog
    expect(d.type()).toBe('beforeunload')
    await d.dismiss()
    expect(page.isClosed()).toBe(false)
    await button(page, 'Download save file').click()
    let asked = 0
    page.on('dialog', (x) => {
      asked++
      void x.dismiss()
    })
    const closed = page.waitForEvent('close')
    await page.close({ runBeforeUnload: true })
    await closed
    expect(asked).toBe(0)
  })

  test('"Back to the start" asks first while unsaved; staying returns focus; leaving goes to the start', async ({ page }) => {
    await still(page)
    await toResults(page)
    await button(page, 'Back to the start').click()
    await expect(page.getByRole('heading', { level: 2, name: 'Leave without saving?' })).toBeVisible()
    await expectNoSeriousAxe(page)
    await button(page, 'Stay and save').click()
    await expect(button(page, 'Back to the start')).toBeFocused()
    await button(page, 'Back to the start').click()
    await button(page, 'Leave anyway').click()
    await expect(h1(page)).toHaveText('HumanBench')
    expect(await unloadIsGuarded(page)).toBe(false)
  })

  test('after saving, "Back to the start" goes straight there', async ({ page }) => {
    await still(page)
    await toResults(page)
    await button(page, 'Download save file').click()
    await button(page, 'Back to the start').click()
    await expect(h1(page)).toHaveText('HumanBench')
  })
})

test.describe('the cards after the save: share slot, notes, results-talk helper (Phase AI)', () => {
  test('the results-talk preamble and the "never paste your save file" line are visible, and the preamble copies', async ({ page, context, browserName }) => {
    if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await still(page)
    await toResults(page)
    await button(page, 'Download save file').click()
    const talk = page.locator('[data-slot="results-talk"]')
    await expect(talk).toContainText('Never paste your save file')
    await expect(talk).toContainText(TALK_PREAMBLE)
    await expect(button(page, 'Copy this preamble')).toBeVisible()
    await button(page, 'Copy this preamble').click()
    await expect(talk.locator('[role="status"]')).toContainText(/Preamble copied\.|could not be copied/)
    if (browserName === 'chromium') {
      await expect(talk.locator('[role="status"]')).toHaveText('Preamble copied.')
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(TALK_PREAMBLE)
    }
    // Nothing of the cards is a share card: the resource line is not in any of them.
    for (const slot of await page.locator('[data-slot]').all()) expect(await slot.innerText()).not.toContain(RESOURCE_LINE)
  })
})

test.describe('worked examples (§10)', () => {
  test('three fresh items, each with a worked solution to open; axe passes with them open', async ({ page }) => {
    await still(page)
    await toResults(page)
    const cards = section(page, 'worked').locator('article[data-worked]')
    await expect(cards).toHaveCount(3)
    await expect(cards.nth(0)).toHaveAttribute('data-worked', 'matrix')
    await expect(cards.nth(1)).toHaveAttribute('data-worked', 'series')
    await expect(cards.nth(2)).toHaveAttribute('data-worked', 'quant')
    // The 3 × 3 grid (8 cells and the empty one), the six options, and the answer’s cell inside the closed solution.
    await expect(cards.nth(0).locator('svg')).toHaveCount(9 + 6 + 1)
    await expect(cards.nth(1).locator('.terms')).toContainText(', ?')
    const first = cards.nth(2).locator('details')
    await expect(first.locator('ol.steps')).toBeHidden()
    await first.locator('summary').click()
    await expect(first.locator('ol.steps li').first()).toBeVisible()
    await expect(first.locator('.answer')).toContainText('Answer:')
    await openDetails(page)
    await expectNoSeriousAxe(page)
    await languageClean(page)
  })

  test('the examples are not the person’s own questions and are the same after a reload of the screen (seeded by the session)', async ({ page }) => {
    await still(page)
    await toResults(page)
    const stems = await section(page, 'worked').locator('article[data-worked="quant"] .terms').innerText()
    expect(stems.length).toBeGreaterThan(10)
  })
})

test.describe('coming back for more (§10, §7.6)', () => {
  test('predicts the shrinkage, lists the widest ranges and advises a week between sessions', async ({ page }) => {
    await still(page)
    await toResults(page)
    const r = section(page, 'retest')
    await expect(r.locator('[data-shrinkage]')).toHaveText('A second session would typically tighten the ranges in your profile by about 25%.')
    await expect(r.locator('[data-fuzzy]')).toHaveCount(3)
    await expect(r).toContainText('not that the skill is weak')
    await expect(r.locator('[data-spacing]')).toContainText('at least 7 days')
    await expectNoSeriousAxe(page)
  })

  test('a focus session runs only the chosen part for about 20 minutes, and its results add to the first (M1.Q)', async ({ page }) => {
    await still(page)
    await toResults(page)
    const form = section(page, 'retest').locator('[data-focus-form]')
    for (const box of await form.getByRole('checkbox').all()) await box.uncheck()
    await button(page, 'Start a 20-minute focus session').click()
    await expect(form.getByRole('alert')).toHaveText('Pick at least one part.')
    await form.getByRole('checkbox', { name: /Matrix & Series/ }).check()
    await button(page, 'Start a 20-minute focus session').click()
    await expect(h1(page)).toHaveText('Up next: Matrix & Series')
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '0 of about 20 min')
    await expect(page.getByRole('navigation', { name: 'Session checklist' })).toContainText('Not in this session')
    await expectNoSeriousAxe(page)
    await button(page, 'Start').click()
    await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
    await answerItem(page)
    await expect(page.getByRole('slider')).toHaveCount(0)
    await button(page, 'Finish early').click()
    await button(page, 'Finish now').click()
    await expect(h1(page)).toHaveText('Session complete')
    // Two sessions with data now: practice-adjusted, and a smaller further gain.
    await expect(page.locator('[data-practice-adjusted]')).toContainText('each later session is credited')
    await expect(section(page, 'retest').locator('[data-shrinkage]')).toHaveText('Another session would typically tighten the ranges in your profile by about 15%.')
    // Nothing was marked skipped: the parts left out of a focus session are not "declined".
    await expect(page.locator('table.hb-bars tbody tr.unmeasured')).toHaveCount(17 - simulatedSave().measured.length)
  })

  test('a returning person can start a focus session from the ready screen', async ({ page }) => {
    await still(page)
    await toReady(page)
    await expect(page.locator('details.focus')).toHaveCount(0) // nothing to build on yet
    await loadSave(page, simulatedSave().save)
    const focus = page.locator('details.focus')
    await expect(focus.locator('summary')).toHaveText('Or a 20-minute focus session')
    await focus.locator('summary').click()
    await expectNoSeriousAxe(page)
    for (const box of await focus.getByRole('checkbox').all()) await box.uncheck()
    await focus.getByRole('checkbox', { name: /Quantitative Reasoning/ }).check()
    await button(page, 'Start a 20-minute focus session').click()
    await expect(h1(page)).toHaveText('Up next: Quantitative Reasoning')
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '0 of about 20 min')
  })
})

test.describe('about these numbers (§7.3, §7.1)', () => {
  test('rough comparisons for the parts done, web-relative reaction times, the separate Pace note, and no taker wording', async ({ page }) => {
    await still(page)
    await toResults(page)
    const n = section(page, 'numbers')
    await expect(n.locator('[data-norm="rt"]')).toContainText('Times on the web run tens of milliseconds slower than in a lab')
    await expect(n.locator('[data-norm="rt"]')).toContainText('about 300 ms')
    await expect(n.locator('[data-norm="span"]')).toContainText('Typical adults manage about 6 to 7 digits forwards and 4 to 5 backwards')
    await expect(n.locator('[data-norm="reading"]')).toContainText('238 words per minute for non-fiction and 260 for fiction')
    const pace = n.locator('details.pace')
    await pace.locator('summary').click()
    await expect(pace).toContainText('separate from your skill estimates')
    await expect(pace.locator('li[data-pace]').first()).toBeVisible()
    // Hidden until A12 allows percentiles (after M4 linking, N >= 500).
    expect(await page.locator('body').innerText()).not.toContain('vs other HumanBench takers')
    await expectNoSeriousAxe(page)
  })
})

test.describe('the results footer (R-5.6.5, A13, §13)', () => {
  test('holds the resource line once, in the footer, next to the disclaimer of every screen', async ({ page }) => {
    await still(page)
    await toResults(page)
    await button(page, 'Download save file').click()
    const footer = section(page, 'results-footer')
    await expect(footer).toHaveText(RESOURCE_LINE)
    expect(((await page.locator('body').innerText()).match(new RegExp(RESOURCE_LINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length).toBe(1)
    await expect(page.locator('footer .disclaimer')).toContainText('For curiosity and self-reflection')
  })
})

test.describe('the whole results page', () => {
  test('has no serious axe issues in light and dark with everything open, and passes the language lint', async ({ page }) => {
    await toResults(page)
    await button(page, 'Skip animation').click()
    await button(page, 'Download save file').click()
    await expect(section(page, 'after-save')).toBeVisible()
    await openDetails(page)
    for (const colorScheme of ['light', 'dark'] as const) {
      await scheme(page, colorScheme)
      await expect(h1(page)).toHaveText('Session complete')
      await expectNoSeriousAxe(page)
    }
    await languageClean(page)
  })

  test('shows no total, area, single score or rank for the person', async ({ page }) => {
    await still(page)
    await toResults(page)
    await button(page, 'Download save file').click()
    const body = (await page.locator('main').innerText()).replace(TALK_PREAMBLE, '')
    expect(body).not.toMatch(/\b(overall (score|number|figure)|total score|your score|your rank|percentile|top \d+%)\b/i)
    expect(await page.locator('main').innerHTML()).not.toMatch(/data-(total|area|score|mean)/i)
  })

  test('is usable by keyboard alone: the save, the cards and the focus form are reachable', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard navigation is checked on the desktop projects')
    await still(page)
    await toResults(page)
    await button(page, 'Download save file').focus()
    await page.keyboard.press('Enter')
    await expect(section(page, 'after-save')).toBeVisible()
    await button(page, 'Copy this preamble').focus()
    await expect(button(page, 'Copy this preamble')).toBeFocused()
    await page.locator('details.pace summary').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('details.pace')).toHaveAttribute('open', '')
  })
})

test.describe('reflow at 320 CSS px with a wide font (WCAG 1.4.10)', () => {
  test('the results, the save panel, the cards and the worked examples fit without sideways scrolling', async ({ page }) => {
    await page.addInitScript(`(() => {
      const add = () => {
        if (document.getElementById('hb-wide-font') || !document.head) return
        const s = document.createElement('style')
        s.id = 'hb-wide-font'
        s.textContent = ${JSON.stringify("html, html * { font-family: Verdana, 'DejaVu Sans', sans-serif !important; hyphens: manual !important; -webkit-hyphens: manual !important; } html *:not(svg):not(svg *) { letter-spacing: 0.06em !important; }")}
        document.head.appendChild(s)
      }
      add()
      document.addEventListener('readystatechange', add)
    })()`)
    await page.setViewportSize({ width: 320, height: 700 })
    await still(page)
    await toResults(page)
    await overflow(page, 'results (saved: no)')
    await button(page, 'Download save file').click()
    await expect(section(page, 'after-save')).toBeVisible()
    await openDetails(page)
    await overflow(page, 'results (saved, disclosures open)')
    await page.getByRole('button', { name: 'Speed', exact: true }).click()
    await overflow(page, 'results with a drill-down')
    await button(page, 'Back to the start').click()
    await expect(h1(page)).toHaveText('HumanBench')
  })
})
