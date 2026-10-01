/// <reference lib="dom" />
/**
 * The accessibility pass over every route (ROADMAP M1.21; DESIGN §13 WCAG 2.2 AA; R-17.14). Each
 * entry of `routes.ts` (the three pages, the hash routes, every screen of the session flow, the
 * results and the share card, the notes builder, the RT self-test and the dev-only pages) is opened
 * on a fresh page (and must show every renderer it claims to cover, `openRoute`), set in the wide-font
 * simulation (`wide-font.ts`, so a Linux CI font cannot hide a layout that only fits macOS's), and checked for:
 *
 * - axe: 0 serious or critical issues of the WCAG 2.0/2.1/2.2 A/AA rules and of axe's best-practice rules (a positive
 *   tabindex, a field named only by its title), in light and in dark, and no moderate or minor one either (landmarks,
 *   headings, regions);
 * - `prefers-reduced-motion: reduce`: nothing is animating or transitioning, and nothing started
 *   to since the page began to load, however short (events, not a look at one moment; a state that
 *   exists to show motion is opened with motion allowed instead, and its reduced twin is in `reveal.spec.ts`);
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
import { openRoute, phoneScopes, ROUTES, type Route } from './routes'
import { expectWideFont, useWideFont } from './wide-font'

/** Animations and transitions that are running or about to: the ones `prefers-reduced-motion` must stop. */
async function runningAnimations(page: Page): Promise<string[]> {
  return page.evaluate<string[]>(`document.getAnimations()
    .filter((a) => a.playState === 'running' || a.playState === 'pending')
    .map((a) => (a.effect && a.effect.target ? a.effect.target.tagName.toLowerCase() : '?') + ' ' + (a.animationName || a.transitionProperty || a.id || 'animation'))`)
}

/**
 * Records every CSS animation and transition that starts (`animationstart`, `transitionrun`), from before the page's own
 * scripts run: one that began and ended before the check is not seen by `document.getAnimations()`, an event is.
 */
const RECORD_MOTION = `(() => {
  window.__hbMotion = []
  for (const type of ['animationstart', 'transitionrun']) {
    addEventListener(type, (e) => {
      const t = e.target && e.target.tagName ? e.target.tagName.toLowerCase() + '.' + [...e.target.classList].join('.') : '?'
      window.__hbMotion.push(type + ' ' + t + ' ' + (e.animationName || e.propertyName || ''))
    }, true)
  }
})()`

/** Animations and transitions that have started since the page began. */
async function startedMotion(page: Page): Promise<string[]> {
  return page.evaluate<string[]>('window.__hbMotion || []')
}

/** A fresh page for a route: wide font, the route's motion setting, any set-up it asks for. */
async function setUp(page: Page, route: Route, viewport?: { width: number; height: number }): Promise<void> {
  await useWideFont(page)
  await page.addInitScript(RECORD_MOTION)
  await page.emulateMedia({ reducedMotion: route.motion === 'allow' ? 'no-preference' : 'reduce', colorScheme: 'light' })
  if (viewport !== undefined) await page.setViewportSize(viewport)
  await route.prepare?.(page)
}

test.describe('the reduced-motion check is not vacuous', () => {
  const PAGE = (rules: string): string => `(() => {
    const s = document.createElement('style')
    s.textContent = '@keyframes k { to { opacity: 0.5 } } .a { animation: k 2s } .b { transition: opacity 1s } ' + ${JSON.stringify(rules)}
    document.head.append(s)
    document.body.innerHTML = '<div class="a">x</div><div class="b">y</div>'
    document.body.offsetWidth
    document.querySelector('.b').style.opacity = '0.4'
  })()`

  test('sees an animation and a transition that start, even if they end at once', async ({ page }) => {
    await page.goto('about:blank')
    await page.evaluate(RECORD_MOTION)
    await page.evaluate(PAGE('.a { animation-duration: 1ms } .b { transition-duration: 1ms }'))
    await expect.poll(() => startedMotion(page)).toEqual(expect.arrayContaining([expect.stringMatching(/^animationstart div\.a k$/), expect.stringMatching(/^transitionrun div\.b opacity$/)]))
  })

  test('sees nothing when a reduce rule switches the motion off', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('about:blank')
    await page.evaluate(RECORD_MOTION)
    await page.evaluate(PAGE('@media (prefers-reduced-motion: reduce) { .a { animation: none } .b { transition: none } }'))
    await page.waitForTimeout(300)
    expect(await startedMotion(page)).toEqual([])
    expect(await runningAnimations(page)).toEqual([])
  })
})

