/// <reference lib="dom" />
/**
 * uxdec verification, the owner decisions of 2026-10-05 (UX-REVIEW §2): D1 (privacy notice), D2 (the overlap sentence),
 * D5 (clock, break, budgets), D10 (paper, calculators, AI chatbots), and D3 left unchanged. Each test replays the
 * scenario of its UX-REVIEW entry on the production build, records facts and screenshots under
 * web/test-results/ux-review/uxdec-verify/<item>/<project>/ and asserts only what it needs to go on.
 *
 *   UX_PORT=4761 UX_RUN=uxdec-verify UX_DIST=test-results/ux-review/uxdec-verify/_dist \
 *     npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/uxdec-verify-owner.ux.ts --project=chromium
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { PEAKS_NONE } from '../../src/reveal/copy'
import { BREAK_OFFER_TEXT, HONOUR_TOOLS, INTERSTITIAL_CLOCK } from '../../src/session/copy'
import { SERVER_QUERY } from '../../e2e/fake-server'
import { button, h1, scheme, toResults } from '../../e2e/flow'
import { setTextZoomNow } from '../../e2e/layout'
import { toHonour, toInterstitial } from '../../e2e/routes'
import { SessionDriver } from '../../e2e/session-driver'
import { pageMetrics, playJourney, REPO_ROOT, Shots, trackConsole } from '../lib'
import { aboutMin, bodyText, buttonsOf, download, Facts, fresh, localDateStamp, press, RUN, ringMinutes, ringText, settle } from './uxdec-verify-shared.ux'

test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 })

const OLD_OVERLAP = 'Ranges that overlap are not real differences'
const NEW_OVERLAP = 'Where ranges overlap, a difference may not be real.'
const BASE_COMMIT = '9f68f49'

/** The privacy notice on screen: the facts every variant must show. */
async function privacyFacts(page: Page, f: Facts, variant: string): Promise<string> {
  await expect(h1(page)).toContainText(/privacy/i)
  const text = await bodyText(page)
  f.check(`${variant}: says no personally identifiable information is collected`, /collects no personally identifiable information/i.test(text))
  f.check(`${variant}: says all responses are anonymous`, /all responses are anonymous/i.test(text))
  f.check(`${variant}: no "TODO" rendered`, !/TODO/.test(text), text.match(/.{0,40}TODO.{0,40}/g) ?? [])
  f.check(`${variant}: no controller or contact placeholder`, !/Controller:|Contact:|TODO\(user\)/.test(text))
  f.check(`${variant}: no draft-terms placeholder`, !/[Dd]raft terms|to be confirmed/.test(text))
  f.check(`${variant}: the page title has no TODO`, !/TODO/.test(await page.title()), await page.title())
  return text
}

async function layoutFacts(page: Page, f: Facts, name: string): Promise<void> {
  const m = await pageMetrics(page, { touch: true })
  f.check(`${name}: no sideways overflow`, m.overflowX.px <= 0, { px: m.overflowX.px, culprits: m.overflowX.culprits.slice(0, 3) })
  f.check(`${name}: no clipped text`, m.clipped.length === 0, m.clipped.slice(0, 5))
  f.check(`${name}: no target under 44 px`, m.smallTargets.filter((t) => !t.inline).length === 0, m.smallTargets.filter((t) => !t.inline).slice(0, 5))
}

// ------------------------------------------------------------------------------------------------ D1

