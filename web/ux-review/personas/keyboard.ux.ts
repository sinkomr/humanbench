/// <reference lib="dom" />
/**
 * Persona "Alex": uses only a keyboard (no mouse, no trackpad) on desktop Chrome and Safari, and expects a visible focus ring
 * and a logical order everywhere. The e2e specs (`keyboard-session.spec.ts`, `a11y.spec.ts`) already prove that a session can be
 * finished by keyboard and that every stop shows a ring. This spec measures the ergonomics they do not:
 *
 *   - `routes: <group>`  per product route: where focus lands on arrival, the Tab presses from arrival to the primary action,
 *                        a Tab walk of the whole page (rect, ring, clipping, covering, scroll, visual order), focus screenshots.
 *   - `items`            inside items: radio groups, confidence slider, typed entry, RT keys, digit span, Corsi, coding, reading,
 *                        spatial, Escape on the confirm panels, focus return.
 *   - `results`          the results by keyboard: view toggle, drill-down, disclosures, save, share card, focus picker, AI link.
 *   - `notes`            notes.html builder end to end by keyboard; rt-selftest.html key phase.
 *   - `session`          one whole ?fast=1 session keyboard-only, counting key presses and Tab presses per screen kind.
 *
 *   UX_PORT=4612 UX_RUN=keyboard npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/keyboard.ux.ts --project=chromium --grep 'routes: start'
 *
 * Output: web/test-results/ux-review/keyboard/<test>-<project>/ (screenshots, JSON). Nothing here touches the mouse after a state
 * is set up: the set-up of a route uses the e2e helpers (which click), the measuring afterwards is keys only.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { chordFor } from '../../e2e/keyboard'
import { openRoute, PREVIEW_ROUTES, type Route } from '../../e2e/routes'
import { REPO_ROOT, Shots, trackConsole, UX_ROOT } from '../lib'

const RUN = process.env.UX_RUN ?? 'keyboard'

// ------------------------------------------------------------------------------------------------ in-page probes

/** What has focus, and everything about how it is drawn. Run in the page. */
export interface Probe {
  readonly none: boolean
  readonly id: string
  readonly what: string
  readonly tag: string
  readonly role: string
  readonly plain: boolean
  readonly rect: { x: number; y: number; w: number; h: number }
  readonly ring: { on: string; style: string; width: number; offset: number; color: string; shadow: string } | null
  readonly ringClippedBy: string
  readonly ringOffViewport: boolean
  readonly obscuredBy: string
  readonly ringContrast: number | null
  readonly inView: boolean
  readonly scrollY: number
  readonly context: string
}

