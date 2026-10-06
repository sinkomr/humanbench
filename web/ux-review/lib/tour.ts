/**
 * A tour of the product's routes (`e2e/routes.ts`): every state a person can reach, opened the way the
 * accessibility sweep opens it, then photographed and measured at each width and colour scheme asked for.
 * One page per route (a fresh page is a fresh session), so a route that fails to open costs only itself.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { BrowserContext } from '@playwright/test'
import { settleTransitions } from '../../e2e/axe'
import { scheme } from '../../e2e/flow'
import { useTextZoom } from '../../e2e/layout'
import { openRoute, PREVIEW_ROUTES, type Route } from '../../e2e/routes'
import { pageMetrics, trackConsole, type ConsoleLog, type PageMetrics } from './metrics'
import { repoRel, saveText, savePng, slug, UX_ROOT } from './shots'

/** Every route a person can reach in the product: the preview routes without the dev-only tools. */
export const PRODUCT_ROUTES: readonly Route[] = PREVIEW_ROUTES.filter((r) => r.group !== 'dev')

export type Scheme = 'light' | 'dark'

export interface TourOptions {
  readonly runId: string
  /** Route ids (default: every {@link PRODUCT_ROUTES} entry; any preview route id is accepted). */
  readonly routes?: readonly string[]
  /** Viewport widths in CSS px (default: the context's own viewport width). */
  readonly widths?: readonly number[]
  /** Default ['light']. */
  readonly schemes?: readonly Scheme[]
  /** Text-only zoom in percent (WCAG 1.4.4), applied to every page of the tour. */
  readonly textZoom?: number
  /** Measure each state (default true). */
  readonly metrics?: boolean
  /** Also run axe on each state (default false). */
  readonly axe?: boolean
  /** A phone: targets are judged against 44 px as well as 24 px. */
  readonly touch?: boolean
  /** Directory under web/test-results/ux-review/<runId>/ (default 'tour'). */
  readonly sub?: string
  /**
   * Keep the browser storage of the context (default false: every route starts with the app's storage emptied, as each
   * e2e test starts on a new context; without that, the consent record one route stores makes the next one skip the gate).
   */
  readonly keepStorage?: boolean
}

export interface TourEntry {
  readonly route: string
  readonly ok: boolean
  readonly error?: string
  /** PNG paths relative to the repo root (on a failure: the screenshot of whatever was on screen). */
  readonly shots: string[]
  /** Per '<width>-<scheme>'. */
  readonly metrics: Record<string, PageMetrics>
  /** The page text and accessibility tree of the first width and scheme (repo-relative), when the route opened. */
  readonly text?: string
  readonly aria?: string
  /** Console errors, warnings, page errors and failed requests seen while the route opened and was measured. */
  readonly console?: ConsoleLog
  /** Things the harness could not do on a route that did open (a measurement that threw). */
  readonly problems?: string[]
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error)).trim()

/** summary.json of a run: this tour's entries merged into what earlier tours of the same run wrote (a route is replaced by its latest entry). */
function writeSummary(file: string, entries: readonly TourEntry[]): void {
  let all: TourEntry[] = []
  try {
    const old: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (Array.isArray(old)) all = old as TourEntry[]
  } catch {
    // no earlier summary
  }
  for (const e of entries) {
    const at = all.findIndex((x) => x.route === e.route)
    if (at >= 0) all[at] = e
    else all.push(e)
  }
  const order = new Map(PREVIEW_ROUTES.map((r, i) => [r.id, i]))
  all.sort((a, b) => (order.get(a.route) ?? 9999) - (order.get(b.route) ?? 9999))
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(all, null, 2))
}

/** Empty what the app keeps in the browser (consent record, autosave, kept settings) and the cookies of the context. */
async function clearStorage(context: BrowserContext): Promise<void> {
  const page = await context.newPage()
  try {
    // A document of the app's origin that runs none of the app (an image), so nothing writes storage again as it unloads.
    await page.goto('./favicon.svg')
    await page.evaluate('localStorage.clear(); sessionStorage.clear()')
    await context.clearCookies()
  } catch (error) {
    console.log(`[tour] could not empty the browser storage: ${message(error).split('\n')[0]}`)
  }
  await page.close().catch(() => undefined)
}

