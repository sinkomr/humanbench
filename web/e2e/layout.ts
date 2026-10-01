/**
 * Layout checks for reflow and zoom (ROADMAP M1.21; WCAG 1.4.4 resize text, 1.4.10 reflow). The e2e
 * tsconfig has no DOM lib, so the page code is passed as strings (as `axe.ts` and `wide-font.ts` do).
 *
 * - {@link expectNoSidewaysScroll}: the page never scrolls sideways, and on failure names the
 *   elements that stick out furthest. With a `scope` it judges the part of the page inside that selector (a
 *   renderer on a desktop tool's page).
 * - {@link expectNoClippedText}: nothing hides its own text (an `overflow: hidden` box whose content
 *   is larger than the box), which is what a fixed height or an ellipsis does when text grows.
 * - {@link ZOOM_200_VIEWPORT}: a 1280 × 800 window at 200% browser zoom is 640 × 400 CSS px.
 * - {@link useTextZoom}: text-only zoom, the root font size at 200% (WCAG 1.4.4's "text-only" case);
 *   a layout in `rem` follows it, one in `px` does not.
 */

import { expect, type Page } from '@playwright/test'

/** The desktop window the zoom figures are measured in. */
export const DESKTOP_VIEWPORT = Object.freeze({ width: 1280, height: 800 })
/** A 1280 × 800 window at 200% browser zoom (WCAG 1.4.4): the page sees 640 × 400 CSS px. */
export const ZOOM_200_VIEWPORT = Object.freeze({ width: 640, height: 400 })
/** The reflow width of WCAG 1.4.10 (a 1280 px window at 400%). */
export const REFLOW_VIEWPORT = Object.freeze({ width: 320, height: 640 })

export interface SidewaysOverflow {
  /** Pixels the document is wider than the window (0 or less: none). */
  readonly px: number
  /** The elements reaching furthest past the right edge, to name the culprit. */
  readonly culprits: readonly string[]
}

/**
 * Sideways overflow of the page now. With `scope` (a CSS selector), only what is inside the first element it matches is
 * judged: nothing in it may reach past the window's right edge, however wide the page around it is. (The box that
 * holds a renderer on a desktop tool's page is narrower than the one a session gives it, so the judge is the window.)
 */
export async function sidewaysOverflow(page: Page, scope?: string): Promise<SidewaysOverflow> {
  return page.evaluate<SidewaysOverflow>(`(() => {
    const scope = ${JSON.stringify(scope ?? null)}
    const root = scope === null ? document.body : document.querySelector(scope)
    if (!root) return { px: 1, culprits: ['no element matches ' + scope] }
    const inside = scope === null ? [...root.querySelectorAll('*')] : [root, ...root.querySelectorAll('*')]
    const reach = inside
      .filter((el) => !el.closest('.visually-hidden, .hb-sr-only'))
      .map((el) => ({ el, right: el.getBoundingClientRect().right }))
    const px = scope === null ? document.documentElement.scrollWidth - window.innerWidth : Math.ceil(Math.max(0, ...reach.map((x) => x.right)) - window.innerWidth)
    const culprits = px <= 0 ? [] : reach
      .filter((x) => x.right > window.innerWidth + 0.5)
      .sort((a, b) => b.right - a.right)
      .slice(0, 6)
      .map((x) => x.el.tagName.toLowerCase() + '.' + [...x.el.classList].join('.') + ' "' + (x.el.textContent || '').trim().slice(0, 30) + '" right=' + x.right.toFixed(1))
    return { px, culprits }
  })()`)
}

/** Fails if the page (or, with `scope`, the part of it inside that selector) scrolls sideways. */
export async function expectNoSidewaysScroll(page: Page, where: string, scope?: string): Promise<void> {
  const r = await sidewaysOverflow(page, scope)
  expect(r.px, `${where}: ${scope === undefined ? 'page' : scope} scrolls sideways by ${r.px}px: ${r.culprits.join(' | ')}`).toBeLessThanOrEqual(0)
}

/**
 * Elements that clip their own content: they hide overflow and their content is larger than they
 * are. Visually hidden text (1 px boxes) and SVG internals are not counted.
 */
