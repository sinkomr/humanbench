/**
 * The dev server of the e2e run (ROADMAP M1.13, M1.G7): the renderer gallery / G7 review page is
 * dev-only (never in a production build), so `playwright.config.ts` also starts `vite` (dev) on
 * E2E_DEV_PORT (default 4175) and `gallery.spec.ts` browses it there.
 */

export const DEV_PORT = Number(process.env.E2E_DEV_PORT ?? 4175)
export const DEV_BASE_URL = `http://127.0.0.1:${DEV_PORT}/humanbench/`
/** The review page (renderer gallery) on the dev server. */
export const REVIEW_URL = `${DEV_BASE_URL}review.html`