function pick(ids: readonly string[] | undefined): readonly Route[] {
  if (ids === undefined) return PRODUCT_ROUTES
  const known = new Map(PREVIEW_ROUTES.map((r) => [r.id, r]))
  const unknown = ids.filter((id) => !known.has(id))
  if (unknown.length > 0) throw new Error(`Unknown route id(s): ${unknown.join(', ')}. Known: ${[...known.keys()].join(', ')}.`)
  return ids.map((id) => known.get(id) as Route)
}

/**
 * Tour the routes in `context`. A route that cannot be opened is recorded (error and a screenshot of what is on screen) and the
 * tour goes on. Writes `<runId>/<sub>/<route>/<width>-<scheme>.png` and `<runId>/<sub>/summary.json` after every route.
 */
export async function tour(context: BrowserContext, opts: TourOptions): Promise<TourEntry[]> {
  const routes = pick(opts.routes)
  const schemes = opts.schemes ?? ['light']
  const sub = opts.sub ?? 'tour'
  const root = path.join(UX_ROOT, opts.runId, sub)
  const summary = path.join(root, 'summary.json')
  const entries: TourEntry[] = []

  for (const route of routes) {
    const dir = path.join(root, slug(route.id))
    const shots: string[] = []
    const metrics: Record<string, PageMetrics> = {}
    let text: string | undefined
    let aria: string | undefined
    const problems: string[] = []
    if (opts.keepStorage !== true) await clearStorage(context)
    const page = await context.newPage()
    const log = trackConsole(page)
    let entry: TourEntry
    try {
      if (opts.textZoom !== undefined) await useTextZoom(page, opts.textZoom)
      await route.prepare?.(page)
      if (route.motion !== 'allow') await page.emulateMedia({ reducedMotion: 'reduce' })
      try {
        await openRoute(page, route)
      } catch (error) {
        const failed = await savePng(page, path.join(dir, 'open-failed.png'))
        if (failed !== '') shots.push(failed)
        throw error
      }
      const widths = opts.widths ?? [page.viewportSize()?.width ?? 1280]
      for (const width of widths) {
        for (const colorScheme of schemes) {
          const key = `${width}-${colorScheme}`
          await page.setViewportSize({ width, height: page.viewportSize()?.height ?? 800 })
          // A route that shows motion keeps it: only the colour scheme changes.
          if (route.motion === 'allow') await page.emulateMedia({ colorScheme })
          else await scheme(page, colorScheme)
          await settleTransitions(page)
          await page.waitForTimeout(150)
          const png = await savePng(page, path.join(dir, `${key}.png`))
          if (png !== '') shots.push(png)
          if (text === undefined) {
            text = saveText(path.join(dir, `${key}.txt`), await page.locator('body').innerText().catch(() => ''))
            aria = saveText(path.join(dir, `${key}.aria.yml`), await page.locator('body').ariaSnapshot().catch(() => ''))
          }
          if (opts.metrics !== false) {
            try {
              metrics[key] = await pageMetrics(page, { touch: opts.touch === true, axe: opts.axe === true })
            } catch (error) {
              problems.push(`metrics ${key}: ${message(error).split('\n')[0]}`)
            }
          }
        }
      }
      entry = { route: route.id, ok: true, shots, metrics, ...(text === undefined ? {} : { text }), ...(aria === undefined ? {} : { aria }), console: log, ...(problems.length === 0 ? {} : { problems }) }
    } catch (error) {
      entry = { route: route.id, ok: false, error: message(error).split('\n').slice(0, 6).join('\n'), shots, metrics, console: log }
    }
    await page.close().catch(() => undefined)
    entries.push(entry)
    console.log(`[tour ${opts.runId}] ${route.id} ${entry.ok ? `ok (${entry.shots.length} shots)` : `FAILED: ${(entry.error ?? '').split('\n')[0]}`}`)
    writeSummary(summary, entries)
  }
  console.log(`[tour ${opts.runId}] ${entries.filter((e) => e.ok).length}/${entries.length} routes opened; summary: ${repoRel(summary)}`)
  return entries
}
