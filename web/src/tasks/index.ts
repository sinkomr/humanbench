/**
 * Task families (DESIGN §4.2, §14.1): rotation, matrix, series, quant, span, rt, coding,
 * reading. The procedural family contract (M1.F) lives in `family.ts`, ids in `ids.ts` and
 * difficulty/time priors in `priors.ts`; this barrel re-exports only those light helpers.
 *
 * The registry (`registry.ts`) is deliberately NOT re-exported: it imports every family and
 * its data (e.g. the reading passages), so app code that only needs a helper such as `itemId`
 * must not pull it in. Import `./tasks/registry` explicitly where the families themselves are
 * needed (the selector, M1.14); `web/scripts/bundle.test.ts` checks both in a production build.
 * The property-test helper `testing.ts` is test-only and not re-exported either.
 */
export * from './family'
export * from './ids'
export * from './priors'
