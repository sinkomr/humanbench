/**
 * Getting a share card out of the browser (DESIGN §9.9 "Export"; ROADMAP M1.18): the SVG as a file,
 * the 2× PNG rasterised on a canvas, and the device's share sheet where it takes files. Everything
 * happens on this device: no request is made and no image server is involved (§9.9), and this
 * module holds no network call (`scripts/share-card.test.ts` scans for one).
 *
 * The PNG is made from the card's own SVG drawn 1:1 onto a canvas of the final size, so the
 * pixels are vector-sharp at 2400 × 1260 in engines that rasterise an SVG image at its intrinsic
 * size (WebKit does). The UI prepares the PNG before it is asked for, so the click handlers here
 * run synchronously inside the click (a download or a share after an `await` can lose the user's
 * activation on iOS).
 */

import { REVOKE_AFTER_MS, type DownloadEnv } from '../save/io'
import { CARD_H, CARD_W, PNG_SCALE } from './card'

export const PNG_MIME = 'image/png'
export const SVG_MIME = 'image/svg+xml'

/** The PNG's size: the card at {@link PNG_SCALE}×. */
export const PNG_W = CARD_W * PNG_SCALE
export const PNG_H = CARD_H * PNG_SCALE

/** `humanbench-card-YYYY-MM-DD.png` / `.svg`. The name carries no id, so a shared file does not point at a save. */
export function cardFileName(kind: 'png' | 'svg', date: Date): string {
  return `humanbench-card-${date.toISOString().slice(0, 10)}.${kind}`
}

/** An SVG document as a `data:` URL (an `<img>` source and the raster source; `#` and `%` are escaped). */
export function svgDataUrl(svg: string): string {
  return `data:${SVG_MIME};charset=utf-8,${encodeURIComponent(svg)}`
}

/** The browser objects {@link svgToPng} draws with (fakes in tests: jsdom has no 2-D canvas). */
export interface RasterEnv {
  image(): Pick<HTMLImageElement, 'onload' | 'onerror' | 'src' | 'width' | 'height'>
  canvas(): Pick<HTMLCanvasElement, 'width' | 'height' | 'getContext' | 'toBlob'>
}

const browserRaster = (): RasterEnv => ({
  image: () => new Image(),
  canvas: () => document.createElement('canvas'),
})

export interface Raster {
  readonly blob: Blob
  readonly width: number
  readonly height: number
}

/**
 * Draw `svg` (a document whose intrinsic size is `width` × `height`) onto a canvas of that size
 * and encode it as PNG. Rejects with an Error when the image cannot be decoded, the canvas has
 * no 2-D context, or the browser cannot encode it.
 */
export async function svgToPng(svg: string, width: number, height: number, env: RasterEnv = browserRaster()): Promise<Raster> {
  const img = env.image()
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('the card image could not be decoded'))
  })
  img.width = width
  img.height = height
  img.src = svgDataUrl(svg)
  await loaded
  const canvas = env.canvas()
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('this browser has no 2-D canvas')
  ctx.drawImage(img as CanvasImageSource, 0, 0, width, height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, PNG_MIME))
  if (blob === null) throw new Error('this browser could not encode the PNG')
  return { blob, width: canvas.width, height: canvas.height }
}

/** Download `blob` as `name` via `<a download>` (the same route as the save file: `save/io.ts` downloadSave). */
export function downloadBlob(blob: Blob, name: string, env: DownloadEnv = { document, URL, setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) }): void {
  const url = env.URL.createObjectURL(blob)
  const a = env.document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  a.style.display = 'none'
  env.document.body.appendChild(a)
  try {
    a.click()
  } finally {
    a.remove()
    env.setTimeout(() => env.URL.revokeObjectURL(url), REVOKE_AFTER_MS)
  }
}

/** The card's SVG text as a file body. */
export function svgBlob(svg: string): Blob {
  return new Blob([svg], { type: `${SVG_MIME};charset=utf-8` })
}

export type ShareNav = Partial<Pick<Navigator, 'share' | 'canShare'>>

/** Whether this browser can hand a PNG file to its share sheet. */
export function canShareImage(nav: ShareNav | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  if (nav === undefined || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false
  try {
    return nav.canShare({ files: [new File([''], 'card.png', { type: PNG_MIME })] })
  } catch {
    return false
  }
}

export type ImageShareOutcome = 'shared' | 'cancelled' | 'failed'

/**
 * Share the PNG through the share sheet. Call it directly from a click handler, with a PNG that
 * is already made. A dismissed sheet is `cancelled`; any other refusal is `failed`.
 */
export async function shareImage(blob: Blob, name: string, nav: ShareNav | undefined = typeof navigator === 'undefined' ? undefined : navigator): Promise<ImageShareOutcome> {
  if (nav === undefined || typeof nav.share !== 'function') return 'failed'
  try {
    await nav.share({ files: [new File([blob], name, { type: PNG_MIME })], title: 'HumanBench skill profile' })
    return 'shared'
  } catch (e) {
    return (e as { name?: unknown } | null)?.name === 'AbortError' ? 'cancelled' : 'failed'
  }
}