test.describe('the layout checks see what they are for', () => {
  test('a page wider than the window fails, and a scope judges only the part of the page inside it', async ({ page, isMobile }) => {
    test.skip(isMobile === true, 'a phone lays a page without a viewport tag out at 980 px')
    await page.setViewportSize({ width: 400, height: 600 })
    await page.setContent('<div id="tool" style="width:900px;height:20px">a wide desktop tool</div><div id="part" style="width:200px;height:20px">a part that fits</div>')
    await expect(expectNoSidewaysScroll(page, 'the page')).rejects.toThrow(/page scrolls sideways by \d+px/)
    await expectNoSidewaysScroll(page, 'the part', '#part')
    await expect(expectNoSidewaysScroll(page, 'the tool', '#tool')).rejects.toThrow(/#tool scrolls sideways by 5\d\dpx/)
    await expect(expectNoSidewaysScroll(page, 'nothing', '#absent')).rejects.toThrow(/no element matches #absent/)
  })

  test('text a box hides is found, inside a scope or not', async ({ page }) => {
    await page.setContent('<div id="cut" style="width:40px;height:20px;overflow:hidden;white-space:nowrap">text that does not fit in its box</div><p id="ok">fine</p>')
    await expect(expectNoClippedText(page, 'the page')).rejects.toThrow(/text is clipped/)
    await expect(expectNoClippedText(page, 'the cut box', '#cut')).rejects.toThrow(/text is clipped/)
    await expectNoClippedText(page, 'the paragraph', '#ok')
  })
})

test.describe('the claims of a route are checked, not trusted', () => {
  const claiming = (claim: string, open: Route['open']): Route => ({ id: 'claiming', group: 'dev', state: 'a page made for this test', covers: [claim], open })

  test('a route that claims a renderer it does not draw fails, and one that draws it passes', async ({ page }) => {
    const matrix = 'render/matrices/MatrixRenderer.svelte'
    const blank = claiming(matrix, async (p) => {
      await p.goto('about:blank')
    })
    await expect(openRoute(page, blank, 500)).rejects.toThrow(/claiming claims render\/matrices\/MatrixRenderer\.svelte, which draws div\.matrix/)
    const drawn = claiming(matrix, async (p) => {
      await p.setContent('<div class="matrix">a matrix</div>')
    })
    await openRoute(page, drawn, 500)
  })

  test('a claim of a file that is no renderer is not checked against the page', async ({ page }) => {
    await openRoute(
      page,
      claiming('session/Stage.svelte', async (p) => {
        await p.goto('about:blank')
      }),
      500,
    )
  })
})

test.describe('every route: axe, reduced motion', () => {
  for (const route of ROUTES) {
    test(`${route.id}: no serious or critical axe issues, light and dark, wide font`, async ({ page }) => {
      await setUp(page, route)
      await openRoute(page, route)
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
        await openRoute(page, route)
        expect(await page.evaluate<boolean>(`matchMedia('(prefers-reduced-motion: reduce)').matches`)).toBe(true)
        expect(await runningAnimations(page), `${route.state}: animations running`).toEqual([])
        expect(await startedMotion(page), `${route.state}: animations or transitions started`).toEqual([])
      })
    }
  }
})

test.describe('every route: reflow and zoom (WCAG 1.4.4, 1.4.10), wide font', () => {
  for (const route of ROUTES) {
    test(`${route.id}: fits 320 CSS px`, async ({ page }) => {
      await setUp(page, route, REFLOW_VIEWPORT)
      await openRoute(page, route)
      await expectNoSidewaysScroll(page, `${route.id} at 320px`)
      await expectNoClippedText(page, `${route.id} at 320px`)
      await expectNoSeriousAxe(page)
    })

    test(`${route.id}: works at 200% browser zoom (a 1280 px window shows 640 × 400)`, async ({ page }) => {
      await setUp(page, route, ZOOM_200_VIEWPORT)
      await openRoute(page, route)
      await expectNoSidewaysScroll(page, `${route.id} at 200% zoom`)
      await expectNoClippedText(page, `${route.id} at 200% zoom`)
      await page.emulateMedia({ colorScheme: 'dark' })
      await expectNoSeriousAxe(page)
    })

    test(`${route.id}: works with the text alone at 200% in a desktop window (WCAG 1.4.4)`, async ({ page, isMobile }) => {
      test.skip(isMobile === true, 'a phone has no desktop window: its large text is the next test')
      await setUp(page, route, DESKTOP_VIEWPORT)
      await openRoute(page, route)
      await setTextZoomNow(page, 200)
      expect(await page.evaluate<number>(`parseFloat(getComputedStyle(document.documentElement).fontSize)`)).toBe(32)
      await expectNoSidewaysScroll(page, `${route.id} at 200% text`)
      await expectNoClippedText(page, `${route.id} at 200% text`)
      await expectNoSeriousAxe(page)
    })

    // Large text on a phone: the text at twice its size in the 390 px of an iPhone, which leaves the equivalent of 195 px.
    // The pages a person meets must still fit (the dev-only tools are for a desktop and are not asked to, unless the route
    // says that it shows a renderer a person meets on a phone).
    if (route.group !== 'dev' || route.phone === true) {
      test(`${route.id}: fits a phone with the text at 200%`, async ({ page, isMobile }) => {
        test.skip(isMobile !== true, 'the phone project')
        await setUp(page, route)
        await openRoute(page, route)
        await setTextZoomNow(page, 200)
        // A desktop tool's page is not asked to fit; the renderers it shows are (`phoneScopes`).
        for (const scope of route.group === 'dev' ? phoneScopes(route) : [undefined]) {
          await expectNoSidewaysScroll(page, `${route.id} at 200% text on a phone`, scope)
          await expectNoClippedText(page, `${route.id} at 200% text on a phone`, scope)
        }
      })
    }

    test(`${route.id}: keeps its content with a reader's text spacing (WCAG 1.4.12)`, async ({ page }) => {
      await setUp(page, route)
      await openRoute(page, route)
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
        await openRoute(page, route)
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
