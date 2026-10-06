/// <reference lib="dom" />
/**
 * Persona "Mei" (UX review package rev-nonnative): reads English well but not natively (about CEFR B2),
 * sometimes turns on the browser's page translation, and types decimals with a comma.
 *
 *   UX_PORT=4615 UX_RUN=nonnative npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/nonnative.ux.ts --project=chromium --grep 'nonnative: tour start'
 *
 * Tests (each short, so one can be run at a time with --grep):
 * - `tour start|session|results`: the product routes at 1280 px with metrics and page text (the copy review reads the .txt files);
 * - `entry series|quant`: what the typed-entry box accepts (decimal comma, spaces, full-width and Arabic-Indic digits, a lowercase
 *   letter), what its note says, and the keypad it asks for (`inputmode`); run on chromium and iphone;
 * - `translation flow|results`: Chrome's page translation simulated (every text node replaced by <font><font>UPPER-CASED</font></font>,
 *   re-applied 200 ms after DOM changes, as Chrome does) while the flow is played: crashes, stale text, leftovers, translate="no";
 * - `expansion`: the wide-font simulation plus 200% text zoom at 390 and 1280 px on the start screens, an item and the results.
 *
 * Output: web/test-results/ux-review/<UX_RUN>/{tour,entry-<project>,translate,expand}/.
 */

import { expect, test, type Locator, type Page } from '@playwright/test'
import { button, h1, simulatedSave } from '../../e2e/flow'
import { intoSegment } from '../../e2e/routes'
import { WIDE_FONT_CSS, WIDE_FONT_STYLE_ID } from '../../e2e/wide-font'
import { parseEntry } from '../../src/tasks/quant/numeric'
import { parseIntegerResponse, parseLetterResponse } from '../../src/tasks/series/score'
import { Shots, tour, trackConsole, type ConsoleLog } from '../lib'

const RUN = (): string => process.env.UX_RUN ?? 'nonnative'

// ------------------------------------------------------------------------------------------------ 1. the tour (text + metrics)

const START_ROUTES = ['welcome', 'gate', 'gate-error', 'honour', 'device', 'ready', 'ready-returning', 'practice', 'practice-feedback', 'privacy']
const SESSION_ROUTES = ['interstitial', 'rt-intro', 'item-matrix-series', 'confidence', 'confirm-skip', 'item-spatial', 'memory-intro', 'memory-entry', 'memory-corsi', 'quant-item', 'coding-intro', 'coding-running', 'reading-passage', 'reading-questions', 'break-offer', 'finished-nothing']
const RESULTS_ROUTES = ['results', 'results-drilldown', 'results-bars', 'results-open', 'results-saved', 'share-card-dark', 'notes', 'notes-filled', 'rt-selftest-results']

for (const [group, routes] of [
  ['start', START_ROUTES],
  ['session', SESSION_ROUTES],
  ['results', RESULTS_ROUTES],
] as const) {
  test(`nonnative: tour ${group}`, async ({ context }) => {
    const entries = await tour(context, { runId: RUN(), routes, widths: [1280], schemes: ['light'], metrics: true })
    for (const e of entries) {
      const m = e.metrics['1280-light']
      const r = m?.readability
      console.log(`[nonnative ${group}] ${e.route}: ${e.ok ? 'ok' : `FAILED ${e.error ?? ''}`}${r ? ` flesch=${r.fleschReadingEase} avg=${r.avgSentenceWords} long=${r.longSentences} maxPara=${m?.longestParagraphWords}` : ''}`)
    }
    expect(entries.length).toBe(routes.length)
  })
}

// ------------------------------------------------------------------------------------------------ 2. number entry

/** What Mei might type, in the order tried: the ones the parsers reject first, then the ones an item accepts (which ends the item). */
const ENTRIES = ['3,5', '1 000', '１２', '٣٥', 'a', '3.5', '1,500', '-7', ' 7 ']

const codepoints = (s: string): string => [...s].map((c) => `U+${(c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`).join(' ')

interface Trial {
  readonly entry: string
  readonly codepoints: string
  readonly accepted: boolean
  /** The note under the box after the submit ('' when accepted). */
  readonly note: string
  readonly ariaInvalid: string | null
  /** What the family's own parser reads the entry as (computed in node, from src/). */
  readonly parser: string
  readonly shot: string
}

