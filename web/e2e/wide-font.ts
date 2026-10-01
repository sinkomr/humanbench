/**
 * The wide-font simulation shared by the reflow and accessibility specs (ROADMAP M1.16, M1.A,
 * M1.21; WCAG 1.4.10). The Linux CI runners render the system-ui stack in a font wider than
 * macOS's (DejaVu Sans), which overflowed the blob demo at 320 px while local runs passed. Here
 * every page font is forced to a wide face (Verdana, else DejaVu Sans) with extra letter spacing,
 * so a layout that only fits narrow fonts fails on any machine. The layout must absorb font
 * metrics (wrapping, min-width: 0), not rely on them.
 *
 * Call {@link useWideFont} before the first `page.goto`: the style goes in before any page script
 * runs, so the charts measure their text in the wide font too.
 */

import { expect, type Page } from '@playwright/test'

/**
 * Wider than either platform's default: a wide face, plus 0.06 em between letters outside SVG, and
 * no automatic hyphenation (Chromium on Linux has no hyphenation dictionaries).
 */
export const WIDE_FONT_CSS = `
  html, html * { font-family: Verdana, 'DejaVu Sans', sans-serif !important; hyphens: manual !important; -webkit-hyphens: manual !important; }
  html *:not(svg):not(svg *) { letter-spacing: 0.06em !important; }
`

/** Id of the injected style element. */
export const WIDE_FONT_STYLE_ID = 'hb-wide-font'

/** Injected before any page script runs, so the charts measure their text in the wide font. */
export async function useWideFont(page: Page): Promise<void> {
  // The document is still empty when init scripts run; readyState turns 'interactive' before the
  // deferred (module) app script runs.
  await page.addInitScript(`(() => {
    const add = () => {
      if (document.getElementById(${JSON.stringify(WIDE_FONT_STYLE_ID)}) || !document.head) return
      const s = document.createElement('style')
      s.id = ${JSON.stringify(WIDE_FONT_STYLE_ID)}
      s.textContent = ${JSON.stringify(WIDE_FONT_CSS)}
      document.head.appendChild(s)
    }
    add()
    document.addEventListener('readystatechange', add)
  })()`)
}

/** The page really is set in the wide face (a guard against the style silently not applying). */
export async function expectWideFont(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate<string>('getComputedStyle(document.body).fontFamily')).toContain('Verdana')
}