function probeInPage(): Probe {
  const el = document.activeElement as HTMLElement | null
  const empty: Probe = { none: true, id: '', what: 'nothing', tag: '', role: '', plain: false, rect: { x: 0, y: 0, w: 0, h: 0 }, ring: null, ringClippedBy: '', ringOffViewport: false, obscuredBy: '', ringContrast: null, inView: false, scrollY: window.scrollY, context: '' }
  if (!el || el === document.body || el === document.documentElement) return empty
  const w = window as unknown as { __kbdId?: number }
  const anyEl = el as unknown as { __kbdId?: string }
  if (!anyEl.__kbdId) anyEl.__kbdId = `k${(w.__kbdId = (w.__kbdId ?? 0) + 1)}`
  const label = el.getAttribute('aria-label') || ((el as HTMLInputElement).labels?.[0]?.textContent ?? '') || el.textContent || el.getAttribute('title') || el.getAttribute('placeholder') || ''
  const what = `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[${el.getAttribute('role')}]` : ''}${el.getAttribute('type') ? `[${el.getAttribute('type')}]` : ''} "${label.replace(/\s+/g, ' ').trim().slice(0, 48)}"`
  const r = el.getBoundingClientRect()
  const cands: [HTMLElement | null, string][] = [
    [el, 'self'],
    [el.nextElementSibling as HTMLElement | null, 'sibling'],
    [el.closest('label'), 'label'],
    [el.closest('summary'), 'summary'],
  ]
  let ring: Probe['ring'] = null
  let ringEl: HTMLElement | null = null
  for (const [c, on] of cands) {
    if (!c) continue
    const s = getComputedStyle(c)
    const drawn = s.outlineStyle !== 'none' && s.outlineStyle !== 'hidden' && (s.outlineStyle === 'auto' || parseFloat(s.outlineWidth) > 0)
    if (drawn) {
      ring = { on, style: s.outlineStyle, width: parseFloat(s.outlineWidth), offset: parseFloat(s.outlineOffset) || 0, color: s.outlineColor, shadow: s.boxShadow }
      ringEl = c
      break
    }
  }
  if (!ring) {
    const s = getComputedStyle(el)
    if (s.boxShadow !== 'none') ring = { on: 'shadow', style: 'shadow', width: 0, offset: 0, color: '', shadow: s.boxShadow }
  }
  // The box the ring is drawn around, inflated by its width and offset.
  let ringClippedBy = ''
  let ringOffViewport = false
  if (ring && ringEl) {
    const rr = ringEl.getBoundingClientRect()
    const grow = ring.style === 'auto' ? 3 : Math.max(0, ring.offset) + ring.width
    const box = { l: rr.left - grow, t: rr.top - grow, r: rr.right + grow, b: rr.bottom + grow }
    for (let a: HTMLElement | null = ringEl.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a)
      const clips = [cs.overflowX, cs.overflowY].some((o) => o !== 'visible')
      if (!clips) continue
      const ar = a.getBoundingClientRect()
      const out = [box.l < ar.left - 0.5 ? 'left' : '', box.r > ar.right + 0.5 ? 'right' : '', box.t < ar.top - 0.5 ? 'top' : '', box.b > ar.bottom + 0.5 ? 'bottom' : ''].filter(Boolean)
      if (out.length > 0 && (a.tagName !== 'BODY')) {
        ringClippedBy = `${a.tagName.toLowerCase()}.${[...a.classList].join('.')} (${out.join('+')})`
        break
      }
    }
    if (box.l < -0.5 || box.r > window.innerWidth + 0.5) ringOffViewport = true
  }
  // Is it covered by something drawn over it (a sticky bar, a banner)?
  let obscuredBy = ''
  const cx = Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 1)
  const cy = Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 1)
  if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight) {
    const top = document.elementFromPoint(cx, cy)
    const lab = el.closest('label')
    if (top && !(el.contains(top) || top.contains(el) || (lab && (lab.contains(top) || top.contains(lab))))) obscuredBy = `${top.tagName.toLowerCase()}.${[...top.classList].join('.')}`
  }
  // Contrast of a custom ring against the background behind it.
  let ringContrast: number | null = null
  if (ring && ring.style !== 'auto' && ring.style !== 'shadow' && ringEl) {
    const parse = (c: string): [number, number, number, number] | null => {
      const m = c.match(/rgba?\(([^)]+)\)/)
      if (!m) return null
      const p = (m[1] as string).split(/[ ,/]+/).filter(Boolean).map(Number)
      return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 1]
    }
    const lum = (c: [number, number, number, number]): number => {
      const f = (v: number): number => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
    }
    let bg: [number, number, number, number] | null = null
    for (let a: HTMLElement | null = ringEl.parentElement; a; a = a.parentElement) {
      const c = parse(getComputedStyle(a).backgroundColor)
      if (c && c[3] > 0.9) {
        bg = c
        break
      }
    }
    const fg = parse(ring.color)
    if (fg && bg) {
      const [hi, lo] = [Math.max(lum(fg), lum(bg)), Math.min(lum(fg), lum(bg))]
      ringContrast = Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
    }
  }
  const plain = el.getAttribute('tabindex') === '-1' && !el.matches('a[href], button, input, select, textarea, summary, [contenteditable], [role=button], [role=link], [role=checkbox], [role=radio], [role=slider], [role=textbox]')
  const group = el.closest('fieldset')?.querySelector('legend')?.textContent ?? el.closest('[role=group]')?.getAttribute('aria-label') ?? el.closest('section,article,details')?.querySelector('h2,h3,summary')?.textContent ?? ''
  return {
    none: false,
    id: anyEl.__kbdId as string,
    what,
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role') ?? '',
    plain,
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    ring,
    ringClippedBy,
    ringOffViewport,
    obscuredBy,
    ringContrast,
    inView: r.right > 0 && r.left < window.innerWidth && r.bottom > 0 && r.top < window.innerHeight,
    scrollY: Math.round(window.scrollY),
    context: group.replace(/\s+/g, ' ').trim().slice(0, 60),
  }
}

export const probe = (page: Page): Promise<Probe> => page.evaluate(probeInPage)

/** Focus to the document, as at a fresh page load (nothing focused, selection at the start). */
async function focusDocument(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement && document.activeElement !== document.body) (document.activeElement as HTMLElement).blur()
    document.body.setAttribute('tabindex', '-1')
    document.body.focus()
    document.body.removeAttribute('tabindex')
    window.scrollTo(0, 0)
    const range = document.createRange()
    range.setStart(document.body, 0)
    range.collapse(true)
    const sel = getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  })
}

export interface Stop extends Probe {
  readonly n: number
}

/** Tab once round the page from its top and record every stop in full. */
async function walk(page: Page, chord: string, max = 200): Promise<{ stops: Stop[]; ended: string }> {
  await focusDocument(page)
  const stops: Stop[] = []
  const seen = new Set<string>()
  let left = 0
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(chord)
    let p = await probe(page)
    for (let wait = 0; wait < 8 && !p.none && !p.inView; wait++) {
      await page.waitForTimeout(40)
      p = await probe(page)
    }
    if (p.none) {
      left++
      if (stops.length > 0 ? left >= 2 : left >= 6) return { stops, ended: 'left the page' }
      continue
    }
    if (seen.has(p.id)) return { stops, ended: 'came round' }
    seen.add(p.id)
    stops.push({ ...p, n: stops.length + 1 })
  }
  return { stops, ended: `no end within ${max} presses (trap?)` }
}

export interface Cost {
  readonly label: string
  readonly presses: number
  readonly visited: string[]
  readonly note?: string
}

/** Tab presses from the current focus until `target` has focus. -1 when it is not reached. */
async function costTo(page: Page, chord: string, label: string, target: Locator, max = 80): Promise<Cost> {
  const handle = await target.first().elementHandle({ timeout: 4000 }).catch(() => null)
  if (!handle) return { label, presses: -1, visited: [], note: 'target not on the page' }
  const has = (): Promise<boolean> => page.evaluate((el) => el === document.activeElement, handle).catch(() => false)
  if (await has()) return { label, presses: 0, visited: [] }
  const visited: string[] = []
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press(chord)
    if (await has()) return { label, presses: i, visited }
    visited.push((await probe(page)).what)
  }
  return { label, presses: -1, visited, note: `not reached in ${max} presses` }
}

/** A fresh page with the app's storage emptied (the consent record of one route must not skip the gate of the next). */
async function freshPage(context: BrowserContext): Promise<Page> {
  const tmp = await context.newPage()
  try {
    await tmp.goto('./favicon.svg')
    await tmp.evaluate('localStorage.clear(); sessionStorage.clear()')
    await context.clearCookies()
  } catch {
    // best effort
  }
  await tmp.close().catch(() => undefined)
  return context.newPage()
}

function writeJson(dir: string, name: string, data: unknown): string {
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, name)
  writeFileSync(file, JSON.stringify(data, null, 2))
  return path.relative(REPO_ROOT, file).split(path.sep).join('/')
}

// ------------------------------------------------------------------------------------------------ routes

const rb = (page: Page, name: string | RegExp): Locator => page.getByRole('button', { name, exact: typeof name === 'string' })
const itemField = (page: Page): Locator => page.locator('form.choice input[type=radio], form.entry input[type=text]').first()

/** The controls a keyboard user must reach to get on, in order (sequential cost from arrival). */
const PRIMARY: Record<string, (p: Page) => [string, Locator][]> = {
  welcome: (p) => [['Start', rb(p, 'Start')]],
  gate: (p) => [['18+ checkbox', p.getByRole('checkbox', { name: /18 or older/ })], ['Continue', rb(p, 'Continue')]],
  'gate-error': (p) => [['18+ checkbox', p.getByRole('checkbox', { name: /18 or older/ })], ['Continue', rb(p, 'Continue')]],
  'gate-under-18': () => [],
  privacy: (p) => [['Back link', p.getByRole('link', { name: 'Back', exact: true })]],
  honour: (p) => [['honour checkbox', p.getByRole('checkbox', { name: /honour code/ })], ['Continue', rb(p, 'Continue')]],
  device: (p) => [['Continue', rb(p, 'Continue')]],
  ready: (p) => [['Begin', rb(p, 'Begin')]],
  'ready-returning': (p) => [['Begin', rb(p, 'Begin')]],
  practice: (p) => [['first field', itemField(p)]],
  'practice-feedback': (p) => [['next control', p.locator('main button, main a[href]').first()]],
  interstitial: (p) => [['Start', rb(p, 'Start')]],
  'rt-intro': (p) => [['Start practice', rb(p, 'Start practice')]],
  'rt-trial': () => [],
  'item-matrix-series': (p) => [['first field', itemField(p)]],
  confidence: (p) => [['Continue', rb(p, 'Continue')]],
  'confirm-skip': (p) => [['Skip (yes)', p.locator('section.confirm').getByRole('button', { name: /^Skip / })], ['Keep going', p.locator('section.confirm').getByRole('button', { name: 'Keep going' })]],
  'confirm-finish': (p) => [['Finish now (yes)', p.locator('section.confirm').getByRole('button', { name: 'Finish now' })], ['Keep going', p.locator('section.confirm').getByRole('button', { name: 'Keep going' })]],
  'item-spatial': (p) => [['first field', itemField(p)]],
  'item-spatial-no-webgl': (p) => [['Skip Spatial', p.locator('.unavailable').getByRole('button', { name: 'Skip Spatial' })]],
  'memory-intro': (p) => [['Start', rb(p, 'Start')]],
  'memory-entry': (p) => [['Done', rb(p, 'Done')]],
  'memory-corsi': (p) => [['first block', p.locator('button.block[tabindex="0"]').first()], ['Done', rb(p, 'Done')]],
  'quant-item': (p) => [['number box', p.locator('form.entry input[type=text]')], ['Submit', p.locator('form.entry').getByRole('button', { name: 'Submit', exact: true })]],
  'coding-intro': (p) => [['Start', rb(p, 'Start')]],
  'coding-running': () => [],
  'reading-passage': (p) => [['Done reading', rb(p, 'Done reading')]],
  'reading-questions': (p) => [['first answer', p.locator('fieldset.question input[type=radio]').first()], ['Submit answers', rb(p, 'Submit answers')]],
  'break-offer': (p) => [['Take a break', rb(p, 'Take a break')]],
  'on-break': (p) => [['Resume', rb(p, 'Resume')]],
  'finished-nothing': (p) => [['first control', p.locator('main button, main a[href]').first()]],
  'results-building': (p) => [['Skip animation', rb(p, 'Skip animation')]],
  results: (p) => [['Download save file', rb(p, 'Download save file')]],
  'results-drilldown': (p) => [['Download save file', rb(p, 'Download save file')]],
  'results-bars': (p) => [['Download save file', rb(p, 'Download save file')]],
  'results-open': (p) => [['Download save file', rb(p, 'Download save file')]],
  'results-leave': (p) => [['Leave (yes)', p.locator('section.confirm').getByRole('button').first()], ['Keep going', p.locator('section.confirm').getByRole('button').nth(1)]],
  'results-saved': (p) => [['Download vector image (SVG)', rb(p, 'Download vector image (SVG)')]],
  'share-card-dark': (p) => [['Download vector image (SVG)', rb(p, 'Download vector image (SVG)')]],
  'share-card-too-few': (p) => [['Show all', rb(p, 'Show all')]],
  notes: (p) => [['Copy the notes', rb(p, 'Copy the notes')]],
  'notes-filled': (p) => [['Copy the notes', rb(p, 'Copy the notes')]],
  'notes-checker': (p) => [['Copy the notes', rb(p, 'Copy the notes')]],
  'notes-fit': (p) => [['Copy the notes', rb(p, 'Copy the notes')]],
  'notes-keep-error': (p) => [['Copy the notes', rb(p, 'Copy the notes')]],
  'notes-kept': (p) => [['Copy the notes', rb(p, 'Copy the notes')]],
  'notes-returning': (p) => [['Copy the notes', rb(p, 'Copy the notes')]],
  'rt-selftest': (p) => [['Start', rb(p, 'Start')]],
  'rt-selftest-keys': () => [],
  'rt-selftest-results': () => [],
}

const GROUPS = ['start', 'session', 'results', 'notes', 'selftest'] as const

interface RouteReport {
  route: string
  group: string
  project: string
  ok: boolean
  error?: string
  /** Where focus is on arrival (after the screen settled). */
  arrival?: Probe
  landing?: string
  costs?: Cost[]
  totalToPrimary?: number
  /** Controls Tab can reach on the whole page (the walk). */
  stopCount?: number
  walkEnded?: string
  stops?: Stop[]
  problems?: string[]
  shots?: string[]
  console?: unknown
}

/** Everything about one route, keys only once it is open. */
async function probeRoute(context: BrowserContext, browserName: string, project: string, route: Route, suffix = ''): Promise<RouteReport> {
  const page = await freshPage(context)
  const log = trackConsole(page)
  const dir = `routes-${project}${suffix}`
  const shots = new Shots(page, RUN, dir)
  const report: RouteReport = { route: route.id, group: route.group, project, ok: false }
  try {
    // The chord probe resets focus to the document (WebKit), so it runs on the blank page, before the route opens.
    const chord = await chordFor(page, browserName)
    await route.prepare?.(page)
    if (route.motion !== 'allow') await page.emulateMedia({ reducedMotion: 'reduce' })
    await openRoute(page, route)
    await page.waitForTimeout(500)
    const arrival = await probe(page)
    report.arrival = arrival
    report.landing = arrival.none ? 'body (nothing focused)' : arrival.plain ? `container ${arrival.what}` : `control ${arrival.what}`
    const shotList: string[] = []
    shotList.push(await shots.shot(`${route.id}-arrival`, { fullPage: false }))
    // 1. cost of the primary path from arrival
    const costs: Cost[] = []
    for (const [label, target] of PRIMARY[route.id]?.(page) ?? []) costs.push(await costTo(page, chord, label, target))
    report.costs = costs
    report.totalToPrimary = costs.reduce((n, c) => n + Math.max(c.presses, 0), 0)
    if (costs.length > 0) shotList.push(await shots.shot(`${route.id}-at-primary`, { fullPage: false }))
    // 2. the whole page, from the top
    const w = await walk(page, chord)
    report.stops = w.stops
    report.stopCount = w.stops.length
    report.walkEnded = w.ended
    const problems: string[] = []
    let prev: Stop | undefined
    for (const s of w.stops) {
      if (s.ring === null) problems.push(`stop ${s.n} ${s.what}: no ring or shadow`)
      if (s.ringClippedBy !== '') problems.push(`stop ${s.n} ${s.what}: ring clipped by ${s.ringClippedBy}`)
      if (s.ringOffViewport) problems.push(`stop ${s.n} ${s.what}: ring leaves the viewport sideways`)
      if (s.obscuredBy !== '') problems.push(`stop ${s.n} ${s.what}: covered by ${s.obscuredBy}`)
      if (!s.inView) problems.push(`stop ${s.n} ${s.what}: not in view`)
      if (s.ringContrast !== null && s.ringContrast < 3) problems.push(`stop ${s.n} ${s.what}: ring contrast ${s.ringContrast}:1`)
      if (prev && s.rect.y + s.rect.h < prev.rect.y + prev.scrollY - s.scrollY - 8) problems.push(`stop ${s.n} ${s.what}: focus moves UP the page from ${prev.what}`)
      prev = s
    }
    if (w.ended.startsWith('no end')) problems.push(`Tab does not come round: ${w.ended}`)
    report.problems = problems
    report.shots = shotList.filter((s) => s !== '')
    report.ok = true
  } catch (error) {
    report.error = (error instanceof Error ? error.message : String(error)).split('\n').slice(0, 5).join(' | ')
    report.shots = [await shots.shot(`${route.id}-failed`, { fullPage: false })].filter((s) => s !== '')
  }
  report.console = log
  await page.close().catch(() => undefined)
  writeJson(path.join(UX_ROOT, RUN, dir), `${route.id}.json`, report)
  return report
}

const only = (process.env.KBD_ROUTES ?? '').split(',').map((s) => s.trim()).filter(Boolean)

for (const group of GROUPS) {
  test(`routes: ${group}`, async ({ context, browserName }, testInfo) => {
    test.skip(testInfo.project.use.hasTouch === true, 'a touch phone has no Tab key')
    const project = testInfo.project.name
    const routes = PREVIEW_ROUTES.filter((r) => r.group === group && (only.length === 0 || only.includes(r.id)))
    const rows: string[] = []
    for (const route of routes) {
      const t0 = Date.now()
      const rep = await probeRoute(context, browserName, project, route)
      const row = `${route.id.padEnd(24)} ${rep.ok ? 'ok ' : 'ERR'} landing=${rep.landing ?? '-'} cost=${(rep.costs ?? []).map((c) => `${c.label}:${c.presses}`).join(',') || '-'} stops=${rep.stopCount ?? '-'} problems=${rep.problems?.length ?? '-'} ${rep.error ?? ''} (${Math.round((Date.now() - t0) / 1000)}s)`
      rows.push(row)
      console.log(`[kbd ${project}] ${row}`)
    }
    writeJson(path.join(UX_ROOT, RUN, `routes-${project}`), `_summary-${group}.json`, rows)
    expect(rows.length).toBeGreaterThan(0)
  })
}

// ------------------------------------------------------------------------------------------------ keyboard-only driver

import { button, h1, toReady } from '../../e2e/flow'
import { intoSegment } from '../../e2e/routes'
import { SessionDriver } from '../../e2e/session-driver'

export interface Trace {
  readonly label: string
  readonly focus: string
  readonly none: boolean
  readonly plain: boolean
  readonly ring: boolean
  readonly scrollY: number
  readonly inView: boolean
  readonly extra?: unknown
}

/** A keyboard: counts every key it presses and writes down where focus is after each step. */
class Kb {
  readonly trace: Trace[] = []
  keys = 0
  tabs = 0
  constructor(
    readonly page: Page,
    readonly chord: string,
    readonly shots: Shots,
  ) {}

  async press(key: string): Promise<void> {
    this.keys++
    if (key === this.chord) this.tabs++
    await this.page.keyboard.press(key)
  }

  async type(text: string): Promise<void> {
    this.keys += text.length
    await this.page.keyboard.type(text)
  }

  async tab(n = 1): Promise<void> {
    for (let i = 0; i < n; i++) await this.press(this.chord)
  }

  async shiftTab(n = 1): Promise<void> {
    const chord = this.chord.includes('+') ? this.chord.replace('Tab', 'Shift+Tab') : `Shift+${this.chord}`
    for (let i = 0; i < n; i++) {
      this.keys++
      this.tabs++
      await this.page.keyboard.press(chord)
    }
  }

  /** Write down where focus is, after a moment for the screen to settle. */
  async at(label: string, extra?: unknown, wait = 300): Promise<Probe> {
    await this.page.waitForTimeout(wait)
    const p = await probe(this.page)
    this.trace.push({ label, focus: p.what, none: p.none, plain: p.plain, ring: p.ring !== null, scrollY: p.scrollY, inView: p.inView, ...(extra === undefined ? {} : { extra }) })
    return p
  }

  /** Tab until `target` has focus; writes the cost into the trace. */
  async tabTo(label: string, target: Locator, max = 60): Promise<Cost> {
    const before = this.tabs
    const handle = await target.first().elementHandle({ timeout: 5000 }).catch(() => null)
    if (!handle) {
      const c: Cost = { label, presses: -1, visited: [], note: 'target not on the page' }
      this.trace.push({ label: `tab to ${label}`, focus: '-', none: false, plain: false, ring: false, scrollY: 0, inView: false, extra: c })
      return c
    }
    const has = (): Promise<boolean> => this.page.evaluate((el) => el === document.activeElement, handle).catch(() => false)
    const visited: string[] = []
    let presses = 0
    if (!(await has())) {
      for (let i = 1; i <= max; i++) {
        await this.press(this.chord)
        if (await has()) {
          presses = i
          break
        }
        visited.push((await probe(this.page)).what)
        if (i === max) presses = -1
      }
    }
    const c: Cost = { label, presses, visited }
    this.trace.push({ label: `tab to ${label}`, focus: (await probe(this.page)).what, none: false, plain: false, ring: true, scrollY: 0, inView: true, extra: { presses, tabsTotal: this.tabs - before, visited } })
    return c
  }

  note(label: string, extra: unknown): void {
    this.trace.push({ label, focus: '', none: false, plain: false, ring: true, scrollY: 0, inView: true, extra })
  }
}

async function kbFor(page: Page, browserName: string, project: string, name: string): Promise<Kb> {
  const chord = await chordFor(page, browserName)
  return new Kb(page, chord, new Shots(page, RUN, `${name}-${project}`))
}

function save(project: string, name: string, kb: Kb, extra: Record<string, unknown> = {}): void {
  const file = writeJson(path.join(UX_ROOT, RUN, `items-${project}`), `${name}.json`, { name, project, keys: kb.keys, tabs: kb.tabs, trace: kb.trace, ...extra })
  console.log(`[kbd ${project}] ${name}: ${kb.keys} keys, ${kb.tabs} tabs -> ${file}`)
  for (const t of kb.trace) console.log(`   ${t.label} => ${t.focus}${t.none ? ' [NO FOCUS]' : ''}${t.plain ? ' [plain target]' : ''}${t.extra === undefined ? '' : ` ${JSON.stringify(t.extra).slice(0, 220)}`}`)
}

const slider = (page: Page): Promise<{ value: string; min: string; max: string; step: string }> =>
  page.evaluate(() => {
    const r = document.querySelector('input[type=range]') as HTMLInputElement | null
    return r ? { value: r.value, min: r.min, max: r.max, step: r.step } : { value: '', min: '', max: '', step: '' }
  })

/** Into the session on ?fast=1 to the first screen of part `index` (0 = reaction time), parts before skipped (what `playInto` does, but stopping at the interstitial or past it). */
async function intoFast(page: Page, index: number, pastInterstitial = true): Promise<SessionDriver> {
  const driver = new SessionDriver(page, { touch: false })
  await driver.toReady('./?fast=1')
  await driver.begin()
  for (let i = 0; i < index; i++) await driver.skipPart()
  if (pastInterstitial) await driver.press(button(page, 'Start'))
  return driver
}

// ------------------------------------------------------------------------------------------------ items

test.describe('items', () => {
  test.beforeEach(async ({ page, browserName }, testInfo) => {
    test.skip(testInfo.project.use.hasTouch === true, 'a touch phone has no Tab key')
    // Safari's chord probe resets focus to the document: do it on the blank page, before the screen under test opens.
    await chordFor(page, browserName)
  })

  test('items: practice by keyboard', async ({ page, browserName }, testInfo) => {
    const project = testInfo.project.name
    await toReady(page)
    const kb = await kbFor(page, browserName, project, 'practice')
    await kb.at('ready screen')
    await kb.tabTo('Try practice questions first', button(page, 'Try practice questions first'))
    await kb.press('Enter')
    await kb.at('practice screen after Enter')
    for (let q = 0; q < 6; q++) {
      const heading = ((await h1(page).textContent().catch(() => '')) ?? '').trim()
      if (heading !== 'Practice') {
        await kb.at(`screen "${heading}"`)
        break
      }
      const choice = (await page.locator('form.choice').count()) > 0
      await kb.tabTo(`question ${q + 1} field`, itemField(page))
      if (choice) {
        await kb.press('b')
        await kb.press('Enter')
      } else {
        await kb.type('1')
        await kb.press('Enter')
        if (!(await page.getByRole('slider').isVisible({ timeout: 1500 }).catch(() => false))) {
          await kb.press('ControlOrMeta+A')
          await kb.type('A')
          await kb.press('Enter')
        }
      }
      await expect(page.getByRole('slider')).toBeVisible()
      await kb.at(`question ${q + 1}: slider arrives`, await slider(page))
      await kb.tabTo('Continue (confidence)', button(page, 'Continue'))
      await kb.press('Enter')
      const fb = await kb.at(`question ${q + 1}: after Enter on Continue (feedback shown)`, { feedback: await page.locator('section.feedback').innerText().catch(() => '') })
      await kb.shots.shot(`practice-q${q + 1}-feedback`, { fullPage: false })
      // how many Tabs to the Next button from where focus is?
      const next = page.locator('section.feedback button')
      await kb.tabTo('Next practice question', next)
      await kb.press('Enter')
      await kb.at(`question ${q + 1}: after Enter on Next`)
      if (fb.none) kb.note('lost focus after confidence Continue', { q: q + 1 })
    }
    await kb.shots.shot('practice-end', { fullPage: false })
    save(project, 'practice', kb)
  })

  test('items: choice item and confidence slider (spatial)', async ({ page, browserName }, testInfo) => {
    const project = testInfo.project.name
    await intoSegment(page, 2)
    await expect(page.locator('form.choice').or(page.locator('.unavailable'))).toBeVisible({ timeout: 30_000 })
    const kb = await kbFor(page, browserName, project, 'choice')
    if ((await page.locator('form.choice').count()) === 0) {
      kb.note('no WebGL here: the item is the skip offer', {})
      save(project, 'choice', kb)
      return
    }
    await kb.at('item arrives')
    await kb.shots.shot('choice-arrival', { fullPage: false })
    await kb.tabTo('first option', page.locator('form.choice input[type=radio]').first())
    const state = (): Promise<unknown> => page.evaluate(() => ({ checked: [...document.querySelectorAll('form.choice input[type=radio]')].map((r) => (r as HTMLInputElement).checked), confirmDisabled: (document.querySelector('form.choice button[type=submit]') as HTMLButtonElement).disabled }))
    await kb.at('first Tab into the options', await state())
    await kb.shots.shot('choice-first-option-focused', { fullPage: false })
    await kb.press('Enter')
    await kb.at('Enter with nothing chosen', await state())
    await kb.press('ArrowRight')
    await kb.at('ArrowRight', await state())
    await kb.press('ArrowDown')
    await kb.at('ArrowDown', await state())
    await kb.press('c')
    await kb.at('key c', await state())
    await kb.press('ArrowLeft')
    await kb.at('ArrowLeft', await state())
    await kb.shots.shot('choice-option-chosen', { fullPage: false })
    await kb.press(kb.chord)
    await kb.at('Tab from the chosen option (Confirm expected)')
    await kb.press('Enter')
    await expect(page.getByRole('slider')).toBeVisible()
    await kb.at('Enter on Confirm: slider', await slider(page))
    await kb.shots.shot('confidence-arrival', { fullPage: false })
    // step sizes of the slider
    const start = await slider(page)
    const steps: Record<string, unknown> = { start }
    for (const key of ['ArrowRight', 'ArrowUp', 'PageUp', 'PageDown', 'ArrowLeft', 'ArrowDown', 'End', 'Home']) {
      const before = Number((await slider(page)).value)
      await kb.press(key)
      steps[key] = Number((await slider(page)).value) - before
    }
    await kb.press('End')
    const top = await slider(page)
    await kb.press('Home')
    const bottom = await slider(page)
    kb.note('slider key steps (value change per key press)', { ...steps, atEnd: top.value, atHome: bottom.value })
    // from the start value to 70 and to 90 with PageUp and arrows
    await kb.press('Home')
    let n = 0
    while (Number((await slider(page)).value) < Number(start.value) && n < 120) {
      await kb.press('ArrowRight')
      n++
    }
    kb.note('ArrowRight presses from Home back to the start value', { n, start: start.value })
    await kb.press('Enter')
    await kb.at('Enter pressed on the slider (implicit submit?)', { slider: await page.getByRole('slider').count() })
    if ((await page.getByRole('slider').count()) > 0) {
      await kb.tabTo('Continue', button(page, 'Continue'))
      await kb.press('Enter')
      await kb.at('Enter on Continue: next screen')
    }
    await kb.shots.shot('after-confidence', { fullPage: false })
    save(project, 'choice', kb)
  })

  test('items: typed item and confidence slider (quantitative)', async ({ page, browserName }, testInfo) => {
    const project = testInfo.project.name
    await intoSegment(page, 4)
    await expect(page.locator('form.entry')).toBeVisible()
    const kb = await kbFor(page, browserName, project, 'typed')
    await kb.at('item arrives')
    await kb.shots.shot('typed-arrival', { fullPage: false })
    await kb.tabTo('number box', page.locator('form.entry input[type=text]'))
    await kb.press('Enter')
    await kb.at('Enter with an empty box', { note: await page.locator('.hb-note').innerText(), invalid: await page.locator('form.entry input').getAttribute('aria-invalid') })
    await kb.shots.shot('typed-empty-enter', { fullPage: false })
    await kb.type('abc')
    await kb.press('Enter')
    await kb.at('Enter with "abc"', { note: await page.locator('.hb-note').innerText() })
    await kb.shots.shot('typed-bad-enter', { fullPage: false })
    await kb.press('ControlOrMeta+A')
    await kb.type('12')
    await kb.tab()
    await kb.at('Tab after the box (plus-minus or Submit)')
    await kb.shiftTab()
    await kb.press('Enter')
    await expect(page.getByRole('slider')).toBeVisible()
    await kb.at('Enter in the box: slider', await slider(page))
    await kb.press('Enter')
    await kb.at('Enter on the slider', { slider: await page.getByRole('slider').count() })
    save(project, 'typed', kb)
  })

  test('items: Enter twice in a row on an item (the confidence default)', async ({ page, browserName }, testInfo) => {
    const project = testInfo.project.name
    await intoSegment(page, 2)
    await expect(page.locator('form.choice')).toBeVisible({ timeout: 30_000 })
    const kb = await kbFor(page, browserName, project, 'double-enter')
    await kb.tabTo('first option', page.locator('form.choice input[type=radio]').first())
    await kb.press('b')
    // two Enters 40 ms apart, as a quick double press: the first confirms the answer, the second arrives on the slider
    await page.keyboard.press('Enter')
    await page.waitForTimeout(40)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    kb.note('Enter, 40 ms, Enter on a chosen option', { sliderStillThere: (await page.getByRole('slider').count()) > 0, h1: ((await h1(page).textContent().catch(() => '')) ?? '').trim() })
    // the same with a 400 ms gap on the next item (a slower double press)
    await kb.at('next screen', {}, 200)
    if ((await page.getByRole('slider').count()) === 0) {
      await expect(page.locator('form.choice, form.entry').first()).toBeVisible({ timeout: 10_000 })
      const choice = (await page.locator('form.choice').count()) > 0
      if (choice) {
        await kb.tabTo('first option', page.locator('form.choice input[type=radio]').first())
        await kb.press('b')
        await page.keyboard.press('Enter')
        await page.waitForTimeout(400)
        await page.keyboard.press('Enter')
        await page.waitForTimeout(300)
        kb.note('Enter, 400 ms, Enter', { sliderStillThere: (await page.getByRole('slider').count()) > 0 })
      }
    }
    save(project, 'double-enter', kb)
  })

  test('items: a stray Tab in a reaction-time block and the way back to the stage', async ({ page, browserName }, testInfo) => {
    const project = testInfo.project.name
    await intoFast(page, 0)
    const kb = await kbFor(page, browserName, project, 'rt-stray-tab')
    const rt = page.locator('section.hb-render.rt')
    await kb.tabTo('Start practice', rt.getByRole('button', { name: 'Start practice' }))
    await kb.press('Enter')
    await expect(rt.getByRole('button', { name: 'Start', exact: true })).toBeVisible({ timeout: 20_000 })
    await kb.press('Enter')
    await kb.at('counted trials running (focus on the stage)')
    const seen: string[] = []
    for (let i = 0; i < 6; i++) {
      await kb.tab()
      const p = await probe(page)
      seen.push(p.what)
      if (p.none) break
    }
    kb.note('where Tab goes from the stage, press by press', { seen })
    // a Space on whatever has focus now: is it a response, a page scroll or a button press?
    const before = await page.evaluate(() => ({ y: window.scrollY, confirm: document.querySelectorAll('section.confirm').length }))
    await kb.press('Space')
    await page.waitForTimeout(200)
    const after = await page.evaluate(() => ({ y: window.scrollY, confirm: document.querySelectorAll('section.confirm').length, active: `${document.activeElement?.tagName}` }))
    kb.note('Space after the stray Tabs', { before, after })
    save(project, 'rt-stray-tab', kb)
  })

  test('items: confirm panels (skip, finish) by keyboard', async ({ page, browserName }, testInfo) => {
    const project = testInfo.project.name
    await intoSegment(page, 1)
    await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
    const kb = await kbFor(page, browserName, project, 'confirm')
    await kb.at('item arrives')
    for (const [name, opener] of [
      ['skip', page.locator('.actions').getByRole('button', { name: /^Skip / })],
      ['finish', button(page, 'Finish early')],
    ] as const) {
      // from the heading, backwards to the opener
      const before = kb.tabs
      for (let i = 0; i < 6; i++) {
        const isOpener = await opener.evaluate((el) => el === document.activeElement).catch(() => false)
        if (isOpener) break
        await kb.shiftTab()
      }
      kb.note(`${name}: Shift+Tab presses from where focus is to the opener`, { presses: kb.tabs - before })
      await kb.press('Enter')
      const p = await kb.at(`${name}: after Enter on the opener`)
      await kb.shots.shot(`confirm-${name}-open`, { fullPage: false })
      kb.note(`${name}: panel in view?`, { inView: await page.locator('section.confirm').evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight }), scrollY: p.scrollY, panelTop: await page.locator('section.confirm').evaluate((el) => Math.round(el.getBoundingClientRect().top)) })
      await kb.press('Escape')
      await kb.at(`${name}: after Escape`, { panelStillOpen: (await page.locator('section.confirm').count()) > 0 })
      await kb.press(kb.chord)
      await kb.at(`${name}: first Tab from the panel heading`)
      await kb.shots.shot(`confirm-${name}-first-tab`, { fullPage: false })
      await kb.tabTo('Keep going', page.locator('section.confirm').getByRole('button', { name: 'Keep going' }))
      await kb.press('Enter')
      await kb.at(`${name}: after Enter on Keep going (focus should return to the opener)`, { panelOpen: (await page.locator('section.confirm').count()) > 0 })
      await kb.shots.shot(`confirm-${name}-closed`, { fullPage: false })
    }
    save(project, 'confirm', kb)
  })
})

// ------------------------------------------------------------------------------------------------ blocks

/** Wait until the block with this id (the `aria-labelledby` of its section) has been replaced. */
async function blockGone(page: Page, kind: string, id: string, timeout = 30_000): Promise<void> {
  await page.waitForFunction(`(() => { const r = document.querySelector('section.hb-render.${kind}'); return !r || r.getAttribute('aria-labelledby') !== ${JSON.stringify(id)} })()`, undefined, { polling: 'raf', timeout })
}

/** The text of the block's status line and where focus is, for the trace. */
const statusOf = (page: Page, kind: string): Promise<string> => page.locator(`section.hb-render.${kind} .hb-status`).innerText({ timeout: 500 }).catch(() => '')

/** Reaction time, keys only: Tab to Start practice, Enter, answer each target from the live region, Start, answer, until the block is complete. */
async function rtByKeys(kb: Kb, label: string, opts: { holdMs?: number } = {}): Promise<{ keys: number; tabs: number; introText: string; focusAfterPractice: string; focusAtEnd: string }> {
  const { page } = kb
  const rt = page.locator('section.hb-render.rt')
  const id = (await rt.getAttribute('aria-labelledby')) ?? ''
  const introText = (await rt.locator('.hb-instructions').innerText()).replace(/\s+/g, ' ')
  const k0 = kb.keys
  const t0 = kb.tabs
  await kb.at(`${label}: intro arrives`)
  await kb.tabTo('Start practice', rt.getByRole('button', { name: 'Start practice' }))
  await kb.press('Enter')
  await kb.at(`${label}: after Start practice`)
  let focusAfterPractice = ''
  let focusAtEnd = ''
  for (const stage of ['practice', 'counted']) {
    for (let guard = 0; guard < 400; guard++) {
      const seen = await page
        .waitForFunction(
          `(() => {
            const root = document.querySelector('section.hb-render.rt')
            if (!root || root.getAttribute('aria-labelledby') !== ${JSON.stringify(id)}) return 'gone'
            if (/Block complete/.test((root.querySelector('.hb-status') || {}).textContent || '')) return 'done'
            if ([...root.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Start')) return 'ready'
            const pads = [...root.querySelectorAll('.pad')]
            const on = pads.findIndex((p) => p.classList.contains('on'))
            if (on < 0) { window.__kbdSeen = 0; return '' }
            const now = performance.now()
            if (!window.__kbdSeen) window.__kbdSeen = now
            return now - window.__kbdSeen >= ${opts.holdMs ?? 20} ? 'pad:' + on + ':' + pads.length : ''
          })()`,
          undefined,
          { polling: 'raf', timeout: 8000 },
        )
        .then((h) => h.jsonValue() as Promise<string>)
      if (seen === 'gone' || seen === 'done' || seen === 'ready') break
      const [, index, count] = seen.split(':').map(Number) as [number, number, number]
      await kb.press(count === 1 ? 'Space' : ['d', 'f', 'j', 'k'][index]!)
      await page.waitForFunction(`!document.querySelector('section.hb-render.rt .pad.on')`, undefined, { polling: 'raf', timeout: 3000 }).catch(() => undefined)
    }
    if (stage === 'practice') {
      const p = await kb.at(`${label}: practice done`)
      focusAfterPractice = p.what
      await kb.tabTo('Start (counted trials)', rt.getByRole('button', { name: 'Start', exact: true }))
      await kb.press('Enter')
    } else {
      const p = await kb.at(`${label}: counted trials done`, { status: await statusOf(page, 'rt') }, 100)
      focusAtEnd = p.what
    }
  }
  await blockGone(page, 'rt', id)
  return { keys: kb.keys - k0, tabs: kb.tabs - t0, introText, focusAfterPractice, focusAtEnd }
}

test.describe('blocks', () => {
  test.beforeEach(async ({ page, browserName }, testInfo) => {
    test.skip(testInfo.project.use.hasTouch === true, 'a touch phone has no Tab key')
    // Safari's chord probe resets focus to the document: do it on the blank page, before the screen under test opens.
    await chordFor(page, browserName)
  })

  test('blocks: reaction time, simple then four positions, by keyboard', async ({ page, browserName }, testInfo) => {
    const project = testInfo.project.name
    await intoFast(page, 0)
    const kb = await kbFor(page, browserName, project, 'rt')
    await kb.shots.shot('rt-intro', { fullPage: false })
    const a = await rtByKeys(kb, 'RT simple')
    kb.note('RT simple: totals', a)
    await expect(page.locator('section.hb-render.rt')).toBeVisible({ timeout: 20_000 })
    await kb.shots.shot('rt-second-intro', { fullPage: false })
    const b = await rtByKeys(kb, 'RT four positions')
    kb.note('RT four positions: totals', b)
    await kb.at('after both RT blocks', { h1: ((await h1(page).textContent().catch(() => '')) ?? '').trim() })
    save(project, 'rt', kb)
  })

  test('blocks: digit span and Corsi by keyboard', async ({ page, browserName }, testInfo) => {
    const project = testInfo.project.name
    await intoFast(page, 3)
    const kb = await kbFor(page, browserName, project, 'memory')
    const span = page.locator('section.hb-render.span')
    const spanId = (await span.getAttribute('aria-labelledby')) ?? ''
    kb.note('digit span intro text', { text: (await span.locator('.hb-instructions').innerText()).replace(/\s+/g, ' ') })
    await kb.at('digit span intro arrives')
    await kb.tabTo('Start', span.getByRole('button', { name: 'Start' }))
    await kb.press('Enter')
    const slots = (): Promise<string> => span.locator('ol.slots').evaluate((ol) => `${ol.getAttribute('aria-label')} [${[...ol.querySelectorAll('li')].map((li) => li.textContent || '_').join('')}]`).catch(() => '(no entry list)')
    await page.waitForFunction(`/^Enter \\d+ digits/.test(((document.querySelector('section.hb-render.span .hb-status') || {}).textContent) || '')`, undefined, { polling: 'raf', timeout: 20_000 })
    await kb.at('digit span: entry begins', { slots: await slots() })
    await kb.shots.shot('span-entry', { fullPage: false })
    await kb.type('123')
    kb.note('typed 1 2 3', { slots: await slots() })
    await kb.press('Backspace')
    kb.note('Backspace', { slots: await slots() })
    await kb.press('0')
    kb.note('key 0 (the keypad has no 0)', { slots: await slots() })
    await kb.tab()
    await kb.at('Tab from the stage', { slots: await slots() })
    await kb.press('5')
    kb.note('digit key 5 while the keypad button has focus', { slots: await slots(), focus: (await probe(page)).what })
    await kb.press('Enter')
    kb.note('Enter while a keypad button has focus', { slots: await slots(), statusNow: await statusOf(page, 'span'), focus: (await probe(page)).what })
    // Tab presses from here to Done
    const done = span.getByRole('button', { name: 'Done' })
    const c = await kb.tabTo('Done', done)
    kb.note('Tab presses from a keypad button to Done', { presses: c.presses })
    await kb.press('Enter')
    await kb.at('after Done: next sequence', { status: await statusOf(page, 'span') }, 800)
    // play out the rest with digits + Enter (the block ends after two misses at a length)
    for (let guard = 0; guard < 40; guard++) {
      const phase = await page
        .waitForFunction(
          `(() => { const root = document.querySelector('section.hb-render.span'); if (!root || root.getAttribute('aria-labelledby') !== ${JSON.stringify(spanId)}) return 'gone'; const t = (root.querySelector('.hb-status') || {}).textContent || ''; if (/Block complete/.test(t)) return 'done'; if (/^Enter \\d+ digits/.test(t)) return 'entry'; return '' })()`,
          undefined,
          { polling: 'raf', timeout: 20_000 },
        )
        .then((h) => h.jsonValue() as Promise<string>)
      if (phase !== 'entry') break
      await kb.type('999999999')
      await kb.press('Enter')
      await page.waitForFunction(`!/^Enter \\d+ digits/.test(((document.querySelector('section.hb-render.span .hb-status') || {}).textContent) || '')`, undefined, { polling: 'raf', timeout: 5000 }).catch(() => undefined)
    }
    const endFocus = await kb.at('digit span block complete', { status: await statusOf(page, 'span') }, 200)
    kb.note('focus at the end of the span block', { what: endFocus.what })
    await blockGone(page, 'span', spanId, 30_000).catch(() => undefined)
    // a second span block (reverse order) may follow before Corsi: play it with the keys
    for (let blocks = 0; blocks < 3 && (await page.locator('section.hb-render.span').count()) > 0; blocks++) {
      const sp = page.locator('section.hb-render.span')
      const id2 = (await sp.getAttribute('aria-labelledby')) ?? ''
      kb.note('another span block', { title: await sp.locator('.title').innerText(), text: (await sp.locator('.hb-instructions').innerText()).replace(/\s+/g, ' ') })
      await kb.tabTo('Start', sp.getByRole('button', { name: 'Start' }))
      await kb.press('Enter')
      for (let guard = 0; guard < 40; guard++) {
        const phase = await page
          .waitForFunction(
            `(() => { const root = document.querySelector('section.hb-render.span'); if (!root || root.getAttribute('aria-labelledby') !== ${JSON.stringify(id2)}) return 'gone'; const t = (root.querySelector('.hb-status') || {}).textContent || ''; if (/Block complete/.test(t)) return 'done'; if (/^Enter \\d+ digits/.test(t)) return 'entry'; return '' })()`,
            undefined,
            { polling: 'raf', timeout: 20_000 },
          )
          .then((h) => h.jsonValue() as Promise<string>)
        if (phase !== 'entry') break
        await kb.type('999999999')
        await kb.press('Enter')
        await page.waitForFunction(`!/^Enter \\d+ digits/.test(((document.querySelector('section.hb-render.span .hb-status') || {}).textContent) || '')`, undefined, { polling: 'raf', timeout: 5000 }).catch(() => undefined)
      }
      await blockGone(page, 'span', id2, 30_000).catch(() => undefined)
    }
    // Corsi
    const corsi = page.locator('section.hb-render.corsi')
    await expect(corsi).toBeVisible({ timeout: 20_000 })
    const corsiId = (await corsi.getAttribute('aria-labelledby')) ?? ''
    kb.note('Corsi intro text', { text: (await corsi.locator('.hb-instructions').innerText()).replace(/\s+/g, ' ') })
    await kb.at('Corsi intro arrives')
    await kb.tabTo('Start', corsi.getByRole('button', { name: 'Start' }))
    await kb.press('Enter')
    await page.waitForFunction(`/^Selected \\d+ of \\d+/.test(((document.querySelector('section.hb-render.corsi .hb-status') || {}).textContent) || '')`, undefined, { polling: 'raf', timeout: 20_000 })
    const sel = async (): Promise<unknown> => ({ status: await statusOf(page, 'corsi'), focus: (await probe(page)).what })
    await kb.at('Corsi: entry begins (focus on the board)', await sel())
    await kb.shots.shot('corsi-entry', { fullPage: false })
    for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
      await kb.press(key)
      kb.note(`Corsi ${key}`, await sel())
    }
    await kb.press('Enter')
    kb.note('Corsi Enter on a block (picks it)', await sel())
    await kb.press('Space')
    kb.note('Corsi Space on a block', await sel())
    await kb.press('7')
    kb.note('Corsi key 7 (picks Block 7)', await sel())
    await kb.press('Backspace')
    kb.note('Corsi Backspace (undo)', await sel())
    const cc = await kb.tabTo('Undo or Done', corsi.getByRole('button', { name: /^(Undo|Done)$/ }))
    kb.note('Tab presses from the board to the next button', { presses: cc.presses, focus: (await probe(page)).what })
    await kb.tabTo('Done', corsi.getByRole('button', { name: 'Done' }))
    await kb.press('Enter')
    await kb.at('Corsi after Done', await sel(), 800)
    for (let guard = 0; guard < 40; guard++) {
      const phase = await page
        .waitForFunction(
          `(() => { const root = document.querySelector('section.hb-render.corsi'); if (!root || root.getAttribute('aria-labelledby') !== ${JSON.stringify(corsiId)}) return 'gone'; const t = (root.querySelector('.hb-status') || {}).textContent || ''; if (/Block complete/.test(t)) return 'done'; if (/^Selected \\d+ of \\d+/.test(t)) return 'entry'; return '' })()`,
          undefined,
          { polling: 'raf', timeout: 20_000 },
        )
        .then((h) => h.jsonValue() as Promise<string>)
      if (phase !== 'entry') break
      for (const k of ['1', '2', '3']) await kb.press(k)
      await kb.tabTo('Done', corsi.getByRole('button', { name: 'Done' }))
      await kb.press('Enter')
      await page.waitForFunction(`!/^Selected \\d+ of \\d+/.test(((document.querySelector('section.hb-render.corsi .hb-status') || {}).textContent) || '')`, undefined, { polling: 'raf', timeout: 5000 }).catch(() => undefined)
    }
    await kb.at('Corsi block complete', { status: await statusOf(page, 'corsi') }, 200)
    save(project, 'memory', kb)
  })

  test('blocks: coding and reading by keyboard', async ({ page, browserName }, testInfo) => {
    const project = testInfo.project.name
    await intoFast(page, 5)
    const kb = await kbFor(page, browserName, project, 'coding')
    const coding = page.locator('section.hb-render.coding')
    const id = (await coding.getAttribute('aria-labelledby')) ?? ''
    kb.note('coding intro text', { text: (await coding.locator('.hb-instructions').innerText()).replace(/\s+/g, ' ') })
    await kb.at('coding intro arrives')
    await kb.tabTo('Start', coding.getByRole('button', { name: 'Start' }))
    await kb.press('Enter')
    await expect(coding.getByRole('timer')).toBeVisible()
    await kb.at('coding: running (focus on the stage)')
    await kb.shots.shot('coding-running', { fullPage: false })
    for (let i = 0; i < 6; i++) await kb.press(String(1 + (i % 9)))
    kb.note('six digit keys pressed', { focus: (await probe(page)).what })
    // Tab onto the on-screen keypad mid-block, then Space on a keypad button, then digit keys again
    await kb.tab()
    await kb.at('coding: Tab during the block')
    await kb.press('Space')
    await kb.at('coding: Space on a keypad button (presses that digit)')
    await kb.shots.shot('coding-keypad-focus', { fullPage: false })
    for (let i = 0; i < 4000; i++) {
      await page.keyboard.press(String(1 + (i % 9)))
      if (i % 25 === 0 && (await coding.locator('.hb-status').innerText({ timeout: 300 }).catch(() => 'over')).trim() !== '') break
    }
    await kb.at('coding: block over', { status: await statusOf(page, 'coding') }, 200)
    await blockGone(page, 'coding', id, 30_000).catch(() => undefined)

    const reading = page.locator('section.hb-render.reading')
    await expect(reading).toBeVisible({ timeout: 30_000 })
    kb.note('reading intro text', { text: (await reading.locator('.hb-instructions').innerText()).replace(/\s+/g, ' ') })
    await kb.at('reading intro arrives')
    await kb.tabTo('Show the passage', reading.getByRole('button', { name: 'Show the passage' }))
    await kb.press('Enter')
    await kb.at('reading: passage shown')
    await kb.shots.shot('reading-passage', { fullPage: false })
    const doneBtn = reading.getByRole('button', { name: 'Done reading' })
    kb.note('Done reading state', { disabled: await doneBtn.isDisabled() })
    await kb.press('Space')
    await kb.at('reading: Space with focus on the passage (scrolls?)')
    const c = await kb.tabTo('Done reading', doneBtn)
    kb.note('Tab presses to Done reading', { presses: c.presses })
    await kb.press('Enter')
    await expect(reading.locator('form.questions')).toBeVisible()
    await kb.at('reading: questions shown')
    await kb.shots.shot('reading-questions', { fullPage: false })
    const answers = (): Promise<unknown> => page.evaluate(() => [...document.querySelectorAll('fieldset.question')].map((f) => { const r = [...f.querySelectorAll('input[type=radio]')] as HTMLInputElement[]; return r.findIndex((x) => x.checked) }))
    const first = reading.locator('fieldset.question').first().locator('input[type=radio]').first()
    await kb.tabTo('question 1 group', first)
    await kb.press('ArrowDown')
    kb.note('ArrowDown in question 1', { answers: await answers(), focus: (await probe(page)).what })
    await kb.press('ArrowRight')
    kb.note('ArrowRight in question 1', { answers: await answers() })
    const tabsBefore = kb.tabs
    await kb.tab()
    await kb.at('Tab from question 1 (next group, or the next stop?)')
    kb.note('Tab presses from answered Q1 to Q2', { presses: kb.tabs - tabsBefore })
    await kb.shiftTab()
    // Enter on a radio of the questions form: does it submit the whole block with the other questions blank?
    kb.note('about to press Enter on a radio of question 1', { answers: await answers(), status: await reading.locator('.hb-status').innerText() })
    await kb.press('Enter')
    await kb.at('reading: after Enter on a radio (block over?)', { questionsStillThere: await reading.locator('form.questions').count(), status: await statusOf(page, 'reading') }, 500)
    await kb.shots.shot('reading-after-enter', { fullPage: false })
    save(project, 'coding', kb)
  })

  test('blocks: reaction time with the skip panel opened mid-block', async ({ page, browserName }, testInfo) => {
    const project = testInfo.project.name
    await intoFast(page, 0)
    const kb = await kbFor(page, browserName, project, 'rt-skip')
    const rt = page.locator('section.hb-render.rt')
    const id = (await rt.getAttribute('aria-labelledby')) ?? ''
    await kb.tabTo('Start practice', rt.getByRole('button', { name: 'Start practice' }))
    await kb.press('Enter')
    // through the practice quickly (no responses): the block waits at "ready" for its button
    await expect(rt.getByRole('button', { name: 'Start', exact: true })).toBeVisible({ timeout: 20_000 })
    await kb.at('practice over (no responses given)', { status: await statusOf(page, 'rt') })
    await kb.press('Enter')
    await kb.at('counted trials started')
    const progress = (): Promise<string> => rt.locator('.progress').innerText({ timeout: 500 }).catch(() => '(block gone)')
    kb.note('progress when the panel is about to open', { progress: await progress() })
    // Shift+Tab from the stage to the Skip opener
    const opener = page.locator('.actions').getByRole('button', { name: /^Skip / })
    for (let i = 0; i < 4; i++) {
      if (await opener.evaluate((el) => el === document.activeElement).catch(() => false)) break
      await kb.shiftTab()
    }
    await kb.at('on the Skip opener (Shift+Tab from the stage)')
    await kb.press('Enter')
    await kb.at('after Enter on the opener: panel open')
    await kb.shots.shot('rt-skip-panel-open', { fullPage: false })
    await page.waitForTimeout(1500)
    kb.note('1.5 s later (the block runs on behind the panel)', { progress: await progress(), panelOpen: (await page.locator('section.confirm').count()) > 0, focus: (await probe(page)).what })
    await kb.tabTo('Keep going', page.locator('section.confirm').getByRole('button', { name: 'Keep going' }))
    await kb.press('Enter')
    const back = await kb.at('after Keep going: focus returns to the opener')
    // Now the person answers the next target with Space, as the block asked: where does the key go?
    await page.waitForFunction(`!!document.querySelector('section.hb-render.rt .pad.on')`, undefined, { polling: 'raf', timeout: 8000 }).catch(() => undefined)
    await kb.press('Space')
    await page.waitForTimeout(300)
    kb.note('Space pressed with focus on the opener (a target was showing)', { focusWas: back.what, panelOpenAgain: (await page.locator('section.confirm').count()) > 0, focusNow: (await probe(page)).what, progress: await progress() })
    await kb.shots.shot('rt-space-on-opener', { fullPage: false })
    // wait for the block to end while a panel may be open: what happens to focus?
    if ((await page.locator('section.confirm').count()) === 0) {
      await kb.shiftTab()
      await kb.press('Enter')
      await kb.at('panel opened again to watch the block end')
    }
    await blockGone(page, 'rt', id, 60_000).catch(() => undefined)
    await kb.at('block over while the panel was open', { panelOpen: (await page.locator('section.confirm').count()) > 0, h1: ((await h1(page).textContent().catch(() => '')) ?? '').trim() }, 800)
    save(project, 'rt-skip', kb)
  })
})

// ------------------------------------------------------------------------------------------------ results

import { toResults } from '../../e2e/flow'

/** Wait for the profile to be built (the build-up is part of the page's own clock, not `?fast=1`). */
async function builtResults(page: Page): Promise<void> {
  await expect(h1(page)).toHaveText('Session complete')
  await expect(page.locator('.reveal [role="status"]').first()).toHaveText('Your profile is ready.', { timeout: 60_000 })
}

test.describe('results', () => {
  test.beforeEach(async ({ page, browserName }, testInfo) => {
    test.skip(testInfo.project.use.hasTouch === true, 'a touch phone has no Tab key')
    // Safari's chord probe resets focus to the document: do it on the blank page, before the screen under test opens.
    await chordFor(page, browserName)
  })

  test('results: chart, drill-down, save, share card, AI links by keyboard', async ({ page, context, browserName }, testInfo) => {
    const project = testInfo.project.name
    test.setTimeout(6 * 60_000)
    await toResults(page, 1)
    const kb = await kbFor(page, browserName, project, 'results')
    await kb.at('results arrive (h1 should hold focus)', { building: await page.locator('.reveal').getAttribute('data-building') }, 100)
    // 1. Skip animation by keyboard (while it still builds)
    if ((await page.locator('.reveal').getAttribute('data-building')) === 'true') {
      await kb.tabTo('Skip animation', button(page, 'Skip animation'))
      await kb.press('Enter')
      await kb.at('after Enter on Skip animation (focus moves to Replay?)', { building: await page.locator('.reveal').getAttribute('data-building') })
    }
    await builtResults(page)
    await kb.at('profile ready', { announced: await page.locator('.reveal [role="status"]').first().innerText() })
    await kb.shots.shot('results-built', { fullPage: false })
    // 2. view toggle
    await page.evaluate(() => window.scrollTo(0, 0))
    const pressed = (): Promise<string[]> => page.evaluate(() => [...document.querySelectorAll('.toolbar button[aria-pressed]')].map((b) => `${b.textContent}:${b.getAttribute('aria-pressed')}`))
    await kb.tabTo('Bar view', button(page, 'Bar view'))
    kb.note('Tab presses to Bar view from the heading', { tabs: kb.tabs })
    await kb.press('Enter')
    await kb.at('after Enter on Bar view', { pressed: await pressed() })
    await kb.shots.shot('results-bar-view', { fullPage: false })
    await kb.press('ArrowLeft')
    kb.note('ArrowLeft on the toggle (no arrow handling expected)', { focus: (await probe(page)).what })
    await kb.press('Shift+Tab')
    await kb.press('Enter')
    await kb.at('back to Blob view with Enter', { pressed: await pressed() })
    // 3. drill-down
    const before = kb.tabs
    await kb.tabTo('Speed cluster', button(page, 'Speed'))
    kb.note('Tab presses from the view toggle to the Speed cluster button', { presses: kb.tabs - before })
    await kb.press('Enter')
    const facets = await page.locator('[id$="-facets"]').first().innerText().catch(() => '')
    await kb.at('after Enter on Speed', { expanded: await button(page, 'Speed').getAttribute('aria-expanded'), facetsText: facets.replace(/\s+/g, ' ').slice(0, 200) })
    await kb.shots.shot('results-drilldown', { fullPage: false })
    await kb.tab()
    await kb.at('next Tab after opening a cluster (into the facets, or the next cluster?)')
    await kb.shiftTab()
    await kb.press('Enter')
    kb.note('Enter again on Speed closes it', { expanded: await button(page, 'Speed').getAttribute('aria-expanded') })
    // 4. save: cost from the heading
    const beforeSave = kb.tabs
    await kb.tabTo('Download save file', button(page, 'Download save file'))
    kb.note('Tab presses from the last cluster button to Download save file', { presses: kb.tabs - beforeSave })
    const dl = page.waitForEvent('download')
    await kb.press('Enter')
    await dl
    await kb.at('after Enter on Download save file', { message: await page.locator('[data-section="save"]').innerText().catch(() => '') }, 600)
    await kb.shots.shot('results-after-download', { fullPage: false })
    await expect(page.locator('[data-share-card]')).toBeVisible()
    // 5. share card
    const skills = page.locator('[data-share-card] fieldset.skills input[type=checkbox]')
    const sCost = await kb.tabTo('first skill checkbox', skills.first())
    kb.note('Tab presses from Download save file to the first skill toggle', { presses: sCost.presses, visited: sCost.visited })
    await kb.shots.shot('share-card-skills-focus', { fullPage: false })
    await kb.press('Space')
    await kb.at('Space on a skill checkbox', { checked: await skills.first().isChecked(), live: await page.locator('[data-share-card] [role=status], [data-share-card] [aria-live]').allInnerTexts() })
    await kb.press('Space')
    await kb.shiftTab(2)
    await kb.at('two Shift+Tab back to Show all / Hide all')
    const hide = page.locator('[data-share-card]').getByRole('button', { name: 'Hide all' })
    await kb.tabTo('Hide all', hide)
    await kb.press('Enter')
    await kb.at('after Enter on Hide all', { cardText: (await page.locator('[data-share-card]').innerText()).replace(/\s+/g, ' ').slice(0, 300), downloads: await page.locator('[data-share-card]').getByRole('button', { name: /Download/ }).count() })
    await kb.shots.shot('share-card-hide-all', { fullPage: false })
    await kb.shiftTab()
    await kb.press('Enter')
    await kb.at('Show all with Enter')
    const radios = page.locator('[data-share-card] input[type=radio]')
    await kb.tabTo('card colour radio', radios.first())
    await kb.press('ArrowDown')
    await kb.at('ArrowDown on the colour radios', { checked: await radios.evaluateAll((r) => r.map((x) => (x as HTMLInputElement).checked)) })
    await kb.press('ArrowDown')
    await kb.press('ArrowUp')
    const pngBtn = page.locator('[data-share-card]').getByRole('button', { name: 'Download image (PNG)' })
    const pngCost = await kb.tabTo('Download image (PNG)', pngBtn)
    kb.note('Tab presses from the colour radios to Download image (PNG)', { presses: pngCost.presses })
    const png = page.waitForEvent('download')
    await kb.press('Enter')
    await png.catch(() => undefined)
    await kb.at('after Enter on Download image (PNG)', { status: await page.locator('[data-share-card] [role=status]').allInnerTexts().catch(() => []) }, 800)
    // 6. the link to the results-talk helper
    const talk = page.getByRole('link', { name: 'Read this first' })
    await kb.tabTo('Talking link', talk)
    await kb.press('Enter')
    const t = await kb.at('after Enter on the Talking about your results link', { url: page.url(), active: await page.evaluate(() => `${document.activeElement?.tagName}#${document.activeElement?.id}`) }, 400)
    await kb.shots.shot('talk-helper-focus', { fullPage: false })
    kb.note('the helper block: ring and place', { ring: t.ring, rect: t.rect, plain: t.plain })
    // 7. notes link opens a new tab
    const notes = page.getByRole('link', { name: /Make notes for your AI/ })
    await kb.tabTo('Make notes link', notes)
    const popup = context.waitForEvent('page', { timeout: 5000 }).catch(() => null)
    await kb.press('Enter')
    const np = await popup
    kb.note('Enter on the notes link', { openedNewTab: np !== null, url: np?.url() ?? '' })
    if (np) await np.close().catch(() => undefined)
    await page.bringToFront()
    // 8. focus session picker
    const startFocus = page.getByRole('button', { name: /Start a 20-minute focus session/ })
    await kb.tabTo('Start a focus session', startFocus)
    await kb.press('Enter')
    await kb.at('Enter on Start a focus session with no skill ticked', { h1: ((await h1(page).textContent().catch(() => '')) ?? '').trim(), alert: await page.locator('[role=alert]').allInnerTexts() }, 500)
    await kb.shots.shot('focus-session-empty', { fullPage: false })
    save(project, 'results', kb)
  })

  test('results: leave without saving and Escape', async ({ page, browserName }, testInfo) => {
    const project = testInfo.project.name
    test.setTimeout(6 * 60_000)
    await toResults(page, 1)
    await builtResults(page)
    const kb = await kbFor(page, browserName, project, 'results-leave')
    await kb.tabTo('Back to the start', button(page, 'Back to the start'))
    kb.note('Tab presses from the heading to Back to the start (unsaved)', { tabs: kb.tabs })
    await kb.press('Enter')
    await kb.at('panel Leave without saving? is open', { scrollY: await page.evaluate(() => Math.round(window.scrollY)) })
    await kb.shots.shot('leave-panel', { fullPage: false })
    await kb.press('Escape')
    await kb.at('after Escape', { panelOpen: (await page.locator('section.confirm').count()) > 0 })
    await kb.tabTo('Stay and save', button(page, 'Stay and save'))
    await kb.press('Enter')
    const p = await kb.at('after Enter on Stay and save (where is focus, where is the save button?)', {
      scrollY: await page.evaluate(() => Math.round(window.scrollY)),
      saveButtonTop: await button(page, 'Download save file').evaluate((el) => Math.round(el.getBoundingClientRect().top)),
      saveInView: await button(page, 'Download save file').evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight }),
    })
    await kb.shots.shot('after-stay-and-save', { fullPage: false })
    kb.note('focus after Stay and save', { what: p.what })
    // Tab presses back to the save button
    let n = 0
    for (; n < 40; n++) {
      if (await button(page, 'Download save file').evaluate((el) => el === document.activeElement)) break
      await kb.shiftTab()
    }
    kb.note('Shift+Tab presses from there back to Download save file', { presses: n })
    save(project, 'results-leave', kb)
  })
})

