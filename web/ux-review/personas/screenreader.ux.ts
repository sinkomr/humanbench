/// <reference lib="dom" />
/**
 * Persona "Jordan": a blind screen-reader user (VoiceOver on a Mac and an iPhone) who moves by headings and
 * landmarks and relies on announcements. No real screen reader runs here, so the review judges from what a
 * screen reader is given: the accessibility tree (`ariaSnapshot`), roles, accessible names and descriptions,
 * `document.title`, where focus is after each screen change, and the live regions (an init script logs every
 * text change of every live region with a timestamp, and samples focus and the title every 50 ms).
 *
 *   UX_PORT=4613 UX_RUN=screenreader npx playwright test -c ux-review/playwright.ux.config.ts \
 *     ux-review/personas/screenreader.ux.ts --project=chromium --grep 'sr audit: start'
 *
 * Tests (each short enough to run on its own with --grep):
 *   sr audit: <start|session|results|notes|selftest>  every product route of the group on a fresh context: screenshot,
 *                                                       text, aria tree, pageMetrics with axe, and a screen-reader audit
 *                                                       (title, headings, landmarks, names, radio groups, label-in-name,
 *                                                       described-by targets, live regions, focus, where "skip" sits)
 *   sr session: announcements and focus                 a whole ?fast=1 session with the live-region log, then the reveal,
 *                                                       the save, the share card, the bar view and the drill-down
 *   sr forms: errors tied to fields                      gate-error, honour error, a bad save file, notes-keep-error, and
 *                                                       live-region chatter while typing in the notes builder
 *   sr webkit: tree compare                              (--project=webkit) the trees of the stimuli and the results
 *
 * Output: web/test-results/ux-review/<UX_RUN>/{audit,journey,forms,webkit}/...
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { settleTransitions } from '../../e2e/axe'
import { answerItem, button, h1, toReady } from '../../e2e/flow'
import { openRoute, PREVIEW_ROUTES, type Route, type RouteGroup } from '../../e2e/routes'
import { COPY as NOTES_COPY } from '../../src/brief/copy'
import { pageMetrics, playJourney, PRODUCT_ROUTES, repoRel, Shots, trackConsole, UX_ROOT } from '../lib'

const RUN = process.env.UX_RUN ?? 'screenreader'

// --------------------------------------------------------------------------------------- the init script

/**
 * Installed before any page script: logs every text change of every live region (and every live region that is mounted
 * with text already in it, which many screen readers do not read), every focus move, and samples the active element, the
 * h1 and the title every 50 ms so a focus that lands on the body is caught even between events.
 */
const LIVE_LOG = `(() => {
  const t0 = performance.now()
  const now = () => Math.round(performance.now() - t0)
  const live = []
  const focus = []
  const samples = []
  window.__hbLive = live
  window.__hbFocus = focus
  window.__hbSamples = samples
  const squash = (s) => (s || '').replace(/\\s+/g, ' ').trim()
  const describe = (el) => {
    if (!el || el.nodeType !== 1) return String(el)
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\\s+/).filter((c) => c && !/^svelte-/.test(c)).slice(0, 2).join('.') : ''
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls : '')
  }
  const nameOf = (el) => {
    if (!el || el.nodeType !== 1) return ''
    const aria = el.getAttribute('aria-label')
    if (aria) return squash(aria)
    const by = el.getAttribute('aria-labelledby')
    if (by) return squash(by.split(/\\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' '))
    if (el.labels && el.labels.length) return squash([...el.labels].map((l) => l.textContent).join(' '))
    return squash(el.textContent).slice(0, 80)
  }
  const h1Text = () => squash((document.querySelector('h1') || {}).textContent)
  const LIVE_ROLES = ['status', 'alert', 'log', 'timer', 'marquee']
  const regionOf = (node) => {
    let el = node && node.nodeType === 1 ? node : node ? node.parentElement : null
    while (el && el.nodeType === 1) {
      const role = el.getAttribute('role')
      const al = el.getAttribute('aria-live')
      if (al || (role && LIVE_ROLES.includes(role))) return el
      el = el.parentElement
    }
    return null
  }
  const last = new WeakMap()
  const record = (region, kind) => {
    const text = squash(region.textContent)
    const prev = last.get(region)
    if (prev === text) return
    last.set(region, text)
    const role = region.getAttribute('role') || ''
    const al = region.getAttribute('aria-live') || (role === 'alert' ? 'assertive' : role === 'status' || role === 'log' ? 'polite' : role === 'timer' || role === 'marquee' ? 'off' : '')
    live.push({ t: now(), kind, region: describe(region), role, live: al, atomic: region.getAttribute('aria-atomic') || '', from: prev === undefined ? null : prev, text, h1: h1Text() })
  }
  const LIVE_SEL = '[aria-live],[role=status],[role=alert],[role=log],[role=timer],[role=marquee]'
  const mo = new MutationObserver((muts) => {
    const seen = new Set()
    for (const m of muts) {
      const targets = [m.target]
      if (m.type === 'childList') for (const n of m.addedNodes) targets.push(n)
      for (const n of targets) {
        const r = regionOf(n)
        if (r && !seen.has(r)) { seen.add(r); record(r, last.has(r) ? 'update' : 'mount') }
        if (n && n.nodeType === 1 && n.querySelectorAll) {
          for (const inner of n.querySelectorAll(LIVE_SEL)) if (!seen.has(inner)) { seen.add(inner); record(inner, last.has(inner) ? 'update' : 'mount') }
        }
      }
    }
  })
  const start = () => {
    for (const r of document.querySelectorAll(LIVE_SEL)) last.set(r, squash(r.textContent))
    mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-live', 'role'] })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
  document.addEventListener('focusin', (e) => {
    const el = e.target
    focus.push({ t: now(), el: describe(el), role: el.getAttribute ? el.getAttribute('role') || '' : '', name: nameOf(el), tabindex: el.getAttribute ? el.getAttribute('tabindex') : null, h1: h1Text() })
  }, true)
  let lastSample = ''
  setInterval(() => {
    const a = document.activeElement
    const key = describe(a) + '|' + h1Text() + '|' + document.title
    if (key === lastSample) return
    lastSample = key
    samples.push({ t: now(), active: describe(a), activeIsBody: !a || a === document.body || a === document.documentElement, name: nameOf(a), h1: h1Text(), title: document.title })
  }, 50)
})()`