interface ItemProbe {
  readonly family: 'series' | 'quant'
  readonly prompt: string
  readonly label: string
  readonly hint: string
  readonly inputmode: string | null
  readonly type: string
  readonly autocapitalize: string | null
  readonly letter: boolean
  readonly signButton: boolean
  readonly shot: string
  readonly trials: Trial[]
}

function parserReads(family: 'series' | 'quant', letter: boolean, entry: string): string {
  if (family === 'quant') return parseEntry(entry)?.toString() ?? 'null (rejected)'
  if (letter) return parseLetterResponse(entry) ?? 'undefined (rejected)'
  const v = parseIntegerResponse(entry)
  return v === undefined ? 'undefined (rejected)' : String(v)
}

/** Answer a choice item so the next item comes up (a matrix before the series, in the Matrix & Series part). */
async function passChoice(page: Page): Promise<void> {
  await page.locator('form.choice').getByRole('radio').first().check()
  await button(page, 'Confirm').click()
  await expect(page.getByRole('slider')).toBeVisible()
  await button(page, 'Continue').click()
}

/** Try the entries on up to `maxItems` typed items in a row (an accepted entry ends an item; its confidence is rated and the next item probed). */
async function probeItems(page: Page, shots: Shots, family: 'series' | 'quant', maxItems: number): Promise<ItemProbe[]> {
  const queue = [...ENTRIES]
  const items: ItemProbe[] = []
  for (let n = 1; n <= maxItems && queue.length > 0; n++) {
    const form = page.locator('form.entry')
    const choice = page.locator('form.choice')
    // Wait for a typed item (passing a choice item or two on the way).
    let ready = false
    for (let k = 0; k < 4 && !ready; k++) {
      await expect(form.or(choice).first()).toBeVisible({ timeout: 10_000 })
      if ((await form.count()) > 0) ready = true
      else await passChoice(page)
    }
    if (!ready) break
    const input = form.locator('input')
    const attrs = await input.evaluate((el) => {
      const e = el as HTMLInputElement
      return { inputmode: e.getAttribute('inputmode'), type: e.type, autocapitalize: e.getAttribute('autocapitalize'), letter: e.classList.contains('letter') }
    })
    const prompt = (await page.locator('section.hb-render').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 300)
    const probe: ItemProbe = {
      family,
      prompt,
      label: (await form.locator('label.label').innerText()).trim(),
      hint: (await form.locator('.hint').innerText()).trim(),
      ...attrs,
      signButton: (await form.getByRole('button', { name: 'Change sign' }).count()) > 0,
      shot: await shots.shot(`${family}-item-${n}`, { fullPage: false }),
      trials: [],
    }
    items.push(probe)
    while (queue.length > 0) {
      const entry = queue.shift() as string
      await input.fill(entry)
      await form.getByRole('button', { name: 'Submit', exact: true }).click()
      const accepted = await page
        .getByRole('slider')
        .waitFor({ state: 'visible', timeout: 1500 })
        .then(() => true)
        .catch(() => false)
      await page.waitForTimeout(150)
      const note = accepted ? '' : (await form.locator('.hb-note').innerText()).trim()
      const ariaInvalid = accepted ? null : await input.getAttribute('aria-invalid')
      const shot = await shots.shot(`${family}-item-${n}-entry-${probe.trials.length + 1}-${accepted ? 'accepted' : 'rejected'}`, { fullPage: false })
      probe.trials.push({ entry, codepoints: codepoints(entry), accepted, note, ariaInvalid, parser: parserReads(family, attrs.letter, entry), shot })
      console.log(`[nonnative entry ${family}] item ${n} "${entry}" -> ${accepted ? 'accepted' : `rejected: ${note}`} (parser: ${parserReads(family, attrs.letter, entry)})`)
      if (accepted) {
        await button(page, 'Continue').click()
        break
      }
    }
  }
  return items
}

for (const family of ['series', 'quant'] as const) {
  test(`nonnative: entry ${family}`, async ({ page }, testInfo) => {
    const project = testInfo.project.name
    const log = trackConsole(page)
    const shots = new Shots(page, RUN(), `entry-${family}-${project}`)
    await intoSegment(page, family === 'series' ? 1 : 4)
    const items = await probeItems(page, shots, family, 3)
    shots.json('probe', { project, viewport: page.viewportSize(), items, console: log })
    expect(items.length, 'at least one typed item was probed').toBeGreaterThan(0)
  })
}

