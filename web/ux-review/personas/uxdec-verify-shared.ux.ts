/// <reference lib="dom" />
/**
 * Shared pieces of the uxdec verification harness (run id `uxdec-verify`): the fact recorder every check writes
 * through, the small page helpers, and the share-sheet stubs. No tests live here; the specs are
 * `uxdec-verify-owner.ux.ts` (D1, D2, D3, D5, D10), `uxdec-verify-defaults.ux.ts` (the provisional defaults and
 * the skipped decisions) and `uxdec-verify-sweep.ux.ts` (the regression tours and the RT self-test page).
 *
 * Everything lands under web/test-results/ux-review/uxdec-verify/<item>/<project>/ as screenshots, page text and one
 * `facts.json` per test, which `verification.json` cites.
 */

import { readFileSync } from 'node:fs'
import { expect, type Download, type Locator, type Page, type TestInfo } from '@playwright/test'
import { seriousAxeViolations } from '../../e2e/axe'
import { Shots } from '../lib'

export const RUN = process.env.UX_RUN ?? 'uxdec-verify'

export interface Check {
  readonly name: string
  readonly ok: boolean | null
  readonly value?: unknown
  readonly note?: string
}

/** Facts of one test: checks (named, true/false/null for "measured only") and the evidence paths, saved as JSON at the end. */
export class Facts {
  readonly checks: Check[] = []
  readonly evidence: string[] = []
  readonly notes: string[] = []
  readonly shots: Shots

  constructor(
    readonly page: Page,
    readonly info: TestInfo,
    readonly item: string,
  ) {
    this.shots = new Shots(page, RUN, `${item}/${info.project.name}`)
  }

  get touch(): boolean {
    return this.info.project.use.hasTouch === true
  }

  check(name: string, ok: boolean | null, value?: unknown, note?: string): boolean {
    this.checks.push({ name, ok, ...(value === undefined ? {} : { value }), ...(note === undefined ? {} : { note }) })
    console.log(`[${this.item} ${this.info.project.name}] ${ok === null ? 'MEASURED' : ok ? 'ok' : 'FAIL'} ${name}${value === undefined ? '' : `: ${JSON.stringify(value).slice(0, 300)}`}`)
    return ok === true
  }

  note(text: string): void {
    this.notes.push(text)
  }

  /** A full-page screenshot plus the page text and accessibility tree; the png path is kept as evidence. */
  async all(name: string): Promise<string> {
    const s = await this.shots.all(name)
    if (s.png !== '') this.evidence.push(s.png)
    return s.png
  }

  async shot(name: string, opts: { readonly fullPage?: boolean; readonly locator?: Locator } = {}): Promise<string> {
    const p = await this.shots.shot(name, opts)
    if (p !== '') this.evidence.push(p)
    return p
  }

  /** Serious or critical axe violations of the page as it is; recorded as a check. */
  async axe(name: string): Promise<void> {
    try {
      const v = await seriousAxeViolations(this.page)
      this.check(`axe serious: ${name}`, v.length === 0, v.map((x) => `${x.id} (${x.impact}) ${x.nodes.length} node(s): ${x.nodes[0]?.target.join(' ') ?? ''}`))
    } catch (error) {
      this.check(`axe serious: ${name}`, null, String(error).split('\n')[0], 'axe could not run')
    }
  }

  /** Write facts.json; returns its repo-relative path. */
  save(): string {
    const failed = this.checks.filter((c) => c.ok === false).map((c) => c.name)
    const p = this.shots.json('facts', { item: this.item, project: this.info.project.name, failed, checks: this.checks, evidence: this.evidence, notes: this.notes }, { counter: false })
    console.log(`[${this.item} ${this.info.project.name}] ${this.checks.filter((c) => c.ok === true).length} ok, ${failed.length} failed, ${this.checks.filter((c) => c.ok === null).length} measured; ${p}`)
    return p
  }
}

export async function fresh(page: Page): Promise<void> {
  await page.goto('./favicon.svg')
  await page.evaluate('localStorage.clear(); sessionStorage.clear()')
}

export async function press(touch: boolean, target: Locator): Promise<void> {
  if (touch) await target.tap()
  else await target.click()
}

export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

export const bodyText = (page: Page): Promise<string> => page.locator('body').innerText()

/** What has the focus, in one line. */
export const focused = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return 'nothing (body)'
    const label = el.getAttribute('aria-label') || ((el as HTMLInputElement).labels?.[0]?.textContent ?? '') || el.textContent || ''
    return `${el.tagName.toLowerCase()}${el.getAttribute('type') ? `[${el.getAttribute('type')}]` : ''}.${[...el.classList].slice(0, 2).join('.')} "${label.replace(/\s+/g, ' ').trim().slice(0, 60)}"`
  })

/** The visible buttons of `scope` in DOM order: name, whether it carries the primary style, and its size. */
export async function buttonsOf(scope: Locator): Promise<{ name: string; primary: boolean; w: number; h: number }[]> {
  return scope.evaluate((root) =>
    [...root.querySelectorAll('button, a.hb-btn')]
      .filter((b) => b.getClientRects().length > 0)
      .map((b) => {
        const r = b.getBoundingClientRect()
        return { name: (b.getAttribute('aria-label') || b.textContent || '').replace(/\s+/g, ' ').trim(), primary: b.classList.contains('hb-primary'), w: Math.round(r.width), h: Math.round(r.height) }
      }),
  )
}

/** Wait for a download started by `go`; the file is read as text. */
export async function download(page: Page, go: () => Promise<void>): Promise<{ name: string; text: string; download: Download }> {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), go()])
  const path = await d.path()
  const text = path === null ? '' : readFileSync(path, 'utf8')
  return { name: d.suggestedFilename(), text, download: d }
}

/** Today's local calendar date, as the save and card file names write it (UX-REVIEW D19). */
export function localDateStamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** A share sheet that takes image files (what an iPhone has): "Share image" becomes the primary button (D15 C). */
export const SHARE_SHEET_FILES = `(() => {
  window.__hbShared = []
  const ok = (d) => !!d && Array.isArray(d.files) && d.files.length > 0
  Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, value: (d) => ok(d) })
  Object.defineProperty(Navigator.prototype, 'share', {
    configurable: true,
    value: async (d) => {
      if (!ok(d)) throw new TypeError('not shareable')
      for (const f of d.files) window.__hbShared.push({ name: f.name, type: f.type, size: f.size })
    },
  })
})()`

/** No share sheet at all (a desktop engine without one). */
export const NO_SHARE_SHEET = `(() => {
  Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, value: undefined })
  Object.defineProperty(Navigator.prototype, 'share', { configurable: true, value: undefined })
})()`

/** "About N minutes." on an "Up next" screen, or null. */
export function aboutMin(text: string): number | null {
  const m = /About (\d+) minutes?\./.exec(text)
  return m === null ? null : Number(m[1])
}

/** The session ring's reading, "N of about M min". */
export async function ringText(page: Page): Promise<string> {
  const ring = page.getByRole('progressbar', { name: 'Session time' })
  await expect(ring).toBeVisible()
  return (await ring.getAttribute('aria-valuetext')) ?? ''
}

export function ringMinutes(text: string): { elapsed: number; total: number } | null {
  const m = /^(\d+) of about (\d+) min$/.exec(text)
  return m === null ? null : { elapsed: Number(m[1]), total: Number(m[2]) }
}
