/// <reference lib="dom" />
/**
 * Verification package (run id `verify`), render area: the original scenarios of UX-019 to UX-027 (UX-002 and UX-017b
 * are in verify-session.ux.ts, with the screens they share) on the FIXED build. Evidence under
 * web/test-results/ux-review/verify/<item id>/.
 *
 *   UX_REUSE=1 UX_PORT=4653 UX_RUN=verify npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/verify-render.ux.ts --project=chromium
 */

import { expect, test, type Locator, type Page } from '@playwright/test'
import { button, h1 } from '../../e2e/flow'
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
    return `${el.tagName.toLowerCase()}${el.getAttribute('type') ? `[${el.getAttribute('type')}]` : ''} "${label.replace(/\s+/g, ' ').trim().slice(0, 60)}"${(el as HTMLButtonElement).disabled ? ' (disabled)' : ''}`
  })

interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

async function rectsOf(page: Page, selector: string): Promise<Rect[]> {
  return page.evaluate<Rect[]>(`[...document.querySelectorAll(${JSON.stringify(selector)})].map((el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left * 10) / 10, y: Math.round(b.top * 10) / 10, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 } })`)
}

async function press(touch: boolean, target: Locator): Promise<void> {
  if (touch) await target.tap()
  else await target.click()
}

// ------------------------------------------------------------------------------------------------ UX-019

