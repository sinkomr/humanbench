/**
 * axe-core helpers for the e2e suite (ROADMAP M1.A: every UI task from M1.13 on must reach 0 serious
 * or critical axe issues on its routes; M1.21 extends this to every route). DESIGN §13 asks for
 * WCAG 2.2 AA, so the rule set is WCAG 2.0, 2.1 and 2.2 at levels A and AA.
 *
 * Use {@link expectNoSeriousAxe} after the page has rendered what it should, e.g.
 * `await expect(page.getByRole('heading', { level: 1 })).toBeVisible()` first.
 */

import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

/** axe rule tags checked: WCAG 2.0/2.1/2.2, levels A and AA. */
export const WCAG_AA_TAGS: readonly string[] = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

/** Impacts that fail a test; "minor" and "moderate" are reported by M1.21's pass, not here. */
export const BLOCKING_IMPACTS: readonly string[] = ['serious', 'critical']

export type AxeViolation = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'][number]

export interface AxeScope {
  /** CSS selectors to limit the scan to (default: the whole page). */
  readonly include?: readonly string[]
  /** CSS selectors to leave out, e.g. a third-party widget; say why at the call site. */
  readonly exclude?: readonly string[]
}

/**
 * Wait for running CSS transitions to end, so axe never reads a colour half way between two themes
 * (a button caught mid-fade after a switch to dark mode measured 4.08:1 in a loaded WebKit run, while
 * both ends pass). Only transitions are waited for: an animation that never ends must not hold up a
 * scan. If a transition outlasts the wait, the scan goes ahead and reports what it sees.
 */
export async function settleTransitions(page: Page, timeout = 3000): Promise<void> {
  // An expression, not a function: a string that is a function would be truthy at once and never wait.
  const idle = `!document.getAnimations().some((a) => typeof CSSTransition !== 'undefined' && a instanceof CSSTransition && a.playState !== 'finished')`
  await page.waitForFunction(idle, undefined, { timeout }).catch(() => undefined)
}

/** The serious and critical WCAG A/AA violations on the page as it is now. */
export async function seriousAxeViolations(page: Page, scope: AxeScope = {}): Promise<AxeViolation[]> {
  await settleTransitions(page)
  let builder = new AxeBuilder({ page }).withTags([...WCAG_AA_TAGS])
  for (const s of scope.include ?? []) builder = builder.include(s)
  for (const s of scope.exclude ?? []) builder = builder.exclude(s)
  const { violations } = await builder.analyze()
  return violations.filter((v) => v.impact != null && BLOCKING_IMPACTS.includes(v.impact))
}

/** One readable line per violation, then one per offending node. */
export function formatViolation(v: AxeViolation): string {
  const nodes = v.nodes.map((n) => `    ${n.target.join(' ')}: ${(n.failureSummary ?? '').replace(/\s+/g, ' ')}`)
  return [`${v.impact ?? '?'} ${v.id}: ${v.help} (${v.helpUrl})`, ...nodes].join('\n')
}

/** Fails the test, listing each one, if the page has any serious or critical WCAG A/AA violation. */
export async function expectNoSeriousAxe(page: Page, scope: AxeScope = {}): Promise<void> {
  const serious = await seriousAxeViolations(page, scope)
  expect(serious.map(formatViolation), `serious/critical axe violations on ${page.url()}`).toEqual([])
}