// ------------------------------------------------------------------------------------------------ notes and self-test

test.describe('notes and self-test', () => {
  test.beforeEach(async ({ page, browserName }, testInfo) => {
    test.skip(testInfo.project.use.hasTouch === true, 'a touch phone has no Tab key')
    // Safari's chord probe resets focus to the document: do it on the blank page, before the screen under test opens.
    await chordFor(page, browserName)
  })

  test('notes: the builder end to end by keyboard', async ({ page, browserName }, testInfo) => {
    const project = testInfo.project.name
    test.setTimeout(5 * 60_000)
    await page.goto('./notes.html')
    await expect(page.locator('#notes-text')).toContainText('How I like explanations')
    const kb = await kbFor(page, browserName, project, 'notes')
    const live = (): Promise<string[]> => page.evaluate(() => [...document.querySelectorAll('[aria-live], [role=status], [role=alert]')].map((e) => `${e.getAttribute('role') ?? 'live'}:${(e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)}`).filter((s) => !s.endsWith(':')))
    kb.note('landmarks and live regions on load', { live: await live(), skipLink: await page.locator('a[href^="#"]').count(), mainCount: await page.locator('main').count() })
    await kb.at('notes.html loaded (nothing focused expected)')
    await kb.tab()
    const first = await kb.at('first Tab stop')
    kb.note('first stop', { what: first.what, rect: first.rect })
    await kb.shots.shot('notes-first-tab', { fullPage: false })
    // 1. where: radios
    await kb.tabTo('where radios (the checked one)', page.getByRole('group', { name: /Use for set 1/ }).locator('input[type=radio]:checked'))
    kb.note('Tab presses to the where-picker', { tabs: kb.tabs })
    const noteText = (): Promise<string> => page.locator('#notes-text').innerText().then((t) => t.replace(/\s+/g, ' ').slice(0, 120))
    const t0 = await noteText()
    await kb.press('ArrowDown')
    await kb.at('ArrowDown in the where-picker (selects and updates the notes)', { changed: t0 !== (await noteText()), checked: await page.getByRole('group', { name: /Use for set 1/ }).getByRole('radio').evaluateAll((r) => r.map((x) => (x as HTMLInputElement).checked)) })
    // 2. topics
    const topicBtn = page.getByRole('group', { name: /Suggested topics/ }).getByRole('button').first()
    await kb.tabTo('first suggested topic', topicBtn)
    const nameBefore = (await topicBtn.textContent()) ?? ''
    await kb.press('Enter')
    await kb.at('after Enter on a topic button', { nameBefore: nameBefore.trim(), nameAfter: ((await page.getByRole('group', { name: /Suggested topics/ }).getByRole('button').first().textContent()) ?? '').trim(), pressed: await topicBtn.getAttribute('aria-pressed').catch(() => null), live: await live() })
    await kb.shots.shot('notes-topic-toggled', { fullPage: false })
    // after a topic is chosen the fit rows (Too basic / About right / Too much)
    const fitBtn = page.getByRole('button', { name: 'About right' }).first()
    const fitCost = await kb.tabTo('About right (fit row)', fitBtn).catch(() => ({ presses: -1, label: '', visited: [] as string[] }))
    kb.note('Tab presses to the first fit button', { presses: fitCost.presses })
    if (fitCost.presses >= 0) {
      await kb.press('Enter')
      await kb.at('after Enter on About right', { pressed: await fitBtn.getAttribute('aria-pressed').catch(() => null), live: await live() })
    }
    // 3. extras
    const hobbies = page.getByLabel(/Hobbies or subjects/)
    const hc = await kb.tabTo('hobbies field', hobbies)
    kb.note('Tab presses from the fit row to the hobbies field', { presses: hc.presses })
    await kb.type('chess')
    await kb.press('Enter')
    await kb.at('Enter in the hobbies field', { value: await hobbies.inputValue(), urlHasQuery: page.url().includes('?') })
    // 4. the notes: per-line checkboxes and Why this line
    const why = page.getByText('Why this line?').first()
    await kb.tabTo('first Why this line', why)
    await kb.press('Enter')
    await kb.at('after Enter on Why this line?', { open: await why.evaluate((el) => (el.closest('details') as HTMLDetailsElement | null)?.open ?? null) })
    await kb.shots.shot('notes-why-open', { fullPage: false })
    // 5. copy
    const copy = page.getByRole('button', { name: 'Copy the notes' })
    const cc = await kb.tabTo('Copy the notes', copy)
    kb.note('Tab presses from "Why this line" to Copy the notes', { presses: cc.presses })
    await kb.press('Enter')
    await kb.at('after Enter on Copy the notes', { live: await live(), label: ((await copy.textContent()) ?? '').trim() }, 500)
    await kb.shots.shot('notes-after-copy', { fullPage: false })
    // 6. keep settings: error path then success
    const keep = page.getByRole('button', { name: 'Keep my settings on this device' })
    await kb.tabTo('Keep my settings', keep)
    await kb.press('Enter')
    await kb.at('Enter on Keep my settings without the 18+ box', { alerts: await page.locator('[role=alert]').allInnerTexts(), invalid: await page.getByLabel('I am 18 or older').getAttribute('aria-invalid').catch(() => null) }, 400)
    await kb.shots.shot('notes-keep-error', { fullPage: false })
    await kb.shiftTab()
    await kb.press('Space')
    await kb.tab()
    await kb.press('Enter')
    await kb.at('Keep my settings after ticking the box', { live: await live() }, 500)
    // 7. checker
    const ta = page.getByRole('textbox', { name: 'Notes to check' })
    await kb.tabTo('Notes to check textarea', ta)
    await kb.type('Be brief.')
    await kb.tab()
    await kb.at('Tab from the textarea')
    await kb.press('Enter')
    await kb.at('after Enter on Check these notes', { live: await live() }, 500)
    await kb.shots.shot('notes-checker', { fullPage: false })
    // 8. how far is the end?
    kb.note('stops on the whole page', { count: (await probe(page)).none ? -1 : 0 })
    save(project, 'notes', kb)
  })

  test('selftest: the key phase by keyboard', async ({ page, browserName }, testInfo) => {
    const project = testInfo.project.name
    test.setTimeout(3 * 60_000)
    await page.goto('./rt-selftest.html?quick=1')
    const kb = await kbFor(page, browserName, project, 'selftest')
    const text = (): Promise<string> => page.locator('main').innerText().then((t) => t.replace(/\s+/g, ' ').slice(0, 300))
    kb.note('page text on load', { text: await text() })
    await kb.at('rt-selftest loaded')
    await kb.tab()
    await kb.at('first Tab stop')
    await kb.shots.shot('selftest-first-tab', { fullPage: false })
    const start = page.getByRole('button', { name: 'Start' })
    await kb.tabTo('Start', start)
    await kb.press('Enter')
    await kb.at('right after Enter on Start (the Start button is disabled while it measures)', {}, 200)
    await expect(page.locator('#keys-heading')).toBeVisible({ timeout: 60_000 })
    const keysFocus = await kb.at('key phase begins', { text: (await page.locator('section.task').innerText()).replace(/\s+/g, ' ') }, 300)
    await kb.shots.shot('selftest-keys', { fullPage: false })
    kb.note('focus in the key phase', { what: keysFocus.what, plain: keysFocus.plain })
    const need = Number(/(\d+) of (\d+)/.exec(await page.locator('section.task p.zone').innerText())?.[2] ?? '3')
    for (let i = 0; i < need; i++) {
      await kb.press('Space')
      await page.waitForTimeout(150)
    }
    await expect(page.locator('#pointer-heading')).toBeVisible({ timeout: 10_000 })
    await kb.at('pointer phase begins', { text: (await page.locator('section.task').innerText()).replace(/\s+/g, ' ') }, 300)
    await kb.shots.shot('selftest-pointer', { fullPage: false })
    const target = page.getByRole('button', { name: 'Tap target' })
    await kb.tabTo('Tap target', target)
    for (let i = 0; i < 3; i++) await kb.press('Enter')
    await kb.press('Space')
    kb.note('Enter x3 and Space on the Tap target button', { counter: (await page.locator('section.task p').first().innerText()).replace(/\s+/g, ' '), ring: (await probe(page)).ring !== null })
    await kb.tabTo('Skip: no mouse or touch', page.getByRole('button', { name: /Skip: no mouse or touch/ }))
    await kb.press('Enter')
    await expect(page.locator('#results-heading')).toBeVisible({ timeout: 10_000 })
    const res = await kb.at('results arrive', { rows: await page.locator('table tbody tr').count() }, 300)
    kb.note('focus on the results', { what: res.what, plain: res.plain })
    await kb.shots.shot('selftest-results', { fullPage: false })
    save(project, 'selftest', kb)
  })
})