// ------------------------------------------------------------------------------------------------ 3. page translation

/**
 * Chrome's page translation, simulated: every non-blank text node is replaced by
 * `<font style="vertical-align: inherit;"><font style="vertical-align: inherit;">TEXT</font></font>` (upper-cased, so a
 * translated node is told from an untouched one), and the pass is re-run 200 ms after any DOM change, as Chrome re-translates
 * what an app renders later. `translate="no"` and `.notranslate` subtrees are respected, as Chrome does. `window.__hbTr`
 * counts the wrapped nodes and the passes.
 */
const TRANSLATE_INIT = `(() => {
  const SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, TITLE: 1 }
  const state = { wrapped: 0, passes: 0, timer: 0 }
  window.__hbTr = state
  const translate = (s) => s.toUpperCase()
  const skip = (el) => !el || SKIP[el.nodeName] || el.closest('[translate="no"], .notranslate, svg, font[data-hb-tr]')
  const wrap = (node) => {
    const parent = node.parentNode
    if (!parent || parent.nodeType !== 1 || skip(parent)) return
    if (!/\\S/.test(node.data)) return
    const outer = document.createElement('font')
    outer.setAttribute('style', 'vertical-align: inherit;')
    outer.setAttribute('data-hb-tr', '1')
    const inner = document.createElement('font')
    inner.setAttribute('style', 'vertical-align: inherit;')
    inner.appendChild(document.createTextNode(translate(node.data)))
    outer.appendChild(inner)
    parent.replaceChild(outer, node)
    state.wrapped++
  }
  const pass = () => {
    state.timer = 0
    if (!document.body) return
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const nodes = []
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n)
    nodes.forEach(wrap)
    state.passes++
  }
  const schedule = () => { if (!state.timer) state.timer = setTimeout(pass, 200) }
  const start = () => {
    if (!document.body) { setTimeout(start, 10); return }
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true })
    schedule()
  }
  start()
})()`

interface TrState {
  readonly wrapped: number
  readonly passes: number
}

/** Let the simulated translation catch up with the screen, and say how much it has wrapped so far. */
async function translated(page: Page): Promise<TrState> {
  await page.waitForTimeout(500)
  return page.evaluate<TrState>('({ wrapped: window.__hbTr.wrapped, passes: window.__hbTr.passes })')
}

/** A button by name, case-insensitive (a translated page shouts). */
const tb = (page: Page, name: RegExp): Locator => page.getByRole('button', { name })

const bodyText = (page: Page): Promise<string> => page.locator('body').innerText()

interface TrCheck {
  readonly what: string
  readonly expected: string
  readonly observed: string
  readonly ok: boolean
  readonly shot?: string
}

/** From the start page to the ready screen on a translated page. */
async function toReadyTranslated(page: Page, shots: Shots, checks: TrCheck[], url: string): Promise<void> {
  await page.goto(url)
  await expect(h1(page)).toHaveText(/humanbench/i)
  const t0 = await translated(page)
  checks.push({ what: 'welcome: the simulated translation ran', expected: 'wrapped > 0', observed: `wrapped ${t0.wrapped}, passes ${t0.passes}`, ok: t0.wrapped > 0, shot: (await shots.all('welcome')).png })
  await tb(page, /^start$/i).click()
  await expect(h1(page)).toHaveText(/before you start/i)
  await translated(page)
  // The error path: the alert appears (new nodes), then goes when the box is ticked.
  await tb(page, /^continue$/i).click()
  const alert = page.getByRole('alert')
  await expect(alert).toBeVisible()
  await translated(page)
  const alertText = (await alert.innerText()).trim()
  checks.push({ what: 'gate: the "tick the box" alert after translation', expected: 'the alert text is shown once, translated', observed: alertText, ok: /TICK THE BOX/.test(alertText), shot: (await shots.all('gate-error')).png })
  await page.getByRole('checkbox', { name: /18 or older/i }).check()
  await tb(page, /^continue$/i).click()
  await expect(h1(page)).toHaveText(/honour code/i)
  await translated(page)
  await shots.all('honour')
  await page.getByRole('checkbox', { name: /honour code/i }).check()
  await tb(page, /^continue$/i).click()
  await expect(h1(page)).toHaveText(/check your device/i)
  await expect(tb(page, /^continue$/i)).toBeEnabled({ timeout: 20_000 })
  await translated(page)
  const device = await bodyText(page)
  checks.push({
    what: 'device: the "Checking your screen…" placeholder is gone once the facts are in',
    expected: 'no "checking your screen" text left on the page',
    observed: /checking your screen/i.test(device) ? 'the placeholder text is still on the page next to the facts' : 'gone',
    ok: !/checking your screen/i.test(device),
    shot: (await shots.all('device')).png,
  })
  await page.getByRole('radio', { name: /^keyboard$/i }).check()
  await tb(page, /^continue$/i).click()
  await expect(h1(page)).toHaveText(/ready when you are/i)
  await translated(page)
  await shots.all('ready')
}