interface LiveEntry {
  readonly t: number
  readonly kind: 'mount' | 'update'
  readonly region: string
  readonly role: string
  readonly live: string
  readonly atomic: string
  readonly from: string | null
  readonly text: string
  readonly h1: string
}
interface FocusEntry {
  readonly t: number
  readonly el: string
  readonly role: string
  readonly name: string
  readonly tabindex: string | null
  readonly h1: string
}
interface Sample {
  readonly t: number
  readonly active: string
  readonly activeIsBody: boolean
  readonly name: string
  readonly h1: string
  readonly title: string
}
interface Logs {
  readonly live: LiveEntry[]
  readonly focus: FocusEntry[]
  readonly samples: Sample[]
}

async function readLogs(page: Page): Promise<Logs> {
  return page.evaluate<Logs>('({ live: window.__hbLive || [], focus: window.__hbFocus || [], samples: window.__hbSamples || [] })')
}

// --------------------------------------------------------------------------------------- the audit

interface SrAudit {
  readonly title: string
  readonly lang: string
  readonly h1s: string[]
  readonly outline: string[]
  readonly skippedLevels: string[]
  readonly landmarks: string[]
  readonly active: string
  readonly activeIsBody: boolean
  readonly unnamed: string[]
  readonly ungroupedRadios: string[]
  readonly labelInName: string[]
  readonly imagesNoAlt: string[]
  readonly canvases: string[]
  readonly svgImages: string[]
  readonly brokenRefs: string[]
  readonly invalid: string[]
  readonly alerts: string[]
  readonly liveRegions: string[]
  /** Focusable controls in DOM order, with "<h1>" where the heading sits among them. */
  readonly order: string[]
  readonly skipControl: string
}