// ------------------------------------------------------------------------------------------------ the whole session

const SCREEN_KIND = `(() => {
  const text = ((document.querySelector('h1') || {}).textContent || '').trim()
  if (text === 'Session complete' || text === 'Session ended') return 'finished'
  if (document.querySelector('input[type=range]')) return 'confidence'
  if (document.querySelector('form.choice:not(:has(fieldset:disabled))')) return 'choice'
  if (document.querySelector('form.entry')) return 'entry'
  for (const k of ['rt', 'span', 'corsi', 'coding', 'reading']) if (document.querySelector('section.hb-render.' + k)) return k
  if (/^Up next:/.test(text)) return 'interstitial'
  if (text === 'Time for a break?') return 'break'
  return 'other'
})()`

interface KindStats {
  screens: number
  keys: number
  tabs: number
  landings: string[]
}

test.describe('session', () => {
  test.beforeEach(async ({ page, browserName }, testInfo) => {
    test.skip(testInfo.project.use.hasTouch === true, 'a touch phone has no Tab key')
    // Safari's chord probe resets focus to the document: do it on the blank page, before the screen under test opens.
    await chordFor(page, browserName)
  })

  test('session: a whole ?fast=1 session by keyboard alone, counting presses per screen kind', async ({ page, browserName }, testInfo) => {
    test.setTimeout(10 * 60_000)
    const project = testInfo.project.name
    const log = trackConsole(page)
    const kb = await kbFor(page, browserName, project, 'session')
    const stats: Record<string, KindStats> = {}
    const arrivals: string[] = []
    const t0 = Date.now()
    /** Record a screen: where focus is on arrival, then the keys and Tabs its handling takes. */
    async function screen(kind: string, work: () => Promise<void>): Promise<void> {
      await page.waitForTimeout(150)
      const p = await probe(page)
      const landing = p.none ? 'BODY' : p.plain ? `plain ${p.tag}` : `control ${p.what}`
      const heading = ((await h1(page).textContent().catch(() => '')) ?? '').trim()
      arrivals.push(`${kind} | ${heading} | ${landing}`)
      const s = (stats[kind] ??= { screens: 0, keys: 0, tabs: 0, landings: [] })
      s.screens++
      s.landings.push(landing)
      const k = kb.keys
      const t = kb.tabs
      await work()
      s.keys += kb.keys - k
      s.tabs += kb.tabs - t
    }

    // ---- the start
    await page.goto('./?fast=1')
    await expect(h1(page)).toHaveText('HumanBench')
    await screen('welcome', async () => {
      await kb.tabTo('Start', button(page, 'Start'))
      await kb.press('Enter')
    })
    await expect(h1(page)).toHaveText('Before you start')
    await screen('gate', async () => {
      await kb.tabTo('18+ checkbox', page.getByRole('checkbox', { name: /18 or older/ }))
      await kb.press('Space')
      await kb.tabTo('Continue', button(page, 'Continue'))
      await kb.press('Enter')
    })
    await expect(h1(page)).toHaveText('Honour code')
    await screen('honour', async () => {
      await kb.tabTo('honour checkbox', page.getByRole('checkbox', { name: /honour code/ }))
      await kb.press('Space')
      await kb.tabTo('Continue', button(page, 'Continue'))
      await kb.press('Enter')
    })
    await expect(h1(page)).toHaveText('Check your device')
    await screen('device', async () => {
      const waited = Date.now()
      await expect(button(page, 'Continue')).toBeEnabled({ timeout: 20_000 })
      kb.note('device check: wait before Continue enables (ms)', { ms: Date.now() - waited })
      await kb.tabTo('Continue', button(page, 'Continue'))
      await kb.press('Enter')
    })
    await expect(h1(page)).toHaveText('Ready when you are')
    await screen('ready', async () => {
      await kb.tabTo('Begin', button(page, 'Begin'))
      await kb.press('Enter')
    })

    // ---- the parts
    const confidence = async (): Promise<void> => {
      await expect(page.getByRole('slider')).toBeVisible()
      await kb.press('ArrowRight')
      await kb.press('Enter')
    }
    const itemHandlers: Record<string, () => Promise<void>> = {
      interstitial: async () => {
        await kb.tabTo('Start', button(page, 'Start'))
        await kb.press('Enter')
      },
      break: async () => {
        await kb.tabTo('Keep going', button(page, 'Keep going'))
        await kb.press('Enter')
      },
      choice: async () => {
        await kb.tabTo('first option', page.locator('form.choice input[type=radio]').first())
        await kb.press('b')
        await kb.press('Enter')
        await expect(page.getByRole('slider')).toBeVisible()
      },
      entry: async () => {
        await kb.tabTo('box', page.locator('form.entry input[type=text]'))
        await kb.type('1')
        await kb.press('Enter')
        if (!(await page.getByRole('slider').isVisible({ timeout: 1500 }).catch(() => false))) {
          await kb.press('ControlOrMeta+A')
          await kb.type('A')
          await kb.press('Enter')
        }
        await expect(page.getByRole('slider')).toBeVisible()
      },
      confidence,
      rt: async () => {
        await rtByKeys(kb, 'session RT')
      },
      span: async () => {
        const span = page.locator('section.hb-render.span')
        const id = (await span.getAttribute('aria-labelledby')) ?? ''
        await kb.tabTo('Start', span.getByRole('button', { name: 'Start' }))
        await kb.press('Enter')
        for (let guard = 0; guard < 40; guard++) {
          const phase = await page
            .waitForFunction(
              `(() => { const root = document.querySelector('section.hb-render.span'); if (!root || root.getAttribute('aria-labelledby') !== ${JSON.stringify(id)}) return 'gone'; const t = (root.querySelector('.hb-status') || {}).textContent || ''; if (/Block complete/.test(t)) return 'done'; if (/^Enter \\d+ digits/.test(t)) return 'entry'; return '' })()`,
              undefined,
              { polling: 'raf', timeout: 20_000 },
            )
            .then((h) => h.jsonValue() as Promise<string>)
          if (phase !== 'entry') break
          await kb.type('123456789')
          await kb.press('Enter')
          await page.waitForFunction(`!/^Enter \\d+ digits/.test(((document.querySelector('section.hb-render.span .hb-status') || {}).textContent) || '')`, undefined, { polling: 'raf', timeout: 5000 }).catch(() => undefined)
        }
        await blockGone(page, 'span', id, 30_000)
      },
      corsi: async () => {
        const corsi = page.locator('section.hb-render.corsi')
        const id = (await corsi.getAttribute('aria-labelledby')) ?? ''
        await kb.tabTo('Start', corsi.getByRole('button', { name: 'Start' }))
        await kb.press('Enter')
        for (let guard = 0; guard < 40; guard++) {
          const phase = await page
            .waitForFunction(
              `(() => { const root = document.querySelector('section.hb-render.corsi'); if (!root || root.getAttribute('aria-labelledby') !== ${JSON.stringify(id)}) return 'gone'; const t = (root.querySelector('.hb-status') || {}).textContent || ''; if (/Block complete/.test(t)) return 'done'; if (/^Selected \\d+ of \\d+/.test(t)) return 'entry'; return '' })()`,
              undefined,
              { polling: 'raf', timeout: 20_000 },
            )
            .then((h) => h.jsonValue() as Promise<string>)
          if (phase !== 'entry') break
          for (const k of ['1', '2', '3']) await kb.press(k)
          await kb.tabTo('Done', corsi.getByRole('button', { name: 'Done' }))
          await kb.press('Enter')
          await page.waitForFunction(`!/^Selected \\d+ of \\d+/.test(((document.querySelector('section.hb-render.corsi .hb-status') || {}).textContent) || '')`, undefined, { polling: 'raf', timeout: 5000 }).catch(() => undefined)
        }
        await blockGone(page, 'corsi', id, 30_000)
      },
      coding: async () => {
        const coding = page.locator('section.hb-render.coding')
        const id = (await coding.getAttribute('aria-labelledby')) ?? ''
        await kb.tabTo('Start', coding.getByRole('button', { name: 'Start' }))
        await kb.press('Enter')
        await expect(coding.getByRole('timer')).toBeVisible()
        for (let i = 0; i < 4000; i++) {
          await page.keyboard.press(String(1 + (i % 9)))
          if (i % 25 === 0 && (await coding.locator('.hb-status').innerText({ timeout: 300 }).catch(() => 'over')).trim() !== '') break
        }
        await blockGone(page, 'coding', id, 30_000)
      },
      reading: async () => {
        const reading = page.locator('section.hb-render.reading')
        await kb.tabTo('Show the passage', reading.getByRole('button', { name: 'Show the passage' }))
        await kb.press('Enter')
        await expect(reading.getByRole('button', { name: 'Done reading' })).toBeEnabled()
        await kb.tabTo('Done reading', reading.getByRole('button', { name: 'Done reading' }))
        await kb.press('Enter')
        for (const group of await reading.locator('fieldset.question').all()) {
          await kb.tabTo('question', group.locator('input[type=radio]').first())
          await kb.press('Space')
        }
        await kb.tabTo('Submit answers', reading.getByRole('button', { name: 'Submit answers' }))
        await kb.press('Enter')
      },
    }
    let steps = 0
    for (; steps < 3000; steps++) {
      const kind = await page.evaluate<string>(SCREEN_KIND)
      if (kind === 'finished') break
      const handler = itemHandlers[kind]
      if (!handler) {
        await page.waitForTimeout(100)
        continue
      }
      await screen(kind, handler)
      if (Date.now() - t0 > 8 * 60_000) throw new Error('the session took too long')
    }
    kb.note('session finished', { steps, seconds: Math.round((Date.now() - t0) / 1000) })

    // ---- the results
    await expect(page.locator('.reveal [role="status"]').first()).toHaveText('Your profile is ready.', { timeout: 60_000 })
    await screen('results', async () => {
      const dl = page.waitForEvent('download')
      await kb.tabTo('Download save file', button(page, 'Download save file'))
      await kb.press('Enter')
      await dl
      await kb.tabTo('Back to the start', button(page, 'Back to the start'))
      await kb.press('Enter')
    })
    await expect(h1(page)).toHaveText('HumanBench')
    await screen('welcome-again', async () => undefined)
    const table = Object.fromEntries(Object.entries(stats).map(([k, s]) => [k, { screens: s.screens, keys: s.keys, tabs: s.tabs, keysPerScreen: Math.round((s.keys / s.screens) * 10) / 10, tabsPerScreen: Math.round((s.tabs / s.screens) * 10) / 10, landings: [...new Set(s.landings)] }]))
    kb.note('per screen kind', table)
    kb.note('arrivals (kind | heading | where focus was)', arrivals)
    kb.note('console', { errors: log.errors.length, pageErrors: log.pageErrors.length })
    save(project, 'session', kb, { table, arrivals })
    console.log(`[kbd ${project}] session total: ${kb.keys} keys, ${kb.tabs} tabs, ${steps} steps`)
    console.log(JSON.stringify(table))
  })
})


