/**
 * The Vite dev server the e2e suite starts next to the production preview (ROADMAP M1.13, M1.G7):
 * dev-only pages such as the visual renderer gallery (`render-visual.html`) and the renderer
 * gallery / G7 review page (`review.html`) are never in the production build (they refuse to run
 * outside `import.meta.env.DEV`), so their specs load them from here. Set E2E_DEV_PORT if 4175 is
 * taken.
 */

export const DEV_PORT = Number(process.env.E2E_DEV_PORT ?? 4175)
export const DEV_ORIGIN = `http://127.0.0.1:${DEV_PORT}`
/** Base path of the dev server (the Pages base, as for the preview). */
export const DEV_BASE = '/humanbench/'
export const DEV_BASE_URL = `${DEV_ORIGIN}${DEV_BASE}`

/** URL of the dev-only visual renderer gallery (`web/render-visual.html`). */
export function visualGalleryUrl(query: Readonly<Record<string, string | number>> = {}): string {
  const q = new URLSearchParams(Object.entries(query).map(([k, v]): [string, string] => [k, String(v)])).toString()
  return `${DEV_BASE_URL}render-visual.html${q ? `?${q}` : ''}`
}

/** The review page (renderer gallery, G7) on the dev server (`web/review.html`). */
export const REVIEW_URL = `${DEV_BASE_URL}review.html`