/** What the page tells a screen reader, as of now (one evaluate). */
async function srAudit(page: Page): Promise<SrAudit> {
  await page.evaluate('globalThis.__name ??= (fn) => fn')
  return page.evaluate<SrAudit>(() => {
    const squash = (s: string | null | undefined, n = 90): string => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
    const visible = (el: Element): boolean => {
      const h = el as HTMLElement
      if (typeof h.checkVisibility === 'function' && !h.checkVisibility()) return false
      return getComputedStyle(el).visibility !== 'hidden'
    }
    const describe = (el: Element): string => {
      const cls = [...el.classList].filter((c) => !/^svelte-/.test(c)).slice(0, 2).join('.')
      return el.tagName.toLowerCase() + (el.id === '' ? '' : `#${el.id}`) + (cls === '' ? '' : `.${cls}`)
    }
    const byIds = (ids: string | null): string => (ids ?? '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
    const nameOf = (el: Element): string => {
      const aria = el.getAttribute('aria-label')
      if (aria !== null && squash(aria) !== '') return squash(aria)
      if (el.getAttribute('aria-labelledby') !== null) {
        const t = squash(byIds(el.getAttribute('aria-labelledby')))
        if (t !== '') return t
      }
      const labels = (el as HTMLInputElement).labels
      if (labels !== undefined && labels !== null && labels.length > 0) {
        const t = squash([...labels].map((l) => l.textContent ?? '').join(' '))
        if (t !== '') return t
      }
      if (el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type) && el.value !== '') return squash(el.value)
      const alt = el.getAttribute('alt')
      if (alt !== null && squash(alt) !== '') return squash(alt)
      const inner = squash((el as HTMLElement).innerText || el.textContent)
      if (inner !== '') return inner
      return squash(el.getAttribute('title'))
    }
    const roleOf = (el: Element): string => {
      const explicit = el.getAttribute('role')
      if (explicit !== null && explicit.trim() !== '') return explicit.trim().split(/\s+/)[0] ?? ''
      const tag = el.tagName.toLowerCase()
      if (tag === 'a') return 'link'
      if (tag === 'button' || tag === 'summary') return 'button'
      if (tag === 'select') return 'combobox'
      if (tag === 'textarea') return 'textbox'
      if (tag === 'input') {
        const t = (el as HTMLInputElement).type
        if (t === 'checkbox' || t === 'radio') return t
        if (t === 'range') return 'slider'
        if (t === 'file') return 'file'
        if (t === 'button' || t === 'submit' || t === 'reset' || t === 'image') return 'button'
        return 'textbox'
      }
      return tag
    }

    // headings
    const hs = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role=heading]')].filter(visible)
    const outline: string[] = []
    const skippedLevels: string[] = []
    let prev = 0
    for (const el of hs) {
      const m = /^H([1-6])$/.exec(el.tagName)
      const level = m !== null ? Number(m[1]) : Number(el.getAttribute('aria-level') ?? 2)
      const text = squash(el.textContent, 70)
      outline.push(`h${level} ${text}`)
      if (prev > 0 && level > prev + 1) skippedLevels.push(`h${prev} -> h${level} "${text}"`)
      prev = level
    }
    const h1s = hs.filter((el) => el.tagName === 'H1').map((el) => squash(el.textContent, 70))

    // landmarks
    const LANDMARK_ROLES = ['banner', 'contentinfo', 'navigation', 'main', 'complementary', 'region', 'search', 'form']
    const NESTING = 'article, aside, main, nav, section, [role=article], [role=complementary], [role=main], [role=navigation], [role=region]'
    const landmarks: string[] = []
    for (const el of document.querySelectorAll('header, footer, nav, main, aside, form, section, [role]')) {
      if (!visible(el)) continue
      const tag = el.tagName.toLowerCase()
      const explicit = (el.getAttribute('role') ?? '').trim().split(/\s+/)[0] ?? ''
      const name = squash(el.getAttribute('aria-label') ?? byIds(el.getAttribute('aria-labelledby')), 60)
      let role = ''
      if (explicit !== '') role = LANDMARK_ROLES.includes(explicit) ? explicit : ''
      else if (tag === 'header') role = el.parentElement?.closest(NESTING) ? '' : 'banner'
      else if (tag === 'footer') role = el.parentElement?.closest(NESTING) ? '' : 'contentinfo'
      else if (tag === 'nav') role = 'navigation'
      else if (tag === 'main') role = 'main'
      else if (tag === 'aside') role = 'complementary'
      else if (tag === 'form') role = name === '' ? '' : 'form'
      else if (tag === 'section') role = name === '' ? '' : 'region'
      if (role !== '') landmarks.push(`${role}${name === '' ? '' : ` "${name}"`}`)
    }

    // controls
    const CONTROLS = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=checkbox], [role=radio], [role=switch], [role=tab], [role=slider], [role=option], [role=menuitem]'
    const unnamed: string[] = []
    const labelInName: string[] = []
    const ungrouped: string[] = []
    const invalid: string[] = []
    const seenRadioGroups = new Set<string>()
    for (const el of document.querySelectorAll(CONTROLS)) {
      if (!visible(el) || el.closest('[inert]') !== null) continue
      const role = roleOf(el)
      const name = nameOf(el)
      if (name === '') unnamed.push(`${role} ${describe(el)}`)
      // WCAG 2.5.3: the visible text must be in the accessible name.
      const aria = el.getAttribute('aria-label')
      const shown = squash((el as HTMLElement).innerText, 120)
      if (aria !== null && shown !== '' && /[a-z]/i.test(shown) && !squash(aria, 400).toLowerCase().includes(shown.toLowerCase())) labelInName.push(`${role} "${shown}" is named "${squash(aria, 60)}"`)
      if (el instanceof HTMLInputElement && el.type === 'radio') {
        const key = el.name
        if (!seenRadioGroups.has(key)) {
          seenRadioGroups.add(key)
          const grouped = el.closest('fieldset, [role=radiogroup], [role=group]') !== null
          if (!grouped) ungrouped.push(`radio group "${key}" (${name})`)
        }
      }
      if (el.getAttribute('aria-invalid') === 'true') invalid.push(`${role} ${name}: described by "${squash(byIds(el.getAttribute('aria-describedby')), 120)}"`)
    }

    // images and drawings
    const imagesNoAlt = [...document.querySelectorAll('img')].filter((i) => visible(i) && i.getAttribute('alt') === null).map(describe)
    const canvases = [...document.querySelectorAll('canvas')].filter(visible).map((c) => {
      const frame = c.closest('[role=img]')
      return `${describe(c)}: aria-hidden=${c.getAttribute('aria-hidden')}, fallback "${squash(c.textContent, 60)}", frame ${frame === null ? 'none' : `role=img "${squash(nameOf(frame), 70)}"`}`
    })
    const svgImages = [...document.querySelectorAll('svg')]
      .filter((s) => visible(s) && s.getAttribute('aria-hidden') !== 'true')
      .map((s) => {
        const title = s.querySelector('title')?.textContent ?? ''
        const desc = s.querySelector('desc')?.textContent ?? ''
        return `${describe(s)}: role=${s.getAttribute('role') ?? '(none)'}, name "${squash(nameOf(s) || title, 70)}", desc "${squash(desc, 100)}"`
      })

    // references
    const brokenRefs: string[] = []
    for (const el of document.querySelectorAll('[aria-describedby], [aria-labelledby], [aria-controls]')) {
      for (const attr of ['aria-describedby', 'aria-labelledby', 'aria-controls']) {
        for (const id of (el.getAttribute(attr) ?? '').split(/\s+/).filter(Boolean)) if (document.getElementById(id) === null) brokenRefs.push(`${describe(el)} ${attr}="${id}"`)
      }
    }

    const alerts = [...document.querySelectorAll('[role=alert]')].map((a) => `${describe(a)}: "${squash(a.textContent, 120)}"`)
    const IMPLICIT: Record<string, string> = { status: 'polite', alert: 'assertive', log: 'polite', marquee: 'off', timer: 'off' }
    const liveRegions = [...document.querySelectorAll('[aria-live], [role=status], [role=alert], [role=log], [role=timer]')].map((el) => {
      const role = el.getAttribute('role') ?? ''
      return `${describe(el)} [${role || '-'}/${el.getAttribute('aria-live') ?? IMPLICIT[role] ?? ''}${el.getAttribute('aria-atomic') === 'true' ? ' atomic' : ''}] "${squash(el.textContent, 90)}"${visible(el) ? '' : ' (hidden)'}`
    })

    // DOM order of the controls around the h1: what a linear reading meets, and where a skip sits.
    const h1El = document.querySelector('h1')
    const order: string[] = []
    let placed = h1El === null
    let skipControl = 'absent'
    for (const el of document.querySelectorAll(CONTROLS)) {
      if (!visible(el) || el.matches(':disabled')) continue
      if (!placed && h1El !== null && h1El.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
        order.push('<h1>')
        placed = true
      }
      const name = nameOf(el)
      order.push(`${roleOf(el)} "${squash(name, 50)}"`)
      if (/^skip\b/i.test(name)) skipControl = `${placed ? 'after' : 'before'} the h1: ${roleOf(el)} "${name}"`
    }
    if (!placed) order.push('<h1>')

    const a = document.activeElement
    return {
      title: document.title,
      lang: document.documentElement.lang,
      h1s,
      outline,
      skippedLevels,
      landmarks,
      active: a === null ? 'null' : `${describe(a)}${a === document.body ? '' : ` "${squash(nameOf(a), 60)}"`}`,
      activeIsBody: a === null || a === document.body || a === document.documentElement,
      unnamed,
      ungroupedRadios: ungrouped,
      labelInName,
      imagesNoAlt,
      canvases,
      svgImages,
      brokenRefs,
      invalid,
      alerts,
      liveRegions,
      order,
      skipControl,
    }
  })
}