/** Answer whatever item is on screen (choice or typed) on a translated page, up to the confidence slider. */
async function answerTranslated(page: Page): Promise<void> {
  const choice = page.locator('form.choice')
  const entry = page.locator('form.entry')
  const slider = page.getByRole('slider')
  await expect(choice.or(entry).first()).toBeVisible()
  if ((await choice.count()) > 0) {
    await choice.getByRole('radio').first().check()
    await tb(page, /^confirm$/i).click()
  } else {
    const box = entry.locator('input')
    await box.fill((await box.evaluate((el) => el.classList.contains('letter'))) ? 'A' : '1')
    await box.press('Enter')
  }
  await expect(slider).toBeVisible()
}

test('nonnative: translation flow', async ({ page }) => {
  const log = trackConsole(page)
  const shots = new Shots(page, RUN(), 'translate-flow')
  const checks: TrCheck[] = []
  await page.addInitScript(TRANSLATE_INIT)
  await toReadyTranslated(page, shots, checks, './?fast=1')

  // Practice: a counter that is re-set in place ("Practice question 1 of 4" -> "2 of 4").
  await tb(page, /try practice questions first/i).click()
  await expect(h1(page)).toHaveText(/^practice$/i)
  await translated(page)
  const counter = page.getByRole('status').filter({ hasText: /practice question/i })
  const counter1 = (await counter.innerText().catch(() => '')).trim()
  await answerTranslated(page)
  await translated(page)
  // The confidence value next to the slider is re-set in place ("50%" -> "80%").
  const out = page.locator('output.value')
  const before = (await out.innerText()).trim()
  await page.getByRole('slider').fill('80')
  await page.waitForTimeout(300)
  const after = (await out.innerText()).trim()
  checks.push({ what: 'practice confidence: the value next to the slider follows the slider', expected: '80%', observed: `before ${before}, after moving the slider to 80: ${after}`, ok: /80/.test(after), shot: (await shots.all('practice-confidence')).png })
  await tb(page, /^continue$/i).click()
  await expect(page.getByText(/that was (not )?correct/i)).toBeVisible()
  await translated(page)
  await shots.all('practice-feedback')
  await tb(page, /next practice question/i).click()
  await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
  await translated(page)
  const counter2 = (await counter.innerText().catch(() => '')).trim()
  const practiceBody = await bodyText(page)
  checks.push({
    what: 'practice: the question counter after "Next practice question"',
    expected: 'Practice question 2 of 4',
    observed: `first: "${counter1}"; after Next: "${counter2}"${/1 of 4/i.test(practiceBody) && /2 of 4/i.test(practiceBody) ? ' (both 1 of 4 and 2 of 4 are on the page)' : ''}`,
    ok: /2 of 4/i.test(counter2),
    shot: (await shots.all('practice-2')).png,
  })
  await tb(page, /^back$/i).click()
  // Back from a practice question lands on "Practice complete" first (its own Back goes to the ready screen).
  await expect(h1(page)).toHaveText(/ready when you are|practice complete/i)
  if (/practice complete/i.test((await h1(page).innerText()).trim())) {
    await translated(page)
    await shots.all('practice-complete')
    await tb(page, /^back$/i).click()
  }
  await expect(h1(page)).toHaveText(/ready when you are/i)

  // The session: skip the reaction tasks, answer two items of Matrix & Series, finish early.
  await tb(page, /^begin$/i).click()
  await expect(h1(page)).toHaveText(/up next: reaction time/i)
  await translated(page)
  await shots.all('interstitial')
  await tb(page, /skip this part/i).click()
  await page.locator('section.confirm').getByRole('button', { name: /^skip /i }).click()
  await expect(h1(page)).toHaveText(/up next: matrix & series/i)
  await translated(page)
  const skippedNotice = await bodyText(page)
  checks.push({ what: 'interstitial 2: the "Reaction Time skipped" notice', expected: 'shown once', observed: `${(skippedNotice.match(/skipped\. it will show as not measured/gi) ?? []).length} occurrence(s)`, ok: (skippedNotice.match(/skipped\. it will show as not measured/gi) ?? []).length === 1 })
  await tb(page, /^start$/i).click()
  await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
  await translated(page)
  await shots.all('item-1')
  const terms1 = (await page.locator('ol.terms').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
  await answerTranslated(page)
  await translated(page)
  await shots.all('item-1-confidence')
  await tb(page, /^continue$/i).click()
  await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
  await translated(page)
  const forms = await page.locator('form.choice, form.entry').count()
  const terms2 = (await page.locator('ol.terms').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
  checks.push({ what: 'item 2: exactly one item on screen, with its own terms', expected: '1 form; terms differ from item 1', observed: `${forms} form(s); item 1 terms "${terms1}"; item 2 terms "${terms2}"`, ok: forms === 1 && terms1 !== terms2, shot: (await shots.all('item-2')).png })
  await tb(page, /finish early/i).click()
  await tb(page, /^finish now$/i).click()
  await expect(h1(page)).toHaveText(/session complete/i)
  await expect(page.locator('.reveal [role="status"]').first()).toHaveText(/your profile is ready/i, { timeout: 30_000 })
  await translated(page)
  await shots.all('results')
  checks.push({ what: 'whole flow: uncaught page errors', expected: 'none', observed: log.pageErrors.length === 0 ? 'none' : log.pageErrors.join(' | ').slice(0, 500), ok: log.pageErrors.length === 0 })
  checks.push({ what: 'whole flow: console errors', expected: 'none', observed: log.errors.length === 0 ? 'none' : log.errors.join(' | ').slice(0, 500), ok: log.errors.length === 0 })
  shots.json('checks', { checks, console: log })
  for (const c of checks) console.log(`[nonnative translate] ${c.ok ? 'ok  ' : 'FAIL'} ${c.what}: ${c.observed}`)
})

test('nonnative: translation results', async ({ page }) => {
  const log = trackConsole(page)
  const shots = new Shots(page, RUN(), 'translate-results')
  const checks: TrCheck[] = []
  const sim = simulatedSave(1)
  await page.addInitScript(TRANSLATE_INIT)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await toReadyTranslated(page, shots, checks, './')
  await page.getByLabel(/^save file$/i).setInputFiles({ name: 'humanbench-save.txt', mimeType: 'text/plain', buffer: Buffer.from(JSON.stringify(sim.save)) })
  await tb(page, /^load$/i).click()
  await expect(page.getByText(/loaded \d+ earlier session/i)).toBeVisible()
  await tb(page, /^begin$/i).click()
  await expect(h1(page)).toHaveText(/up next: reaction time/i)
  await tb(page, /finish early/i).click()
  await tb(page, /^finish now$/i).click()
  await expect(h1(page)).toHaveText(/session complete/i)
  await expect(tb(page, /download save file/i)).toBeVisible({ timeout: 30_000 })
  await translated(page)
  await shots.all('results')
  // A drill-down and the bar view: state changes after the translation.
  await page.getByRole('button', { name: /^speed$/i }).click()
  await expect(page.locator('section.facet-panel')).toBeVisible()
  await translated(page)
  await shots.all('results-drilldown')
  await page.getByRole('button', { name: /bar view/i }).click()
  const bars = await page
    .locator('svg.lollipop')
    .first()
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false)
  await translated(page)
  checks.push({ what: 'results: the bar view opens after translation', expected: 'the bar view is drawn', observed: bars ? 'drawn' : 'not drawn', ok: bars, shot: (await shots.all('results-bars')).png })
  await page.getByRole('button', { name: /blob view/i }).click()
  // The save and the share card: a count that is re-set in place ("7 skills are on the card." -> "6 ...").
  await tb(page, /download save file/i).click()
  await expect(page.locator('[data-share-card]')).toBeVisible()
  await expect(page.locator('img[data-preview]')).toBeVisible()
  await translated(page)
  await shots.all('results-saved')
  const count = page.locator('[data-share-card] [data-count]')
  const countBefore = (await count.innerText()).trim()
  await page.locator('[data-share-card]').getByRole('checkbox').first().uncheck()
  await page.waitForTimeout(400)
  const countAfter = (await count.innerText()).trim()
  checks.push({ what: 'share card: the skills-on-the-card count after unticking one', expected: 'one fewer than before', observed: `before "${countBefore}", after "${countAfter}"`, ok: countBefore !== countAfter, shot: (await shots.all('share-card-untick')).png })
  const downloaded = (await bodyText(page)).match(/save file downloaded/gi) ?? []
  checks.push({ what: 'results: the "Save file downloaded." status', expected: 'shown once', observed: `${downloaded.length} occurrence(s)`, ok: downloaded.length === 1 })
  // What is marked as not to be translated.
  const audit = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    htmlTranslate: document.documentElement.getAttribute('translate'),
    translateNo: [...document.querySelectorAll('[translate="no"]')].map((e) => `${e.tagName.toLowerCase()} "${(e.textContent ?? '').trim().slice(0, 40)}"`),
    notranslate: document.querySelectorAll('.notranslate').length,
    metaNotranslate: document.querySelector('meta[name="google"][content="notranslate"]') !== null,
    brandH1: document.querySelector('h1')?.textContent?.trim() ?? '',
  }))
  checks.push({ what: 'translate="no" marks (brand, codes, key names)', expected: 'the brand and anything that must stay as typed are marked', observed: JSON.stringify(audit), ok: audit.translateNo.length > 0 })
  checks.push({ what: 'results: uncaught page errors', expected: 'none', observed: log.pageErrors.length === 0 ? 'none' : log.pageErrors.join(' | ').slice(0, 500), ok: log.pageErrors.length === 0 })
  checks.push({ what: 'results: console errors', expected: 'none', observed: log.errors.length === 0 ? 'none' : log.errors.join(' | ').slice(0, 500), ok: log.errors.length === 0 })
  shots.json('checks', { checks, console: log })
  for (const c of checks) console.log(`[nonnative translate] ${c.ok ? 'ok  ' : 'FAIL'} ${c.what}: ${c.observed}`)
})