test('uxdec-verify D1: the static privacy notice says no PII and anonymous, shows no TODO, and is true of the static build', async ({ page }, info) => {
  const f = new Facts(page, info, 'D1')
  const log = trackConsole(page)
  const hosts = new Set<string>()
  page.on('request', (r) => {
    try {
      const u = new URL(r.url())
      if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'ws:' || u.protocol === 'wss:') hosts.add(u.host)
    } catch {
      // not a URL the check is about (data:, blob:)
    }
  })
  await page.goto('./#/privacy')
  const text = await privacyFacts(page, f, 'static')
  f.check('static: says nothing is sent to a server', /Nothing is sent to a server/.test(text))
  f.check('static: says answers stay on the device', /answers stay on your device/.test(text))
  f.check('static: names what the web host sees (true line)', /web host that serves these pages sees your network address/.test(text))
  f.check('static: the online version is a plan, consent asked again first', /Before it does, this notice will be updated and you will be asked for your consent again/.test(text))
  f.check('static: no retention or legal-basis claim stated as a present fact', !/legal basis|is the basis/.test(text))
  f.check('static: the honour sentence in the terms (no calculators except where provided)', /no AI tools, search, calculators \(except where provided\), or help/.test(text))
  await f.all('privacy-light')
  await f.axe('privacy light')
  await scheme(page, 'dark')
  await settle(page)
  await f.all('privacy-dark')
  await f.axe('privacy dark')
  await scheme(page, 'light')
  const h = page.viewportSize()?.height ?? 800
  const w = page.viewportSize()?.width ?? 1280
  await page.setViewportSize({ width: 320, height: h })
  await settle(page)
  await layoutFacts(page, f, 'privacy 320 px')
  await f.shot('privacy-320', { fullPage: false })
  await page.setViewportSize({ width: w, height: h })
  await setTextZoomNow(page, 200)
  await settle(page)
  await layoutFacts(page, f, 'privacy 200% text')
  await f.shot('privacy-200pct', { fullPage: false })
  await setTextZoomNow(page, null)

  // "Nothing in the notice is untrue for the static build": the start of a session sends nothing anywhere but the page's own host.
  await page.goto('./')
  const driver = new SessionDriver(page, { touch: f.touch })
  await driver.toReady('./?fast=1')
  await driver.begin()
  await driver.answerOne()
  const own = new URL(page.url()).host
  const foreign = [...hosts].filter((x) => x !== own)
  f.check('static build: every request goes to the page\'s own host (no server, no third party)', foreign.length === 0, { own, foreign })
  const autosaved = await expect
    .poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('hb:save:v1:')).length), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(1)
    .then(() => true)
    .catch(() => false)
  f.check('static build: the session wrote its autosave to this browser ("saved in your browser\'s local storage as you go")', autosaved)
  f.check('console clean on the notice and the start', log.errors.length === 0 && log.pageErrors.length === 0, { errors: log.errors.slice(0, 3), pageErrors: log.pageErrors.slice(0, 3) })
  f.save()
})

test('uxdec-verify D1: the server variant of the notice and the data page show no TODO and the same plain statement', async ({ page }, info) => {
  const f = new Facts(page, info, 'D1-server')
  await page.goto(`./${SERVER_QUERY}#/privacy`)
  const text = await privacyFacts(page, f, 'server')
  f.check('server: stored under a random identifier, not under who you are', /random identifier, not under who you are/.test(text))
  f.check('server: consent named as the basis, 24 months as the plan', /your consent is the basis/.test(text) && /at most 24 months/.test(text))
  f.check('server: deletion names the backups and the archive', /weekly backups within eight weeks/.test(text) && /encrypted archive/.test(text))
  f.check('server: the hashed network address is disclosed', /scrambled \(hashed\) form of your network address/.test(text))
  await f.all('privacy-server')
  await f.axe('server privacy')
  await page.goto(`./${SERVER_QUERY}#/data`)
  await expect(h1(page)).toBeVisible()
  const data = await bodyText(page)
  f.check('data page: no "TODO" rendered', !/TODO/.test(data), data.match(/.{0,40}TODO.{0,40}/g) ?? [])
  f.check('data page: delete text names the backups and the archive', /backups/.test(data) && /archive/.test(data))
  await f.all('data-page-server')
  await f.axe('server data page')
  // The welcome, gate and honour screens of the server variant: no TODO either.
  await page.goto(`./${SERVER_QUERY}`)
  await expect(h1(page)).toHaveText('HumanBench')
  const welcome = await bodyText(page)
  f.check('server welcome: no "TODO"', !/TODO/.test(welcome))
  await button(page, 'Start').click()
  await expect(h1(page)).toHaveText('Before you start')
  const gate = await bodyText(page)
  f.check('server gate: no "TODO"', !/TODO/.test(gate))
  await f.all('gate-server')
  f.save()
})