interface AuditEntry {
  readonly route: string
  readonly group: RouteGroup
  readonly ok: boolean
  readonly error?: string
  readonly shots: string[]
  readonly audit?: SrAudit
  readonly axe?: { readonly serious: string[]; readonly nonBlocking: string[] }
  readonly console?: unknown
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error)).split('\n').slice(0, 4).join(' | ').slice(0, 400)

/** Merge this run's entries into audit/summary.json (by route). */
function writeAuditSummary(sub: string, entries: readonly AuditEntry[]): string {
  const file = path.join(UX_ROOT, RUN, sub, 'summary.json')
  let all: AuditEntry[] = []
  try {
    const old: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (Array.isArray(old)) all = old as AuditEntry[]
  } catch {
    // first write
  }
  for (const e of entries) {
    const at = all.findIndex((x) => x.route === e.route)
    if (at >= 0) all[at] = e
    else all.push(e)
  }
  const index = new Map(PREVIEW_ROUTES.map((r, i) => [r.id, i]))
  all.sort((a, b) => (index.get(a.route) ?? 9999) - (index.get(b.route) ?? 9999))
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(all, null, 2))
  return repoRel(file)
}

/** Open each route on a fresh context (clean storage), photograph it, dump the tree and audit it. */
async function auditRoutes(browser: Browser, routes: readonly Route[], sub: string, opts: { readonly axe: boolean }): Promise<AuditEntry[]> {
  const entries: AuditEntry[] = []
  for (const route of routes) {
    const context = await browser.newContext()
    const page = await context.newPage()
    const log = trackConsole(page)
    const shots = new Shots(page, RUN, `${sub}/${route.id}`)
    let entry: AuditEntry
    try {
      await route.prepare?.(page)
      if (route.motion !== 'allow') await page.emulateMedia({ reducedMotion: 'reduce' })
      await openRoute(page, route)
      await settleTransitions(page)
      await page.waitForTimeout(150)
      const all = await shots.all(route.id)
      const audit = await srAudit(page)
      shots.json('audit', audit, { counter: false })
      let axe: AuditEntry['axe']
      if (opts.axe) {
        const m = await pageMetrics(page, { axe: true })
        shots.json('metrics', m, { counter: false })
        axe = {
          serious: (m.axe?.serious ?? []).map((v) => `${v.impact} ${v.id} x${v.nodes}: ${v.help} [${v.targets.join(', ')}]`),
          nonBlocking: (m.axe?.nonBlocking ?? []).map((v) => `${v.impact} ${v.id} x${v.nodes}: ${v.help} [${v.targets.join(', ')}]`),
        }
      }
      entry = { route: route.id, group: route.group, ok: true, shots: [all.png, all.txt, all.aria].filter((s) => s !== ''), audit, ...(axe === undefined ? {} : { axe }), console: log }
    } catch (error) {
      const failed = await shots.shot('open-failed')
      entry = { route: route.id, group: route.group, ok: false, error: message(error), shots: failed === '' ? [] : [failed], console: log }
    }
    entries.push(entry)
    const a = entry.audit
    console.log(
      `[sr ${sub}] ${route.id} ${entry.ok ? 'ok' : `FAILED: ${entry.error ?? ''}`}` +
        (a === undefined ? '' : ` | title "${a.title}" | h1 ${a.h1s.length} | focus ${a.activeIsBody ? 'BODY' : a.active} | skipped ${a.skippedLevels.length} | unnamed ${a.unnamed.length} | ungrouped ${a.ungroupedRadios.length} | lin ${a.labelInName.length} | refs ${a.brokenRefs.length}`) +
        (entry.axe === undefined ? '' : ` | axe serious ${entry.axe.serious.length} nonblocking ${entry.axe.nonBlocking.length}`),
    )
    await page.close().catch(() => undefined)
    await context.close().catch(() => undefined)
    writeAuditSummary(sub, entries)
  }
  console.log(`[sr ${sub}] ${entries.filter((e) => e.ok).length}/${entries.length} routes audited; ${writeAuditSummary(sub, entries)}`)
  return entries
}