// ------------------------------------------------------------------------------------------------ 4. text expansion

const WIDE_FONT_INIT = `(() => {
  const add = () => {
    if (document.getElementById(${JSON.stringify(WIDE_FONT_STYLE_ID)}) || !document.head) return
    const s = document.createElement('style')
    s.id = ${JSON.stringify(WIDE_FONT_STYLE_ID)}
    s.textContent = ${JSON.stringify(WIDE_FONT_CSS)}
    document.head.appendChild(s)
  }
  add()
  document.addEventListener('readystatechange', add)
})()`

const EXPAND_ROUTES = ['welcome', 'gate', 'honour', 'device', 'ready', 'item-matrix-series', 'confidence', 'quant-item', 'results', 'results-saved']

test('nonnative: expansion', async ({ context }) => {
  await context.addInitScript(WIDE_FONT_INIT)
  const entries = await tour(context, { runId: RUN(), sub: 'expand', routes: EXPAND_ROUTES, widths: [390, 1280], schemes: ['light'], textZoom: 200, metrics: true })
  for (const e of entries) {
    for (const [key, m] of Object.entries(e.metrics)) {
      console.log(`[nonnative expand] ${e.route} ${key}: overflowX ${m.overflowX.px}px ${m.overflowX.culprits.slice(0, 3).join(' | ')}; clipped ${m.clipped.length} ${m.clipped.slice(0, 3).join(' | ')}; maxLine ${m.maxLineChars}`)
    }
    if (!e.ok) console.log(`[nonnative expand] ${e.route} FAILED: ${e.error ?? ''}`)
  }
  expect(entries.length).toBe(EXPAND_ROUTES.length)
})

// Keep the ConsoleLog type in use for the json files' shape (the lib exports it; a reader of probe.json sees the same keys).
export type ProbeFile = { readonly items: ItemProbe[]; readonly console: ConsoleLog }