// ------------------------------------------------------------------------------------------------ D2

test('uxdec-verify D2: the overlap sentence on the share card, the no-peaks note and the results-talk preamble', async ({ page }, info) => {
  const f = new Facts(page, info, 'D2')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const sim = await toResults(page)
  await expect(button(page, 'Download save file')).toBeVisible()
  const results = await bodyText(page)
  f.check('results page: the old sentence appears nowhere', !results.includes(OLD_OVERLAP))
  const noPeaksShown = results.includes(PEAKS_NONE)
  f.check('no-peaks note: the exported wording is the owner\'s option A', PEAKS_NONE === 'No skill stands out clearly from your others yet. That is common after one session: the ranges are still wide.', PEAKS_NONE)
  f.check('no-peaks note on this profile', noPeaksShown ? true : null, { shown: noPeaksShown, peaksOfThisSave: sim.peaks }, noPeaksShown ? undefined : 'this simulated save lists peaks, so the note is not on screen; wording checked from the module')
  await f.all('results-peaks')

  // The save and the share card.
  if (f.touch && info.project.name === 'iphone') {
    await press(true, button(page, 'Download save file'))
  } else {
    const save = await download(page, () => press(f.touch, button(page, 'Download save file')))
    f.check('D19 save file name: local date, hbsave.json', new RegExp(`^humanbench-[0-9A-Za-z]{6}-${localDateStamp()}\\.hbsave\\.json$`).test(save.name), save.name)
  }
  await expect(page.locator('[data-share-card]')).toBeVisible()
  await expect(page.locator('img[data-preview]')).toBeVisible()
  const card = page.locator('[data-share-card]')
  const alt = (await page.locator('img[data-preview]').getAttribute('alt')) ?? ''
  f.check('card preview alt: old sentence absent', !alt.includes(OLD_OVERLAP), alt.slice(0, 200))
  await f.shot('share-card-panel', { locator: card })
  const preamble = await page.getByTestId('preamble').innerText()
  f.check('results-talk preamble carries the new sentence', preamble.includes(NEW_OVERLAP), preamble)
  f.check('results-talk preamble: old sentence absent', !preamble.includes(OLD_OVERLAP))
  f.check('results-talk preamble is 346 characters', preamble.length === 346, preamble.length)
  const talk = await page.getByTestId('results-talk').innerText()
  f.check('D18: "Paste this first." says what comes next', talk.includes('Paste this first. Then describe your results in your own words, or attach your share card picture.'))
  await f.shot('results-talk', { locator: page.getByTestId('results-talk') })

  if (!(f.touch && info.project.name === 'iphone')) {
    const svg = await download(page, () => press(f.touch, button(page, 'Download vector image (SVG)')))
    f.check('card SVG: new sentence present', svg.text.includes(NEW_OVERLAP))
    f.check('card SVG: old sentence absent', !svg.text.includes(OLD_OVERLAP))
    f.check('D15 A card key: filled above 0 SD, hollow overlaps or below', svg.text.includes('Filled: range above 0 SD. Hollow: range overlaps or is below 0 SD.'))
    f.check('D15 A card key: ringed peaks named when the card lists peaks', sim.peaks.length === 0 || svg.text.includes('Ringed: a named peak.'), { peaks: sim.peaks, ringedKey: svg.text.includes('Ringed: a named peak.') })
    f.check('card SVG: "SD means standard deviation." still there', svg.text.includes('SD means standard deviation.'))
    f.check('card SVG: no total area or single score', !/total area|overall score|single score|IQ/.test(svg.text))
    f.check('D19 card SVG name: light, local date', svg.name === `humanbench-card-light-${localDateStamp()}.svg`, svg.name)
    await card.getByRole('radio', { name: 'Dark' }).check()
    await expect(page.locator('img[data-preview]')).toBeVisible()
    const dark = await download(page, () => press(f.touch, button(page, 'Download vector image (SVG)')))
    f.check('D19 card SVG name: dark, local date', dark.name === `humanbench-card-dark-${localDateStamp()}.svg`, dark.name)
    const png = await download(page, () => press(f.touch, button(page, 'Download image (PNG)')))
    f.check('D19 card PNG name: dark, local date', png.name === `humanbench-card-dark-${localDateStamp()}.png`, png.name)
    await card.getByRole('radio', { name: 'Light' }).check()
  } else {
    f.note('iPhone emulation: a download event cannot be observed, so the SVG text and the file names are checked on chromium and webkit.')
  }

  // The gated helper on its dev screen too.
  await page.goto('./#/dev/reveal-ai?screen=share')
  await expect(page.getByTestId('preamble')).toBeVisible()
  const dev = await page.getByTestId('preamble').innerText()
  f.check('dev reveal-ai share screen: preamble carries the new sentence', dev.includes(NEW_OVERLAP) && !dev.includes(OLD_OVERLAP))
  await f.shot('dev-reveal-ai-share', { fullPage: false })
  f.save()
})