// ------------------------------------------------------------------------------------------ 1. the audit

const GROUPS: readonly RouteGroup[] = ['start', 'session', 'results', 'notes', 'selftest']

for (const group of GROUPS) {
  test(`sr audit: ${group}`, async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'the audit runs on Chromium; WebKit has its own comparison test')
    const routes = PRODUCT_ROUTES.filter((r) => r.group === group)
    const entries = await auditRoutes(browser, routes, 'audit', { axe: true })
    expect(entries.length).toBe(routes.length)
    // The tour is evidence, not a gate: a route that could not be opened is recorded, and the review says so.
    expect(entries.filter((e) => e.ok).length, 'at least one route of the group opened').toBeGreaterThan(0)
  })
}

// --------------------------------------------------------------------------------- 2. announcements and focus

/** Pairs of (h1 change) -> (what had focus right after), from the samples. */
function focusAfterScreenChanges(samples: readonly Sample[]): { readonly t: number; readonly h1: string; readonly active: string; readonly body: boolean }[] {
  const out: { t: number; h1: string; active: string; body: boolean }[] = []
  let lastH1 = ''
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!
    if (s.h1 === lastH1) continue
    lastH1 = s.h1
    // The first sample within 400 ms whose focus is not on the body, else the sample itself.
    const settled = samples.slice(i, i + 12).find((x) => x.t - s.t <= 400 && !x.activeIsBody) ?? s
    out.push({ t: s.t, h1: s.h1, active: settled.active + (settled.name === '' ? '' : ` "${settled.name}"`), body: settled.activeIsBody })
  }
  return out
}

