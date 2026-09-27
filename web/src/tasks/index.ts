/**
 * Task families (DESIGN §4.2, §14.1): rotation, matrix, series, quant, span, rt, coding,
 * reading. The procedural family contract (M1.F) lives in `family.ts`, ids in `ids.ts`,
 * difficulty/time priors in `priors.ts` and the registry in `registry.ts`. The property-test
 * helper `testing.ts` is test-only and deliberately not re-exported here.
 */
export * from './family'
export * from './ids'
export * from './priors'
export * from './registry'
