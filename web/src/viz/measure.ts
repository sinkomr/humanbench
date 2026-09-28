/**
 * Text measurement for the blob's text layout (ROADMAP M1.16; `blob.ts` fitLayout): the browser
 * measures each label with a canvas in the page font, so the viewBox fits the real text on every
 * platform (system-ui differs between macOS, iOS, Android, Windows and Linux).
 *
 * Measured at {@link MEASURE_REF_PX} and scaled linearly. Browsers set SVG text at its ON-SCREEN
 * size, and system fonts are wider per em at small sizes (optical sizes, tracking: SF at 12.5 px
 * on screen is ~11% wider per em than at 30 px, M1.16 review, Chromium on macOS). Chart text is
 * fitted to ≥ 11 px on screen, so measuring at 11 px is the widest case that occurs.
 */

import { MIN_TEXT_PX, type TextMeasure } from './blob'

/** Canvas and SVG text can differ by rounding and hinting: a little headroom. */
export const MEASURE_HEADROOM = 1.04
/** The size texts are measured at: the smallest on-screen size the fit aims for. */
export const MEASURE_REF_PX = MIN_TEXT_PX

/**
 * A {@link TextMeasure} from a raw width function at {@link MEASURE_REF_PX}, scaled linearly to
 * the size asked, with headroom; each (text, style) is measured once.
 */
export function cachedMeasure(widthAtRef: (text: string, italic: boolean) => number): TextMeasure {
  const cache = new Map<string, number>()
  return (text, size, italic = false) => {
    const key = `${italic ? 'i' : 'n'}|${text}`
    let w = cache.get(key)
    if (w === undefined) {
      w = widthAtRef(text, italic) * MEASURE_HEADROOM
      cache.set(key, w)
    }
    return (w * size) / MEASURE_REF_PX
  }
}

/** A canvas measure in `fontFamily`, or null where there is no 2-D canvas (e.g. jsdom). */
export function canvasTextMeasure(fontFamily: string): TextMeasure | null {
  if (typeof document === 'undefined') return null
  let ctx: CanvasRenderingContext2D | null = null
  try {
    ctx = document.createElement('canvas').getContext('2d')
  } catch {
    return null
  }
  if (ctx === null || typeof ctx.measureText !== 'function') return null
  const c = ctx
  return cachedMeasure((text, italic) => {
    c.font = `${italic ? 'italic ' : ''}${MEASURE_REF_PX}px ${fontFamily}`
    return c.measureText(text).width
  })
}
