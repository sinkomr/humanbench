/**
 * Build-time flag (vite.config.ts `define`): true in `vite` dev and vitest, and in a build with
 * VITE_HB_DEV_ROUTES=1 (the Playwright e2e build); false in a plain production build, which then
 * drops the dev-only routes of `src/dev/` entirely (ROADMAP M1.16; `scripts/dev-routes.test.ts`).
 */
declare const __HB_DEV_ROUTES__: boolean

/**
 * Build-time flag (vite.config.ts `define`, `backendCompiledIn`): whether the server client of
 * M2.7 (`src/backend/`, supabase-js) is part of the build. False in a plain production build
 * (VITE_HB_SUPABASE_URL unset), which keeps the static fallback free of it; true in dev, in
 * vitest, in a build that names a server, and in the Playwright build.
 */
declare const __HB_BACKEND__: boolean