test('verify UX-019 reading questions: Enter never submits, blanks are asked about', async ({ page, browserName }, testInfo) => {
  test.skip(testInfo.project.use.hasTouch === true, 'keyboard scenario')
  const chord = await chordFor(page, browserName)
  const shots = new Shots(page, RUN, `UX-019/${testInfo.project.name}`)
  const log = trackConsole(page)
  const facts: Record<string, unknown> = { project: testInfo.project.name, chord }
  await open(page, 'reading-questions')
  const reading = page.locator('section.hb-render.reading')
  facts['intro text'] = await reading.locator('.hb-instructions').allInnerTexts().catch(() => [])
  facts['questions'] = await reading.locator('fieldset.question').count()
  await page.waitForTimeout(400)
  facts['count line at arrival'] = await reading.locator('.hb-status').allInnerTexts()
  facts['legends inside frames'] = await page.evaluate(() => [...document.querySelectorAll('section.hb-render.reading fieldset.question')].map((f) => { const l = f.querySelector('legend'); return l ? l.getBoundingClientRect().top >= f.getBoundingClientRect().top - 1 : null }))
  // Enter on the first option of question 1.
  const first = reading.locator('fieldset.question').first().locator('input[type=radio]').first()
  await first.focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  facts['after Enter on Q1 option'] = { focus: await what(page), questionsStillThere: await reading.locator('fieldset.question').count(), blockComplete: (await reading.locator('.hb-status').allInnerTexts()).join(' | '), focusInQuestion: await page.evaluate(() => { const q = document.activeElement?.closest('fieldset.question'); const all = [...document.querySelectorAll('section.hb-render.reading fieldset.question')]; return q ? all.indexOf(q) + 1 : null }) }
  await shots.shot('after-enter-on-q1', { fullPage: false })
  // Submit with questions still blank: asks once, a second press submits.
  const submit = reading.getByRole('button', { name: 'Submit answers' })
  await submit.focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  facts['after Submit with blanks'] = { alert: await reading.locator('[role=alert]').allInnerTexts(), questionsStillThere: await reading.locator('fieldset.question').count(), focus: await what(page) }
  await shots.shot('after-submit-with-blanks', { fullPage: false })
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  facts['after second Submit'] = { questionsStillThere: await reading.locator('fieldset.question').count(), status: await reading.locator('.hb-status').allInnerTexts().catch(() => []), h1: (await h1(page).innerText().catch(() => '')).trim() }
  await shots.shot('after-second-submit', { fullPage: false })
  // Tab order on a fresh set: Enter on the last question's option goes to Submit.
  await open(page, 'reading-questions')
  const groups = reading.locator('fieldset.question')
  const n = await groups.count()
  for (let i = 0; i < n; i++) {
    await groups.nth(i).locator('input[type=radio]').first().focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(150)
    facts[`Enter on Q${i + 1} -> focus`] = await what(page)
  }
  facts['all answered, one Enter on Submit ends the block'] = await (async () => {
    if (!/Submit answers/.test(await what(page))) await submit.focus()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    return (await reading.locator('fieldset.question').count()) === 0
  })()
  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[verify UX-019] ${JSON.stringify(facts)}`)
})

// ------------------------------------------------------------------------------------------------ UX-020 / UX-021

test('verify UX-020 UX-021 matrix option scale, one primary style, focus ring', async ({ page, browserName }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `UX-020-021/${testInfo.project.name}`)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  const SIZES = `(() => {
    const grid = [...document.querySelectorAll('.matrix .grid svg')].map((s) => Math.round(s.getBoundingClientRect().width * 10) / 10)
    const opts = [...document.querySelectorAll('.matrix form.choice .options svg, form.choice .options svg')].map((s) => Math.round(s.getBoundingClientRect().width * 10) / 10)
    const g = document.querySelector('.matrix .grid'), o = document.querySelector('form.choice .options')
    const gb = g ? g.getBoundingClientRect() : null, ob = o ? o.getBoundingClientRect() : null
    const confirm = [...document.querySelectorAll('form.choice button')].find((b) => /Confirm/.test(b.textContent || ''))
    const cs = confirm ? getComputedStyle(confirm) : null
    return { gridCells: grid, optionCells: opts, ratio: grid[0] && opts[0] ? Math.round((opts[0] / grid[0]) * 100) / 100 : null, gridLeft: gb ? Math.round(gb.left) : null, optionsLeft: ob ? Math.round(ob.left) : null, gridWidth: gb ? Math.round(gb.width) : null, optionsWidth: ob ? Math.round(ob.width) : null, confirm: confirm ? { classes: confirm.className, bg: cs.backgroundColor, color: cs.color, disabled: confirm.disabled, opacity: cs.opacity } : null }
  })()`
  const widths = touch ? [page.viewportSize()?.width ?? 390] : [1280, 768, 390, 320]
  for (const w of widths) {
    if (!touch) await page.setViewportSize({ width: w, height: 900 })
    await open(page, 'practice')
    // The practice route lands on a matrix or series item; find a matrix within the practice questions.
    for (let i = 0; i < 6 && (await page.locator('.matrix').count()) === 0; i++) {
      const stop = page.getByRole('button', { name: 'Stop practice' })
      if ((await stop.count()) === 0) break
      // Answer the typed item and go on to the next question.
      const box = page.locator('form.entry input[type=text]')
      if ((await box.count()) > 0) {
        await box.fill((await box.evaluate((el) => el.classList.contains('letter'))) ? 'A' : '1')
        await press(touch, page.locator('form.entry').getByRole('button', { name: 'Submit', exact: true }))
      } else if ((await page.locator('form.choice').count()) > 0) {
        await press(touch, page.locator('form.choice').getByRole('radio').first())
        await press(touch, button(page, 'Confirm'))
      } else break
      await expect(page.getByRole('slider')).toBeVisible()
      await press(touch, button(page, 'Continue'))
      await expect(page.getByText(/That was (not )?correct\./)).toBeVisible()
      const next = button(page, 'Next practice question')
      if ((await next.count()) === 0) break
      await press(touch, next)
      await page.waitForTimeout(300)
    }
    if ((await page.locator('.matrix').count()) === 0) {
      facts[`${w}`] = 'no matrix item reached in practice'
      continue
    }
    await page.waitForTimeout(200)
    facts[`${w} sizes`] = await page.evaluate(SIZES)
    await shots.shot(`${w}-matrix`, { fullPage: true })
    if (!touch && w === 1280) {
      const chord = await chordFor(page, browserName)
      // Focus ring on an option card vs on a plain button.
      await page.locator('form.choice input[type=radio]').first().focus()
      await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(100)
      facts['1280 option focus ring'] = await page.evaluate(() => { const el = document.activeElement; const card = el?.nextElementSibling; const cs = card ? getComputedStyle(card) : null; const lcs = el?.closest('label') ? getComputedStyle(el.closest('label') as Element) : null; return { active: el?.tagName, cardOutline: cs ? `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}` : null, cardBoxShadow: cs ? cs.boxShadow.slice(0, 120) : null, labelOutline: lcs ? `${lcs.outlineWidth} ${lcs.outlineStyle} ${lcs.outlineColor}` : null } })
      await shots.shot('1280-option-focus', { fullPage: false })
      await page.keyboard.press(chord)
      await page.waitForTimeout(100)
      facts['1280 next focus'] = { what: await what(page), outline: await page.evaluate(() => { const el = document.activeElement; const cs = el ? getComputedStyle(el) : null; return cs ? `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}` : null }) }
      await shots.shot('1280-confirm-focus', { fullPage: false })
      facts['1280 other primary (Stop practice is secondary; Continue on confidence is primary)'] = await page.evaluate(() => [...document.querySelectorAll('button.hb-primary')].map((b) => ({ text: (b.textContent ?? '').trim(), bg: getComputedStyle(b).backgroundColor, classes: b.className })))
      facts['1280 focus ring token'] = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--r-focus').trim())
    }
  }
  if (touch) {
    // A double tap on the confidence Continue: the second tap must not pre-select an option of the next item.
    await page.goto('./favicon.svg')
    await page.evaluate('localStorage.clear(); sessionStorage.clear()')
    const driver = new SessionDriver(page, { touch: true })
    await driver.toReady('./?fast=1')
    await driver.begin()
    await driver.skipPart()
    await driver.press(button(page, 'Start'))
    await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
    const results: unknown[] = []
    for (let k = 0; k < 2; k++) {
      const choice = page.locator('form.choice')
      if ((await choice.count()) > 0) {
        await choice.getByRole('radio').first().tap()
        await button(page, 'Confirm').tap()
      } else {
        const box = page.locator('form.entry input[type=text]')
        await box.fill((await box.evaluate((el) => el.classList.contains('letter'))) ? 'A' : '1')
        await page.locator('form.entry').getByRole('button', { name: 'Submit', exact: true }).tap()
      }
      await expect(page.getByRole('slider')).toBeVisible()
      const c = button(page, 'Continue')
      await c.scrollIntoViewIfNeeded()
      const b = await c.boundingBox()
      if (b === null) throw new Error('no Continue')
      const x = b.x + b.width / 2, y = b.y + b.height / 2
      await page.touchscreen.tap(x, y)
      await page.waitForTimeout(60)
      await page.touchscreen.tap(x, y)
      await page.waitForTimeout(500)
      results.push({ screen: await driver.screen(), nextItemRadioChecked: await page.locator('form.choice input[type=radio]:checked').count(), nextItemTyped: await page.locator('form.entry input[type=text]').inputValue().catch(() => ''), shot: await shots.shot(`double-tap-continue-${k}`, { fullPage: false }) })
    }
    facts['double tap on Continue'] = results
  }
  shots.json('facts', facts)
  console.log(`[verify UX-020/021] ${JSON.stringify(facts)}`)
})

// ------------------------------------------------------------------------------------------------ UX-022 / UX-025 / UX-026

test('verify UX-022 UX-025 UX-026 stage names, instructions, titles', async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `UX-022-025-026/${testInfo.project.name}`)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  const STAGE = `(() => { const a = document.activeElement; const d = (el) => el ? { tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), name: el.getAttribute('aria-label'), cls: el.className } : null; return { active: d(a), live: [...document.querySelectorAll('[aria-live], [role=status]')].map((el) => ({ cls: typeof el.className === 'string' ? el.className : '', live: el.getAttribute('aria-live'), role: el.getAttribute('role'), text: (el.textContent || '').trim().slice(0, 80) })), translateNo: [...document.querySelectorAll('[translate="no"]')].map((el) => (el.textContent || '').trim().slice(0, 30)).filter((t) => t !== '').slice(0, 20), touchAction: ['.rt .stage', '.corsi .board', '.keypad', '.coding .stage'].map((s) => { const el = document.querySelector(s); return el ? s + ': ' + getComputedStyle(el).touchAction : null }).filter(Boolean) } })()`
  // RT: intro title, the stage on Start practice.
  await open(page, 'rt-intro')
  facts['rt headings'] = { h1: (await h1(page).innerText()).trim(), title: await page.locator('.rt p.title').innerText(), intro: await page.locator('.rt .hb-instructions').innerText().then((t) => t.replace(/\s+/g, ' ')) }
  await press(touch, button(page, 'Start practice'))
  await expect(page.locator('.rt .stage')).toBeVisible()
  await page.waitForTimeout(300)
  facts['rt stage'] = await page.evaluate(STAGE)
  await shots.shot('rt-stage', { fullPage: false })
  // Digit span: the intro text, the stage and the live region on Start.
  await open(page, 'memory-intro')
  facts['span intro'] = { title: await page.locator('.span p.title').innerText(), text: await page.locator('.span .hb-instructions').innerText().then((t) => t.replace(/\s+/g, ' ')), liveBefore: await page.locator('.span .hb-status').evaluate((el) => ({ live: el.getAttribute('aria-live'), text: (el.textContent ?? '').trim() })) }
  await press(touch, page.locator('section.hb-render.span').getByRole('button', { name: 'Start' }))
  await page.waitForTimeout(300)
  facts['span stage'] = await page.evaluate(STAGE)
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 30_000 })
  facts['span entry status'] = await page.locator('.span .hb-status').innerText()
  // Coding: the title, the intro and the stage.
  await open(page, 'coding-intro')
  facts['coding intro'] = { title: await page.locator('.coding p.title').innerText(), legendLabel: await page.locator('.coding .legend').getAttribute('aria-label'), text: await page.locator('.coding .hb-instructions').innerText().then((t) => t.replace(/\s+/g, ' ')) }
  await press(touch, page.locator('section.hb-render.coding').getByRole('button', { name: 'Start' }))
  await expect(page.getByRole('timer')).toBeVisible()
  await page.waitForTimeout(200)
  facts['coding stage'] = await page.evaluate(STAGE)
  facts['coding timer translate'] = await page.getByRole('timer').getAttribute('translate')
  // Series: the prompt, region and field.
  await open(page, 'item-matrix-series')
  facts['matrix-series item'] = { region: await page.locator('section.hb-render.series').getAttribute('aria-label').catch(() => null), prompt: await page.locator('.series p.prompt').innerText().catch(() => null), field: await page.locator('form.entry label').innerText().catch(() => null), sr: await page.locator('.series .hb-sr-only').allInnerTexts().catch(() => []), isMatrix: (await page.locator('.matrix').count()) > 0 }
  // Corsi: the board name.
  await open(page, 'memory-corsi')
  facts['corsi'] = { title: await page.locator('.corsi p.title').innerText(), board: await page.locator('.corsi .board').getAttribute('aria-label'), status: await page.locator('.corsi .hb-status').evaluate((el) => ({ live: el.getAttribute('aria-live'), text: (el.textContent ?? '').trim() })), touchAction: await page.locator('.corsi .board').evaluate((el) => getComputedStyle(el).touchAction) }
  shots.json('facts', facts)
  console.log(`[verify UX-022/025/026] ${JSON.stringify(facts).slice(0, 3000)}`)
})

// ------------------------------------------------------------------------------------------------ UX-023

test('verify UX-023 Corsi blocks 44 px and Done in the first screen', async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `UX-023/${testInfo.project.name}`)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  const viewports = touch ? [page.viewportSize() ?? { width: 390, height: 664 }, { width: 320, height: 568 }] : [{ width: 320, height: 568 }, { width: 390, height: 664 }]
  for (const vp of viewports) {
    await page.setViewportSize(vp)
    const key = `${vp.width}x${vp.height}`
    await open(page, 'memory-corsi')
    await page.waitForTimeout(300)
    const blocks = await rectsOf(page, 'section.hb-render.corsi button.block')
    const overlaps: string[] = []
    for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) { const a = blocks[i]!, b = blocks[j]!; if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps.push(`${i + 1}/${j + 1}`) }
    const board = (await rectsOf(page, 'section.hb-render.corsi .board'))[0] ?? null
    facts[key] = {
      innerHeight: vp.height,
      scrollY: await page.evaluate(() => Math.round(scrollY)),
      h1Top: (await rectsOf(page, 'h1'))[0]?.y ?? null,
      board,
      blocks: blocks.length,
      smallest: Math.min(...blocks.map((b) => Math.min(b.w, b.h))),
      under44: blocks.filter((b) => Math.min(b.w, b.h) < 44).length,
      overlaps,
      insideBoard: board === null ? null : blocks.every((b) => b.x >= board.x - 0.5 && b.y >= board.y - 0.5 && b.x + b.w <= board.x + board.w + 0.5 && b.y + b.h <= board.y + board.h + 0.5),
      done: (await rectsOf(page, 'section.hb-render.corsi button.hb-primary'))[0] ?? null,
      doneInFirstScreen: await page.locator('section.hb-render.corsi button.hb-primary').evaluate((el) => { const r = el.getBoundingClientRect(); return r.bottom + scrollY <= innerHeight }),
      status: await page.locator('.corsi .hb-status').innerText(),
      shot: await shots.shot(`${key}-corsi-viewport`, { fullPage: false }),
    }
    // The same screen without the fast-mode banner (a dev-only strip the route needs; production has none): the h1 at the top.
    await page.addStyleTag({ content: '.banner[role=note] { display: none !important; }' })
    await page.evaluate(() => scrollTo(0, 0))
    await page.waitForTimeout(200)
    facts[`${key} without dev banner, page at top`] = {
      h1Top: (await rectsOf(page, 'h1'))[0]?.y ?? null,
      board: (await rectsOf(page, 'section.hb-render.corsi .board'))[0] ?? null,
      done: (await rectsOf(page, 'section.hb-render.corsi button.hb-primary'))[0] ?? null,
      doneInFirstScreen: await page.locator('section.hb-render.corsi button.hb-primary').evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight),
      shot: await shots.shot(`${key}-corsi-no-banner-viewport`, { fullPage: false }),
    }
    // After a sequence: Done pressed, next sequence plays; is the board where it was?
    const before = (await rectsOf(page, 'section.hb-render.corsi .board'))[0] ?? null
    for (const k of [0, 1, 2]) await press(touch, page.locator('section.hb-render.corsi button.block').nth(k))
    await press(touch, page.locator('section.hb-render.corsi').getByRole('button', { name: 'Done' }))
    await page.waitForTimeout(600)
    facts[`${key} after Done (no banner)`] = { scrollY: await page.evaluate(() => Math.round(scrollY)), board: (await rectsOf(page, 'section.hb-render.corsi .board'))[0] ?? null, boardMoved: JSON.stringify(before) !== JSON.stringify((await rectsOf(page, 'section.hb-render.corsi .board'))[0] ?? null), shot: await shots.shot(`${key}-after-done-viewport`, { fullPage: false }) }
  }
  shots.json('facts', facts)
  console.log(`[verify UX-023] ${JSON.stringify(facts)}`)
})

// ------------------------------------------------------------------------------------------------ UX-024

test('verify UX-024 number entry: digits, decimal point, integer rule', async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `UX-024/${testInfo.project.name}`)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  await open(page, 'quant-item')
  const entry = page.locator('form.entry')
  const box = entry.locator('input[type=text]')
  const note = entry.locator('.hb-note')
  const probe = async (label: string, text: string): Promise<void> => {
    await box.fill('')
    await box.type(text)
    await page.waitForTimeout(150)
    const value = await box.inputValue()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    const submitted = (await entry.locator('.hb-status').innerText().catch(() => '')).trim() !== '' || (await page.getByRole('slider').count()) > 0
    facts[label] = { typed: text, valueInBox: value, note: (await note.innerText().catch(() => '')).trim(), submitted, hint: (await entry.locator('.hint').innerText().catch(() => '')).trim() }
    if (submitted) {
      await shots.shot(`${label.replace(/\W+/g, '-')}-submitted`, { fullPage: false })
      // Go on to the next item for the next probe.
      await expect(page.getByRole('slider')).toBeVisible()
      await press(touch, button(page, 'Continue'))
      await expect(entry).toBeVisible()
    }
  }
  facts['item 1'] = { hint: (await entry.locator('.hint').innerText()).trim(), inputmode: await box.getAttribute('inputmode'), width: (await rectsOf(page, 'form.entry input[type=text]'))[0]?.w ?? null, keys: await entry.locator('.row button').allInnerTexts(), keyLabels: await entry.locator('.row button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label'))), stem: (await page.locator('.quant .stem').innerText().catch(() => '')).slice(0, 160) }
  await shots.shot('quant-item-1', { fullPage: false })
  await probe('Arabic-Indic digits', '٣٥')
  await probe('full-width digits', '１２')
  await probe('grouped digits', '1 000')
  await probe('decimal with comma', '3,5')
  await probe('decimal with point', '3.5')
  // A decimal-comma locale (de-DE) on a desktop: is the point key offered?
  if (!touch) {
    const ctx = await page.context().browser()?.newContext({ locale: 'de-DE', baseURL: testInfo.project.use.baseURL })
    if (ctx) {
      const p2 = await ctx.newPage()
      await open(p2, 'quant-item')
      facts['de-DE desktop keys'] = await p2.locator('form.entry .row button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')))
      await ctx.close()
    }
  } else {
    facts['touch keys (coarse pointer)'] = await entry.locator('.row button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')))
  }
  shots.json('facts', facts)
  console.log(`[verify UX-024] ${JSON.stringify(facts)}`)
})

// ------------------------------------------------------------------------------------------------ UX-027

test('verify UX-027 shared render CSS: gaps, accent colour, print tokens', async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.hasTouch === true, 'desktop only (print emulation)')
  const shots = new Shots(page, RUN, `UX-027/${testInfo.project.name}`)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  await page.setViewportSize({ width: 390, height: 844 })
  const GAPS = `[...document.querySelectorAll('.hb-actions')].map((row) => { const next = row.nextElementSibling; if (!next) return null; const rb = row.getBoundingClientRect(), nb = next.getBoundingClientRect(); return { after: (next.textContent || '').trim().slice(0, 40), gap: Math.round(nb.top - rb.bottom), rowMargin: getComputedStyle(row).marginBottom } }).filter(Boolean)`
  await page.goto('./')
  facts['welcome gaps'] = await page.evaluate(GAPS)
  await open(page, 'ready')
  facts['ready gaps'] = await page.evaluate(GAPS)
  await open(page, 'practice-feedback')
  facts['practice feedback gaps'] = await page.evaluate(GAPS)
  await open(page, 'device')
  facts['device accent'] = await page.evaluate(() => { const r = document.querySelector('input[type=radio]'); const root = document.querySelector('.hb-render'); return { radioAccent: r ? getComputedStyle(r).accentColor : null, renderAccent: root ? getComputedStyle(root).accentColor : null, primaryBg: (() => { const b = document.querySelector('button.hb-primary'); return b ? getComputedStyle(b).backgroundColor : null })() } })
  await shots.shot('device-390', { fullPage: false })
  await open(page, 'gate')
  facts['gate accent'] = await page.evaluate(() => { const r = document.querySelector('input[type=checkbox]'); return r ? getComputedStyle(r).accentColor : null })
  // Print with a dark OS: the render tokens stay light.
  await page.setViewportSize({ width: 1280, height: 900 })
  await open(page, 'results-saved')
  await page.emulateMedia({ media: 'print', colorScheme: 'dark' })
  await page.waitForTimeout(300)
  facts['print dark render tokens'] = await page.evaluate(() => { const el = document.querySelector('.hb-render, .hb-reveal') ?? document.body; const cs = getComputedStyle(el); return { rFg: cs.getPropertyValue('--r-fg').trim(), rBg: cs.getPropertyValue('--r-bg').trim(), rSurface: cs.getPropertyValue('--r-surface').trim(), bodyColor: getComputedStyle(document.body).color, bodyBg: getComputedStyle(document.body).backgroundColor, button: (() => { const b = document.querySelector('button.hb-btn'); return b ? { color: getComputedStyle(b).color, bg: getComputedStyle(b).backgroundColor } : null })() } })
  await shots.shot('print-dark-os', { fullPage: false })
  await page.emulateMedia({ media: 'screen', colorScheme: 'dark' })
  await page.waitForTimeout(300)
  facts['screen dark render tokens'] = await page.evaluate(() => { const el = document.querySelector('.hb-render, .hb-reveal') ?? document.body; const cs = getComputedStyle(el); return { rFg: cs.getPropertyValue('--r-fg').trim(), rBg: cs.getPropertyValue('--r-bg').trim(), bodyColor: getComputedStyle(document.body).color, bodyBg: getComputedStyle(document.body).backgroundColor } })
  shots.json('facts', facts)
  console.log(`[verify UX-027] ${JSON.stringify(facts)}`)
})

// ------------------------------------------------------------------------------------------------ phone metrics of the item screens (regression spot check)

test('verify render phone metrics', async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.hasTouch !== true, 'phone only')
  const shots = new Shots(page, RUN, `render-phone/${testInfo.project.name}`)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  for (const id of ['rt-trial', 'memory-entry', 'coding-running', 'quant-item', 'reading-questions']) {
    await open(page, id)
    await page.waitForTimeout(300)
    const m = await pageMetrics(page, { touch: true, axe: true })
    facts[id] = { overflowX: m.overflowX.px, clipped: m.clipped, smallTargets: m.smallTargets.filter((t) => !t.inline).map((t) => `${t.role} "${t.name}" ${t.size.w}x${t.size.h}`), smallInputFont: m.smallInputFont, axeSerious: m.axe?.serious.map((v) => `${v.id} x${v.nodes}`), shot: await shots.shot(id, { fullPage: false }) }
  }
  shots.json('facts', facts)
  console.log(`[verify render phone] ${JSON.stringify(facts)}`)
})

// ------------------------------------------------------------------------------------------------ UX-024b: the decimal point key

test('verify UX-024b decimal point key on a decimal item (coarse pointer or comma locale)', async ({ page, browser }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `UX-024b/${testInfo.project.name}`)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  /** Play quant items until one asks for a decimal, then read its keys. */
  const probe = async (p: Page, label: string): Promise<void> => {
    await open(p, 'quant-item')
    const entry = p.locator('form.entry')
    for (let i = 0; i < 14; i++) {
      const hint = (await entry.locator('.hint').innerText().catch(() => '')).trim()
      if (/decimal/i.test(hint)) {
        const keys = await entry.locator('.row button').evaluateAll((bs) => bs.map((b) => `${b.getAttribute('aria-label') ?? (b.textContent ?? '').trim()}`))
        const box = entry.locator('input[type=text]')
        await box.fill('3')
        const point = entry.getByRole('button', { name: 'Decimal point' })
        if ((await point.count()) > 0) await (touch ? point.tap() : point.click())
        await box.type('5')
        facts[label] = { itemsPlayed: i, hint, inputmode: await box.getAttribute('inputmode'), keys, pointKey: (await point.count()) > 0, valueAfterPointKey: await box.inputValue(), coarse: await p.evaluate(() => matchMedia('(pointer: coarse)').matches), language: await p.evaluate(() => navigator.language), decimalSeparator: await p.evaluate(() => (1.5).toLocaleString().replace(/\d/g, '')), shot: await new Shots(p, RUN, `UX-024b/${testInfo.project.name}`).shot(`${label}-decimal-item`, { fullPage: false }) }
        return
      }
      const box = entry.locator('input[type=text]')
      await box.fill('1')
      await (touch ? entry.getByRole('button', { name: 'Submit', exact: true }).tap() : entry.getByRole('button', { name: 'Submit', exact: true }).click())
      await expect(p.getByRole('slider')).toBeVisible()
      await (touch ? button(p, 'Continue').tap() : button(p, 'Continue').click())
      if ((await entry.count()) === 0) break
    }
    facts[label] = 'no decimal item in 14 quant items'
  }
  await probe(page, touch ? 'touch (coarse pointer)' : 'desktop en-US')
  if (!touch) {
    const ctx = await browser.newContext({ locale: 'de-DE', baseURL: testInfo.project.use.baseURL })
    const p2 = await ctx.newPage()
    await probe(p2, 'desktop de-DE')
    await ctx.close()
  }
  shots.json('facts', facts)
  console.log(`[verify UX-024b] ${JSON.stringify(facts)}`)
})
