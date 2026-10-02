/**
 * axe-core helpers for the e2e suite (ROADMAP M1.A: every UI task from M1.13 on must reach 0 serious
 * or critical axe issues on its routes; M1.21 extends this to every route). DESIGN §13 asks for
 * WCAG 2.2 AA, so the rule set is WCAG 2.0, 2.1 and 2.2 at levels A and AA, and axe's best-practice
 * rules next to them: several of those are rated serious (`tabindex` above 0, `label-title-only`,
 * `aria-dialog-name`, `accesskeys`), and a serious finding fails whichever rule set it came from.
 *
 * Use {@link expectNoSeriousAxe} after the page has rendered what it should, e.g.
 * `await expect(page.getByRole('heading', { level: 1 })).toBeVisible()` first.
 */

import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

/** axe rule tags of the WCAG 2.0/2.1/2.2 A and AA success criteria. */
export const WCAG_AA_TAGS: readonly string[] = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

/** Impacts that fail a test through {@link expectNoSeriousAxe}; "minor" and "moderate" are checked by M1.21's route sweep (`a11y.spec.ts`), through {@link nonBlockingAxeViolations}. */
export const BLOCKING_IMPACTS: readonly string[] = ['serious', 'critical']

/**
 * The tags every scan uses: the WCAG A/AA rules and axe's best-practice rules (landmarks, headings, regions, but also
 * serious ones such as `tabindex`). The blocking and the non-blocking helpers share this one rule set and split its findings
 * by impact, so a finding is never missed by both. `scripts/axe-tags.test.ts` lists the rules these tags leave out.
 */
export const REPORT_TAGS: readonly string[] = [...WCAG_AA_TAGS, 'best-practice']

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

/** Every violation of the {@link REPORT_TAGS} rules on the page as it is now. */
async function scan(page: Page, scope: AxeScope): Promise<AxeViolation[]> {
  await settleTransitions(page)
  let builder = new AxeBuilder({ page }).withTags([...REPORT_TAGS])
  for (const s of scope.include ?? []) builder = builder.include(s)
  for (const s of scope.exclude ?? []) builder = builder.exclude(s)
  const { violations } = await builder.analyze()
  return violations
}

const isBlocking = (v: AxeViolation): boolean => v.impact != null && BLOCKING_IMPACTS.includes(v.impact)

/** The serious and critical violations of the WCAG A/AA and best-practice rules on the page as it is now. */
export async function seriousAxeViolations(page: Page, scope: AxeScope = {}): Promise<AxeViolation[]> {
  return (await scan(page, scope)).filter(isBlocking)
}

/**
 * The findings of the same scan that are not serious or critical: the moderate and minor ones. M1.21 keeps these at
 * none too; they are the landmarks, headings and regions a screen-reader user moves by.
 */
export async function nonBlockingAxeViolations(page: Page, scope: AxeScope = {}): Promise<AxeViolation[]> {
  return (await scan(page, scope)).filter((v) => !isBlocking(v))
}

/** One readable line per violation, then one per offending node. */
export function formatViolation(v: AxeViolation): string {
  const nodes = v.nodes.map((n) => `    ${n.target.join(' ')}: ${(n.failureSummary ?? '').replace(/\s+/g, ' ')}`)
  return [`${v.impact ?? '?'} ${v.id}: ${v.help} (${v.helpUrl})`, ...nodes].join('\n')
}

/** Fails the test, listing each one, if the page has any serious or critical violation (WCAG A/AA or best practice). */
export async function expectNoSeriousAxe(page: Page, scope: AxeScope = {}): Promise<void> {
  const serious = await seriousAxeViolations(page, scope)
  expect(serious.map(formatViolation), `serious/critical axe violations on ${page.url()}`).toEqual([])
}

/** The axe rules about ARIA attributes. They report what a tool cannot decide as "incomplete", which the other helpers ignore. */
export const ARIA_ATTRIBUTE_RULES: readonly string[] = ['aria-prohibited-attr', 'aria-allowed-attr', 'aria-valid-attr', 'aria-valid-attr-value', 'aria-allowed-role']

/**
 * Fails the test if axe's ARIA attribute rules report anything on the page, as a violation or as an "incomplete" finding
 * (e.g. an `aria-label` on a paragraph, which ARIA 1.2 does not allow: axe leaves it "incomplete" with impact serious, and
 * {@link expectNoSeriousAxe} reads only violations).
 */
export async function expectNoAriaAttributeIssues(page: Page, scope: AxeScope = {}): Promise<void> {
  await settleTransitions(page)
  let builder = new AxeBuilder({ page }).withRules([...ARIA_ATTRIBUTE_RULES])
  for (const s of scope.include ?? []) builder = builder.include(s)
  for (const s of scope.exclude ?? []) builder = builder.exclude(s)
  const { violations, incomplete } = await builder.analyze()
  expect([...violations, ...incomplete].map(formatViolation), `ARIA attribute findings on ${page.url()}`).toEqual([])
}
