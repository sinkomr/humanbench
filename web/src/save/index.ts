/**
 * Save file (DESIGN §8, R-8.x; ROADMAP M1.17): schema v1 types and validator, RFC 8785 canonical
 * JSON, the unsigned MVP save built from session state, merge (R-8.1), migrations, the copy code
 * (gzip + base64url), content-sniffing upload and paste, download / Web Share / clipboard, and
 * localStorage autosave. JSON Schema: `schema/save-v1.json` at the repo root, published by the
 * build at `<base>schema/save-v1.json` (its `$id`).
 *
 * The property-test arbitraries (`testing.ts`) are test-only and not re-exported. Re-scoring a
 * save with the §7.8 retest model (`rescore.ts`, M1.Q) is not re-exported either: it imports the
 * task registry, which would make this module heavy (`scripts/bundle.test.ts`). Import
 * `save/rescore` explicitly.
 */
export * from './autosave'
export * from './brief-prefs'
export * from './clock'
export * from './codec'
export * from './create'
export * from './gzip'
export * from './ids'
export * from './io'
export * from './jcs'
export * from './merge'
export * from './migrate'
export * from './parse'
export * from './types'
export * from './validate'