// ------------------------------------------------------------------------------------------------ D3

test('uxdec-verify D3: RING_CAPTION, BARS_NOTE and the RT prior are unchanged', async ({ page }, info) => {
  const f = new Facts(page, info, 'D3')
  // Independent of the handoffs: the base commit's own strings.
  const baseCopy = execFileSync('git', ['show', `${BASE_COMMIT}:web/src/viz/copy.ts`], { cwd: REPO_ROOT, encoding: 'utf8' })
  const grab = (src: string, name: string): string => {
    const m = new RegExp(`export const ${name} =\\s*\\n?\\s*'([^']*)'`).exec(src)
    return m?.[1] ?? ''
  }
  const ringBase = grab(baseCopy, 'RING_CAPTION')
  const barsBase = grab(baseCopy, 'BARS_NOTE')
  const headCopy = readFileSync(path.join(REPO_ROOT, 'web/src/viz/copy.ts'), 'utf8')
  f.check('RING_CAPTION source unchanged from the base commit', ringBase !== '' && grab(headCopy, 'RING_CAPTION') === ringBase, ringBase)
  f.check('BARS_NOTE source unchanged from the base commit', barsBase !== '' && grab(headCopy, 'BARS_NOTE') === barsBase, barsBase)
  const priorDiff = execFileSync('git', ['diff', '--stat', BASE_COMMIT, '--', 'web/src/tasks/rt/prior.ts', 'web/src/tasks/priors.ts'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
  f.check('RT prior files unchanged from the base commit (git diff --stat empty)', priorDiff === '', priorDiff)
  const prior = readFileSync(path.join(REPO_ROOT, 'web/src/tasks/rt/prior.ts'), 'utf8')
  f.check('RT prior still s = 0.15 for simple and choice', (prior.match(/s: 0\.15/g) ?? []).length === 2)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await toResults(page)
  await expect(button(page, 'Download save file')).toBeVisible()
  const blob = await bodyText(page)
  f.check('results page shows the base RING_CAPTION verbatim', blob.includes(ringBase))
  f.check('no new "0 SD" explanation sentence (D3 options A/B) on the page', !/0 SD marks where we expect|provisional reference point|typical adult/.test(blob))
  await f.shot('results-ring-caption', { fullPage: false })
  await page.getByRole('button', { name: 'Bar view' }).click()
  await expect(page.locator('svg.lollipop').first()).toBeVisible()
  const bars = await bodyText(page)
  f.check('bar view shows the base BARS_NOTE verbatim', bars.includes(barsBase))
  await f.shot('results-bars-note', { fullPage: false })
  f.save()
})

// ------------------------------------------------------------------------------------------------ D5

test('uxdec-verify D5: the clock waits on Up next screens, the break is offered once before Working Memory, skips shorten the session', async ({ page }, info) => {
  test.setTimeout(8 * 60_000)
  const f = new Facts(page, info, 'D5')
  const driver = new SessionDriver(page, { touch: f.touch })
  await driver.toReady('./?fast=1')
  await driver.begin()
  const about: Record<string, number | null> = {}
  const totals: Record<string, number | null> = {}
  const read = async (key: string): Promise<void> => {
    const t = await bodyText(page)
    about[key] = aboutMin(t)
    totals[key] = ringMinutes(await ringText(page))?.total ?? null
  }
  const t0 = await bodyText(page)
  f.check('first Up next screen says the clock waits', t0.includes(INTERSTITIAL_CLOCK))
  f.check('first Up next screen: the clock note is visible', await page.locator('[data-clock-note]').isVisible())
  const r0 = await ringText(page)
  await read('Reaction Time')
  await page.waitForTimeout(6000) // 2 minutes of session time under ?fast=1
  const r1 = await ringText(page)
  f.check('clock held on the first Up next screen for 2 session minutes', r0 === r1 && ringMinutes(r1)?.elapsed === 0, { before: r0, after: r1 })
  await f.all('up-next-rt-held')

  await driver.press(button(page, 'Start'))
  await expect(h1(page)).toHaveText('Reaction Time')
  await page.waitForTimeout(6000)
  const r2 = await ringText(page)
  f.check('clock runs inside a part (2 session minutes after Start)', (ringMinutes(r2)?.elapsed ?? 0) >= 1, r2)
  await f.shot('inside-rt-clock-runs', { fullPage: false })
  // Skip from inside the part: the panel's primary is "Keep going" (D27), the skip the plain button.
  await driver.press(page.locator('.actions').getByRole('button', { name: /^Skip / }))
  const confirm = page.locator('section.confirm')
  await expect(confirm).toBeVisible()
  const panelButtons = await buttonsOf(confirm)
  f.check('D27 skip panel: "Keep going" first and the only primary', panelButtons[0]?.name === 'Keep going' && panelButtons[0]?.primary === true && panelButtons.filter((b) => b.primary).length === 1, panelButtons)
  await f.shot('skip-panel-in-rt', { fullPage: false })
  await driver.press(confirm.getByRole('button', { name: /^Skip / }))
  await expect(h1(page)).toHaveText('Up next: Matrix & Series')
  const r3 = await ringText(page)
  await read('Matrix & Series')
  await page.waitForTimeout(3000)
  const r4 = await ringText(page)
  f.check('clock held again on the next Up next screen', r3 === r4, { before: r3, after: r4 })
  f.check('every Up next screen says the clock waits (Matrix & Series)', (await bodyText(page)).includes(INTERSTITIAL_CLOCK))

  await driver.skipPart(true)
  await expect(h1(page)).toHaveText('Up next: Spatial')
  await read('Spatial')
  f.check('every Up next screen says the clock waits (Spatial)', (await bodyText(page)).includes(INTERSTITIAL_CLOCK))
  await driver.skipPart(true)
  await expect(h1(page)).toHaveText(/^(Time for a break\?|Up next: .*)$/)
  const afterSpatial = ((await h1(page).textContent()) ?? '').trim()
  f.check('the break is offered after Spatial, before Working Memory (nearest half-way)', afterSpatial === 'Time for a break?', afterSpatial)
  if (afterSpatial === 'Time for a break?') {
    const offer = await bodyText(page)
    f.check('break offer text is the new one (half-way, clock waits until Start)', offer.includes(BREAK_OFFER_TEXT))
    f.check('break offer names no 30 minutes', !/30 minutes|working for about/.test(offer))
    const b0 = await ringText(page)
    await page.waitForTimeout(3000)
    const b1 = await ringText(page)
    f.check('clock held on the break offer', b0 === b1, { before: b0, after: b1 })
    await f.all('break-offer')
    await f.axe('break offer')
    await driver.press(button(page, 'Take a break'))
    await expect(h1(page)).toHaveText('Break')
    await f.all('on-break')
    await driver.press(button(page, 'Resume'))
    await expect(h1(page)).toHaveText(/^(Up next: .*|Time for a break\?)$/)
    const afterBreak = ((await h1(page).textContent()) ?? '').trim()
    f.check('after the break: Up next: Working Memory (no second offer)', afterBreak === 'Up next: Working Memory', afterBreak)
    if (afterBreak === 'Time for a break?') await driver.press(button(page, 'Keep going'))
  }
  await expect(h1(page)).toHaveText('Up next: Working Memory')
  await read('Working Memory')
  await driver.skipPart(true)
  const afterWm = ((await h1(page).textContent()) ?? '').trim()
  f.check('no second break offer after Working Memory', afterWm === 'Up next: Quantitative Reasoning', afterWm)
  if (afterWm === 'Time for a break?') await driver.press(button(page, 'Keep going'))
  await expect(h1(page)).toHaveText('Up next: Quantitative Reasoning')
  await read('Quantitative Reasoning')
  await f.all('up-next-qr-after-skips')
  await driver.skipPart(true)
  if (((await h1(page).textContent()) ?? '').trim() === 'Time for a break?') {
    f.check('no break offer after Quantitative Reasoning', false)
    await driver.press(button(page, 'Keep going'))
  }
  await expect(h1(page)).toHaveText('Up next: Processing & Reading Speed')
  await read('Processing & Reading Speed')
  f.check('"About N min" recorded on every Up next screen', Object.values(about).every((v) => v !== null), about)
  f.check('Quantitative Reasoning not longer than planned after four skips (was "About 14 min")', (about['Quantitative Reasoning'] ?? 99) <= 6, about['Quantitative Reasoning'])
  f.check('the ring\'s "about M min" total per Up next screen (the planned target; the session itself gets shorter, see the journeys)', null, totals)
  f.check('break offers met: exactly one', driver.breakOffers + (afterSpatial === 'Time for a break?' ? 1 : 0) === 1, { driverCount: driver.breakOffers })
  f.save()
})

/** The "About N minutes." of each Up next screen of a journey, read from the page text the journey saved. */
function aboutPerPart(steps: readonly { readonly screen: string; readonly h1: string; readonly shot: string }[]): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  for (const s of steps) {
    if (s.screen !== 'interstitial' || s.shot === '') continue
    const part = s.h1.replace(/^Up next:\s*/, '').trim()
    try {
      out[part] = aboutMin(readFileSync(path.join(REPO_ROOT, s.shot.replace(/\.png$/, '.txt')), 'utf8'))
    } catch {
      out[part] = null
    }
  }
  return out
}

test('uxdec-verify D5: a whole session without skips, then one with Spatial skipped: later parts never grow', async ({ page }, info) => {
  test.setTimeout(14 * 60_000)
  const f = new Facts(page, info, 'D5-journeys')
  const a = await playJourney(page, { runId: RUN, touch: f.touch, shots: new Shots(page, RUN, `D5-journeys/${info.project.name}/no-skip`), limitMs: 6 * 60_000 })
  f.check('no-skip journey completed', a.completed, a.error ?? `${a.segments.join(', ')} in ${Math.round(a.realMs / 1000)} s`)
  const breakA = a.steps.findIndex((s) => s.screen === 'break')
  const nextA = breakA < 0 ? '' : (a.steps.slice(breakA + 1).find((s) => s.screen === 'interstitial')?.h1 ?? '')
  f.check('no-skip: the break is offered once, before Working Memory', a.steps.filter((s) => s.screen === 'break').length === 1 && nextA === 'Up next: Working Memory', { breaks: a.steps.filter((s) => s.screen === 'break').length, next: nextA })
  const aboutA = aboutPerPart(a.steps)
  f.check('no-skip: About N per part', null, aboutA)
  for (const p of a.steps.filter((s) => s.screen === 'break' || s.screen === 'interstitial')) if (p.shot !== '') f.evidence.push(p.shot)

  await page.goto('./favicon.svg')
  await page.evaluate('localStorage.clear(); sessionStorage.clear()')
  const b = await playJourney(page, { runId: RUN, touch: f.touch, skipParts: ['Spatial'], shots: new Shots(page, RUN, `D5-journeys/${info.project.name}/skip-spatial`), limitMs: 6 * 60_000 })
  f.check('skip-Spatial journey completed', b.completed, b.error ?? `${b.segments.join(', ')} (skipped ${b.skipped.join(', ')}) in ${Math.round(b.realMs / 1000)} s`)
  const aboutB = aboutPerPart(b.steps)
  f.check('skip-Spatial: About N per part', null, aboutB)
  const later = ['Working Memory', 'Quantitative Reasoning', 'Processing & Reading Speed']
  const grew = later.filter((p) => (aboutB[p] ?? 0) > (aboutA[p] ?? 0))
  f.check('skipping Spatial makes no later part longer than in the no-skip session', grew.length === 0 && later.every((p) => aboutA[p] !== null && aboutB[p] !== null), { noSkip: aboutA, skipSpatial: aboutB, grew })
  // Skipping Spatial lands on the break offer, which the driver's skipPart declines on its own (so no 'break' step is
  // photographed); the D5 test above replays that path by hand. Here: no offer anywhere else in the session.
  const breaksB = b.steps.filter((s) => s.screen === 'break').length
  const nextB = breaksB === 0 ? '(declined inside the Spatial skip)' : (b.steps.slice(b.steps.findIndex((s) => s.screen === 'break') + 1).find((s) => s.screen === 'interstitial')?.h1 ?? '')
  f.check('skip-Spatial: no break offer at any other place than before Working Memory', breaksB === 0 || (breaksB === 1 && nextB === 'Up next: Working Memory'), { breakSteps: breaksB, next: nextB })
  for (const p of b.steps.filter((s) => s.screen === 'break' || s.screen === 'interstitial')) if (p.shot !== '') f.evidence.push(p.shot)
  f.save()
})

// ------------------------------------------------------------------------------------------------ D10

test('uxdec-verify D10: paper and pencil, no calculators or AI chatbots, before the session and on the Quantitative screen; honour sentence unchanged', async ({ page }, info) => {
  const f = new Facts(page, info, 'D10')
  const design = readFileSync(path.join(REPO_ROOT, 'docs/DESIGN.md'), 'utf8')
  const designHonour = /\*\*Honour code\*\* \(checkbox at start\): "([^"]+)"/.exec(design)?.[1] ?? ''
  f.check('DESIGN §13 honour sentence found', designHonour !== '', designHonour)
  await toHonour(page)
  const honour = await bodyText(page)
  f.check('honour screen shows the §13 sentence word for word', honour.includes(designHonour))
  f.check('honour screen: scratch paper and a pencil', /scratch paper and a pencil/i.test(honour))
  f.check('honour screen: no calculator or AI chatbot', /do not use a calculator or an AI chatbot/i.test(honour))
  f.check('honour screen: screen readers and accessibility settings are fine', /Screen readers, zoom and other accessibility settings are fine to use/.test(honour))
  f.check('honour screen: nothing tells screen-reader users to stop', !/(turn off|stop using|disable|switch off|without)[^.]{0,30}screen reader/i.test(honour))
  f.check('honour screen: the tools paragraph follows the honour sentence', honour.indexOf(designHonour) < honour.indexOf(HONOUR_TOOLS) && honour.includes(HONOUR_TOOLS))
  f.check('honour screen: the owner\'s "assistive technology" phrase is not used (screen readers excepted instead)', !/assistive technology/i.test(honour))
  await f.all('honour')
  await f.axe('honour')
  const h = page.viewportSize()?.height ?? 800
  const w = page.viewportSize()?.width ?? 1280
  await page.setViewportSize({ width: 320, height: h })
  await settle(page)
  await layoutFacts(page, f, 'honour 320 px')
  await f.shot('honour-320', { fullPage: false })
  await page.setViewportSize({ width: w, height: h })

  await fresh(page)
  await toInterstitial(page, 4)
  const quant = await bodyText(page)
  f.check('Quantitative Up next screen: scratch paper and a pencil are fine', /Scratch paper and a pencil are fine/.test(quant))
  f.check('Quantitative Up next screen: no calculator or AI chatbot', /please do not use a calculator or an AI chatbot/.test(quant))
  f.check('Quantitative Up next screen: the old "Keep paper and a calculator out of reach" is gone', !/Keep paper and a calculator out of reach/.test(quant))
  await f.all('up-next-quant')
  await f.axe('Quantitative Up next')
  // The other Up next screens say nothing that contradicts it.
  f.check('no screen says to keep paper out of reach', !/paper[^.]{0,40}out of reach/i.test(quant))
  f.save()
})
