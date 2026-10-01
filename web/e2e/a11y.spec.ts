/// <reference lib="dom" />
/**
 * The accessibility pass over every route (ROADMAP M1.21; DESIGN §13 WCAG 2.2 AA; R-17.14). Each
 * entry of `routes.ts` (the three pages, the hash routes, every screen of the session flow, the
 * results and the share card, the notes builder, the RT self-test and the dev-only pages) is opened
 * on a fresh page, set in the wide-font simulation (`wide-font.ts`, so a Linux CI font cannot hide a
 * layout that only fits macOS's), and checked for:
 *
 * - axe: 0 serious or critical WCAG 2.0/2.1/2.2 A/AA issues, in light and in dark, and no moderate or minor
 *   one either (axe's best-practice rules: landmarks, headings, regions);
 * - `prefers-reduced-motion: reduce`: nothing is animating or transitioning (a state that exists
 *   to show motion is opened with motion allowed instead, and its reduced twin is in `reveal.spec.ts`);
 * - reflow at 320 CSS px (WCAG 1.4.10), at 200% browser zoom (a 1280 px window at 200% is 640 × 400),
 *   with the text alone at 200% (WCAG 1.4.4; in a desktop window, and on a phone for the pages a person
 *   meets) and with a reader's text spacing (WCAG 1.4.12): no sideways scroll, no text clipped by its box,
 *   and axe still clean;
 * - the keyboard: Tab goes through the whole page and comes back (no trap, WCAG 2.1.2), reaches
 *   every control, and every stop shows a focus indicator on screen (WCAG 2.4.7). The full-session
 *   keyboard-only run is `keyboard-session.spec.ts`.
 *
 * The browsers differ in what they expose (Safari's default is not to Tab to buttons), so the Tab
 * pass uses the chord that reaches every control (`keyboard.ts`) and runs on desktop engines only.
 */

import { expect, test, type Page } from '@playwright/test'
import { expectNoSeriousAxe, formatViolation, nonBlockingAxeViolations } from './axe'
import { focusableControls, tabAround } from './keyboard'
import { DESKTOP_VIEWPORT, expectNoClippedText, expectNoSidewaysScroll, REFLOW_VIEWPORT, setTextSpacingNow, setTextZoomNow, ZOOM_200_VIEWPORT } from './layout'
import { ROUTES, type Route } from './routes'
import { expectWideFont, useWideFont } from './wide-font'

/** Animations and transitions that are running or about to: the ones `prefers-reduced-motion` must stop. */
async function runningAnimations(page: Page): Promise<string[]> {
  return page.evaluate<string[]>(`document.getAnimations()
    .filter((a) => a.playState === 'running' || a.playState === 'pending')
    .map((a) => (a.effect && a.effect.target ? a.effect.target.tagName.toLowerCase() : '?') + ' ' + (a.animationName || a.transitionProperty || a.id || 'animation'))`)
}

/** A fresh page for a route: wide font, the route's motion setting, any set-up it asks for. */
async function setUp(page: Page, route: Route, viewport?: { width: number; height: number }): Promise<void> {
  await useWideFont(page)
  await page.emulateMedia({ reducedMotion: route.motion === 'allow' ? 'no-preference' : 'reduce', colorScheme: 'light' })
  if (viewport !== undefined) await page.setViewportSize(viewport)
  await route.prepare?.(page)
}

test.describe('every route: axe, reduced motion', () => {
  for (const route of ROUTES) {
    test(`${route.id}: no serious or critical axe issues, light and dark, wide font`, async ({ page }) => {
      await setUp(page, route)
      await route.open(page)
      await expectWideFont(page)
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme })
        await expectNoSeriousAxe(page)
      }
      // The moderate and minor findings (landmarks, headings, regions) are none either.
      const minor = await nonBlockingAxeViolations(page)
      expect(minor.map(formatViolation), `moderate or minor axe findings on ${route.state}`).toEqual([])
    })

    if (route.motion !== 'allow') {
      test(`${route.id}: nothing moves under prefers-reduced-motion`, async ({ page }) => {
        await setUp(page, route)
        await route.open(page)
        expect(await page.evaluate<boolean>(`matchMedia('(prefers-reduced-motion: reduce)').matches`)).toBe(true)
        expect(await runningAnimations(page), `${route.state}: animations running`).toEqual([])
      })
    }
  }
})

