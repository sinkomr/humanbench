/**
 * Scoring engine (DESIGN §7, §8, §11.6): PRNG, axis registry and Σ, linear algebra,
 * IRT response models, the person scorer (MAP/Laplace + per-axis EAP, ROADMAP A2), the §7.8
 * retest model for multi-session re-scoring (M1.Q), the §13 integrity flags (M1.19) and shared
 * types.
 *
 * The adaptive selector (`selector.ts`, M1.14) is deliberately NOT re-exported: it imports the
 * task registry, whose families import this barrel, so a re-export would be an import cycle.
 * Import `engine/selector` explicitly.
 */
export * from './axes'
export * from './integrity'
export * from './irt'
export * from './linalg'
export * from './prng'
export * from './retest'
export * from './scorer'
export * from './types'