// ------------------------------------------------------------------------------------------------ dark scheme rings

test.describe('dark', () => {
  test.use({ colorScheme: 'dark' })
  test('routes: dark scheme focus rings', async ({ context, browserName }, testInfo) => {
    test.skip(testInfo.project.use.hasTouch === true, 'a touch phone has no Tab key')
    const project = testInfo.project.name
    const ids = ['welcome', 'gate', 'ready', 'confidence', 'item-spatial', 'memory-corsi', 'results', 'share-card-dark', 'notes', 'rt-selftest-keys']
    const rows: string[] = []
    for (const route of PREVIEW_ROUTES.filter((r) => ids.includes(r.id))) {
      const rep = await probeRoute(context, browserName, project, route, '-dark')
      const contrasts = (rep.stops ?? []).map((s) => s.ringContrast).filter((c): c is number => c !== null)
      const row = `${route.id.padEnd(20)} ${rep.ok ? 'ok ' : 'ERR'} stops=${rep.stopCount ?? '-'} minRingContrast=${contrasts.length ? Math.min(...contrasts) : '-'} problems=${JSON.stringify(rep.problems ?? [])} ${rep.error ?? ''}`
      rows.push(row)
      console.log(`[kbd ${project} dark] ${row}`)
    }
    writeJson(path.join(UX_ROOT, RUN, `routes-${project}-dark`), '_summary-dark.json', rows)
  })
})

