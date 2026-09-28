/**
 * Build-time flag (vite.config.ts `define`): true in `vite` dev and vitest, and in a build with
 * VITE_HB_DEV_ROUTES=1 (the Playwright e2e build); false in a plain production build, which then
 * drops the dev-only routes of `src/dev/` entirely (ROADMAP M1.16; `scripts/dev-routes.test.ts`).
 */
declare const __HB_DEV_ROUTES__: boolean