/** Live entries counted by region and kind, and the per-second rate of the busiest regions. */
function liveDigest(live: readonly LiveEntry[]): Record<string, unknown> {
  const byRegion = new Map<string, { mounts: number; updates: number; empties: number; samples: string[] }>()
  for (const e of live) {
    const key = `${e.region} [${e.role || '-'}/${e.live}${e.atomic === 'true' ? ' atomic' : ''}]`
    const r = byRegion.get(key) ?? { mounts: 0, updates: 0, empties: 0, samples: [] }
    if (e.kind === 'mount') r.mounts++
    else r.updates++
    if (e.text === '') r.empties++
    else if (r.samples.length < 6 && !r.samples.includes(e.text)) r.samples.push(e.text)
    byRegion.set(key, r)
  }
  return {
    total: live.length,
    nonEmpty: live.filter((e) => e.text !== '').length,
    mountsWithText: live.filter((e) => e.kind === 'mount' && e.text !== '').map((e) => `${e.t} ${e.region}: "${e.text}" (h1 ${e.h1})`),
    byRegion: Object.fromEntries([...byRegion.entries()].sort((a, b) => b[1].updates - a[1].updates)),
  }
}

test('sr session: announcements and focus', async ({ page }, testInfo) => {
  test.setTimeout(14 * 60_000)
  const project = testInfo.project.name
  const touch = testInfo.project.use.hasTouch === true
  const sub = project === 'chromium' ? 'journey' : `journey-${project}`
  const shots = new Shots(page, RUN, sub)
  const log = trackConsole(page)
  await page.addInitScript(LIVE_LOG)

  const journey = await playJourney(page, { runId: RUN, touch, shots, limitMs: 7 * 60_000 })
  console.log(`[sr journey] completed=${journey.completed} answered=${journey.answered} parts=${journey.segments.join(', ')} ${journey.error ?? ''}`)

  // The reveal, then everything after the save, with the log still running.
  const notes: string[] = []
  const finished = ((await h1(page).textContent({ timeout: 5000 }).catch(() => '')) ?? '').trim() === 'Session complete'
  if (finished) {
    try {
      await expect(page.locator('.reveal [role="status"]').first()).toHaveText('Your profile is ready.', { timeout: 60_000 })
      await shots.all('results-ready')
      // The blob: role, name, description; the table in the tree while the blob view is on.
      const profile = page.locator('section.hb-profile')
      notes.push(`blob view aria: ${repoRel(path.join(shots.dir, 'profile-blob-view.aria.yml'))}`)
      writeFileSync(path.join(shots.dir, 'profile-blob-view.aria.yml'), await profile.ariaSnapshot())
      await page.getByRole('button', { name: 'Bar view' }).click()
      await page.waitForTimeout(200)
      writeFileSync(path.join(shots.dir, 'profile-bar-view.aria.yml'), await profile.ariaSnapshot())
      await shots.all('results-bar-view')
      // The drill-down from the keyboard: where focus goes, and what the tree says.
      const first = profile.locator('.drill-buttons button').first()
      await first.focus()
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)
      writeFileSync(path.join(shots.dir, 'profile-drilldown.aria.yml'), await profile.ariaSnapshot())
      await shots.all('results-drilldown')
      notes.push(`after drill-down Enter, focus: ${await page.evaluate<string>('(document.activeElement && (document.activeElement.tagName + " " + (document.activeElement.textContent || "").trim().slice(0, 40))) || "none"')}`)
      // The save: the announcement and the share card's picture.
      await button(page, 'Download save file').click()
      await expect(page.locator('[data-section="save"] [role="status"]')).toHaveText('Save file downloaded.')
      await expect(page.locator('img[data-preview]')).toBeVisible({ timeout: 20_000 })
      notes.push(`share card alt: "${await page.locator('img[data-preview]').getAttribute('alt')}"`)
      await shots.all('results-saved')
      writeFileSync(path.join(shots.dir, 'share-card.aria.yml'), await page.locator('[data-share-card]').ariaSnapshot())
      // Copying the preamble: the status line.
      await page.getByTestId('copy-preamble').click()
      await page.waitForTimeout(400)
      notes.push(`results-talk status: "${await page.getByTestId('results-talk-status').textContent()}"`)
      // Leaving: the confirmation, and focus on "stay".
      await button(page, 'Back to the start').click()
      await page.waitForTimeout(200)
      notes.push(`after "Back to the start" (saved): h1 "${(await h1(page).textContent()) ?? ''}", focus ${await page.evaluate<string>('document.activeElement ? document.activeElement.tagName + " " + (document.activeElement.textContent || "").trim().slice(0, 40) : "none"')}`)
    } catch (error) {
      notes.push(`post-journey steps stopped: ${message(error)}`)
      await shots.all('post-journey-error')
    }
  }

  const logs = await readLogs(page)
  const screens = focusAfterScreenChanges(logs.samples)
  const titles = [...new Set(logs.samples.map((s) => s.title))]
  const digest = {
    journey: { completed: journey.completed, error: journey.error, answered: journey.answered, segments: journey.segments, skipped: journey.skipped, realMs: journey.realMs, steps: journey.steps.length },
    titles,
    screens,
    screensWithFocusOnBody: screens.filter((s) => s.body),
    live: liveDigest(logs.live),
    notes,
    console: log,
  }
  shots.json('live-log', logs.live, { counter: false })
  shots.json('focus-log', logs.focus, { counter: false })
  shots.json('samples', logs.samples, { counter: false })
  const digestPath = shots.json('digest', digest, { counter: false })
  console.log(`[sr journey] ${logs.live.length} live-region changes, ${logs.focus.length} focus events, ${screens.length} screen changes (${digest.screensWithFocusOnBody.length} left focus on body), titles: ${titles.join(' / ')}; digest ${digestPath}`)
  for (const s of screens) console.log(`  ${String(s.t).padStart(6)} ms  h1 "${s.h1}" -> focus ${s.body ? 'BODY' : s.active}`)
  expect(logs.samples.length).toBeGreaterThan(0)
})

