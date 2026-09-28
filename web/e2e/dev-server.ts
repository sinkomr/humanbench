/**
 * The Vite dev server the e2e suite starts next to the production preview (ROADMAP M1.13): dev-only
 * pages such as the visual renderer gallery are never in the production build (they refuse to run
 * outside `import.meta.env.DEV`), so their specs load them from here. Set E2E_DEV_PORT if 4175 is
 * taken.
 */

export const DEV_PORT = Number(process.env.E2E_DEV_PORT ?? 4175)
export const DEV_ORIGIN = `http://127.0.0.1:${DEV_PORT}`
/** Base path of the dev server (the Pages base, as for the preview). */
export const DEV_BASE = '/humanbench/'

/** URL of the dev-only visual renderer gallery (`web/render-visual.html`). */
export function visualGalleryUrl(query: Readonly<Record<string, string | number>> = {}): string {
  const q = new URLSearchParams(Object.entries(query).map(([k, v]): [string, string] => [k, String(v)])).toString()
  return `${DEV_ORIGIN}${DEV_BASE}render-visual.html${q ? `?${q}` : ''}`
}