test.describe('every route: reflow and zoom (WCAG 1.4.4, 1.4.10), wide font', () => {
  for (const route of ROUTES) {
    test(`${route.id}: fits 320 CSS px`, async ({ page }) => {
      await setUp(page, route, REFLOW_VIEWPORT)
      await route.open(page)
      await expectNoSidewaysScroll(page, `${route.id} at 320px`)
      await expectNoClippedText(page, `${route.id} at 320px`)
      await expectNoSeriousAxe(page)
    })

    test(`${route.id}: works at 200% browser zoom (a 1280 px window shows 640 × 400)`, async ({ page }) => {
      await setUp(page, route, ZOOM_200_VIEWPORT)
      await route.open(page)
      await expectNoSidewaysScroll(page, `${route.id} at 200% zoom`)
      await expectNoClippedText(page, `${route.id} at 200% zoom`)
      await page.emulateMedia({ colorScheme: 'dark' })
      await expectNoSeriousAxe(page)
    })

    test(`${route.id}: works with the text alone at 200% in a desktop window (WCAG 1.4.4)`, async ({ page, isMobile }) => {
      test.skip(isMobile === true, 'a phone has no desktop window: its large text is the next test')
      await setUp(page, route, DESKTOP_VIEWPORT)
      await route.open(page)
      await setTextZoomNow(page, 200)
      expect(await page.evaluate<number>(`parseFloat(getComputedStyle(document.documentElement).fontSize)`)).toBe(32)
      await expectNoSidewaysScroll(page, `${route.id} at 200% text`)
      await expectNoClippedText(page, `${route.id} at 200% text`)
      await expectNoSeriousAxe(page)
    })

    // Large text on a phone: the text at twice its size in the 390 px of an iPhone, which leaves the equivalent of 195 px.
    // The pages a person meets must still fit (the dev-only tools are for a desktop and are not asked to).
    if (route.group !== 'dev') {
      test(`${route.id}: fits a phone with the text at 200%`, async ({ page, isMobile }) => {
        test.skip(isMobile !== true, 'the phone project')
        await setUp(page, route)
        await route.open(page)
        await setTextZoomNow(page, 200)
        await expectNoSidewaysScroll(page, `${route.id} at 200% text on a phone`)
        await expectNoClippedText(page, `${route.id} at 200% text on a phone`)
      })
    }

    test(`${route.id}: keeps its content with a reader's text spacing (WCAG 1.4.12)`, async ({ page }) => {
      await setUp(page, route)
      await route.open(page)
      // Line height 1.5, letters 0.12 em, words 0.16 em, paragraphs 2 em: nothing hidden, nothing running off the page.
      await setTextSpacingNow(page, true)
      await expectNoSidewaysScroll(page, `${route.id} with text spacing`)
      await expectNoClippedText(page, `${route.id} with text spacing`)
    })
  }
})

test.describe('every route: the keyboard reaches everything and shows where it is (WCAG 2.1.1, 2.1.2, 2.4.7)', () => {
  for (const route of ROUTES) {
    // A state that exists to show motion changes under the walk (controls appear as the profile builds); the finished
    // page is the `results` route.
    if (route.motion !== 'allow') {
      test(`${route.id}: Tab goes round the page, every stop shows focus`, async ({ page, browserName, isMobile }) => {
        test.skip(isMobile === true, 'a touch phone has no Tab key')
        await setUp(page, route)
        await route.open(page)
        const controls = await focusableControls(page)
        const stops = await tabAround(page, browserName)
        // A page of text alone (the under-18 notice) has nothing to stop at, and says so by being plain text.
        if (controls.length === 0) {
          expect(stops, `${route.state}: no controls, so no stops`).toEqual([])
          return
        }
        expect(stops.length, `${route.state}: Tab found nothing to stop at`).toBeGreaterThan(0)
        const bad = stops.filter((s) => !s.indicator || !s.inView).map((s) => `${s.what}${s.indicator ? '' : ' (no focus indicator)'}${s.inView ? '' : ' (off screen)'}`)
        expect(bad, `${route.state}: stops that hide where focus is`).toEqual([])
        // Every control that can take Tab was visited (a radio group counts once).
        const visited = new Set(stops.map((s) => s.id))
        const missed = controls.filter((c) => !c.ids.some((id) => visited.has(id))).map((c) => c.what)
        expect(missed, `${route.state}: controls Tab never stopped at`).toEqual([])
      })
    }
  }
})