// --------------------------------------------------------------------------------- 3. form errors and chatter

test('sr forms: errors tied to fields', async ({ page: first, browser }, testInfo) => {
  const project = testInfo.project.name
  const shots = new Shots(first, RUN, project === 'chromium' ? 'forms' : `forms-${project}`)
  await first.addInitScript(LIVE_LOG)
  const found: Record<string, unknown> = {}

  const fieldState = async (on: Page, locatorCss: string): Promise<Record<string, string | null>> =>
    on.evaluate<Record<string, string | null>>(
      `(() => { const el = document.querySelector(${JSON.stringify(locatorCss)}); if (!el) return { missing: 'yes' }; const by = el.getAttribute('aria-describedby'); return { 'aria-invalid': el.getAttribute('aria-invalid'), 'aria-describedby': by, describedText: by ? by.split(/\\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' ').trim() : null, required: el.getAttribute('aria-required') || (el.required ? 'true' : null), focus: document.activeElement === el ? 'on field' : (document.activeElement ? document.activeElement.tagName : 'none') } })()`,
    )

  // 1. The gate without the tick.
  await first.goto('./')
  await button(first, 'Start').click()
  await expect(h1(first)).toHaveText('Before you start')
  await button(first, 'Continue').click()
  await expect(first.getByRole('alert')).toBeVisible()
  found.gate = { field: await fieldState(first, 'input[type=checkbox]'), alert: await first.getByRole('alert').textContent(), ...(await shots.all('gate-error')) }

  // 2. The honour code without the tick.
  await first.getByRole('checkbox', { name: /18 or older/ }).check()
  await button(first, 'Continue').click()
  await expect(h1(first)).toHaveText('Honour code')
  await button(first, 'Continue').click()
  await expect(first.getByRole('alert')).toBeVisible()
  found.honour = { field: await fieldState(first, 'input[type=checkbox]'), alert: await first.getByRole('alert').textContent(), ...(await shots.all('honour-error')) }

  // 3. A save file that is not one, and Load with nothing chosen. A fresh context: the consent the first page
  //    recorded would make `toReady` skip the gate it expects to tick.
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.addInitScript(LIVE_LOG)
  const shots2 = new Shots(page, RUN, `${shots.sub}-2`)
  await toReady(page)
  await button(page, 'Load').click()
  await expect(page.getByRole('status').filter({ hasText: /first/ })).toBeVisible()
  const emptyLoad = { status: await page.getByRole('status').filter({ hasText: /first/ }).textContent(), file: await fieldState(page, 'input[type=file]'), code: await fieldState(page, 'textarea') }
  await page.getByLabel('Save file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('this is not a save file') })
  await button(page, 'Load').click()
  await page.waitForTimeout(500)
  const badStatus = await page.locator('main p[role=status]').first().textContent()
  found.badSave = { emptyLoad, status: badStatus, file: await fieldState(page, 'input[type=file]'), code: await fieldState(page, 'textarea'), ...(await shots2.all('ready-bad-save')) }

  await context.close().catch(() => undefined)

  // 4. The notes builder: "keep my settings" without the 18+ tick, then chatter while typing. A fresh context again: with
  //    the gate's consent recorded, the notes page rightly hides its own 18+ box.
  const context3 = await browser.newContext()
  const notes = await context3.newPage()
  await notes.addInitScript(LIVE_LOG)
  const shots3 = new Shots(notes, RUN, `${shots.sub}-3`)
  await notes.goto('./notes.html')
  await expect(notes.locator('#notes-text')).toContainText('How I like explanations')
  const before = (await readLogs(notes)).live.length
  await notes.getByRole('button', { name: NOTES_COPY.keepButton }).click()
  await expect(notes.getByTestId('adult-error')).toBeVisible()
  found.notesKeep = { field: await fieldState(notes, '[data-testid=adult]'), alert: await notes.getByTestId('adult-error').textContent(), ...(await shots3.all('notes-keep-error')) }
  const afterError = (await readLogs(notes)).live.length
  // Typing: one keystroke at a time into the hobbies box and a custom line, then a topic pick.
  await notes.getByLabel(/Hobbies or subjects/).pressSequentially('chess and cooking', { delay: 40 })
  await notes.locator('#custom-0').pressSequentially('Use metric units', { delay: 40 })
  await notes.getByRole('radio', { name: /Coding and data/ }).check()
  await notes.getByRole('button', { name: /Programming/ }).first().click()
  await notes.waitForTimeout(600)
  const logs = await readLogs(notes)
  const typing = logs.live.slice(afterError)
  found.notesTyping = { liveChangesWhileTyping: typing.length, entries: typing.map((e) => `${e.t} ${e.region} [${e.role}/${e.live}]: "${e.text}"`), liveChangesOnKeepError: logs.live.slice(before, afterError).map((e) => `${e.region}: "${e.text}"`), ...(await shots3.all('notes-typed')) }
  await context3.close().catch(() => undefined)

  const out = shots.json('forms', found, { counter: false })
  console.log(`[sr forms] ${out}`)
  console.log(JSON.stringify({ gate: found.gate, honour: found.honour, badSave: found.badSave, notesKeep: found.notesKeep, typing: found.notesTyping }, null, 1).slice(0, 6000))
  expect(Object.keys(found).length).toBeGreaterThan(3)
})

// ------------------------------------------------------------------------------- 4. practice feedback

/**
 * The practice questions are the one place the product shows right or wrong (§10). What does a screen reader
 * get when the feedback appears: a live region that already exists and changes (announced), or one that is
 * mounted with its text already in it (many screen readers stay silent), and where is focus?
 */
test('sr practice: feedback announcements', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs on Chromium')
  const shots = new Shots(page, RUN, 'practice')
  await page.addInitScript(LIVE_LOG)
  await toReady(page)
  await button(page, 'Try practice questions first').click()
  await expect(h1(page)).toHaveText('Practice')
  const out: Record<string, unknown> = {}
  out.afterOpen = { audit: await srAudit(page), ...(await shots.all('practice-question')) }
  const before = (await readLogs(page)).live.length
  await answerItem(page)
  await expect(page.getByText(/That was (not )?correct\./)).toBeVisible()
  await page.waitForTimeout(500)
  const logs = await readLogs(page)
  const feedbackLive = logs.live.slice(before)
  out.feedback = { live: feedbackLive, focus: logs.focus.slice(-6), audit: await srAudit(page), ...(await shots.all('practice-feedback')) }
  const before2 = logs.live.length
  await button(page, 'Next practice question').click()
  await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
  await page.waitForTimeout(500)
  const logs2 = await readLogs(page)
  const nextLive = logs2.live.slice(before2)
  out.next = { live: nextLive, focus: logs2.focus.slice(-4), audit: await srAudit(page), ...(await shots.all('practice-next')) }
  const file = shots.json('practice', out, { counter: false })
  console.log(`[sr practice] ${file}`)
  console.log(`[sr practice] feedback: ${feedbackLive.map((e) => `${e.kind} ${e.region} [${e.role || '-'}/${e.live}] "${e.text}"`).join(' || ')}`)
  console.log(`[sr practice] next question: ${nextLive.map((e) => `${e.kind} ${e.region} [${e.role || '-'}/${e.live}] "${e.text}"`).join(' || ')}`)
  console.log(`[sr practice] focus after feedback: ${(out.feedback as { audit: SrAudit }).audit.active}; after next: ${(out.next as { audit: SrAudit }).audit.active}`)
  expect(logs2.samples.length).toBeGreaterThan(0)
})

// ------------------------------------------------------------------------------------- 5. WebKit compare

const WEBKIT_ROUTES = ['device', 'rt-trial', 'item-matrix-series', 'confidence', 'item-spatial', 'memory-entry', 'memory-corsi', 'coding-running', 'results', 'results-bars', 'results-saved'] as const

test('sr webkit: tree compare', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'webkit', 'the WebKit comparison runs with --project=webkit')
  const routes = PRODUCT_ROUTES.filter((r) => (WEBKIT_ROUTES as readonly string[]).includes(r.id))
  const entries = await auditRoutes(browser, routes, 'webkit', { axe: false })
  expect(entries.filter((e) => e.ok).length).toBeGreaterThan(0)
})