// ------------------------------------------------------------------------------------------------ the start screens

test.describe('start', () => {
  test.beforeEach(async ({ page, browserName }, testInfo) => {
    test.skip(testInfo.project.use.hasTouch === true, 'a touch phone has no Tab key')
    // Safari's chord probe resets focus to the document: do it on the blank page, before the screen under test opens.
    await chordFor(page, browserName)
  })

  test('start: privacy notice and back, gate error, under-18 dead end', async ({ page, context, browserName }, testInfo) => {
    const project = testInfo.project.name
    await page.goto('./')
    const kb = await kbFor(page, browserName, project, 'start')
    // welcome -> privacy (same tab) -> back
    await kb.tabTo('Privacy and terms', page.getByRole('link', { name: 'Privacy and terms' }))
    await kb.press('Enter')
    await kb.at('after Enter on Privacy and terms', { url: page.url(), h1: ((await h1(page).textContent().catch(() => '')) ?? '').trim() }, 400)
    await kb.tabTo('Back', page.getByRole('link', { name: 'Back', exact: true }))
    await kb.press('Enter')
    await kb.at('after Enter on Back (the welcome page again)', { url: page.url(), h1: ((await h1(page).textContent().catch(() => '')) ?? '').trim() }, 400)
    await kb.tab()
    await kb.at('first Tab after coming back')
    // gate: error path by keyboard
    await kb.tabTo('Start', button(page, 'Start'))
    await kb.press('Enter')
    await expect(h1(page)).toHaveText('Before you start')
    await kb.at('gate arrives')
    const privacyLink = page.getByRole('link', { name: /Read the full privacy notice/ })
    await kb.tabTo('privacy link', privacyLink)
    const popup = context.waitForEvent('page', { timeout: 4000 }).catch(() => null)
    await kb.press('Enter')
    const np = await popup
    kb.note('Enter on the gate privacy link', { opensNewTab: np !== null, url: np?.url() ?? '' })
    if (np) await np.close().catch(() => undefined)
    await page.bringToFront()
    await kb.tabTo('Continue', button(page, 'Continue'))
    await kb.press('Enter')
    await kb.at('Enter on Continue with the box unticked', { alert: await page.locator('[role=alert]').allInnerTexts(), alertInView: await page.locator('[role=alert]').first().evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight }).catch(() => null) }, 300)
    await kb.shots.shot('gate-error', { fullPage: false })
    // Tab once too far: "I am under 18" is the next stop after Continue
    await kb.tab()
    const under = await kb.at('Tab after Continue')
    await kb.press('Enter')
    await kb.at('Enter on "I am under 18"', { h1: ((await h1(page).textContent().catch(() => '')) ?? '').trim(), controls: await page.locator('main button, main a[href], main input').count() }, 300)
    await kb.shots.shot('under-18', { fullPage: false })
    await kb.tab()
    await kb.at('Tab on the blocked screen')
    kb.note('under-18 screen: any way back?', { was: under.what, links: await page.locator('a[href]:visible, button:visible').count() })
    save(project, 'start', kb)
  })
})
