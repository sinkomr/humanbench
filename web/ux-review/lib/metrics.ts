/// <reference lib="dom" />
/**
 * Measurements a UX reviewer reads next to a screenshot: console noise, readability of the visible text,
 * and a per-page sweep (headings, landmarks, touch targets, input font sizes, line length, live regions,
 * optionally axe). The numbers are evidence, not verdicts: a finding says why one matters on its page.
 */

import type { Page } from '@playwright/test'
import { nonBlockingAxeViolations, seriousAxeViolations, type AxeViolation } from '../../e2e/axe'
import { clippedText, sidewaysOverflow, type SidewaysOverflow } from '../../e2e/layout'

// ------------------------------------------------------------------------------------- console

export interface ConsoleLog {
  /** console.error messages (with their source location). */
  readonly errors: string[]
  /** console.warn messages. */
  readonly warnings: string[]
  /** Uncaught exceptions on the page. */
  readonly pageErrors: string[]
  /** Requests that failed or came back 4xx/5xx ("404 GET url"). */
  readonly failed: string[]
}

/** Starts collecting console messages, page errors and failed requests of `page`; the returned object fills as the page runs. */
export function trackConsole(page: Page): ConsoleLog {
  const log: ConsoleLog = { errors: [], warnings: [], pageErrors: [], failed: [] }
  page.on('console', (m) => {
    const where = m.location().url === '' ? '' : ` (${m.location().url}:${m.location().lineNumber})`
    if (m.type() === 'error') log.errors.push(`${m.text()}${where}`)
    else if (m.type() === 'warning') log.warnings.push(`${m.text()}${where}`)
  })
  page.on('pageerror', (e) => log.pageErrors.push(e.message))
  page.on('requestfailed', (r) => log.failed.push(`failed ${r.method()} ${r.url()}: ${r.failure()?.errorText ?? ''}`))
  page.on('response', (r) => {
    if (r.status() >= 400) log.failed.push(`${r.status()} ${r.request().method()} ${r.url()}`)
  })
  return log
}

// --------------------------------------------------------------------------------- readability

export interface Readability {
  readonly words: number
  readonly sentences: number
  readonly avgSentenceWords: number
  /** Flesch reading ease (206.835 - 1.015 w/s - 84.6 sy/w; 60-70 is plain English); null without words. */
  readonly fleschReadingEase: number | null
  /** Sentences of more than 25 words. */
  readonly longSentences: number
  /** The first few of them, shortened. */
  readonly longSentenceSamples: string[]
}

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu

export function wordsOf(text: string): string[] {
  return text.match(WORD) ?? []
}

/** Vowel-group syllable estimate: good enough for a reading-ease figure on English UI copy. */
export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '')
  if (w === '') return 1
  if (w.length <= 3) return 1
  const stripped = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '')
  return Math.max(1, stripped.match(/[aeiouy]{1,2}/g)?.length ?? 1)
}