export async function clippedText(page: Page, scope?: string): Promise<string[]> {
  return page.evaluate<string[]>(`(() => {
    const scope = ${JSON.stringify(scope ?? null)}
    const root = scope === null ? document.body : document.querySelector(scope)
    if (!root) return ['no element matches ' + scope]
    const out = []
    for (const el of scope === null ? root.querySelectorAll('*') : [root, ...root.querySelectorAll('*')]) {
      if (el.closest('svg')) continue
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden') continue
      const r = el.getBoundingClientRect()
      if (r.width <= 1 || r.height <= 1) continue
      const hidesX = /hidden|clip/.test(cs.overflowX)
      const hidesY = /hidden|clip/.test(cs.overflowY)
      if (!hidesX && !hidesY) continue
      const overX = hidesX && el.scrollWidth > el.clientWidth + 1
      const overY = hidesY && el.scrollHeight > el.clientHeight + 1
      if (!(overX || overY) || (el.textContent || '').trim() === '') continue
      out.push(el.tagName.toLowerCase() + '.' + [...el.classList].join('.') + ' "' + (el.textContent || '').trim().slice(0, 30) + '" ' + el.scrollWidth + 'x' + el.scrollHeight + ' in ' + el.clientWidth + 'x' + el.clientHeight)
    }
    return out
  })()`)
}

/** Fails if anything hides its own text (with `scope`, only inside that selector). */
export async function expectNoClippedText(page: Page, where: string, scope?: string): Promise<void> {
  expect(await clippedText(page, scope), `${where}: text is clipped`).toEqual([])
}

/** Id of the style that {@link useTextZoom} injects. */
export const TEXT_ZOOM_STYLE_ID = 'hb-text-zoom'

/**
 * Text-only zoom to `percent` (WCAG 1.4.4): the root font size is that share of the browser's default, as
 * a taker who raised the browser's text size has it. Applies at once and to later page loads.
 */
export async function useTextZoom(page: Page, percent = 200): Promise<void> {
  const css = `html { font-size: ${percent}% !important; }`
  await page.addInitScript(`(() => {
    const add = () => {
      if (document.getElementById(${JSON.stringify(TEXT_ZOOM_STYLE_ID)}) || !document.head) return
      const s = document.createElement('style')
      s.id = ${JSON.stringify(TEXT_ZOOM_STYLE_ID)}
      s.textContent = ${JSON.stringify(css)}
      document.head.appendChild(s)
    }
    add()
    document.addEventListener('readystatechange', add)
  })()`)
}

/** Text zoom for the page as it is now (for a state reached before the zoom was wanted). */
export async function setTextZoomNow(page: Page, percent: number | null): Promise<void> {
  await page.evaluate(`(() => {
    let s = document.getElementById(${JSON.stringify(TEXT_ZOOM_STYLE_ID)})
    if (${JSON.stringify(percent)} === null) { s?.remove(); return }
    if (!s) { s = document.createElement('style'); s.id = ${JSON.stringify(TEXT_ZOOM_STYLE_ID)}; document.head.appendChild(s) }
    s.textContent = 'html { font-size: ' + ${JSON.stringify(percent)} + '% !important; }'
  })()`)
}

/** Id of the style that {@link setTextSpacingNow} injects. */
export const TEXT_SPACING_STYLE_ID = 'hb-text-spacing'

/**
 * The text spacing of WCAG 1.4.12 (a reader's style sheet may set it, and nothing may be lost): line height
 * 1.5, letter spacing 0.12 em, word spacing 0.16 em, and 2 em after paragraphs. Applies at once; `false` removes it.
 */
export async function setTextSpacingNow(page: Page, on: boolean): Promise<void> {
  const css = `html *:not(svg):not(svg *) { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } html p { margin-bottom: 2em !important; }`
  await page.evaluate(`(() => {
    let s = document.getElementById(${JSON.stringify(TEXT_SPACING_STYLE_ID)})
    if (!${JSON.stringify(on)}) { s?.remove(); return }
    if (!s) { s = document.createElement('style'); s.id = ${JSON.stringify(TEXT_SPACING_STYLE_ID)}; document.head.appendChild(s) }
    s.textContent = ${JSON.stringify(css)}
  })()`)
}