/** Sentences of a text: lines are separate blocks, and a block ends at . ! ? or an ellipsis (a block without a stop is one sentence). */
export function sentencesOf(text: string): string[] {
  const out: string[] = []
  for (const line of text.split(/\n+/)) {
    for (const piece of line.split(/(?<=[.!?…])["')\]]*\s+/)) {
      const t = piece.trim()
      if (wordsOf(t).length > 0) out.push(t)
    }
  }
  return out
}

export function readability(text: string): Readability {
  const sentences = sentencesOf(text)
  const words = wordsOf(text)
  const syllables = words.reduce((n, w) => n + countSyllables(w), 0)
  const long = sentences.filter((s) => wordsOf(s).length > 25)
  const round = (n: number): number => Math.round(n * 10) / 10
  const perSentence = sentences.length === 0 ? 0 : words.length / sentences.length
  return {
    words: words.length,
    sentences: sentences.length,
    avgSentenceWords: round(perSentence),
    fleschReadingEase: words.length === 0 || sentences.length === 0 ? null : round(206.835 - 1.015 * perSentence - 84.6 * (syllables / words.length)),
    longSentences: long.length,
    longSentenceSamples: long.slice(0, 5).map((s) => (s.length > 160 ? `${s.slice(0, 157)}...` : s)),
  }
}

// ------------------------------------------------------------------------------------ the page

export interface SmallTarget {
  readonly selector: string
  readonly role: string
  /** Accessible name, or the text the control shows. */
  readonly name: string
  readonly size: { readonly w: number; readonly h: number }
  /** The smallest threshold (CSS px) it misses: 24 (WCAG 2.2 target size), or 44 on a touch device (the comfortable size). */
  readonly under: 24 | 44
  /** A link inside running text: WCAG 2.5.8 exempts it, so reviewers usually discount it. */
  readonly inline: boolean
}

export interface SmallInput {
  readonly selector: string
  readonly name: string
  readonly fontPx: number
}

export interface HeadingInfo {
  readonly level: number
  readonly text: string
}

export interface LandmarkInfo {
  readonly role: string
  readonly name: string
}

export interface LiveRegionInfo {
  readonly selector: string
  readonly role: string
  readonly ariaLive: string
  readonly text: string
  readonly visible: boolean
}

export interface AxeSummary {
  readonly id: string
  readonly impact: string
  readonly help: string
  readonly helpUrl: string
  /** Nodes affected. */
  readonly nodes: number
  /** The first few offending selectors. */
  readonly targets: string[]
  /** What to change, for the first node. */
  readonly fix: string
}

export interface PageMetrics {
  readonly url: string
  readonly title: string
  readonly h1: string
  readonly viewport: { readonly width: number; readonly height: number; readonly dpr: number }
  readonly lang: string
  readonly scrollHeight: number
  /** Sideways overflow (px of document wider than the window; 0 or less: none) and the elements reaching furthest. */
  readonly overflowX: SidewaysOverflow
  /** Elements that hide part of their own text. */
  readonly clipped: string[]
  readonly smallTargets: SmallTarget[]
  /** Text fields under 16 px: iOS Safari zooms the page when one gets focus. */
  readonly smallInputFont: SmallInput[]
  readonly headings: HeadingInfo[]
  readonly landmarks: LandmarkInfo[]
  /** Visible, enabled elements a Tab press can reach. */
  readonly focusables: number
  /** Of the visible paragraphs, list items and captions. */
  readonly readability: Readability
  readonly longestParagraphWords: number
  /** Estimated characters in the longest rendered line of body text (45 to 90 reads comfortably). */
  readonly maxLineChars: number
  readonly liveRegions: LiveRegionInfo[]
  readonly axe?: { readonly serious: AxeSummary[]; readonly nonBlocking: AxeSummary[] }
}

export interface PageMetricsOptions {
  /** A phone: targets are judged against 44 px as well as 24 px. */
  readonly touch?: boolean
  /** Also run axe (WCAG A/AA and best practice): about a second. */
  readonly axe?: boolean
  /** CSS selector: measure only inside the first element it matches (default: the whole page). */
  readonly scope?: string
}

function axeSummary(v: AxeViolation): AxeSummary {
  return {
    id: v.id,
    impact: v.impact ?? '',
    help: v.help,
    helpUrl: v.helpUrl,
    nodes: v.nodes.length,
    targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
    fix: (v.nodes[0]?.failureSummary ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
  }
}

/** What the page itself can tell (the browser side of {@link pageMetrics}). */
interface Raw {
  viewport: { width: number; height: number; dpr: number }
  lang: string
  title: string
  h1: string
  scrollHeight: number
  smallTargets: SmallTarget[]
  smallInputFont: SmallInput[]
  headings: HeadingInfo[]
  landmarks: LandmarkInfo[]
  focusables: number
  blocks: string[]
  maxLineChars: number
  liveRegions: LiveRegionInfo[]
}

/** Everything the page can measure about itself, as of now. */
export async function pageMetrics(page: Page, opts: PageMetricsOptions = {}): Promise<PageMetrics> {
  const scope = opts.scope
  const touch = opts.touch === true
  // Playwright's own transform leaves the function below as written; esbuild (tsx, vitest) wraps its inner functions in __name().
  await page.evaluate('globalThis.__name ??= (fn) => fn')
  const raw = await page.evaluate<Raw, { scope: string | null; touch: boolean }>(
    (arg) => {
      const root: Element = (arg.scope === null ? null : document.querySelector(arg.scope)) ?? document.body
      const squash = (s: string | null | undefined, n = 80): string => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
      const visible = (el: Element): boolean => {
        const h = el as HTMLElement
        if (typeof h.checkVisibility === 'function' && !h.checkVisibility()) return false
        const r = el.getBoundingClientRect()
        if (r.width <= 0 || r.height <= 0) return false
        const v = getComputedStyle(el).visibility
        return v !== 'hidden' && v !== 'collapse'
      }
      const describe = (el: Element): string => {
        const cls = [...el.classList].slice(0, 3).join('.')
        return el.tagName.toLowerCase() + (el.id === '' ? '' : `#${el.id}`) + (cls === '' ? '' : `.${cls}`)
      }
      const nameOf = (el: Element): string => {
        const aria = el.getAttribute('aria-label')
        if (aria !== null && squash(aria) !== '') return squash(aria)
        const by = el.getAttribute('aria-labelledby')
        if (by !== null) {
          const t = squash(
            by
              .split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent ?? '')
              .join(' '),
          )
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
        const img = el.querySelector('img[alt]')?.getAttribute('alt')
        if (img !== undefined && img !== null && squash(img) !== '') return squash(img)
        return squash(el.getAttribute('title') ?? el.getAttribute('placeholder'))
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
          if (t === 'number') return 'spinbutton'
          if (t === 'button' || t === 'submit' || t === 'reset' || t === 'image') return 'button'
          return 'textbox'
        }
        return tag
      }
      const hiddenByAuthor = (el: Element): boolean => el.closest('[inert]') !== null

      // ---- touch targets
      const INTERACTIVE =
        'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=checkbox], [role=radio], [role=switch], [role=tab], [role=menuitem], [role=slider], [role=option], [tabindex]:not([tabindex="-1"])'
      const smallTargets: SmallTarget[] = []
      const seen = new Set<Element>()
      for (const el of root.querySelectorAll(INTERACTIVE)) {
        if (seen.has(el) || hiddenByAuthor(el)) continue
        seen.add(el)
        if (el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true') continue
        let rect = el.getBoundingClientRect()
        let shown = visible(el)
        // A checkbox or radio is pressed through its label, and a custom-styled one hides the input itself.
        const labels = (el as HTMLInputElement).labels
        if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio') && labels !== null && labels.length > 0) {
          const boxes = [...labels].filter((l) => visible(l)).map((l) => l.getBoundingClientRect())
          if (boxes.length > 0) {
            const hiddenInput = !shown || rect.width <= 2 || rect.height <= 2 || getComputedStyle(el).opacity === '0'
            const all = hiddenInput ? boxes : [rect, ...boxes]
            const left = Math.min(...all.map((b) => b.left))
            const top = Math.min(...all.map((b) => b.top))
            const right = Math.max(...all.map((b) => b.right))
            const bottom = Math.max(...all.map((b) => b.bottom))
            rect = new DOMRect(left, top, right - left, bottom - top)
            shown = true
          }
        }
        if (!shown) continue
        const w = Math.round(rect.width * 10) / 10
        const h = Math.round(rect.height * 10) / 10
        const smallest = Math.min(w, h)
        const limit = arg.touch ? 44 : 24
        if (smallest >= limit) continue
        const parent = el.parentElement
        const inline =
          el.tagName === 'A' && getComputedStyle(el).display === 'inline' && parent !== null && squash(parent.textContent, 2000).length > squash(el.textContent, 2000).length + 3
        smallTargets.push({ selector: describe(el), role: roleOf(el), name: nameOf(el), size: { w, h }, under: smallest < 24 ? 24 : 44, inline })
      }

      // ---- text fields under 16 px
      const TEXT_TYPES = ['text', 'search', 'email', 'tel', 'url', 'password', 'number', 'date', 'datetime-local', 'month', 'time', 'week']
      const smallInputFont: SmallInput[] = []
      for (const el of root.querySelectorAll('input, textarea, select')) {
        if (el instanceof HTMLInputElement && !TEXT_TYPES.includes(el.type)) continue
        if (!visible(el)) continue
        const fontPx = parseFloat(getComputedStyle(el).fontSize)
        if (fontPx < 16) smallInputFont.push({ selector: describe(el), name: nameOf(el), fontPx })
      }

      // ---- structure
      const headings: HeadingInfo[] = []
      for (const el of root.querySelectorAll('h1, h2, h3, h4, h5, h6, [role=heading]')) {
        if (!visible(el)) continue
        const m = /^H([1-6])$/.exec(el.tagName)
        const level = m !== null ? Number(m[1]) : Number(el.getAttribute('aria-level') ?? 2)
        headings.push({ level, text: squash((el as HTMLElement).innerText || el.textContent, 100) })
      }
      const NESTING = 'article, aside, main, nav, section, [role=article], [role=complementary], [role=main], [role=navigation], [role=region]'
      const LANDMARK_ROLES = ['banner', 'contentinfo', 'navigation', 'main', 'complementary', 'region', 'search', 'form']
      const landmarks: LandmarkInfo[] = []
      for (const el of root.querySelectorAll('header, footer, nav, main, aside, form, section, [role]')) {
        if (!visible(el)) continue
        const tag = el.tagName.toLowerCase()
        const explicit = (el.getAttribute('role') ?? '').trim().split(/\s+/)[0] ?? ''
        const name = (() => {
          const aria = el.getAttribute('aria-label')
          if (aria !== null && squash(aria) !== '') return squash(aria)
          const by = el.getAttribute('aria-labelledby')
          if (by === null) return ''
          return squash(
            by
              .split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent ?? '')
              .join(' '),
          )
        })()
        let role = ''
        if (explicit !== '') role = LANDMARK_ROLES.includes(explicit) ? explicit : ''
        else if (tag === 'header') role = el.parentElement?.closest(NESTING) ? '' : 'banner'
        else if (tag === 'footer') role = el.parentElement?.closest(NESTING) ? '' : 'contentinfo'
        else if (tag === 'nav') role = 'navigation'
        else if (tag === 'main') role = 'main'
        else if (tag === 'aside') role = 'complementary'
        else if (tag === 'form') role = name === '' ? '' : 'form'
        else if (tag === 'section') role = name === '' ? '' : 'region'
        if (role !== '') landmarks.push({ role, name })
      }
      let focusables = 0
      for (const el of root.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex], [contenteditable=""], [contenteditable="true"], audio[controls], video[controls]')) {
        if (el.matches(':disabled') || hiddenByAuthor(el) || !visible(el)) continue
        const ti = el.getAttribute('tabindex')
        if (ti !== null && Number(ti) < 0) continue
        focusables++
      }

      // ---- text: leaf blocks (paragraphs, list items, definitions, quotes, captions) that are on screen
      const BLOCKS = 'p, li, dd, blockquote, figcaption'
      const leaves: Element[] = []
      for (const el of root.querySelectorAll(BLOCKS)) {
        if (el.querySelector(BLOCKS) !== null) continue
        if (el.closest('svg, [aria-hidden="true"], .visually-hidden, .hb-sr-only') !== null) continue
        if (!visible(el)) continue
        leaves.push(el)
      }
      let blocks = leaves.map((el) => squash((el as HTMLElement).innerText || el.textContent, 4000)).filter((t) => t !== '')
      if (blocks.length === 0) blocks = ((root as HTMLElement).innerText || '').split('\n').map((t) => t.trim()).filter((t) => t.split(/\s+/).length >= 4)

      // ---- longest rendered line: walk the words of each block and count characters per visual line
      const lines = new Map<string, number>()
      const range = document.createRange()
      let walked = 0
      leaves.forEach((el, index) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node !== null && walked < 6000; node = walker.nextNode()) {
          const data = (node as Text).data
          for (const m of data.matchAll(/\S+\s*/g)) {
            walked++
            range.setStart(node, m.index)
            range.setEnd(node, m.index + m[0].length)
            const r = range.getClientRects()[0]
            if (r === undefined || r.width <= 0) continue
            const key = `${index}:${Math.round((r.top + r.bottom) / 2 / 6)}`
            lines.set(key, (lines.get(key) ?? 0) + m[0].length)
          }
        }
      })
      const maxLineChars = Math.max(0, ...[...lines.values()].map((n) => n - 1))

      // ---- live regions
      const IMPLICIT: Record<string, string> = { status: 'polite', alert: 'assertive', log: 'polite', marquee: 'off', timer: 'off' }
      const liveRegions: LiveRegionInfo[] = []
      for (const el of root.querySelectorAll('[aria-live], [role=status], [role=alert], [role=log], [role=marquee], [role=timer]')) {
        const role = (el.getAttribute('role') ?? '').trim()
        const ariaLive = el.getAttribute('aria-live') ?? IMPLICIT[role] ?? ''
        if (ariaLive === 'off' || ariaLive === '') continue
        liveRegions.push({ selector: describe(el), role, ariaLive, text: squash(el.textContent, 120), visible: visible(el) })
      }

      const h1 = [...document.querySelectorAll('h1')].find((e) => visible(e))
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
        lang: document.documentElement.lang,
        title: document.title,
        h1: squash(h1 === undefined ? '' : h1.textContent, 100),
        scrollHeight: document.documentElement.scrollHeight,
        smallTargets,
        smallInputFont,
        headings,
        landmarks,
        focusables,
        blocks,
        maxLineChars,
        liveRegions,
      }
    },
    { scope: scope ?? null, touch },
  )

  const { blocks, ...rest } = raw
  const metrics: PageMetrics = {
    url: page.url(),
    ...rest,
    overflowX: await sidewaysOverflow(page, scope),
    clipped: await clippedText(page, scope),
    readability: readability(blocks.join('\n')),
    longestParagraphWords: Math.max(0, ...blocks.map((b) => wordsOf(b).length)),
  }
  if (opts.axe !== true) return metrics
  const axeScope = scope === undefined ? {} : { include: [scope] }
  const [serious, nonBlocking] = [await seriousAxeViolations(page, axeScope), await nonBlockingAxeViolations(page, axeScope)]
  return { ...metrics, axe: { serious: serious.map(axeSummary), nonBlocking: nonBlocking.map(axeSummary) } }
}
